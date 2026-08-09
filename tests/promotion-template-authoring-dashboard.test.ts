import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  PromotionTemplateAuthoringSurface,
  requestPromotionTemplateAuthoringCatalog,
  requestPromotionTemplateAuthoringDryRun,
} from "@/app/dashboard/promotion-preflight-panel";
import {
  PROMOTION_TEMPLATE_AUTHORING_VERSION,
  type PromotionTemplateAuthoringInspection,
  type PromotionTemplateAuthoringSelection,
} from "@/application/promotion-template-authoring";

const scopeRef = "promotion_scope_aaaaaaaaaaaaaaaaaaaaaaaa";
const selection: PromotionTemplateAuthoringSelection = {
  scopeRef,
  postType: "image",
  instruction: "Saç ekimi gönderisini öne çıkar",
};
const capabilities = {
  canRead: true, canDryRun: true, canPersistDraft: false, canPublish: false, canWriteMeta: false,
  canChangeTargeting: false, canGenerateCreative: false, canProposeAction: false, canGrantApproval: false,
} as const;
const lifecycle = {
  draftPersistence: "unavailable", publishMutation: "unavailable",
  blocker: "immutable_registry_has_no_authoring_occ_audit_lifecycle",
} as const;
const inspection = {
  contractVersion: PROMOTION_TEMPLATE_AUTHORING_VERSION,
  role: "analyst",
  capabilities,
  lifecycle,
  catalog: { scopes: [{ scopeRef, label: "Kapsam 1 · Instagram · 1 kategori", actorType: "instagram",
    categoryCount: 1, postTypes: ["image", "reel"], instructionAliases: ["Saç ekimi gönderisini öne çıkar"] }] },
} satisfies PromotionTemplateAuthoringInspection;
const result = {
  version: "promotion-template-selector/1.0.0",
  status: "recommended",
  dryRunOnly: true,
  publishReady: true,
  recommendation: {
    promotionTemplate: { templateRef: "template_hair", revision: 4,
      versionRef: "promotion_template_version_aaaaaaaaaaaaaaaaaaaaaaaa" },
    audiencePreset: { presetRef: "audience_hair", revision: 2,
      versionRef: "audience_preset_version_bbbbbbbbbbbbbbbbbbbbbbbb" },
  },
  reasons: [{ code: "published_registry_integrity_verified", outcome: "verified", candidateCount: 1 },
    { code: "unique_deterministic_match", outcome: "verified", candidateCount: 1 }],
  questions: [],
  capabilities: { canPublish: false, canPersist: false, canWriteMeta: false, canChangeTargeting: false,
    canGenerateCreative: false, canProposeAction: false, canGrantApproval: false },
  selectionHash: "c".repeat(64),
} as const;

describe("PromotionTemplate authoring dashboard", () => {
  it("renders only server-issued scope, media and instruction controls with the lifecycle boundary visible", () => {
    const html = renderToStaticMarkup(createElement(PromotionTemplateAuthoringSurface, {
      state: { status: "ready", inspection, selection, result, evaluating: false, message: null },
      onRetry: vi.fn(), onChange: vi.fn(), onEvaluate: vi.fn(),
    }));
    expect(html).toContain("Alias ve talimattan güvenli şablon önerisi");
    expect(html).toContain("Kapsam 1 · Instagram · 1 kategori");
    expect(html).toContain("Promotion template alias veya talimatı");
    expect(html).toContain("promotion_template_version_aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(html).toContain("Draft persist: kapalı");
    expect(html).toContain("Publish: kapalı");
    expect(html).toContain("Targeting/creative: kapalı");
    expect(html).not.toContain("account_doruk");
    expect(html).not.toContain("actor_doruk");
    expect(html).not.toContain("category_hair");
    expect(html).not.toContain("Hedefleme ekle");
  });

  it("keeps viewer read-only and unresolved questions explicit", () => {
    const viewerInspection = { ...inspection, role: "viewer" as const,
      capabilities: { ...capabilities, canDryRun: false as const } };
    const viewer = renderToStaticMarkup(createElement(PromotionTemplateAuthoringSurface, {
      state: { status: "ready", inspection: viewerInspection, selection: { scopeRef: null, postType: null, instruction: null },
        result: null, evaluating: false, message: null }, onRetry: vi.fn(), onChange: vi.fn(), onEvaluate: vi.fn(),
    }));
    expect(viewer).toContain("Viewer rolü salt okunurdur");
    expect(viewer).toMatch(/<button disabled=""[^>]*>Template dry-run çalıştır<\/button>/);

    const unresolved = renderToStaticMarkup(createElement(PromotionTemplateAuthoringSurface, {
      state: { status: "ready", inspection, selection, result: { ...result, status: "ambiguous", publishReady: false,
        recommendation: null, reasons: [{ code: "equal_ranked_match", outcome: "blocked", candidateCount: 2 }],
        questions: [{ code: "selector_ambiguous", field: "instruction", prompt: "Alias'ı netleştirin." }],
        selectionHash: "d".repeat(64) }, evaluating: false, message: null },
      onRetry: vi.fn(), onChange: vi.fn(), onEvaluate: vi.fn(),
    }));
    expect(unresolved).toContain("Alias belirsiz");
    expect(unresolved).toContain("Alias&#x27;ı netleştirin.");
  });

  it("uses same-origin cookie fetches and rejects authority or targeting-shaped response drift", async () => {
    const get = vi.fn().mockResolvedValue(new Response(JSON.stringify(inspection), { status: 200 }));
    await expect(requestPromotionTemplateAuthoringCatalog(get as typeof fetch)).resolves.toEqual(inspection);
    expect(get).toHaveBeenCalledWith("/api/promotion-template-authoring", expect.objectContaining({
      method: "GET", credentials: "same-origin", headers: { "X-ReklamZeka-Intent": "promotion-template-authoring-read" },
    }));
    const envelope = { contractVersion: PROMOTION_TEMPLATE_AUTHORING_VERSION, result, role: "analyst", capabilities, lifecycle };
    const post = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 }));
    await expect(requestPromotionTemplateAuthoringDryRun(post as typeof fetch, selection)).resolves.toEqual(envelope);
    expect(post).toHaveBeenCalledWith("/api/promotion-template-authoring", expect.objectContaining({
      method: "POST", credentials: "same-origin", body: JSON.stringify({ selection }),
      headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "promotion-template-authoring-dry-run" },
    }));
    const unsafeAuthority = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...envelope,
      capabilities: { ...capabilities, canPublish: true } }), { status: 200 }));
    await expect(requestPromotionTemplateAuthoringDryRun(unsafeAuthority as typeof fetch, selection)).rejects.toThrow("Güvenli");
    const unsafeTargeting = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...inspection,
      catalog: { ...inspection.catalog, targeting: {} } }), { status: 200 }));
    await expect(requestPromotionTemplateAuthoringCatalog(unsafeTargeting as typeof fetch)).rejects.toThrow("Güvenli");
  });
});
