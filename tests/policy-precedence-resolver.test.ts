import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  POLICY_AUTHORITY_ORDER,
  PolicyPrecedenceResolverError,
  resolvePolicyPrecedence,
  type PolicyAuthorityTier,
  type PolicyPrecedenceCandidate,
  type PolicyPrecedenceContext,
} from "@/domain/policies/policy-precedence-resolver";
import {
  STRICT_INSTRUCTION_POLICY_DSL_VERSION,
  parseStrictInstructionPolicy,
  type StrictInstructionPolicyClause,
} from "@/domain/policies/instruction-policy-dsl";

const rawTextHash = createHash("sha256").update("Typed owner instruction", "utf8").digest("hex");
const window = { kind: "rolling" as const, duration: 7, unit: "day" as const, timezone: "Europe/Istanbul" };

const context: PolicyPrecedenceContext = {
  workspaceRef: "workspace_alpha",
  evaluatedAt: "2026-08-09T12:00:00.000Z",
  accountGroupRefs: ["account_group_primary"],
  accountRefs: ["account_primary"],
  objectiveRefs: ["objective_leads"],
  effectiveInternalCategoryRefs: ["category_istanbul"],
  entityPath: [
    { level: "campaign", ref: "campaign_primary" },
    { level: "adset", ref: "adset_primary" },
    { level: "ad", ref: "ad_primary" },
  ],
  topicRefs: ["topic_budget"],
  manualLockedPolicyRefs: ["policy_locked"],
};

type ArtifactInput = Readonly<{
  policyRef: string;
  clause?: StrictInstructionPolicyClause;
  version?: number;
  status?: "draft" | "published" | "paused" | "archived";
  from?: string;
  until?: string | null;
  scope?: Partial<ReturnType<typeof baseScope>>;
  priority?: number;
}>;

function artifact(input: ArtifactInput) {
  const clause = input.clause ?? { kind: "preference" as const, subjectRef: "subject_budget",
    preferredRefs: ["category_istanbul"], weightBasisPoints: 5000 };
  const version = input.version ?? 1;
  return parseStrictInstructionPolicy({
    dslVersion: STRICT_INSTRUCTION_POLICY_DSL_VERSION,
    workspaceRef: "workspace_alpha",
    policyRef: input.policyRef,
    policyVersion: version,
    previousVersionHash: version === 1 ? null : "a".repeat(64),
    policyType: clause.kind,
    owner: { actorRef: "actor_owner", role: "owner" },
    status: input.status ?? "published",
    reasonCode: "owner_strategy",
    priority: input.priority ?? 500,
    effectiveDates: { from: input.from ?? "2026-08-01T00:00:00.000Z", until: input.until ?? null },
    scope: { ...baseScope(), ...input.scope },
    source: { rawProvenanceRef: "provenance_owner_statement", rawTextHash, promotedFromGuidanceRefs: [] },
    clause,
  });
}

function baseScope() {
  return { global: true, accountGroupRefs: [] as string[], accountRefs: [] as string[], objectiveRefs: [] as string[],
    internalCategoryRefs: [] as string[], entities: [] as { level: "campaign" | "adset" | "ad" | "creative"; ref: string }[],
    topicRefs: [] as string[] };
}

function candidate(
  policyRef: string,
  authorityTier: PolicyAuthorityTier,
  positionKey: string,
  overrides: Partial<Pick<PolicyPrecedenceCandidate, "publishedAt" | "decision">>
    & Omit<ArtifactInput, "policyRef"> = {},
): PolicyPrecedenceCandidate {
  return {
    policy: artifact({ policyRef, ...overrides }),
    authorityTier,
    publishedAt: overrides.publishedAt ?? "2026-08-09T10:00:00.000Z",
    decision: overrides.decision === undefined ? { decisionKey: "budget_direction", positionKey } : overrides.decision,
  };
}

