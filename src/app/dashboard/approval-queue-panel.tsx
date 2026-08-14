"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ApprovalQueueDetailRecord, ApprovalQueueReadService, ApprovalQueueRecord } from "@/application/approval-queue-read-service";
import { LocalSessionConnector } from "./local-session-connector";
import styles from "./operating-dashboard.module.css";

type ApprovalQueueListResult = Awaited<ReturnType<ApprovalQueueReadService["list"]>>;
type ApprovalQueueDetailResult = Awaited<ReturnType<ApprovalQueueReadService["get"]>>;

export type ApprovalQueueDashboardState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "session_required" | "unavailable" | "error"; message: string }>
  | Readonly<{
    status: "ready";
    result: ApprovalQueueListResult;
    selected: ApprovalQueueRecord | ApprovalQueueDetailRecord | null;
    detailLoading: boolean;
  }>;

type Envelope<T> = Readonly<{ result: T }>;
type ErrorEnvelope = Readonly<{ error?: Readonly<{ code?: string; message?: string }> }>;
type DecisionKind = "approve" | "reject" | "request_changes";
type DecisionControl = Readonly<{
  busy: boolean;
  confirmed: boolean;
  error: string | null;
  notice: string | null;
  setConfirmed(value: boolean): void;
  decide(kind: DecisionKind): void;
}>;

const ACTION_LABELS: Readonly<Record<ApprovalQueueRecord["actionType"], string>> = {
  status_pause: "Duraklatma önerisi",
  status_activate: "Aktifleştirme önerisi",
  budget_decrease: "Bütçe azaltma önerisi",
  budget_increase: "Bütçe artırma önerisi",
};

const STATUS_LABELS: Readonly<Record<ApprovalQueueRecord["status"], string>> = {
  proposed: "Önerildi",
  awaiting_approval: "Onay bekliyor",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  changes_requested: "Değişiklik istendi",
  expired: "Süresi doldu",
  stale: "Güncelliğini yitirdi",
  suppressed: "Bastırıldı",
  parked: "Beklemeye alındı",
  executing: "Yürütülüyor",
  verified: "Doğrulandı",
  failed: "Başarısız",
  dependency_failed: "Bağımlılık başarısız",
  rollback_proposed: "Geri alma önerildi",
  rolled_back: "Geri alındı",
  superseded: "Yeni sürümle değişti",
};

const ENTITY_LABELS: Readonly<Record<ApprovalQueueRecord["entity"]["type"], string>> = {
  campaign: "Kampanya",
  ad_set: "Reklam seti",
  ad: "Reklam",
};

function timestamp(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul",
  }).format(new Date(value));
}

function valuePair(change: ApprovalQueueRecord["beforeAfter"]) {
  if (change.field === "configured_status") {
    return { field: "Yayın durumu", before: change.before, after: change.after };
  }
  const format = (minor: number) => new Intl.NumberFormat("tr-TR", {
    style: "currency", currency: change.currency, maximumFractionDigits: 2,
  }).format(minor / 100);
  return {
    field: change.field === "daily_budget_minor" ? "Günlük bütçe" : "Toplam bütçe",
    before: format(change.beforeMinor), after: format(change.afterMinor),
  };
}

export async function recordApprovalDecision(
  fetcher: typeof fetch,
  input: Readonly<{ unitRef: string; kind: DecisionKind }>,
): Promise<Readonly<{ state: string }>> {
  const intent = input.kind === "approve" ? "approval-queue-approve"
    : input.kind === "reject" ? "approval-queue-reject" : "approval-queue-request-changes";
  const reasonCode = input.kind === "approve" ? "human.confirmed"
    : input.kind === "reject" ? "human.rejected" : "human.changes_requested";
  const challengeResponse = await fetcher("/api/approval-queue", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "approval-queue-confirm-human-presence" },
    body: JSON.stringify({ unitRef: input.unitRef, action: input.kind }),
  });
  const challengePayload = await challengeResponse.json() as Readonly<{
    challenge?: Readonly<{ unitRef?: string; action?: string; proof?: string }>;
    error?: Readonly<{ message?: string }>;
  }>;
  if (!challengeResponse.ok || challengePayload.challenge?.unitRef !== input.unitRef
    || challengePayload.challenge.action !== input.kind || typeof challengePayload.challenge.proof !== "string") {
    throw new Error(challengePayload.error?.message ?? "İnsan onayı doğrulanamadı.");
  }
  const decisionResponse = await fetcher("/api/approval-queue", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": intent },
    body: JSON.stringify({ unitRef: input.unitRef, reasonCode, humanPresenceProof: challengePayload.challenge.proof }),
  });
  const decisionPayload = await decisionResponse.json() as Readonly<{
    decision?: Readonly<{ unitRef?: string; state?: string }>;
    authority?: Readonly<{ canExecute?: boolean; canWriteMeta?: boolean }>;
    error?: Readonly<{ message?: string }>;
  }>;
  if (!decisionResponse.ok || decisionPayload.decision?.unitRef !== input.unitRef
    || decisionPayload.authority?.canExecute !== false || decisionPayload.authority.canWriteMeta !== false
    || typeof decisionPayload.decision.state !== "string") {
    throw new Error(decisionPayload.error?.message ?? "Karar kaydedilemedi; kuyruğu yenileyin.");
  }
  return Object.freeze({ state: decisionPayload.decision.state });
}

