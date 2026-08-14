"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  DeliveryHealthAlertCommand,
  DeliveryHealthChecklistItem,
} from "@/domain/meta/delivery-health-alert-ledger";
import { LocalSessionConnector } from "./local-session-connector";
import dashboardStyles from "./operating-dashboard.module.css";
import styles from "./delivery-health-alert-panel.module.css";

const CHECKLIST_ITEMS = [
  "verify_evidence",
  "inspect_account_and_delivery",
  "confirm_recovery_or_false_positive",
  "notify_responsible",
] as const satisfies readonly DeliveryHealthChecklistItem[];

const CHECKLIST_LABELS: Readonly<Record<DeliveryHealthChecklistItem, string>> = {
  verify_evidence: "Kanıtı ve kaynağını doğrula",
  inspect_account_and_delivery: "Hesap, ödeme ve teslimat durumunu incele",
  confirm_recovery_or_false_positive: "İyileşmeyi veya yanlış alarmı doğrula",
  notify_responsible: "Sorumlu kişiyi bilgilendir",
};

type AlertAuthority = Readonly<{
  canApprove: false;
  canExecute: false;
  canWriteMeta: false;
  canEnableAutomation: false;
}>;

export type PublicDeliveryHealthAlert = Readonly<{
  schemaVersion: "public-delivery-health-alert/1.0.0";
  alertRef: string;
  accountRef: string;
  evidence: Readonly<{
    level: "confirmed" | "suspected";
    officialState: "payment_required" | "account_disabled" | "delivery_rejected" | "delivery_limited" | null;
  }>;
  evidenceHash: string;
  alertHash: string;
  sequence: number;
  recordHash: string;
  status: "open" | "investigating" | "resolved";
  recommendationDisposition: "hold_recommendations" | "needs_human_review" | "released";
  assignedActorRef: string;
  checklist: Readonly<Record<DeliveryHealthChecklistItem, boolean>>;
  detectedAt: string;
  updatedAt: string;
  authority: AlertAuthority;
}>;

type AlertListAuthority = AlertAuthority & Readonly<{ canRead: true; canManageWorkflow: boolean }>;
export type DeliveryHealthAlertList = Readonly<{
  contractVersion: "delivery-health-alert-http/1.0.0";
  items: readonly PublicDeliveryHealthAlert[];
  authority: AlertListAuthority;
}>;

export type DeliveryHealthAlertDashboardState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "session_required"; message: string }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>
  | Readonly<{ status: "ready"; result: DeliveryHealthAlertList; busyAlertRef: string | null;
    error: string | null; notice: string | null }>;

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const OFFICIAL_STATES = new Set(["payment_required", "account_disabled", "delivery_rejected", "delivery_limited"]);
const STATUSES = new Set(["open", "investigating", "resolved"]);
const DISPOSITIONS = new Set(["hold_recommendations", "needs_human_review", "released"]);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function closedAuthority(value: unknown): value is AlertAuthority {
  return record(value) && value.canApprove === false && value.canExecute === false
    && value.canWriteMeta === false && value.canEnableAutomation === false;
}

function validChecklist(value: unknown): value is PublicDeliveryHealthAlert["checklist"] {
  return record(value) && exact(value, CHECKLIST_ITEMS)
    && CHECKLIST_ITEMS.every((item) => typeof value[item] === "boolean");
}

function parseAlert(value: unknown): PublicDeliveryHealthAlert | null {
  if (!record(value) || !exact(value, ["schemaVersion", "alertRef", "accountRef", "evidence", "evidenceHash",
    "alertHash", "sequence", "recordHash", "status", "recommendationDisposition", "assignedActorRef", "checklist",
    "detectedAt", "updatedAt", "authority"]) || value.schemaVersion !== "public-delivery-health-alert/1.0.0"
    || typeof value.alertRef !== "string" || !REF.test(value.alertRef)
    || typeof value.accountRef !== "string" || !REF.test(value.accountRef)
    || typeof value.assignedActorRef !== "string" || !REF.test(value.assignedActorRef)
    || typeof value.evidenceHash !== "string" || !HASH.test(value.evidenceHash)
    || typeof value.alertHash !== "string" || !HASH.test(value.alertHash)
    || typeof value.recordHash !== "string" || !HASH.test(value.recordHash)
    || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1
    || typeof value.status !== "string" || !STATUSES.has(value.status)
    || typeof value.recommendationDisposition !== "string" || !DISPOSITIONS.has(value.recommendationDisposition)
    || typeof value.detectedAt !== "string" || !Number.isFinite(Date.parse(value.detectedAt))
    || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
    || !validChecklist(value.checklist) || !closedAuthority(value.authority) || !record(value.evidence)
    || !exact(value.evidence, ["level", "officialState"]) || !["confirmed", "suspected"].includes(String(value.evidence.level))) return null;
  const officialState = value.evidence.officialState;
  if (value.evidence.level === "confirmed" && (typeof officialState !== "string" || !OFFICIAL_STATES.has(officialState))) return null;
  if (value.evidence.level === "suspected" && officialState !== null) return null;
  if (value.status === "resolved" && value.recommendationDisposition !== "released") return null;
  if (value.status !== "resolved" && value.evidence.level === "confirmed"
    && value.recommendationDisposition !== "hold_recommendations") return null;
  if (value.status !== "resolved" && value.evidence.level === "suspected"
    && value.recommendationDisposition !== "needs_human_review") return null;
  return value as unknown as PublicDeliveryHealthAlert;
}

