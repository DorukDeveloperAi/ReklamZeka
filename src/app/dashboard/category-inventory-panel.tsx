"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./operating-dashboard.module.css";

type Level = "campaign" | "ad_set" | "ad" | "creative";
type Definition = Readonly<{ ref: string; key: string; label: string; description: string | null; version: number;
  assignments: Readonly<{ total: number; manualLocked: number; manual: number; agent: number;
    deterministic: number; add: number; override: number; deny: number }>;
  confidence: Readonly<{ minimumBasisPoints: number | null; averageBasisPoints: number | null;
    belowReviewThreshold: number }>;
  evidenceHealth: Readonly<{ evidenceRecords: number; assignmentsWithObservedAt: number;
    invalidEvidenceAssignments: number; kinds: readonly Readonly<{ kind: string; count: number }>[] }> }>;
type Dimension = Readonly<{ ref: string; key: string; name: string; description: string | null;
  cardinality: "single" | "multi"; allowedEntityLevels: readonly Level[]; version: number;
  definitions: readonly Definition[]; coverage: readonly Readonly<{ level: Level; totalEntities: number;
    directlyAssignedEntities: number; unmatchedEntities: number; coverageBasisPoints: number | null;
    deniedAssignments: number }>[] }>;
type Snapshot = Readonly<{ contractVersion: string; summary: Readonly<{ dimensions: number; definitions: number;
  directlyAssignedEntities: number; manualLocks: number; lowConfidenceAssignments: number;
  invalidEvidenceAssignments: number }>; classificationPolicy: Readonly<{ version: string;
  minimumTrustedConfidenceBasisPoints: number; purpose: "review_signal_only" }>;
  health: Readonly<{ dimensionsWithoutDefinitions: number;
  definitionsWithoutDirectAssignments: number; staleTargetAssignments: number;
  assignmentsUnderArchivedRegistry: number }>; dimensions: readonly Dimension[];
  authority: Readonly<{ canAssign: false; canWriteMeta: false; canAuthorizeAction: false }> }>;

