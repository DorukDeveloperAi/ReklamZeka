"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { LocalSessionConnector } from "./local-session-connector";
import styles from "./operation-table-panel.module.css";

type OperationRow = Readonly<{
  market: "yerli" | "yabanci" | "unknown";
  accountRef: string;
  organizationCampaignRef: string | null;
  organizationCampaignName: string;
  campaignRef: string;
  adSetRef: string | null;
  accountName: string;
  campaignName: string;
  adSetName: string | null;
  currentBudgetMinor: number | null;
  budgetOwner: "campaign" | "ad_set" | "unknown";
  budgetOwnerRef: string | null;
  spendMinor: number | null;
  primaryResultState: "bound" | "unbound";
  primaryResult: string | null;
  primaryResultCostMinor: string | null;
  primaryResultSource: "slice_binding" | "organization_campaign_fallback" | "unbound" | "unavailable";
  sourceState: "ready" | "partial" | "empty" | "unavailable";
  missingDays: readonly string[];
  reasonCodes: readonly string[];
}>;
export type OperationTableProjection = Readonly<{
  version: "operation-read/2.0.0";
  period: Readonly<{ startDate: string; endDate: string }>;
  state: "ready" | "partial" | "empty" | "unavailable";
  rows: readonly OperationRow[];
  budgetOwners: readonly Readonly<{
    ref: string;
    currentBudgetMinor: number;
  }>[];
  authority: Readonly<{
    canWriteMeta: false;
    canExecute: false;
    canApprove: false;
  }>;
  nextCursor: string | null;
}>;
type ReadState = Readonly<{
  status: "loading" | "ready" | "empty" | "session_required" | "forbidden" | "conflict" | "unavailable";
  projection?: OperationTableProjection;
  message?: string;
}>;
type Period = "today" | "7d" | "30d";
export type OperationSavedView = Readonly<{
  version: "operation-saved-view/1.0.0";
  market: "all" | OperationRow["market"];
  sourceState: "all" | OperationRow["sourceState"];
  level: "all" | "campaign" | "ad_set";
  search: string;
  sort: "hierarchy" | "name" | "source_state";
  direction: "asc" | "desc";
}>;
const DEFAULT_VIEW: OperationSavedView = Object.freeze({
  version: "operation-saved-view/1.0.0",
  market: "all",
  sourceState: "all",
  level: "all",
  search: "",
  sort: "hierarchy",
  direction: "asc",
});
const SAVED_VIEW_KEY = "reklamzeka.operation.saved-view.v1";
const ref = /^[a-z][a-z0-9_]{1,64}_[A-Za-z0-9_.:-]{1,190}$/;
const date = /^\d{4}-\d{2}-\d{2}$/;
const safeText = (value: unknown, max = 320) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const safeMoney = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
const safeDecimal = (value: unknown): value is string | null => {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/.exec(value);
  return Boolean(match) && match![1]!.length + (match![2]?.length ?? 0) <= 38 && (match![2] === undefined || !match![2]!.endsWith("0"));
};
const calendarDate = (value: string) => {
  if (!date.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
};

/** Rejects malformed rows rather than displaying an untrusted fallback portfolio. */
export function parseOperationTableProjection(value: unknown): OperationTableProjection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (Object.keys(payload).some((key) => !["version", "period", "state", "rows", "budgetOwners", "authority", "nextCursor"].includes(key)) || payload.version !== "operation-read/2.0.0" || !["ready", "partial", "empty", "unavailable"].includes(String(payload.state)) || !Array.isArray(payload.rows) || !Array.isArray(payload.budgetOwners) || !(payload.nextCursor === null || (typeof payload.nextCursor === "string" && /^operation_cursor_[A-Za-z0-9_-]{1,512}$/.test(payload.nextCursor)))) return null;
  const period = payload.period;
  const authority = payload.authority;
  if (!period || typeof period !== "object" || Array.isArray(period) || Object.keys(period).length !== 2 || !calendarDate(String((period as Record<string, unknown>).startDate)) || !calendarDate(String((period as Record<string, unknown>).endDate)) || String((period as Record<string, unknown>).startDate) > String((period as Record<string, unknown>).endDate) || !authority || typeof authority !== "object" || Array.isArray(authority) || Object.keys(authority).length !== 3 || (authority as Record<string, unknown>).canWriteMeta !== false || (authority as Record<string, unknown>).canExecute !== false || (authority as Record<string, unknown>).canApprove !== false) return null;
  const rows: OperationRow[] = [];
  for (const candidate of payload.rows) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const row = candidate as Record<string, unknown>;
    const allowed = ["market", "accountRef", "organizationCampaignRef", "organizationCampaignName", "campaignRef", "adSetRef", "accountName", "campaignName", "adSetName", "currentBudgetMinor", "budgetOwner", "budgetOwnerRef", "spendMinor", "primaryResultState", "primaryResult", "primaryResultCostMinor", "primaryResultSource", "sourceState", "missingDays", "reasonCodes"];
    const source = row.primaryResultSource,
      bound = row.primaryResultState === "bound",
      primaryCoherent = !bound ? row.primaryResult === null && row.primaryResultCostMinor === null && source === "unbound" : source === "unavailable" ? row.primaryResult === null && row.primaryResultCostMinor === null : (source === "slice_binding" || source === "organization_campaign_fallback") && typeof row.primaryResult === "string" && (row.primaryResult === "0" ? row.primaryResultCostMinor === null : typeof row.primaryResultCostMinor === "string");
    if (Object.keys(row).some((key) => !allowed.includes(key)) || !["yerli", "yabanci", "unknown"].includes(String(row.market)) || ![row.accountRef, row.campaignRef].every((item) => typeof item === "string" && ref.test(item)) || !(row.organizationCampaignRef === null || (typeof row.organizationCampaignRef === "string" && ref.test(row.organizationCampaignRef))) || !(row.adSetRef === null || (typeof row.adSetRef === "string" && ref.test(row.adSetRef))) || ![row.accountName, row.organizationCampaignName, row.campaignName].every((item) => safeText(item)) || !(row.adSetName === null || safeText(row.adSetName)) || !safeMoney(row.currentBudgetMinor) || !safeMoney(row.spendMinor) || !safeDecimal(row.primaryResultCostMinor) || !["campaign", "ad_set", "unknown"].includes(String(row.budgetOwner)) || !(row.budgetOwnerRef === null || (typeof row.budgetOwnerRef === "string" && ref.test(row.budgetOwnerRef))) || !["bound", "unbound"].includes(String(row.primaryResultState)) || !safeDecimal(row.primaryResult) || !["slice_binding", "organization_campaign_fallback", "unbound", "unavailable"].includes(String(row.primaryResultSource)) || !primaryCoherent || !["ready", "partial", "empty", "unavailable"].includes(String(row.sourceState)) || !Array.isArray(row.missingDays) || !Array.isArray(row.reasonCodes) || row.missingDays.some((item) => typeof item !== "string" || !calendarDate(item)) || row.reasonCodes.some((item) => typeof item !== "string" || !/^[a-z][a-z0-9_:-]{0,80}$/.test(item))) return null;
    rows.push(Object.freeze(row as unknown as OperationRow));
  }
  if ((payload.state === "empty" || payload.state === "unavailable") && rows.length) return null;
  const owners: { ref: string; currentBudgetMinor: number }[] = [];
  for (const candidate of payload.budgetOwners) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || Object.keys(candidate).length !== 2) return null;
    const owner = candidate as Record<string, unknown>;
    if (typeof owner.ref !== "string" || !ref.test(owner.ref) || typeof owner.currentBudgetMinor !== "number" || !Number.isSafeInteger(owner.currentBudgetMinor) || owner.currentBudgetMinor < 0) return null;
    owners.push(
      Object.freeze({
        ref: owner.ref,
        currentBudgetMinor: owner.currentBudgetMinor,
      }),
    );
  }
  const periodRecord = period as Record<string, unknown>;
  return Object.freeze({
    version: "operation-read/2.0.0",
    period: Object.freeze({
      startDate: periodRecord.startDate as string,
      endDate: periodRecord.endDate as string,
    }),
    state: payload.state as OperationTableProjection["state"],
    rows: Object.freeze(rows),
    budgetOwners: Object.freeze(owners),
    authority: Object.freeze({
      canWriteMeta: false,
      canExecute: false,
      canApprove: false,
    }),
    nextCursor: payload.nextCursor as string | null,
  });
}

