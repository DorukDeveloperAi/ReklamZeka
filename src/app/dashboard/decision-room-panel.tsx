"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DecisionRoomInboxItem,
  DecisionRoomReadResult,
  DecisionRoomRunStatus,
  DecisionRoomScheduleSummary,
} from "@/application/decision-room-read-service";
import { LocalSessionConnector } from "./local-session-connector";
import styles from "./operating-dashboard.module.css";

type View = DecisionRoomReadResult["view"];
type State =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>
  | Readonly<{ status: "ready"; result: DecisionRoomReadResult }>;

type AgentEnvelope = Readonly<{ result: DecisionRoomReadResult }>;
type ErrorEnvelope = Readonly<{ error?: Readonly<{ message?: string }> }>;

const LABELS: Readonly<Record<View, string>> = {
  schedules: "Rutinler", runs: "Koşumlar", inbox: "Sonuçlar",
};

function time(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul",
  }).format(new Date(value));
}

export function DecisionRoomReadSurface(props: Readonly<{
  view: View;
  state: State;
  onView: (view: View) => void;
  onRetry: () => void;
  onMarkRead: (notificationRef: string) => void;
  onConnect?: () => Promise<boolean>;
  campaignContext?: Readonly<{ label: string; campaignRef: string }> | null;
  onClearCampaignContext?: () => void;
}>) {
  const { state, view } = props;
  return <>
    <section className={styles.pageHero}>
      <div><span className={styles.kicker}>ANALİZ & KARARLAR · CANLI READ MODEL</span><h1>Gerçek analiz rutinleri ve sonuçları, tek karar yüzeyinde.</h1><p>Yalnız bağlı çalışma alanının rutinleri, koşumları ve sonuçları gösterilir. Bu ekran Meta değişikliği, bütçe hareketi veya onay yürütmez.</p></div>
      <span className={styles.readOnlyBadge}>READ ONLY · AUTHORITY NONE</span>
    </section>

    {props.campaignContext ? <section className={`${styles.panel} ${styles.decisionRoomState}`} aria-label="Seçili kampanya bağlamı"><strong>SEÇİLİ KAMPANYA BAĞLAMI</strong><h2>{props.campaignContext.label}</h2><p>Rutinler ve koşumlar, frozen bağlamın sunucuda doğruladığı kampanya alias’ıyla süzülür. Sonuçlar tek başına kampanya bağı taşımadığı için bu bağlamda gösterilmez.</p>{props.onClearCampaignContext ? <button onClick={props.onClearCampaignContext}>Tüm çalışma alanına dön</button> : null}</section> : null}
    <nav className={styles.decisionRoomTabs} aria-label="Decision Room görünümleri">
      {(Object.keys(LABELS) as View[]).filter((candidate) => !props.campaignContext || candidate !== "inbox").map((candidate) => <button key={candidate} type="button" data-active={candidate === view} aria-current={candidate === view ? "page" : undefined} onClick={() => props.onView(candidate)}>{LABELS[candidate]}</button>)}
    </nav>

    {state.status === "loading" ? <section className={`${styles.panel} ${styles.decisionRoomState}`} role="status"><span className={styles.liveDot} /><h2>Decision Room kaynağı okunuyor</h2><p>Çalışma alanı ve okuyucu kimliği yalnız sunucu oturumundan bağlanır.</p></section> : null}
    {state.status === "unavailable" || state.status === "error" ? <section className={`${styles.panel} ${styles.decisionRoomState}`} role="alert"><strong>{state.status === "unavailable" ? "Kaynak henüz bağlı değil" : "Kaynak okunamadı"}</strong><h2>{state.status === "unavailable" ? "Analiz & Kararlar kaynağı henüz bağlı değil." : "Analiz & Kararlar şu anda okunamıyor."}</h2><p>{state.message}</p><p>Bağlı üretim kaynağı yokken örnek kayıt gösterilmez.</p><button onClick={props.onRetry}>Tekrar kontrol et</button>{state.status === "unavailable" && props.onConnect ? <LocalSessionConnector title="Yerel dashboard oturumunu bağlayın" onVerify={props.onConnect} /> : null}</section> : null}
    {state.status === "ready" ? <DecisionRoomItems view={view} result={state.result} onMarkRead={props.onMarkRead} /> : null}
  </>;
}

