"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./operating-dashboard.module.css";

type Metric = Readonly<{ valueDecimal: string; currency?: string }>;
type Window = Readonly<{ days: 7 | 30; state: "ready" | "partial" | "unavailable"; observedDays: number; missingDays: readonly string[]; freshnessAt: string | null; attribution: string | null; currency: string | null; spend: Metric | null; outcome: Metric | null; cpa: Metric | null; reasonCodes: readonly string[] }>;
type Account = Readonly<{ accountRef: string; name: string; currency: string | null; windows: readonly Window[] }>;
type Source = Readonly<{ contractVersion: "public-source/1.0.0"; kind: "canonical_performance"; state: "ready" | "partial" | "unavailable"; observedAt: string | null; freshnessAt: string | null; freshnessThresholdMinutes: number | null; reasonCodes: readonly string[] }>;
export type CanonicalPerformancePanelProjection = Readonly<{ accounts: readonly Account[]; source: Source }>;

function validDate(value: unknown): value is string | null { return value === null || typeof value === "string" && Number.isFinite(Date.parse(value)); }
function parseMetric(value: unknown): Metric | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metric = value as Record<string, unknown>;
  if (typeof metric.valueDecimal !== "string" || !/^-?\d+(?:\.\d+)?$/.test(metric.valueDecimal) || metric.currency !== undefined && typeof metric.currency !== "string") return null;
  return Object.freeze({ valueDecimal: metric.valueDecimal, ...(typeof metric.currency === "string" ? { currency: metric.currency } : {}) });
}
function parseWindow(value: unknown): Window | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!(item.days === 7 || item.days === 30) || !["ready", "partial", "unavailable"].includes(item.state as string) || !Number.isSafeInteger(item.observedDays) || (item.observedDays as number) < 0 || !Array.isArray(item.missingDays) || item.missingDays.some((day) => typeof day !== "string") || !Array.isArray(item.reasonCodes) || item.reasonCodes.some((reason) => typeof reason !== "string") || !validDate(item.freshnessAt) || item.attribution !== null && typeof item.attribution !== "string" || item.currency !== null && typeof item.currency !== "string") return null;
  const spend = parseMetric(item.spend), outcome = parseMetric(item.outcome), cpa = parseMetric(item.cpa);
  if (item.spend !== null && !spend || item.outcome !== null && !outcome || item.cpa !== null && !cpa) return null;
  return Object.freeze({ days: item.days, state: item.state as Window["state"], observedDays: item.observedDays as number, missingDays: Object.freeze([...item.missingDays] as string[]), freshnessAt: item.freshnessAt as string | null, attribution: item.attribution as string | null, currency: item.currency as string | null, spend, outcome, cpa, reasonCodes: Object.freeze([...item.reasonCodes] as string[]) });
}

/** A transport 200 never upgrades data to canonical without both source contracts. */
export function canonicalPerformancePanelProjection(value: unknown): CanonicalPerformancePanelProjection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>, authority = body.authority as Record<string, unknown> | undefined, source = body.source as Record<string, unknown> | undefined;
  if (body.version !== "canonical-performance-read/1.0.0" || !Array.isArray(body.accounts) || !authority || !source || authority.actionAuthority !== "none" || authority.canPublish !== false || authority.canApprove !== false || authority.canExecute !== false || authority.canWriteMeta !== false || source.contractVersion !== "public-source/1.0.0" || source.kind !== "canonical_performance" || !["ready", "partial", "unavailable"].includes(source.state as string) || !validDate(source.observedAt) || !validDate(source.freshnessAt) || source.freshnessThresholdMinutes !== null && (!Number.isSafeInteger(source.freshnessThresholdMinutes) || (source.freshnessThresholdMinutes as number) < 1) || !Array.isArray(source.reasonCodes) || source.reasonCodes.some((reason) => typeof reason !== "string")) return null;
  const accounts: Account[] = [];
  for (const candidate of body.accounts) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const account = candidate as Record<string, unknown>;
    if (typeof account.accountRef !== "string" || !/^account_[a-f0-9]{24}$/.test(account.accountRef) || typeof account.name !== "string" || account.name.length > 160 || account.currency !== null && typeof account.currency !== "string" || !Array.isArray(account.windows)) return null;
    const windows: Window[] = [];
    for (const entry of account.windows) { const parsed = parseWindow(entry); if (!parsed) return null; windows.push(parsed); }
    if (windows.filter((window) => window.days === 7).length !== 1 || windows.filter((window) => window.days === 30).length !== 1) return null;
    accounts.push(Object.freeze({ accountRef: account.accountRef, name: account.name, currency: account.currency as string | null, windows: Object.freeze(windows) }));
  }
  return Object.freeze({ accounts: Object.freeze(accounts), source: Object.freeze({ contractVersion: source.contractVersion as Source["contractVersion"], kind: source.kind as Source["kind"], state: source.state as Source["state"], observedAt: source.observedAt as string | null, freshnessAt: source.freshnessAt as string | null, freshnessThresholdMinutes: source.freshnessThresholdMinutes as number | null, reasonCodes: Object.freeze([...source.reasonCodes] as string[]) }) });
}
function amount(metric: Metric | null, currency: string | null) { if (!metric) return "—"; const value = Number(metric.valueDecimal); if (!Number.isFinite(value)) return "—"; const unit = metric.currency ?? currency; return unit ? new Intl.NumberFormat("tr-TR", { style: "currency", currency: unit, maximumFractionDigits: 2 }).format(value / 100) : metric.valueDecimal; }
function sourceLabel(source: Source): string { return source.state === "ready" ? "Portföy kapsamı hazır" : source.state === "partial" ? "Portföy kapsamı kısmi" : "Portföy kapsamı kullanılamıyor"; }
function reasons(window: Window | null, source: Source | null): string { const codes = window?.reasonCodes.length ? window.reasonCodes : source?.reasonCodes ?? []; return codes.length ? codes.join(" · ") : "Yeterli canonical performans kaynağı bekleniyor."; }

