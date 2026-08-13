"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { SliceRule } from "@/domain/campaigns/slice-operating-rule";
import styles from "./slice-rule-workspace-panel.module.css";

type Market = "domestic" | "international";
type Platform = "facebook" | "instagram" | "mixed";
type Scope = Readonly<{
  market: Market;
  serviceRef: string;
  campaignFamilyRef: string;
  countryOrRegion?: string;
  audienceStrategy?: string;
  platform?: Platform;
}>;
type ClosedAuthority = Readonly<{
  canPublish: false;
  canApprove: false;
  canExecute: false;
  canWriteMeta: false;
  canEnableAutomation: false;
}>;
export type SliceRuleWorkspaceItem = Readonly<{
  schemaVersion: "public-slice-rule-workspace-draft/1.0.0";
  seriesRef: string;
  revision: number;
  draftRef: string;
  draftHash: string;
  status: "draft";
  operatingMode: "recommendation_only";
  scope: Scope;
  operatingRule: Readonly<{ rule: SliceRule; priority: number; verification: Readonly<{
    metric: "qualified_leads" | "cost_per_qualified_lead" | "engagement_rate" | "delivery_health";
    reviewCadence: "daily" | "weekly" | "monthly";
    rollbackWhen: string;
  }>; authority: ClosedAuthority }>;
  createdAt: string;
  authority: ClosedAuthority;
}>;
export type SliceRuleWorkspaceSnapshot = Readonly<{
  contractVersion: "slice-rule-workspace-http/1.0.0";
  items: readonly SliceRuleWorkspaceItem[];
  authority: Readonly<{ canRead: true; canSaveDraft: boolean } & ClosedAuthority>;
}>;

type State = Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>
  | Readonly<{ status: "ready"; snapshot: SliceRuleWorkspaceSnapshot }>;

type Form = Readonly<{
  seriesRef: string;
  market: Market;
  serviceRef: string;
  campaignFamilyRef: string;
  countryOrRegion: string;
  audienceStrategy: string;
  platform: "" | Platform;
  ruleKind: "period_budget_cap" | "winner_continuation_rotation" | "delivery_guardrail";
  period: "daily" | "weekly" | "monthly";
  currency: string;
  maximumDecimal: string;
  continuationPercent: string;
  evaluationWindowDays: string;
  condition: "delivery_interrupted" | "capacity_constrained" | "payment_or_account_review";
  priority: string;
  metric: "qualified_leads" | "cost_per_qualified_lead" | "engagement_rate" | "delivery_health";
  reviewCadence: "daily" | "weekly" | "monthly";
  rollbackWhen: string;
}>;

const CLOSED: ClosedAuthority = Object.freeze({ canPublish: false, canApprove: false, canExecute: false,
  canWriteMeta: false, canEnableAutomation: false });
const EMPTY_FORM: Form = Object.freeze({ seriesRef: "", market: "international", serviceRef: "",
  campaignFamilyRef: "", countryOrRegion: "", audienceStrategy: "", platform: "", ruleKind: "period_budget_cap",
  period: "monthly", currency: "TRY", maximumDecimal: "", continuationPercent: "80", evaluationWindowDays: "7",
  condition: "delivery_interrupted", priority: "50", metric: "cost_per_qualified_lead", reviewCadence: "weekly",
  rollbackWhen: "Yeni sonuç kanıtı, teslimat kesintisi veya kapsam değişimi insan incelemesini gerektirirse." });

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isClosed(value: unknown): value is ClosedAuthority {
  return object(value) && Object.keys(value).length === 5 && value.canPublish === false && value.canApprove === false
    && value.canExecute === false && value.canWriteMeta === false && value.canEnableAutomation === false;
}
function noOpenedAuthority(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(noOpenedAuthority);
  if (!object(value)) return true;
  for (const [key, child] of Object.entries(value)) {
    if (/^(canPublish|canApprove|canExecute|canWriteMeta|canEnableAutomation|approvalGranted|writeEnabled|policyPublished|actionAuthorized)$/i.test(key)
      && child !== false) return false;
    if (!noOpenedAuthority(child)) return false;
  }
  return true;
}
function isScope(value: unknown): value is Scope {
  if (!object(value) || !["domestic", "international"].includes(String(value.market))
    || typeof value.serviceRef !== "string" || !value.serviceRef || typeof value.campaignFamilyRef !== "string"
    || !value.campaignFamilyRef || value.countryOrRegion !== undefined && typeof value.countryOrRegion !== "string"
    || value.audienceStrategy !== undefined && typeof value.audienceStrategy !== "string"
    || value.platform !== undefined && !["facebook", "instagram", "mixed"].includes(String(value.platform))) return false;
  return Object.keys(value).every((key) => ["market", "serviceRef", "campaignFamilyRef", "countryOrRegion", "audienceStrategy", "platform"].includes(key));
}
function isItem(value: unknown): value is SliceRuleWorkspaceItem {
  return object(value) && value.schemaVersion === "public-slice-rule-workspace-draft/1.0.0"
    && typeof value.seriesRef === "string" && Number.isInteger(value.revision) && Number(value.revision) > 0
    && typeof value.draftRef === "string" && typeof value.draftHash === "string" && value.status === "draft"
    && value.operatingMode === "recommendation_only" && isScope(value.scope) && typeof value.createdAt === "string"
    && isClosed(value.authority) && object(value.operatingRule) && object(value.operatingRule.rule)
    && typeof value.operatingRule.priority === "number" && object(value.operatingRule.verification)
    && isClosed(value.operatingRule.authority) && noOpenedAuthority(value);
}

