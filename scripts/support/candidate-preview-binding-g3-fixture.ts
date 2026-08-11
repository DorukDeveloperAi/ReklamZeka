import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { createBusinessOutcomeSignalBatch } from "@/analyses/business-outcome-signal";
import { BusinessOutcomeContextComposer } from "@/application/business-outcome-context-composer";
import { ANALYSIS_TEMPLATE_DEFINITION_VERSION, ANALYSIS_TIMEFRAME_DEFINITION_VERSION, type AnalysisTemplateDefinition, type AnalysisTimeframeDefinition } from "@/application/decision-room-analysis-registry";
import { InstructionPolicyLifecycleService } from "@/application/instruction-policy-lifecycle-service";
import { ProgressiveFormalizationService } from "@/application/progressive-formalization-service";
import { DrizzleBusinessOutcomeEvidenceRepository } from "@/connectors/analyses/business-outcome-evidence-drizzle-repository";
import { DrizzleBusinessOutcomeSignalRepository } from "@/connectors/analyses/business-outcome-signal-drizzle-repository";
import { DrizzleDecisionRoomAnalysisAssetRegistry, DrizzleDecisionRoomAnalysisRuntimeAssetLoader } from "@/connectors/analyses/decision-room-analysis-registry-drizzle";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { DrizzleDecisionRoomRunStore } from "@/connectors/decisions/decision-room-drizzle-adapters";
import { DrizzleProgressiveFormalizationRepository } from "@/connectors/guidance/progressive-formalization-drizzle-repository";
import { DrizzleInstructionPolicyLifecycleRepository } from "@/connectors/policies/instruction-policy-lifecycle-drizzle-repository";
import { parseStrictInstructionPolicy } from "@/domain/policies/instruction-policy-dsl";
import { materializeCurrentEffectiveAnalysisContextSourceFixture } from "./current-effective-analysis-context-source-fixture";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;

