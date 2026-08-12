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
import type { CampaignIntentTemplateRef } from "./normalization-workbench-panel";
import styles from "./operating-dashboard.module.css";

type BriefDraft = Readonly<{
  businessGoal: CampaignBusinessGoal;
  market: CampaignMarket;
  language: string | null;
  serviceRef: string | null;
  campaignFamilyRef?: string | null;
  countryOrRegion: string | null;
  conversionRoute: ConversionRoute;
  deliveryHealth: DeliveryHealth;
  classification: ClassificationState;
  capacity: CapacityState;
  creativeReady: boolean;
}>;
type BriefWorkingNotes = Readonly<{
  offer: string;
  audienceBoundary: string;
  qualifiedLeadDefinition: string;
  capacityNote: string;
}>;
export type CampaignBriefScenarioRef = "" | "domestic_form_lead" | "domestic_whatsapp_lead" | "international_ar_whatsapp"
  | "international_ru_form" | "domestic_upper_funnel" | "delivery_recovery";
export type CampaignBriefScenario = Readonly<{ label: string; input: BriefDraft }>;

type ApprovalTimelineState = "idle" | "loading" | "ready" | "unavailable";

type DecisionTimelineStage = Readonly<{
  ordinal: 1 | 2 | 3 | 4;
  title: string;
  detail: string;
  state: "ready" | "pending" | "closed" | "unavailable";
}>;

const ENTITY_REF = /^entity_[a-f0-9]{16}$/;
const APPROVAL_STATUS = new Set([
  "proposed", "awaiting_approval", "approved", "rejected", "changes_requested", "expired", "stale", "suppressed", "parked",
  "executing", "verified", "failed", "dependency_failed", "rollback_proposed", "rolled_back", "superseded",
]);

/**
 * This picks only a draft-only starting template. It deliberately carries no
 * campaign, source, scope or policy reference into the policy workspace.
 */
