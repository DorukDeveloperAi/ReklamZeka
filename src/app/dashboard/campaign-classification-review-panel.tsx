"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./operating-dashboard.module.css";
import type { CategoryAssignmentHandoff } from "./category-inventory-panel";
import { LocalSessionConnector } from "./local-session-connector";

type Facet = Readonly<{ facet: string; state: "assigned" | "missing" | "conflict" | "not_configured"; values: readonly string[]; evidenceCount: number; reasonCodes: readonly string[] }>;
type Entry = Readonly<{ campaignRef: string; name: string; accountName: string; fetchedAt: string; facets: readonly Facet[]; reviewRequired: boolean; reasonCodes: readonly string[] }>;
type Snapshot = Readonly<{ version: "campaign-classification-review/1.0.0"; entries: readonly Entry[]; summary: Readonly<{ campaigns: number; reviewRequired: number }>; authority: Readonly<{ canAssign: false; canPublish: false; canAuthorizeAction: false; canWriteMeta: false }> }>;

const labels: Record<string, string> = { market: "Pazar", service: "Hizmet", family: "Kampanya ailesi", geo: "Ülke / bölge", audience: "Hedef kitle", platform: "Platform" };
const ENTITY_REF = /^category_entity_[a-f0-9]{24}$/;
export const CLASSIFICATION_REVIEW_PAGE_SIZE = 24;
type ReviewFilter = "all" | "review_required" | "conflict" | "missing" | "not_configured";
const handoffFacet = (value: string): value is CategoryAssignmentHandoff["facet"] => value === "market" || value === "service" || value === "family";
function normal(value: string): string { return value.trim().toLocaleLowerCase("tr-TR"); }

export function filterCampaignClassificationReviewEntries(entries: readonly Entry[], input: Readonly<{ query: string; filter: ReviewFilter }>): readonly Entry[] {
  const query = normal(input.query);
  return entries.filter((entry) => {
    const matchesFilter = input.filter === "all" || input.filter === "review_required" && entry.reviewRequired
      || ["conflict", "missing", "not_configured"].includes(input.filter) && entry.facets.some((facet) => facet.state === input.filter);
    const searchable = [entry.name, entry.accountName, ...entry.reasonCodes,
      ...entry.facets.flatMap((facet) => [labels[facet.facet] ?? facet.facet, ...facet.values, ...facet.reasonCodes])];
    return matchesFilter && (!query || searchable.some((value) => normal(value).includes(query)));
  });
}

export function requiresInitialCategoryCatalog(entries: readonly Entry[]): boolean {
  return entries.length > 0 && entries.every((entry) => ["market", "service", "family"].every((facet) => entry.facets.find((item) => item.facet === facet)?.state === "not_configured"));
}

function parse(value: unknown): Snapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== "campaign-classification-review/1.0.0" || !Array.isArray(candidate.entries)
    || !candidate.entries.every((entry) => entry && typeof entry === "object" && ENTITY_REF.test((entry as Record<string, unknown>).campaignRef as string))
    || !candidate.summary || !candidate.authority
    || (candidate.authority as Record<string, unknown>).canAssign !== false
    || (candidate.authority as Record<string, unknown>).canPublish !== false
    || (candidate.authority as Record<string, unknown>).canAuthorizeAction !== false
    || (candidate.authority as Record<string, unknown>).canWriteMeta !== false) return null;
  return candidate as unknown as Snapshot;
}