export function parseSliceRuleWorkspaceSnapshot(value: unknown): SliceRuleWorkspaceSnapshot {
  if (!object(value) || value.contractVersion !== "slice-rule-workspace-http/1.0.0" || !Array.isArray(value.items)
    || value.items.length > 100 || !value.items.every(isItem) || !object(value.authority)
    || Object.keys(value.authority).length !== 7 || value.authority.canRead !== true
    || typeof value.authority.canSaveDraft !== "boolean" || value.authority.canPublish !== false
    || value.authority.canApprove !== false || value.authority.canExecute !== false
    || value.authority.canWriteMeta !== false || value.authority.canEnableAutomation !== false
    || !noOpenedAuthority(value)) {
    throw new Error("Slice Rule Workspace güvenli sözleşmeyi döndürmedi.");
  }
  return value as unknown as SliceRuleWorkspaceSnapshot;
}

export function buildSliceRuleDraftCommand(form: Form, head?: SliceRuleWorkspaceItem) {
  const continuation = Number(form.continuationPercent);
  const priority = Number(form.priority);
  const window = Number(form.evaluationWindowDays);
  if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(form.seriesRef)
    || !/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(form.serviceRef)
    || !/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(form.campaignFamilyRef)
    || !Number.isInteger(priority) || priority < 0 || priority > 100
    || !form.rollbackWhen.trim()) return null;
  let rule: SliceRule;
  if (form.ruleKind === "period_budget_cap") {
    if (!/^[A-Z]{3}$/.test(form.currency) || !/^(0|[1-9]\d*)(?:\.\d{1,12})?$/.test(form.maximumDecimal)
      || Number(form.maximumDecimal) <= 0) return null;
    rule = { kind: form.ruleKind, period: form.period, currency: form.currency, maximumDecimal: form.maximumDecimal };
  } else if (form.ruleKind === "winner_continuation_rotation") {
    if (!Number.isInteger(continuation) || continuation < 0 || continuation > 100 || !Number.isInteger(window)
      || window < 1 || window > 90 || form.metric === "delivery_health") return null;
    rule = { kind: form.ruleKind, metric: form.metric, continuationBasisPoints: continuation * 100,
      explorationBasisPoints: (100 - continuation) * 100, evaluationWindowDays: window };
  } else {
    rule = { kind: form.ruleKind, condition: form.condition, response: "needs_human_review" };
  }
  const scope = { market: form.market, serviceRef: form.serviceRef, campaignFamilyRef: form.campaignFamilyRef,
    ...(form.countryOrRegion.trim() ? { countryOrRegion: form.countryOrRegion.trim() } : {}),
    ...(form.audienceStrategy.trim() ? { audienceStrategy: form.audienceStrategy.trim() } : {}),
    ...(form.platform ? { platform: form.platform } : {}) };
  const revision = head ? head.revision + 1 : 1;
  return Object.freeze({ operation: "save_draft" as const, seriesRef: form.seriesRef, revision,
    previousDraftHash: head?.draftHash ?? "GENESIS", idempotencyKey: `${form.seriesRef}.r${revision}`,
    scope, rule, priority, verification: { metric: form.metric, reviewCadence: form.reviewCadence,
      rollbackWhen: form.rollbackWhen.trim() } });
}

function ruleLabel(rule: SliceRule): string {
  if (rule.kind === "period_budget_cap") return `${rule.period} tavan · ${rule.maximumDecimal} ${rule.currency}`;
  if (rule.kind === "winner_continuation_rotation") return `Kazanan %${rule.continuationBasisPoints / 100} · keşif %${rule.explorationBasisPoints / 100}`;
  if (rule.kind === "delivery_guardrail") return `Teslimat koruması · ${rule.condition}`;
  return rule.kind;
}
function date(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value));
}

