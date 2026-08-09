import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { loadProgressiveFormalization, loadProgressiveFormalizationPreview,
  parseProgressiveFormalizationPreview, parseProgressiveFormalizationSnapshot,
  runProgressiveFormalizationCommand } from "@/app/dashboard/progressive-formalization-panel";
import { advanceProgressiveFormalization, PROGRESSIVE_FORMALIZATION_VERSION } from
  "@/domain/guidance/progressive-formalization";

const g0 = advanceProgressiveFormalization(null, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION,
  transition: "capture_g0", workspaceRef: "workspace_test", formalizationRef: "formalization_test",
  occurredAt: "2026-08-10T00:00:00.000Z", actor: { actorRef: "actor_analyst", role: "analyst" },
  payload: { rawProvenanceRef: "source_owner_note", rawTextHash: createHash("sha256").update("note").digest("hex") } });
const actorAuthority = { canRead: true, canCapture: true, canScope: true, canReview: true, canPromote: true,
  canQualify: true, canApprove: false, canExecute: false, canWriteMeta: false, canSchedule: false, canCallTool: false } as const;
const snapshot = { contractVersion: "progressive-formalization-studio/1.0.0", registryHash: "a".repeat(64),
  flows: [{ formalizationRef: "formalization_test", level: "G0", headHash: g0.revisionHash, revisions: [g0] }],
  authority: actorAuthority } as const;
const preview = { contractVersion: "progressive-formalization-studio/1.0.0", target: "G3", formalizationRef: "formalization_test",
  headHash: g0.revisionHash, previewHash: "b".repeat(64), disposition: "blocked",
  blockers: ["production_policy_authority_catalog_unavailable"], normalizedDraft: null, g4Payload: null,
  evidence: { persistedGuidance: true, persistedPolicy: true, productionAuthoritySourceBound: false,
    historicalRunsEvaluated: 0 }, authority: { canApprove: false, canExecute: false, canWriteMeta: false,
    canSchedule: false, canCallTool: false }, actorAuthority } as const;

describe("progressive formalization dashboard boundary", () => {
  it("loads exact cookie-only registry and replays the immutable hash chain", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 }));
    await expect(loadProgressiveFormalization(request as unknown as typeof fetch)).resolves.toMatchObject({ flows: [{ level: "G0" }] });
    expect(request).toHaveBeenCalledWith("/api/progressive-formalization", { cache: "no-store", credentials: "same-origin",
      headers: { "X-ReklamZeka-Intent": "progressive-formalization-read" } });
    expect(() => parseProgressiveFormalizationSnapshot({ ...snapshot, flows: [{ ...snapshot.flows[0], headHash: "c".repeat(64) }] }))
      .toThrow("history doğrulanamadı");
  });

  it("rejects opened actor/revision authority and oversized projections", () => {
    expect(() => parseProgressiveFormalizationSnapshot({ ...snapshot, authority: { ...actorAuthority, canExecute: true } }))
      .toThrow("authority sınırı");
    expect(() => parseProgressiveFormalizationSnapshot({ ...snapshot, flows: Array.from({ length: 1001 }, () => snapshot.flows[0]) }))
      .toThrow("güvenli sözleşmeyle");
    expect(() => parseProgressiveFormalizationSnapshot({ ...snapshot, flows: [{ ...snapshot.flows[0], revisions: [{
      ...g0, authority: { ...g0.authority, canCallTool: true } }] }] })).toThrow();
  });

  it("loads fail-closed preview and rejects truthy production authority evidence expansion", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify(preview), { status: 200 }));
    await expect(loadProgressiveFormalizationPreview({ formalizationRef: "formalization_test", target: "G3",
      policyRef: "policy_test" }, request as unknown as typeof fetch)).resolves.toMatchObject({ disposition: "blocked" });
    expect(String((request.mock.calls as unknown as readonly (readonly unknown[])[])[0]![0]))
      .toContain("formalizationRef=formalization_test&target=G3&policyRef=policy_test");
    expect(() => parseProgressiveFormalizationPreview({ ...preview, authority: { ...preview.authority, canExecute: true } }))
      .toThrow("authority sınırı");
    expect(() => parseProgressiveFormalizationPreview({ ...preview, blockers: Array.from({ length: 33 }, () => "blocked") }))
      .toThrow("güvenli sözleşmeyle");
  });

  it("posts only the exact OCC command and verifies audit plus closed authority", async () => {
    const command = { operation: "capture_g0", expectedRegistryHash: "a".repeat(64),
      rawProvenanceRef: "source_owner_note" } as const;
    const safe = vi.fn(async () => new Response(JSON.stringify({ auditAppended: true, authority: actorAuthority }), { status: 200 }));
    await runProgressiveFormalizationCommand(command, safe as unknown as typeof fetch);
    expect(safe).toHaveBeenCalledWith("/api/progressive-formalization", expect.objectContaining({ method: "POST",
      credentials: "same-origin", headers: { "Content-Type": "application/json",
        "X-ReklamZeka-Intent": "progressive-formalization-mutate" }, body: JSON.stringify({ command }) }));
    const opened = vi.fn(async () => new Response(JSON.stringify({ auditAppended: true,
      authority: { ...actorAuthority, canWriteMeta: true } }), { status: 200 }));
    await expect(runProgressiveFormalizationCommand(command, opened as unknown as typeof fetch)).rejects.toThrow("authority sınırı");
  });
});