class InventoryError extends Error { constructor(readonly code: string, message: string) { super(message); } }
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function nonNegative(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function definition(value: unknown): value is Definition {
  if (!object(value) || typeof value.ref !== "string" || typeof value.key !== "string"
    || typeof value.label !== "string" || !(value.description === null || typeof value.description === "string")
    || !nonNegative(value.version) || value.version < 1 || !object(value.assignments)) return false;
  const assignments = value.assignments;
  return ["total", "manualLocked", "manual", "agent", "deterministic", "add", "override", "deny"]
    .every((key) => nonNegative(assignments[key])) && object(value.confidence)
    && (value.confidence.minimumBasisPoints === null || nonNegative(value.confidence.minimumBasisPoints))
    && (value.confidence.averageBasisPoints === null || nonNegative(value.confidence.averageBasisPoints))
    && nonNegative(value.confidence.belowReviewThreshold) && object(value.evidenceHealth)
    && nonNegative(value.evidenceHealth.evidenceRecords) && nonNegative(value.evidenceHealth.assignmentsWithObservedAt)
    && nonNegative(value.evidenceHealth.invalidEvidenceAssignments) && Array.isArray(value.evidenceHealth.kinds)
    && value.evidenceHealth.kinds.every((item) => object(item) && typeof item.kind === "string" && nonNegative(item.count));
}
function dimension(value: unknown): value is Dimension {
  if (!object(value) || typeof value.ref !== "string" || typeof value.key !== "string" || typeof value.name !== "string"
    || !(value.description === null || typeof value.description === "string") || !["single", "multi"].includes(String(value.cardinality))
    || !nonNegative(value.version) || value.version < 1 || !Array.isArray(value.allowedEntityLevels)
    || !value.allowedEntityLevels.every((level) => ["campaign", "ad_set", "ad", "creative"].includes(String(level)))
    || !Array.isArray(value.definitions) || !value.definitions.every(definition) || !Array.isArray(value.coverage)) return false;
  return value.coverage.every((item) => object(item) && ["campaign", "ad_set", "ad", "creative"].includes(String(item.level))
    && nonNegative(item.totalEntities) && nonNegative(item.directlyAssignedEntities) && nonNegative(item.unmatchedEntities)
    && (item.coverageBasisPoints === null || nonNegative(item.coverageBasisPoints) && item.coverageBasisPoints <= 10_000)
    && nonNegative(item.deniedAssignments));
}
function parse(value: unknown): Snapshot {
  if (!object(value) || value.contractVersion !== "category-inventory/1.1.0"
    || !object(value.summary) || !object(value.health) || !object(value.classificationPolicy)) {
    throw new InventoryError("unsafe_response", "Kategori kaynağı güvenli sözleşmeyi döndürmedi.");
  }
  const summary = value.summary; const health = value.health;
  if (!["dimensions", "definitions", "directlyAssignedEntities", "manualLocks", "lowConfidenceAssignments",
    "invalidEvidenceAssignments"].every((key) => nonNegative(summary[key]))
    || !["dimensionsWithoutDefinitions", "definitionsWithoutDirectAssignments",
      "staleTargetAssignments", "assignmentsUnderArchivedRegistry"].every((key) => nonNegative(health[key]))
    || typeof value.classificationPolicy.version !== "string"
    || !nonNegative(value.classificationPolicy.minimumTrustedConfidenceBasisPoints)
    || value.classificationPolicy.purpose !== "review_signal_only"
    || !Array.isArray(value.dimensions) || !value.dimensions.every(dimension) || !object(value.authority)
    || value.authority.canAssign !== false || value.authority.canWriteMeta !== false
    || value.authority.canAuthorizeAction !== false) throw new InventoryError("unsafe_response", "Kategori kaynağı güvenli sözleşmeyi döndürmedi.");
  return value as unknown as Snapshot;
}
function levelLabel(level: Level) { return level === "campaign" ? "Kampanya" : level === "ad_set" ? "Reklam seti" : level === "ad" ? "Reklam" : "Kreatif"; }
function number(value: number) { return new Intl.NumberFormat("tr-TR").format(value); }
function ratio(value: number | null) { return value === null ? "Veri yok" : `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(value / 100)}`; }
function confidence(value: number | null) { return value === null ? "Veri yok" : `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(value / 100)}`; }

export function CategoryInventoryPanel(props: Readonly<{ onOpenSession?: () => void }> = {}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionRequired, setSessionRequired] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null); setSessionRequired(false);
    try {
      const response = await fetch("/api/category-inventory", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "category-inventory-read" } });
      let payload: unknown = null; try { payload = await response.json(); } catch { /* redacted below */ }
      if (!response.ok) {
        const found = object(payload) && object(payload.error) ? payload.error : null;
        const code = found && typeof found.code === "string" ? found.code : "request_failed";
        const message = found && typeof found.message === "string" ? found.message : "Kategori envanteri alınamadı.";
        throw new InventoryError(code, message);
      }
      setSnapshot(parse(payload));
    } catch (reason) {
      setSessionRequired(reason instanceof InventoryError && reason.code === "local_session_required");
      setError(reason instanceof Error ? reason.message : "Kategori envanteri alınamadı.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  if (loading && !snapshot) return <section className={`${styles.panel} ${styles.categoryState}`} aria-busy="true"><strong>İÇ KATEGORİLER</strong><h2>Kategori envanteri yükleniyor</h2><p>Aktif tanımlar ve doğrudan atama kapsamı okunuyor.</p></section>;
  if (error && !snapshot) return <section className={`${styles.panel} ${styles.categoryState}`} role="alert"><strong>{sessionRequired ? "YEREL OTURUM GEREKLİ" : "BAĞLANTI KURULAMADI"}</strong><h2>{sessionRequired ? "Dashboard oturumunu bağlayın" : "Kategori kaynağı kullanılamıyor"}</h2><p>{error}</p>{sessionRequired && props.onOpenSession ? <button type="button" onClick={props.onOpenSession}>Decision Room’da oturumu bağla</button> : <button type="button" onClick={() => void refresh()}>Yeniden dene</button>}</section>;
  if (!snapshot) return null;
  const healthTotal = snapshot.health.dimensionsWithoutDefinitions + snapshot.health.definitionsWithoutDirectAssignments
    + snapshot.health.staleTargetAssignments + snapshot.health.assignmentsUnderArchivedRegistry;
  return <>
    <section className={styles.pageHero}><div><span className={styles.kicker}>CATEGORY REGISTRY</span><h1>İç kategori diliniz, Meta hiyerarşisiyle birlikte görünür.</h1><p>Bu ekran etkin tanımları ve yalnız doğrudan atama kapsamını gösterir. Kalıtılmış “effective context” değildir ve değişiklik yetkisi taşımaz.</p></div><button className={styles.primaryButton} type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Yükleniyor" : "Envanteri yenile"}</button></section>
    <section className={styles.categorySafety}><span>Salt okunur</span><p><strong>Atama ve Meta write kapalı.</strong> Public-safe referanslar kullanılır; teknik Meta ID’leri bu yanıta girmez.</p></section>
    <div className={styles.metaMetricGrid}>
      <article><span>Aktif boyut</span><strong>{number(snapshot.summary.dimensions)}</strong><small>Kategori eksenleri</small></article>
      <article><span>Aktif tanım</span><strong>{number(snapshot.summary.definitions)}</strong><small>Seçilebilir iç değerler</small></article>
      <article><span>Doğrudan kapsanan</span><strong>{number(snapshot.summary.directlyAssignedEntities)}</strong><small>Boyut bazında tekil toplam</small></article>
      <article><span>Manuel kilit</span><strong>{number(snapshot.summary.manualLocks)}</strong><small>Agent tarafından aşılmaz</small></article>
    </div>
    {healthTotal ? <section className={styles.categoryHealth} role="status"><strong>Kayıt sağlığı · {number(healthTotal)} inceleme noktası</strong><div><span>Tanımsız boyut {number(snapshot.health.dimensionsWithoutDefinitions)}</span><span>Atamasız tanım {number(snapshot.health.definitionsWithoutDirectAssignments)}</span><span>Kaybolmuş hedef {number(snapshot.health.staleTargetAssignments)}</span><span>Arşivli kayda bağlı {number(snapshot.health.assignmentsUnderArchivedRegistry)}</span></div></section> : <section className={styles.categoryHealth} data-clean="true"><strong>Kayıt sağlığı temiz</strong><span>Aktif registry için yapısal uyarı bulunmadı.</span></section>}
    <section className={styles.categoryReviewSignal}><div><strong>Kanıt ve güven inceleme sinyali</strong><p>Eşik {ratio(snapshot.classificationPolicy.minimumTrustedConfidenceBasisPoints)} · {snapshot.classificationPolicy.version}. Bu eşik otomatik karar veya kategori değişikliği üretmez.</p></div><span>{number(snapshot.summary.lowConfidenceAssignments)} düşük güven</span><span>{number(snapshot.summary.invalidEvidenceAssignments)} geçersiz kanıt</span></section>
    <section className={`${styles.panel} ${styles.categoryRegistry}`}>
      <header className={styles.panelHeader}><div><span className={styles.kicker}>DOĞRUDAN KAPSAMA</span><h2>Boyutlar ve tanımlar</h2></div><span>{snapshot.contractVersion}</span></header>
      {!snapshot.dimensions.length ? <div className={styles.categoryEmpty}><strong>Henüz aktif iç kategori yok</strong><p>İlk registry tanımları ayrı, denetimli authoring diliminde eklenecek.</p></div> : snapshot.dimensions.map((dimension) => <details key={dimension.ref} open>
        <summary><div><strong>{dimension.name}</strong><small>{dimension.key} · v{dimension.version} · {dimension.cardinality === "single" ? "tek seçim" : "çoklu seçim"}</small></div><span>{dimension.definitions.length} tanım</span></summary>
        <div className={styles.categoryDetail}>
          {dimension.description ? <p>{dimension.description}</p> : null}
          <div className={styles.categoryCoverage}>{dimension.coverage.map((coverage) => <article key={coverage.level}><span>{levelLabel(coverage.level)}</span><strong>{ratio(coverage.coverageBasisPoints)}</strong><small>{number(coverage.directlyAssignedEntities)} / {number(coverage.totalEntities)} doğrudan · {number(coverage.unmatchedEntities)} eşleşmemiş{coverage.deniedAssignments ? ` · ${number(coverage.deniedAssignments)} deny` : ""}</small></article>)}</div>
          <div className={styles.categoryDefinitions}>{dimension.definitions.map((definition) => <article key={definition.ref}><div><strong>{definition.label}</strong><small>{definition.key} · v{definition.version}</small></div><p>{definition.description ?? "Açıklama eklenmemiş."}</p><dl><div><dt>Ortalama güven</dt><dd>{confidence(definition.confidence.averageBasisPoints)}</dd></div><div><dt>En düşük</dt><dd>{confidence(definition.confidence.minimumBasisPoints)}</dd></div><div><dt>Eşik altı</dt><dd>{number(definition.confidence.belowReviewThreshold)}</dd></div><div><dt>Kanıt kaydı</dt><dd>{number(definition.evidenceHealth.evidenceRecords)}</dd></div></dl>{definition.evidenceHealth.kinds.length ? <p className={styles.categoryEvidenceKinds}>{definition.evidenceHealth.kinds.map((item) => `${item.kind} · ${number(item.count)}`).join("  •  ")}</p> : null}<footer><span>{number(definition.assignments.total)} atama</span><span>{number(definition.assignments.manualLocked)} kilit</span><span>{number(definition.assignments.manual)} manuel · {number(definition.assignments.agent)} agent · {number(definition.assignments.deterministic)} deterministik</span>{definition.evidenceHealth.invalidEvidenceAssignments ? <span>{number(definition.evidenceHealth.invalidEvidenceAssignments)} geçersiz kanıt</span> : null}</footer></article>)}</div>
        </div>
      </details>)}
    </section>
  </>;
}