export function operationRowIdentity(row: OperationRow): string {
  return `${row.accountRef}\u0000${row.campaignRef}\u0000${row.adSetRef ?? "campaign"}`;
}
export function operationAppendRows(existing: readonly OperationRow[], incoming: readonly OperationRow[]): readonly OperationRow[] {
  const seen = new Set(existing.map(operationRowIdentity));
  return Object.freeze([...existing, ...incoming.filter((row) => !seen.has(operationRowIdentity(row)) && (seen.add(operationRowIdentity(row)), true))]);
}
export class OperationPaginationGate {
  private inFlight = false;
  private readonly consumed = new Set<string>();
  claim(cursor: string | null): boolean {
    if (this.inFlight || cursor === null || this.consumed.has(cursor)) return false;
    this.inFlight = true;
    this.consumed.add(cursor);
    return true;
  }
  complete() {
    this.inFlight = false;
  }
  reset() {
    this.inFlight = false;
    this.consumed.clear();
  }
}
export function operationProjectionReadState(projection: OperationTableProjection): ReadState {
  if (projection.state === "unavailable")
    return Object.freeze({
      status: "unavailable",
      message: "Operasyon kaynağı kullanılamıyor; kanonik veri gösterilmiyor.",
    });
  return Object.freeze({
    status: projection.state === "empty" ? "empty" : "ready",
    projection,
  });
}
export function operationHierarchy(rows: readonly OperationRow[]) {
  const grouped = new Map<
    string,
    {
      key: string;
      label: string;
      campaigns: Map<
        string,
        {
          campaignRef: string;
          campaignName: string;
          summary: OperationRow | null;
          adSets: OperationRow[];
        }
      >;
    }
  >();
  for (const row of rows) {
    const key = `${row.market}\u0000${row.accountRef}\u0000${row.organizationCampaignRef ?? "unassigned"}`;
    const group = grouped.get(key) ?? {
      key,
      label: `${row.market === "unknown" ? "Pazar bilinmiyor" : row.market === "yerli" ? "Yerli" : "Yabancı"} · ${row.accountName} · ${row.organizationCampaignName}`,
      campaigns: new Map(),
    };
    const campaign = group.campaigns.get(row.campaignRef) ?? {
      campaignRef: row.campaignRef,
      campaignName: row.campaignName,
      summary: null,
      adSets: [],
    };
    if (row.adSetRef) campaign.adSets.push(row);
    else campaign.summary = row;
    group.campaigns.set(row.campaignRef, campaign);
    grouped.set(key, group);
  }
  return [...grouped.values()];
}

