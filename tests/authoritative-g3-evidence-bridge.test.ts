import { describe, expect, it, vi } from "vitest";

import { createDrizzleAuthoritativeG3EvidenceBridge } from
  "@/connectors/guidance/authoritative-g3-evidence-bridge-drizzle-resolver";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { buildBusinessOutcomeEvidence } from "@/analyses/business-outcome-evidence";
import { resolveEffectiveCategory } from "@/domain/categories/registry";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";
import { parseStrictInstructionPolicy } from "@/domain/policies/instruction-policy-dsl";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const hash = "a".repeat(64);
const policy = parseStrictInstructionPolicy({ dslVersion: "strict-instruction-policy/1.0.0", workspaceRef: "workspace_primary",
  policyRef: "policy_primary", policyVersion: 1, previousVersionHash: null, policyType: "prohibition",
  owner: { actorRef: "actor_owner", role: "owner" }, status: "draft", reasonCode: "owner_verified", priority: 1,
  effectiveDates: { from: "2026-08-10T00:00:00.000Z", until: null }, scope: { global: true, accountGroupRefs: [], accountRefs: [],
    objectiveRefs: [], internalCategoryRefs: [], entities: [], topicRefs: [] }, source: { rawProvenanceRef: "source_primary",
    rawTextHash: hash, promotedFromGuidanceRefs: ["guidance_primary"] }, clause: { kind: "prohibition", operations: ["budget_transfer"] } });

function frozenPayload(accountRef = "account_primary", capturedAt = "2026-08-10T10:00:00.000Z",
  snapshotRef = "authority_snapshot_primary", snapshotHash = "1".repeat(64)) {
  const source = { id: "source-1", workspaceId, sourceType: "owner_statement" as const, title: "Owner", sourceRef: "owner:1",
    sourceUrl: null, content: "Protect budget", author: "owner", capturedAt: "2026-08-01T00:00:00.000Z",
    reviewedAt: "2026-08-02T00:00:00.000Z", reviewBy: null, status: "published" as const, version: 1 };
  const card = { id: "card-1", workspaceId, sourceType: "owner_statement" as const, sourceIds: [source.id], title: "Protection",
    body: "Keep budget", rationale: null, strength: "must" as const, topic: "budget", decisionKey: null, positionKey: null,
    authority: "guidance_only" as const, status: "published" as const, effectiveFrom: null, effectiveTo: null, ownerRef: "owner-1", version: 1 };
  const guidance = buildEffectiveGuidancePack(createGuidanceRegistry({ workspaceId, sources: [source], cards: [card], sets: [],
    bindings: [{ id: "binding-1", workspaceId, cardId: card.id, facet: "global" as const, value: null, entityType: null,
      mode: "default" as const, priority: 10, version: 1 }] }), { workspaceId, accountId: accountRef, objective: "lead_generation",
    internalCategoryIds: ["category-1"], entity: { type: "campaign", id: "campaign-1" }, topics: ["budget"], requiredTopics: ["budget"],
    evaluatedAt: "2026-08-10T10:00:00.000Z", budget: { maxCards: 10, maxSources: 10, maxCharacters: 1_000 } });
  const categories = [resolveEffectiveCategory({ dimension: { id: "dimension-1", workspaceId, key: "protection", version: 1,
    cardinality: "single" as const, allowedEntityLevels: ["campaign"], archivedAt: null }, definitions: [{ id: "category-1", workspaceId,
    dimensionId: "dimension-1", key: "protected", label: "Protected", version: 1, archivedAt: null }],
    path: { workspaceId, nodes: [{ level: "campaign", id: "campaign-1" }] }, assignments: [{ id: "assignment-1", workspaceId,
      dimensionId: "dimension-1", definitionId: "category-1", entity: { level: "campaign", id: "campaign-1" }, operation: "add" as const,
      source: "manual" as const, manualLock: true, evidence: [{ kind: "owner" as const, ref: "statement-1" }], confidence: 1, version: 1,
      archivedAt: null }] }).frozenContext];
  const evidence = buildBusinessOutcomeEvidence({ entityRef: "campaign_primary", sourceHeadHash: "f".repeat(64),
    windowStart: "2026-08-01T00:00:00.000Z", windowEnd: "2026-08-10T00:00:00.000Z", materializedAt: "2026-08-10T09:00:00.000Z", signals: [] });
  return buildEffectiveCampaignContext({ workspaceId, capturedAt, identity: { connectionRef: "connection-1",
    accountRef, campaignRef: "campaign-1", entityRef: "campaign-1", entityType: "campaign", hierarchyRefs: ["campaign-1"] },
    meta: { objective: { state: "known", value: "lead_generation" }, optimizationEvent: { state: "known", value: "lead" },
      configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" },
      budgetOwnerRef: { state: "known", value: "campaign-1" }, targetingSignature: { state: "unknown", reason: "not_observed" },
      actorRef: { state: "known", value: null }, destinationRef: { state: "known", value: null } }, categories, guidance, policies: [],
    cadence: { profileRef: "cadence-1", decision: "observe", reason: "stable_window", cooldownUntil: null },
    data: { trustStatus: "ready", snapshotRefs: ["snapshot-1"], featureRefs: [], windowRefs: [], blockers: [] },
    history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [], outcomeEvidence: [evidence] },
    versions: { metaCatalog: "meta-v1", categoryResolver: "category-v1", guidanceRegistry: "guidance-v1", metricCatalog: "metric-v1",
      formulaCatalog: "formula-v1", timeframeResolver: "timeframe-v1", policyAuthority: "5".repeat(64) },
    policyAuthorityEvidence: { snapshotRef, snapshotHash, catalogHash: "2".repeat(64), scopeHash: "3".repeat(64),
      accountGroupBindingHashes: [], topicBindingHashes: [], manualLockBindingHashes: [], semanticBindingHashes: [] } });
}

