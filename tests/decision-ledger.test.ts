import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  appendAnalysisRecord,
  appendDecisionRecord,
  verifyDecisionLedger,
  type DecisionLedger,
} from "@/domain/decisions/ledger";

function analysis(ledger: DecisionLedger = [], reversed = false) {
  return appendAnalysisRecord(ledger, {
    workspaceRef: "workspace_0123456789abcdef",
    occurredAt: "2026-08-07T12:00:00.000Z",
    analysisDefinitionRef: "analysis_definition_v1",
    effectiveContextRef: "context_0123456789abcdef",
    timelineRefs: reversed ? ["timeline_b", "timeline_a"] : ["timeline_a", "timeline_b"],
    evidenceRefs: reversed ? ["evidence_b", "evidence_a"] : ["evidence_a", "evidence_b"],
    frozenContext: reversed
      ? { nested: { z: 2, a: 1 }, campaign: "masked" }
      : { campaign: "masked", nested: { a: 1, z: 2 } },
  });
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, stable(item)]),
  );
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

describe("append-only decision ledger", () => {
  it("creates deterministic locale-independent analysis IDs and a frozen evidence context", () => {
    const first = analysis();
    const reordered = analysis([], true);
    expect(reordered.record).toEqual(first.record);
    expect(first.record.recordId).toMatch(/^analysis_[a-f0-9]{20}$/);
    expect(first.record.recordHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.record.previousHash).toBe("GENESIS");
    expect(first.record.actionAuthority).toBe("none");
    expect(Object.isFrozen(first.record)).toBe(true);
    expect(Object.isFrozen(first.record.frozenContext)).toBe(true);
    expect(Object.isFrozen((first.record.frozenContext as { nested: object }).nested)).toBe(true);
    expect(verifyDecisionLedger(first.ledger)).toBe(true);
  });

  it("appends a decision hash-chain without mutating the prior ledger", () => {
    const first = analysis();
    const appended = appendDecisionRecord(first.ledger, {
      workspaceRef: first.record.workspaceRef,
      occurredAt: "2026-08-07T12:01:00.000Z",
      analysisRecordRef: first.record.recordId,
      cadenceResultRef: "cadence_0123456789abcdef",
      disposition: "observe",
      evidenceRefs: ["evidence_b", "evidence_a"],
      timelineRefs: ["timeline_b", "timeline_a"],
      guidanceRefs: ["guidance_owner"],
      experimentRef: null,
      rationaleCode: "learning_active",
    });
    expect(first.ledger).toHaveLength(1);
    expect(appended.ledger).toHaveLength(2);
    expect(appended.record).toMatchObject({
      sequence: 2,
      previousHash: first.record.recordHash,
      executionAuthority: "none",
      evidenceRefs: ["evidence_a", "evidence_b"],
      timelineRefs: ["timeline_a", "timeline_b"],
    });
    expect(verifyDecisionLedger(appended.ledger)).toBe(true);
  });

  it("has stable golden IDs and hashes for the canonical two-record timeline", () => {
    const first = analysis();
    const second = appendDecisionRecord(first.ledger, {
      workspaceRef: first.record.workspaceRef,
      occurredAt: "2026-08-07T12:01:00.000Z",
      analysisRecordRef: first.record.recordId,
      cadenceResultRef: "cadence_0123456789abcdef",
      disposition: "no_change",
      evidenceRefs: ["evidence_a", "evidence_b"],
      timelineRefs: ["timeline_a", "timeline_b"],
      guidanceRefs: ["guidance_owner"],
      experimentRef: "experiment_0123456789abcdef",
      rationaleCode: "repeat_without_new_evidence",
    });
    expect({
      analysisId: first.record.recordId,
      analysisHash: first.record.recordHash,
      decisionId: second.record.recordId,
      decisionHash: second.record.recordHash,
    }).toEqual({
      analysisId: "analysis_37323b519905ae8e73eb",
      analysisHash: "544cc18f0496388774184ba15f7118b46b06a480c94babaccc1e0452944ed04e",
      decisionId: "decision_c67ce1a4b46c6fb40225",
      decisionHash: "09a126e9ee7c7d4bb7ea147ccb522d088bf74e171748b6e3b3691dc31652abae",
    });
  });

  it("rejects missing analysis, cross-workspace scope, authority injection, and tampered chains", () => {
    expect(() => appendDecisionRecord([], {
      workspaceRef: "workspace_0123456789abcdef", occurredAt: "2026-08-07T12:00:00.000Z",
      analysisRecordRef: "analysis_missing", cadenceResultRef: "cadence_ref", disposition: "act",
      evidenceRefs: [], timelineRefs: [], guidanceRefs: [], experimentRef: null, rationaleCode: "eligible",
    })).toThrowError(expect.objectContaining({ code: "analysis_missing" }));

    const first = analysis();
    expect(() => appendDecisionRecord(first.ledger, {
      workspaceRef: "workspace_foreign", occurredAt: "2026-08-07T12:01:00.000Z",
      analysisRecordRef: first.record.recordId, cadenceResultRef: "cadence_ref", disposition: "act",
      evidenceRefs: [], timelineRefs: [], guidanceRefs: [], experimentRef: null, rationaleCode: "eligible",
    })).toThrowError(expect.objectContaining({ code: "scope_mismatch" }));
    expect(() => appendDecisionRecord(first.ledger, {
      workspaceRef: first.record.workspaceRef, occurredAt: "2026-08-07T12:01:00.000Z",
      analysisRecordRef: first.record.recordId, cadenceResultRef: "cadence_ref", disposition: "act",
      evidenceRefs: [], timelineRefs: [], guidanceRefs: ["prompt_untrusted"], experimentRef: null,
      rationaleCode: "eligible", executionAuthority: "approval",
    } as never)).toThrowError(expect.objectContaining({ code: "invalid_input" }));

    const tampered = [{ ...first.record, recordHash: "0".repeat(64) }] as DecisionLedger;
    expect(verifyDecisionLedger(tampered)).toBe(false);
    expect(() => appendAnalysisRecord(tampered, {
      workspaceRef: first.record.workspaceRef, occurredAt: "2026-08-07T12:02:00.000Z",
      analysisDefinitionRef: "analysis_v2", effectiveContextRef: "context_v2",
      timelineRefs: [], evidenceRefs: [], frozenContext: {},
    })).toThrowError(expect.objectContaining({ code: "invalid_chain" }));

    const { recordId: _id, recordHash: _hash, ...body } = first.record;
    const maliciousBody = { ...body, executionAuthority: "approval" };
    const maliciousId = `analysis_${hash(maliciousBody).slice(0, 20)}`;
    const malicious = [{
      ...maliciousBody,
      recordId: maliciousId,
      recordHash: hash({ ...maliciousBody, recordId: maliciousId }),
    }] as unknown as DecisionLedger;
    expect(verifyDecisionLedger(malicious)).toBe(false);
  });

  it("rejects non-JSON, circular, or non-finite frozen context", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const frozenContext of [circular, { value: Number.NaN }, { value: () => true }]) {
      expect(() => appendAnalysisRecord([], {
        workspaceRef: "workspace_ref", occurredAt: "2026-08-07T12:00:00.000Z",
        analysisDefinitionRef: "analysis_ref", effectiveContextRef: "context_ref",
        timelineRefs: [], evidenceRefs: [], frozenContext,
      })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    }
  });

  it("rejects raw payloads, token fields, and embedded write/action authority", () => {
    for (const frozenContext of [
      { rawPayload: { id: "opaque" } },
      { accessToken: "secret" },
      { nested: { actionAuthority: true } },
      { nested: { executionAuthority: "granted" } },
      { nested: { writeEnabled: true } },
    ]) {
      expect(() => appendAnalysisRecord([], {
        workspaceRef: "workspace_ref", occurredAt: "2026-08-07T12:00:00.000Z",
        analysisDefinitionRef: "analysis_ref", effectiveContextRef: "context_ref",
        timelineRefs: [], evidenceRefs: [], frozenContext,
      })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    }
  });

  it("returns false instead of throwing for malformed or non-JSON ledger records", () => {
    const first = analysis();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(verifyDecisionLedger([{ ...first.record, recordType: "other" } as never])).toBe(false);
    expect(verifyDecisionLedger([{ ...first.record, actionAuthority: "approval" } as never])).toBe(false);
    expect(verifyDecisionLedger([{ ...first.record, frozenContext: circular } as never])).toBe(false);
    expect(verifyDecisionLedger([{ ...first.record, frozenContext: { bad: () => true } } as never])).toBe(false);
  });
});