export function CampaignClassificationReviewPanel(props: Readonly<{ onPrepareAssignment?(handoff: CategoryAssignmentHandoff): void; onOpenCategorySetup?(): void }> = {}) {
  const [state, setState] = useState<"loading" | "ready" | "session_required" | "unavailable">("loading");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("review_required");
  const [page, setPage] = useState(0);
  const refresh = useCallback(async (): Promise<boolean> => {
    setState("loading");
    try {
      const response = await fetch("/api/campaign-classification-review", { cache: "no-store", credentials: "same-origin", headers: { "x-reklamzeka-intent": "campaign-classification-review-read" } });
      const parsed = response.ok ? parse(await response.json()) : null;
      setSnapshot(parsed);
      setState(parsed ? "ready" : response.status === 401 || response.status === 403 ? "session_required" : "unavailable");
      return Boolean(parsed);
    } catch { setSnapshot(null); setState("unavailable"); return false; }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setPage(0); }, [query, filter]);
  const filteredEntries = useMemo(() => snapshot ? filterCampaignClassificationReviewEntries(snapshot.entries, { query, filter }) : [], [snapshot, query, filter]);
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / CLASSIFICATION_REVIEW_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleEntries = filteredEntries.slice(safePage * CLASSIFICATION_REVIEW_PAGE_SIZE, (safePage + 1) * CLASSIFICATION_REVIEW_PAGE_SIZE);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);
  const beginManualAssignment = (entry: Entry, facet: string) => {
    if (!handoffFacet(facet)) return;
    const handoff = { campaignRef: entry.campaignRef, facet } as const;
    if (props.onPrepareAssignment) props.onPrepareAssignment(handoff);
    else window.dispatchEvent(new CustomEvent<CategoryAssignmentHandoff>("reklamzeka:category-assignment-handoff", { detail: handoff }));
  };
  return <section className={styles.panel}>
    <header><span className={styles.kicker}>CANONICAL REVIEW QUEUE</span><h2>Kampanya künye inceleme kuyruğu</h2><p>Yalnız Meta aynası ve mevcut kategori kayıtları okunur. İsim/creative’den otomatik künye çıkarımı veya atama yapılmaz.</p></header>
    {state === "loading" ? <p>Kanıt zinciri okunuyor…</p> : null}
    {state === "session_required" ? <div role="alert"><p>İnceleme kuyruğu için doğrulanmış yerel dashboard oturumu gerekli.</p><LocalSessionConnector title="Künye inceleme kaynağını bağlayın" onVerify={refresh} /></div> : null}
    {state === "unavailable" || !snapshot ? state !== "loading" ? <p>Güvenli inceleme kaynağı şu anda kullanılamıyor.</p> : null : <>
      <p><strong>{snapshot.summary.reviewRequired}</strong> / {snapshot.summary.campaigns} kampanya insan incelemesi bekliyor.</p>
      {requiresInitialCategoryCatalog(snapshot.entries) ? <section className={styles.categorySafety} role="status"><strong>Önce kategori dilini tanımlayın</strong><p>Pazar, hizmet ve kampanya ailesi için henüz aktif kategori boyutu yok. Başlangıç playbook’u yalnız önerilen başlangıç katalogunu önizler; kayıt ancak sizin açık onayınızla yapılır.</p>{props.onOpenCategorySetup ? <button type="button" onClick={props.onOpenCategorySetup}>Kategori başlangıç planını aç</button> : null}</section> : null}
      <div className={styles.classificationFilters}><label>Bul<input type="search" value={query} placeholder="Kampanya, hesap veya inceleme sinyali…" onChange={(event) => setQuery(event.target.value)} /></label><label>İnceleme durumu<select value={filter} onChange={(event) => setFilter(event.target.value as ReviewFilter)}><option value="review_required">İnceleme gerekli</option><option value="all">Tümü</option><option value="conflict">Çelişki</option><option value="missing">Eksik</option><option value="not_configured">Tanımsız boyut</option></select></label><small>{filteredEntries.length} sonuç · kaynak yalnız kanonik ayna ve kategori kayıtlarıdır</small></div>
      {visibleEntries.length ? <div className={styles.campaignGrid}>{visibleEntries.map((entry) => <article key={entry.campaignRef} className={styles.campaignCard}><header><strong>{entry.name}</strong><small>{entry.accountName} · {entry.reviewRequired ? "İnceleme gerekli" : "Kayıtlı"}</small></header><dl>{entry.facets.map((item) => <div key={item.facet}><dt>{labels[item.facet] ?? item.facet}</dt><dd>{item.state === "assigned" ? item.values.join(", ") : item.state === "conflict" ? `Çelişki: ${item.reasonCodes.join(", ")}` : item.state === "not_configured" ? "Kategori boyutu tanımlı değil" : "Eksik"}<small> · kanıt: {item.evidenceCount}</small>{item.state === "missing" && handoffFacet(item.facet) ? <button type="button" onClick={() => beginManualAssignment(entry, item.facet)}>Manuel atamayı hazırla</button> : null}</dd></div>)}</dl>{entry.reasonCodes.length ? <small>İnceleme sinyali: {entry.reasonCodes.join(", ")}</small> : null}</article>)}</div> : <p>Bu arama ve inceleme filtresinde kampanya yok. Başka kaynakla doldurulmadı.</p>}
      {pageCount > 1 ? <nav className={styles.classificationPagination} aria-label="Künye inceleme sayfaları"><button type="button" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Önceki</button><span>{safePage + 1} / {pageCount} · {CLASSIFICATION_REVIEW_PAGE_SIZE} satır</span><button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Sonraki</button></nav> : null}
      <footer><small>“Manuel atamayı hazırla” yalnız mevcut guarded authoring formunu pazar/hizmet/aile ve aktif kampanya hedefiyle ön-doldurur. Tanımı siz seçer, atamayı aynı formda onaylarsınız; bu kuyruk policy, action veya Meta write üretmez.</small><button type="button" onClick={() => void refresh()}>Yenile</button></footer>
    </>}
  </section>;
}
