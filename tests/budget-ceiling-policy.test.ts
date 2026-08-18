import { describe, expect, it } from "vitest";
import { createBudgetCeilingPolicy, resolveBudgetCeilingPolicies, type BudgetCeilingLayer, type BudgetCeilingPolicy } from "@/domain/budget/budget-ceiling-policy";

const layers: readonly BudgetCeilingLayer[] = ["market", "organization_campaign", "geo_targeting_platform", "campaign_ad_set"];
const at = "2026-08-18T08:00:00.000Z", until = "2026-09-18T08:00:00.000Z";
const draft = (policy: BudgetCeilingPolicy) => {
  const { schemaVersion: _schemaVersion, authority: _authority, policyHash: _policyHash, ...value } = policy;
  return value;
};
const policies = (): readonly BudgetCeilingPolicy[] => {
  const result: BudgetCeilingPolicy[] = [];
  layers.forEach((layer, index) => result.push(createBudgetCeilingPolicy({
    workspaceRef: "workspace_1234567890abcdef", limitRef: `limit_${layer}`, revision: 1, previousPolicyHash: null,
    poolRef: `budget_pool_${layer}`, parentLimitRef: index === 0 ? null : `limit_${layers[index - 1]}`,
    layer, targetScopeRef: "ad_set_public_123", market: "yerli", currency: "TRY",
    ceilingDecimal: String(1000 - index * 100), effectiveFrom: at, effectiveTo: until,
    state: "published", publishedByActorRef: "user_operator", publishedAt: "2026-08-18T07:00:00.000Z",
  })));
  return result;
};
const input = (overrides: Record<string, unknown> = {}) => ({
  workspaceRef: "workspace_1234567890abcdef", targetScopeRef: "ad_set_public_123", market: "yerli" as const,
  currency: "TRY", evaluatedAt: "2026-08-18T09:00:00.000Z",
  guideBudgetRefs: layers.map((scopeKind) => ({ scopeKind, limitRef: `limit_${scopeKind}` })), policies: policies(), ...overrides,
});

describe("published budget ceiling policy", () => {
  it("requires the exact four-layer target-bound chain and returns the strictest ceiling", () => {
    const result = resolveBudgetCeilingPolicies(input());
    expect(result).toMatchObject({ status: "ready", effectiveParentCeilingDecimal: "700", holdReasons: [], authority: { canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(result.policyHashes).toHaveLength(4);
  });

  it("fails closed on missing, disabled, target, currency, parent, and time drift", () => {
    const base = policies();
    expect(resolveBudgetCeilingPolicies(input({ guideBudgetRefs: input().guideBudgetRefs.slice(0, 3) })).holdReasons).toContain("ceiling_layers_incomplete");
    const disabled = createBudgetCeilingPolicy({ ...draft(base[3]!), revision: 2, previousPolicyHash: base[3]!.policyHash, state: "disabled", publishedAt: "2026-08-18T07:30:00.000Z" });
    expect(resolveBudgetCeilingPolicies(input({ policies: [...base, disabled] })).holdReasons).toContain(`ceiling_policy_disabled:${base[3]!.limitRef}`);
    expect(resolveBudgetCeilingPolicies(input({ targetScopeRef: "ad_set_other" })).status).toBe("held");
    expect(resolveBudgetCeilingPolicies(input({ currency: "USD" })).status).toBe("held");
    expect(resolveBudgetCeilingPolicies(input({ evaluatedAt: "2026-10-18T09:00:00.000Z" })).status).toBe("held");
    const wrongParent = createBudgetCeilingPolicy({ ...draft(base[2]!), parentLimitRef: base[0]!.limitRef });
    expect(resolveBudgetCeilingPolicies(input({ policies: base.map((row, index) => index === 2 ? wrongParent : row) })).holdReasons).toContain(`ceiling_parent_mismatch:${base[2]!.limitRef}`);
  });

  it("rejects forged immutable hashes and non-monotonic revision chains", () => {
    expect(() => resolveBudgetCeilingPolicies(input({ policies: [{ ...policies()[0]!, policyHash: "f".repeat(64) }, ...policies().slice(1)] }))).toThrow("invalid_chain");
    const first = policies()[0]!;
    const gap = createBudgetCeilingPolicy({ ...draft(first), revision: 3, previousPolicyHash: first.policyHash });
    expect(() => resolveBudgetCeilingPolicies(input({ policies: [first, gap, ...policies().slice(1)] }))).toThrow("invalid_chain");
  });

  it("keeps the current predecessor active until a future revision starts", () => {
    const base = policies(); const current = base[3]!;
    const future = createBudgetCeilingPolicy({ ...draft(current), revision: 2, previousPolicyHash: current.policyHash,
      ceilingDecimal: "600", effectiveFrom: "2026-08-20T08:00:00.000Z", effectiveTo: "2026-09-18T08:00:00.000Z",
      publishedAt: "2026-08-18T07:30:00.000Z" });
    expect(resolveBudgetCeilingPolicies(input({ policies: [...base, future] }))).toMatchObject({ status: "ready", effectiveParentCeilingDecimal: "700" });
    expect(resolveBudgetCeilingPolicies(input({ policies: [...base, future], evaluatedAt: "2026-08-21T09:00:00.000Z" }))).toMatchObject({ status: "ready", effectiveParentCeilingDecimal: "600" });
  });

  it("never falls back to an older published revision after a newer disable starts", () => {
    const base = policies(); const current = base[3]!;
    const disabled = createBudgetCeilingPolicy({ ...draft(current), revision: 2, previousPolicyHash: current.policyHash,
      state: "disabled", effectiveFrom: "2026-08-20T08:00:00.000Z", effectiveTo: "2026-08-21T08:00:00.000Z",
      publishedAt: "2026-08-18T07:30:00.000Z" });
    expect(resolveBudgetCeilingPolicies(input({ policies: [...base, disabled], evaluatedAt: "2026-08-20T09:00:00.000Z" })).holdReasons).toContain(`ceiling_policy_disabled:${current.limitRef}`);
    expect(resolveBudgetCeilingPolicies(input({ policies: [...base, disabled], evaluatedAt: "2026-08-22T09:00:00.000Z" })).holdReasons).toContain(`ceiling_policy_inactive:${current.limitRef}`);
  });
});
