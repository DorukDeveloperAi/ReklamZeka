"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalSessionConnector } from "./local-session-connector";
import styles from "./operating-dashboard.module.css";

type Metric = Readonly<{ valueDecimal: string; currency?: string }>;
type Window = Readonly<{
  days: 7 | 30; state: "ready" | "partial" | "unavailable"; startDate: string | null; endDate: string | null;
  observedDays: number; missingDays: readonly string[]; freshnessAt: string | null; attribution: string | null;
  currency: string | null; spend: Metric | null; outcome: Metric | null; cpa: Metric | null; reasonCodes: readonly string[];
}>;
type Source = Readonly<{
  state: "ready" | "partial" | "unavailable"; observedAt: string | null; freshnessAt: string | null; reasonCodes: readonly string[];
}>;
export type CampaignPerformanceEvidence = Readonly<{ campaignRef: string; windows: readonly Window[] }>;
export type CampaignPerformanceEvidenceProjection = Readonly<{ source: Source; campaigns: readonly CampaignPerformanceEvidence[] }>;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function date(value: unknown): value is string | null {
  return value === null || typeof value === "string" && Number.isFinite(Date.parse(value));
}
function metric(value: unknown): Metric | null {
  if (value === null) return null;
  if (!record(value) || !exact(value, value.currency === undefined ? ["valueDecimal"] : ["valueDecimal", "currency"])
    || typeof value.valueDecimal !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value.valueDecimal)
    || value.currency !== undefined && (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency))) return null;
  return Object.freeze({ valueDecimal: value.valueDecimal, ...(typeof value.currency === "string" ? { currency: value.currency } : {}) });
}
function window(value: unknown): Window | null {
  if (!record(value) || !exact(value, ["days", "state", "startDate", "endDate", "observedDays", "missingDays", "freshnessAt", "attribution", "currency", "spend", "outcome", "cpa", "reasonCodes"])
    || (value.days !== 7 && value.days !== 30) || !["ready", "partial", "unavailable"].includes(String(value.state))
    || !date(value.startDate) || !date(value.endDate) || !Number.isSafeInteger(value.observedDays) || (value.observedDays as number) < 0
    || !Array.isArray(value.missingDays) || value.missingDays.some((item) => typeof item !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item))
    || !date(value.freshnessAt) || value.attribution !== null && typeof value.attribution !== "string"
    || value.currency !== null && (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency))
    || !Array.isArray(value.reasonCodes) || value.reasonCodes.some((item) => typeof item !== "string" || !/^[a-z0-9_]{1,96}$/.test(item))) return null;
  const spend = metric(value.spend), outcome = metric(value.outcome), cpa = metric(value.cpa);
  if (value.spend !== null && !spend || value.outcome !== null && !outcome || value.cpa !== null && !cpa
    || value.state !== "ready" && (spend !== null || outcome !== null || cpa !== null)) return null;
  return Object.freeze({ days: value.days, state: value.state as Window["state"], startDate: value.startDate as string | null,
    endDate: value.endDate as string | null, observedDays: value.observedDays as number,
    missingDays: Object.freeze([...value.missingDays] as string[]), freshnessAt: value.freshnessAt as string | null,
    attribution: value.attribution as string | null, currency: value.currency as string | null, spend, outcome, cpa,
    reasonCodes: Object.freeze([...value.reasonCodes] as string[]) });
}