export function draftOnlyPolicyTemplateForBrief(input: Pick<BriefDraft, "businessGoal" | "deliveryHealth">): Exclude<CampaignIntentTemplateRef, ""> {
  if (input.deliveryHealth === "interrupted") return "delivery_recovery";
  if (input.businessGoal === "lead_acquisition") return "lead_quality";
  return "new_campaign_plan";
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function safeReadAuthority(value: unknown): boolean {
  return exactObject(value, ["readOnly", "canApprove", "canReject", "canRequestChanges", "canGrant", "canExecute", "canWriteMeta"])
    && value.readOnly === true && value.canApprove === false && value.canReject === false && value.canRequestChanges === false
    && value.canGrant === false && value.canExecute === false && value.canWriteMeta === false;
}

function safeApprovalItem(value: unknown, campaignRef: string): value is Record<string, unknown> {
  const entity = value && typeof value === "object" ? (value as Record<string, unknown>).entity : null;
  const beforeAfter = value && typeof value === "object" ? (value as Record<string, unknown>).beforeAfter : null;
  const autonomy = value && typeof value === "object" ? (value as Record<string, unknown>).autonomy : null;
  const dependencies = value && typeof value === "object" ? (value as Record<string, unknown>).dependencies : null;
  const statusBeforeAfter = exactObject(beforeAfter, ["field", "before", "after"])
    && beforeAfter.field === "configured_status" && ["ACTIVE", "PAUSED"].includes(String(beforeAfter.before))
    && ["ACTIVE", "PAUSED"].includes(String(beforeAfter.after));
  const budgetBeforeAfter = exactObject(beforeAfter, ["field", "beforeMinor", "afterMinor", "currency"])
    && ["daily_budget_minor", "lifetime_budget_minor"].includes(String(beforeAfter.field)) && Number.isSafeInteger(beforeAfter.beforeMinor)
    && Number.isSafeInteger(beforeAfter.afterMinor) && typeof beforeAfter.currency === "string" && /^[A-Z]{3}$/.test(beforeAfter.currency);
  return exactObject(value, ["unitRef", "bundleRef", "status", "risk", "actionType", "accountRef", "campaignRef", "entity", "beforeAfter", "autonomy", "expiresAt", "createdAt", "dependencies", "summaryCode"])
    && typeof value.unitRef === "string" && /^action_unit_[a-f0-9]{20}$/.test(value.unitRef)
    && (value.bundleRef === null || typeof value.bundleRef === "string" && /^action_bundle_[a-f0-9]{20}$/.test(value.bundleRef))
    && typeof value.status === "string" && APPROVAL_STATUS.has(value.status)
    && ["K0", "K1", "K2", "K3", "K4"].includes(String(value.risk))
    && ["status_pause", "status_activate", "budget_decrease", "budget_increase"].includes(String(value.actionType))
    && typeof value.accountRef === "string" && /^(?:account|entity|autonomy)_[a-f0-9]{16}$/.test(value.accountRef)
    && value.campaignRef === campaignRef && exactObject(entity, ["type", "ref", "label"])
    && ["campaign", "ad_set", "ad"].includes(String(entity.type)) && typeof entity.ref === "string" && /^(?:account|entity|autonomy)_[a-f0-9]{16}$/.test(entity.ref)
    && (entity.label === null || typeof entity.label === "string" && entity.label.length <= 256)
    && (statusBeforeAfter || budgetBeforeAfter)
    && exactObject(autonomy, ["profileRef", "decision", "trace"]) && typeof autonomy.profileRef === "string" && /^(?:account|entity|autonomy)_[a-f0-9]{16}$/.test(autonomy.profileRef)
    && ["manual", "approval_required", "policy_limited"].includes(String(autonomy.decision)) && Array.isArray(autonomy.trace) && autonomy.trace.length >= 1 && autonomy.trace.length <= 20
    && autonomy.trace.every((step) => exactObject(step, ["scope", "decision", "reasonCode"]) && ["workspace", "account", "category", "entity", "risk"].includes(String(step.scope))
      && ["manual", "approval_required", "policy_limited"].includes(String(step.decision)) && typeof step.reasonCode === "string" && /^[a-z][a-z0-9_.:-]{0,127}$/.test(step.reasonCode))
    && Array.isArray(dependencies) && dependencies.length <= 50 && dependencies.every((dependency) => exactObject(dependency, ["unitRef", "status"])
      && typeof dependency.unitRef === "string" && /^action_unit_[a-f0-9]{20}$/.test(dependency.unitRef) && typeof dependency.status === "string" && APPROVAL_STATUS.has(dependency.status))
    && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) && typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt))
    && Date.parse(value.expiresAt) > Date.parse(value.createdAt) && typeof value.summaryCode === "string" && /^[a-z][a-z0-9_.:-]{0,127}$/.test(value.summaryCode);
}

/**
 * Projects a deliberately tiny, read-only approval-list proof for the brief.
 * Any changed contract, alias mismatch, or authority bit fails closed.
 */
export function decisionTimelineFromApprovalQueueResponse(value: unknown, campaignRef: string): Readonly<{ itemCount: number; latestStatus: string | null }> | null {
  if (!ENTITY_REF.test(campaignRef)
    || !exactObject(value, ["contractVersion", "view", "entityRef", "campaignRef", "items", "nextCursor", "authority"])
    || value.contractVersion !== "approval-queue-read-model/1.2.0" || value.view !== "list"
    || value.entityRef !== null || value.campaignRef !== campaignRef || !Array.isArray(value.items) || value.items.length > 25
    || value.nextCursor !== null && typeof value.nextCursor !== "string" || !safeReadAuthority(value.authority)
    || value.items.some((item) => !safeApprovalItem(item, campaignRef))) return null;
  return Object.freeze({ itemCount: value.items.length, latestStatus: value.items[0]?.status as string | undefined ?? null });
}