export function parseOperationSavedView(value: unknown): OperationSavedView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 7 || Object.keys(item).some((key) => !["version", "market", "sourceState", "level", "search", "sort", "direction"].includes(key)) || item.version !== "operation-saved-view/1.0.0" || !["all", "yerli", "yabanci", "unknown"].includes(String(item.market)) || !["all", "ready", "partial", "empty", "unavailable"].includes(String(item.sourceState)) || !["all", "campaign", "ad_set"].includes(String(item.level)) || typeof item.search !== "string" || item.search.length > 80 || /[\u0000-\u001f\u007f]/.test(item.search) || !["hierarchy", "name", "source_state"].includes(String(item.sort)) || !["asc", "desc"].includes(String(item.direction))) return null;
  return Object.freeze(item as unknown as OperationSavedView);
}

export function applyOperationSavedView(rows: readonly OperationRow[], view: OperationSavedView): readonly OperationRow[] {
  const valid = parseOperationSavedView(view);
  if (!valid) return Object.freeze([]);
  const needle = valid.search.trim().toLocaleLowerCase("tr-TR");
  const filtered = rows.filter((row) => (valid.market === "all" || row.market === valid.market) && (valid.sourceState === "all" || row.sourceState === valid.sourceState) && (valid.level === "all" || (valid.level === "campaign" && row.adSetRef === null) || (valid.level === "ad_set" && row.adSetRef !== null)) && (!needle || [row.accountName, row.organizationCampaignName, row.campaignName, row.adSetName ?? "", row.accountRef, row.campaignRef, row.adSetRef ?? ""].some((value) => value.toLocaleLowerCase("tr-TR").includes(needle))));
  if (valid.sort === "hierarchy") return Object.freeze(valid.direction === "asc" ? filtered : [...filtered].reverse());
  const rank = Object.freeze({
    ready: 0,
    partial: 1,
    empty: 2,
    unavailable: 3,
  });
  const ordered = [...filtered].sort((left, right) => {
    const compared = valid.sort === "name" ? (left.adSetName ?? left.campaignName).localeCompare(right.adSetName ?? right.campaignName, "tr-TR") : rank[left.sourceState] - rank[right.sourceState];
    return (valid.direction === "asc" ? compared : -compared) || operationRowIdentity(left).localeCompare(operationRowIdentity(right));
  });
  return Object.freeze(ordered);
}