/** Accepts only the complete queryless canonical-performance payload; names are deliberately discarded. */
export function campaignPerformanceEvidenceFromResponse(value: unknown): CampaignPerformanceEvidenceProjection | null {
  if (!record(value) || !exact(value, ["version", "state", "accounts", "authority", "source"])
    || value.version !== "canonical-performance-read/1.0.0" || !["ready", "partial", "unavailable"].includes(String(value.state))
    || !Array.isArray(value.accounts) || !record(value.authority) || !exact(value.authority, ["actionAuthority", "canPublish", "canApprove", "canExecute", "canWriteMeta"])
    || value.authority.actionAuthority !== "none" || value.authority.canPublish !== false || value.authority.canApprove !== false
    || value.authority.canExecute !== false || value.authority.canWriteMeta !== false || !record(value.source)
    || !exact(value.source, ["contractVersion", "kind", "state", "observedAt", "freshnessAt", "freshnessThresholdMinutes", "reasonCodes"])
    || value.source.contractVersion !== "public-source/1.0.0" || value.source.kind !== "canonical_performance"
    || value.source.state !== value.state || !["ready", "partial", "unavailable"].includes(String(value.source.state))
    || !date(value.source.observedAt) || !date(value.source.freshnessAt) || value.source.freshnessThresholdMinutes !== null
    || !Array.isArray(value.source.reasonCodes) || value.source.reasonCodes.some((item) => typeof item !== "string" || !/^[a-z0-9_]{1,96}$/.test(item))) return null;
  const campaigns: CampaignPerformanceEvidence[] = [];
  const seen = new Set<string>();
  for (const account of value.accounts) {
    if (!record(account) || !exact(account, ["accountRef", "name", "currency", "windows", "campaigns"])
      || typeof account.accountRef !== "string" || !/^account_[a-f0-9]{24}$/.test(account.accountRef)
      || typeof account.name !== "string" || account.currency !== null && typeof account.currency !== "string"
      || !Array.isArray(account.windows) || !Array.isArray(account.campaigns)) return null;
    for (const campaign of account.campaigns) {
      if (!record(campaign) || !exact(campaign, ["campaignRef", "name", "windows"])
        || typeof campaign.campaignRef !== "string" || !/^campaign_[a-f0-9]{24}$/.test(campaign.campaignRef)
        || typeof campaign.name !== "string" || !Array.isArray(campaign.windows) || seen.has(campaign.campaignRef)) return null;
      const windows = campaign.windows.map(window);
      if (windows.some((item) => item === null) || windows.filter((item) => item?.days === 7).length !== 1
        || windows.filter((item) => item?.days === 30).length !== 1) return null;
      seen.add(campaign.campaignRef);
      campaigns.push(Object.freeze({ campaignRef: campaign.campaignRef, windows: Object.freeze(windows as Window[]) }));
    }
  }
  return Object.freeze({ source: Object.freeze({ state: value.source.state as Source["state"], observedAt: value.source.observedAt as string | null,
    freshnessAt: value.source.freshnessAt as string | null, reasonCodes: Object.freeze([...value.source.reasonCodes] as string[]) }),
  campaigns: Object.freeze(campaigns) });
}

export function selectedCampaignPerformanceEvidence(projection: CampaignPerformanceEvidenceProjection | null, campaignRef: string): CampaignPerformanceEvidence | null {
  if (!projection || !/^campaign_[a-f0-9]{24}$/.test(campaignRef)) return null;
  return projection.campaigns.find((campaign) => campaign.campaignRef === campaignRef) ?? null;
}

function amount(value: Metric | null, currency: string | null): string {
  if (!value) return "—";
  const parsed = Number(value.valueDecimal); const unit = value.currency ?? currency;
  return Number.isFinite(parsed) && unit ? new Intl.NumberFormat("tr-TR", { style: "currency", currency: unit, maximumFractionDigits: 2 }).format(parsed / 100) : "—";
}
function timestamp(value: string | null): string { return value ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value)) : "Bilinmiyor"; }
function sourceLabel(source: Source): string { return source.state === "ready" ? "Kanonik kaynak hazır" : source.state === "partial" ? "Kanonik kaynak kısmi" : "Kanonik kaynak kullanılamıyor"; }
function reasonText(window: Window | null, source: Source | null): string { const codes = window?.reasonCodes.length ? window.reasonCodes : source?.reasonCodes ?? []; return codes.length ? codes.join(" · ") : "Yeterli kanonik performans kanıtı yok."; }

