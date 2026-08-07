import { describe, expect, it } from "vitest";

import {
  ACTION_GUARDRAIL_POLICY_VERSION,
  PROTECTION_RESOLUTION_VERSION,
  assertValidActionGuardrailPolicyRevision,
  createActionGuardrailPolicyDraft,
  disableActionGuardrailPolicy,
  publishActionGuardrailPolicy,
  resolveProtection,
  reviseActionGuardrailPolicyDraft,
  type ActionGuardrailClause,
  type ActionGuardrailPolicyRevision,
  type ActionGuardrailSelector,
  type ProtectionResolutionInput,
} from "@/domain/actions/action-guardrail-policy";

const h = (character: string) => character.repeat(64);
const selector = (overrides: Partial<ActionGuardrailSelector> = {}): ActionGuardrailSelector => ({
  actionTypes: ["existing_post_promotion"], accountRefs: [], campaignRefs: [], entities: [],
  internalCategoryRefs: [], geoRefs: [], ...overrides,
});
const draft = (overrides: Partial<Parameters<typeof createActionGuardrailPolicyDraft>[0]> = {}) => createActionGuardrailPolicyDraft({
  workspaceRef: "workspace_alpha", policyRef: "guardrail_workspace", revision: 1, previousHash: null,
  effectiveFrom: "2026-08-07T20:00:00.000Z", expiresAt: null, selector: selector(), clauses: [],
  normalizedBy: { actorRef: "actor_analyst", role: "analyst" }, sourceGuidanceRefs: ["guidance_owner_rule"],
  ...overrides,
});
const publish = (candidate = draft(), publishedAt = "2026-08-07T20:01:00.000Z") => publishActionGuardrailPolicy({
  draft: candidate, actor: { actorRef: "actor_owner", role: "owner" }, decisionRef: "decision_publish_guardrail",
  reasonRef: "reason_owner_confirmed", publishedAt,
});
function input(revisions: readonly ActionGuardrailPolicyRevision[], overrides: Partial<ProtectionResolutionInput> = {}): ProtectionResolutionInput {
  return {
    workspaceRef: "workspace_alpha", evaluatedAt: "2026-08-07T21:00:00.000Z",
    action: { actionHash: h("a"), actionType: "existing_post_promotion", accountRef: "account_doruk",
      campaignRef: "campaign_leads", entity: { level: "adset", ref: "adset_leads" }, budgetChange: null },
    categoryEvidence: { status: "known", refs: ["category_health"], evidenceHash: h("b") },
    affectedGeoEvidence: { status: "known", refs: ["geo_turkey"], evidenceHash: h("c") },
    revisions, ...overrides,
  };
}