/** Fail closed before treating the delivery ledger response as live operational evidence. */
export function parseDeliveryHealthAlertList(value: unknown): DeliveryHealthAlertList | null {
  if (!record(value) || !exact(value, ["contractVersion", "items", "authority"])
    || value.contractVersion !== "delivery-health-alert-http/1.0.0" || !Array.isArray(value.items)
    || value.items.length > 100 || !record(value.authority)
    || !exact(value.authority, ["canRead", "canManageWorkflow", "canApprove", "canExecute", "canWriteMeta", "canEnableAutomation"])
    || value.authority.canRead !== true || typeof value.authority.canManageWorkflow !== "boolean"
    || !closedAuthority(value.authority)) return null;
  const items = value.items.map(parseAlert);
  if (items.some((item) => item === null)) return null;
  return Object.freeze({ contractVersion: value.contractVersion, items: Object.freeze(items as PublicDeliveryHealthAlert[]),
    authority: Object.freeze(value.authority as unknown as AlertListAuthority) });
}

export async function transitionDeliveryHealthAlert(
  fetcher: typeof fetch,
  input: Readonly<{ alert: PublicDeliveryHealthAlert; command: DeliveryHealthAlertCommand }>,
): Promise<PublicDeliveryHealthAlert> {
  const response = await fetcher("/api/delivery-health-alerts", { method: "POST", cache: "no-store",
    credentials: "same-origin", headers: { "Content-Type": "application/json",
      "X-ReklamZeka-Intent": "delivery-health-alert-transition" },
    body: JSON.stringify({ alertRef: input.alert.alertRef, expectedRecordHash: input.alert.recordHash,
      command: input.command }) });
  const payload = await response.json() as unknown;
  if (!response.ok || !record(payload) || !exact(payload, ["contractVersion", "item", "authority"])
    || payload.contractVersion !== "delivery-health-alert-transition/1.0.0" || !closedAuthority(payload.authority)) {
    const message = record(payload) && record(payload.error) && typeof payload.error.message === "string"
      ? payload.error.message : "Alarm iş akışı güncellenemedi.";
    throw new Error(message);
  }
  const item = parseAlert(payload.item);
  if (!item || item.alertRef !== input.alert.alertRef || item.sequence !== input.alert.sequence + 1) {
    throw new Error("Alarm yanıtı güvenli biçimde doğrulanamadı.");
  }
  return item;
}

const EVIDENCE_LABELS = { confirmed: "Doğrulanmış Meta sinyali", suspected: "Şüpheli teslimat kesintisi" } as const;
const OFFICIAL_LABELS: Readonly<Record<Exclude<PublicDeliveryHealthAlert["evidence"]["officialState"], null>, string>> = {
  payment_required: "Ödeme gerekli", account_disabled: "Hesap devre dışı", delivery_rejected: "Teslimat reddedildi",
  delivery_limited: "Teslimat sınırlandı",
};
const STATUS_LABELS = { open: "Açık", investigating: "İnceleniyor", resolved: "Çözüldü" } as const;
const DISPOSITION_LABELS = { hold_recommendations: "Öneriler beklemede", needs_human_review: "İnsan incelemesi gerekli",
  released: "Öneri bekletmesi kaldırıldı" } as const;

function timestamp(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" })
    .format(new Date(value));
}