export function operationViewSummary(rows: readonly OperationRow[]) {
  return Object.freeze({
    rows: rows.length,
    ready: rows.filter((row) => row.sourceState === "ready").length,
    incomplete: rows.filter((row) => row.sourceState !== "ready").length,
    ratioAvailable: rows.filter((row) => row.primaryResultCostMinor !== null).length,
  });
}

/** The read contract does not currently carry a verified workspace currency.
 * Do not turn a minor-unit number into an invented TRY amount. */
function money(value: number | null) {
  return value === null ? "Veri yok" : "Para birimi doğrulanmadı";
}
function primaryCost(value: string | null) {
  return value === null ? "Veri yok" : "Para birimi doğrulanmadı";
}
function sourceDetail(row: OperationRow) {
  const missing = row.missingDays.length ? `Eksik gün: ${row.missingDays.join(", ")}` : null;
  const reasons = row.reasonCodes.length ? `Neden: ${row.reasonCodes.join(", ")}` : null;
  return [bindingSource(row), missing, reasons].filter(Boolean).join(" · ") || "Kaynak kapsamı tamam";
}
function metric(row: OperationRow) {
  return row.primaryResultState === "unbound" ? "Ana sonuç seçilmedi" : row.primaryResult === null ? "Sonuç verisi yok" : row.primaryResult;
}
function bindingSource(row: OperationRow) {
  return row.primaryResultSource === "slice_binding" ? "Slice bağlaması" : row.primaryResultSource === "organization_campaign_fallback" ? "Kurum Kampanyası bağlaması" : row.primaryResultSource === "unavailable" ? "Bağlama doğrulanamadı" : "Ana sonuç bağlanmadı";
}
function statusLabel(status: ReadState["status"]) {
  return {
    loading: "Kampanya kaynağı okunuyor…",
    session_required: "Operasyon için yerel oturum gerekli.",
    forbidden: "Bu çalışma alanında Operasyon verisine erişim yok.",
    conflict: "Operasyon kaynağı güncel bağlamla çakışıyor.",
    unavailable: "Operasyon kaynağı kullanılamıyor.",
    empty: "Seçili dönemde gösterilebilir operasyon satırı yok.",
    ready: "",
  }[status];
}