export function campaignDecisionTimeline(input: Readonly<{
  sourceState: "ready";
  approvalState: Exclude<ApprovalTimelineState, "idle">;
  approval: Readonly<{ itemCount: number; latestStatus: string | null }> | null;
}>): readonly DecisionTimelineStage[] {
  const approval = input.approvalState === "ready" && input.approval
    ? input.approval.itemCount === 0
      ? { detail: "Bu doğrulanmış kampanya alias'ı için persisted approval kaydı yok.", state: "pending" as const }
      : { detail: `${input.approval.itemCount} persisted approval kaydı okundu${input.approval.latestStatus ? ` · en yeni durum: ${input.approval.latestStatus}` : ""}.`, state: "ready" as const }
    : input.approvalState === "loading"
      ? { detail: "Persisted approval listesi salt-okunur olarak yükleniyor.", state: "pending" as const }
      : { detail: "Approval listesi güvenli biçimde doğrulanamadı; bu aşama gösterilmez.", state: "unavailable" as const };
  return Object.freeze([
    Object.freeze({ ordinal: 1, title: "Frozen kampanya bağlamı", detail: "Doğrulanmış persisted context bu zaman çizelgesini açtı.", state: "ready" }),
    Object.freeze({ ordinal: 2, title: "Deterministik brief ve öneri", detail: "Bu ekranın geçici sınıflandırması yalnız öneridir; proposal veya onay kaydı oluşturmaz.", state: "ready" }),
    Object.freeze({ ordinal: 3, title: "Persisted insan onayı", ...approval }),
    Object.freeze({ ordinal: 4, title: "Uygulama güvenliği", detail: "Kapalı — bu yüzey execute, approval kararı veya Meta write başlatmaz.", state: "closed" }),
  ]);
}

function campaignContextBridge(value: unknown, expectedCampaignRef: string): Readonly<{ context: unknown; approvalQueueCampaignRef: string }> | null {
  if (!exactObject(value, ["contractVersion", "view", "campaignRef", "approvalQueueCampaignRef", "context"])
    || value.contractVersion !== "campaign-context-read-model/1.1.0" || value.view !== "context"
    || value.campaignRef !== expectedCampaignRef || !ENTITY_REF.test(String(value.approvalQueueCampaignRef))) return null;
  return Object.freeze({ context: value.context, approvalQueueCampaignRef: value.approvalQueueCampaignRef as string });
}

function emptyCampaignContext(value: unknown, expectedCampaignRef: string): boolean {
  return exactObject(value, ["contractVersion", "view", "campaignRef", "writeOperations"])
    && value.contractVersion === "campaign-context-read-model/1.1.0" && value.view === "empty"
    && value.campaignRef === expectedCampaignRef && value.writeOperations === 0;
}

export function campaignContextTimelineSourceState(
  responseOk: boolean,
  value: unknown,
  expectedCampaignRef: string,
): "ready" | "empty" | "unavailable" {
  if (!responseOk) return "unavailable";
  if (campaignContextBridge(value, expectedCampaignRef)) return "ready";
  return emptyCampaignContext(value, expectedCampaignRef) ? "empty" : "unavailable";
}

const INITIAL_DRAFT: BriefDraft = Object.freeze({
  businessGoal: "lead_acquisition",
  market: "domestic",
  language: "tr",
  serviceRef: "service_medical_aesthetics",
  campaignFamilyRef: null,
  countryOrRegion: null,
  conversionRoute: "lead_form",
  deliveryHealth: "healthy",
  classification: "classified",
  capacity: "confirmed",
  creativeReady: true,
});
const EMPTY_WORKING_NOTES: BriefWorkingNotes = Object.freeze({ offer: "", audienceBoundary: "", qualifiedLeadDefinition: "", capacityNote: "" });

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
 * Read-only planning starting points from the 2026-08-10 operating workbook.
 * They are intentionally examples, not persisted Meta campaign instructions.
 */
