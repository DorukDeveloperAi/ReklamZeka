"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApprovalQueueReadService, ApprovalQueueRecord } from "@/application/approval-queue-read-service";
import styles from "./operating-dashboard.module.css";

type ApprovalQueueListResult = Awaited<ReturnType<ApprovalQueueReadService["list"]>>;
type ApprovalQueueDetailResult = Awaited<ReturnType<ApprovalQueueReadService["get"]>>;

export type ApprovalQueueDashboardState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>
  | Readonly<{
    status: "ready";
    result: ApprovalQueueListResult;
    selected: ApprovalQueueRecord | null;
    detailLoading: boolean;
  }>;

type Envelope<T> = Readonly<{ result: T }>;
type ErrorEnvelope = Readonly<{ error?: Readonly<{ message?: string }> }>;

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
}>) {
  const ready = props.state.status === "ready" ? props.state : null;
  return <>
    <section className={styles.pageHero}>
      <div><span className={styles.kicker}>APPROVAL INBOX · VERIFIED READ MODEL</span><h1>Hareket adaylarını, yetki vermeden inceleyin.</h1><p>Bu görünüm onay kuyruğunu ve dondurulmuş karar izini okur. Onay, red, grant, execute ve Meta write bu aşamada kapalıdır.</p></div>
      <span className={styles.readOnlyBadge}>READ ONLY · NO META WRITE</span>
    </section>

    <section className={styles.approvalSafetyStrip} aria-label="Onay kuyruğu yetki sınırları">
      <span>Onay kapalı</span><span>Execute kapalı</span><span>Meta write kapalı</span><strong>GET-only</strong>
    </section>

    {props.state.status === "loading" ? <section className={`${styles.panel} ${styles.approvalQueueState}`} role="status"><span className={styles.liveDot} /><h2>Onay kuyruğu okunuyor</h2><p>Tenant kapsamı, public-safe projection ve ActionUnit bütünlüğü sunucuda doğrulanıyor.</p></section> : null}
    {props.state.status === "unavailable" ? <section className={`${styles.panel} ${styles.approvalQueueState}`} role="alert"><strong>Kaynak henüz bağlı değil</strong><h2>{props.state.message}</h2><p>Fixture kayıtlar canlı kuyruk gibi gösterilmez. Güvenli yerel oturum ve gerçek read repository bağlandığında bu görünüm açılır.</p><button onClick={props.onRetry}>Tekrar kontrol et</button></section> : null}
    {props.state.status === "error" ? <section className={`${styles.panel} ${styles.approvalQueueState}`} role="alert"><strong>Onay kuyruğu okunamadı</strong><h2>{props.state.message}</h2><p>Kapsam dışı veya güvenli projection sınırını aşan kayıtlar kısmen gösterilmez.</p><button onClick={props.onRetry}>Tekrar dene</button></section> : null}
    {ready && ready.result.items.length === 0 ? <section className={`${styles.panel} ${styles.approvalQueueState}`}><strong>Kaynak bağlı · kuyruk boş</strong><h2>İncelenecek ActionUnit bulunmuyor.</h2><p>Bu gerçek tenant-bound boş yanıttır; demo fallback değildir.</p></section> : null}
    {ready && ready.result.items.length > 0 ? <div className={styles.approvalQueueWorkspace}>
      <section className={`${styles.panel} ${styles.approvalQueueIndex}`}>
        <header className={styles.panelHeader}><div><span className={styles.kicker}>ACTION UNITS</span><h2>{ready.result.items.length} kayıt</h2></div><span>Public-safe</span></header>
        <div>{ready.result.items.map((item) => {
          const values = valuePair(item.beforeAfter);
          return <button key={item.unitRef} data-active={ready.selected?.unitRef === item.unitRef} onClick={() => props.onSelect(item)}>
            <header><span data-tone={toneForStatus(item.status)}>{STATUS_LABELS[item.status]}</span><i>{item.risk}</i></header>
            <strong>{ACTION_LABELS[item.actionType]}</strong>
            <small>{item.entity.label ?? ENTITY_LABELS[item.entity.type]} · {timestamp(item.createdAt)}</small>
            <p>{values.before} → {values.after}</p>
          </button>;
        })}</div>
      </section>
      <ApprovalQueueDetail item={ready.selected} loading={ready.detailLoading} />
    </div> : null}
  </>;
}