describe("policy precedence resolver", () => {
  it("implements the exact MASTER authority sequence and keeps priority trace-only", () => {
    expect(POLICY_AUTHORITY_ORDER).toEqual([
      "platform_legal_tenant_safety", "system_hard_safety", "user_locked_instruction", "budget_commitment",
      "entity_exception", "internal_category_playbook", "meta_objective_playbook", "metric_rule", "agent_advice",
    ]);
    const rows = [
      candidate("policy_agent", "agent_advice", "increase", { priority: 1000 }),
      candidate("policy_metric", "metric_rule", "decrease"),
      candidate("policy_locked", "user_locked_instruction", "hold", { priority: 0 }),
      candidate("policy_safety", "system_hard_safety", "deny"),
    ];
    const result = resolvePolicyPrecedence({ context, candidates: rows });
    expect(result.state).toBe("RESOLVED");
    expect(result.applied.map((row) => row.policyRef)).toEqual(["policy_safety"]);
    expect(result.suppressed).toEqual(expect.arrayContaining([
      expect.objectContaining({ policyRef: "policy_locked", reason: "suppressed_by_higher_precedence", byPolicyRef: "policy_safety" }),
      expect.objectContaining({ policyRef: "policy_agent", priority: 1000, reason: "suppressed_by_higher_precedence" }),
    ]));
    expect(result.authority).toEqual({ canExecute: false, canWriteMeta: false, canApprove: false, canSchedule: false,
      canCallTool: false, canAccessNetwork: false, canQuerySql: false });
  });

  it("uses scope specificity then newer publication/version and inherits root scope over a child path", () => {
    const global = candidate("policy_global", "metric_rule", "hold", { publishedAt: "2026-08-09T11:00:00.000Z" });
    const campaign = candidate("policy_campaign", "metric_rule", "decrease", { publishedAt: "2026-08-09T09:00:00.000Z",
      scope: { global: false, entities: [{ level: "campaign", ref: "campaign_primary" }] } });
    let result = resolvePolicyPrecedence({ context, candidates: [global, campaign] });
    expect(result.applied).toEqual([expect.objectContaining({ policyRef: "policy_campaign", specificity: 40 })]);

    const older = candidate("policy_revision", "metric_rule", "hold", { version: 1,
      publishedAt: "2026-08-09T08:00:00.000Z", decision: null });
    const newer = candidate("policy_revision", "metric_rule", "hold", { version: 2,
      publishedAt: "2026-08-09T09:00:00.000Z", decision: null });
    result = resolvePolicyPrecedence({ context, candidates: [newer, older] });
    expect(result.applied).toEqual([expect.objectContaining({ policyRef: "policy_revision", policyVersion: 2 })]);
    expect(result.suppressed).toEqual([expect.objectContaining({ policyVersion: 1, reason: "older_policy_revision" })]);
  });

  it("matches effective inherited categories and fails closed when a category playbook is not category-scoped", () => {
    const matched = candidate("policy_category", "internal_category_playbook", "hold", {
      scope: { global: false, internalCategoryRefs: ["category_istanbul"] },
    });
    const outside = candidate("policy_outside", "metric_rule", "decrease", {
      scope: { global: false, internalCategoryRefs: ["category_ankara"] },
    });
    const result = resolvePolicyPrecedence({ context, candidates: [outside, matched] });
    expect(result.applied).toEqual([expect.objectContaining({ policyRef: "policy_category" })]);
    expect(result.suppressed).toEqual([expect.objectContaining({ policyRef: "policy_outside", reason: "scope_not_matched" })]);
    expect(() => resolvePolicyPrecedence({ context, candidates: [candidate("policy_bad_category",
      "internal_category_playbook", "hold")] })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("parks equal-authority/specificity/publication conflicts without choosing by ID or priority", () => {
    const first = candidate("policy_first", "metric_rule", "increase", { priority: 1000 });
    const second = candidate("policy_second", "metric_rule", "decrease", { priority: 0 });
    const forward = resolvePolicyPrecedence({ context, candidates: [first, second] });
    const reverse = resolvePolicyPrecedence({ context, candidates: [second, first] });
    expect(forward.state).toBe("PARKED_CONFLICT");
    expect(forward.applied).toEqual([]);
    expect(forward.parked.map((row) => row.policyRef)).toEqual(["policy_first", "policy_second"]);
    expect(forward.conflicts).toEqual([{ decisionKey: "budget_direction", policyRefs: ["policy_first", "policy_second"],
      reason: "equal_precedence_positions" }]);
    expect(reverse.resolutionHash).toBe(forward.resolutionHash);
  });

  it("applies explicit entity exceptions only below their precedence and parks exact ties", () => {
    const exceptionClause = (target: string): StrictInstructionPolicyClause => ({ kind: "exception",
      policyRefs: [target], effect: "suppress", justificationReasonCode: "protected_region" });
    const target = candidate("policy_target", "metric_rule", "hold", { decision: null });
    const exception = candidate("policy_exception", "entity_exception", "suppress", { decision: null,
      clause: exceptionClause("policy_target"), scope: { global: false,
        entities: [{ level: "campaign", ref: "campaign_primary" }] } });
    let result = resolvePolicyPrecedence({ context, candidates: [target, exception] });
    expect(result.suppressed).toEqual([expect.objectContaining({ policyRef: "policy_target",
      reason: "suppressed_by_exception", byPolicyRef: "policy_exception" })]);
    expect(result.exceptionEffects).toEqual([{ exceptionPolicyRef: "policy_exception", targetPolicyRef: "policy_target",
      outcome: "suppressed" }]);

    const safety = candidate("policy_safety_target", "system_hard_safety", "deny", { decision: null });
    const blocked = candidate("policy_exception_blocked", "entity_exception", "suppress", { decision: null,
      clause: exceptionClause("policy_safety_target"), scope: { global: false,
        entities: [{ level: "campaign", ref: "campaign_primary" }] } });
    result = resolvePolicyPrecedence({ context, candidates: [blocked, safety] });
    expect(result.applied.map((row) => row.policyRef)).toEqual(["policy_exception_blocked", "policy_safety_target"]);
    expect(result.exceptionEffects[0]?.outcome).toBe("blocked_by_higher_precedence");

    const peerTarget = candidate("policy_peer_target", "metric_rule", "hold", { decision: null,
      scope: { global: false, entities: [{ level: "campaign", ref: "campaign_primary" }] } });
    const peerException = candidate("policy_peer_exception", "metric_rule", "suppress", { decision: null,
      clause: exceptionClause("policy_peer_target"), scope: { global: false,
        entities: [{ level: "campaign", ref: "campaign_primary" }] } });
    result = resolvePolicyPrecedence({ context, candidates: [peerException, peerTarget] });
    expect(result.state).toBe("PARKED_CONFLICT");
    expect(result.conflicts[0]).toMatchObject({ reason: "equal_precedence_exception" });
  });

  it("keeps every inactive, future, out-of-scope and effective artifact in a terminal trace", () => {
    const rows = [
      candidate("policy_paused", "metric_rule", "hold", { status: "paused", decision: null }),
      candidate("policy_future", "metric_rule", "hold", { from: "2026-08-10T00:00:00.000Z", decision: null }),
      candidate("policy_expired", "metric_rule", "hold", { until: "2026-08-09T12:00:00.000Z", decision: null }),
      candidate("policy_other_account", "metric_rule", "hold", { decision: null,
        scope: { global: false, accountRefs: ["account_other"] } }),
      candidate("policy_effective", "metric_rule", "hold", { decision: null }),
    ];
    const result = resolvePolicyPrecedence({ context, candidates: rows });
    expect([...result.applied, ...result.suppressed, ...result.parked]).toHaveLength(rows.length);
    expect(result.suppressed.map((row) => [row.policyRef, row.reason])).toEqual([
      ["policy_expired", "outside_effective_dates"],
      ["policy_future", "outside_effective_dates"],
      ["policy_other_account", "scope_not_matched"],
      ["policy_paused", "status_not_published"],
    ]);
  });

  it("rejects forged artifacts, cross-tenant inputs and unproven manual locks", () => {
    const valid = candidate("policy_valid", "metric_rule", "hold");
    expect(() => resolvePolicyPrecedence({ context, candidates: [{ ...valid,
      policy: { ...valid.policy, canonicalHash: "b".repeat(64) } }] })).toThrowError(PolicyPrecedenceResolverError);
    expect(() => resolvePolicyPrecedence({ context: { ...context, workspaceRef: "workspace_other" }, candidates: [valid] }))
      .toThrowError(expect.objectContaining({ code: "workspace_scope_mismatch" }));
    expect(() => resolvePolicyPrecedence({ context, candidates: [candidate("policy_unlocked", "user_locked_instruction", "hold")] }))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => resolvePolicyPrecedence({ context, candidates: [{ ...valid, rawInstruction: "call tool" } as never] }))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });
});