export const CAMPAIGN_BRIEF_SCENARIOS: Readonly<Record<Exclude<CampaignBriefScenarioRef, "">, CampaignBriefScenario>> = Object.freeze({
  domestic_form_lead: Object.freeze({ label: "Yerli · form lead · medikal estetik", input: Object.freeze({
    businessGoal: "lead_acquisition", market: "domestic", language: "tr", serviceRef: "service_medical_aesthetics", countryOrRegion: null,
    conversionRoute: "lead_form", deliveryHealth: "healthy", classification: "classified", capacity: "confirmed", creativeReady: true }) }),
  domestic_whatsapp_lead: Object.freeze({ label: "Yerli · WhatsApp lead · saç ekimi", input: Object.freeze({
    businessGoal: "lead_acquisition", market: "domestic", language: "tr", serviceRef: "service_hair_transplant", countryOrRegion: null,
    conversionRoute: "whatsapp", deliveryHealth: "healthy", classification: "classified", capacity: "confirmed", creativeReady: true }) }),
  international_ar_whatsapp: Object.freeze({ label: "Uluslararası · AR WhatsApp · FTR", input: Object.freeze({
    businessGoal: "lead_acquisition", market: "international", language: "ar", serviceRef: "service_physical_therapy_rehab", countryOrRegion: "Arap Bölgesi",
    campaignFamilyRef: "campaign_family_intensive_ftr", conversionRoute: "whatsapp", deliveryHealth: "healthy", classification: "classified", capacity: "confirmed", creativeReady: true }) }),
  international_ru_form: Object.freeze({ label: "Uluslararası · RU form · FTR", input: Object.freeze({
    businessGoal: "lead_acquisition", market: "international", language: "ru", serviceRef: "service_physical_therapy_rehab", countryOrRegion: "Türki Cumhuriyetler",
    campaignFamilyRef: "campaign_family_intensive_ftr", conversionRoute: "lead_form", deliveryHealth: "healthy", classification: "classified", capacity: "confirmed", creativeReady: true }) }),
  domestic_upper_funnel: Object.freeze({ label: "Yerli · üst huni · içerik/gönderi", input: Object.freeze({
    businessGoal: "upper_funnel_education", market: "domestic", language: "tr", serviceRef: "service_content_post", countryOrRegion: null,
    conversionRoute: "not_applicable", deliveryHealth: "healthy", classification: "classified", capacity: "confirmed", creativeReady: true }) }),
  delivery_recovery: Object.freeze({ label: "Teslimat kesintisi sonrası toparlama", input: Object.freeze({
    businessGoal: "lead_acquisition", market: "unknown", language: null, serviceRef: null, countryOrRegion: null,
    conversionRoute: "unknown", deliveryHealth: "interrupted", classification: "unclassified", capacity: "unknown", creativeReady: false }) }),
});

export function campaignBriefScenario(ref: CampaignBriefScenarioRef): CampaignBriefScenario | null {
  return ref ? CAMPAIGN_BRIEF_SCENARIOS[ref] : null;
}

/**
 * Client-side planning aid only. Its state is deliberately ephemeral: users
 * can explore an operating pattern without creating a campaign, proposal or
 * approval record.
 */
