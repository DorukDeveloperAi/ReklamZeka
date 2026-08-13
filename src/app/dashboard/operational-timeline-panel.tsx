"use client";
import { useCallback, useEffect, useState } from "react";
import styles from "./operating-dashboard.module.css";

type Event = Readonly<{ kind: "slice_rule_draft" | "delivery_alert" | "approval_proposed" | "approval_decision"; occurredAt: string; title: string; detail: string }>;
type Result = Readonly<{ contractVersion: "operational-timeline/1.0.0"; items: readonly Event[]; authority: Readonly<{ readOnly: true; canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false; canEnableAutomation: false }> }>;
function parse(value: unknown): Result | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null; const x = value as Record<string, unknown>;
  if (x.contractVersion !== "operational-timeline/1.0.0" || !Array.isArray(x.items) || !x.authority || typeof x.authority !== "object") return null;
  const a = x.authority as Record<string, unknown>;
  if (a.readOnly !== true || a.canPublish !== false || a.canApprove !== false || a.canExecute !== false || a.canWriteMeta !== false || a.canEnableAutomation !== false) return null;
  if (!x.items.every((event) => event && typeof event === "object" && !Array.isArray(event) && ["slice_rule_draft", "delivery_alert", "approval_proposed", "approval_decision"].includes(String((event as Record<string, unknown>).kind)) && typeof (event as Record<string, unknown>).occurredAt === "string" && typeof (event as Record<string, unknown>).title === "string" && typeof (event as Record<string, unknown>).detail === "string")) return null;
  return value as Result;
}
function when(value: string) { return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value)); }
export function OperationalTimelinePanel() {
  const [state, setState] = useState<Readonly<{ loading: boolean; result: Result | null; message: string | null }>>({ loading: true, result: null, message: null });
  const load = useCallback(async () => { setState({ loading: true, result: null, message: null }); try { const response = await fetch("/api/operational-timeline", { cache: "no-store", credentials: "same-origin", headers: { "X-ReklamZeka-Intent": "operational-timeline-read" } }); const result = response.ok ? parse(await response.json()) : null; setState(result ? { loading: false, result, message: null } : { loading: false, result: null, message: "Kanonik operasyon izi şu anda kullanılamıyor." }); } catch { setState({ loading: false, result: null, message: "Kanonik operasyon izi şu anda kullanılamıyor." }); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <><section className={styles.pageHero}><div><span className={styles.kicker}>APPEND-ONLY OPERATIONAL TRACE</span><h1>Kural, alarm ve insan kararının gerçek izi.</h1><p>Bu ilk görünüm mevcut immutable kayıt defterlerini yalnız okur. Execute veya Meta write yapmaz.</p></div><button className={styles.secondaryButton} onClick={() => void load()}>Yenile</button></section><section className={styles.panel}>{state.loading ? <p role="status">Kayıt defterleri doğrulanıyor…</p> : state.message ? <p role="alert">{state.message}</p> : state.result?.items.length === 0 ? <p>Bu çalışma alanında gösterilebilir operasyon olayı yok. Demo olay eklenmedi.</p> : <div className={styles.timeline}>{state.result?.items.map((event) => <article key={`${event.kind}-${event.occurredAt}`}><time>{when(event.occurredAt)}</time><span className={styles.timelineDot} data-type={event.kind} /><div><span className={styles.statusPill} data-tone="neutral">{event.kind.replaceAll("_", " ")}</span><h2>{event.title}</h2><p>{event.detail}</p><small>Immutable kayıt · salt-okunur</small></div></article>)}</div>}<footer className={styles.canonicalAuthority}>Yetki: none · publish kapalı · approve kapalı · execute kapalı · Meta write kapalı</footer></section></>;
}
