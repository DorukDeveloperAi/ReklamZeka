import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CampaignPlanningBriefPanel,
  campaignBriefScenario,
  campaignContextTimelineSourceState,
  campaignOperationalTimelineFromResponse,
  campaignDecisionTimeline,
  decisionTimelineFromApprovalQueueResponse,
  draftOnlyPolicyTemplateForBrief,
  type CampaignPlanningBriefContext,
} from "@/app/dashboard/campaign-planning-brief-panel";

const gccContext: CampaignPlanningBriefContext = Object.freeze({
  campaignRef: "cmp_gcc",
  campaignLabel: "Arap Bölgesi · FTR · WhatsApp",
  input: Object.freeze({ businessGoal: "lead_acquisition", market: "international", language: "ar", serviceRef: "service_physical_therapy_rehab", campaignFamilyRef: "campaign_family_intensive_ftr", countryOrRegion: "Arap Bölgesi", conversionRoute: "whatsapp", deliveryHealth: "healthy", classification: "classified", capacity: "confirmed", creativeReady: true }),
});

describe("campaign planning brief panel", () => {
  it("surfaces the taxonomy-driven, proposal-only interactive brief without any action control", () => {
    const html = renderToStaticMarkup(createElement(CampaignPlanningBriefPanel));
    expect(html).toContain("Taslak kampanya briefi");
    expect(html).toContain("pazar → dil → hizmet → iş amacı → dönüşüm yolu → kapasite/kreatif");
    expect(html).toContain("Nitelikli form talebi");
    expect(html).toContain("SALT-OKUNUR ÖNERİ");
    expect(html).toContain("Seçili bağlam kalıcı kaynağa bağlı değil");
    expect(html).toContain("Kampanya yapısını insan incelemesine alın");
    expect(html).toContain("Şablon ve kıyas sınırı");
    expect(html).toContain("domestic_form_lead");
    expect(html).toContain("OPERATÖR ÇALIŞMA NOTLARI");
    expect(html).toContain("UYGULANAN KURAL TASLAKLARI");
    expect(html).toContain("Yerli/yabancı pazar sınırı");
    expect(html).toContain("Teklif / değer önerisi");
    expect(html).toContain("Hedefleme yaklaşımı");
    expect(html).toContain("Yayın platformu");
    expect(html).toContain("İsimden türetilmez");
    expect(html).toContain("Nitelikli lead tanımı");
    expect(html).toContain("Kaydedilmez, Guidance/Strict Policy alanına aktarılmaz; hiçbir uygulama yetkisi vermez");
    expect(html).toContain("campaign create / publish / approval / execute / Meta write: kapalı");
    expect(html).not.toMatch(/Meta.{0,30}(yaz|write).{0,30}(başlat|çalıştır|onayla)/i);
    expect(html).not.toContain("İş amacını bu sinyalle eşle");
    expect(html).not.toContain("KARAR ZAMAN ÇİZELGESİ");
  });

  it("starts from the selected campaign context and keeps context reset proposal-only", () => {
    const html = renderToStaticMarkup(createElement(CampaignPlanningBriefPanel, { context: gccContext }));
    expect(html).toContain("Seçili bağlam: Arap Bölgesi · FTR · WhatsApp");
    expect(html).toContain("CONTEXT BOUND");
    expect(html).toContain("Nitelikli WhatsApp talebi");
    expect(html).toContain("ayrı proposal/onay akışına geçin");
    expect(html).toContain("Bağlamı geri yükle");
    expect(html).toContain("international_whatsapp_lead");
    expect(html).toContain("Kıyas/değerlendirme kümesi");
    expect(html).toContain("Sistem kampanyayı tahminle bu gruba katmaz");
    expect(html).not.toContain("Meta transport");
  });

  it("can begin from an offline workbook scenario without creating a persisted campaign instruction", () => {
    const html = renderToStaticMarkup(createElement(CampaignPlanningBriefPanel, {
      context: gccContext,
      initialScenarioRef: "international_ru_form",
    }));
    expect(html).toContain("Uluslararası · RU form · FTR");
    expect(html).toContain("Nitelikli form talebi");
    expect(html).toContain("campaign create / publish / approval / execute / Meta write: kapalı");
  });

  it("offers workbook-derived scenarios without joining their comparison lanes", () => {
    expect(campaignBriefScenario("international_ar_whatsapp")).toMatchObject({ label: "Uluslararası · AR WhatsApp · FTR",
      input: { market: "international", language: "ar", conversionRoute: "whatsapp", serviceRef: "service_physical_therapy_rehab", campaignFamilyRef: "campaign_family_intensive_ftr" } });
    expect(campaignBriefScenario("international_ru_form")).toMatchObject({ input: { language: "ru", conversionRoute: "lead_form" } });
    expect(campaignBriefScenario("delivery_recovery")?.input.deliveryHealth).toBe("interrupted");
    expect(campaignBriefScenario("")).toBeNull();
    const html = renderToStaticMarkup(createElement(CampaignPlanningBriefPanel));
    expect(html).toContain("Çalışma kitabı senaryosu");
    expect(html).toContain("Uluslararası · AR WhatsApp · FTR");
    expect(html).toContain("Uluslararası · RU form · FTR");
  });

  it("offers an explicit draft-only handoff without transferring campaign state", () => {
    const html = renderToStaticMarkup(createElement(CampaignPlanningBriefPanel, {
      context: gccContext,
      onOpenDraftOnlyPolicy: () => undefined,
    }));
    expect(html).toContain("Taslak talimat alanını aç");
    expect(html).toContain("campaign create / publish / approval / execute / Meta write: kapalı");
  });

  it("maps only the brief condition to a draft-only template preference", () => {
    expect(draftOnlyPolicyTemplateForBrief(gccContext.input)).toBe("lead_quality");
    expect(draftOnlyPolicyTemplateForBrief({ ...gccContext.input, deliveryHealth: "interrupted" })).toBe("delivery_recovery");
    expect(draftOnlyPolicyTemplateForBrief({ ...gccContext.input, businessGoal: "upper_funnel_education" })).toBe("new_campaign_plan");
  });

  it("only projects a campaign-matching, read-only approval list into the decision timeline", () => {
    const campaignRef = "entity_abcdef0123456789";
    const response = {
      contractVersion: "approval-queue-read-model/1.2.0",
      view: "list",
      entityRef: null,
      campaignRef,
      items: [{
        unitRef: "action_unit_abcdef0123456789abcd",
        bundleRef: null,
        status: "awaiting_approval",
        risk: "K2",
        actionType: "budget_decrease",
        accountRef: "account_abcdef0123456789",
        campaignRef,
        entity: { type: "campaign", ref: campaignRef, label: "Campaign" },
        beforeAfter: { field: "configured_status", before: "ACTIVE", after: "PAUSED" },
        autonomy: { profileRef: "autonomy_abcdef0123456789", decision: "approval_required", trace: [{ scope: "risk", decision: "approval_required", reasonCode: "policy_limit" }] },
        expiresAt: "2026-08-12T10:00:00.000Z",
        createdAt: "2026-08-11T10:00:00.000Z",
        dependencies: [],
        summaryCode: "safe_summary",
      }],
      nextCursor: null,
      authority: { readOnly: true, canApprove: false, canReject: false, canRequestChanges: false, canGrant: false, canExecute: false, canWriteMeta: false },
    };
    const approval = decisionTimelineFromApprovalQueueResponse(response, campaignRef);
    expect(approval).toEqual({ itemCount: 1, latestStatus: "awaiting_approval" });
    expect(campaignDecisionTimeline({ sourceState: "ready", approvalState: "ready", approval }).map((stage) => stage.title)).toEqual([
      "Frozen kampanya bağlamı", "Deterministik brief ve öneri", "Persisted insan onayı", "Uygulama güvenliği",
    ]);
    expect(campaignDecisionTimeline({ sourceState: "ready", approvalState: "ready", approval })[3]?.detail).toContain("Kapalı");
  });

  it("fails closed for a malformed, cross-campaign, or write-capable approval response", () => {
    const campaignRef = "entity_abcdef0123456789";
    const base = {
      contractVersion: "approval-queue-read-model/1.2.0", view: "list", entityRef: null, campaignRef, items: [], nextCursor: null,
      authority: { readOnly: true, canApprove: false, canReject: false, canRequestChanges: false, canGrant: false, canExecute: false, canWriteMeta: false },
    };
    expect(decisionTimelineFromApprovalQueueResponse({ ...base, authority: { ...base.authority, canExecute: true } }, campaignRef)).toBeNull();
    expect(decisionTimelineFromApprovalQueueResponse({ ...base, campaignRef: "entity_0000000000000000" }, campaignRef)).toBeNull();
    expect(decisionTimelineFromApprovalQueueResponse({ ...base, unexpected: true }, campaignRef)).toBeNull();
  });

  it("distinguishes an authentic empty context from a malformed successful response", () => {
    const campaignRef = "ref_abcdef012345";
    const empty = { contractVersion: "campaign-context-read-model/1.1.0", view: "empty", campaignRef, writeOperations: 0 };
    expect(campaignContextTimelineSourceState(true, empty, campaignRef)).toBe("empty");
    expect(campaignContextTimelineSourceState(true, { ...empty, writeOperations: 1 }, campaignRef)).toBe("unavailable");
    expect(campaignContextTimelineSourceState(true, { ...empty, unexpected: true }, campaignRef)).toBe("unavailable");
  });
  it("accepts only an ordered, authority-closed campaign operational trace", () => {
    const response = {
      contractVersion: "operational-timeline/1.0.0", items: [
        { kind: "approval_decision", occurredAt: "2026-08-13T12:00:00.000Z", title: "İnsan kararı kaydedildi", detail: "approve · human confirmed" },
        { kind: "budget_proposal", occurredAt: "2026-08-13T11:00:00.000Z", title: "Bütçe önerisi taslağı kaydedildi", detail: "Revizyon 1 · uygulama yetkisi yok" },
      ], authority: { readOnly: true, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false },
    };
    expect(campaignOperationalTimelineFromResponse(response)).toHaveLength(2);
    expect(campaignOperationalTimelineFromResponse({ ...response, items: [...response.items].reverse() })).toBeNull();
    expect(campaignOperationalTimelineFromResponse({ ...response, authority: { ...response.authority, canExecute: true } })).toBeNull();
    expect(campaignOperationalTimelineFromResponse({ ...response, items: [{ ...response.items[0], kind: "delivery_alert" }] })).toBeNull();
  });
});
