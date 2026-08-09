import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildInstructionPolicyMutation, InstructionPolicyStudioView,
  loadInstructionPolicyStudioSnapshot, parseInstructionPolicyStudioSnapshot,
  runInstructionPolicyMutation } from "@/app/dashboard/instruction-policy-studio-panel";

const hash = "a".repeat(64);
const policyHash = "b".repeat(64);
const rawHash = "c".repeat(64);
const policy = {
  dslVersion: "strict-instruction-policy/1.0.0", workspaceRef: "workspace_test",
  policyRef: "policy_budget_floor", policyVersion: 1, previousVersionHash: null,
  policyType: "prohibition", owner: { actorRef: "actor_owner", role: "owner" }, status: "draft",
  reasonCode: "owner_instruction", priority: 80, effectiveDates: { from: "2026-08-09T00:00:00.000Z", until: null },
  scope: { global: true, accountGroupRefs: [], accountRefs: [], objectiveRefs: [], internalCategoryRefs: [],
    entities: [], topicRefs: [] }, source: { rawProvenanceRef: "provenance_budget_floor", rawTextHash: rawHash,
    promotedFromGuidanceRefs: [] }, clause: { kind: "prohibition", operations: ["budget_transfer"] },
  authority: { canExecute: false, canWriteMeta: false, canApprove: false, canSchedule: false,
    canCallTool: false, canAccessNetwork: false, canQuerySql: false }, canonicalHash: policyHash,
} as const;
const revision = { policy, rawProvenance: { provenanceRef: "provenance_budget_floor",
  rawText: "Bütçeyi başka kategoriye transfer etme.", rawTextHash: rawHash,
  capturedByActorRef: "actor_owner", capturedAt: "2026-08-09T00:00:00.000Z" },
recordedAt: "2026-08-09T00:00:00.000Z" } as const;
const ownerAuthority = { canRead: true, canDraft: true, canPublish: true, canPause: true, canArchive: true,
  canApprove: false, canExecute: false, canWriteMeta: false, canSchedule: false, canCallTool: false } as const;
const payload = { contractVersion: "instruction-policy-lifecycle/1.0.0", registryHash: hash,
  current: [revision], history: [revision], diffs: [{ policyRef: policy.policyRef, fromVersion: 1,
    toVersion: 2, changedPaths: ["clause.operations"] }], authority: ownerAuthority } as const;

describe("A09 strict policy Studio dashboard", () => {
  it("loads through the cookie-only exact read contract", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    await expect(loadInstructionPolicyStudioSnapshot(request as unknown as typeof fetch)).resolves.toMatchObject({
      registryHash: hash, authority: ownerAuthority,
    });
    expect(request).toHaveBeenCalledWith("/api/instruction-policies", { cache: "no-store", credentials: "same-origin",
      headers: { "X-ReklamZeka-Intent": "instruction-policy-read" } });
  });

  it("rejects opened or unknown authority in server projections", () => {
    expect(() => parseInstructionPolicyStudioSnapshot({ ...payload, authority: { ...ownerAuthority,
      canExecute: true } })).toThrow("güvenli sözleşmeyi");
    expect(() => parseInstructionPolicyStudioSnapshot({ ...payload, current: [{ ...revision,
      policy: { ...policy, canCallTool: true } }] })).toThrow("güvenli sözleşmeyi");
    expect(() => parseInstructionPolicyStudioSnapshot({ ...payload, current: [{ ...revision,
      policy: { ...policy, authority: { ...policy.authority, canAccessNetwork: true } } }] }))
      .toThrow("güvenli sözleşmeyi");
  });

  it("renders raw, normalized, history and diff without inventing dependency impact", () => {
    const html = renderToStaticMarkup(createElement(InstructionPolicyStudioView, {
      snapshot: parseInstructionPolicyStudioSnapshot(payload), onReload: vi.fn(async () => undefined),
    }));
    expect(html).toContain("STRICT POLICY STUDIO");
    expect(html).toContain("Bütçeyi başka kategoriye transfer etme");
    expect(html).toContain("clause.operations");
    expect(html).toContain("Dependency impact: henüz hesaplanmadı");
    expect(html).toContain("Yayınla");
    expect(html).toContain("Arşivle");
    expect(html).not.toContain("Meta&#x27;ya yaz");
  });

  it("keeps analyst publishing and viewer authoring closed", () => {
    const snapshot = parseInstructionPolicyStudioSnapshot(payload);
    const analyst = { ...snapshot, authority: { ...ownerAuthority, canPublish: false, canPause: false, canArchive: false } };
    expect(buildInstructionPolicyMutation({ operation: "publish", snapshot: analyst,
      selected: revision, reasonCode: "analyst_publish" })).toBeNull();
    expect(buildInstructionPolicyMutation({ operation: "revise_draft", snapshot: analyst, selected: revision,
      rawText: "Yeni ham talimat", policy: {} })).toMatchObject({ operation: "revise_draft", expectedPolicyHash: policyHash });
    const viewer = { ...snapshot, authority: { ...ownerAuthority, canDraft: false, canPublish: false,
      canPause: false, canArchive: false } };
    expect(buildInstructionPolicyMutation({ operation: "create_draft", snapshot: viewer,
      selected: null, rawText: "Talimat", policy: {} })).toBeNull();
    const html = renderToStaticMarkup(createElement(InstructionPolicyStudioView,
      { snapshot: viewer, onReload: vi.fn(async () => undefined) }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\+ Yeni taslak<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Yayınla<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Arşivle<\/button>/);
  });

  it("posts only the exact OCC command and rejects an opened mutation response", async () => {
    const snapshot = parseInstructionPolicyStudioSnapshot(payload);
    const command = buildInstructionPolicyMutation({ operation: "publish", snapshot, selected: revision,
      reasonCode: "owner_reviewed" });
    expect(command).not.toBeNull();
    const safe = vi.fn().mockResolvedValue(new Response(JSON.stringify({ contractVersion: payload.contractVersion,
      state: { registryHash: hash, current: [], history: [], diffs: [] }, auditAppended: true,
      contextInvalidationAppended: true, authority: ownerAuthority, canApprove: false, canExecute: false,
      canWriteMeta: false }), { status: 200 }));
    await runInstructionPolicyMutation(command!, safe as unknown as typeof fetch);
    expect(safe).toHaveBeenCalledWith("/api/instruction-policies", expect.objectContaining({ method: "POST",
      credentials: "same-origin", headers: { "Content-Type": "application/json",
        "X-ReklamZeka-Intent": "instruction-policy-mutate" }, body: JSON.stringify({ command }) }));
    const opened = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authority: ownerAuthority,
      canApprove: false, canExecute: true, canWriteMeta: false }), { status: 200 }));
    await expect(runInstructionPolicyMutation(command!, opened as unknown as typeof fetch)).rejects.toThrow("authority sınırını");
  });
});
