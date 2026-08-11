"use client";

import { useEffect, useMemo, useState } from "react";

import {
  createInteractiveCampaignBrief,
  type CampaignBusinessGoal,
  type CampaignMarket,
  type CapacityState,
  type ClassificationState,
  type ConversionRoute,
  type DeliveryHealth,
  type InteractiveCampaignTemplateRequest,
  type PersistedCampaignPlanningHint,
  planningHintFromPersistedCampaignContext,
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
  /** Public persisted campaign alias, when this dashboard selection has one. */
  persistedCampaignRef?: string | null;
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
function CampaignPlanningBriefPanelContent({ context, onApprovalQueueCampaignRef }: Readonly<{
  context: CampaignPlanningBriefContext;
  onApprovalQueueCampaignRef?: (campaignRef: string | null) => void;
}>) {
  const [draft, setDraft] = useState<BriefDraft>(() => Object.freeze({ ...context.input }));
  const [sourceState, setSourceState] = useState<"unbound" | "loading" | "empty" | "ready" | "unavailable">("unbound");
  const [persistedHint, setPersistedHint] = useState<PersistedCampaignPlanningHint | null>(null);
  const brief = useMemo(() => createInteractiveCampaignBrief(draft), [draft]);
  const change = <Key extends keyof BriefDraft>(key: Key, value: BriefDraft[Key]) =>
    setDraft((current) => Object.freeze({ ...current, [key]: value }));

  useEffect(() => {
    if (!context.persistedCampaignRef || !/^ref_[a-f0-9]{12}$/.test(context.persistedCampaignRef)) {
      onApprovalQueueCampaignRef?.(null);
      setPersistedHint(null);
      setSourceState("unbound");
      return;
    }
    let active = true; setSourceState("loading");
    void fetch(`/api/campaign-context?campaignRef=${encodeURIComponent(context.persistedCampaignRef)}`, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => ({ response, payload: await response.json() as { view?: string; approvalQueueCampaignRef?: string; context?: unknown } }))
      .then(({ response, payload }) => {
        if (!active) return;
        const queueCampaignRef = payload.view === "context" && typeof payload.approvalQueueCampaignRef === "string"
          && /^entity_[a-f0-9]{16}$/.test(payload.approvalQueueCampaignRef)
          ? payload.approvalQueueCampaignRef
          : null;
        onApprovalQueueCampaignRef?.(queueCampaignRef);
        setPersistedHint(payload.view === "context" ? planningHintFromPersistedCampaignContext(payload.context) : null);
        setSourceState(!response.ok ? "unavailable" : payload.view === "context" ? "ready" : "empty");
      })
      .catch(() => { if (active) { onApprovalQueueCampaignRef?.(null); setPersistedHint(null); setSourceState("unavailable"); } });
    return () => { active = false; };
  }, [context.persistedCampaignRef, onApprovalQueueCampaignRef]);

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
        <option value="unknown">Henüz sınıflanmadı</option><option value="domestic">Yurtiçi</option><option value="international">Uluslararası</option>
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
    <div className={styles.briefNextDecision} data-readiness={brief.recommendation.status}>
      <span>SALT-OKUNUR ÖNERİ</span><strong>{brief.recommendation.headline}</strong><small>{brief.recommendation.rationale}</small><p>{brief.recommendation.nextStep}</p>
    </div>
    <div className={styles.briefNextDecision} data-source-state={sourceState}>
      <span>PERSISTED KAMPANYA BAĞLAMI</span><strong>{sourceState === "ready" ? "Frozen campaign context doğrulandı" : sourceState === "empty" ? "Henüz frozen context yok" : sourceState === "loading" ? "Frozen context okunuyor" : sourceState === "unavailable" ? "Context kaynağı kullanılamıyor" : "Demo bağlamı persisted kaynağa bağlı değil"}</strong>
      <small>{sourceState === "ready" ? "Brief/timeline birleşimi yalnız bu doğrulanmış kaynakla açılır." : "Bu durum proposal, approval veya Meta write yetkisi vermez."}</small>
    </div>
    {sourceState === "ready" && persistedHint ? <div className={styles.briefNextDecision} data-source-state="hint">
      <span>FROZEN CONTEXT SİNYALİ</span><strong>{persistedHint.objective.state === "known" ? `Doğrulanmış Meta amacı: ${persistedHint.objective.value}` : "Meta amacı henüz doğrulanmış değil"}</strong>
      <small>Pazar, dil, hizmet, dönüşüm yolu ve teslimat sağlığı bu kaynaktan tahmin edilmez; kullanıcı doğrular.</small>
      {persistedHint.suggestedBusinessGoal ? <button type="button" onClick={() => {
        const suggested = persistedHint.suggestedBusinessGoal;
        if (suggested) change("businessGoal", suggested);
      }}>İş amacını bu sinyalle eşle</button> : null}
    </div> : null}
    <div className={styles.briefPlan}>
      <div><span>Şablon ve kıyas sınırı</span><strong>{brief.variantRef ?? "Bağlam tamamlanınca seçilecek"}</strong><small>{brief.comparisonBoundary.summary}</small></div>
      <div><span>Önerilen şerit</span>{brief.campaignLanes.length ? brief.campaignLanes.map((lane) => <article key={lane.laneRef}><strong>{lane.sequence}. {lane.purpose}</strong><small>{lane.measurementBoundary}</small></article>) : <small>Önce pazar/sınıflandırma veya teslimat engeli çözülmeli.</small>}</div>
      <div><span>İzlenecek sıra</span><ol>{brief.launchSequence.map((item) => <li key={item.step}><strong>{item.step}</strong><small>{item.reason}</small></li>)}</ol></div>
      <div><span>Ölçüm sınırı</span><strong>{brief.measurement.primaryOutcome}</strong><small>{brief.measurement.doNotCompareWith.join(" · ")} ile varsayılan olarak kıyaslama.</small></div>
    </div>
    <footer><span>Salt taslak/öneri · campaign create / publish / approval / execute / Meta write: kapalı</span><button type="button" onClick={() => setDraft(Object.freeze({ ...context.input }))}>Bağlamı geri yükle</button></footer>
  </section>;
}

export function CampaignPlanningBriefPanel({ context = DEFAULT_CONTEXT, onApprovalQueueCampaignRef }: Readonly<{
  context?: CampaignPlanningBriefContext;
  onApprovalQueueCampaignRef?: (campaignRef: string | null) => void;
}>) {
  return <CampaignPlanningBriefPanelContent key={context.campaignRef} context={context} onApprovalQueueCampaignRef={onApprovalQueueCampaignRef} />;
}