describe("ActionGuardrailPolicy lifecycle", () => {
  it("creates replay-stable guidance-only draft and owner-published hash-linked revision", () => {
    const first = draft(); const replay = draft(); const published = publish(first);
    expect(first).toMatchObject({ version: ACTION_GUARDRAIL_POLICY_VERSION, revision: 1, previousHash: null, state: "draft",
      provenance: { normalizedByRole: "analyst", sourceGuidanceRefs: ["guidance_owner_rule"], publishedByActorRef: null },
      authority: { canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false, canPromoteGuidance: false } });
    expect(replay.canonicalHash).toBe(first.canonicalHash);
    expect(published).toMatchObject({ revision: 2, previousHash: first.canonicalHash, state: "published",
      provenance: { publishedByRole: "owner", publicationDecisionRef: "decision_publish_guardrail" } });
    expect(assertValidActionGuardrailPolicyRevision(published).canonicalHash).toBe(published.canonicalHash);
    expect(Object.isFrozen(published.selector)).toBe(true);
  });

  it("supports published/disabled -> new draft -> published and published -> disabled only", () => {
    const first = publish();
    const revised = reviseActionGuardrailPolicyDraft({ current: first, effectiveFrom: "2026-08-08T00:00:00.000Z", expiresAt: null,
      selector: selector({ campaignRefs: ["campaign_leads"] }), clauses: [{ clauseRef: "clause_deny", kind: "deny_action" }],
      normalizedBy: { actorRef: "actor_admin", role: "admin" }, sourceGuidanceRefs: ["guidance_campaign_lock"] });
    const republished = publishActionGuardrailPolicy({ draft: revised, actor: { actorRef: "actor_admin", role: "admin" },
      decisionRef: "decision_republish", reasonRef: "reason_scope_reviewed", publishedAt: "2026-08-08T00:01:00.000Z" });
    const disabled = disableActionGuardrailPolicy({ current: republished, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_disable", reasonRef: "reason_retired", disabledAt: "2026-08-08T01:00:00.000Z" });
    const afterDisable = reviseActionGuardrailPolicyDraft({ current: disabled, effectiveFrom: "2026-08-09T00:00:00.000Z", expiresAt: null,
      selector: selector(), clauses: [], normalizedBy: { actorRef: "actor_owner", role: "owner" }, sourceGuidanceRefs: [] });
    expect([first.revision, revised.revision, republished.revision, disabled.revision, afterDisable.revision]).toEqual([2, 3, 4, 5, 6]);
    expect(afterDisable.previousHash).toBe(disabled.canonicalHash);
    expect(() => disableActionGuardrailPolicy({ current: disabled, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_again", reasonRef: "reason_again", disabledAt: "2026-08-08T02:00:00.000Z" }))
      .toThrowError(expect.objectContaining({ code: "invalid_transition" }));
    expect(() => publishActionGuardrailPolicy({ draft: afterDisable, actor: { actorRef: "actor_analyst", role: "analyst" } as never,
      decisionRef: "decision_invalid", reasonRef: "reason_invalid", publishedAt: "2026-08-09T00:01:00.000Z" }))
      .toThrowError(expect.objectContaining({ code: "publish_forbidden" }));
  });

  it("strictly validates selector and typed clause contracts", () => {
    expect(() => draft({ selector: { ...selector(), actionTypes: [] } })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => draft({ selector: { ...selector(), unexpected: [] } as never })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => draft({ clauses: [{ clauseRef: "clause_budget", kind: "budget_delta_limit", currency: "TRY",
      maximumAbsoluteDeltaDecimal: "10", maximumRelativeDeltaBasisPoints: null }] }))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    const forged = { ...publish(), provenance: { ...publish().provenance, sourceGuidanceRefs: ["guidance_forged"] } };
    expect(() => assertValidActionGuardrailPolicyRevision(forged)).toThrowError(expect.objectContaining({ code: "corrupt_registry" }));
  });
});

describe("ProtectionResolver", () => {
  it("returns canonical allowed only from an exact active published coverage policy", () => {
    const first = draft({ selector: selector({ accountRefs: ["account_doruk"], campaignRefs: ["campaign_leads"],
      entities: [{ level: "adset", ref: "adset_leads" }], internalCategoryRefs: ["category_health"], geoRefs: ["geo_turkey"] }) });
    const active = publish(first); const result = resolveProtection(input([first, active]));
    expect(result).toMatchObject({ version: PROTECTION_RESOLUTION_VERSION, disposition: "allowed", reasonCodes: [],
      categoryEvidenceHash: h("b"), affectedGeoEvidenceHash: h("c"), affectedGeoRefs: ["geo_turkey"],
      policyEvidence: [{ policyRef: "guardrail_workspace", revision: 2, canonicalHash: active.canonicalHash }],
      capabilities: { canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false } });
    expect(result.resolutionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(resolveProtection(input([first, active])).resolutionHash).toBe(result.resolutionHash);
    expect(resolveProtection({ ...input([first, active]), action: { ...input([first, active]).action, actionHash: h("d") } }).resolutionHash)
      .not.toBe(result.resolutionHash);
  });

  it("denies matched action and protected fixed/no-outflow budget changes", () => {
    const denyDraft = draft({ clauses: [{ clauseRef: "clause_deny", kind: "deny_action" }] });
    expect(resolveProtection(input([denyDraft, publish(denyDraft)])).reasonCodes).toContain("deny_action_matched");
    const budgetSelector = selector({ actionTypes: ["budget_decrease", "budget_increase"] });
    const clauses: readonly ActionGuardrailClause[] = [
      { clauseRef: "clause_limit", kind: "budget_delta_limit", currency: "TRY", maximumAbsoluteDeltaDecimal: "100", maximumRelativeDeltaBasisPoints: 2_000 },
      { clauseRef: "clause_geo", kind: "protect_budget", dimension: "geo", refs: ["geo_turkey"], behavior: "no_outflow" },
      { clauseRef: "clause_category", kind: "protect_budget", dimension: "internal_category", refs: ["category_health"], behavior: "fixed" },
    ];
    const budgetDraft = draft({ selector: budgetSelector, clauses }); const budgetPolicy = publish(budgetDraft);
    const budgetInput = input([budgetDraft, budgetPolicy], { action: { actionHash: h("d"), actionType: "budget_decrease",
      accountRef: "account_doruk", campaignRef: "campaign_leads", entity: { level: "adset", ref: "adset_leads" },
      budgetChange: { currency: "TRY", absoluteDeltaDecimal: "25", relativeDeltaBasisPoints: 500 } } });
    expect(resolveProtection(budgetInput)).toMatchObject({ disposition: "denied",
      protectedInternalCategoryRefs: ["category_health"], protectedGeoRefs: ["geo_turkey"] });
    expect(resolveProtection(budgetInput).reasonCodes).toEqual(expect.arrayContaining(["protected_budget_fixed", "protected_budget_no_outflow"]));
  });

  it("fails closed on limit breaches, missing limits and unknown evidence", () => {
    const budgetDraft = draft({ selector: selector({ actionTypes: ["budget_increase"] }), clauses: [
      { clauseRef: "clause_limit", kind: "budget_delta_limit", currency: "TRY", maximumAbsoluteDeltaDecimal: "10", maximumRelativeDeltaBasisPoints: 500 },
    ] });
    const budgetInput = input([budgetDraft, publish(budgetDraft)], { action: { actionHash: h("d"), actionType: "budget_increase",
      accountRef: "account_doruk", campaignRef: "campaign_leads", entity: { level: "campaign", ref: "campaign_leads" },
      budgetChange: { currency: "TRY", absoluteDeltaDecimal: "11", relativeDeltaBasisPoints: 501 } } });
    expect(resolveProtection(budgetInput)).toMatchObject({ disposition: "denied",
      reasonCodes: ["maximum_absolute_budget_delta_exceeded", "maximum_relative_budget_delta_exceeded"] });
    const coverageDraft = draft({ selector: selector({ actionTypes: ["budget_increase"] }), clauses: [] });
    expect(resolveProtection({ ...budgetInput, revisions: [coverageDraft, publish(coverageDraft)] })).toMatchObject({
      disposition: "unresolved", reasonCodes: ["budget_limit_missing"],
    });
    expect(resolveProtection({ ...budgetInput, categoryEvidence: { status: "unknown", reasonRef: "reason_category_missing" } }))
      .toMatchObject({ disposition: "unresolved", reasonCodes: ["category_evidence_unknown"] });
  });

  it("fails closed on missing, unmatched, expired, disabled, ambiguous and corrupt policy sets", () => {
    expect(resolveProtection(input([]))).toMatchObject({ disposition: "unresolved", reasonCodes: ["policy_set_missing"] });
    const unmatchedDraft = draft({ selector: selector({ accountRefs: ["account_other"] }) }); const unmatched = publish(unmatchedDraft);
    expect(resolveProtection(input([unmatchedDraft, unmatched]))).toMatchObject({ disposition: "unresolved", reasonCodes: ["policy_coverage_missing"] });
    const expiredDraft = draft({ expiresAt: "2026-08-07T20:30:00.000Z" }); const expired = publish(expiredDraft);
    expect(resolveProtection(input([expiredDraft, expired]))).toMatchObject({ disposition: "unresolved", reasonCodes: ["policy_set_inactive"] });
    const active = publish(); const disabled = disableActionGuardrailPolicy({ current: active, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_disable", reasonRef: "reason_disabled", disabledAt: "2026-08-07T20:30:00.000Z" });
    expect(resolveProtection(input([draft(), active, disabled]))).toMatchObject({ disposition: "unresolved", reasonCodes: ["policy_set_inactive"] });
    const otherDraft = draft({ policyRef: "guardrail_duplicate" }); const other = publish(otherDraft);
    expect(resolveProtection(input([draft(), active, otherDraft, other]))).toMatchObject({ disposition: "unresolved", reasonCodes: ["ambiguous_policy_scope"] });
    expect(() => resolveProtection(input([active]))).toThrowError(expect.objectContaining({ code: "corrupt_registry" }));
  });

  it("fails closed on conflicting clauses and rejects extended evidence contracts", () => {
    const firstDraft = draft({ selector: selector({ actionTypes: ["budget_increase"], accountRefs: ["account_doruk"] }),
      clauses: [{ clauseRef: "clause_shared", kind: "deny_action" }] });
    const secondDraft = draft({ policyRef: "guardrail_campaign", selector: selector({ actionTypes: ["budget_increase"],
      campaignRefs: ["campaign_leads"] }), clauses: [{ clauseRef: "clause_shared", kind: "budget_delta_limit",
      currency: "TRY", maximumAbsoluteDeltaDecimal: "50", maximumRelativeDeltaBasisPoints: null }] });
    const budgetAction = { actionHash: h("d"), actionType: "budget_increase" as const, accountRef: "account_doruk",
      campaignRef: "campaign_leads", entity: { level: "campaign" as const, ref: "campaign_leads" },
      budgetChange: { currency: "TRY", absoluteDeltaDecimal: "10", relativeDeltaBasisPoints: 100 } };
    expect(resolveProtection(input([firstDraft, publish(firstDraft), secondDraft, publish(secondDraft)], { action: budgetAction })))
      .toMatchObject({ disposition: "unresolved", reasonCodes: ["policy_clause_conflict"] });
    expect(() => resolveProtection({ ...input([firstDraft, publish(firstDraft)], { action: budgetAction }),
      categoryEvidence: { status: "known", refs: ["category_health"], evidenceHash: h("b"), raw: "forbidden" } as never }))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });
});
