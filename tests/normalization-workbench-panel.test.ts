import { describe, expect, it } from "vitest";

import { buildNormalizationAnswers, parseNormalizationWorkbenchPreview, parseNormalizationWorkbenchSnapshot, resolveNormalizationSelection } from
  "@/app/dashboard/normalization-workbench-panel";

const hash = "a".repeat(64);
const authority = { canRead: true, canDraft: true, canPublish: false, canPromotePolicy: false,
  canApprove: false, canExecute: false, canWriteMeta: false };
const capabilities = { canPublish: false, canPromotePolicy: false, canApprove: false, canExecute: false, canWriteMeta: false };

describe("normalization workbench panel contract", () => {
  it("accepts only draft-only server responses", () => {
    expect(parseNormalizationWorkbenchSnapshot({ contractVersion: "normalization-workbench-service/1.0.0", revisions: [
      { normalizationRef: "normalization_budget", revision: 1, revisionHash: hash, selectionHash: hash, capabilities },
    ], authority }).revisions).toHaveLength(1);
    expect(parseNormalizationWorkbenchPreview({ contractVersion: "normalization-workbench/1.0.0", disposition: "ready", missing: [],
      selection: {}, selectionHash: hash, capabilities, authority }).selectionHash).toBe(hash);
    expect(() => parseNormalizationWorkbenchPreview({ contractVersion: "normalization-workbench/1.0.0", disposition: "ready", missing: [],
      selection: {}, selectionHash: hash, capabilities: { ...capabilities, canExecute: true }, authority })).toThrow();
  });

  it("turns line-based assumptions and open questions into bounded structured answers", () => {
    expect(buildNormalizationAnswers({ title: " Bütçeyi koru ", body: " Aktarım yapma ", topic: " budget ", strength: "must",
      assumptions: "Aylık havuz\n\nTüm kampanya", questions: "Para birimi?\n" })).toEqual({
      normalizedGuidance: { title: "Bütçeyi koru", body: "Aktarım yapma", topic: "budget", strength: "must" },
      assumptions: [{ assumptionRef: "assumption_1", text: "Aylık havuz" }, { assumptionRef: "assumption_2", text: "Tüm kampanya" }],
      questions: [{ questionRef: "question_1", prompt: "Para birimi?", required: true }],
    });
  });

  it("derives only compatible source/card/reviewed-set choices without guessing a multi-source card", () => {
    const choices = { cards: [{ cardRef: "guidance_budget", title: "Bütçe", sourceRefs: ["source_owner", "source_strategy"] }],
      sets: [{ setRef: "guidance_set_budget", name: "Bütçe seti", cardRefs: ["guidance_budget"] }] } as const;
    expect(resolveNormalizationSelection(choices, "guidance_budget")).toEqual({ sourceRef: "", cardRef: "guidance_budget",
      setRef: "guidance_set_budget" });
    expect(resolveNormalizationSelection(choices, "guidance_unknown")).toBeNull();
  });
});
