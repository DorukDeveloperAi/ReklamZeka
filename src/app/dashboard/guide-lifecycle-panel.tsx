"use client";

import { useCallback, useEffect, useState } from "react";
import { LocalSessionConnector } from "./local-session-connector";
import styles from "./operating-dashboard.module.css";

type Item = Readonly<{ guideId: string; guideRef: string; label: string; revisionId: string; activeRevisionId: string | null; headVersion: number; revision: number; revisionHash: string; interpretationHash: string; interpretationAccepted: boolean; sliceRef: string; market: "yerli" | "yabanci"; mode: string; freeText: string; schedule: Readonly<{ frequency: string; timezone: string; localTime: string }>; createdAt: string }>;
type Snapshot = Readonly<{ contractVersion: "guide-lifecycle-workspace/1.0.0"; items: readonly Item[]; authority: Readonly<{ canWriteMeta: false; canExecute: false; canDraft: boolean; canActivate: boolean }> }>;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/; const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i; const HASH = /^[a-f0-9]{64}$/;
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: readonly string[]) { return Object.keys(value).length === expected.length && Object.keys(value).every((key) => expected.includes(key)); }
function parse(value: unknown): Snapshot {
  if (!record(value) || !keys(value, ["contractVersion", "items", "authority"]) || value.contractVersion !== "guide-lifecycle-workspace/1.0.0" || !Array.isArray(value.items) || value.items.length > 100 || !record(value.authority)
    || !keys(value.authority, ["canWriteMeta", "canExecute", "canDraft", "canActivate"])
    || value.authority.canWriteMeta !== false || value.authority.canExecute !== false || typeof value.authority.canDraft !== "boolean" || typeof value.authority.canActivate !== "boolean") throw new Error("unsafe_response");
  for (const item of value.items) if (!record(item) || !keys(item, ["guideId", "guideRef", "label", "revisionId", "activeRevisionId", "headVersion", "revision", "revisionHash", "interpretationHash", "interpretationAccepted", "sliceRef", "market", "mode", "freeText", "schedule", "createdAt"])
    || typeof item.guideId !== "string" || !UUID.test(item.guideId) || typeof item.revisionId !== "string" || !UUID.test(item.revisionId)
    || !(item.activeRevisionId === null || typeof item.activeRevisionId === "string" && UUID.test(item.activeRevisionId)) || typeof item.guideRef !== "string" || !REF.test(item.guideRef)
    || typeof item.sliceRef !== "string" || !REF.test(item.sliceRef) || typeof item.label !== "string" || item.label.length > 160 || typeof item.freeText !== "string" || item.freeText.length > 10_000
    || !Number.isSafeInteger(item.headVersion) || !Number.isSafeInteger(item.revision) || typeof item.revisionHash !== "string" || !HASH.test(item.revisionHash)
    || typeof item.interpretationHash !== "string" || !HASH.test(item.interpretationHash) || typeof item.interpretationAccepted !== "boolean"
    || !["yerli", "yabanci"].includes(String(item.market)) || !["observe_analyze", "recommend", "prepare_human_approval", "limited_autonomy"].includes(String(item.mode))
    || !record(item.schedule) || !["daily", "weekly", "monthly", "custom_days"].includes(String(item.schedule.frequency)) || typeof item.schedule.timezone !== "string" || item.schedule.timezone.length > 128 || typeof item.schedule.localTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.schedule.localTime)
    || item.schedule.frequency === "daily" && !keys(item.schedule, ["frequency", "timezone", "localTime"])
    || item.schedule.frequency === "weekly" && (!keys(item.schedule, ["frequency", "timezone", "localTime", "dayOfWeek"]) || !Number.isInteger(item.schedule.dayOfWeek) || Number(item.schedule.dayOfWeek) < 0 || Number(item.schedule.dayOfWeek) > 6)
    || item.schedule.frequency === "monthly" && (!keys(item.schedule, ["frequency", "timezone", "localTime", "dayOfMonth", "monthEnd"]) || !Number.isInteger(item.schedule.dayOfMonth) || Number(item.schedule.dayOfMonth) < 1 || Number(item.schedule.dayOfMonth) > 31 || item.schedule.monthEnd !== "clamp")
    || item.schedule.frequency === "custom_days" && (!keys(item.schedule, ["frequency", "timezone", "localTime", "intervalDays", "anchorDate"]) || !Number.isInteger(item.schedule.intervalDays) || Number(item.schedule.intervalDays) < 1 || Number(item.schedule.intervalDays) > 366 || typeof item.schedule.anchorDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.schedule.anchorDate))
    || typeof item.createdAt !== "string" || Number.isNaN(Date.parse(item.createdAt))) throw new Error("unsafe_response");
  return value as unknown as Snapshot;
}
async function payload(response: Response) { const value: unknown = await response.json().catch(() => null); if (!response.ok) { const error = record(value) && record(value.error) ? value.error : null; const e = new Error(error && typeof error.message === "string" ? error.message : "Kılavuz işlemi tamamlanamadı."); Object.assign(e, { code: error && typeof error.code === "string" ? error.code : "unavailable" }); throw e; } return value; }

