import type { NodePgDatabase } from "drizzle-orm/node-postgres";
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
import { createTemporalRecommendationHttpHandler, type TemporalRecommendationCommand, type TemporalRecommendationReadItem } from "@/server/temporal-recommendation-http";

type Database = NodePgDatabase<typeof schema>;
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
      evaluate: async (command: TemporalRecommendationCommand): Promise<TemporalRecommendationResult> => {
        const contexts = new DrizzleEffectiveCampaignContextRepository(input.database as never);
        const context = await contexts.loadHistorical(bound.principal.workspaceId, command.frozenContextRef);
        if (context.invalidated || !context.analysisDataScope || !context.context.data.windowRefs.includes(command.windowRef)) throw new Error("invalid_input");
        const rules = new DrizzleSliceRuleWorkspaceRepository(input.database);
        const ruleDraft = await rules.loadCurrentExact({ workspaceId: bound.principal.workspaceId, actorId: bound.principal.actor.userId, seriesRef: command.ruleSeriesRef });
        if (!ruleDraft) throw new Error("invalid_input");
        const loaded = await new DrizzleDeterministicWindowSnapshotRepository(input.database as never).loadCurrent({ workspaceId: bound.principal.workspaceId, windowRef: command.windowRef });
        if (loaded.state !== "ready" || loaded.window.scope.adAccountId !== context.analysisDataScope.adAccountId) throw new Error("invalid_input");
        const alerts = await new DrizzleDeliveryHealthAlertLedgerRepository(input.database as never).listCurrent({ workspaceId: bound.principal.workspaceId, actorId: bound.principal.actor.userId, limit: 200 });
        const start = `${loaded.window.resolvedTimeframe.startDate}T00:00:00.000Z`;
        const end = new Date(`${loaded.window.resolvedTimeframe.endDate}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1);
        return evaluateTemporalRecommendation({ workspaceRef: bound.principal.workspaceRef, occurredAt: context.context.capturedAt,
          frozenContextRef: command.frozenContextRef, ruleDraft, openDeliveryAlerts: alerts,
          window: { windowRef: loaded.window.windowRef, accountRef: context.context.identity.accountRef, startedAt: start, endedAt: end.toISOString(), settled: true, evidenceRefs: loaded.window.featureRefs } },
        new TemporalRecommendationDrizzleAdapter(ledgerRepository, { workspaceId: bound.principal.workspaceId, workspaceRef: bound.principal.workspaceRef }));
      },
    });
    const handlers = createTemporalRecommendationHttpHandler({ service, resolvePrincipal: async () => bound.principal });
    return request.method === "GET" ? handlers.GET(request) : handlers.POST(request);
  };
}