function ApprovalQueueDetail({ item, loading }: Readonly<{ item: ApprovalQueueRecord | null; loading: boolean }>) {
  if (loading) return <section className={`${styles.panel} ${styles.approvalQueueState}`} role="status"><span className={styles.liveDot} /><h2>ActionUnit detayı doğrulanıyor</h2><p>Liste özeti ile detay kontratı eşleştiriliyor.</p></section>;
  if (!item) return <section className={`${styles.panel} ${styles.approvalQueueState}`}><strong>Kayıt seçin</strong><h2>Önce/sonra, otonomi izi ve bağımlılıklar burada açılır.</h2><p>Tam kimlikler, hash, token, prompt ve ham Meta payload bu yüzeye çıkmaz.</p></section>;
  const values = valuePair(item.beforeAfter);
  return <section className={`${styles.panel} ${styles.approvalQueueDetail}`}>
    <header><div><span className={styles.kicker}>{ENTITY_LABELS[item.entity.type].toUpperCase()} · {item.risk}</span><h2>{ACTION_LABELS[item.actionType]}</h2><p>{item.entity.label ?? item.entity.ref} · {item.accountRef}</p></div><span className={styles.readOnlyBadge}>NO APPROVAL · NO EXECUTE</span></header>
    <div className={styles.approvalQueueFacts}><div><span>Durum</span><strong data-tone={toneForStatus(item.status)}>{STATUS_LABELS[item.status]}</strong><small>{item.summaryCode.replaceAll("_", " ")}</small></div><div><span>Otonomi kararı</span><strong>{item.autonomy.decision.replaceAll("_", " ")}</strong><small>{item.autonomy.profileRef}</small></div><div><span>Geçerlilik</span><strong>{timestamp(item.expiresAt)}</strong><small>Oluşturuldu: {timestamp(item.createdAt)}</small></div></div>
    <section className={styles.approvalQueueChange} aria-label={`${values.field} önce ve sonra`}><span>{values.field}</span><div><p><small>Önce</small><strong>{values.before}</strong></p><i>→</i><p><small>Sonra</small><strong>{values.after}</strong></p></div></section>
    <div className={styles.approvalQueueTrace}><h3>Otonomi izi</h3>{item.autonomy.trace.map((step, index) => <article key={`${step.scope}-${index}`}><span>{index + 1}</span><p><strong>{step.scope}</strong><small>{step.decision.replaceAll("_", " ")} · {step.reasonCode.replaceAll("_", " ")}</small></p></article>)}</div>
    <div className={styles.approvalQueueDependencies}><h3>Bağımlılıklar</h3>{item.dependencies.length === 0 ? <p>Bağımlılık yok.</p> : item.dependencies.map((dependency) => <p key={dependency.unitRef}><span>{dependency.unitRef}</span><strong>{STATUS_LABELS[dependency.status]}</strong></p>)}</div>
    <footer><span>Approval grant üretilmez</span><span>Meta çağrısı yapılmaz</span></footer>
  </section>;
}

export function ApprovalQueuePanel() {
  const [state, setState] = useState<ApprovalQueueDashboardState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/approval-queue?view=list&limit=50", { cache: "no-store" });
      const payload = await response.json() as Envelope<ApprovalQueueListResult> | ErrorEnvelope;
      if (!response.ok) {
        const message = "error" in payload ? payload.error?.message : undefined;
        setState({ status: response.status === 503 ? "unavailable" : "error", message: message ?? "Onay kuyruğu yanıtı alınamadı." });
        return;
      }
      if (!("result" in payload) || payload.result.view !== "list") throw new Error("invalid_contract");
      setState({ status: "ready", result: payload.result, selected: null, detailLoading: false });
    } catch {
      setState({ status: "error", message: "Onay kuyruğu bağlantısı şu anda kullanılamıyor." });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const select = useCallback(async (summary: ApprovalQueueRecord) => {
    setState((current) => current.status === "ready" ? { ...current, selected: summary, detailLoading: true } : current);
    try {
      const query = new URLSearchParams({ view: "detail", unitRef: summary.unitRef });
      const response = await fetch(`/api/approval-queue?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("detail_failed");
      const payload = await response.json() as Envelope<ApprovalQueueDetailResult>;
      if (payload.result.view !== "detail" || payload.result.item.unitRef !== summary.unitRef) throw new Error("invalid_contract");
      setState((current) => current.status === "ready"
        ? { ...current, selected: payload.result.item, detailLoading: false }
        : current);
    } catch {
      setState({ status: "error", message: "ActionUnit detayı güvenli biçimde okunamadı." });
    }
  }, []);

  return <ApprovalQueueReadSurface state={state} onRetry={() => void load()} onSelect={(item) => void select(item)} />;
}