function AlertCard(props: Readonly<{ item: PublicDeliveryHealthAlert; canManage: boolean; busy: boolean;
  onTransition(item: PublicDeliveryHealthAlert, command: DeliveryHealthAlertCommand): void }>) {
  const { item } = props;
  const [assignee, setAssignee] = useState(item.assignedActorRef);
  const allChecked = CHECKLIST_ITEMS.every((checklistItem) => item.checklist[checklistItem]);
  return <article className={styles.alertCard} data-evidence={item.evidence.level}>
    <header>
      <div><span className={styles.evidenceBadge}>{EVIDENCE_LABELS[item.evidence.level]}</span><h2>{item.accountRef}</h2>
        <p>{item.evidence.officialState ? OFFICIAL_LABELS[item.evidence.officialState] : "Resmî Meta hata durumu iddia edilmiyor"}</p></div>
      <div className={styles.statusStack}><span>{STATUS_LABELS[item.status]}</span><strong>{DISPOSITION_LABELS[item.recommendationDisposition]}</strong></div>
    </header>
    <dl className={styles.factGrid}><div><dt>Alarm</dt><dd>{item.alertRef}</dd></div><div><dt>Sorumlu</dt><dd>{item.assignedActorRef}</dd></div>
      <div><dt>Algılandı</dt><dd>{timestamp(item.detectedAt)}</dd></div><div><dt>Son kayıt</dt><dd>#{item.sequence} · {timestamp(item.updatedAt)}</dd></div></dl>
    <section className={styles.checklist} aria-label={`${item.alertRef} kontrol listesi`}><h3>İnsan kontrol listesi</h3>
      {CHECKLIST_ITEMS.map((checklistItem) => <label key={checklistItem}><input type="checkbox"
        checked={item.checklist[checklistItem]} disabled={!props.canManage || props.busy || item.status === "resolved"}
        onChange={(event) => props.onTransition(item, { kind: "set_checklist_item", item: checklistItem,
          completed: event.target.checked })} /><span>{CHECKLIST_LABELS[checklistItem]}</span></label>)}</section>
    <footer className={styles.workflowControls}>
      <label><span>Sorumlu ref</span><input value={assignee} disabled={!props.canManage || props.busy}
        onChange={(event) => setAssignee(event.target.value)} /></label>
      <button type="button" disabled={!props.canManage || props.busy || assignee === item.assignedActorRef || !REF.test(assignee)}
        onClick={() => props.onTransition(item, { kind: "assign", assignedActorRef: assignee })}>Sorumluyu ata</button>
      {item.status === "open" ? <button type="button" disabled={!props.canManage || props.busy}
        onClick={() => props.onTransition(item, { kind: "start_investigation" })}>İncelemeyi başlat</button> : null}
      {item.status !== "resolved" ? <button type="button" disabled={!props.canManage || props.busy || !allChecked}
        onClick={() => props.onTransition(item, { kind: "resolve" })}>Çözüldü olarak kapat</button>
        : <button type="button" disabled={!props.canManage || props.busy}
          onClick={() => props.onTransition(item, { kind: "reopen" })}>Yeniden aç</button>}
    </footer>
    <p className={styles.authorityNote}>Bu iş akışı yalnız alarm kaydını günceller. Onay, execute, otomasyon ve Meta write yetkisi: <strong>yok</strong>.</p>
  </article>;
}