function toneForStatus(status: ApprovalQueueRecord["status"]) {
  if (status === "awaiting_approval" || status === "proposed") return "warning";
  if (status === "approved" || status === "verified") return "good";
  if (["rejected", "failed", "dependency_failed", "expired", "stale"].includes(status)) return "danger";
  return "neutral";
}

export function ApprovalQueueReadSurface(props: Readonly<{
  state: ApprovalQueueDashboardState;
  onRetry(): void;
  onSelect(item: ApprovalQueueRecord): void;
  decision?: DecisionControl;
  onConnect?: () => Promise<boolean>;
  detailHeadingRef?: RefObject<HTMLHeadingElement | null>;
}>) {
  const ready = props.state.status === "ready" ? props.state : null;
  return <>
    <section className={styles.pageHero}>
      <div><span className={styles.kicker}>ONAY KUYRUĞU · İNSAN KARARI</span><h1>Hareket adaylarını tek tek inceleyin ve karar verin.</h1><p>Her karar tek bir eylem satırına bağlanır ve sistem diyaloğunda ayrıca doğrulanır. Onay yalnız karar kaydıdır; uygulama veya Meta değişikliği yapmaz.</p></div>
      <span className={styles.readOnlyBadge}>İNSAN KARARI · META WRITE YOK</span>
    </section>

    {props.state.status === "loading" ? <section className={`${styles.panel} ${styles.approvalQueueState}`} role="status"><span className={styles.liveDot} /><h2>Onay kuyruğu okunuyor</h2><p>Çalışma alanı kapsamı, güvenli özet ve eylem satırı bütünlüğü sunucuda doğrulanıyor.</p></section> : null}
    {props.state.status === "session_required" ? <section className={`${styles.panel} ${styles.approvalQueueState}`} role="alert"><strong>YEREL OTURUM GEREKLİ</strong><h2>Onay çalışma alanını bağlayın</h2><p>{props.state.message}</p>{props.onConnect ? <LocalSessionConnector title="Onay çalışma alanını bağlayın" onVerify={props.onConnect} /> : <button onClick={props.onRetry}>Tekrar dene</button>}</section> : null}
    {props.state.status === "unavailable" ? <section className={`${styles.panel} ${styles.approvalQueueState}`} role="alert"><strong>Kaynak henüz bağlı değil</strong><h2>{props.state.message}</h2><p>Bağlı üretim repository’si olmadan örnek onay kaydı gösterilmez.</p><button onClick={props.onRetry}>Tekrar kontrol et</button></section> : null}
    {props.state.status === "error" ? <section className={`${styles.panel} ${styles.approvalQueueState}`} role="alert"><strong>Onay kuyruğu okunamadı</strong><h2>{props.state.message}</h2><p>Kapsam dışı veya güvenli projection sınırını aşan kayıtlar kısmen gösterilmez.</p><button onClick={props.onRetry}>Tekrar dene</button></section> : null}
    {ready && ready.result.items.length === 0 ? <section className={`${styles.panel} ${styles.approvalQueueState}`}><strong>Kaynak bağlı · kuyruk boş</strong><h2>İncelenecek eylem satırı bulunmuyor.</h2><p>Bağlı çalışma alanı boş yanıt döndürdü; örnek kayıt eklenmedi.</p></section> : null}
    {ready && ready.result.items.length > 0 ? <div className={styles.approvalQueueWorkspace}>
      <section className={`${styles.panel} ${styles.approvalQueueIndex}`}>
        <header className={styles.panelHeader}><div><span className={styles.kicker}>EYLEM SATIRLARI</span><h2>{ready.result.items.length} kayıt</h2></div><span>Güvenli özet</span></header>
        <div>{ready.result.items.map((item) => {
          const values = valuePair(item.beforeAfter);
          return <button key={item.unitRef} data-active={ready.selected?.unitRef === item.unitRef} aria-pressed={ready.selected?.unitRef === item.unitRef} onClick={() => props.onSelect(item)}>
            <header><span data-tone={toneForStatus(item.status)}>{STATUS_LABELS[item.status]}</span><i>{item.risk}</i></header>
            <strong>{ACTION_LABELS[item.actionType]}</strong>
            <small>{item.entity.label ?? ENTITY_LABELS[item.entity.type]} · {timestamp(item.createdAt)}</small>
            <p>{values.before} → {values.after}</p>
          </button>;
        })}</div>
      </section>
      <ApprovalQueueDetail item={ready.selected} loading={ready.detailLoading} decision={props.decision} detailHeadingRef={props.detailHeadingRef} />
    </div> : null}
  </>;
}

