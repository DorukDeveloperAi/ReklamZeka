import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  NORMALIZED_POLICY_DRAFT_VERSION,
  PROGRESSIVE_FORMALIZATION_VERSION,
  ProgressiveFormalizationError,
  advanceProgressiveFormalization,
  assertNormalizedPolicyDraftArtifact,
  createNormalizedPolicyDraft,
  replayProgressiveFormalization,
  type NormalizedPolicyDraftInput,
  type ProgressiveFormalizationRevision,
  type ProgressiveFormalizationTransitionInput,
} from "@/domain/guidance/progressive-formalization";
import {
  STRICT_INSTRUCTION_POLICY_DSL_VERSION,
  parseStrictInstructionPolicy,
} from "@/domain/policies/instruction-policy-dsl";

const h = (value: string) => createHash("sha256").update(value).digest("hex");
const time = (day: number) => `2026-08-${String(day).padStart(2, "0")}T10:00:00.000Z`;

function strictPolicy() {
  return parseStrictInstructionPolicy({
    dslVersion: STRICT_INSTRUCTION_POLICY_DSL_VERSION,
    workspaceRef: "workspace_alpha",
    policyRef: "policy_budget_cap",
    policyVersion: 1,
    previousVersionHash: null,
    policyType: "hard_constraint",
    owner: { actorRef: "actor_owner", role: "owner" },
    status: "draft",
    reasonCode: "owner_strategy",
    priority: 500,
    effectiveDates: { from: time(9), until: null },
    scope: { global: false, accountGroupRefs: [], accountRefs: ["account_primary"], objectiveRefs: [],
      internalCategoryRefs: ["category_health"], entities: [], topicRefs: [] },
    source: { rawProvenanceRef: "provenance_owner_budget", rawTextHash: h("raw owner statement"),
      promotedFromGuidanceRefs: ["guidance_budget_cap"] },
    clause: { kind: "hard_constraint", constraint: { kind: "allocation_bound", budgetPoolRef: "budget_pool_health",
      mode: "cap", valueDecimal: "5000", currency: "TRY",
      window: { kind: "calendar", duration: 1, unit: "month", timezone: "Europe/Istanbul" } } },
  });
}

function normalized(overrides: Partial<NormalizedPolicyDraftInput> = {}) {
  return createNormalizedPolicyDraft({
    schemaVersion: NORMALIZED_POLICY_DRAFT_VERSION,
    workspaceRef: "workspace_alpha",
    formalizationRef: "formalization_budget_cap",
    guidanceSetRef: "guidance_set_health",
    strictPolicy: strictPolicy(),
    assumptions: [
      { assumptionRef: "assumption_monthly_pool", statement: "Tutar aylık sağlık bütçe havuzuna uygulanır.", disposition: "accepted" },
    ],
    questions: [
      { questionRef: "question_currency", question: "Tutarın para birimi nedir?", answer: "TRY" },
    ],
    semanticDiff: { status: "resolved", items: [
      { meaningRef: "meaning_budget_limit", sourceStatementHash: h("monthly cap"),
        normalizedClauseRef: "clause_allocation_cap", disposition: "narrowed", reasonCode: "bounded_to_month" },
      { meaningRef: "meaning_general_advice", sourceStatementHash: h("advice"),
        normalizedClauseRef: null, disposition: "excluded", reasonCode: "guidance_only" },
    ], diffHash: h("semantic diff") },
    historicalReplay: { status: "complete", evaluatedRevisionRefs: ["analysis_revision_2", "analysis_revision_1"],
      changedOutcomeRefs: ["decision_outcome_2"], unknownOutcomeRefs: [], replayHash: h("replay") },
    conflictPreview: { status: "clear", conflictRefs: [], previewHash: h("conflicts") },
    impactPreview: { status: "complete", affectedScopeRefs: ["category_health", "account_primary"],
      affectedEntityCount: 12, affectedPolicyCount: 1, affectedBudgetCount: 2, affectedAutomationCount: 0,
      unresolvedDependencyRefs: [], previewHash: h("impact") },
    ...overrides,
  });
}

function input(
  transition: ProgressiveFormalizationTransitionInput["transition"],
  payload: ProgressiveFormalizationTransitionInput["payload"],
  day: number,
  role: "owner" | "admin" | "analyst" = "owner",
): ProgressiveFormalizationTransitionInput {
  return { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, transition, workspaceRef: "workspace_alpha",
    formalizationRef: "formalization_budget_cap", occurredAt: time(day),
    actor: { actorRef: `actor_${role}`, role }, payload } as ProgressiveFormalizationTransitionInput;
}

