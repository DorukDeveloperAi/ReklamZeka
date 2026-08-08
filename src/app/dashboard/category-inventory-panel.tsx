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
type ArchiveImpact = Readonly<{ contractVersion: string; target: Readonly<{ kind: "dimension" | "definition";
  ref: string; label: string; version: number }>; exactBlockers: Readonly<Record<string, number>>;
  historicalImpact: Readonly<Record<string, number>>; invalidationPlan: Readonly<{ categoryResolutionComponents: number;
  contextsNeedingInvalidation: number }>; coverage: Readonly<{ complete: false; partialOrUnknown: readonly string[] }>;
  disposition: "blocked" | "review_required"; archiveAllowed: false;
  authority: Readonly<{ canArchive: false; canAssign: false; canAuthorizeAction: false; canWriteMeta: false }> }>;
type EffectiveHealth = Readonly<{ contractVersion: "category-effective-health/1.0.0"; status: "complete";
  evaluationBasis: "hierarchy_path"; limits: Readonly<{ maxHierarchyPaths: number; maxDimensions: number }>;
  counts: Readonly<{ dimensions: number; hierarchyPaths: number; evaluations: number; applied: number;
    unmatched: number; parkedConflict: number }>; reasonBreakdown: readonly Readonly<{ reason: string; count: number }>[];
  dimensions: readonly Readonly<{ dimension: Readonly<{ key: string; ref: string }>;
    evaluationBasis: "hierarchy_path"; counts: Readonly<{ total: number; applied: number; unmatched: number;
      parkedConflict: number }>; reasonBreakdown: readonly Readonly<{ reason: string; count: number }>[] }> [];
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
function parseImpact(value: unknown): ArchiveImpact {
  if (!object(value) || value.contractVersion !== "category-archive-impact/1.0.0" || !object(value.target)
    || !["dimension", "definition"].includes(String(value.target.kind)) || typeof value.target.ref !== "string"
    || typeof value.target.label !== "string" || !nonNegative(value.target.version) || !object(value.exactBlockers)
    || !Object.values(value.exactBlockers).every(nonNegative) || !object(value.historicalImpact)
    || !Object.values(value.historicalImpact).every(nonNegative) || !object(value.invalidationPlan)
    || !nonNegative(value.invalidationPlan.categoryResolutionComponents)
    || !nonNegative(value.invalidationPlan.contextsNeedingInvalidation) || !object(value.coverage)
    || value.coverage.complete !== false || !Array.isArray(value.coverage.partialOrUnknown)
    || !value.coverage.partialOrUnknown.every((item) => typeof item === "string")
    || !["blocked", "review_required"].includes(String(value.disposition)) || value.archiveAllowed !== false
    || !object(value.authority) || value.authority.canArchive !== false || value.authority.canAssign !== false
    || value.authority.canAuthorizeAction !== false || value.authority.canWriteMeta !== false) {
    throw new InventoryError("unsafe_response", "Arşiv etki kaynağı güvenli sözleşmeyi döndürmedi.");
  }
  return value as unknown as ArchiveImpact;
}
function parseEffectiveHealth(value: unknown): EffectiveHealth {
  if (!object(value)) throw new InventoryError("unsafe_response", "Effective kategori kaynağı güvenli sözleşmeyi döndürmedi.");
  const limits = value.limits; const counts = value.counts; const dimensions = value.dimensions; const authority = value.authority;
  if (value.contractVersion !== "category-effective-health/1.0.0" || value.status !== "complete"
    || value.evaluationBasis !== "hierarchy_path" || !object(limits) || !object(counts)
    || !["maxHierarchyPaths", "maxDimensions"].every((key) => nonNegative(limits[key]))
    || !["dimensions", "hierarchyPaths", "evaluations", "applied", "unmatched", "parkedConflict"]
      .every((key) => nonNegative(counts[key]))
    || counts.evaluations !== Number(counts.applied) + Number(counts.unmatched) + Number(counts.parkedConflict)
    || !Array.isArray(value.reasonBreakdown) || !value.reasonBreakdown.every((item) => object(item)
      && typeof item.reason === "string" && nonNegative(item.count))
    || !Array.isArray(dimensions) || dimensions.length !== counts.dimensions || !dimensions.every((item) => object(item)
      && object(item.dimension) && typeof item.dimension.key === "string" && typeof item.dimension.ref === "string"
      && item.evaluationBasis === "hierarchy_path" && object(item.counts)
      && ["total", "applied", "unmatched", "parkedConflict"].every((key) => nonNegative((item.counts as Record<string, unknown>)[key]))
      && item.counts.total === Number(item.counts.applied) + Number(item.counts.unmatched) + Number(item.counts.parkedConflict)
      && Array.isArray(item.reasonBreakdown) && item.reasonBreakdown.every((reason) => object(reason)
        && typeof reason.reason === "string" && nonNegative(reason.count)))
    || !object(authority) || authority.canAssign !== false || authority.canWriteMeta !== false
    || authority.canAuthorizeAction !== false) {
    throw new InventoryError("unsafe_response", "Effective kategori kaynağı güvenli sözleşmeyi döndürmedi.");
  }
  return value as unknown as EffectiveHealth;
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
  const [impact, setImpact] = useState<ArchiveImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [effectiveHealth, setEffectiveHealth] = useState<EffectiveHealth | null>(null);
  const [effectiveHealthError, setEffectiveHealthError] = useState<string | null>(null);
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
      setEffectiveHealthError(null);
      try {
        const healthResponse = await fetch("/api/category-effective-health", { cache: "no-store", credentials: "same-origin",
          headers: { "X-ReklamZeka-Intent": "category-effective-health-read" } });
        let healthPayload: unknown = null; try { healthPayload = await healthResponse.json(); } catch { /* redacted below */ }
        if (!healthResponse.ok) {
          const found = object(healthPayload) && object(healthPayload.error) ? healthPayload.error : null;
          throw new InventoryError(found && typeof found.code === "string" ? found.code : "request_failed",
            found && typeof found.message === "string" ? found.message : "Effective kategori sağlığı alınamadı.");
        }
        setEffectiveHealth(parseEffectiveHealth(healthPayload));
      } catch (reason) {
        setEffectiveHealth(null);
        setEffectiveHealthError(reason instanceof Error ? reason.message : "Effective kategori sağlığı alınamadı.");
      }
    } catch (reason) {
      setSessionRequired(reason instanceof InventoryError && reason.code === "local_session_required");
      setError(reason instanceof Error ? reason.message : "Kategori envanteri alınamadı.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const previewImpact = useCallback(async (targetRef: string) => {
    setImpactLoading(true); setImpactError(null);
    try {
      const response = await fetch(`/api/category-archive-impact?view=archive-impact&targetRef=${encodeURIComponent(targetRef)}`,
        { cache: "no-store", credentials: "same-origin", headers: {
          "X-ReklamZeka-Intent": "category-archive-impact-preview" } });
      let payload: unknown = null; try { payload = await response.json(); } catch { /* redacted below */ }
      if (!response.ok) {
        const found = object(payload) && object(payload.error) ? payload.error : null;
        throw new InventoryError(found && typeof found.code === "string" ? found.code : "request_failed",
          found && typeof found.message === "string" ? found.message : "Arşiv etkisi alınamadı.");
      }
      setImpact(parseImpact(payload));
    } catch (reason) { setImpactError(reason instanceof Error ? reason.message : "Arşiv etkisi alınamadı."); }
    finally { setImpactLoading(false); }
  }, []);

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
    {effectiveHealth ? <section className={styles.categoryHealth} data-clean={effectiveHealth.counts.parkedConflict === 0 ? "true" : undefined}>
      <strong>Effective kategori sağlığı · hierarchy path bazlı</strong>
      <div><span>{number(effectiveHealth.counts.hierarchyPaths)} canlı yol</span><span>{number(effectiveHealth.counts.evaluations)} değerlendirme</span><span>{number(effectiveHealth.counts.applied)} uygulanmış</span><span>{number(effectiveHealth.counts.unmatched)} eşleşmemiş</span><span>{number(effectiveHealth.counts.parkedConflict)} park edilmiş çakışma</span></div>
      {effectiveHealth.reasonBreakdown.some((item) => item.count > 0) ? <p>Reason dağılımı: {effectiveHealth.reasonBreakdown.filter((item) => item.count > 0).map((item) => `${item.reason} · ${number(item.count)}`).join("  •  ")}</p> : null}
      <p>Yeniden kullanılan kreatifler her kampanya → reklam seti → reklam bağlamında ayrı değerlendirilir. Sınır: {number(effectiveHealth.limits.maxHierarchyPaths)} yol / {number(effectiveHealth.limits.maxDimensions)} boyut; aşımda kısmi sonuç gösterilmez.</p>
    </section> : effectiveHealthError ? <section className={styles.categoryHealth} role="status"><strong>Effective tarama tamamlanamadı</strong><span>{effectiveHealthError}</span></section> : null}
    {impactError ? <section className={styles.guidanceInlineError} role="alert"><span>{impactError}</span><button type="button" onClick={() => setImpactError(null)}>Kapat</button></section> : null}
    {impact ? <section className={styles.categoryImpact} aria-label={`${impact.target.label} arşiv etki önizlemesi`}>
      <header><div><span>ARŞİV ETKİ ÖNİZLEMESİ · İŞLEM YAPILMADI</span><h2>{impact.target.label}</h2><p>{impact.target.kind === "dimension" ? "Boyut" : "Tanım"} · v{impact.target.version}</p></div><button type="button" onClick={() => setImpact(null)}>Kapat</button></header>
      <div className={styles.categoryImpactGrid}><article><strong>Kesin engeller</strong>{Object.entries(impact.exactBlockers).filter(([, value]) => value > 0).map(([key, value]) => <p key={key}><span>{key}</span><b>{number(value)}</b></p>)}{Object.values(impact.exactBlockers).every((value) => value === 0) ? <p><span>Kesin engel</span><b>0</b></p> : null}</article><article><strong>Tarihsel etki</strong>{Object.entries(impact.historicalImpact).map(([key, value]) => <p key={key}><span>{key}</span><b>{number(value)}</b></p>)}</article><article><strong>Gerekli invalidation</strong><p><span>Context</span><b>{number(impact.invalidationPlan.contextsNeedingInvalidation)}</b></p><p><span>Component</span><b>{number(impact.invalidationPlan.categoryResolutionComponents)}</b></p></article></div>
      <footer><p>Kapsama henüz tam değil: {impact.coverage.partialOrUnknown.join(" · ")}. Bu nedenle arşiv yetkisi kapalıdır.</p><span>{impact.disposition === "blocked" ? "ENGELLİ" : "İNCELEME GEREKLİ"}</span></footer>
    </section> : null}
    <section className={`${styles.panel} ${styles.categoryRegistry}`}>
      <header className={styles.panelHeader}><div><span className={styles.kicker}>DOĞRUDAN KAPSAMA</span><h2>Boyutlar ve tanımlar</h2></div><span>{snapshot.contractVersion}</span></header>
      {!snapshot.dimensions.length ? <div className={styles.categoryEmpty}><strong>Henüz aktif iç kategori yok</strong><p>İlk registry tanımları ayrı, denetimli authoring diliminde eklenecek.</p></div> : snapshot.dimensions.map((dimension) => <details key={dimension.ref} open>
        <summary><div><strong>{dimension.name}</strong><small>{dimension.key} · v{dimension.version} · {dimension.cardinality === "single" ? "tek seçim" : "çoklu seçim"}</small></div><span>{dimension.definitions.length} tanım</span></summary>
        <div className={styles.categoryDetail}>
          <div className={styles.categoryDimensionActions}>{dimension.description ? <p>{dimension.description}</p> : <span /> }<button type="button" disabled={impactLoading} onClick={() => void previewImpact(dimension.ref)}>{impactLoading ? "Hesaplanıyor" : "Boyut arşiv etkisi"}</button></div>
          <div className={styles.categoryCoverage}>{dimension.coverage.map((coverage) => <article key={coverage.level}><span>{levelLabel(coverage.level)}</span><strong>{ratio(coverage.coverageBasisPoints)}</strong><small>{number(coverage.directlyAssignedEntities)} / {number(coverage.totalEntities)} doğrudan · {number(coverage.unmatchedEntities)} eşleşmemiş{coverage.deniedAssignments ? ` · ${number(coverage.deniedAssignments)} deny` : ""}</small></article>)}</div>
          <div className={styles.categoryDefinitions}>{dimension.definitions.map((definition) => <article key={definition.ref}><div><strong>{definition.label}</strong><small>{definition.key} · v{definition.version}</small></div><p>{definition.description ?? "Açıklama eklenmemiş."}</p><dl><div><dt>Ortalama güven</dt><dd>{confidence(definition.confidence.averageBasisPoints)}</dd></div><div><dt>En düşük</dt><dd>{confidence(definition.confidence.minimumBasisPoints)}</dd></div><div><dt>Eşik altı</dt><dd>{number(definition.confidence.belowReviewThreshold)}</dd></div><div><dt>Kanıt kaydı</dt><dd>{number(definition.evidenceHealth.evidenceRecords)}</dd></div></dl>{definition.evidenceHealth.kinds.length ? <p className={styles.categoryEvidenceKinds}>{definition.evidenceHealth.kinds.map((item) => `${item.kind} · ${number(item.count)}`).join("  •  ")}</p> : null}<footer><span>{number(definition.assignments.total)} atama</span><span>{number(definition.assignments.manualLocked)} kilit</span><span>{number(definition.assignments.manual)} manuel · {number(definition.assignments.agent)} agent · {number(definition.assignments.deterministic)} deterministik</span>{definition.evidenceHealth.invalidEvidenceAssignments ? <span>{number(definition.evidenceHealth.invalidEvidenceAssignments)} geçersiz kanıt</span> : null}<button type="button" disabled={impactLoading} onClick={() => void previewImpact(definition.ref)}>Arşiv etkisi</button></footer></article>)}</div>
        </div>
      </details>)}
    </section>
  </>;
}
