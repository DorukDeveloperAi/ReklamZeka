import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { verifyBudgetProposal, type BudgetProposal } from "@/application/budget-proposal-service";
import { verifySliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";
import { DrizzleBudgetProposalRepository } from "@/connectors/budget/budget-proposal-drizzle-repository";
import { FrozenContextBudgetImpactScopeResolver } from "@/connectors/campaigns/frozen-context-budget-impact-scope-resolver";
import { ACTION_PREPARATION_FLAG } from "@/domain/actions/action-preparation-flag";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
export type ActionPreparationGateDatabase = Pick<Database, "select" | "insert" | "execute">;
export type ActionPreparationGateStage = "selection" | "materialization" | "approval" | "admission";

export class UnifiedActionPreparationGateError extends Error {
  constructor(readonly code: "source_missing" | "source_ambiguous" | "stale_source" | "scope_mismatch" | "market_boundary" | "delivery_hold" | "corrupt_store") {
    super(`Unified action preparation gate blocked: ${code}`);
    this.name = "UnifiedActionPreparationGateError";
  }
}

type GateInput = Readonly<{ workspaceId: string; draftHash: string; proposalHash: string; allocationRef: string; stage: ActionPreparationGateStage; evaluatedAt: string }>;
export type UnifiedActionPreparationGateResult = Readonly<{
  stage: ActionPreparationGateStage;
  frozenContextHash: string;
  market: "domestic" | "international";
  deliveryHold: false;
  admissionEnabled: false;
  evaluationHash: string;
}>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function fail(code: UnifiedActionPreparationGateError["code"]): never { throw new UnifiedActionPreparationGateError(code); }

/**
 * The only market/delivery gate for the selection-derived budget path. The
 * caller supplies correlations already resolved by the server; amount, entity,
 * scope, flag and evidence never cross an HTTP boundary.
 */
export async function evaluateUnifiedActionPreparationGate(database: ActionPreparationGateDatabase, input: GateInput): Promise<UnifiedActionPreparationGateResult> {
  const [drafts, proposals, entities] = await Promise.all([
    database.select().from(schema.sliceRuleWorkspaceDrafts).where(and(eq(schema.sliceRuleWorkspaceDrafts.workspaceId, input.workspaceId), eq(schema.sliceRuleWorkspaceDrafts.draftHash, input.draftHash))).limit(2),
    database.select().from(schema.budgetProposalVersions).where(and(eq(schema.budgetProposalVersions.workspaceId, input.workspaceId), eq(schema.budgetProposalVersions.proposalHash, input.proposalHash))).limit(2),
    database.select().from(schema.sliceRuleAllocationEntityBindings).where(and(eq(schema.sliceRuleAllocationEntityBindings.workspaceId, input.workspaceId), eq(schema.sliceRuleAllocationEntityBindings.draftHash, input.draftHash), eq(schema.sliceRuleAllocationEntityBindings.allocationRef, input.allocationRef))).limit(2),
  ]);
  if (drafts.length !== 1 || proposals.length !== 1 || entities.length !== 1) fail([drafts, proposals, entities].some((rows) => rows.length > 1) ? "source_ambiguous" : "source_missing");
  const draft = drafts[0]!;
  const proposal = proposals[0]!.proposalPayload as BudgetProposal;
  if (!verifySliceRuleWorkspaceDraft(draft.draftPayload) || !verifyBudgetProposal(proposal)
    || proposal.proposalHash !== input.proposalHash || proposal.scope.workspaceId !== input.workspaceId
    || proposal.scope.adAccountId !== entities[0]!.adAccountId || proposal.scope.campaignId !== entities[0]!.campaignId) fail("scope_mismatch");
  const resolved = await new FrozenContextBudgetImpactScopeResolver(new DrizzleBudgetProposalRepository(database as never)).loadExact({
    workspaceId: input.workspaceId, adAccountId: entities[0]!.adAccountId, campaignId: entities[0]!.campaignId,
    contextHash: proposal.scope.contextHash, expectedScope: draft.draftPayload.scope,
  });
  if (resolved.state !== "ready" || !resolved.scope) fail("stale_source");
  if (resolved.scope.market !== draft.draftPayload.scope.market) fail("market_boundary");
  const contexts = await database.select().from(schema.effectiveCampaignContexts).where(and(
    eq(schema.effectiveCampaignContexts.workspaceId, input.workspaceId), eq(schema.effectiveCampaignContexts.contextHash, proposal.scope.contextHash),
    eq(schema.effectiveCampaignContexts.adAccountId, entities[0]!.adAccountId), eq(schema.effectiveCampaignContexts.campaignId, entities[0]!.campaignId),
  )).limit(2);
  if (contexts.length !== 1) fail(contexts.length > 1 ? "source_ambiguous" : "stale_source");
  const alerts = await database.execute(sql`select 1 from delivery_health_alert_ledger_records h where h.workspace_id=${input.workspaceId}::uuid and h.account_ref=${contexts[0]!.accountRef} and h.status <> 'resolved' and not exists (select 1 from delivery_health_alert_ledger_records n where n.workspace_id=h.workspace_id and n.alert_ref=h.alert_ref and n.sequence>h.sequence) limit 1`);
  if (!alerts || typeof alerts !== "object" || !("rows" in alerts) || !Array.isArray(alerts.rows)) fail("corrupt_store");
  if (alerts.rows.length) fail("delivery_hold");
  const core = Object.freeze({ version: "unified-action-preparation-gate/1.0.0", stage: input.stage,
    draftHash: input.draftHash, proposalHash: input.proposalHash, allocationRef: input.allocationRef,
    frozenContextHash: proposal.scope.contextHash, market: resolved.scope.market, deliveryHold: false as const,
    actionPreparation: ACTION_PREPARATION_FLAG });
  return Object.freeze({ stage: input.stage, frozenContextHash: proposal.scope.contextHash, market: resolved.scope.market,
    deliveryHold: false as const, admissionEnabled: ACTION_PREPARATION_FLAG.enabled, evaluationHash: digest(core) });
}

/** Resolves the immutable selection edge again for approval and admission. */
export async function evaluateUnifiedActionPreparationGateForUnit(database: ActionPreparationGateDatabase, input: Readonly<{
  workspaceId: string; actionProposalUnitId: string; stage: Exclude<ActionPreparationGateStage, "selection" | "materialization">; evaluatedAt: string;
}>): Promise<UnifiedActionPreparationGateResult> {
  const bindings = await database.select({ selectionId: schema.sliceRuleBudgetActionUnitBindings.selectionId })
    .from(schema.sliceRuleBudgetActionUnitBindings).where(and(
      eq(schema.sliceRuleBudgetActionUnitBindings.workspaceId, input.workspaceId),
      eq(schema.sliceRuleBudgetActionUnitBindings.actionProposalUnitId, input.actionProposalUnitId),
    )).limit(2);
  if (bindings.length !== 1) fail(bindings.length > 1 ? "source_ambiguous" : "source_missing");
  const selections = await database.select().from(schema.sliceRuleScenarioAllocationSelections).where(and(
    eq(schema.sliceRuleScenarioAllocationSelections.workspaceId, input.workspaceId), eq(schema.sliceRuleScenarioAllocationSelections.id, bindings[0]!.selectionId),
  )).limit(2);
  if (selections.length !== 1) fail(selections.length > 1 ? "source_ambiguous" : "source_missing");
  const selection = selections[0]!;
  return evaluateUnifiedActionPreparationGate(database, { workspaceId: input.workspaceId, draftHash: selection.draftHash,
    proposalHash: selection.proposalHash, allocationRef: selection.allocationRef, stage: input.stage, evaluatedAt: input.evaluatedAt });
}

export async function appendActionPreparationGateSnapshot(database: ActionPreparationGateDatabase, input: Readonly<{
  workspaceId: string; selectionId: string | null; actionProposalUnitId: string | null; result: UnifiedActionPreparationGateResult; evaluatedAt: string;
}>): Promise<void> {
  const payload = Object.freeze({ version: "action-preparation-gate-snapshot/1.0.0", stage: input.result.stage,
    evaluationHash: input.result.evaluationHash, frozenContextHash: input.result.frozenContextHash, market: input.result.market,
    deliveryHold: false as const, actionPreparation: ACTION_PREPARATION_FLAG,
    authority: Object.freeze({ canExecute: false as const, canDispatchNetwork: false as const, canWriteMeta: false as const }) });
  await database.insert(schema.actionPreparationGateSnapshots).values({ workspaceId: input.workspaceId,
    selectionId: input.selectionId, actionProposalUnitId: input.actionProposalUnitId, stage: input.result.stage,
    evaluationHash: input.result.evaluationHash, snapshotPayload: payload, evaluatedAt: new Date(input.evaluatedAt),
  }).onConflictDoNothing();
}