function rows(value: unknown): readonly Row[] {
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as readonly Row[] : [];
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

/**
 * Test-only caller-owned transaction fixture for the candidate G3 proof.  It
 * starts with the normal current-source fixture, then uses the normal outcome,
 * context, Decision Room, policy, and formalization writers.  It deliberately
 * does not write authority, outcome, run-binding, or candidate-binding rows
 * directly: a verifier can safely wrap this whole fixture in an outer rollback.
 */
export async function materializeCandidatePreviewBindingG3Fixture(database: Database, now = new Date()) {
  const source = await materializeCurrentEffectiveAnalysisContextSourceFixture(database, now);
  const suffix = source.workspaceId.replaceAll("-", "").slice(0, 12);
  const observedAt = new Date(now.getTime() - 180_000).toISOString();
  const signalAt = new Date(now.getTime() - 150_000).toISOString();
  const windowStart = new Date(now.getTime() - 240_000).toISOString();
  const windowEnd = new Date(now.getTime() - 60_000).toISOString();

  const batch = createBusinessOutcomeSignalBatch({ source: {
    kind: "manual", sourceRef: `outcome_source_${suffix}`, contentHash: hash(`candidate-g3-outcome:${suffix}`), observedAt,
  }, signals: [{ signalRef: `signal_${suffix}`, entityRef: source.campaignRef, occurredAt: signalAt,
    outcome: "qualified_lead", quantity: 1, valueMinor: null, currency: null,
    metaEntityRef: source.campaignRef, mappingStatus: "verified" }] });
  await new DrizzleBusinessOutcomeSignalRepository(database).record({ workspaceId: source.workspaceId,
    actorId: source.actorId, actorRef: source.actorRef, role: "owner", batch, occurredAt: new Date(now.getTime() - 30_000).toISOString() });

  // Compose source-bound context first, then append only materialized L4 evidence.
  const { createDrizzleEffectiveAnalysisContextComposer } = await import("@/server/effective-analysis-context-composer-runtime");
  const base = await createDrizzleEffectiveAnalysisContextComposer({ database }).composeAndSave(source.request);
  const contextRepository = new DrizzleEffectiveCampaignContextRepository(database);
  const outcomeContext = await new BusinessOutcomeContextComposer(new DrizzleBusinessOutcomeEvidenceRepository(database), {
    save: (context) => contextRepository.save(context, { mode: "evidence_bound" }),
  }).composeAndSave({
    baseContext: (() => { const { schemaVersion: _s, contextHash: _h, capabilities: _c, ...input } = base.context; return input; })(),
    windowStart, windowEnd,
  });

  const mirror = rows(await database.execute(sql`
    select connection.id::text as connection_id, account.id::text as account_id
    from meta_connections connection
    join data_sources source on source.workspace_id = connection.workspace_id and source.meta_connection_id = connection.id
    join ad_accounts account on account.workspace_id = source.workspace_id and account.data_source_id = source.id
    where connection.workspace_id = ${source.workspaceId}::uuid and account.external_account_id = ${source.accountRef} limit 2
  `))[0];
  if (!mirror || typeof mirror.connection_id !== "string" || typeof mirror.account_id !== "string") throw new Error("candidate_g3_fixture_mirror_missing");

  const timeframeRef = `timeframe_${suffix}`;
  const templateRef = `template_${suffix}`;
  const timeframe: AnalysisTimeframeDefinition = { version: ANALYSIS_TIMEFRAME_DEFINITION_VERSION, timeframeRef, revision: 1,
    timeframe: { kind: "rolling", days: 1, timezone: "Europe/Istanbul" }, comparison: "none", anchors: {} };
  const registry = new DrizzleDecisionRoomAnalysisAssetRegistry(database, source.workspaceId);
  const persistedTimeframe = await registry.publishTimeframe(timeframe, new Date().toISOString());
  const template: AnalysisTemplateDefinition = { version: ANALYSIS_TEMPLATE_DEFINITION_VERSION, templateRef, revision: 1,
    timeframeRef, timeframeDefinitionHash: persistedTimeframe.definitionHash, contextHash: outcomeContext.context.contextHash,
    requestedPasses: ["campaign"], hierarchy: [{ entityRef: source.campaignRef, entityType: "campaign", parentEntityRef: null }],
    checks: [{ checkKey: `check_${suffix}`, passKey: "campaign", entityRef: source.campaignRef, entityType: "campaign",
      parentEntityRef: null, hierarchyPathRefs: [source.campaignRef], driverEvidenceRefs: [], externalEntityId: source.campaignRef,
      metaConnectionId: mirror.connection_id, adAccountId: mirror.account_id, attributionLabel: "7d_click_1d_view", expectedCurrency: "TRY",
      spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: "1", minimumSample: 1 },
      maxRowsPerQuery: 10, expectedSnapshotRefs: [source.metaChangeSnapshotRef] }],
    cadence: { profile: { version: "decision-cadence/1.0.0", settleHours: 0, minimumObservationHours: 0,
      minimumLearningHours: 0, cooldownHours: 0, repeatSuppressionHours: 0, frequencyWindowHours: 24,
      maxDecisionsPerWindow: 3, maxActionsPerWindow: 1, maximumHistoryEntries: 20, minimumEvidenceCount: 1,
      minimumEvidenceScore: 0.5 }, observationStartedAt: source.occurredAt, lastMaterialChangeAt: null,
      learning: { state: "not_applicable", startedAt: null }, lastDecision: null, recentDecisions: [],
      requestedDisposition: "test", emergencyGuardrail: { breached: false, evidenceRef: null } } };
  await registry.publishTemplate({ accountRef: source.accountRef, campaignRef: source.campaignRef, definition: template,
    publishedAt: new Date().toISOString() });
  const runStore = new DrizzleDecisionRoomRunStore(database, source.workspaceId);
  const claimed = await runStore.claim({ idempotencyKey: `candidate_g3_${hash(suffix).slice(0, 32)}`,
    scopeKey: hash(`candidate-g3-scope:${suffix}`), triggerKind: "manual", scheduleRef: null, scheduleDefinitionHash: null,
    triggerRef: `fixture_${suffix}`, accountRef: source.accountRef, campaignRef: source.campaignRef, timeframeRef, templateRef,
    now: new Date().toISOString(), leaseUntil: new Date(now.getTime() + 300_000).toISOString() });
  if (claimed.status !== "claimed") throw new Error("candidate_g3_fixture_run_not_claimed");
  await new DrizzleDecisionRoomAnalysisRuntimeAssetLoader(database, source.workspaceId).loadExact({ runRef: claimed.runRef,
    workspaceRef: source.workspaceRef, accountRef: source.accountRef, campaignRef: source.campaignRef, timeframeRef, templateRef,
    triggerKind: "manual" });

  const principal = { actor: { userId: source.actorId }, workspaceId: source.workspaceId,
    workspaceRef: source.workspaceRef, readerRef: source.actorRef } as const;
  const memberships = [{ workspaceId: source.workspaceId, userId: source.actorId, role: "owner" as const }];
  const policyRef = `policy_candidate_${suffix}`;
  const rawText = "Protect qualified lead quality in this isolated candidate preview.";
  const policy = parseStrictInstructionPolicy({ dslVersion: "strict-instruction-policy/1.0.0", workspaceRef: source.workspaceRef,
    policyRef, policyVersion: 1, previousVersionHash: null, policyType: "preference", owner: { actorRef: source.actorRef, role: "owner" },
    status: "draft", reasonCode: "fixture_candidate", priority: 100, effectiveDates: { from: source.occurredAt, until: null },
    scope: { global: false, accountGroupRefs: [], accountRefs: [source.accountRef], objectiveRefs: [], internalCategoryRefs: [], entities: [], topicRefs: [] },
    source: { rawProvenanceRef: `provenance_${suffix}`, rawTextHash: hash(rawText), promotedFromGuidanceRefs: ["card_current"] },
    clause: { kind: "preference", subjectRef: `subject_${suffix}`, preferredRefs: ["card_current"], weightBasisPoints: 6000 } });
  const lifecycle = new InstructionPolicyLifecycleService(new DrizzleInstructionPolicyLifecycleRepository(database), memberships);
  const initial = await lifecycle.inspect(principal);
  const drafted = await lifecycle.mutate(principal, { operation: "create_draft", expectedRegistryHash: initial.registryHash, rawText, policy });
  const draftPolicy = drafted.state.current.find((entry) => entry.policy.policyRef === policyRef)?.policy;
  if (!draftPolicy) throw new Error("candidate_g3_fixture_draft_missing");

  const formalization = new ProgressiveFormalizationService(new DrizzleProgressiveFormalizationRepository(database), memberships);
  let state = await formalization.inspect(principal);
  const g0 = await formalization.mutate(principal, { operation: "capture_g0", expectedRegistryHash: state.registryHash, rawProvenanceRef: "source_current" });
  const formalizationRef = g0.state.flows[0]?.formalizationRef;
  if (!formalizationRef) throw new Error("candidate_g3_fixture_g0_missing");
  state = await formalization.inspect(principal);
  const g0Head = state.flows.find((flow) => flow.formalizationRef === formalizationRef)?.headHash;
  if (!g0Head) throw new Error("candidate_g3_fixture_g0_head_missing");
  await formalization.mutate(principal, { operation: "scope_g1", expectedRegistryHash: state.registryHash, formalizationRef,
    expectedHeadHash: g0Head, guidanceCardRefs: ["card_current"] });
  state = await formalization.inspect(principal);
  const g1Head = state.flows.find((flow) => flow.formalizationRef === formalizationRef)?.headHash;
  if (!g1Head) throw new Error("candidate_g3_fixture_g1_head_missing");
  await formalization.mutate(principal, { operation: "review_g2", expectedRegistryHash: state.registryHash, formalizationRef,
    expectedHeadHash: g1Head, guidanceSetRef: "guidance_set_current",
    ownerConfirmation: { confirmed: true, confirmationRef: `confirmation_${suffix}` } });
  state = await formalization.inspect(principal);
  const g2Head = state.flows.find((flow) => flow.formalizationRef === formalizationRef)?.headHash;
  if (!g2Head) throw new Error("candidate_g3_fixture_g2_head_missing");

  return Object.freeze({ ...source, formalizationRef, g2HeadHash: g2Head, policyRef, policyVersion: draftPolicy.policyVersion,
    policyHash: draftPolicy.canonicalHash, guidanceSetRef: source.reviewedGuidanceSet.setRef,
    guidanceSetVersion: source.reviewedGuidanceSet.setVersion, guidanceSetHash: source.reviewedGuidanceSet.setHash,
    authoritySnapshotRef: source.authoritySnapshot.snapshotRef, authoritySnapshotHash: source.authoritySnapshot.snapshotHash,
    authorityTier: "platform_legal_tenant_safety" as const,
    decision: Object.freeze({ decisionKey: `decision_${suffix}`, positionKey: `position_${suffix}` }),
    contextHash: outcomeContext.context.contextHash, outcomeEvidenceRef: outcomeContext.context.history.outcomeEvidence?.[0]?.evidenceRef ?? null,
    runRef: claimed.runRef, timeframeRef, templateRef });
}