function ApprovalQueueDetail({ item, loading, decision, detailHeadingRef }: Readonly<{
  item: ApprovalQueueRecord | ApprovalQueueDetailRecord | null;
  loading: boolean;
  decision?: DecisionControl;
  detailHeadingRef?: RefObject<HTMLHeadingElement | null>;
}>) {
  if (loading) return <section className={`${styles.panel} ${styles.approvalQueueState}`} role="status"><span className={styles.liveDot} /><h2>Eylem satırı doğrulanıyor</h2><p>Liste özeti ile detay kaydı eşleştiriliyor.</p></section>;
  if (!item) return <section className={`${styles.panel} ${styles.approvalQueueState}`}><strong>Kayıt seçin</strong><h2>Önce/sonra, otonomi izi ve bağımlılıklar burada açılır.</h2><p>Tam kimlikler, hash, token, prompt ve ham Meta payload bu yüzeye çıkmaz.</p></section>;
  const values = valuePair(item.beforeAfter);
  return <section className={`${styles.panel} ${styles.approvalQueueDetail}`}>
    <header><div><span className={styles.kicker}>{ENTITY_LABELS[item.entity.type].toUpperCase()} · {item.risk}</span><h2 ref={detailHeadingRef} tabIndex={-1}>{ACTION_LABELS[item.actionType]}</h2><p>{item.entity.label ?? item.entity.ref} · {item.accountRef}</p></div><span className={styles.readOnlyBadge}>YALNIZ KARAR · UYGULAMA YOK</span></header>
    <div className={styles.approvalQueueFacts}><div><span>Durum</span><strong data-tone={toneForStatus(item.status)}>{STATUS_LABELS[item.status]}</strong><small>{item.summaryCode.replaceAll("_", " ")}</small></div><div><span>Otonomi kararı</span><strong>{item.autonomy.decision.replaceAll("_", " ")}</strong><small>{item.autonomy.profileRef}</small></div><div><span>Geçerlilik</span><strong>{timestamp(item.expiresAt)}</strong><small>Oluşturuldu: {timestamp(item.createdAt)}</small></div></div>
    <section className={styles.approvalQueueChange} aria-label={`${values.field} önce ve sonra`}><span>{values.field}</span><div><p><small>Önce</small><strong>{values.before}</strong></p><i>→</i><p><small>Sonra</small><strong>{values.after}</strong></p></div></section>
    <div className={styles.approvalQueueTrace}><h3>Otonomi izi</h3>{item.autonomy.trace.map((step, index) => <article key={`${step.scope}-${index}`}><span>{index + 1}</span><p><strong>{step.scope}</strong><small>{step.decision.replaceAll("_", " ")} · {step.reasonCode.replaceAll("_", " ")}</small></p></article>)}</div>
    {"sourceEvidence" in item && "decisionHistory" in item ? <>
      <div className={styles.approvalQueueTrace}><h3>Doğrulanmış kaynak kanıtı</h3>{item.sourceEvidence.length === 0 ? <p>Hash-doğrulanmış public-safe kaynak özeti bulunmuyor.</p> : item.sourceEvidence.map((evidence, index) => <article key={`${evidence.kind}-${index}`}><span>{index + 1}</span><p><strong>{evidence.kind.replaceAll("_", " ")}</strong><small>{evidence.label} · hash doğrulandı</small></p></article>)}</div>
      <div className={styles.approvalQueueTrace}><h3>İnsan karar geçmişi</h3>{item.decisionHistory.map((event, index) => <article key={`${event.decision}-${event.occurredAt}`}><span>{index + 1}</span><p><strong>{event.decision.replaceAll("_", " ")}</strong><small>{timestamp(event.occurredAt)}{event.reasonCode ? ` · ${event.reasonCode.replaceAll("_", " ")}` : ""}</small></p></article>)}</div>
    </> : null}
    <div className={styles.approvalQueueDependencies}><h3>Bağımlılıklar</h3>{item.dependencies.length === 0 ? <p>Bağımlılık yok.</p> : item.dependencies.map((dependency) => <p key={dependency.unitRef}><span>{dependency.unitRef}</span><strong>{STATUS_LABELS[dependency.status]}</strong></p>)}</div>
    {item.status === "awaiting_approval" && decision ? <section className={styles.approvalDecisionBox} aria-label="Tekil insan kararı">
      <h3>Bu eylem satırı için karar ver</h3>
      <label><input type="checkbox" checked={decision.confirmed} disabled={decision.busy} onChange={(event) => decision.setConfirmed(event.target.checked)} />
        <span>{values.field}: <strong>{values.before}</strong> → <strong>{values.after}</strong> değişimini inceledim. Kararın execute veya Meta write yapmadığını anlıyorum.</span>
      </label>
      {decision.error ? <p role="alert">{decision.error}</p> : null}
      {decision.notice ? <p role="status">{decision.notice}</p> : null}
      <div><button disabled={!decision.confirmed || decision.busy} onClick={() => decision.decide("reject")}>Reddet</button><button disabled={!decision.confirmed || decision.busy} onClick={() => decision.decide("request_changes")}>Değişiklik iste</button><button className={styles.primaryButton} disabled={!decision.confirmed || decision.busy} onClick={() => decision.decide("approve")}>{decision.busy ? "Sistem onayı bekleniyor…" : "Onayla"}</button></div>
    </section> : null}
    <footer><span>Onay yalnız approval evidence kaydıdır</span><span>Meta çağrısı yapılmaz</span></footer>
  </section>;
}

