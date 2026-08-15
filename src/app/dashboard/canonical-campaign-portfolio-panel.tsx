"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MetaReadMirrorCampaign, MetaReadMirrorProjection } from "@/domain/meta/read-mirror-projection";
import { CampaignPerformanceEvidencePanel } from "./campaign-performance-evidence-panel";
import styles from "./operating-dashboard.module.css";

export const CANONICAL_PORTFOLIO_PAGE_SIZE = 24;

export type CanonicalCampaignPortfolioEntry = Readonly<{
  campaignRef: string;
  name: string;
  objective: string | null;
  status: string | null;
  accountName: string;
  currency: string;
  campaign: MetaReadMirrorCampaign;
}>;

/** This only reshapes the already validated tenant-bound mirror projection. */
export function canonicalCampaignPortfolio(projection: MetaReadMirrorProjection): readonly CanonicalCampaignPortfolioEntry[] {
  return projection.connections.flatMap((connection) => connection.accounts.flatMap((account) => account.campaigns.map((campaign) => Object.freeze({
    campaignRef: campaign.campaignRef, name: campaign.name, objective: campaign.objective, status: campaign.status,
    accountName: account.name, currency: account.currency, campaign,
  })))).sort((left, right) => left.name.localeCompare(right.name, "tr") || left.campaignRef.localeCompare(right.campaignRef));
}

function budget(value: number | null, currency: string): string {
  return value === null ? "Tanımlı değil" : new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value / 100);
}
function detailText(campaign: MetaReadMirrorCampaign): string {
  const creative = campaign.adSets.flatMap((adSet) => adSet.ads).map((ad) => ad.creative).find((item) => item !== null);
  return creative?.primaryText ?? creative?.headline ?? creative?.description ?? creative?.caption ?? "Bu kampanya için aynalanmış reklam metni yok.";
}

function normal(value: string | null): string {
  return (value ?? "").trim().toLocaleLowerCase("tr-TR");
}

export function filterCanonicalCampaignPortfolio(entries: readonly CanonicalCampaignPortfolioEntry[], input: Readonly<{ query: string; accountName: string; status: string }>): readonly CanonicalCampaignPortfolioEntry[] {
  const search = normal(input.query);
  return entries.filter((entry) => (!input.accountName || entry.accountName === input.accountName)
    && (!input.status || entry.status === input.status)
    && (!search || [entry.name, entry.accountName, entry.objective, entry.status].some((value) => normal(value).includes(search))));
}

