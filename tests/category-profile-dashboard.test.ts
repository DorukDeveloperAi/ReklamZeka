import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildCategoryProfileCommand, CategoryProfileStudioView, loadCategoryProfileStudioSnapshot,
  parseCategoryProfileStudioSnapshot, runCategoryProfileMutation } from "@/app/dashboard/category-profile-studio";

const hash = "a".repeat(64); const profileHash = "b".repeat(64);
const definitionRef = `category_${"1".repeat(24)}`; const parentRef = `category_${"2".repeat(24)}`;
const dimensionRef = `dimension_${"3".repeat(24)}`;
const bindings = { analysisPlaybookRefs: ["analysis_playbook_health"],
  ruleInstructionBundleRefs: ["instruction_bundle_health"], budgetPolicyRefs: ["budget_policy_health"],
  transferPolicyRefs: ["transfer_policy_health"], schedulePolicyRefs: ["schedule_policy_health"],
  actionPolicyRefs: ["guardrail_health"], creativePolicyRefs: ["creative_policy_health"] } as const;
const profile = { schemaVersion: "category-profile/1.0.0", workspaceRef: "workspace_test",
  profileRef: "category_profile_cardiology", categoryRef: definitionRef, parentCategoryRef: parentRef,
  version: 2, previousProfileHash: "c".repeat(64), label: "Kardiyoloji", description: "Kalp sağlığı",
  color: "#A31F34", ownerRef: "actor_owner", status: "draft", bindings,
  authority: { canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false, canGrantApproval: false },
  profileHash } as const;
const ownerAuthority = { canRead: true, canCreate: true, canRevise: true, canPublish: true, canPause: true,
  canArchive: true, canPublishPolicy: false, canAuthorizeAction: false, canExecute: false, canWriteMeta: false } as const;
const payload = { contractVersion: "category-profile-lifecycle/1.0.0", registryHash: hash,
  definitions: [{ dimensionRef, dimensionKey: "service_line", definitionRef, label: "Kardiyoloji",
    description: "Kategori", currentProfile: profile }, { dimensionRef, dimensionKey: "service_line",
    definitionRef: parentRef, label: "Sağlık", description: null, currentProfile: null }], authority: ownerAuthority } as const;

