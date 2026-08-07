import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  PromotionPreflightSurface,
  requestExistingPostPromotionPreflight,
  type PromotionPreflightCatalog,
} from "@/app/dashboard/promotion-preflight-panel";
import type {
  ExistingPostPromotionPreflightRequest,
  ExistingPostPromotionPreflightResult,
} from "@/application/existing-post-promotion-preflight-service";
import { POST as unavailablePreflightPost } from "@/app/api/existing-post-promotion-preflight/route";

const selection = {
  accountRef: "account_doruk",
  actorRef: "actor_doruk_ig",
  postRef: "post_existing_01",
  promotionTemplateRef: "promotion_template_leads",
  audiencePresetRef: "audience_preset_istanbul",
  budgetPlanRef: "budget_plan_daily",
  timeframeRef: "timeframe_seven_days",
  objectiveRef: "objective_leads",
  internalCategoryRef: "internal_category_hair",
} satisfies ExistingPostPromotionPreflightRequest;

const catalog = {
  accounts: [{ ref: selection.accountRef, label: "Doruk Hospital" }],
  actors: [{ ref: selection.actorRef, label: "@dorukhastaneleri · Instagram", accountRef: selection.accountRef, type: "instagram" }],
  posts: [{ ref: selection.postRef, label: "Yayınlanmış gönderi · 6 Ağu", actorRef: selection.actorRef }],
  templates: [{
    ref: selection.promotionTemplateRef,
    label: "Lead · mevcut IG gönderisi · v3",
    accountRefs: [selection.accountRef], actorRefs: [selection.actorRef],
    internalCategoryRefs: [selection.internalCategoryRef], objectiveRefs: [selection.objectiveRef],
    requiredAudiencePresetRef: selection.audiencePresetRef,
  }],
  audiencePresets: [{ ref: selection.audiencePresetRef, label: "İstanbul · Saç Ekimi · immutable v4" }],
  internalCategories: [{ ref: selection.internalCategoryRef, label: "Saç ekimi · İstanbul" }],
  objectives: [{ ref: selection.objectiveRef, label: "Lead" }],
  budgetPlans: [{ ref: selection.budgetPlanRef, label: "₺1.200 / gün" }],
  timeframes: [{ ref: selection.timeframeRef, label: "7 gün · Europe/Istanbul" }],
} satisfies PromotionPreflightCatalog;

const result = {
  contractVersion: "existing-post-promotion-public-preflight/1.0.0",
  status: "ready_for_approval_proposal",
  selection,
  reasons: [],
  proposalPreview: {
    previewRef: "promotion_preview_aaaaaaaaaaaaaaaaaaaa",
    actionType: "existing_post_promotion",
    risk: "K4",
    disposition: "approval_required",
    actorType: "instagram",
    postFingerprintRef: "post_fingerprint_aaaaaaaaaaaaaaaa",
    budget: { kind: "daily", currency: "TRY", amountMinor: 120_000 },
    timeframe: { startAt: "2026-08-08T06:00:00.000Z", endAt: "2026-08-15T06:00:00.000Z", timezone: "Europe/Istanbul", durationDays: 7 },
  },
  authority: { ephemeral: true, canPersistProposal: false, canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false },
} satisfies ExistingPostPromotionPreflightResult;

const callbacks = { onRetry: vi.fn(), onChange: vi.fn(), onEvaluate: vi.fn() };

describe("Existing-post promotion preflight dashboard", () => {
  it("fails closed without a trusted option catalog and never renders mock selectors", () => {
    const html = renderToStaticMarkup(createElement(PromotionPreflightSurface, {
      ...callbacks,
      state: { status: "unavailable", message: "Katalog bağlı değil." },
    }));
    expect(html).toContain("Kaynak henüz bağlı değil");
    expect(html).toContain("uydurulmaz");
    expect(html).toContain("Meta write ve proposal persistence kapalı");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("type=\"text\"");
  });

  it("uses only server-provided options and exposes no raw targeting or creative editor", () => {
    const html = renderToStaticMarkup(createElement(PromotionPreflightSurface, {
      ...callbacks,
      state: { status: "ready", catalog, selection, result: null, evaluating: false, message: null },
    }));
    expect(html).toContain("Doruk Hospital");
    expect(html).toContain("Yayınlanmış gönderi · 6 Ağu");
    expect(html).toContain("İstanbul · Saç Ekimi · immutable v4");
    expect(html).toContain("Hedef kitle preset’i şablon tarafından zorunlu tutulur");
    expect(html).toContain("K4 ön kontrolünü çalıştır");
    expect(html).not.toContain("type=\"text\"");
    expect(html).not.toContain("Kreatif metni");
    expect(html).not.toContain("İlgi alanı ekle");
    expect(callbacks.onEvaluate).not.toHaveBeenCalled();
  });

  it("shows exact before-after context and keeps every action capability visibly closed", () => {
    const html = renderToStaticMarkup(createElement(PromotionPreflightSurface, {
      ...callbacks,
      state: { status: "ready", catalog, selection, result, evaluating: false, message: null },
    }));
    expect(html).toContain("Mevcut gönderi · değişmez");
    expect(html).toContain("K4 reklam önerisi · approval_required");
    expect(html).toContain("₺1.200");
    expect(html).toContain(selection.promotionTemplateRef);
    expect(html).toContain(selection.audiencePresetRef);
    expect(html).toContain("Persist: kapalı");
    expect(html).toContain("Approval: kapalı");
    expect(html).toContain("Execute: kapalı");
    expect(html).toContain("Meta write: kapalı");
    expect(html).toContain("Creative generation: kapalı");
    expect(html).not.toContain(">Onayla<");
  });

  it("posts one exact ref-only selection and rejects an unsafe authority response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
    await expect(requestExistingPostPromotionPreflight(fetcher as typeof fetch, selection)).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith("/api/existing-post-promotion-preflight", expect.objectContaining({
      method: "POST", credentials: "same-origin",
      headers: expect.objectContaining({ "X-ReklamZeka-Intent": "existing-post-promotion-preflight" }),
      body: JSON.stringify({ selection }),
    }));

    const unsafe = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...result, authority: { ...result.authority, canWriteMeta: true } }), { status: 200 }));
    await expect(requestExistingPostPromotionPreflight(unsafe as typeof fetch, selection)).rejects.toThrow("Güvenli preflight sözleşmesi doğrulanamadı");
  });

  it("keeps the runtime route fail-closed until a trusted catalog repository is configured", async () => {
    const response = unavailablePreflightPost();
    expect(response.status).toBe(503);
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "source_not_configured" },
      authority: { canPersist: false, canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false },
    });
  });
});