export function CampaignPerformanceEvidencePanel({ campaignRef }: Readonly<{ campaignRef: string }>) {
  const [state, setState] = useState<"loading" | "ready" | "session_required" | "unavailable">("loading");
  const [projection, setProjection] = useState<CampaignPerformanceEvidenceProjection | null>(null);
  const [days, setDays] = useState<7 | 30>(7);
  const load = useCallback(async (): Promise<boolean> => {
    setState("loading");
    try {
      const response = await fetch("/api/meta/canonical-performance", { cache: "no-store", credentials: "same-origin" });
      const parsed = response.ok ? campaignPerformanceEvidenceFromResponse(await response.json()) : null;
      if (!parsed) { setProjection(null); setState(response.status === 401 || response.status === 403 ? "session_required" : "unavailable"); return false; }
      setProjection(parsed); setState("ready"); return true;
    } catch { setProjection(null); setState("unavailable"); return false; }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const evidence = useMemo(() => selectedCampaignPerformanceEvidence(projection, campaignRef), [campaignRef, projection]);
  const selectedWindow = evidence?.windows.find((item) => item.days === days) ?? null;
  const ready = state === "ready" && selectedWindow?.state === "ready";
  return <details className={styles.copyPreview}>
    <summary><span className={styles.kicker}>KANONİK PERFORMANS KANITI · SALT-OKUNUR</span><strong>Seçili kampanya için {days} günlük kapsamı incele</strong></summary>
    <section aria-label="Seçili kampanya performans kanıtı">
      <div className={styles.agentActions}><button type="button" aria-pressed={days === 7} onClick={() => setDays(7)}>7 gün</button><button type="button" aria-pressed={days === 30} onClick={() => setDays(30)}>30 gün</button><button type="button" onClick={() => void load()}>Yenile</button></div>
      {state === "loading" ? <p role="status">Kanonik performans kanıtı okunuyor…</p> : null}
      {state === "session_required" ? <LocalSessionConnector title="Kampanya performans kanıtını bağlayın" onVerify={load} /> : null}
      {state === "unavailable" ? <p role="alert">Kanonik performans kaynağı kullanılamıyor; metrik gösterilmez.</p> : null}
      {state === "ready" && !evidence ? <p>Seçili aynalanmış kampanya için exact canonical performans ref’i yok. İsimle eşleştirme yapılmaz.</p> : null}
      {state === "ready" && evidence && selectedWindow ? <><div className={styles.contextGrid}><div><span>Kaynak</span><strong>{sourceLabel(projection!.source)}</strong><small>Gözlem: {timestamp(projection!.source.observedAt)}</small></div><div><span>Pencere</span><strong>{selectedWindow.startDate ?? "—"} → {selectedWindow.endDate ?? "—"}</strong><small>{selectedWindow.observedDays}/{days} gün gözlendi</small></div><div><span>Son freshness</span><strong>{timestamp(selectedWindow.freshnessAt)}</strong><small>{selectedWindow.attribution ?? "Attribution bilinmiyor"}</small></div><div><span>Eksik gün</span><strong>{selectedWindow.missingDays.length}</strong><small>{selectedWindow.missingDays.join(", ") || "Yok"}</small></div></div>
        {ready ? <div className={styles.metricGrid}><article className={styles.metricCard}><div><span>Harcama</span><em>Exact campaign · hazır</em></div><strong>{amount(selectedWindow.spend, selectedWindow.currency)}</strong></article><article className={styles.metricCard}><div><span>Sonuç · exact lead</span><em>Exact campaign · hazır</em></div><strong>{selectedWindow.outcome?.valueDecimal ?? "—"}</strong></article><article className={styles.metricCard}><div><span>Lead başı maliyet</span><em>Exact campaign · hazır</em></div><strong>{amount(selectedWindow.cpa, selectedWindow.currency)}</strong></article></div> : <p>Bu pencerenin metrikleri gösterilmez: {reasonText(selectedWindow, projection!.source)}</p>}
        <small>{selectedWindow.reasonCodes.length ? `Kanıt notu: ${reasonText(selectedWindow, projection!.source)}` : "Yalnız kanıt görünümü; öneri, kohort, action ve Meta write yok."}</small>
      </> : null}
    </section>
  </details>;
}