export function OperationTableSurface({
  state,
  period,
  onPeriod,
  onLoadMore,
  onConnect,
  loadingMore = false,
}: Readonly<{
  state: ReadState;
  period: Period;
  onPeriod(period: Period): void;
  onLoadMore(): void;
  onConnect(): Promise<boolean>;
  loadingMore?: boolean;
}>) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [view, setView] = useState<OperationSavedView>(DEFAULT_VIEW);
  const [savedNotice, setSavedNotice] = useState("");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SAVED_VIEW_KEY);
      if (!stored) return;
      const parsed = parseOperationSavedView(JSON.parse(stored));
      if (parsed) setView(parsed);
    } catch {
      /* malformed local preferences stay ignored */
    }
  }, []);
  const visibleRows = useMemo(() => (state.projection ? applyOperationSavedView(state.projection.rows, view) : []), [state.projection, view]);
  const groups = operationHierarchy(visibleRows);
  const summary = operationViewSummary(visibleRows);
  const updateView = <K extends keyof OperationSavedView>(key: K, value: OperationSavedView[K]) => setView((current) => Object.freeze({ ...current, [key]: value }));
  const saveView = () => {
    try {
      localStorage.setItem(SAVED_VIEW_KEY, JSON.stringify(view));
      setSavedNotice("Görünüm bu cihazda kaydedildi.");
    } catch {
      setSavedNotice("Görünüm bu cihazda kaydedilemedi.");
    }
  };
  const resetView = () => {
    setView(DEFAULT_VIEW);
    setSavedNotice("");
    try {
      localStorage.removeItem(SAVED_VIEW_KEY);
    } catch {
      /* storage is optional */
    }
  };
  const toggle = (campaignRef: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      next.has(campaignRef) ? next.delete(campaignRef) : next.add(campaignRef);
      return next;
    });
  return (
    <section className={styles.operationTable} aria-label="Operasyon ana tablosu">
      <header>
        <span className="kicker">OPERASYON · KANONİK OKUMA</span>
        <h2>Portföy işletim tablosu</h2>
        <p>Hiyerarşi, dönem performansı ve veri eksikleri aynı kanonik okumadan gelir. Bu ekran Meta’ya yazmaz.</p>
      </header>
      <details className={styles.help}>
        <summary>Bu tablo nasıl okunur?</summary>
        <p>Satırlar pazar → reklam hesabı → Kurum Kampanyası → Meta kampanyası → reklam seti sırasındadır. Para birimi kanonik yanıtta doğrulanana kadar parasal tutarlar biçimlendirilmez; eksik veri sıfır sayılmaz.</p>
      </details>
      <div className={styles.toolbar} role="group" aria-label="Tarih aralığı">
        {(
          [
            ["today", "Bugün"],
            ["7d", "Son 7 gün"],
            ["30d", "Son 30 gün"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={period === id} onClick={() => onPeriod(id)}>
            {label}
          </button>
        ))}
      </div>
      {state.projection?.state === "partial" ? (
        <p className={styles.sourceNote} role="status" aria-live="polite">
          Kaynak kısmi: eksik tarih ve nedenler satırda görünür; eksik veri sıfır sayılmaz.
        </p>
      ) : null}
      {state.status !== "ready" && state.status !== "empty" ? (
        <div role={state.status === "loading" ? "status" : "alert"} aria-live={state.status === "loading" ? "polite" : "assertive"}>
          <p>{state.message ?? statusLabel(state.status)}</p>
          <p>Kaynak doğrulanana kadar ekran örnek içerikle doldurulmaz.</p>
          {state.status === "session_required" ? <LocalSessionConnector title="Operasyon oturumunu bağlayın" onVerify={onConnect} /> : null}
        </div>
      ) : null}
      {state.status === "empty" ? (
        <p role="status" aria-live="polite">
          {statusLabel("empty")}
        </p>
      ) : null}
      {state.status === "ready" && state.projection ? (
        <>
          <p className={styles.sourceNote} role="status" aria-live="polite">
            {state.projection.period.startDate} – {state.projection.period.endDate} · Salt-okunur · Meta yazma yetkisi yok
          </p>
          <div className={styles.viewControls} aria-label="Operasyon görünümü">
            <label>
              Ara
              <input value={view.search} maxLength={80} onChange={(event) => updateView("search", event.target.value)} />
            </label>
            <label>
              Pazar
              <select value={view.market} onChange={(event) => updateView("market", event.target.value as OperationSavedView["market"])}>
                <option value="all">Tümü</option>
                <option value="yerli">Yerli</option>
                <option value="yabanci">Yabancı</option>
                <option value="unknown">Bilinmiyor</option>
              </select>
            </label>
            <label>
              Kaynak
              <select value={view.sourceState} onChange={(event) => updateView("sourceState", event.target.value as OperationSavedView["sourceState"])}>
                <option value="all">Tümü</option>
                <option value="ready">Hazır</option>
                <option value="partial">Kısmi</option>
                <option value="empty">Boş</option>
                <option value="unavailable">Kullanılamıyor</option>
              </select>
            </label>
            <label>
              Seviye
              <select value={view.level} onChange={(event) => updateView("level", event.target.value as OperationSavedView["level"])}>
                <option value="all">Tümü</option>
                <option value="campaign">Kampanya</option>
                <option value="ad_set">Reklam seti</option>
              </select>
            </label>
            <label>
              Sırala
              <select value={view.sort} onChange={(event) => updateView("sort", event.target.value as OperationSavedView["sort"])}>
                <option value="hierarchy">Hiyerarşi</option>
                <option value="name">Ad</option>
                <option value="source_state">Veri durumu</option>
              </select>
            </label>
            <label>
              Yön
              <select value={view.direction} onChange={(event) => updateView("direction", event.target.value as OperationSavedView["direction"])}>
                <option value="asc">Artan</option>
                <option value="desc">Azalan</option>
              </select>
            </label>
            <button type="button" onClick={saveView}>
              Görünümü kaydet
            </button>
            <button type="button" onClick={resetView}>
              Sıfırla
            </button>
          </div>
          {savedNotice ? (
            <p role="status" aria-live="polite">
              {savedNotice}
            </p>
          ) : null}
          <div className={styles.subtotals} aria-label="Filtrelenmiş görünüm özeti">
            <span>
              <strong>{summary.rows}</strong> satır
            </span>
            <span>
              <strong>{summary.ready}</strong> hazır
            </span>
            <span>
              <strong>{summary.incomplete}</strong> eksik
            </span>
            <span>
              <strong>{summary.ratioAvailable}</strong> kanonik sonuç maliyeti
            </span>
          </div>
          {visibleRows.length ? (
            <>
              <div className={styles.scroll} role="region" aria-label="Hiyerarşik operasyon tablosu" tabIndex={0}>
                <table className={styles.table}>
                  <caption>Hiyerarşik operasyon tablosu; kampanyaları açarak reklam seti satırlarını görün.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Kapsam / ad</th>
                      <th scope="col">Bütçe sahibi</th>
                      <th scope="col">Güncel bütçe</th>
                      <th scope="col">Dönem harcaması</th>
                      <th scope="col">Ana sonuç</th>
                      <th scope="col">Sonuç maliyeti</th>
                      <th scope="col">Veri durumu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => (
                      <Fragment key={group.key}>
                        <tr className={styles.group}>
                          <th scope="rowgroup" colSpan={7}>
                            {group.label}
                          </th>
                        </tr>
                        {[...group.campaigns.values()].map((campaign) => (
                          <Fragment key={campaign.campaignRef}>
                            {campaign.summary ? <OperationDataRow row={campaign.summary} expanded={expanded.has(campaign.campaignRef)} hasChildren={campaign.adSets.length > 0} onToggle={() => toggle(campaign.campaignRef)} /> : <CampaignContextRow campaignName={campaign.campaignName} />}
                            {campaign.summary && !expanded.has(campaign.campaignRef) ? null : campaign.adSets.map((row) => <OperationDataRow key={operationRowIdentity(row)} row={row} child />)}
                          </Fragment>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.mobileCards}>
                {visibleRows.map((row) => (
                  <article className={styles.card} key={operationRowIdentity(row)}>
                    <h3>{row.adSetRef ? `Reklam seti · ${row.adSetName ?? "Adı bilinmiyor"}` : row.campaignName}</h3>
                    <p>
                      {row.market === "yerli" ? "Yerli" : row.market === "yabanci" ? "Yabancı" : "Pazar bilinmiyor"} · {row.accountName} · {row.organizationCampaignName}
                      {row.adSetRef ? ` · Kampanya: ${row.campaignName}` : ""}
                    </p>
                    <dl>
                      <div>
                        <dt>Bütçe</dt>
                        <dd>{money(row.currentBudgetMinor)}</dd>
                      </div>
                      <div>
                        <dt>Harcama</dt>
                        <dd>{money(row.spendMinor)}</dd>
                      </div>
                      <div>
                        <dt>Ana sonuç</dt>
                        <dd>{metric(row)}</dd>
                      </div>
                      <div>
                        <dt>Oran</dt>
                        <dd>{primaryCost(row.primaryResultCostMinor)}</dd>
                      </div>
                      <div>
                        <dt>Veri</dt>
                        <dd>{row.sourceState === "ready" ? "Hazır" : row.sourceState === "partial" ? "Kısmi" : row.sourceState === "empty" ? "Boş" : "Kullanılamıyor"}</dd>
                      </div>
                    </dl>
                    <details>
                      <summary>Satır kanıtını incele</summary>
                      <small>{sourceDetail(row)}</small>
                    </details>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p role="status">Bu görünümde eşleşen satır yok.</p>
          )}
          {state.projection.nextCursor ? (
            <button className={styles.loadMore} type="button" disabled={loadingMore} aria-busy={loadingMore} aria-live="polite" onClick={onLoadMore}>
              {loadingMore ? "Yükleniyor…" : "Daha fazlasını yükle"}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function CampaignContextRow({ campaignName }: Readonly<{ campaignName: string }>) {
  return (
    <tr>
      <th scope="row">
        <strong>{campaignName}</strong>
        <small>Yalnız reklam seti kapsamı; kampanya performansı veya bütçesi bu sayfada verilmedi.</small>
      </th>
      <td colSpan={6}>Kampanya bağlamı</td>
    </tr>
  );
}

function OperationDataRow({
  row,
  child = false,
  expanded,
  hasChildren,
  onToggle,
}: Readonly<{
  row: OperationRow;
  child?: boolean;
  expanded?: boolean;
  hasChildren?: boolean;
  onToggle?: () => void;
}>) {
  return (
    <tr className={child ? styles.adSet : undefined}>
      <th scope="row">
        {hasChildren ? (
          <button className={styles.expand} type="button" aria-expanded={expanded} aria-label={`${row.campaignName} reklam setlerini ${expanded ? "daralt" : "aç"}`} onClick={onToggle}>
            {expanded ? "−" : "+"}
          </button>
        ) : null}
        <strong>{child ? `Reklam seti · ${row.adSetName ?? "Adı bilinmiyor"}` : row.campaignName}</strong>
        <small>{child ? row.campaignName : `${row.accountName} · ${row.organizationCampaignName}`}</small>
      </th>
      <td>{row.budgetOwner === "unknown" ? "Bütçe sahibi bilinmiyor" : row.budgetOwner === "campaign" ? "Kampanya bütçesi" : "Reklam seti bütçesi"}</td>
      <td>{money(row.currentBudgetMinor)}</td>
      <td>{money(row.spendMinor)}</td>
      <td>
        {metric(row)}
        <small>{bindingSource(row)}</small>
      </td>
      <td>{row.primaryResultState === "unbound" ? "—" : primaryCost(row.primaryResultCostMinor)}</td>
      <td>
        <span className={styles.state} data-state={row.sourceState}>
          {row.sourceState === "ready" ? "Hazır" : row.sourceState === "partial" ? "Kısmi" : row.sourceState === "empty" ? "Boş" : "Kullanılamıyor"}
        </span>
        <small>{sourceDetail(row)}</small>
      </td>
    </tr>
  );
}

export function OperationTablePanel({ onConnect }: Readonly<{ onConnect(): Promise<boolean> }>) {
  const [period, setPeriod] = useState<Period>("7d");
  const [state, setState] = useState<ReadState>({ status: "loading" });
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const rowsRef = useRef<readonly OperationRow[]>([]);
  const gateRef = useRef(new OperationPaginationGate());
  const controllerRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const load = async (nextCursor: string | null, append: boolean, requestedPeriod: Period) => {
    if (append && !gateRef.current.claim(nextCursor)) return;
    if (!append) {
      controllerRef.current?.abort();
      controllerRef.current = new AbortController();
      rowsRef.current = [];
      setCursor(null);
      setState({ status: "loading" });
    } else setLoadingMore(true);
    const request = ++requestRef.current;
    try {
      const params = new URLSearchParams({
        period: requestedPeriod,
        limit: "100",
      });
      if (nextCursor) params.set("cursor", nextCursor);
      const response = await fetch(`/api/operations?${params}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controllerRef.current?.signal,
        headers: { "X-ReklamZeka-Intent": "operation-read" },
      });
      const payload: unknown = await response.json().catch(() => null);
      if (request !== requestRef.current) return;
      if (!response.ok) {
        const status = response.status === 401 ? "session_required" : response.status === 403 ? "forbidden" : response.status === 409 ? "conflict" : "unavailable";
        setState({ status, message: statusLabel(status) });
        return;
      }
      const parsed = parseOperationTableProjection(payload);
      if (!parsed) {
        setState({
          status: "unavailable",
          message: "Operasyon kaynağı beklenen kanonik sözleşmeyle doğrulanamadı; veri gösterilmiyor.",
        });
        return;
      }
      if (parsed.state === "unavailable") {
        rowsRef.current = [];
        setCursor(null);
        setState(operationProjectionReadState(parsed));
        return;
      }
      const rows = append ? operationAppendRows(rowsRef.current, parsed.rows) : parsed.rows;
      rowsRef.current = rows;
      const projection = Object.freeze({ ...parsed, rows });
      setCursor(projection.nextCursor);
      setState(operationProjectionReadState(projection));
    } catch (error) {
      if (request === requestRef.current && !(error instanceof DOMException && error.name === "AbortError"))
        setState({
          status: "unavailable",
          message: "Operasyon kaynağına ulaşılamadı; veri gösterilmiyor.",
        });
    } finally {
      if (append) {
        gateRef.current.complete();
        if (request === requestRef.current) setLoadingMore(false);
      }
    }
  };
  useEffect(() => {
    gateRef.current.reset();
    void load(null, false, period);
    return () => controllerRef.current?.abort();
  }, [period]);
  const onPeriod = (next: Period) => {
    if (next !== period) setPeriod(next);
  };
  return <OperationTableSurface state={state} period={period} loadingMore={loadingMore} onPeriod={onPeriod} onLoadMore={() => cursor && void load(cursor, true, period)} onConnect={onConnect} />;
}