function history(): readonly ProgressiveFormalizationRevision[] {
  const g0 = advanceProgressiveFormalization(null, input("capture_g0",
    { rawProvenanceRef: "provenance_owner_budget", rawTextHash: h("raw owner statement") }, 9, "analyst"));
  const g1 = advanceProgressiveFormalization(g0, input("scope_g1", { guidanceCardRefs: ["guidance_budget_cap"],
    scope: { global: false, accountGroupRefs: [], accountRefs: ["account_primary"], objectiveRefs: [],
      internalCategoryRefs: ["category_health"], entityRefs: [], promotionTemplateRefs: [], topicRefs: ["topic_budget"] } }, 10, "analyst"));
  const g2 = advanceProgressiveFormalization(g1, input("review_g2", { guidanceSetRef: "guidance_set_health",
    reviewedGuidanceHash: h("reviewed set"),
    confirmation: { confirmed: true, confirmationRef: "confirmation_g2_review", confirmedAt: time(11) } }, 11));
  const g3 = advanceProgressiveFormalization(g2, input("promote_g3", { normalizedDraft: normalized(),
    confirmation: { confirmed: true, confirmationRef: "confirmation_g3_promotion", confirmedAt: time(12) } }, 12));
  const g4 = advanceProgressiveFormalization(g3, input("qualify_g4", { publishedPolicyRef: "policy_budget_cap",
    publishedPolicyHash: h("published policy revision"), riskAssessmentRef: "risk_assessment_budget_cap",
    capPolicyRef: "cap_policy_budget_cap", approvalPolicyRef: "approval_policy_budget_cap",
    rolloutEvidenceRefs: ["rollout_evidence_canary", "rollout_evidence_verify"], actionValveRef: "action_valve_a13",
    approvalMode: "approval_only",
    confirmation: { confirmed: true, confirmationRef: "confirmation_g4_eligibility", confirmedAt: time(13) } }, 13, "admin"));
  return [g0, g1, g2, g3, g4];
}