describe("CategoryProfile authoring dashboard", () => {
  it("loads through the cookie-only profile read contract and accepts only closed authority", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    await expect(loadCategoryProfileStudioSnapshot(request as unknown as typeof fetch)).resolves.toMatchObject({ registryHash: hash });
    expect(request).toHaveBeenCalledWith("/api/category-profiles", { cache: "no-store", credentials: "same-origin",
      headers: { "X-ReklamZeka-Intent": "category-profile-read" } });
    expect(() => parseCategoryProfileStudioSnapshot({ ...payload,
      authority: { ...ownerAuthority, canPublishPolicy: true } })).toThrow("güvenli sözleşmeyi");
    expect(() => parseCategoryProfileStudioSnapshot({ ...payload, definitions: [{ ...payload.definitions[0],
      currentProfile: { ...profile, authority: { ...profile.authority, canExecuteWrite: true } } }] }))
      .toThrow("güvenli sözleşmeyi");
  });

  it("caps response collections and rejects wrong opaque-ref prefixes", () => {
    expect(() => parseCategoryProfileStudioSnapshot({ ...payload,
      definitions: Array(20_001).fill(payload.definitions[0]) })).toThrow("güvenli sözleşmeyi");
    expect(() => parseCategoryProfileStudioSnapshot({ ...payload, definitions: [{ ...payload.definitions[0],
      currentProfile: { ...profile, workspaceRef: "tenant_test" } }, payload.definitions[1]] }))
      .toThrow("güvenli sözleşmeyi");
    expect(() => parseCategoryProfileStudioSnapshot({ ...payload, definitions: [{ ...payload.definitions[0],
      currentProfile: { ...profile, ownerRef: "reader_owner" } }, payload.definitions[1]] }))
      .toThrow("güvenli sözleşmeyi");
    expect(() => parseCategoryProfileStudioSnapshot({ ...payload, definitions: [{ ...payload.definitions[0],
      currentProfile: { ...profile, bindings: { ...bindings,
        budgetPolicyRefs: ["creative_policy_wrong_bundle"] } } }, payload.definitions[1]] }))
      .toThrow("güvenli sözleşmeyi");
    expect(() => parseCategoryProfileStudioSnapshot({ ...payload, definitions: [{ ...payload.definitions[0],
      currentProfile: { ...profile, bindings: { ...bindings,
        analysisPlaybookRefs: Array.from({ length: 65 }, (_, index) => `analysis_playbook_${index}`) } } },
    payload.definitions[1]] })).toThrow("güvenli sözleşmeyi");
  });

  it("shows all seven typed bundles, OCC lifecycle and the non-atomic definition boundary", () => {
    const html = renderToStaticMarkup(createElement(CategoryProfileStudioView, {
      snapshot: parseCategoryProfileStudioSnapshot(payload), onReload: vi.fn(async () => undefined),
    }));
    expect(html).toContain("CATEGORY PROFILE AUTHORING");
    expect(html).toContain("7 typed policy ref bundle alanı");
    for (const label of ["Analysis playbook", "Rule / instruction", "Budget policy", "Transfer policy",
      "Schedule / cadence", "Action / guardrail", "Creative policy"]) expect(html).toContain(label);
    expect(html).toContain("kategori tanımı ve profil ayrı mutation’lardır");
    expect(html).toContain("Profili yayınla"); expect(html).toContain("Arşivle");
    expect(html).not.toContain("Meta&#x27;ya yaz");
  });

  it("builds exact profile OCC commands and keeps analyst/viewer mutations closed", () => {
    const snapshot = parseCategoryProfileStudioSnapshot(payload); const definition = snapshot.definitions[0]!;
    const draft = { parentDefinitionRef: parentRef, label: "Kardiyoloji", description: "Kalp sağlığı",
      color: "#A31F34", bindings: Object.fromEntries(Object.entries(bindings).map(([key, refs]) =>
        [key, refs.join("\n")])) as never };
    expect(buildCategoryProfileCommand(snapshot, definition, draft, "revise_draft")).toMatchObject({
      operation: "revise_draft", profileRef: profile.profileRef, expectedVersion: 2,
      expectedProfileHash: profileHash, expectedRegistryHash: hash, parentDefinitionRef: parentRef, bindings });
    const viewer = { ...snapshot, authority: { ...ownerAuthority, canCreate: false, canRevise: false,
      canPublish: false, canPause: false, canArchive: false } };
    expect(buildCategoryProfileCommand(viewer, definition, draft, "publish")).toBeNull();
    const html = renderToStaticMarkup(createElement(CategoryProfileStudioView,
      { snapshot: viewer, onReload: vi.fn(async () => undefined) }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Profili yayınla<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Arşivle<\/button>/);
  });

  it("posts only the exact mutation envelope and rejects opened response authority", async () => {
    const command = { operation: "publish" as const, profileRef: profile.profileRef, expectedVersion: 2,
      expectedProfileHash: profileHash, expectedRegistryHash: hash, reasonCode: "owner_reviewed" };
    const safe = vi.fn().mockResolvedValue(new Response(JSON.stringify({ contractVersion: payload.contractVersion,
      state: { registryHash: hash, definitions: [] }, profile, auditAppended: true, invalidationsAppended: 1,
      authority: ownerAuthority, canPublishPolicy: false, canAuthorizeAction: false, canExecute: false,
      canWriteMeta: false }), { status: 200 }));
    await runCategoryProfileMutation(command, safe as unknown as typeof fetch);
    expect(safe).toHaveBeenCalledWith("/api/category-profiles", expect.objectContaining({ method: "POST",
      credentials: "same-origin", headers: { "Content-Type": "application/json",
        "X-ReklamZeka-Intent": "category-profile-mutate" }, body: JSON.stringify({ command }) }));
    const opened = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authority: ownerAuthority,
      canPublishPolicy: false, canAuthorizeAction: true, canExecute: false, canWriteMeta: false }), { status: 200 }));
    await expect(runCategoryProfileMutation(command, opened as unknown as typeof fetch)).rejects.toThrow("authority sınırını");
  });
});