export function CanonicalPerformancePanel() {
  const [state, setState] = useState<"loading" | "ready" | "session_required" | "unavailable">("loading");
  const [projection, setProjection] = useState<CanonicalPerformancePanelProjection | null>(null);
  const [selectedAccountRef, setSelectedAccountRef] = useState("");
  const refresh = useCallback(async () => { setState("loading"); try { const response = await fetch("/api/meta/canonical-performance", { cache: "no-store", credentials: "same-origin" }); const parsed = response.ok ? canonicalPerformancePanelProjection(await response.json()) : null; if (parsed) { setProjection(parsed); setSelectedAccountRef((current) => parsed.accounts.some((account) => account.accountRef === current) ? current : parsed.accounts[0]?.accountRef ?? ""); setState("ready"); } else { setProjection(null); setSelectedAccountRef(""); setState(response.status === 401 || response.status === 403 ? "session_required" : "unavailable"); } } catch { setProjection(null); setSelectedAccountRef(""); setState("unavailable"); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const selectedAccount = useMemo(() => projection?.accounts.find((account) => account.accountRef === selectedAccountRef) ?? null, [projection, selectedAccountRef]);
  const window = selectedAccount?.windows.find((candidate) => candidate.days === 7) ?? null;
  const ready = state === "ready" && projection?.source.state === "ready" && window?.state === "ready";
  const waiting = state === "loading" ? "Kanonik insight okunuyor" : state === "session_required" ? "Yerel oturum gerekli" : projection?.source ? sourceLabel(projection.source) : "Kapsam yetersiz";
  const sourceDetail = projection?.source.freshnessAt ? `Son kaynak: ${new Date(projection.source.freshnessAt).toLocaleString("tr-TR")}` : reasons(window, projection?.source ?? null);
  return <section aria-label="Canlı performans durumu">
    {projection?.accounts.length ? <div className={styles.panel} style={{ padding: "12px 16px", marginBottom: 10 }}><label htmlFor="canonical-performance-account"><span>Performans hesabı · {sourceLabel(projection.source)}</span><select id="canonical-performance-account" value={selectedAccountRef} onChange={(event) => setSelectedAccountRef(event.target.value)}>{projection.accounts.map((account) => <option key={account.accountRef} value={account.accountRef}>{account.name}{account.currency ? ` · ${account.currency}` : ""}</option>)}</select></label><small>{projection.source.state === "partial" ? `Hesap bazında inceleyin; portföy toplamı gösterilmez. ${reasons(null, projection.source)}` : sourceDetail}</small></div> : null}
    <div className={styles.metricGrid}>{ready ? <><article className={styles.metricCard}><div><span>7 günlük harcama</span><em>Canonical ready</em></div><strong>{amount(window!.spend, window!.currency)}</strong><footer><span>{selectedAccount!.name} · {window!.observedDays}/7 gün</span></footer></article><article className={styles.metricCard}><div><span>Sonuç · exact lead</span><em>Canonical ready</em></div><strong>{window!.outcome?.valueDecimal ?? "—"}</strong><footer><span>{window!.attribution ?? "Attribution bilinmiyor"}</span></footer></article><article className={styles.metricCard}><div><span>Lead başı maliyet</span><em>Canonical ready</em></div><strong>{amount(window!.cpa, window!.currency)}</strong><footer><span>Exact actions:lead · yeterli kapsam</span></footer></article><article className={styles.metricCard}><div><span>Veri kapsamı</span><em>Salt-okunur</em></div><strong>{window!.observedDays}/7</strong><footer><span>{sourceDetail}</span></footer></article></> : <><article className={styles.metricCard}><div><span>7 günlük harcama</span><em>{waiting}</em></div><strong>—</strong><footer><span>{reasons(window, projection?.source ?? null)}</span></footer></article><article className={styles.metricCard}><div><span>Sonuç</span><em>{waiting}</em></div><strong>—</strong><footer><span>Canlı outcome metriği olmadan CPA gösterilmez.</span></footer></article><article className={styles.metricCard}><div><span>Lead başı maliyet</span><em>{waiting}</em></div><strong>—</strong><footer><span>Karışık para birimi veya eksik günlerde gizlenir.</span></footer></article><article className={styles.metricCard}><div><span>Veri kapsamı</span><em>Salt-okunur</em></div><strong>{window ? `${window.observedDays}/7` : "—"}</strong><footer><span>{sourceDetail}</span></footer></article></>}</div>
  </section>;
}
