"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  DecisionRoomInboxItem,
  DecisionRoomReadResult,
  DecisionRoomRunStatus,
  DecisionRoomScheduleSummary,
} from "@/application/decision-room-read-service";
import styles from "./operating-dashboard.module.css";

type View = DecisionRoomReadResult["view"];
type State =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>
  | Readonly<{ status: "ready"; result: DecisionRoomReadResult }>;

type AgentEnvelope = Readonly<{ result: DecisionRoomReadResult }>;
type ErrorEnvelope = Readonly<{ error?: Readonly<{ message?: string }> }>;

const LABELS: Readonly<Record<View, string>> = {
  schedules: "Rutinler", runs: "Koşumlar", inbox: "Analiz kutusu",
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
  onConnect?: (capability: string) => void;
}>) {
  const { state, view } = props;
  return <>
    <section className={styles.pageHero}>
      <div><span className={styles.kicker}>DECISION ROOM · READ MODEL</span><h1>Analiz rutinleri ve sonuçları, tek güvenli yüzeyde.</h1><p>Dashboard ile Codex/Claude aynı salt okunur kontratı kullanır. Bu ekran Meta değişikliği, bütçe hareketi veya onay yürütmez.</p></div>
      <span className={styles.readOnlyBadge}>READ ONLY · AUTHORITY NONE</span>
    </section>

    <section className={styles.decisionRoomTabs} aria-label="Decision Room görünümleri">
      {(Object.keys(LABELS) as View[]).map((candidate) => <button key={candidate} data-active={candidate === view} onClick={() => props.onView(candidate)}>{LABELS[candidate]}</button>)}
    </section>

    {state.status === "loading" ? <section className={`${styles.panel} ${styles.decisionRoomState}`} role="status"><span className={styles.liveDot} /><h2>Decision Room kaynağı okunuyor</h2><p>Çalışma alanı ve okuyucu kimliği yalnız sunucu oturumundan bağlanır.</p></section> : null}
    {state.status === "unavailable" || state.status === "error" ? <section className={`${styles.panel} ${styles.decisionRoomState}`} role="alert"><strong>{state.status === "unavailable" ? "Kaynak henüz bağlı değil" : "Decision Room okunamadı"}</strong><h2>{state.message}</h2><p>Demo verisi canlı sonuç gibi gösterilmez. Üretim read repository ve güvenilir kimlik bağlama etkinleştiğinde bu görünüm otomatik açılacak.</p><button onClick={props.onRetry}>Tekrar kontrol et</button>{state.status === "unavailable" && props.onConnect ? <LocalSessionForm onConnect={props.onConnect} /> : null}</section> : null}
    {state.status === "ready" ? <DecisionRoomItems view={view} result={state.result} onMarkRead={props.onMarkRead} /> : null}
  </>;
}

function LocalSessionForm(props: Readonly<{ onConnect: (capability: string) => void }>) {
  const [capability, setCapability] = useState("");
  return <form onSubmit={(event) => {
    event.preventDefault();
    const submitted = capability.trim();
    setCapability("");
    if (submitted) props.onConnect(submitted);
  }}>
    <label htmlFor="local-session-capability">Tek kullanımlık yerel oturum capability</label>
    <input id="local-session-capability" type="password" autoComplete="off" spellCheck={false}
      value={capability} onChange={(event) => setCapability(event.target.value)} />
    <button type="submit" disabled={!capability.trim()}>Yerel oturumu bağla</button>
  </form>;
}