function CampaignPlanningBriefPanelContent({ context, initialScenarioRef, onApprovalQueueCampaignRef, onOpenDraftOnlyPolicy }: Readonly<{
  context: CampaignPlanningBriefContext;
  initialScenarioRef: CampaignBriefScenarioRef;
  onApprovalQueueCampaignRef?: (campaignRef: string | null) => void;
  onOpenDraftOnlyPolicy?: (template: Exclude<CampaignIntentTemplateRef, "">) => void;
}>) {
  const [draft, setDraft] = useState<BriefDraft>(() => Object.freeze({ ...(campaignBriefScenario(initialScenarioRef)?.input ?? context.input) }));
  const [scenarioRef, setScenarioRef] = useState<CampaignBriefScenarioRef>(initialScenarioRef);
  const [workingNotes, setWorkingNotes] = useState<BriefWorkingNotes>(EMPTY_WORKING_NOTES);
  const [sourceState, setSourceState] = useState<"unbound" | "loading" | "empty" | "ready" | "unavailable">("unbound");
  const [persistedHint, setPersistedHint] = useState<PersistedCampaignPlanningHint | null>(null);
  const [approvalQueueCampaignRef, setApprovalQueueCampaignRef] = useState<string | null>(null);
  const [approvalState, setApprovalState] = useState<ApprovalTimelineState>("idle");
  const [approvalTimeline, setApprovalTimeline] = useState<Readonly<{ itemCount: number; latestStatus: string | null }> | null>(null);
  const brief = useMemo(() => createInteractiveCampaignBrief(draft), [draft]);
  const change = <Key extends keyof BriefDraft>(key: Key, value: BriefDraft[Key]) => {
    // A scenario is only a starting point. Once an operator changes a field,
    // keeping its label would imply that the original workbook lane still
    // describes the brief.
    setScenarioRef("");
    setDraft((current) => Object.freeze({ ...current, [key]: value }));
  };
  const applyScenario = (value: CampaignBriefScenarioRef) => {
    setScenarioRef(value); setWorkingNotes(EMPTY_WORKING_NOTES); const scenario = campaignBriefScenario(value); if (scenario) setDraft(scenario.input);
  };

  useEffect(() => {
    if (!context.persistedCampaignRef || !/^ref_[a-f0-9]{12}$/.test(context.persistedCampaignRef)) {
      onApprovalQueueCampaignRef?.(null);
      setPersistedHint(null);
      setApprovalQueueCampaignRef(null);
      setApprovalTimeline(null);
      setApprovalState("idle");
      setSourceState("unbound");
      return;
    }
    let active = true; setSourceState("loading");
    void fetch(`/api/campaign-context?campaignRef=${encodeURIComponent(context.persistedCampaignRef)}`, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => ({ response, payload: await response.json() as unknown }))
      .then(({ response, payload }) => {
        if (!active) return;
        const bridge = response.ok ? campaignContextBridge(payload, context.persistedCampaignRef!) : null;
        const queueCampaignRef = bridge?.approvalQueueCampaignRef ?? null;
        onApprovalQueueCampaignRef?.(queueCampaignRef);
        setApprovalQueueCampaignRef(queueCampaignRef);
        setApprovalTimeline(null);
        setApprovalState(queueCampaignRef ? "loading" : "idle");
        setPersistedHint(bridge ? planningHintFromPersistedCampaignContext(bridge.context) : null);
        setSourceState(campaignContextTimelineSourceState(response.ok, payload, context.persistedCampaignRef!));
      })
      .catch(() => { if (active) { onApprovalQueueCampaignRef?.(null); setPersistedHint(null); setApprovalQueueCampaignRef(null); setApprovalTimeline(null); setApprovalState("idle"); setSourceState("unavailable"); } });
    return () => { active = false; };
  }, [context.persistedCampaignRef, onApprovalQueueCampaignRef]);

  useEffect(() => {
    if (!approvalQueueCampaignRef || sourceState !== "ready") return;
    let active = true;
    setApprovalState("loading");
    void fetch(`/api/approval-queue?view=list&campaignRef=${encodeURIComponent(approvalQueueCampaignRef)}`, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => ({ response, payload: await response.json() as unknown }))
      .then(({ response, payload }) => {
        if (!active) return;
        const timeline = response.ok ? decisionTimelineFromApprovalQueueResponse(payload, approvalQueueCampaignRef) : null;
        setApprovalTimeline(timeline);
        setApprovalState(timeline ? "ready" : "unavailable");
      })
      .catch(() => { if (active) { setApprovalTimeline(null); setApprovalState("unavailable"); } });
    return () => { active = false; };
  }, [approvalQueueCampaignRef, sourceState]);

  return <section className={`${styles.panel} ${styles.campaignPlanningBrief}`} aria-labelledby="campaign-planning-brief-title">
    <header className={styles.panelHeader}>
      <div><span className={styles.kicker}>PROPOSAL-ONLY PLANNING · CONTEXT BOUND</span><h2 id="campaign-planning-brief-title">Taslak kampanya briefi</h2></div>
      <span className={styles.statusPill} data-tone={brief.readiness === "ready_for_human_review" ? "good" : "warning"}>
        {brief.readiness === "ready_for_human_review" ? "İnsan incelemesine hazır" : brief.readiness === "blocked" ? "Önce engeli çöz" : "Eksik karar var"}
      </span>
    </header>
    <p><strong>Seçili bağlam: {context.campaignLabel}</strong> · Excel’deki çalışma mantığını sıraya koyar: pazar → dil → hizmet → iş amacı → dönüşüm yolu → kapasite/kreatif. Bu yüzey kayıt veya Meta işlemi yapmaz.</p>
    <label htmlFor="brief-scenario"><span>Çalışma kitabı senaryosu</span><select id="brief-scenario" value={scenarioRef} onChange={(event) => applyScenario(event.target.value as CampaignBriefScenarioRef)}>
      <option value="">Seçili bağlamla devam edin</option>{Object.entries(CAMPAIGN_BRIEF_SCENARIOS).map(([ref, scenario]) => <option key={ref} value={ref}>{scenario.label}</option>)}</select>
      <small>Bu yalnız planlama başlangıcıdır; canlı Meta verisi, teklif, bütçe veya yayın komutu değildir.</small></label>
    <div className={styles.briefControls}>
      <label htmlFor="brief-business-goal"><span>İş amacı</span><select id="brief-business-goal" value={draft.businessGoal} onChange={(event) => change("businessGoal", event.target.value as CampaignBusinessGoal)}>
        {Object.entries(goalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label htmlFor="brief-market"><span>Pazar</span><select id="brief-market" value={draft.market} onChange={(event) => change("market", event.target.value as CampaignMarket)}>
        <option value="unknown">Henüz sınıflanmadı</option><option value="domestic">Yurtiçi</option><option value="international">Uluslararası</option>
      </select></label>
      <label htmlFor="brief-language"><span>Dil</span><select id="brief-language" value={draft.language ?? ""} onChange={(event) => change("language", event.target.value || null)}>
        <option value="">Seçilmedi</option><option value="tr">Türkçe</option><option value="en">İngilizce</option><option value="ar">Arapça</option><option value="ru">Rusça</option>
      </select></label>
      <label htmlFor="brief-service"><span>Hizmet / ana grup</span><select id="brief-service" value={draft.serviceRef ?? ""} onChange={(event) => change("serviceRef", event.target.value || null)}>
        <option value="">Seçilmedi</option><option value="service_medical_aesthetics">Medikal estetik / plastik cerrahi</option>
        <option value="service_hair_transplant">Saç ekimi</option><option value="service_physical_therapy_rehab">Fizik tedavi / rehabilitasyon</option>
        <option value="service_checkup">Check-up</option><option value="service_birth">Doğum kampanyası</option>
        <option value="service_doctor_introduction">Doktor tanıtım</option><option value="service_human_resources">İnsan kaynakları</option>
        <option value="service_content_post">İçerik / gönderi</option><option value="service_brand_corporate">Marka / kurumsal</option>
        <option value="service_unclassified">Diğer / sınıflandırılacak</option>
      </select></label>
      <label htmlFor="brief-campaign-family"><span>Kampanya ailesi</span><select id="brief-campaign-family" value={draft.campaignFamilyRef ?? ""} onChange={(event) => change("campaignFamilyRef", event.target.value || null)}>
        <option value="">Henüz insan incelemesiyle atanmadı</option><option value="campaign_family_intensive_ftr">Intensive FTR</option>
      </select><small>Rota değildir; hizmet altındaki stratejik kampanya ailesidir.</small></label>
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
    <div className={styles.briefControls} aria-label="Operatör çalışma notları">
      <label htmlFor="brief-offer"><span>Teklif / değer önerisi</span><input id="brief-offer" value={workingNotes.offer} maxLength={240} onChange={(event) => setWorkingNotes((current) => Object.freeze({ ...current, offer: event.target.value }))} placeholder="Örn. ücretsiz ön değerlendirme" /></label>
      <label htmlFor="brief-audience-boundary"><span>Hedef kitle sınırı</span><input id="brief-audience-boundary" value={workingNotes.audienceBoundary} maxLength={240} onChange={(event) => setWorkingNotes((current) => Object.freeze({ ...current, audienceBoundary: event.target.value }))} placeholder="Kimler dahil / hariç?" /></label>
      <label htmlFor="brief-qualified-lead"><span>Nitelikli lead tanımı</span><input id="brief-qualified-lead" value={workingNotes.qualifiedLeadDefinition} maxLength={240} onChange={(event) => setWorkingNotes((current) => Object.freeze({ ...current, qualifiedLeadDefinition: event.target.value }))} placeholder="Hangi koşulda nitelikli?" /></label>
      <label htmlFor="brief-capacity-note"><span>Kapasite / geri dönüş notu</span><input id="brief-capacity-note" value={workingNotes.capacityNote} maxLength={240} onChange={(event) => setWorkingNotes((current) => Object.freeze({ ...current, capacityNote: event.target.value }))} placeholder="Günlük kapasite ve geri dönüş süresi" /></label>
    </div>
    <div className={styles.briefNextDecision} data-source-state="working_notes">
      <span>OPERATÖR ÇALIŞMA NOTLARI</span><strong>Bu dört alan yalnız bu tarayıcıdaki geçici brief çalışması içindir.</strong>
      <small>Kaydedilmez, Guidance/Strict Policy alanına aktarılmaz; hiçbir uygulama yetkisi vermez.</small>
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
    {sourceState === "ready" && approvalQueueCampaignRef ? <section className={styles.campaignDecisionTimeline} aria-label="Kampanya karar zaman çizelgesi">
      <header><span>KARAR ZAMAN ÇİZELGESİ · SALT-OKUNUR</span><small>Yalnız doğrulanmış context alias'ı ve read-only approval listesi kullanılır.</small></header>
      <ol>{campaignDecisionTimeline({ sourceState, approvalState: approvalState === "idle" ? "loading" : approvalState, approval: approvalTimeline }).map((stage) => <li key={stage.ordinal} data-state={stage.state}>
        <span>{stage.ordinal}</span><div><strong>{stage.title}</strong><small>{stage.detail}</small></div>
      </li>)}</ol>
    </section> : null}
    <div className={styles.briefPlan}>
      <div><span>Şablon ve kıyas sınırı</span><strong>{brief.variantRef ?? "Bağlam tamamlanınca seçilecek"}</strong><small>{brief.comparisonBoundary.summary}</small></div>
      <div><span>Önerilen şerit</span>{brief.campaignLanes.length ? brief.campaignLanes.map((lane) => <article key={lane.laneRef}><strong>{lane.sequence}. {lane.purpose}</strong><small>{lane.measurementBoundary}</small></article>) : <small>Önce pazar/sınıflandırma veya teslimat engeli çözülmeli.</small>}</div>
      <div><span>İzlenecek sıra</span><ol>{brief.launchSequence.map((item) => <li key={item.step}><strong>{item.step}</strong><small>{item.reason}</small></li>)}</ol></div>
      <div><span>Ölçüm sınırı</span><strong>{brief.measurement.primaryOutcome}</strong><small>{brief.measurement.doNotCompareWith.join(" · ")} ile varsayılan olarak kıyaslama.</small></div>
    </div>
    <footer><span>Salt taslak/öneri · campaign create / publish / approval / execute / Meta write: kapalı</span><div>
      {onOpenDraftOnlyPolicy ? <button type="button" onClick={() => onOpenDraftOnlyPolicy(draftOnlyPolicyTemplateForBrief(draft))}>Taslak talimat alanını aç</button> : null}
      <button type="button" onClick={() => { setScenarioRef(""); setWorkingNotes(EMPTY_WORKING_NOTES); setDraft(Object.freeze({ ...context.input })); }}>Bağlamı geri yükle</button>
    </div></footer>
  </section>;
}

export function CampaignPlanningBriefPanel({ context = DEFAULT_CONTEXT, initialScenarioRef = "", onApprovalQueueCampaignRef, onOpenDraftOnlyPolicy }: Readonly<{
  context?: CampaignPlanningBriefContext;
  /** An offline workbook lane can choose only a temporary planning start. */
  initialScenarioRef?: CampaignBriefScenarioRef;
  onApprovalQueueCampaignRef?: (campaignRef: string | null) => void;
  onOpenDraftOnlyPolicy?: (template: Exclude<CampaignIntentTemplateRef, "">) => void;
}>) {
  return <CampaignPlanningBriefPanelContent key={`${context.campaignRef}:${initialScenarioRef}`} context={context} initialScenarioRef={initialScenarioRef} onApprovalQueueCampaignRef={onApprovalQueueCampaignRef} onOpenDraftOnlyPolicy={onOpenDraftOnlyPolicy} />;
}