export function GuideLifecyclePanel(props: Readonly<{ onSessionRequiredChange?: (required: boolean) => void }>) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [sessionRequired, setSessionRequired] = useState(false); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ label: "", sliceRef: "", market: "yerli" as "yerli" | "yabanci", freeText: "", localTime: "09:00" });
  const refresh = useCallback(async () => { setLoading(true); setError(null); try { const response = await fetch("/api/guides", { cache: "no-store", credentials: "same-origin", headers: { "X-ReklamZeka-Intent": "guide-lifecycle-read" } }); const value = await payload(response); const next = parse(value); setSnapshot(next); setSessionRequired(false); props.onSessionRequiredChange?.(false); return true; } catch (reason) { const required = reason instanceof Error && "code" in reason && reason.code === "local_session_required"; setSessionRequired(required); props.onSessionRequiredChange?.(required); setError(reason instanceof Error ? reason.message : "Kılavuzlar yüklenemedi."); return false; } finally { setLoading(false); } }, [props.onSessionRequiredChange]);
  useEffect(() => { void refresh(); }, [refresh]);
  const mutate = async (body: Record<string, unknown>, intent: string) => { setBusy(true); setError(null); try { const response = await fetch("/api/guides", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": intent }, body: JSON.stringify(body) }); await payload(response); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Kılavuz işlemi tamamlanamadı."); } finally { setBusy(false); } };
  const create = async () => { setBusy(true); setError(null); try { const response = await fetch("/api/guides", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "guide-lifecycle-create" }, body: JSON.stringify({ ...form, schedule: { frequency: "daily", timezone: "Europe/Istanbul", localTime: form.localTime }, mode: "prepare_human_approval", actionAllowlist: ["status_pause", "status_activate"], budgetRefs: [], rollbackConditions: ["Kaynak durum değişirse durdur"] }) }); await payload(response); setForm({ label: "", sliceRef: "", market: "yerli", freeText: "", localTime: "09:00" }); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Kılavuz taslağı oluşturulamadı."); } finally { setBusy(false); } };
  if (loading && !snapshot) return <section className={`${styles.panel} ${styles.guidanceState}`} aria-busy="true" role="status"><strong>KANONİK KILAVUZ</strong><h2>Kılavuz yaşam döngüsü yükleniyor</h2></section>;
  if (sessionRequired && !snapshot) return <section className={`${styles.panel} ${styles.guidanceState}`}><strong>YEREL OTURUM GEREKLİ</strong><h2>Kılavuz çalışma alanını bağlayın</h2><p>{error}</p><LocalSessionConnector idPrefix="guide-lifecycle-session" title="Kılavuz çalışma alanını bağlayın" onVerify={refresh} /></section>;
  return <section className={styles.panel} aria-label="Kanonik Kılavuz yaşam döngüsü">
    <header className={styles.panelHeader}><div><strong>KANONİK KILAVUZ</strong><h2>Taslak → yorum kabulü → aktivasyon</h2></div><button type="button" onClick={() => void refresh()} disabled={busy}>Yenile</button></header>
    <div className={styles.guidanceFields}>
      <label>Ad<input maxLength={160} value={form.label} disabled={busy || !snapshot?.authority.canDraft} onChange={(event) => setForm({ ...form, label: event.target.value })} /></label>
      <label>Slice ref<input maxLength={159} placeholder="slice_..." value={form.sliceRef} disabled={busy || !snapshot?.authority.canDraft} onChange={(event) => setForm({ ...form, sliceRef: event.target.value })} /></label>
      <label>Market<select value={form.market} disabled={busy || !snapshot?.authority.canDraft} onChange={(event) => setForm({ ...form, market: event.target.value as "yerli" | "yabanci" })}><option value="yerli">Yerli</option><option value="yabanci">Yabancı</option></select></label>
      <label>Günlük değerlendirme saati<input type="time" value={form.localTime} disabled={busy || !snapshot?.authority.canDraft} onChange={(event) => setForm({ ...form, localTime: event.target.value })} /></label>
      <label className={styles.guidanceBodyField}>Kural metni<textarea maxLength={10_000} value={form.freeText} disabled={busy || !snapshot?.authority.canDraft} onChange={(event) => setForm({ ...form, freeText: event.target.value })} /></label>
      <button className={styles.primaryButton} type="button" disabled={busy || !snapshot?.authority.canDraft || !form.label.trim() || !form.sliceRef.trim() || !form.freeText.trim()} onClick={() => void create()}>İnsan onaylı durum Kılavuzu taslağı oluştur</button>
      <p>Bu işlem yalnız immutable Kılavuz taslağı üretir. Aktivasyon ayrı insan adımıdır; Meta write ve execution yetkisi yoktur.</p>
    </div>
    {error ? <div className={styles.guidanceInlineError} role="alert">{error}</div> : null}
    <div className={styles.guidanceIndex}><div>{snapshot?.items.map((item) => <article className={styles.guidanceEditor} key={item.guideId}>
      <header><div><strong>{item.activeRevisionId === item.revisionId ? "Aktif" : item.interpretationAccepted ? "Kabul edildi" : "Taslak"}</strong><h2>{item.label}</h2><p>{item.guideRef} · sürüm {item.revision} · {item.sliceRef}</p></div><span>{item.mode}</span></header>
      <div className={styles.guidanceFields}><p className={styles.guidanceBodyField}>{item.freeText}</p></div>
      <footer><span>{item.market} · {item.schedule.frequency} {item.schedule.localTime} · Meta write kapalı</span><div>
        {!item.interpretationAccepted ? <button type="button" disabled={busy || !snapshot.authority.canDraft} onClick={() => void mutate({ operation: "accept", guideId: item.guideId, revisionId: item.revisionId, interpretationHash: item.interpretationHash }, "guide-lifecycle-accept")}>Yorumu kabul et</button> : null}
        {item.interpretationAccepted && item.activeRevisionId !== item.revisionId ? <button className={styles.primaryButton} type="button" disabled={busy || !snapshot.authority.canActivate} onClick={() => void mutate({ operation: "activate", guideId: item.guideId, revisionId: item.revisionId, expectedHeadVersion: item.headVersion, expectedCurrentRevisionId: item.activeRevisionId }, "guide-lifecycle-activate")}>Aktifleştir</button> : null}
        {item.activeRevisionId === item.revisionId ? <button className={styles.guidanceDangerButton} type="button" disabled={busy || !snapshot.authority.canActivate} onClick={() => void mutate({ operation: "pause", guideId: item.guideId, expectedHeadVersion: item.headVersion, expectedCurrentRevisionId: item.revisionId }, "guide-lifecycle-pause")}>Duraklat</button> : null}
      </div></footer>
    </article>)}</div></div>
  </section>;
}
