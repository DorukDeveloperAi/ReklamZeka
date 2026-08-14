import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { evaluateTemporalRecommendation, type TemporalRecommendationResult } from "@/application/temporal-recommendation-service";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { DrizzleDeterministicWindowSnapshotRepository } from "@/connectors/analyses/deterministic-window-snapshot-drizzle-repository";
import { DrizzleSliceRuleWorkspaceRepository } from "@/connectors/campaigns/slice-rule-workspace-drizzle-repository";
import { DrizzleDecisionLedgerRepository } from "@/connectors/decisions/decision-ledger-drizzle-repository";
import { TemporalRecommendationDrizzleAdapter } from "@/connectors/decisions/temporal-recommendation-drizzle-adapter";
import { DrizzleDeliveryHealthAlertLedgerRepository } from "@/connectors/meta/delivery-health-alert-ledger-drizzle-repository";
import type { DecisionLedger, DecisionLedgerRecord } from "@/domain/decisions/ledger";
import * as schema from "@/db/schema";
import { resolveTrustedLocalReadPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createTemporalRecommendationHttpHandler, type TemporalRecommendationCandidate, type TemporalRecommendationCommand, type TemporalRecommendationExactCommand, type TemporalRecommendationReadItem } from "@/server/temporal-recommendation-http";

type Database = NodePgDatabase<typeof schema>;
type CandidateTriple = Readonly<{ frozenContextRef: string; ruleSeriesRef: string; windowRef: string; reviewCadence: "daily" | "weekly" | "monthly"; capturedAt: string }>;
const rows = <T,>(value: unknown): readonly T[] => {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) throw new Error("invalid_input");
  return value.rows as readonly T[];
};
const candidateRef = (candidate: Pick<CandidateTriple, "frozenContextRef" | "ruleSeriesRef" | "windowRef">) =>
  `temporal_candidate_${createHash("sha256").update(JSON.stringify(candidate)).digest("hex").slice(0, 24)}`;

/** Candidate tuples are discovered server-side from current rule heads and non-invalidated L3/contexts only. */
async function eligibleCandidates(database: Pick<Database, "execute">, workspaceId: string): Promise<readonly CandidateTriple[]> {
  const found = rows<{ context_hash: unknown; series_ref: unknown; window_ref: unknown; review_cadence: unknown; captured_at: unknown }>(await database.execute(sql`
    select context.context_hash, rule.series_ref, window.window_ref,
      rule.draft_payload #>> '{operatingRule,verification,reviewCadence}' as review_cadence, context.captured_at
    from effective_campaign_contexts context
    join lateral jsonb_array_elements_text(context.context_payload #> '{data,windowRefs}') named_window(window_ref) on true
    join deterministic_window_snapshots window on window.workspace_id = context.workspace_id
      and window.window_ref = named_window.window_ref and window.ad_account_id = context.ad_account_id
    join (
      select draft_payload, series_ref, row_number() over (partition by series_ref order by revision desc) as rank
      from slice_rule_workspace_drafts where workspace_id = ${workspaceId}::uuid
    ) rule on rule.rank = 1
    where context.workspace_id = ${workspaceId}::uuid
      and context.context_payload #>> '{data,trustStatus}' = 'ready'
      and not exists (
        select 1 from effective_campaign_context_components component
        join effective_campaign_context_invalidations invalidation on invalidation.workspace_id = component.workspace_id
          and invalidation.component_type = component.component_type and invalidation.component_ref = component.component_ref
          and invalidation.component_version = component.component_version
        where component.workspace_id = context.workspace_id and component.context_id = context.id
          and (invalidation.entity_type is null or (invalidation.entity_type = context.entity_type and invalidation.entity_ref = context.entity_ref))
      )
      and not exists (
        select 1 from deterministic_window_snapshot_features binding
        join deterministic_feature_snapshot_invalidations invalidation on invalidation.workspace_id = binding.workspace_id
          and invalidation.feature_snapshot_id = binding.feature_snapshot_id
        where binding.workspace_id = window.workspace_id and binding.window_snapshot_id = window.id
      )
    order by context.captured_at desc, rule.series_ref asc, window.window_ref asc
    limit 50
  `));
  return Object.freeze(found.map((row) => {
    if (typeof row.context_hash !== "string" || !/^[a-f0-9]{64}$/.test(row.context_hash)
      || typeof row.series_ref !== "string" || !/^[a-z][a-z0-9_.:-]{0,127}$/.test(row.series_ref)
      || typeof row.window_ref !== "string" || !/^window_[a-f0-9]{24}$/.test(row.window_ref)
      || !["daily", "weekly", "monthly"].includes(String(row.review_cadence))
      || !(row.captured_at instanceof Date)) throw new Error("invalid_input");
    return Object.freeze({ frozenContextRef: row.context_hash, ruleSeriesRef: row.series_ref, windowRef: row.window_ref,
      reviewCadence: row.review_cadence as CandidateTriple["reviewCadence"], capturedAt: row.captured_at.toISOString() });
  }));
}
const temporalItems = (ledger: DecisionLedger): readonly TemporalRecommendationReadItem[] => ledger.flatMap((record) => {
  if (record.recordType !== "analysis" || record.analysisDefinitionRef !== "temporal-recommendation") return [];
  const frozen = record.frozenContext as Record<string, unknown>;
  const evaluationRef = frozen.temporalEvaluationRef; const window = frozen.window as Record<string, unknown> | undefined;
  const decision = ledger.find((entry): entry is DecisionLedgerRecord => entry.recordType === "decision" && entry.analysisRecordRef === record.recordId);
  if (typeof evaluationRef !== "string" || !window || typeof window.ref !== "string" || !decision || !decision.cadenceResultRef.startsWith("temporal:")) return [];
  return [{ evaluationRef, occurredAt: record.occurredAt, outcome: decision.disposition === "act" ? "recommendation" as const : "no_change" as const, reason: decision.cadenceResultRef.slice("temporal:".length), windowRef: window.ref }];
}).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