export function SliceRuleWorkspaceSurface(props: Readonly<{
  state: State;
  onRetry(): void;
  onSaved(): Promise<void>;
}>) {
  const snapshot = props.state.status === "ready" ? props.state.snapshot : null;
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [headRef, setHeadRef] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const head = snapshot?.items.find((item) => item.seriesRef === headRef) ?? undefined;
  const command = useMemo(() => buildSliceRuleDraftCommand(form, head), [form, head]);
  const update = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!command || !snapshot?.authority.canSaveDraft) return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/slice-rule-workspace", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "slice-rule-workspace-save" },
        body: JSON.stringify({ command }) });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Taslak kaydedilemedi.");
      setMessage("Recommendation-only taslak append-only kayıt defterine eklendi.");
      await props.onSaved();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Taslak kaydedilemedi."); }
    finally { setSaving(false); }
  };
  return <div className={styles.workspace}>
    <header className={styles.hero}><div><span>SLICE RULE WORKSPACE</span><h1>Kanıtlı kapsam için işletim kuralı taslağı</h1><p>Pazar, hizmet ve kampanya ailesi açıkça seçilir. Bu alan yalnız öneri taslağı kaydeder.</p></div><strong>RECOMMENDATION ONLY · AUTHORITY NONE</strong></header>
    {props.state.status === "loading" ? <section className={styles.state} role="status">Taslak kayıt defteri doğrulanıyor…</section> : null}
    {props.state.status === "unavailable" || props.state.status === "error" ? <section className={styles.state} role="alert"><h2>{props.state.status === "unavailable" ? "Kaynak bağlı değil" : "Çalışma alanı okunamadı"}</h2><p>{props.state.message}</p><button onClick={props.onRetry}>Tekrar dene</button></section> : null}
    {snapshot ? <div className={styles.grid}>
      <section className={styles.panel}><div className={styles.panelTitle}><div><span>MEVCUT TASLAKLAR</span><h2>{snapshot.items.length} güncel seri</h2></div><small>Append-only</small></div>
        <div className={styles.list}>{snapshot.items.length === 0 ? <p>Henüz kayıtlı slice rule taslağı yok.</p> : snapshot.items.map((item) => <button key={item.draftRef} type="button" data-active={headRef === item.seriesRef} onClick={() => { setHeadRef(item.seriesRef); setForm((current) => ({ ...current, seriesRef: item.seriesRef, market: item.scope.market,
          serviceRef: item.scope.serviceRef, campaignFamilyRef: item.scope.campaignFamilyRef,
          countryOrRegion: item.scope.countryOrRegion ?? "", audienceStrategy: item.scope.audienceStrategy ?? "",
          platform: item.scope.platform ?? "" })); }}><strong>{item.seriesRef} · r{item.revision}</strong><span>{item.scope.market === "domestic" ? "Yerli" : "Yabancı"} · {item.scope.serviceRef} · {item.scope.campaignFamilyRef}</span><small>{ruleLabel(item.operatingRule.rule)} · {date(item.createdAt)}</small></button>)}</div>
        <button className={styles.newButton} type="button" onClick={() => { setHeadRef(null); setForm(EMPTY_FORM); }}>+ Yeni seri</button>
      </section>
      <section className={styles.panel}><div className={styles.panelTitle}><div><span>{head ? `REVİZYON ${head.revision + 1}` : "YENİ TASLAK"}</span><h2>Kapsam ve kural</h2></div><small>{snapshot.authority.canSaveDraft ? "Owner · Admin · Analyst" : "Viewer · salt okunur"}</small></div>
        <fieldset disabled={!snapshot.authority.canSaveDraft || saving} className={styles.form}>
          <label>Seri referansı<input value={form.seriesRef} disabled={Boolean(head)} onChange={(event) => update("seriesRef", event.target.value)} placeholder="slice_rule.ftr.ar" /></label>
          <div className={styles.row}><label>Pazar<select value={form.market} disabled={Boolean(head)} onChange={(event) => update("market", event.target.value as Market)}><option value="domestic">Yerli</option><option value="international">Yabancı</option></select></label><label>Platform (opsiyonel)<select value={form.platform} disabled={Boolean(head)} onChange={(event) => update("platform", event.target.value as Form["platform"])}><option value="">Tümü / belirtilmedi</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="mixed">Karma</option></select></label></div>
          <label>Hizmet referansı<input value={form.serviceRef} disabled={Boolean(head)} onChange={(event) => update("serviceRef", event.target.value)} placeholder="service_physical_therapy" /></label>
          <label>Kampanya ailesi referansı<input value={form.campaignFamilyRef} disabled={Boolean(head)} onChange={(event) => update("campaignFamilyRef", event.target.value)} placeholder="campaign_family_intensive_ftr" /></label>
          <div className={styles.row}><label>Ülke / bölge (opsiyonel)<input value={form.countryOrRegion} disabled={Boolean(head)} onChange={(event) => update("countryOrRegion", event.target.value)} /></label><label>Hedefleme stratejisi (opsiyonel)<input value={form.audienceStrategy} disabled={Boolean(head)} onChange={(event) => update("audienceStrategy", event.target.value)} /></label></div>
          <label>Kural türü<select value={form.ruleKind} onChange={(event) => update("ruleKind", event.target.value as Form["ruleKind"])}><option value="period_budget_cap">Dönemsel bütçe tavanı</option><option value="winner_continuation_rotation">Kazananı sürdür / keşif rotasyonu</option><option value="delivery_guardrail">Teslimat koruması</option></select></label>
          {form.ruleKind === "period_budget_cap" ? <div className={styles.row}><label>Dönem<select value={form.period} onChange={(event) => update("period", event.target.value as Form["period"])}><option value="daily">Günlük</option><option value="weekly">Haftalık</option><option value="monthly">Aylık</option></select></label><label>Tavan<input value={form.maximumDecimal} onChange={(event) => update("maximumDecimal", event.target.value)} inputMode="decimal" placeholder="250000" /></label><label>Para birimi<input value={form.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} maxLength={3} /></label></div> : null}
          {form.ruleKind === "winner_continuation_rotation" ? <div className={styles.row}><label>Kazanan payı %<input value={form.continuationPercent} onChange={(event) => update("continuationPercent", event.target.value)} inputMode="numeric" /></label><label>Ölçüm penceresi (gün)<input value={form.evaluationWindowDays} onChange={(event) => update("evaluationWindowDays", event.target.value)} inputMode="numeric" /></label></div> : null}
          {form.ruleKind === "delivery_guardrail" ? <label>Koşul<select value={form.condition} onChange={(event) => update("condition", event.target.value as Form["condition"])}><option value="delivery_interrupted">Teslimat kesintisi</option><option value="capacity_constrained">Kapasite kısıtı</option><option value="payment_or_account_review">Ödeme / hesap incelemesi</option></select></label> : null}
          <div className={styles.row}><label>Öncelik (0–100)<input value={form.priority} onChange={(event) => update("priority", event.target.value)} inputMode="numeric" /></label><label>İnceleme sıklığı<select value={form.reviewCadence} onChange={(event) => update("reviewCadence", event.target.value as Form["reviewCadence"])}><option value="daily">Günlük</option><option value="weekly">Haftalık</option><option value="monthly">Aylık</option></select></label></div>
          <label>Beklenen metrik<select value={form.metric} onChange={(event) => update("metric", event.target.value as Form["metric"])}><option value="qualified_leads">Nitelikli lead</option><option value="cost_per_qualified_lead">Nitelikli lead maliyeti</option><option value="engagement_rate">Etkileşim oranı</option><option value="delivery_health">Teslimat sağlığı</option></select></label>
          <label>Geri alma / yeniden inceleme koşulu<textarea value={form.rollbackWhen} onChange={(event) => update("rollbackWhen", event.target.value)} rows={3} /></label>
        </fieldset>
        <div className={styles.safety}><strong>Yetki sınırı</strong><span>Policy yayınlama: kapalı</span><span>Onay: kapalı</span><span>Action/Meta write: kapalı</span><span>Otomasyon: kapalı</span></div>
        {message ? <p className={styles.message} role="status">{message}</p> : null}
        <button className={styles.save} type="button" disabled={!command || !snapshot.authority.canSaveDraft || saving} onClick={() => void save()}>{saving ? "Kaydediliyor…" : head ? "Yeni revizyonu kaydet" : "Taslağı kaydet"}</button>
      </section>
    </div> : null}
  </div>;
}

export function SliceRuleWorkspacePanel() {
  const [state, setState] = useState<State>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/slice-rule-workspace", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "slice-rule-workspace-read" } });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setState({ status: response.status === 503 || response.status === 401 ? "unavailable" : "error",
          message: payload.error?.message ?? "Slice Rule Workspace yanıtı alınamadı." }); return;
      }
      setState({ status: "ready", snapshot: parseSliceRuleWorkspaceSnapshot(payload) });
    } catch { setState({ status: "error", message: "Slice Rule Workspace bağlantısı kurulamadı." }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <SliceRuleWorkspaceSurface state={state} onRetry={() => void load()} onSaved={load} />;
}

export { CLOSED as SLICE_RULE_CLOSED_AUTHORITY, EMPTY_FORM as EMPTY_SLICE_RULE_FORM };
