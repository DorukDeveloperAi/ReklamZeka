import { describe, expect, it } from "vitest";

import { createInstructionPolicyNormalization, InstructionPolicyNormalizationError } from
  "@/domain/policies/instruction-policy-normalization";

const empty = Object.freeze({ intent: null, scope: null, scopeRef: null, operation: null, budgetPoolRef: null,
  preferenceSubjectRef: null, preferredRefs: [] });

describe("instruction policy normalization", () => {
  it("turns incomplete owner intent into answerable questions without a binding clause", () => {
    const result = createInstructionPolicyNormalization(empty);
    expect(result.status).toBe("needs_input");
    expect(result.questions.map((item) => item.field)).toEqual(["intent", "scope"]);
    expect(result.clauses).toEqual([]);
    expect(result.authority).toEqual({ canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false,
      canSchedule: false, canCallTool: false, canAccessNetwork: false });
  });

  it("creates a deterministic draft-only clause from explicit typed answers", () => {
    const input = { ...empty, intent: "prohibit_operation", scope: "specific", scopeRef: "account_primary",
      operation: "budget_transfer" };
    const first = createInstructionPolicyNormalization(input);
    const replay = createInstructionPolicyNormalization(input);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ status: "ready_for_draft", clauses: [{ kind: "prohibition" }] });
    expect(first.normalizationHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects contradictory or injected answers", () => {
    expect(() => createInstructionPolicyNormalization({ ...empty, scope: "global", scopeRef: "account_primary" }))
      .toThrow(InstructionPolicyNormalizationError);
    expect(() => createInstructionPolicyNormalization({ ...empty, injectedAuthority: true }))
      .toThrow(InstructionPolicyNormalizationError);
  });
});
