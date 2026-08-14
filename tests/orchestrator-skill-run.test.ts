import { describe, expect, it } from "vitest";
import { createOrchestratorReadOnlyEvidenceContext, orchestratorReadOnlyEvidenceContextHash,
  unavailableOrchestratorReadOnlyEvidenceContext } from "@/application/orchestrator-readonly-evidence-context";
import { OrchestratorSkillRouter, parseOrchestratorSkillRunReceipt, safeOrchestratorSkillIntent,
  unavailableOrchestratorSkillRunReceipt } from "@/application/orchestrator-skill-run";
import { buildCanonicalPerformanceReadModel } from "@/domain/meta/performance-read-model";
import { CORE_SKILL_MANIFESTS, createWorkspaceSkillCatalogBinding } from "@/domain/orchestrator/skill-catalog";

function binding() {
  return createWorkspaceSkillCatalogBinding({ profile: { profileRef: "profile_default", revision: 1, profileHash: "a".repeat(64) },
    manifests: CORE_SKILL_MANIFESTS.map(({ ref, version, hash }) => ({ ref, version, hash })), playbooks: [] });
}
function evidence() {
  return createOrchestratorReadOnlyEvidenceContext({ performance: buildCanonicalPerformanceReadModel([]), timeline: [{
    kind: "delivery_alert", occurredAt: "2026-08-14T10:00:00.000Z", title: "not persisted", detail: "not persisted",
  }] });
}

describe("orchestrator SkillRun v1", () => {
  it("classifies only safe coarse intents", () => {
    expect(safeOrchestratorSkillIntent("Kohortları karşılaştır")).toBe("compare");
    expect(safeOrchestratorSkillIntent("Kanıt nedir?")).toBe("question");
    expect(safeOrchestratorSkillIntent("Durumu açıkla")).toBe("explain");
    expect(safeOrchestratorSkillIntent("Kanıtı incele")).toBe("read");
  });

  it("selects a bounded release-owned read-only receipt and evaluates only aggregate evidence facts", () => {
    const context = evidence(); const hash = orchestratorReadOnlyEvidenceContextHash(context);
    const receipt = new OrchestratorSkillRouter().route({ pageId: "analysis", message: "Kohortları karşılaştır", binding: binding(),
      evidence: context, evidenceContextHash: hash });
    expect(receipt).toMatchObject({ version: "orchestrator-skill-run/1.0.0", evidenceContextHash: hash, intent: "compare",
      selectedSkills: [{ ref: "evidence_integrity_auditor" }, { ref: "cohort_comparator" }],
      handler: { ref: "evidence_integrity_auditor", outputContract: "evidence-integrity-facts/1.0.0",
        facts: { availability: "partial", performance: { accountCount: 0, campaignCount: 0 }, timeline: { eventCount: 1 } } },
      authority: { canPersist: false, canCreateRule: false, canDraftPolicy: false, canAlterScope: false,
        canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(receipt.selectedSkills).toHaveLength(2);
    expect(receipt.receiptRef).toMatch(/^skillrun_[a-f0-9]{32}$/);
    expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(receipt)).not.toContain("not persisted");
    expect(parseOrchestratorSkillRunReceipt(receipt, receipt.receiptHash)).toEqual(receipt);
  });

  it("fails closed for receipt tampering and represents unavailable evidence without pretending to have facts", () => {
    const unavailable = unavailableOrchestratorSkillRunReceipt();
    expect(unavailable).toEqual({ version: "unavailable_not_bound" });
    const context = evidence(); const receipt = new OrchestratorSkillRouter().route({ pageId: "rules", message: "Kanıtı açıkla",
      binding: binding(), evidence: unavailableOrchestratorReadOnlyEvidenceContext(), evidenceContextHash: "UNAVAILABLE_NOT_BOUND" });
    expect(receipt.handler.facts).toEqual({ availability: "unavailable", performance: null, timeline: null });
    expect(parseOrchestratorSkillRunReceipt({ ...receipt, intent: "write" }, receipt.receiptHash)).toBeNull();
    expect(parseOrchestratorSkillRunReceipt(receipt, "b".repeat(64))).toBeNull();
    expect(context.version).toBe("orchestrator-readonly-evidence-context/1.0.0");
  });
});
