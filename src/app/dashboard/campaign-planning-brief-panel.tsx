"use client";

import { useMemo, useState } from "react";

import {
  createInteractiveCampaignBrief,
  type CampaignBusinessGoal,
  type CampaignMarket,
  type CapacityState,
  type ClassificationState,
  type ConversionRoute,
  type DeliveryHealth,
  type InteractiveCampaignTemplateRequest,
} from "@/domain/campaigns/interactive-campaign-template";
import styles from "./operating-dashboard.module.css";

type BriefDraft = Readonly<{
  businessGoal: CampaignBusinessGoal;
  market: CampaignMarket;
  language: string | null;
  serviceRef: string | null;
  countryOrRegion: string | null;
  conversionRoute: ConversionRoute;
  deliveryHealth: DeliveryHealth;
  classification: ClassificationState;
  capacity: CapacityState;
  creativeReady: boolean;
}>;

const INITIAL_DRAFT: BriefDraft = Object.freeze({
  businessGoal: "lead_acquisition",
  market: "domestic",
  language: "tr",
  serviceRef: "service_medical_aesthetics",
  countryOrRegion: null,
  conversionRoute: "lead_form",
  deliveryHealth: "healthy",
  classification: "classified",
  capacity: "confirmed",
  creativeReady: true,
});

export type CampaignPlanningBriefContext = Readonly<{
  campaignRef: string;
  campaignLabel: string;
  input: InteractiveCampaignTemplateRequest;
}>;

const DEFAULT_CONTEXT: CampaignPlanningBriefContext = Object.freeze({
  campaignRef: "new_campaign_draft",
  campaignLabel: "Yeni kampanya taslağı",
  input: INITIAL_DRAFT,
});

const goalLabels: Readonly<Record<CampaignBusinessGoal, string>> = Object.freeze({
  lead_acquisition: "Nitelikli talep toplama",
  upper_funnel_education: "Üst huni eğitim",
  market_service_learning: "Pazar / hizmet öğrenmesi",
  continuity_recovery: "Kesinti sonrası toparlanma",
  classification_triage: "Önce sınıflandırma",
});

const routeLabels: Readonly<Record<ConversionRoute, string>> = Object.freeze({
  lead_form: "Lead form",
  whatsapp: "WhatsApp",
  landing_page: "Landing page",
  not_applicable: "Uygulanmaz",
  unknown: "Henüz seçilmedi",
});

/**
 * Client-side planning aid only. Its state is deliberately ephemeral: users
 * can explore an operating pattern without creating a campaign, proposal or
 * approval record.
 */