export function CanonicalCampaignPortfolioPanel({ projection, onOpenAgentContext, onOpenDecisionContext }: Readonly<{
  projection: MetaReadMirrorProjection;
  onOpenAgentContext(campaignRef: string, label: string): void;
  onOpenDecisionContext(campaignRef: string, label: string): void;
}>) {
  const entries = useMemo(() => canonicalCampaignPortfolio(projection), [projection]);
  const [selectedRef, setSelectedRef] = useState("");
  const [query, setQuery] = useState("");
  const [accountName, setAccountName] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusDetailAfterSelectionRef = useRef(false);
  const accounts = useMemo(() => [...new Set(entries.map((entry) => entry.accountName))].sort((left, right) => left.localeCompare(right, "tr")), [entries]);
  const statuses = useMemo(() => [...new Set(entries.map((entry) => entry.status).filter((value): value is string => value !== null))].sort(), [entries]);
  const filteredEntries = useMemo(() => filterCanonicalCampaignPortfolio(entries, { query, accountName, status }), [entries, query, accountName, status]);
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / CANONICAL_PORTFOLIO_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleEntries = filteredEntries.slice(safePage * CANONICAL_PORTFOLIO_PAGE_SIZE, (safePage + 1) * CANONICAL_PORTFOLIO_PAGE_SIZE);
  useEffect(() => { setPage(0); }, [query, accountName, status]);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);
  useEffect(() => { setSelectedRef((current) => filteredEntries.some((entry) => entry.campaignRef === current) ? current : filteredEntries[0]?.campaignRef ?? ""); }, [filteredEntries]);
  const selected = filteredEntries.find((entry) => entry.campaignRef === selectedRef) ?? filteredEntries[0] ?? null;
  useEffect(() => {
    if (!selected || !focusDetailAfterSelectionRef.current) return;
    focusDetailAfterSelectionRef.current = false;
    detailHeadingRef.current?.focus();
  }, [selected]);
  if (!selected) return <section className={styles.panel} aria-label="Kanonik Meta kampanya portföyü"><header className={styles.panelHeader}><div><span className={styles.kicker}>KANONİK META PORTFÖYÜ · SALT-OKUNUR</span><h2>{entries.length ? "Bu filtrede kampanya yok" : "Aynada kampanya yok"}</h2></div><span className={styles.statusPill} data-tone="neutral">{projection.sourceState}</span></header><p>{entries.length ? "Arama veya filtreyi genişletin; başka bir kaynakla doldurulmaz." : "Bu doğrulanmış kaynakta kampanya bulunmuyor; ekran başka bir portföy kaynağıyla doldurulmaz."}</p>{entries.length ? <div className={styles.canonicalPortfolioFilters}><label>Bul<input type="search" value={query} placeholder="Kampanya, hesap, amaç…" onChange={(event) => setQuery(event.target.value)} /></label><label>Hesap<select value={accountName} onChange={(event) => setAccountName(event.target.value)}><option value="">Tüm hesaplar</option>{accounts.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Durum<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tüm durumlar</option>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div> : null}</section>;
  const ads = selected.campaign.adSets.flatMap((adSet) => adSet.ads);
  const creatives = ads.filter((ad) => ad.creative !== null);
  return <section className={styles.splitWorkspace} aria-label="Kanonik Meta kampanya portföyü">
    <section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>KANONİK META PORTFÖYÜ · SALT-OKUNUR</span><h2>Kampanyalar</h2></div><span className={styles.statusPill} data-tone="good">{filteredEntries.length}/{entries.length}</span></header><p>Yerel oturumla bağlanmış Meta aynası. Filtre, öneri, politika veya Meta değişikliği içermez.</p><div className={styles.canonicalPortfolioFilters}><label>Bul<input type="search" value={query} placeholder="Kampanya, hesap, amaç…" onChange={(event) => setQuery(event.target.value)} /></label><label>Hesap<select value={accountName} onChange={(event) => setAccountName(event.target.value)}><option value="">Tüm hesaplar</option>{accounts.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Durum<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tüm durumlar</option>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><div className={styles.selectorList}>{visibleEntries.map((entry) => <button key={entry.campaignRef} data-active={selected.campaignRef === entry.campaignRef} aria-pressed={selected.campaignRef === entry.campaignRef} type="button" onClick={() => { focusDetailAfterSelectionRef.current = true; setSelectedRef(entry.campaignRef); }}><span><strong>{entry.name}</strong><small>{entry.accountName} · {entry.objective ?? "Amaç bilinmiyor"}</small></span><span className={styles.statusPill} data-tone="neutral">{entry.status ?? "Durum bilinmiyor"}</span></button>)}</div>{pageCount > 1 ? <nav className={styles.canonicalPortfolioPagination} aria-label="Kampanya sayfaları"><button type="button" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Önceki</button><span>{safePage + 1} / {pageCount} · {CANONICAL_PORTFOLIO_PAGE_SIZE} satır</span><button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Sonraki</button></nav> : null}</section>
    <section className={styles.panel}><header className={styles.detailHeader}><div><span className={styles.kicker}>KANONİK KAMPANYA BAĞLAMI</span><h2 ref={detailHeadingRef} tabIndex={-1}>{selected.name}</h2><p>{selected.accountName} · {selected.objective ?? "Meta amacı bilinmiyor"} · {selected.status ?? "Durum bilinmiyor"}</p></div><div className={styles.agentActions}><button type="button" onClick={() => onOpenDecisionContext(selected.campaignRef, selected.name)}>Kararlarda incele</button><button type="button" onClick={() => onOpenAgentContext(selected.campaignRef, selected.name)}>Asistanla aç ✦</button></div></header>
      <div className={styles.contextGrid}><div><span>Bütçe sahibi</span><strong>{selected.campaign.budget.owner}</strong><small>Günlük: {budget(selected.campaign.budget.dailyMinor, selected.currency)}</small></div><div><span>Ömür boyu bütçe</span><strong>{budget(selected.campaign.budget.lifetimeMinor, selected.currency)}</strong><small>Yalnız aynalanmış değer</small></div><div><span>Son gözlem</span><strong>{new Date(selected.campaign.fetchedAt).toLocaleString("tr-TR")}</strong><small>Freshness aynanın kanıtıdır</small></div><div><span>Künye</span><strong>İnsan incelemesi gerekir</strong><small>Kategori kaynağı bu görünümde atanmaz</small></div></div>
      <div className={styles.hierarchy}><div><span>Campaign</span><strong>{selected.name}</strong></div><div><span>Ad set · {selected.campaign.adSets.length}</span><strong>{selected.campaign.adSets.map((adSet) => adSet.name).slice(0, 3).join(" · ") || "Yok"}</strong></div><div><span>Ad · {ads.length}</span><strong>{ads.filter((ad) => ad.status === "ACTIVE").length} active · aynalanmış durum</strong></div><div><span>Creative/post · {creatives.length}</span><strong>{creatives[0]?.creative?.sourceType ?? "Kreatif yok"}</strong></div></div>
      <section className={styles.canonicalHierarchyDrilldown}><header><div><span className={styles.kicker}>HİYERARŞİ · KANONİK AYNADAN</span><h3>Mevcut Meta kurulumu</h3></div><span className={styles.statusPill} data-tone="good">salt-okunur</span></header><details open><summary><span>Hesap</span><strong>{selected.accountName}</strong><small>{selected.currency}</small></summary><details open><summary><span>Kampanya</span><strong>{selected.name}</strong><small>{selected.campaign.status ?? "Durum bilinmiyor"}</small></summary>{selected.campaign.adSets.map((adSet) => <details key={adSet.adSetRef}><summary><span>Reklam seti</span><strong>{adSet.name}</strong><small>{adSet.status ?? "Durum bilinmiyor"} · {adSet.ads.length} reklam</small></summary>{adSet.ads.map((ad) => <div className={styles.canonicalCreativeLeaf} key={ad.adRef}><span>Reklam / kreatif</span><strong>{ad.name}</strong><small>{ad.status ?? "Durum bilinmiyor"} · {ad.creative?.sourceType ?? "kreatif yok"}</small></div>)}</details>)}</details></details></section>
      <div className={styles.copyPreview}><span className={styles.kicker}>AYNALANMIŞ REKLAM METNİ</span><h3>{detailText(selected.campaign)}</h3><p>İçerik yalnız kanıt olarak gösterilir; otomatik künye, öneri veya değişiklik üretmez.</p><footer><span className={styles.statusPill} data-tone="info">Mevcut creative</span></footer></div>
      <CampaignPerformanceEvidencePanel campaignRef={selected.campaignRef} />
    </section>
  </section>;
}
