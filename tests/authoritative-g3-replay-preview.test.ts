import { describe, expect, it } from "vitest";
import { buildAuthoritativeG3ReplayPreview, hasExactAuthoritativeImpact } from
  "@/domain/guidance/authoritative-g3-replay-preview";

const hash = "a".repeat(64);
const impact = (complete = false) => ({ impactHash: "b".repeat(64), operation: "publish", registryHash: hash,
  target: { policyRef: "policy_primary", policyVersion: 1, policyHash: "c".repeat(64), status: "draft" },
  exactBlockers: { currentInboundExceptions: 0, enabledSchedules: 0, nonTerminalActionUnits: 0, activeManualLocks: 0 },
  historicalImpact: { historicalInboundExceptions: 0, directAppliedContexts: 0, directSuppressedContexts: 0,
    directParkedContexts: 0, alreadyInvalidatedContexts: 0, budgetProposals: 0, currentAnalysisTemplates: 0,
    supersededAnalysisTemplates: 0, runAssets: 0, decisionLedgerRecords: 0, terminalActionUnits: 0,
    invalidatedTerminalActionUnits: 0 },
  invalidationPlan: { registryComponents: 0, contextsNeedingInvalidation: 0 }, coverage: { complete,
    manifestVersion: "instruction-policy-dependency-manifest/1.0.0", exactRelational: ["manual_policy_locks"],
    exactContractRef: [], partialOrUnknown: complete ? [] : ["topic_scope"], nonAuthoritativeNotes: [],
    integrity: { unclassifiedJsonbColumns: 0, missingManifestJsonbColumns: 0, brokenPolicyRevisionChains: 0,
      unresolvedExceptionRefs: 0, malformedContextPolicies: 0, inconsistentContextComponents: 0,
      corruptActionLifecycleRows: 0, rowCapExceeded: 0 } }, disposition: "blocked", mutationAllowed: false,
  authority: { canPublish: false, canPause: false, canArchive: false, canApprove: false, canExecute: false,
    canSchedule: false, canCallTool: false, canWriteMeta: false } } as const);

describe("authoritative G3 replay preview domain", () => {
  it("is reviewable but blocked unless the existing impact coverage is exact", () => {
    const result = buildAuthoritativeG3ReplayPreview({ formalizationRef: "formalization_primary", policyRef: "policy_primary",
      contextHash: hash, historicalContextInvalidated: true, sourceBound: true, composedContextHash: "d".repeat(64),
      authoritySnapshot: { schemaVersion: "tenant-authority-snapshot/1.0.0", workspaceId: "11111111-1111-4111-8111-111111111111",
        workspaceRef: "workspace_primary", snapshotRef: "authority_snapshot_primary", snapshotHash: "e".repeat(64),
        repositoryRef: "repository_primary", repositoryRevision: "1", catalogHash: "f".repeat(64), scopeHash: hash,
        verifiedAt: "2026-08-10T10:00:00.000Z", expiresAt: "2026-08-11T10:00:00.000Z" },
      resolution: { state: "RESOLVED", applied: [], suppressed: [], parked: [], conflicts: [] } as never,
      candidateAuthorityBound: true, impact: impact() });
    expect(result).toMatchObject({ disposition: "blocked", blockers: ["impact_coverage_incomplete"],
      replay: { sourceBound: true, historicalContextInvalidated: true }, authority: { canPublish: false,
        canApprove: false, canExecute: false, canWriteMeta: false }, g4: { eligible: false, canExecute: false } });
    expect(hasExactAuthoritativeImpact(impact())).toBe(false);
    expect(hasExactAuthoritativeImpact(impact(true))).toBe(true);
  });

  it("refuses forged source-bound flags", () => {
    expect(() => buildAuthoritativeG3ReplayPreview({ formalizationRef: "formalization_primary", policyRef: "policy_primary",
      contextHash: hash, historicalContextInvalidated: false, sourceBound: false, composedContextHash: hash,
      authoritySnapshot: {} as never, resolution: {} as never, candidateAuthorityBound: false, impact: impact() }))
      .toThrowError(expect.objectContaining({ code: "unverified_source" }));
  });
});
