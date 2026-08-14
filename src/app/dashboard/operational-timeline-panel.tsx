"use client";

import { useCallback, useEffect, useState } from "react";
import { LocalSessionConnector } from "./local-session-connector";
import styles from "./operating-dashboard.module.css";

type Event = Readonly<{ kind: "slice_rule_draft" | "budget_proposal" | "delivery_alert" | "approval_proposed" | "approval_decision";
  occurredAt: string; title: string; detail: string }>;
type Result = Readonly<{ contractVersion: "operational-timeline/1.0.0"; items: readonly Event[];
  authority: Readonly<{ readOnly: true; canPublish: false; canApprove: false; canExecute: false;
    canWriteMeta: false; canEnableAutomation: false }> }>;
type TimelineState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "session_required" | "unavailable" | "error"; message: string }>
  | Readonly<{ status: "ready"; result: Result }>;
type TemporalRecord = Readonly<{ evaluationRef: string; occurredAt: string; outcome: "recommendation" | "no_change";
  reason: string; windowRef: string }>;

function parse(value: unknown): Result | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const found = value as Record<string, unknown>;
  if (found.contractVersion !== "operational-timeline/1.0.0" || !Array.isArray(found.items)
    || !found.authority || typeof found.authority !== "object") return null;
  const authority = found.authority as Record<string, unknown>;
  if (authority.readOnly !== true || authority.canPublish !== false || authority.canApprove !== false
    || authority.canExecute !== false || authority.canWriteMeta !== false || authority.canEnableAutomation !== false) return null;
  if (!found.items.every((event) => event && typeof event === "object" && !Array.isArray(event)
    && ["slice_rule_draft", "budget_proposal", "delivery_alert", "approval_proposed", "approval_decision"]
      .includes(String((event as Record<string, unknown>).kind))
    && typeof (event as Record<string, unknown>).occurredAt === "string"
    && typeof (event as Record<string, unknown>).title === "string"
    && typeof (event as Record<string, unknown>).detail === "string")) return null;
  return value as Result;
}

function when(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" })
    .format(new Date(value));
}

export function OperationalTimelinePanel({ embedded = false }: Readonly<{ embedded?: boolean }> = {}) {
  const [state, setState] = useState<TimelineState>({ status: "loading" });
  const [temporal, setTemporal] = useState<readonly TemporalRecord[] | null>(null);

  const loadTemporal = useCallback(async () => {
    try {
      const response = await fetch("/api/temporal-recommendations", { cache: "no-store", credentials: "same-origin" });
      const body = response.ok ? await response.json() as { items?: unknown } : null;
      setTemporal(body && Array.isArray(body.items) ? body.items as readonly TemporalRecord[] : null);
    } catch { setTemporal(null); }
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/operational-timeline", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "operational-timeline-read" } });
      const payload = await response.json() as { error?: { code?: string; message?: string } };
      if (!response.ok) {
        const status = response.status === 401 || payload.error?.code === "local_session_required"
          ? "session_required" : response.status === 503 ? "unavailable" : "error";
        setState({ status, message: payload.error?.message ?? "Kanonik operasyon izi şu anda kullanılamıyor." });
        setTemporal(null);
        return false;
      }
      const result = parse(payload);
      if (!result) throw new Error("invalid_contract");
      setState({ status: "ready", result });
      await loadTemporal();
      return true;
    } catch {
      setState({ status: "error", message: "Kanonik operasyon izi güvenli biçimde okunamadı." });
      setTemporal(null);
      return false;
    }
  }, [loadTemporal]);

  useEffect(() => { void load(); }, [load]);

  const ready = state.status === "ready" ? state : null;
  const Heading = embedded ? "h2" : "h1";
  return <>
    <section className={`${styles.pageHero} ${embedded ? styles.embeddedHero : ""}`}><div><span className={styles.kicker}>APPEND-ONLY OPERATIONAL TRACE</span>
      <Heading>Kural, alarm ve insan kararının gerçek izi.</Heading><p>Bu görünüm immutable kayıtları okur; zamansal değerlendirme yalnızca sunucuda dondurulmuş bağlam, kural ve pencere referanslarıyla çalışır.</p></div>
      <button className={styles.secondaryButton} onClick={() => void load()}>Yenile</button></section>
    <section className={styles.panel}>
      {state.status === "loading" ? <p role="status">Kayıt defterleri doğrulanıyor…</p> : null}
      {state.status === "session_required" ? <div role="alert"><h2>Operasyon izini bağlayın</h2><p>{state.message}</p>
        <LocalSessionConnector title="Operasyon izini bağlayın" onVerify={load} /></div> : null}
      {state.status === "unavailable" || state.status === "error" ? <div role="alert"><h2>{state.status === "unavailable" ? "Operasyon kaynağı bağlı değil" : "Operasyon izi okunamadı"}</h2>
        <p>{state.message}</p><button onClick={() => void load()}>Tekrar dene</button></div> : null}
      {ready?.result.items.length === 0 ? <p>Bu çalışma alanında gösterilebilir operasyon olayı yok.</p> : null}
      {ready?.result.items.length ? <div className={styles.timeline}>{ready.result.items.map((event) => <article key={`${event.kind}-${event.occurredAt}`}>
        <time>{when(event.occurredAt)}</time><span className={styles.timelineDot} data-type={event.kind} /><div>
          <span className={styles.statusPill} data-tone="neutral">{event.kind.replaceAll("_", " ")}</span><h2>{event.title}</h2>
          <p>{event.detail}</p><small>Immutable kayıt · salt-okunur</small></div></article>)}</div> : null}
      {ready ? <><h2>Zamansal öneri kayıtları</h2>{temporal === null ? <p>Temporal kayıtlar şu anda kullanılamıyor.</p>
        : temporal.length === 0 ? <p>Henüz dondurulmuş bir zaman penceresi değerlendirilmedi.</p>
          : <div className={styles.timeline}>{temporal.map((item) => <article key={item.evaluationRef}><time>{when(item.occurredAt)}</time>
            <span className={styles.timelineDot} data-type="approval_proposed" /><div><span className={styles.statusPill} data-tone="neutral">{item.outcome}</span>
              <h2>{item.reason.replaceAll("_", " ")}</h2><p>Pencere: {item.windowRef}</p><small>Sunucu doğrulamalı · immutable öneri</small></div></article>)}</div>}</> : null}
      <footer className={styles.canonicalAuthority}>Yetki: none · publish kapalı · approve kapalı · execute kapalı · Meta write kapalı</footer>
    </section>
  </>;
}