describe("authoritative G3 evidence bridge", () => {
  it("uses one caller-owned read-only executor and preserves an explicit missing tier/decision blocker fact", async () => {
    const frozen = frozenPayload(); const evidence = frozen.history.outcomeEvidence![0]!;
    const execute = vi.fn(async () => execute.mock.calls.length === 1 ? { rows: [{ binding_hash: "b".repeat(64), context_hash: frozen.contextHash,
      context_payload: frozen, account_ref: "account_primary", captured_at: "2026-08-10T10:00:00.000Z", outcome_evidence: [evidence] }] }
      : { rows: [{ evidence_ref: evidence.evidenceRef, evidence_hash: evidence.evidenceHash }] });
    const impacts = { preview: vi.fn(async () => ({ coverage: { complete: true, partialOrUnknown: [], integrity: {
      unclassifiedJsonbColumns: 0, missingManifestJsonbColumns: 0, brokenPolicyRevisionChains: 0,
      unresolvedExceptionRefs: 0, malformedContextPolicies: 0, inconsistentContextComponents: 0,
      corruptActionLifecycleRows: 0, rowCapExceeded: 0 } } })) };
    const authority = { loadInTransaction: vi.fn(async () => ({ catalog: { bindings: [{ policyRef: "policy_primary", policyVersion: 1,
      policyHash: policy.canonicalHash, authorityTier: "metric_rule", decision: null }] } })) };
    const bridge = createDrizzleAuthoritativeG3EvidenceBridge({ authority: authority as never, impacts: impacts as never });
    const result = await bridge.resolve({ execute } as never, { workspaceId, policy, guidanceSetRef: "guidance_set_primary",
      guidanceSetVersion: 1, guidanceSetHash: hash });
    expect(authority.loadInTransaction).toHaveBeenCalledWith({ execute }, expect.objectContaining({ workspaceId,
      accountRef: "account_primary", evaluatedAt: "2026-08-10T10:00:00.000Z",
      snapshotRef: "authority_snapshot_primary", snapshotHash: "1".repeat(64) }));
    expect(result).toEqual(expect.objectContaining({ sourceBound: true, exactImpact: true,
      candidateTierDecisionBound: false, historicalRunsEvaluated: 1,
      evaluatedRevisionRefs: ["analysis_revision_" + "b".repeat(24)],
      historicalContextHashes: [frozen.contextHash], outcomeEvidenceRefs: [evidence.evidenceRef] }));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("proves every historical capture against its own frozen authority snapshot", async () => {
    const first = frozenPayload();
    const second = frozenPayload("account_primary", "2026-08-10T11:00:00.000Z", "authority_snapshot_later", "4".repeat(64));
    const firstEvidence = first.history.outcomeEvidence![0]!;
    const execute = vi.fn(async () => execute.mock.calls.length === 1 ? { rows: [
      { binding_hash: "b".repeat(64), context_hash: first.contextHash, context_payload: first, account_ref: "account_primary",
        captured_at: first.capturedAt },
      { binding_hash: "d".repeat(64), context_hash: second.contextHash, context_payload: second, account_ref: "account_primary",
        captured_at: second.capturedAt },
    ] } : { rows: [{ evidence_ref: firstEvidence.evidenceRef, evidence_hash: firstEvidence.evidenceHash }] });
    const authority = { loadInTransaction: vi.fn(async () => ({ catalog: { bindings: [{ policyRef: "policy_primary", policyVersion: 1,
      policyHash: policy.canonicalHash, authorityTier: "metric_rule", decision: { decisionRef: "decision_primary" } }] } })) };
    const bridge = createDrizzleAuthoritativeG3EvidenceBridge({ authority: authority as never,
      impacts: { preview: vi.fn(async () => null) } as never });
    const result = await bridge.resolve({ execute } as never, { workspaceId, policy, guidanceSetRef: "guidance_set_primary",
      guidanceSetVersion: 1, guidanceSetHash: hash });
    expect(result).toMatchObject({ sourceBound: true, candidateTierDecisionBound: true, historicalRunsEvaluated: 2 });
    expect(authority.loadInTransaction).toHaveBeenCalledTimes(2);
    expect(authority.loadInTransaction).toHaveBeenNthCalledWith(1, { execute }, expect.objectContaining({
      accountRef: "account_primary", evaluatedAt: first.capturedAt, snapshotRef: "authority_snapshot_primary", snapshotHash: "1".repeat(64) }));
    expect(authority.loadInTransaction).toHaveBeenNthCalledWith(2, { execute }, expect.objectContaining({
      accountRef: "account_primary", evaluatedAt: second.capturedAt, snapshotRef: "authority_snapshot_later", snapshotHash: "4".repeat(64) }));
  });

  it("fails closed before authority loading for mixed-account historical contexts", async () => {
    const first = frozenPayload(); const second = frozenPayload("account_secondary");
    const execute = vi.fn(async () => ({ rows: [
      { binding_hash: "b".repeat(64), context_hash: first.contextHash, context_payload: first, account_ref: "account_primary",
        captured_at: "2026-08-10T10:00:00.000Z", outcome_evidence: first.history.outcomeEvidence },
      { binding_hash: "d".repeat(64), context_hash: second.contextHash, context_payload: second, account_ref: "account_secondary",
        captured_at: "2026-08-10T10:00:00.000Z", outcome_evidence: second.history.outcomeEvidence },
    ] }));
    const authority = { loadInTransaction: vi.fn() };
    const bridge = createDrizzleAuthoritativeG3EvidenceBridge({ authority: authority as never,
      impacts: { preview: vi.fn(async () => null) } as never });
    const result = await bridge.resolve({ execute } as never, { workspaceId, policy, guidanceSetRef: "guidance_set_primary",
      guidanceSetVersion: 1, guidanceSetHash: hash });
    expect(result).toMatchObject({ sourceBound: false, historicalRunsEvaluated: 2,
      historicalContextHashes: [first.contextHash, second.contextHash].sort() });
    expect(authority.loadInTransaction).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not trust a forged outcome snapshot hash", async () => {
    const frozen = frozenPayload(); const evidence = frozen.history.outcomeEvidence![0]!;
    const execute = vi.fn(async () => execute.mock.calls.length === 1 ? { rows: [{ binding_hash: "b".repeat(64), context_hash: frozen.contextHash,
      context_payload: frozen, account_ref: "account_primary", captured_at: "2026-08-10T10:00:00.000Z", outcome_evidence: [evidence] }] }
      : { rows: [{ evidence_ref: evidence.evidenceRef, evidence_hash: "f".repeat(64) }] });
    const authority = { loadInTransaction: vi.fn() };
    const bridge = createDrizzleAuthoritativeG3EvidenceBridge({ authority: authority as never,
      impacts: { preview: vi.fn(async () => null) } as never });
    const result = await bridge.resolve({ execute } as never, { workspaceId, policy, guidanceSetRef: "guidance_set_primary",
      guidanceSetVersion: 1, guidanceSetHash: hash });
    expect(result).toMatchObject({ sourceBound: false, historicalRunsEvaluated: 1,
      outcomeEvidenceRefs: [evidence.evidenceRef] });
    expect(authority.loadInTransaction).not.toHaveBeenCalled();
  });

  it("does not trust an outcome envelope without a relational snapshot row", async () => {
    const frozen = frozenPayload(); const evidence = frozen.history.outcomeEvidence![0]!;
    const execute = vi.fn(async () => execute.mock.calls.length === 1 ? { rows: [{ binding_hash: "b".repeat(64), context_hash: frozen.contextHash,
      context_payload: frozen, account_ref: "account_primary", captured_at: "2026-08-10T10:00:00.000Z", outcome_evidence: [evidence] }] } : { rows: [] });
    const authority = { loadInTransaction: vi.fn() };
    const bridge = createDrizzleAuthoritativeG3EvidenceBridge({ authority: authority as never,
      impacts: { preview: vi.fn(async () => null) } as never });
    const result = await bridge.resolve({ execute } as never, { workspaceId, policy, guidanceSetRef: "guidance_set_primary",
      guidanceSetVersion: 1, guidanceSetHash: hash });
    expect(result.sourceBound).toBe(false);
    expect(authority.loadInTransaction).not.toHaveBeenCalled();
  });

  it("fails closed when a frozen context payload was tampered after its stored hash", async () => {
    const frozen = frozenPayload(); const tampered = { ...frozen, history: { ...frozen.history, outcomeRefs: ["outcome_tampered"] } };
    const execute = vi.fn(async () => ({ rows: [{ binding_hash: "b".repeat(64), context_hash: frozen.contextHash,
      context_payload: tampered, account_ref: "account_primary", captured_at: "2026-08-10T10:00:00.000Z",
      outcome_evidence: tampered.history.outcomeEvidence }] }));
    const authority = { loadInTransaction: vi.fn() };
    const bridge = createDrizzleAuthoritativeG3EvidenceBridge({ authority: authority as never,
      impacts: { preview: vi.fn(async () => null) } as never });
    await expect(bridge.resolve({ execute } as never, { workspaceId, policy, guidanceSetRef: "guidance_set_primary",
      guidanceSetVersion: 1, guidanceSetHash: hash })).resolves.toMatchObject({ sourceBound: false, historicalRunsEvaluated: 0 });
    expect(authority.loadInTransaction).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