/** Resolves all temporal evidence from stored immutable artifacts; browser input is references only. */
export function createLocalTemporalRecommendationHandlers(input: Readonly<{ database: Pick<Database, "select" | "insert" | "execute" | "transaction">; config: LocalDecisionRoomConfig }>) {
  return async (request: Request) => {
    const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database, config: input.config, requiredScope: "approval_queue:read" });
    const ledgerRepository = new DrizzleDecisionLedgerRepository(input.database);
    const service = Object.freeze({
      list: async () => temporalItems(await ledgerRepository.load(bound.principal.workspaceId)),
      listCandidates: async (): Promise<readonly TemporalRecommendationCandidate[]> => (await eligibleCandidates(input.database, bound.principal.workspaceId)).map((candidate) => Object.freeze({
        candidateRef: candidateRef(candidate), ruleSeriesRef: candidate.ruleSeriesRef, reviewCadence: candidate.reviewCadence,
        windowRef: candidate.windowRef, capturedAt: candidate.capturedAt,
      })),
      evaluate: async (command: TemporalRecommendationCommand): Promise<TemporalRecommendationResult> => {
        const candidates = await eligibleCandidates(input.database, bound.principal.workspaceId);
        const exact: TemporalRecommendationExactCommand = "candidateRef" in command
          ? (() => { const match = candidates.find((candidate) => candidateRef(candidate) === command.candidateRef); if (!match) throw new Error("invalid_input"); return match; })()
          : command;
        // Exact triples are not trusted merely because they parse: they must still be in the current server candidate set.
        if (!candidates.some((candidate) => candidate.frozenContextRef === exact.frozenContextRef && candidate.ruleSeriesRef === exact.ruleSeriesRef && candidate.windowRef === exact.windowRef)) throw new Error("invalid_input");
        const contexts = new DrizzleEffectiveCampaignContextRepository(input.database as never);
        const context = await contexts.loadHistorical(bound.principal.workspaceId, exact.frozenContextRef);
        if (context.invalidated || !context.analysisDataScope || context.context.data.trustStatus !== "ready" || !context.context.data.windowRefs.includes(exact.windowRef)) throw new Error("invalid_input");
        const rules = new DrizzleSliceRuleWorkspaceRepository(input.database);
        const ruleDraft = await rules.loadCurrentExact({ workspaceId: bound.principal.workspaceId, actorId: bound.principal.actor.userId, seriesRef: exact.ruleSeriesRef });
        if (!ruleDraft) throw new Error("invalid_input");
        const loaded = await new DrizzleDeterministicWindowSnapshotRepository(input.database as never).loadCurrent({ workspaceId: bound.principal.workspaceId, windowRef: exact.windowRef });
        if (loaded.state !== "ready" || loaded.window.scope.adAccountId !== context.analysisDataScope.adAccountId) throw new Error("invalid_input");
        const alerts = await new DrizzleDeliveryHealthAlertLedgerRepository(input.database as never).listCurrent({ workspaceId: bound.principal.workspaceId, actorId: bound.principal.actor.userId, limit: 200 });
        const start = `${loaded.window.resolvedTimeframe.startDate}T00:00:00.000Z`;
        const end = new Date(`${loaded.window.resolvedTimeframe.endDate}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1);
        return evaluateTemporalRecommendation({ workspaceRef: bound.principal.workspaceRef, occurredAt: context.context.capturedAt,
          frozenContextRef: exact.frozenContextRef, ruleDraft, openDeliveryAlerts: alerts,
          window: { windowRef: loaded.window.windowRef, accountRef: context.context.identity.accountRef, startedAt: start, endedAt: end.toISOString(), settled: true, evidenceRefs: loaded.window.featureRefs } },
        new TemporalRecommendationDrizzleAdapter(ledgerRepository, { workspaceId: bound.principal.workspaceId, workspaceRef: bound.principal.workspaceRef }));
      },
    });
    const handlers = createTemporalRecommendationHttpHandler({ service, resolvePrincipal: async () => bound.principal });
    return request.method === "GET" ? handlers.GET(request) : handlers.POST(request);
  };
}