export function ApprovalQueuePanel({ campaignRef = null, campaignLabel = null, selectedUnitRef = null, onClearCampaignContext, campaignContextPending = false }: Readonly<{
  campaignRef?: string | null;
  campaignLabel?: string | null;
  /** An allowlisted DashboardLocation handoff; it is always re-read from the tenant-bound queue. */
  selectedUnitRef?: string | null;
  onClearCampaignContext?: () => void;
  campaignContextPending?: boolean;
}>) {
  const [state, setState] = useState<ApprovalQueueDashboardState>({ status: "loading" });
  const mounted = useRef(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionConfirmed, setDecisionConfirmed] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
  const listRequestEpoch = useRef(0);
  const detailRequestEpoch = useRef(0);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusDetailAfterSelectionRef = useRef(false);
  const consumedSelectedUnitRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focusDetailAfterSelectionRef.current || state.status !== "ready" || !state.selected || state.detailLoading) return;
    focusDetailAfterSelectionRef.current = false;
    detailHeadingRef.current?.focus();
  }, [state]);

  const load = useCallback(async () => {
    const requestEpoch = listRequestEpoch.current + 1;
    listRequestEpoch.current = requestEpoch;
    // A list refresh/context change makes every previously selected detail and
    // its confirmation state ineligible for display or a follow-up decision.
    detailRequestEpoch.current += 1;
    consumedSelectedUnitRef.current = null;
    setDecisionConfirmed(false);
    setDecisionError(null);
    setDecisionNotice(null);
    if (!mounted.current) return false;
    setState({ status: "loading" });
    if (campaignContextPending) return false;
    try {
      const query = new URLSearchParams({ view: "list", limit: "50" });
      if (campaignRef !== null) query.set("campaignRef", campaignRef);
      const response = await fetch(`/api/approval-queue?${query}`, { cache: "no-store" });
      const payload = await response.json() as Envelope<ApprovalQueueListResult> | ErrorEnvelope;
      if (!mounted.current || listRequestEpoch.current !== requestEpoch) return false;
      if (!response.ok) {
        const remoteError = "error" in payload ? payload.error : undefined;
        setState({ status: remoteError?.code === "local_session_required" ? "session_required" : response.status === 503 ? "unavailable" : "error", message: remoteError?.message ?? "Onay kuyruğu yanıtı alınamadı." });
        return false;
      }
      if (!("result" in payload) || payload.result.view !== "list") throw new Error("invalid_contract");
      setState({ status: "ready", result: payload.result, selected: null, detailLoading: false });
      return true;
    } catch {
      if (mounted.current && listRequestEpoch.current === requestEpoch) setState({ status: "error", message: "Onay kuyruğu bağlantısı şu anda kullanılamıyor." });
      return false;
    }
  }, [campaignContextPending, campaignRef]);

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);

  const select = useCallback(async (summary: ApprovalQueueRecord) => {
    const requestEpoch = detailRequestEpoch.current + 1;
    detailRequestEpoch.current = requestEpoch;
    const selectedCampaignRef = campaignRef;
    focusDetailAfterSelectionRef.current = true;
    setDecisionConfirmed(false);
    setDecisionError(null);
    setDecisionNotice(null);
    setState((current) => current.status === "ready" ? { ...current, selected: summary, detailLoading: true } : current);
    try {
      const query = new URLSearchParams({ view: "detail", unitRef: summary.unitRef });
      const response = await fetch(`/api/approval-queue?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("detail_failed");
      const payload = await response.json() as Envelope<ApprovalQueueDetailResult>;
      if (detailRequestEpoch.current !== requestEpoch) return;
      if (payload.result.view !== "detail" || payload.result.item.unitRef !== summary.unitRef
        || selectedCampaignRef !== null && payload.result.item.campaignRef !== selectedCampaignRef) throw new Error("invalid_contract");
      setState((current) => current.status === "ready"
        && current.selected?.unitRef === summary.unitRef
        ? { ...current, selected: payload.result.item, detailLoading: false }
        : current);
    } catch {
      if (mounted.current && detailRequestEpoch.current === requestEpoch) setState({ status: "error", message: "Eylem satırı güvenli biçimde okunamadı." });
    }
  }, [campaignRef]);

  useEffect(() => {
    if (selectedUnitRef === null) {
      consumedSelectedUnitRef.current = null;
      return;
    }
    if (state.status !== "ready" || consumedSelectedUnitRef.current === selectedUnitRef) return;
    const summary = state.result.items.find((item) => item.unitRef === selectedUnitRef);
    // The queue list is already tenant-scoped and (when present) campaign
    // scoped. Do not issue an unbound detail lookup when the routed alias is
    // absent from that verified list.
    consumedSelectedUnitRef.current = selectedUnitRef;
    if (!summary) {
      setState({ status: "error", message: "İstenen onay kaydı seçili çalışma alanı veya kampanya kapsamında bulunamadı." });
      return;
    }
    void select(summary);
  }, [selectedUnitRef, select, state]);

  const decide = useCallback(async (kind: DecisionKind) => {
    if (state.status !== "ready" || !state.selected || state.selected.status !== "awaiting_approval"
      || !decisionConfirmed || decisionBusy) return;
    const unitRef = state.selected.unitRef;
    setDecisionBusy(true);
    setDecisionError(null);
    setDecisionNotice("macOS sistem onayı bekleniyor…");
    try {
      await recordApprovalDecision(fetch, { unitRef, kind });
      setDecisionNotice("Karar kaydedildi. Meta üzerinde değişiklik yapılmadı.");
      setDecisionConfirmed(false);
      await load();
    } catch (error) {
      setDecisionNotice(null);
      setDecisionError(error instanceof Error ? error.message : "Karar güvenli biçimde kaydedilemedi.");
    } finally {
      setDecisionBusy(false);
    }
  }, [decisionBusy, decisionConfirmed, load, state]);

  return <>{campaignRef && campaignLabel ? <section className={`${styles.panel} ${styles.decisionRoomState}`} aria-label="Seçili kampanyanın onay bağlamı"><strong>SEÇİLİ KAMPANYA BAĞLAMI</strong><h2>{campaignLabel}</h2><p>Bu kuyruk, frozen bağlamın doğruladığı kampanya alias’ıyla sunucuda süzülür.</p>{onClearCampaignContext ? <button onClick={onClearCampaignContext}>Tüm çalışma alanına dön</button> : null}</section> : null}<ApprovalQueueReadSurface state={state} onRetry={() => void load()} onSelect={(item) => void select(item)} onConnect={load} detailHeadingRef={detailHeadingRef} decision={{
    busy: decisionBusy,
    confirmed: decisionConfirmed,
    error: decisionError,
    notice: decisionNotice,
    setConfirmed: setDecisionConfirmed,
    decide: (kind) => void decide(kind),
  }} /></>;
}