function DecisionRoomItems(props: Readonly<{
  view: View;
  result: DecisionRoomReadResult;
  onMarkRead: (notificationRef: string) => void;
}>) {
  if (props.result.items.length === 0) return <section className={`${styles.panel} ${styles.decisionRoomState}`}><strong>Kaynak bağlı · kayıt yok</strong><h2>{LABELS[props.view]} görünümü boş</h2><p>Bağlı çalışma alanı bu görünüm için gerçek bir kayıt döndürmedi; örnek içerik eklenmedi.</p></section>;

  if (props.view === "schedules") return <section className={styles.decisionRoomList}>{(props.result.items as DecisionRoomScheduleSummary[]).map((item) => <article className={styles.panel} key={item.scheduleRef}><header><span>{item.enabled ? "ETKİN" : "KAPALI"}</span><strong>{item.frequency === "daily" ? "Her gün" : `Haftalık · gün ${item.dayOfWeek}`}</strong></header><h2>{item.templateRef}</h2><p>{item.accountRef} · {item.campaignRef}</p><dl><div><dt>Saat</dt><dd>{item.localTime} · {item.timezone}</dd></div><div><dt>Timeframe</dt><dd>{item.timeframeRef}</dd></div><div><dt>Sonraki</dt><dd>{time(item.nextRunAt)}</dd></div><div><dt>Sürüm</dt><dd>r{item.revision}</dd></div></dl></article>)}</section>;

  if (props.view === "runs") return <section className={styles.decisionRoomList}>{(props.result.items as DecisionRoomRunStatus[]).map((item) => <article className={styles.panel} key={item.runRef}><header><span>{item.status.toUpperCase()}</span><strong>{item.triggerKind === "scheduled" ? "Zamanlanmış" : "Manuel"}</strong></header><h2>{item.templateRef ?? "Şablonsuz koşum"}</h2><p>{item.accountRef} · {item.campaignRef}</p><dl><div><dt>Başlangıç</dt><dd>{time(item.startedAt)}</dd></div><div><dt>Bitiş</dt><dd>{time(item.completedAt ?? item.failedAt)}</dd></div><div><dt>Timeframe</dt><dd>{item.timeframeRef ?? "—"}</dd></div><div><dt>Deneme</dt><dd>{item.attempt}</dd></div></dl></article>)}</section>;

  return <section className={styles.decisionRoomList}>{(props.result.items as DecisionRoomInboxItem[]).map((item) => <article className={styles.panel} key={item.notificationRef}><header><span>{item.readState.status === "read" ? "OKUNDU" : "YENİ"}</span><strong>{time(item.createdAt)}</strong></header><h2>{item.summaryCode.replaceAll("_", " ")}</h2><p>Analiz sonucu hazır · eylem/onay yetkisi içermez</p><footer>{item.readState.status === "read" ? <small>{time(item.readState.readAt)}</small> : <button onClick={() => props.onMarkRead(item.notificationRef)}>Okundu işaretle</button>}</footer></article>)}</section>;
}

export function DecisionRoomPanel({ campaignContext = null, onClearCampaignContext, campaignContextPending = false }: Readonly<{
  campaignContext?: Readonly<{ label: string; campaignRef: string }> | null;
  onClearCampaignContext?: () => void;
  campaignContextPending?: boolean;
}>) {
  const [view, setView] = useState<View>(campaignContext ? "runs" : "inbox");
  const [state, setState] = useState<State>({ status: "loading" });
  const requestEpoch = useRef(0);

  useEffect(() => { if (campaignContext && view === "inbox") setView("runs"); }, [campaignContext, view]);

  const load = useCallback(async () => {
    const epoch = requestEpoch.current + 1;
    requestEpoch.current = epoch;
    if (campaignContextPending) {
      setState({ status: "loading" });
      return;
    }
    setState({ status: "loading" });
    try {
      const query = new URLSearchParams({ view, limit: "25" });
      if (campaignContext && view !== "inbox") query.set("campaignRef", campaignContext.campaignRef);
      const response = await fetch(`/api/decision-room?${query}`, { cache: "no-store" });
      const payload = await response.json() as AgentEnvelope | ErrorEnvelope;
      if (requestEpoch.current !== epoch) return;
      if (!response.ok) {
        const message = "error" in payload ? payload.error?.message : undefined;
        setState({ status: response.status === 503 ? "unavailable" : "error", message: message ?? "Decision Room yanıtı alınamadı." });
        return;
      }
      if (!("result" in payload) || payload.result.view !== view
        || campaignContext && view !== "inbox" && payload.result.items.some((item) => !("campaignRef" in item) || item.campaignRef !== campaignContext.campaignRef)) throw new Error("invalid_contract");
      setState({ status: "ready", result: payload.result });
    } catch {
      if (requestEpoch.current === epoch) setState({ status: "error", message: "Decision Room bağlantısı şu anda kullanılamıyor." });
    }
  }, [campaignContext, campaignContextPending, view]);

  useEffect(() => { void load(); }, [load]);

  const markRead = useCallback(async (notificationRef: string) => {
    try {
      const response = await fetch("/api/decision-room", {
        method: "PATCH", headers: {
          "Content-Type": "application/json",
          "X-ReklamZeka-Intent": "mark-inbox-read",
        },
        body: JSON.stringify({ notificationRef }),
      });
      if (!response.ok) throw new Error("mark_failed");
      await load();
    } catch {
      setState({ status: "error", message: "Okunma durumu kaydedilemedi." });
    }
  }, [load]);

  const verifyConnectedSession = useCallback(async () => {
    try {
      const verified = await fetch("/api/decision-room?view=inbox&limit=1", {
        cache: "no-store", credentials: "same-origin",
      });
      if (!verified.ok) {
        setState({ status: "error", message: "Güvenli yerel oturum cookie'si saklanamadı veya veritabanı üyeliği doğrulanmadı. Origin olarak http://localhost kullanın." });
        return false;
      }
      const payload = await verified.json() as AgentEnvelope;
      if (payload.result.view !== "inbox") throw new Error("invalid_contract");
      setView("inbox");
      setState({ status: "ready", result: payload.result });
      return true;
    } catch {
      setState({ status: "error", message: "Yerel oturum cookie'si üretildi ancak Decision Room kaynağı doğrulanamadı." });
      return false;
    }
  }, []);

  return <DecisionRoomReadSurface view={view} state={state} onView={setView} onRetry={() => void load()} onMarkRead={(ref) => void markRead(ref)} onConnect={verifyConnectedSession} campaignContext={campaignContext} onClearCampaignContext={onClearCampaignContext} />;
}