export function DeliveryHealthAlertSurface(props: Readonly<{ state: DeliveryHealthAlertDashboardState; onRetry(): void;
  embedded?: boolean;
  onConnect?(): Promise<boolean>;
  onTransition(item: PublicDeliveryHealthAlert, command: DeliveryHealthAlertCommand): void }>) {
  const ready = props.state.status === "ready" ? props.state : null;
  const Heading = props.embedded ? "h2" : "h1";
  return <>
    <section className={`${dashboardStyles.pageHero} ${props.embedded ? dashboardStyles.embeddedHero : ""}`}><div><span className={dashboardStyles.kicker}>DELIVERY & PAYMENT ALERTS · HUMAN WORKFLOW</span>
      <Heading>Ödeme ve teslimat kesintilerini kanıt seviyesiyle yönetin.</Heading><p>Resmî Meta durumu ile performanstan türeyen şüphe ayrı tutulur. Açık alarm önerileri bekletebilir; bu ekran kampanya açıp kapatmaz, bütçe değiştirmez ve Meta’ya yazmaz.</p></div>
      <span className={dashboardStyles.readOnlyBadge}>WORKFLOW ONLY · AUTHORITY NONE</span></section>
    {props.state.status === "loading" ? <section className={styles.statePanel} role="status"><h2>Delivery alarm kayıtları okunuyor</h2><p>Tenant kapsamı ve append-only kayıt bütünlüğü doğrulanıyor.</p></section> : null}
    {props.state.status === "session_required" ? <section className={styles.statePanel} role="alert"><strong>YEREL OTURUM GEREKLİ</strong><h2>Alarm çalışma alanını bağlayın</h2><p>{props.state.message}</p>{props.onConnect ? <LocalSessionConnector title="Alarm çalışma alanını bağlayın" onVerify={props.onConnect} /> : <button onClick={props.onRetry}>Tekrar dene</button>}</section> : null}
    {props.state.status === "unavailable" ? <section className={styles.statePanel} role="alert"><strong>Kaynak henüz bağlı değil</strong><h2>{props.state.message}</h2><p>Alarm kayıt defteri yapılandırılana kadar iş akışı açılamaz.</p><button onClick={props.onRetry}>Tekrar kontrol et</button></section> : null}
    {props.state.status === "error" ? <section className={styles.statePanel} role="alert"><strong>Alarm kayıtları okunamadı</strong><h2>{props.state.message}</h2><p>Bozuk veya yetki sınırını aşan yanıtlar kısmen gösterilmez.</p><button onClick={props.onRetry}>Tekrar dene</button></section> : null}
    {ready?.error ? <p className={styles.feedback} role="alert">{ready.error}</p> : null}
    {ready?.notice ? <p className={styles.feedback} data-tone="good" role="status">{ready.notice}</p> : null}
    {ready && ready.result.items.length === 0 ? <section className={styles.statePanel}><strong>Kaynak bağlı · açık veya geçmiş alarm yok</strong><h2>Bu çalışma alanında delivery/payment alarm kaydı bulunmuyor.</h2><p>Kayıt defteri başarıyla okundu; gösterilebilir alarm bulunamadı.</p></section> : null}
    {ready && ready.result.items.length > 0 ? <section className={styles.alertGrid}>{ready.result.items.map((item) => <AlertCard key={item.alertRef}
      item={item} canManage={ready.result.authority.canManageWorkflow} busy={ready.busyAlertRef === item.alertRef}
      onTransition={props.onTransition} />)}</section> : null}
  </>;
}

export function DeliveryHealthAlertPanel({ embedded = false }: Readonly<{ embedded?: boolean }> = {}) {
  const [state, setState] = useState<DeliveryHealthAlertDashboardState>({ status: "loading" });
  const load = useCallback(async (): Promise<boolean> => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/delivery-health-alerts", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "delivery-health-alert-read" } });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const code = record(payload) && record(payload.error) && typeof payload.error.code === "string"
          ? payload.error.code : null;
        const message = record(payload) && record(payload.error) && typeof payload.error.message === "string"
          ? payload.error.message : "Delivery alarm kaynağı kullanılamıyor.";
        setState({ status: response.status === 401 || code === "local_session_required" ? "session_required"
          : response.status === 503 ? "unavailable" : "error", message });
        return false;
      }
      const result = parseDeliveryHealthAlertList(payload);
      if (!result) throw new Error("invalid_contract");
      setState({ status: "ready", result, busyAlertRef: null, error: null, notice: null });
      return true;
    } catch { setState({ status: "error", message: "Delivery alarm bağlantısı güvenli biçimde okunamadı." }); return false; }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const transition = useCallback(async (item: PublicDeliveryHealthAlert, command: DeliveryHealthAlertCommand) => {
    setState((current) => current.status === "ready" ? { ...current, busyAlertRef: item.alertRef, error: null, notice: null } : current);
    try {
      const updated = await transitionDeliveryHealthAlert(fetch, { alert: item, command });
      setState((current) => current.status === "ready" ? { ...current, busyAlertRef: null,
        result: { ...current.result, items: current.result.items.map((candidate) => candidate.alertRef === updated.alertRef ? updated : candidate) },
        error: null, notice: "İnsan iş akışı kaydı append-only ledger'a eklendi." } : current);
    } catch (reason) {
      setState((current) => current.status === "ready" ? { ...current, busyAlertRef: null,
        error: reason instanceof Error ? reason.message : "Alarm iş akışı güncellenemedi.", notice: null } : current);
    }
  }, []);
  return <DeliveryHealthAlertSurface state={state} embedded={embedded} onRetry={() => void load()} onConnect={load}
    onTransition={(item, command) => void transition(item, command)} />;
}