function CampaignPlanningBriefPanelContent({ context }: Readonly<{ context: CampaignPlanningBriefContext }>) {
  const [draft, setDraft] = useState<BriefDraft>(() => Object.freeze({ ...context.input }));
  const brief = useMemo(() => createInteractiveCampaignBrief(draft), [draft]);
  const change = <Key extends keyof BriefDraft>(key: Key, value: BriefDraft[Key]) =>
    setDraft((current) => Object.freeze({ ...current, [key]: value }));

  return <section className={`${styles.panel} ${styles.campaignPlanningBrief}`} aria-labelledby="campaign-planning-brief-title">
    <header className={styles.panelHeader}>
      <div><span className={styles.kicker}>PROPOSAL-ONLY PLANNING · CONTEXT BOUND</span><h2 id="campaign-planning-brief-title">Taslak kampanya briefi</h2></div>
      <span className={styles.statusPill} data-tone={brief.readiness === "ready_for_human_review" ? "good" : "warning"}>
        {brief.readiness === "ready_for_human_review" ? "İnsan incelemesine hazır" : brief.readiness === "blocked" ? "Önce engeli çöz" : "Eksik karar var"}
      </span>
    </header>
    <p><strong>Seçili bağlam: {context.campaignLabel}</strong> · Excel’deki çalışma mantığını sıraya koyar: pazar → dil → hizmet → iş amacı → dönüşüm yolu → kapasite/kreatif. Bu yüzey kayıt veya Meta işlemi yapmaz.</p>
    <div className={styles.briefControls}>
      <label htmlFor="brief-business-goal"><span>İş amacı</span><select id="brief-business-goal" value={draft.businessGoal} onChange={(event) => change("businessGoal", event.target.value as CampaignBusinessGoal)}>
        {Object.entries(goalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label htmlFor="brief-market"><span>Pazar</span><select id="brief-market" value={draft.market} onChange={(event) => change("market", event.target.value as CampaignMarket)}>
        <option value="domestic">Yurtiçi</option><option value="international">Uluslararası</option>
      </select></label>
      <label htmlFor="brief-language"><span>Dil</span><select id="brief-language" value={draft.language ?? ""} onChange={(event) => change("language", event.target.value || null)}>
        <option value="">Seçilmedi</option><option value="tr">Türkçe</option><option value="en">İngilizce</option><option value="ar">Arapça</option>
      </select></label>
      <label htmlFor="brief-service"><span>Hizmet / ana grup</span><select id="brief-service" value={draft.serviceRef ?? ""} onChange={(event) => change("serviceRef", event.target.value || null)}>
        <option value="">Seçilmedi</option><option value="service_medical_aesthetics">Medikal estetik</option><option value="service_hair_transplant">Saç ekimi</option><option value="service_doctor_introduction">Doktor tanıtım</option>
      </select></label>
      {draft.market === "international" ? <label htmlFor="brief-region"><span>Ülke / bölge</span><input id="brief-region" value={draft.countryOrRegion ?? ""} maxLength={120} onChange={(event) => change("countryOrRegion", event.target.value.trim() || null)} placeholder="Örn. GCC" /></label> : null}
      <label htmlFor="brief-route"><span>Dönüşüm yolu</span><select id="brief-route" value={draft.conversionRoute} onChange={(event) => change("conversionRoute", event.target.value as ConversionRoute)}>
        {Object.entries(routeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label htmlFor="brief-capacity"><span>Operasyon kapasitesi</span><select id="brief-capacity" value={draft.capacity} onChange={(event) => change("capacity", event.target.value as CapacityState)}>
        <option value="confirmed">Onaylı</option><option value="constrained">Kısıtlı</option><option value="unknown">Bilinmiyor</option>
      </select></label>
      <label htmlFor="brief-delivery-health"><span>Teslimat sağlığı</span><select id="brief-delivery-health" value={draft.deliveryHealth} onChange={(event) => change("deliveryHealth", event.target.value as DeliveryHealth)}>
        <option value="healthy">Sağlıklı</option><option value="interrupted">Kesintili</option><option value="unknown">Bilinmiyor</option>
      </select></label>
      <label className={styles.briefToggle} htmlFor="brief-creative-ready"><input id="brief-creative-ready" type="checkbox" checked={draft.creativeReady} onChange={(event) => change("creativeReady", event.target.checked)} /> <span>Kreatif incelemeye hazır</span></label>
    </div>
    {brief.nextDecision ? <div className={styles.briefNextDecision}><span>SONRAKİ KARAR</span><strong>{brief.nextDecision.question}</strong><small>{brief.nextDecision.reason}</small></div> : null}
    <div className={styles.briefPlan}>
      <div><span>Önerilen şerit</span>{brief.campaignLanes.length ? brief.campaignLanes.map((lane) => <article key={lane.laneRef}><strong>{lane.sequence}. {lane.purpose}</strong><small>{lane.measurementBoundary}</small></article>) : <small>Önce sınıflandırma veya teslimat engeli çözülmeli.</small>}</div>
      <div><span>İzlenecek sıra</span><ol>{brief.launchSequence.map((item) => <li key={item.step}><strong>{item.step}</strong><small>{item.reason}</small></li>)}</ol></div>
      <div><span>Ölçüm sınırı</span><strong>{brief.measurement.primaryOutcome}</strong><small>{brief.measurement.doNotCompareWith.join(" · ")} ile varsayılan olarak kıyaslama.</small></div>
    </div>
    <footer><span>Salt taslak · campaign create / publish / approval / execute / Meta write: kapalı</span><button type="button" onClick={() => setDraft(Object.freeze({ ...context.input }))}>Bağlamı geri yükle</button></footer>
  </section>;
}

export function CampaignPlanningBriefPanel({ context = DEFAULT_CONTEXT }: Readonly<{ context?: CampaignPlanningBriefContext }>) {
  return <CampaignPlanningBriefPanelContent key={context.campaignRef} context={context} />;
}
