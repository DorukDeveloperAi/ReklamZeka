"use client";

import { useMemo, useRef, useState } from "react";
import type { ScopeReport } from "@/domain/slices/scope-report";
import { LocalSessionConnector } from "./local-session-connector";
import styles from "./scope-report-panel.module.css";

type Form = Readonly<{ slice: string; start: string; end: string; granularity: "day" | "week" | "month"; level: "" | "campaign" | "ad_set"; metric: string; action: string; sort: "bucket" | "entity" | "metric"; direction: "asc" | "desc" }>;
type LoadState = Readonly<{ kind: "idle" | "loading" | "error" | "session_required" | "ready"; message?: string; report?: ScopeReport; submitted?: Form }>;
const slicePattern = /^slice_[a-z0-9][a-z0-9_.:-]{0,190}$/;
const keyPattern = /^[a-z][a-z0-9_:-]{0,80}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function initialForm(): Form {
  const end = new Date(); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 6);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  return { slice: "", start: date(start), end: date(end), granularity: "day", level: "", metric: "", action: "", sort: "bucket", direction: "asc" };
}
function query(form: Form, format: "json" | "csv" | "xlsx") {
  const input = new URLSearchParams({ slice: form.slice, start: form.start, end: form.end, granularity: form.granularity, sort: form.sort, direction: form.direction, format });
  if (form.level) input.set("level", form.level); if (form.metric) input.set("metric", form.metric); if (form.action) input.set("action", form.action);
  return `/api/scope-report?${input}`;
}
function validForm(form: Form): boolean {
  return slicePattern.test(form.slice) && datePattern.test(form.start) && datePattern.test(form.end) && form.start <= form.end
    && (!form.metric || keyPattern.test(form.metric)) && (!form.action || keyPattern.test(form.action));
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function exact(recordValue: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(recordValue).length === keys.length && keys.every((key) => key in recordValue); }
function text(value: unknown, maximum = 256): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum; }
function dateList(value: unknown): value is readonly string[] { return Array.isArray(value) && value.every((item) => date(item)); }
function date(value: unknown): value is string { return typeof value === "string" && datePattern.test(value); }
function nonNegative(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
/** Canonical resolver public aliases: a stable namespace prefix plus opaque alias suffix. */
function publicRef(value: unknown): value is string { return text(value, 256) && /^[a-z][a-z0-9]{0,63}_[a-z0-9][a-z0-9_.:-]{0,190}$/.test(value) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function publicRefList(value: unknown): value is readonly string[] { return Array.isArray(value) && value.every((item) => publicRef(item)); }
/** The UI accepts only the public read model; malformed responses never become a table. */
export function parseScopeReport(value: unknown): ScopeReport | null {
  if (!record(value) || !exact(value, ["version", "scope", "rows", "rawMetrics", "pivot", "coverage", "appliedFilters", "counts", "authority"])) return null;
  const report = value, scope = record(report.scope) ? report.scope : null, market = scope && record(scope.market) ? scope.market : null, authority = record(report.authority) ? report.authority : null, filters = record(report.appliedFilters) ? report.appliedFilters : null, counts = record(report.counts) ? report.counts : null;
  if (report.version !== "scope-report/1.0.0" || !scope || !market || !authority || !filters || !counts || !exact(scope, ["sliceRef", "revisionRef", "revisionNumber", "definitionHash", "market"])
    || !exact(market, ["dimensionRef", "valueRef", "key"]) || !exact(authority, ["canWriteMeta", "canExecute", "canApprove"]) || !exact(filters, ["granularity", "startDate", "endDate", "entityLevel", "metricKey", "actionType", "sort", "direction"]) || !exact(counts, ["included", "excluded", "missingMarket", "ambiguousMarket"])
    || authority.canWriteMeta !== false || authority.canExecute !== false || authority.canApprove !== false || !slicePattern.test(scope.sliceRef as string) || !publicRef(scope.revisionRef) || !Number.isSafeInteger(scope.revisionNumber) || (scope.revisionNumber as number) < 1 || typeof scope.definitionHash !== "string" || !/^[a-f0-9]{64}$/.test(scope.definitionHash)
    || !publicRef(market.dimensionRef) || !publicRef(market.valueRef) || !["yerli", "yabanci"].includes(market.key as string) || !["day", "week", "month"].includes(filters.granularity as string) || !(filters.startDate === null || date(filters.startDate)) || !(filters.endDate === null || date(filters.endDate)) || !(filters.entityLevel === null || filters.entityLevel === "campaign" || filters.entityLevel === "ad_set") || !(filters.metricKey === null || text(filters.metricKey) && keyPattern.test(filters.metricKey)) || !(filters.actionType === null || text(filters.actionType) && keyPattern.test(filters.actionType)) || !["bucket", "entity", "metric"].includes(filters.sort as string) || !["asc", "desc"].includes(filters.direction as string) || !nonNegative(counts.included) || !nonNegative(counts.excluded) || !nonNegative(counts.missingMarket) || !nonNegative(counts.ambiguousMarket) || !Array.isArray(report.rows) || !Array.isArray(report.rawMetrics) || !Array.isArray(report.pivot) || !Array.isArray(report.coverage)) return null;
  if (!report.rows.every((item) => { const row = record(item) ? item : null; return !!row && exact(row, ["entityRef", "entityLevel", "membership", "reason", "marketEvidenceRefs", "matchedDimensionRefs", "matchedDimensionEvidenceRefs"]) && publicRef(row.entityRef) && ["organization_campaign", "campaign", "ad_set"].includes(row.entityLevel as string) && ["included", "excluded"].includes(row.membership as string) && text(row.reason) && publicRefList(row.marketEvidenceRefs) && publicRefList(row.matchedDimensionRefs) && publicRefList(row.matchedDimensionEvidenceRefs); })
    || !report.rawMetrics.every((item) => { const metric = record(item) ? item : null; return !!metric && exact(metric, ["entityRef", "entityLevel", "bucket", "date", "attribution", "metricKey", "actionType", "valueDecimal", "valueMinor", "currency", "availability"]) && publicRef(metric.entityRef) && ["campaign", "ad_set"].includes(metric.entityLevel as string) && date(metric.bucket) && date(metric.date) && text(metric.attribution) && text(metric.metricKey) && keyPattern.test(metric.metricKey) && (metric.actionType === null || text(metric.actionType) && keyPattern.test(metric.actionType)) && (metric.valueDecimal === null || text(metric.valueDecimal)) && (metric.valueMinor === null || text(metric.valueMinor)) && (metric.currency === null || typeof metric.currency === "string" && /^[A-Z]{3}$/.test(metric.currency)) && ["available", "unavailable"].includes(metric.availability as string); })
    || !report.pivot.every((item) => { const pivot = record(item) ? item : null, subtotal = pivot && record(pivot.subtotal) ? pivot.subtotal : null, ratios = pivot && record(pivot.ratios) ? pivot.ratios : null, ratio = ratios && ratios.spendPerAction !== null && record(ratios.spendPerAction) ? ratios.spendPerAction : null, drill = pivot && record(pivot.drill) ? pivot.drill : null; return !!pivot && !!subtotal && !!ratios && !!drill && exact(pivot, ["entityRef", "entityLevel", "bucket", "subtotal", "ratios", "drill"]) && exact(subtotal, ["metricCount", "availableMetricCount"]) && exact(ratios, ["spendPerAction"]) && exact(drill, ["entityRef", "bucket"]) && publicRef(pivot.entityRef) && ["campaign", "ad_set"].includes(pivot.entityLevel as string) && date(pivot.bucket) && nonNegative(subtotal.metricCount) && nonNegative(subtotal.availableMetricCount) && subtotal.availableMetricCount <= subtotal.metricCount && publicRef(drill.entityRef) && date(drill.bucket) && (ratios.spendPerAction === null || !!ratio && exact(ratio, ["numeratorMinor", "denominatorAction"]) && text(ratio.numeratorMinor) && text(ratio.denominatorAction)); })
    || !report.coverage.every((item) => { const coverage = record(item) ? item : null; return !!coverage && exact(coverage, ["entityRef", "entityLevel", "actionType", "expectedDays", "observedDays", "missingDays", "sourceState", "reasonCodes"]) && publicRef(coverage.entityRef) && ["campaign", "ad_set"].includes(coverage.entityLevel as string) && text(coverage.actionType) && keyPattern.test(coverage.actionType) && dateList(coverage.expectedDays) && dateList(coverage.observedDays) && dateList(coverage.missingDays) && ["ready", "partial", "unavailable"].includes(coverage.sourceState as string) && Array.isArray(coverage.reasonCodes) && coverage.reasonCodes.every((reason) => ["coverage_incomplete", "action_unavailable", "selector_required"].includes(reason)); })) return null;
  return report as unknown as ScopeReport;
}
/** Bind a response to the exact submitted UI context before it can be displayed or exported. */
export function scopeReportMatchesSubmitted(report: ScopeReport, submitted: Form): boolean {
  const filters = report.appliedFilters;
  return report.scope.sliceRef === submitted.slice && filters.startDate === submitted.start && filters.endDate === submitted.end
    && filters.granularity === submitted.granularity && filters.entityLevel === (submitted.level || null)
    && filters.metricKey === (submitted.metric || null) && filters.actionType === (submitted.action || null)
    && filters.sort === submitted.sort && filters.direction === submitted.direction;
}

function download(name: string, blob: Blob) {
  const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = name; anchor.click(); URL.revokeObjectURL(anchor.href);
}

export function ScopeReportPanel({ onConnect }: Readonly<{ onConnect: () => Promise<boolean> }>) {
  const [form, setForm] = useState<Form>(initialForm); const [state, setState] = useState<LoadState>({ kind: "idle" }); const [exportError, setExportError] = useState<string | null>(null); const [exporting, setExporting] = useState(false); const requestSequence = useRef(0); const exportSequence = useRef(0); const exportAbort = useRef<AbortController | null>(null);
  const canSubmit = validForm(form), report = state.report;
  const update = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const load = async (requested?: Form) => {
    if (!requested && !canSubmit) return;
    const submitted = { ...(requested ?? form) }; const sequence = ++requestSequence.current;
    exportSequence.current += 1; exportAbort.current?.abort(); exportAbort.current = null; setExporting(false); setExportError(null);
    setState({ kind: "loading" });
    try {
      const response = await fetch(query(submitted, "json"), { headers: { "x-reklamzeka-intent": "scope-report-read" }, credentials: "same-origin" });
      if (sequence !== requestSequence.current) return;
      if (response.status === 401) return setState({ kind: "session_required", submitted });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return setState({ kind: "error", message: "Rapor kaynağı bu istek için kullanılamıyor.", submitted });
      const parsed = parseScopeReport(await response.json());
      if (sequence === requestSequence.current) setState(parsed && scopeReportMatchesSubmitted(parsed, submitted) ? { kind: "ready", report: parsed, submitted } : { kind: "error", message: "Rapor yanıtı kanonik public sözleşmeyle veya istenen bağlamla eşleşmedi.", submitted });
    } catch { if (sequence === requestSequence.current) setState({ kind: "error", message: "Rapor kaynağına ulaşılamadı.", submitted }); }
  };
  const exportReport = async (format: "csv" | "xlsx") => {
    if (!report || !state.submitted) return;
    const submitted = state.submitted; const sequence = ++exportSequence.current; exportAbort.current?.abort(); const controller = new AbortController(); exportAbort.current = controller; setExportError(null); setExporting(true);
    try { const response = await fetch(query(submitted, format), { headers: { "x-reklamzeka-intent": "scope-report-read" }, credentials: "same-origin", signal: controller.signal });
      const expected = format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      if (!response.ok || !response.headers.get("content-type")?.includes(expected)) { if (sequence === exportSequence.current) setExportError("Dışa aktarma hazırlanamadı."); return; }
      if (sequence !== exportSequence.current) return;
      download(`kapsam-raporu.${format}`, await response.blob());
    } catch { if (sequence === exportSequence.current && !controller.signal.aborted) setExportError("Dışa aktarma hazırlanamadı."); } finally { if (sequence === exportSequence.current) { setExporting(false); exportAbort.current = null; } }
  };
  const membership = useMemo(() => report ? report.rows.filter((row) => row.membership === "included") : [], [report]);
  return <section className={styles.panel} aria-labelledby="scope-report-title">
    <header><div><span className={styles.kicker}>KANONİK KAPSAM · SALT OKUNUR</span><h2 id="scope-report-title">Kapsam raporu</h2><p>Yayınlanmış Slice kapsamı, kaynak kapsaması ve ham metrik kanıtı; kayıt veya karar oluşturmaz.</p></div><span className={styles.authority}>Meta yazma yok · Onay yok · Çalıştırma yok</span></header>
    <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); void load(); }} aria-label="Kapsam raporu filtreleri">
      <label>Slice public ref<input disabled={state.kind === "loading"} value={form.slice} onChange={(event) => update("slice", event.target.value)} placeholder="slice_yerli" pattern={slicePattern.source} required aria-describedby="scope-report-help" /></label>
      <label>Başlangıç<input disabled={state.kind === "loading"} type="date" value={form.start} onChange={(event) => update("start", event.target.value)} required /></label>
      <label>Bitiş<input disabled={state.kind === "loading"} type="date" value={form.end} onChange={(event) => update("end", event.target.value)} required /></label>
      <label>Toplama<select disabled={state.kind === "loading"} value={form.granularity} onChange={(event) => update("granularity", event.target.value as Form["granularity"])}><option value="day">Gün</option><option value="week">Hafta</option><option value="month">Ay</option></select></label>
      <label>Seviye<select disabled={state.kind === "loading"} value={form.level} onChange={(event) => update("level", event.target.value as Form["level"])}><option value="">Tümü</option><option value="campaign">Kampanya</option><option value="ad_set">Reklam seti</option></select></label>
      <label>Metrik<input disabled={state.kind === "loading"} value={form.metric} onChange={(event) => update("metric", event.target.value)} placeholder="spend" pattern={keyPattern.source} /></label>
      <label>Aksiyon<input disabled={state.kind === "loading"} value={form.action} onChange={(event) => update("action", event.target.value)} placeholder="lead" pattern={keyPattern.source} /></label>
      <label>Sırala<select disabled={state.kind === "loading"} value={form.sort} onChange={(event) => update("sort", event.target.value as Form["sort"])}><option value="bucket">Dönem</option><option value="entity">Varlık</option><option value="metric">Metrik</option></select></label>
      <label>Yön<select disabled={state.kind === "loading"} value={form.direction} onChange={(event) => update("direction", event.target.value as Form["direction"])}><option value="asc">Artan</option><option value="desc">Azalan</option></select></label>
      <button type="submit" disabled={!canSubmit || state.kind === "loading"}>{state.kind === "loading" ? "Yükleniyor…" : "Raporu getir"}</button>
    </form>
    <p id="scope-report-help" className={styles.help}>Sadece kanonik public Slice ref kabul edilir. Bu yüzey kaydedilmiş rapor oluşturmaz.</p>
    {state.kind === "loading" ? <p className={styles.loading} role="status" aria-live="polite">Kanonik kapsam raporu yükleniyor…</p> : null}
    {state.kind === "session_required" ? <LocalSessionConnector idPrefix="scope-report-session" title="Kapsam raporu için yerel oturumu bağlayın" onVerify={onConnect} /> : null}
    {state.kind === "error" ? <p className={styles.error} role="alert">{state.message}</p> : null}
    {state.kind === "ready" && report ? <div className={styles.results}>
      <div className={styles.exports}><strong>{report.scope.sliceRef}</strong><span>Revizyon {report.scope.revisionNumber} · {report.scope.market.key} · {state.submitted!.start} → {state.submitted!.end} · {state.submitted!.granularity}</span><button type="button" disabled={exporting} onClick={() => void exportReport("csv")}>{exporting ? "Hazırlanıyor…" : "CSV indir"}</button><button type="button" disabled={exporting} onClick={() => void exportReport("xlsx")}>XLSX indir</button><button type="button" disabled={exporting} onClick={() => void load(state.submitted)}>JSON’u yenile</button></div>
      {exportError ? <p className={styles.error} role="alert">{exportError}</p> : null}
      <div className={styles.summary}><span><strong>{report.counts.included}</strong> kapsamda</span><span><strong>{report.counts.excluded}</strong> hariç</span><span><strong>{report.counts.missingMarket + report.counts.ambiguousMarket}</strong> pazar belirsizliği</span><span><strong>{report.coverage.filter((item) => item.sourceState !== "ready").length}</strong> kapsama uyarısı</span></div>
      <details open><summary>Public üyelik kanıtı ({report.rows.length})</summary><div className={styles.scroll} role="region" aria-label="Public üyelik kanıtı tablosu" tabIndex={0}><table><caption>Slice üyeliği ve public kanıt referansları</caption><thead><tr><th scope="col">Varlık</th><th scope="col">Seviye</th><th scope="col">Durum</th><th scope="col">Neden</th><th scope="col">Pazar kanıtı</th></tr></thead><tbody>{report.rows.map((row) => <tr key={`${row.entityRef}:${row.entityLevel}`}><td>{row.entityRef}</td><td>{row.entityLevel}</td><td>{row.membership}</td><td>{row.reason}</td><td>{row.marketEvidenceRefs.join(", ") || "—"}</td></tr>)}</tbody></table></div></details>
      <details open><summary>Pivot ve drill özeti ({report.pivot.length})</summary>{report.pivot.length ? <div className={styles.scroll} role="region" aria-label="Pivot ve drill özeti tablosu" tabIndex={0}><table><caption>Toplam ve drill satırları</caption><thead><tr><th scope="col">Dönem</th><th scope="col">Varlık</th><th scope="col">Hazır metrik</th><th scope="col">Harcama / aksiyon</th><th scope="col">Drill</th></tr></thead><tbody>{report.pivot.map((row) => { const rawIndex = report.rawMetrics.findIndex((metric) => metric.entityRef === row.drill.entityRef && metric.bucket === row.drill.bucket); const target = rawIndex >= 0 ? `scope-report-raw-${rawIndex}` : "scope-report-raw-metrics"; return <tr key={`${row.drill.entityRef}:${row.drill.bucket}`}><td>{row.bucket}</td><td>{row.entityRef}</td><td>{row.subtotal.availableMetricCount} / {row.subtotal.metricCount}</td><td>{row.ratios.spendPerAction ? `${row.ratios.spendPerAction.numeratorMinor} / ${row.ratios.spendPerAction.denominatorAction}` : "Uygun değil"}</td><td><a href={`#${target}`} aria-label={`${row.drill.entityRef} ${row.drill.bucket} ham metrik kanıtına git`}>Ham kanıta git</a></td></tr>; })}</tbody></table></div> : <p className={styles.empty}>Bu filtrede pivot satırı yok.</p>}</details>
      <details id="scope-report-raw-metrics" open><summary>Ham metrik kanıtı ({report.rawMetrics.length})</summary>{report.rawMetrics.length ? <div className={styles.scroll} role="region" aria-label="Ham metrik kanıtı tablosu" tabIndex={0}><table><caption>Uzun biçim, atıf korunmuş metrik kanıtı</caption><thead><tr><th scope="col">Tarih</th><th scope="col">Varlık</th><th scope="col">Metrik</th><th scope="col">Aksiyon</th><th scope="col">Değer</th><th scope="col">Kaynak</th></tr></thead><tbody>{report.rawMetrics.map((row, index) => <tr id={`scope-report-raw-${index}`} key={`${row.entityRef}:${row.entityLevel}:${row.bucket}:${row.date}:${row.metricKey}:${row.actionType ?? ""}:${row.attribution}:${row.currency ?? ""}:${row.availability}:${index}`}><td>{row.date}</td><td>{row.entityRef}</td><td>{row.metricKey}</td><td>{row.actionType ?? "—"}</td><td>{row.valueMinor ?? row.valueDecimal ?? "—"} {row.currency ?? ""}</td><td>{row.attribution} · {row.availability}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>Bu filtrede ham metrik kanıtı yok.</p>}</details>
      <details open><summary>Kapsama ({report.coverage.length})</summary>{report.coverage.length ? <ul className={styles.coverage}>{report.coverage.map((item) => <li key={`${item.entityRef}:${item.actionType}`}><strong>{item.entityRef}</strong> · {item.actionType} · {item.sourceState}{item.missingDays.length ? ` · eksik: ${item.missingDays.join(", ")}` : ""}</li>)}</ul> : <p className={styles.empty}>Seçilen aksiyon için kapsama kaydı yok.</p>}</details>
      {membership.length ? <p className={styles.context}>Kılavuz, karar ve denetim bağlantıları yalnız bu yanıtta kanonik public ref verilirse gösterilir; mevcut rapor bunları taşımıyor.</p> : null}
    </div> : state.kind === "idle" ? <p className={styles.empty}>Bir Slice ref ve dönem seçerek doğrulanmış raporu getirin.</p> : null}
  </section>;
}