function DecisionRoomItems(props: Readonly<{
  view: View;
  result: DecisionRoomReadResult;
  onMarkRead: (notificationRef: string) => void;
}>) {
  if (props.result.items.length === 0) return <section className={`${styles.panel} ${styles.decisionRoomState}`}><strong>Kaynak bağlı · kayıt yok</strong><h2>{LABELS[props.view]} görünümü boş</h2><p>Bu, demo fallback değildir; bağlı çalışma alanının gerçek salt okunur yanıtıdır.</p></section>;

  if (props.view === "schedules") return <section className={styles.decisionRoomList}>{(props.result.items as DecisionRoomScheduleSummary[]).map((item) => <article className={styles.panel} key={item.scheduleRef}><header><span>{item.enabled ? "ETKİN" : "KAPALI"}</span><strong>{item.frequency === "daily" ? "Her gün" : `Haftalık · gün ${item.dayOfWeek}`}</strong></header><h2>{item.templateRef}</h2><p>{item.accountRef} · {item.campaignRef}</p><dl><div><dt>Saat</dt><dd>{item.localTime} · {item.timezone}</dd></div><div><dt>Timeframe</dt><dd>{item.timeframeRef}</dd></div><div><dt>Sonraki</dt><dd>{time(item.nextRunAt)}</dd></div><div><dt>Sürüm</dt><dd>r{item.revision}</dd></div></dl></article>)}</section>;

  if (props.view === "runs") return <section className={styles.decisionRoomList}>{(props.result.items as DecisionRoomRunStatus[]).map((item) => <article className={styles.panel} key={item.runRef}><header><span>{item.status.toUpperCase()}</span><strong>{item.triggerKind === "scheduled" ? "Zamanlanmış" : "Manuel"}</strong></header><h2>{item.templateRef ?? "Şablonsuz koşum"}</h2><p>{item.accountRef} · {item.campaignRef}</p><dl><div><dt>Başlangıç</dt><dd>{time(item.startedAt)}</dd></div><div><dt>Bitiş</dt><dd>{time(item.completedAt ?? item.failedAt)}</dd></div><div><dt>Timeframe</dt><dd>{item.timeframeRef ?? "—"}</dd></div><div><dt>Deneme</dt><dd>{item.attempt}</dd></div></dl></article>)}</section>;

  return <section className={styles.decisionRoomList}>{(props.result.items as DecisionRoomInboxItem[]).map((item) => <article className={styles.panel} key={item.notificationRef}><header><span>{item.readState.status === "read" ? "OKUNDU" : "YENİ"}</span><strong>{time(item.createdAt)}</strong></header><h2>{item.summaryCode.replaceAll("_", " ")}</h2><p>Analiz sonucu hazır · eylem/onay yetkisi içermez</p><footer>{item.readState.status === "read" ? <small>{time(item.readState.readAt)}</small> : <button onClick={() => props.onMarkRead(item.notificationRef)}>Okundu işaretle</button>}</footer></article>)}</section>;
}

export function DecisionRoomPanel() {
  const [view, setView] = useState<View>("inbox");
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/decision-room?view=${view}&limit=25`, { cache: "no-store" });
      const payload = await response.json() as AgentEnvelope | ErrorEnvelope;
      if (!response.ok) {
        const message = "error" in payload ? payload.error?.message : undefined;
        setState({ status: response.status === 503 ? "unavailable" : "error", message: message ?? "Decision Room yanıtı alınamadı." });
        return;
      }
      if (!("result" in payload) || payload.result.view !== view) throw new Error("invalid_contract");
      setState({ status: "ready", result: payload.result });
    } catch {
      setState({ status: "error", message: "Decision Room bağlantısı şu anda kullanılamıyor." });
    }
  }, [view]);

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

  const connect = useCallback(async (capability: string) => {
    try {
      const response = await fetch("/api/local-session", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${capability}`,
          "X-ReklamZeka-Intent": "bootstrap-local-session",
        },
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("session_rejected");
      const verified = await fetch("/api/decision-room?view=inbox&limit=1", {
        cache: "no-store", credentials: "same-origin",
      });
      if (!verified.ok) {
        setState({ status: "error", message: "Güvenli yerel oturum cookie'si saklanamadı veya veritabanı üyeliği doğrulanmadı. Origin olarak http://localhost kullanın." });
        return;
      }
      const payload = await verified.json() as AgentEnvelope;
      if (payload.result.view !== "inbox") throw new Error("invalid_contract");
      setView("inbox");
      setState({ status: "ready", result: payload.result });
    } catch {
      setState({ status: "error", message: "Yerel oturum capability doğrulanamadı veya süresi doldu." });
    }
  }, [load]);

  return <DecisionRoomReadSurface view={view} state={state} onView={setView} onRetry={() => void load()} onMarkRead={(ref) => void markRead(ref)} onConnect={(value) => void connect(value)} />;
}