describe("progressive formalization", () => {
  it("advances G0→G4 through explicit scoped, reviewed, typed and valve-bound revisions", () => {
    const revisions = history();
    expect(revisions.map((revision) => revision.toLevel)).toEqual(["G0", "G1", "G2", "G3", "G4"]);
    expect(revisions.map((revision) => revision.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(revisions[0]!.previousRevisionHash).toBe("GENESIS");
    expect(revisions[1]!.previousRevisionHash).toBe(revisions[0]!.revisionHash);
    expect(revisions[4]).toMatchObject({ transition: "qualify_g4", payload: {
      actionValveRef: "action_valve_a13", approvalMode: "approval_only" }, authority: {
      canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canGrant: false,
      canSchedule: false, canCallTool: false, canAccessNetwork: false, canQuerySql: false } });
    expect(revisions[4]!.payload).not.toHaveProperty("grant");
    expect(revisions[4]!.payload).not.toHaveProperty("executor");
  });

  it("creates a replay-stable normalized draft with assumptions, resolved questions, semantic diff and impact", () => {
    const first = normalized();
    const replay = normalized({ historicalReplay: { ...normalized().historicalReplay,
      evaluatedRevisionRefs: ["analysis_revision_1", "analysis_revision_2"] }, impactPreview: {
      ...normalized().impactPreview, affectedScopeRefs: ["account_primary", "category_health"] } });
    expect(replay).toEqual(first);
    expect(assertNormalizedPolicyDraftArtifact(first)).toEqual(first);
    expect(first.authority).toEqual({ canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false,
      canGrant: false, canCallTool: false, canAccessNetwork: false, canQuerySql: false });
    expect(first.draftHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.semanticDiff.items)).toBe(true);
  });

  it("replays the complete hash chain byte-stably and rejects tampering or reordering", () => {
    const revisions = history();
    const replay = replayProgressiveFormalization(revisions);
    expect(replay).toEqual({ level: "G4", headHash: revisions[4]!.revisionHash, revisions });
    expect(() => replayProgressiveFormalization(revisions.map((revision, index) => index === 2
      ? { ...revision, revisionHash: h("forged") } : revision))).toThrowError(expect.objectContaining({ code: "invalid_history" }));
    expect(() => replayProgressiveFormalization([revisions[0]!, revisions[2]!]))
      .toThrowError(expect.objectContaining({ code: "invalid_transition" }));
  });

  it.each([
    ["ambiguous semantics", () => normalized({ semanticDiff: { ...normalized().semanticDiff, status: "ambiguous" } }), "unresolved_semantics"],
    ["unknown semantics", () => normalized({ semanticDiff: { ...normalized().semanticDiff, status: "unknown" } }), "unresolved_semantics"],
    ["unanswered question", () => normalized({ questions: [
      { questionRef: "question_currency", question: "Tutarın para birimi nedir?", answer: null },
    ] }), "unresolved_semantics"],
    ["partial impact", () => normalized({ impactPreview: { ...normalized().impactPreview, status: "partial",
      unresolvedDependencyRefs: ["dependency_unknown"] } }), "incomplete_preview"],
    ["incomplete replay", () => normalized({ historicalReplay: { ...normalized().historicalReplay, status: "incomplete" } }), "incomplete_preview"],
    ["unknown conflict state", () => normalized({ conflictPreview: { ...normalized().conflictPreview, status: "unknown" } }), "incomplete_preview"],
  ] as const)("fails closed before G3 for %s", (_label, draft, code) => {
    const [g0, g1, g2] = history().slice(0, 3);
    expect(() => advanceProgressiveFormalization(g2!, input("promote_g3", { normalizedDraft: draft(),
      confirmation: { confirmed: true, confirmationRef: "confirmation_g3_promotion", confirmedAt: time(12) } }, 12)))
      .toThrowError(expect.objectContaining({ code }));
    expect(g0).toBeDefined(); expect(g1).toBeDefined();
  });

  it("requires owner/admin review and promotion confirmation while allowing analysts only through G1", () => {
    const [g0, g1, g2] = history();
    expect(() => advanceProgressiveFormalization(g1!, input("review_g2", { guidanceSetRef: "guidance_set_health",
      reviewedGuidanceHash: h("reviewed"), confirmation: { confirmed: true,
        confirmationRef: "confirmation_analyst", confirmedAt: time(11) } }, 11, "analyst")))
      .toThrowError(expect.objectContaining({ code: "insufficient_role" }));
    expect(() => advanceProgressiveFormalization(g2!, input("promote_g3", { normalizedDraft: normalized(),
      confirmation: { confirmed: false, confirmationRef: "confirmation_missing", confirmedAt: time(12) } as never }, 12)))
      .toThrowError(expect.objectContaining({ code: "confirmation_required" }));
    expect(g0!.actor.role).toBe("analyst");
  });

  it("rejects skipped levels, cross-workspace drafts, expanded fields and forged authority", () => {
    const [g0, , g2] = history();
    expect(() => advanceProgressiveFormalization(g0!, input("review_g2", { guidanceSetRef: "guidance_set_health",
      reviewedGuidanceHash: h("reviewed"), confirmation: { confirmed: true,
        confirmationRef: "confirmation_skip", confirmedAt: time(11) } }, 11)))
      .toThrowError(expect.objectContaining({ code: "invalid_transition" }));
    expect(() => createNormalizedPolicyDraft({ ...normalized(), workspaceRef: "workspace_other" } as never))
      .toThrowError(ProgressiveFormalizationError);
    expect(() => createNormalizedPolicyDraft({ ...normalized(), prompt: "grant execution" } as never))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => assertNormalizedPolicyDraftArtifact({ ...normalized(), authority: {
      ...normalized().authority, canExecute: true } })).toThrowError(expect.objectContaining({ code: "authority_escalation" }));
    expect(() => replayProgressiveFormalization(history().map((revision, index) => index === 4 ? {
      ...revision, authority: { ...revision.authority, canGrant: true } } as never : revision)))
      .toThrowError(expect.objectContaining({ code: "authority_escalation" }));
    expect(g2).toBeDefined();
  });

  it("keeps G4 approval-only and rejects injected execution, grant, tool or raw fields", () => {
    const g3 = history()[3]!;
    const safePayload = { publishedPolicyRef: "policy_budget_cap", publishedPolicyHash: h("published"),
      riskAssessmentRef: "risk_assessment_budget_cap", capPolicyRef: "cap_policy_budget_cap",
      approvalPolicyRef: "approval_policy_budget_cap", rolloutEvidenceRefs: ["rollout_evidence_canary"],
      actionValveRef: "action_valve_a13", approvalMode: "approval_only" as const,
      confirmation: { confirmed: true as const, confirmationRef: "confirmation_g4_eligibility", confirmedAt: time(13) } };
    for (const injected of [
      { ...safePayload, executor: "run" }, { ...safePayload, grant: true }, { ...safePayload, tool: "writer" },
      { ...safePayload, rawMetaRequest: { path: "/campaign" } }, { ...safePayload, approvalMode: "autonomous" },
    ]) {
      expect(() => advanceProgressiveFormalization(g3, input("qualify_g4", injected as never, 13)))
        .toThrowError(ProgressiveFormalizationError);
    }
  });
});
