import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { BudgetLabDraftService, type BudgetLabDraftCommand } from "@/application/budget-lab-draft-service";
import { ApprovalQueueReadService } from "@/application/approval-queue-read-service";
import { DrizzleApprovalQueueReadRepository } from "@/connectors/actions/approval-queue-drizzle-read-repository";
import { SliceRuleWorkspaceService } from "@/application/slice-rule-workspace-service";
import { DrizzleApprovalPolicyRegistryRepository } from "@/connectors/actions/approval-policy-registry-drizzle-repository";
import { DrizzleBudgetProposalRepository } from "@/connectors/budget/budget-proposal-drizzle-repository";
import { DrizzleCategoryAuthoringRepository } from "@/connectors/categories/category-authoring-drizzle-repository";
import { DrizzleCategoryProfileLifecycleRepository } from "@/connectors/categories/category-profile-lifecycle-drizzle-repository";
import { DrizzleSliceRuleAllocationEntityBindingRepository } from "@/connectors/campaigns/slice-rule-allocation-entity-binding-drizzle-repository";
import { DrizzleSliceRuleBudgetActionUnitMaterializer } from "@/connectors/campaigns/slice-rule-budget-action-unit-materializer";
import { DrizzleSliceRuleScenarioAllocationSelectionRepository } from "@/connectors/campaigns/slice-rule-scenario-allocation-selection-drizzle-repository";
import { DrizzleSliceRuleWorkspaceRepository } from "@/connectors/campaigns/slice-rule-workspace-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { DrizzleWorkspaceTombstoneStore, WorkspaceTombstoneService } from "@/connectors/meta/workspace-tombstone-drizzle-service";
import { createApprovalPolicyDraft, publishApprovalPolicy } from "@/domain/actions/approval-policy-registry";
import { ACTION_APPROVAL_POLICY_VERSION } from "@/domain/actions/approval-lifecycle";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef, categoryEntityPublicRef } from "@/domain/categories/public-reference";
import * as schema from "@/db/schema";
import { materializeCurrentEffectiveAnalysisContextSourceFixture } from "./support/current-effective-analysis-context-source-fixture";
import { materializeReadyBudgetContext } from "./support/materialize-ready-budget-context";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.DATABASE_URL?.trim(); if (!url) throw new Error("DATABASE_URL yapılandırılmadı");
const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema }); const rollback = Symbol("authentic-approval-chain-rollback");
const evidence = { readyL3: false, ruleSaved: false, savedProposal: false, allocationBound: false, selected: false, materialized: false, exactReplay: false, queueRead: false, canExecuteFalse: false, rollbackClean: false, cleanup: false, metaCalls: 0, executionCalls: 0 };
const rows = (v: unknown): readonly Record<string, unknown>[] => v && typeof v === "object" && "rows" in v && Array.isArray(v.rows) ? v.rows as readonly Record<string, unknown>[] : [];
const now = new Date(); const proposedAt = new Date(now.getTime() + 2_000).toISOString(); const expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
let fixture: Awaited<ReturnType<typeof materializeCurrentEffectiveAnalysisContextSourceFixture>> | null = null;
async function assignScopeCategories(source: NonNullable<typeof fixture>) {
  const authoring = new DrizzleCategoryAuthoringRepository(database as never); let state = await authoring.inspect(source.workspaceId);
  const profiles = new DrizzleCategoryProfileLifecycleRepository(database as never);
  for (const [dimension, definition] of [["market", "yabanci"], ["service_line", "service_physical_therapy"], ["campaign_family", "campaign_family_intensive_ftr"]] as const) {
    state = (await authoring.mutate({ workspaceId: source.workspaceId, actorId: source.actorId, actorRef: source.actorRef, role: "owner", occurredAt: proposedAt, command: { operation: "create_dimension", key: dimension, name: dimension, description: null, cardinality: "single", allowedEntityLevels: ["campaign"], expectedRegistryHash: state.registryHash } })).state;
    const dimensionRef = categoryDimensionPublicRef(dimension);
    state = (await authoring.mutate({ workspaceId: source.workspaceId, actorId: source.actorId, actorRef: source.actorRef, role: "owner", occurredAt: proposedAt, command: { operation: "create_definition", dimensionRef, key: definition, label: definition, description: null, expectedRegistryHash: state.registryHash } })).state;
    state = (await authoring.mutate({ workspaceId: source.workspaceId, actorId: source.actorId, actorRef: source.actorRef, role: "owner", occurredAt: proposedAt, command: { operation: "create_assignment", dimensionRef, definitionRef: categoryDefinitionPublicRef(dimension, definition), entityLevel: "campaign", entityRef: categoryEntityPublicRef(source.workspaceId, "campaign", source.campaignId), viaAdRef: null, assignmentOperation: "override", manualLock: false, confidenceBasisPoints: 10_000, expectedRegistryHash: state.registryHash } })).state;
    let profileState = await profiles.inspect(source.workspaceId, source.workspaceRef);
    const created = await profiles.mutate({ workspaceId: source.workspaceId, workspaceRef: source.workspaceRef, actorId: source.actorId, actorRef: source.actorRef, role: "owner", occurredAt: proposedAt, command: { operation: "create_draft", definitionRef: categoryDefinitionPublicRef(dimension, definition), expectedRegistryHash: profileState.registryHash, parentDefinitionRef: null, label: definition, description: "Authentic approval-chain fixture", color: "#A31F34", bindings: { analysisPlaybookRefs: ["analysis_playbook_approval_chain"], ruleInstructionBundleRefs: [], budgetPolicyRefs: [], transferPolicyRefs: [], schedulePolicyRefs: [], actionPolicyRefs: [], creativePolicyRefs: [] } } });
    profileState = created.state;
    await profiles.mutate({ workspaceId: source.workspaceId, workspaceRef: source.workspaceRef, actorId: source.actorId, actorRef: source.actorRef, role: "owner", occurredAt: proposedAt, command: { operation: "publish", profileRef: created.profile.profileRef, expectedVersion: created.profile.version, expectedProfileHash: created.profile.profileHash, expectedRegistryHash: profileState.registryHash, reasonCode: "approval_chain_fixture" } });
  }
}
const fetch0 = globalThis.fetch;
try {
  globalThis.fetch = (async () => { evidence.metaCalls += 1; throw new Error("network_not_allowed"); }) as typeof fetch;
  fixture = await materializeCurrentEffectiveAnalysisContextSourceFixture(database as never);
  const source = fixture;
  await assignScopeCategories(source);
  // Canonical mirror fixture only: the target context remains wholly production-materialized below.
  await database.execute(sql`update ad_campaigns set campaign_budget_optimization=true, daily_budget_minor=10000, raw_payload_hash=${"a".repeat(64)}, source_graph_version='v23.0', field_catalog_version='approval-chain-fixture', fetched_at=${now} where workspace_id=${source.workspaceId}::uuid and id=${source.campaignId}::uuid`);
  await database.insert(schema.metaAdSets).values({ id: randomUUID(), workspaceId: source.workspaceId, adAccountId: source.adAccountId, campaignId: source.campaignId, externalAdSetId: `adset_${source.campaignRef}`, name: "Approval chain fixture", rawPayloadHash: "c".repeat(64), sourceGraphVersion: "v23.0", fieldCatalogVersion: "approval-chain-fixture", provenance: { fixture: true }, fetchedAt: now, firstSeenAt: now, lastSeenAt: now });
  const prepared = await materializeReadyBudgetContext(database, source); if (!prepared.ready) throw new Error("authentic_chain_l3_not_ready"); evidence.readyL3 = true;
  await database.transaction(async (tx) => {
    const ruleService = new SliceRuleWorkspaceService(new DrizzleSliceRuleWorkspaceRepository(tx as never));
    const savedRule = await ruleService.saveDraft(source.actorId, { workspaceId: source.workspaceId, seriesRef: "slice_rule.approval_chain", revision: 1, previousDraftHash: "GENESIS", idempotencyKey: "slice_rule.approval_chain.r1", createdAt: proposedAt, scope: { market: "international", serviceRef: "service_physical_therapy", campaignFamilyRef: "campaign_family_intensive_ftr" }, rule: { kind: "targeting_budget_preservation", currency: "TRY", totalDailyBudgetDecimal: "100.00", allocations: [{ allocationRef: "allocation_primary", dailyBudgetDecimal: "100.00", territory: "Türkiye", countryCodes: ["TR"], platform: "all_platforms", publisherPlatforms: ["instagram"], audienceStrategy: "live targeting", targetingEvidence: "live_targeting_verified" }] }, priority: 100, verification: { metric: "cost_per_qualified_lead", reviewCadence: "daily", rollbackWhen: "evidence_changed" } });
    evidence.ruleSaved = savedRule.persistence === "inserted" && savedRule.auditAppended;
    const budgets = new DrizzleBudgetProposalRepository(tx as never); const lab = new BudgetLabDraftService(budgets, budgets);
    const command: BudgetLabDraftCommand = { seriesRef: "budget.approval_chain", revision: 1, previousProposalHash: "GENESIS", idempotencyKey: "budget.approval_chain.r1", createdAt: proposedAt, scope: { adAccountId: source.adAccountId, campaignId: source.campaignId, contextHash: prepared.contextHash }, scenarios: [{ scenarioRef: "scenario.decrease", kind: "conservative", minorUnitScale: 2, requestedBudgetMinor: 9_000, allocations: [{ ref: "allocation_primary", currentAmountMinor: 10_000, categoryRef: "international", geoRef: "tr", groupRefs: ["international"] }], constraints: [], strategy: { mode: "proportional", weights: [{ ref: "allocation_primary", weight: 1 }] }, pacing: { period: { startDate: now.toISOString().slice(0, 10), endDate: now.toISOString().slice(0, 10), timezone: "Europe/Istanbul" }, asOfAt: proposedAt, amounts: { currency: "TRY", plannedDecimal: "100.00", committedDecimal: "100.00", actualDecimal: "50.00", requestedCommitmentDecimal: "90.00" }, signal: { kind: "business_outcome", metricRef: "spend_pace", sampleSize: 100, coverageBps: 9500, observedThroughAt: proposedAt, retrievedAt: proposedAt, learningPhase: false, lastMaterialChangeAt: new Date(now.getTime() - 86_400_000).toISOString() }, policy: { moneyScale: 2, moneyRounding: "half_even", minimumElapsedBps: 1, conservativeRemainingRateBps: 8000, forecastMinimumDecimal: "0", forecastMaximumDecimal: "140", maximumFreshnessMinutes: 60, minimumCoverageBps: 9000, minimumSampleSize: 100, attributionLagMinutes: 1440, suppressDuringLearning: true, cooldownMinutes: 0, allowProxyAction: true, maximumChangeBps: 1000, maximumChangeAbsoluteDecimal: "15" } }}], outcomeProxy: null };
    const saved = await lab.saveRuleLinkedDraft(source.workspaceId, source.actorId, proposedAt, command, savedRule.draft, "binding.approval_chain.r1");
    evidence.savedProposal = saved.result.persistence === "inserted" && saved.bindingOutcome === "inserted";
    const entity = new DrizzleSliceRuleAllocationEntityBindingRepository(tx as never);
    evidence.allocationBound = (await entity.append({ workspaceId: source.workspaceId, draftHash: savedRule.draft.draftHash, allocationRef: "allocation_primary", idempotencyKey: "entity.approval_chain.r1", boundAt: proposedAt, actorId: source.actorId })).outcome === "inserted";
    const select = new DrizzleSliceRuleScenarioAllocationSelectionRepository(tx as never);
    const proposal = rows(await tx.execute(sql`select proposal_hash from budget_proposal_versions where workspace_id=${source.workspaceId}::uuid and proposal_ref=${saved.result.proposal.proposalRef} limit 2`))[0];
    if (!proposal || typeof proposal.proposal_hash !== "string") throw new Error("saved_proposal_missing");
    evidence.selected = (await select.append({ workspaceId: source.workspaceId, draftHash: savedRule.draft.draftHash, proposalHash: proposal.proposal_hash, scenarioRef: "scenario.decrease", allocationRef: "allocation_primary", idempotencyKey: "selection.approval_chain.r1", selectedAt: proposedAt, actorId: source.actorId })).outcome === "inserted";
    const secondActorId = randomUUID(); const secondActorRef = `actor_second_${secondActorId.replaceAll("-", "").slice(0, 12)}`;
    await tx.insert(schema.users).values({ id: secondActorId, email: `${secondActorId}@approval-chain.invalid` }); await tx.insert(schema.memberships).values({ workspaceId: source.workspaceId, userId: secondActorId, role: "owner" });
    const registry = new DrizzleApprovalPolicyRegistryRepository(tx as never, source.workspaceId, source.workspaceRef);
    const policy = { version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "approval_policy_budget_decrease", revision: 1, autonomyMode: "approval_only" as const, requesterRoles: ["owner"] as const, approverRoles: [{ risk: "K2" as const, roles: ["owner"] as const }], grantConsumerRoles: ["owner"] as const, separationOfDutiesRisks: ["K2"] as const, maximumProtectionEvidenceAgeSeconds: 3600, maximumProposalLifetimeSeconds: 86400, maximumGrantLifetimeSeconds: 300 };
    const draft = createApprovalPolicyDraft({ workspaceRef: source.workspaceRef, policy, applicability: { actionType: "budget_decrease", risk: "K2" }, effectiveFrom: new Date(now.getTime() - 60_000).toISOString(), expiresAt: null, normalizedBy: { actorRef: source.actorRef, role: "owner" } });
    await registry.append(draft); await registry.append(publishApprovalPolicy({ draft, actor: { actorRef: secondActorRef, role: "owner" }, decisionRef: "decision_approval_chain", reasonRef: "reason_approval_chain", publishedAt: proposedAt }));
    const selection = rows(await tx.execute(sql`select id::text as id from slice_rule_scenario_allocation_selections where workspace_id=${source.workspaceId}::uuid and idempotency_key='selection.approval_chain.r1'`))[0]; if (!selection || typeof selection.id !== "string") throw new Error("selection_missing");
    const materializer = new DrizzleSliceRuleBudgetActionUnitMaterializer(tx as never);
    const first = await materializer.materialize({ workspaceId: source.workspaceId, selectionId: selection.id, actorId: source.actorId, idempotencyKey: "unit.approval_chain.r1", proposedAt, expiresAt });
    const replay = await materializer.materialize({ workspaceId: source.workspaceId, selectionId: selection.id, actorId: source.actorId, idempotencyKey: "unit.approval_chain.r1", proposedAt, expiresAt });
    evidence.materialized = first.outcome === "inserted"; evidence.exactReplay = replay.outcome === "unchanged" && replay.actionUnitId === first.actionUnitId;
    const queued = rows(await tx.execute(sql`select unit_payload from action_proposal_units where workspace_id=${source.workspaceId}::uuid and id=${first.actionUnitId}::uuid`))[0]?.unit_payload as { actionAuthority?: unknown; capabilities?: { canExecute?: unknown }; contextHash?: string } | undefined;
    const queue = await new ApprovalQueueReadService(new DrizzleApprovalQueueReadRepository(tx as never, source.workspaceId)).list({ workspaceId: source.workspaceId, limit: 10 });
    evidence.queueRead = queued?.contextHash === prepared.contextHash && queue.items.length === 1 && (queue.items[0]?.unitRef.length ?? 0) > 0;
    evidence.canExecuteFalse = queued?.actionAuthority === "none" && queued?.capabilities?.canExecute === false && queue.authority.canExecute === false;
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally { globalThis.fetch = fetch0; if (fixture) { const residual = rows(await database.execute(sql`select count(*)::int as count from budget_proposal_versions where workspace_id=${fixture.workspaceId}::uuid`))[0]; evidence.rollbackClean = Number(residual?.count) === 0; const purge = new DrizzleWorkspaceTombstonePurgePort(); const tombstones = new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(database as never, purge), { authorize: async (input) => input.approvalRef === "ephemeral-fixture-approved" }, fixture.actorId, 60_000); for (const workspaceId of [fixture.workspaceId, fixture.foreignWorkspaceId]) { const plan = await tombstones.dryRun(workspaceId, new Date().toISOString()); await tombstones.execute({ planRef: plan.planRef, approvalRef: "ephemeral-fixture-approved", now: new Date().toISOString() }); } evidence.cleanup = (await purge.inspect(database as never, fixture.workspaceId)).candidateCount === 0 && (await purge.inspect(database as never, fixture.foreignWorkspaceId)).candidateCount === 0; } await pool.end(); }
if (!(evidence.readyL3 && evidence.ruleSaved && evidence.savedProposal && evidence.allocationBound && evidence.selected && evidence.materialized && evidence.exactReplay && evidence.queueRead && evidence.canExecuteFalse && evidence.rollbackClean && evidence.cleanup) || evidence.metaCalls !== 0 || evidence.executionCalls !== 0) throw new Error(`authentic_approval_chain_failed:${JSON.stringify(evidence)}`);
console.log(JSON.stringify(evidence));
