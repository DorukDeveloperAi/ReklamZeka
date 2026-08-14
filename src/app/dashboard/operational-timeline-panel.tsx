"use client";

import { useCallback, useEffect, useState } from "react";
import { LocalSessionConnector } from "./local-session-connector";
import styles from "./operating-dashboard.module.css";

type Event = Readonly<{ kind: "slice_rule_draft" | "budget_proposal" | "delivery_alert" | "approval_proposed" | "approval_decision" | "temporal_evaluation";
  occurredAt: string; title: string; detail: string }>;
type Result = Readonly<{ contractVersion: "operational-timeline/1.0.0"; items: readonly Event[];
  authority: Readonly<{ readOnly: true; canPublish: false; canApprove: false; canExecute: false;
    canWriteMeta: false; canEnableAutomation: false }> }>;
type TimelineState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "session_required" | "unavailable" | "error"; message: string }>
  | Readonly<{ status: "ready"; result: Result }>;
const EVENT_KINDS = new Set<Event["kind"]>(["slice_rule_draft", "budget_proposal", "delivery_alert", "approval_proposed", "approval_decision", "temporal_evaluation"]);
const PRIVATE_MATERIAL = /(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[a-f0-9-]{12}|[a-f0-9]{64}|EA[A-Za-z0-9]{30,}|Bearer\s+)/i;

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

/** Accept only the authority-closed public operational timeline contract. */
export function operationalTimelineFromResponse(value: unknown): Result | null {
  if (!exactObject(value, ["contractVersion", "items", "authority"])
    || value.contractVersion !== "operational-timeline/1.0.0" || !Array.isArray(value.items) || value.items.length > 100
    || !exactObject(value.authority, ["readOnly", "canPublish", "canApprove", "canExecute", "canWriteMeta", "canEnableAutomation"])
    || value.authority.readOnly !== true || value.authority.canPublish !== false || value.authority.canApprove !== false
    || value.authority.canExecute !== false || value.authority.canWriteMeta !== false || value.authority.canEnableAutomation !== false) return null;
  const items: Event[] = [];
  for (const item of value.items) {
    if (!exactObject(item, ["kind", "occurredAt", "title", "detail"])
      || typeof item.kind !== "string" || !EVENT_KINDS.has(item.kind as Event["kind"])
      || typeof item.occurredAt !== "string" || !Number.isFinite(Date.parse(item.occurredAt))
      || typeof item.title !== "string" || item.title.length < 1 || item.title.length > 180
      || typeof item.detail !== "string" || item.detail.length < 1 || item.detail.length > 300
      || PRIVATE_MATERIAL.test(`${item.title} ${item.detail}`)) return null;
    items.push(Object.freeze({ kind: item.kind as Event["kind"], occurredAt: new Date(item.occurredAt).toISOString(), title: item.title, detail: item.detail }));
  }
  if (items.some((item, index) => index > 0 && Date.parse(item.occurredAt) > Date.parse(items[index - 1]!.occurredAt))) return null;
  return Object.freeze({ contractVersion: "operational-timeline/1.0.0", items: Object.freeze(items), authority: Object.freeze({
    readOnly: true, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false,
  }) });
}

function when(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" })
    .format(new Date(value));
}

export function OperationalTimelinePanel({ embedded = false }: Readonly<{ embedded?: boolean }> = {}) {
  const [state, setState] = useState<TimelineState>({ status: "loading" });

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
        return false;
      }
      const result = operationalTimelineFromResponse(payload);
      if (!result) throw new Error("invalid_contract");
      setState({ status: "ready", result });
      return true;
    } catch {
      setState({ status: "error", message: "Kanonik operasyon izi güvenli biçimde okunamadı." });
      return false;
    }
  }, []);

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
      <footer className={styles.canonicalAuthority}>Yetki: none · publish kapalı · approve kapalı · execute kapalı · Meta write kapalı</footer>
    </section>
  </>;
}
