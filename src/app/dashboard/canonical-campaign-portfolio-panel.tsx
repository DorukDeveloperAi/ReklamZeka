"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MetaReadMirrorCampaign, MetaReadMirrorProjection } from "@/domain/meta/read-mirror-projection";
import { CampaignPerformanceEvidencePanel } from "./campaign-performance-evidence-panel";
import { parseSliceRuleWorkspaceSnapshot, type SliceRuleWorkspaceItem, type SliceRuleWorkspaceSnapshot } from "./slice-rule-workspace-panel";
import styles from "./operating-dashboard.module.css";

export const CANONICAL_PORTFOLIO_PAGE_SIZE = 24;

export type CanonicalCampaignPortfolioEntry = Readonly<{
  campaignRef: string;
  name: string;
  objective: string | null;
  status: string | null;
  accountRef: string;
  accountName: string;
  currency: string;
  accountFreshness: MetaReadMirrorProjection["connections"][number]["accounts"][number]["freshness"];
  campaign: MetaReadMirrorCampaign;
}>;

/** This only reshapes the already validated tenant-bound mirror projection. */
export function canonicalCampaignPortfolio(projection: MetaReadMirrorProjection): readonly CanonicalCampaignPortfolioEntry[] {
  return projection.connections.flatMap((connection) => connection.accounts.flatMap((account) => account.campaigns.map((campaign) => Object.freeze({
    campaignRef: campaign.campaignRef, name: campaign.name, objective: campaign.objective, status: campaign.status,
    accountRef: account.accountRef, accountName: account.name, currency: account.currency, accountFreshness: account.freshness, campaign,
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

function streamState(value: CanonicalCampaignPortfolioEntry["accountFreshness"]): string {
  const states = [value.inventoryStatus, value.creativeStatus, value.insightStatus];
  if (states.every((state) => state === "completed")) return "Ayna akışları tamamlandı";
  if (states.some((state) => state === "failed" || state === "cancelled")) return "Ayna akışında hata var";
  return "Ayna akışları kısmi";
}

function timestamp(value: string | null): string {
  return value ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value)) : "Bilinmiyor";
}

function sliceScopeLabel(item: SliceRuleWorkspaceItem): string {
  const scope = item.scope;
  return [scope.market === "domestic" ? "Yerli" : "Yabancı", "Hizmet kapsamı", "Kampanya ailesi",
    scope.countryOrRegion, scope.audienceStrategy, scope.platform, scope.conversionRoute].filter(Boolean).join(" · ");
}

function sliceRuleLabel(item: SliceRuleWorkspaceItem): string {
  const rule = item.operatingRule.rule;
  if (rule.kind === "period_budget_cap") return `${rule.period} bütçe tavanı`;
  if (rule.kind === "budget_distribution") return "Bütçe dağılımı";
  if (rule.kind === "winner_continuation_rotation") return "Kazananı sürdürme / rotasyon";
  return "Teslimat koruması";
}

type SliceWorkspaceState = Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; snapshot: SliceRuleWorkspaceSnapshot }>
  | Readonly<{ status: "unavailable"; message: string }>;

export function filterCanonicalCampaignPortfolio(entries: readonly CanonicalCampaignPortfolioEntry[], input: Readonly<{ query: string; accountName: string; status: string }>): readonly CanonicalCampaignPortfolioEntry[] {
  const search = normal(input.query);
  return entries.filter((entry) => (!input.accountName || entry.accountName === input.accountName)
    && (!input.status || entry.status === input.status)
    && (!search || [entry.name, entry.accountName, entry.objective, entry.status].some((value) => normal(value).includes(search))));
}

export function CanonicalCampaignPortfolioPanel({ projection, onOpenAgentContext, onOpenDecisionContext, onOpenCanonicalRule }: Readonly<{
  projection: MetaReadMirrorProjection;
  onOpenAgentContext(campaignRef: string, label: string): void;
  onOpenDecisionContext(campaignRef: string, label: string): void;
  onOpenCanonicalRule(ruleRef: string, revision: number): void;
}>) {
  const entries = useMemo(() => canonicalCampaignPortfolio(projection), [projection]);
  const [selectedRef, setSelectedRef] = useState("");
  const [query, setQuery] = useState("");
  const [accountName, setAccountName] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [sliceWorkspace, setSliceWorkspace] = useState<SliceWorkspaceState>({ status: "loading" });
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
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/slice-rule-workspace", { cache: "no-store", credentials: "same-origin",
          headers: { "X-ReklamZeka-Intent": "slice-rule-workspace-read" } });
        if (!response.ok) throw new Error("Kullanıcı tanımlı slice kaynağı kullanılamıyor.");
        const snapshot = parseSliceRuleWorkspaceSnapshot(await response.json());
        if (active) setSliceWorkspace({ status: "ready", snapshot });
      } catch (error) {
        if (active) setSliceWorkspace({ status: "unavailable", message: error instanceof Error ? error.message : "Kullanıcı tanımlı slice kaynağı kullanılamıyor." });
      }
    })();
    return () => { active = false; };
  }, []);
  if (!selected) return <section className={styles.panel} aria-label="Kanonik Meta kampanya portföyü"><header className={styles.panelHeader}><div><span className={styles.kicker}>KANONİK META PORTFÖYÜ · SALT-OKUNUR</span><h2>{entries.length ? "Bu filtrede kampanya yok" : "Aynada kampanya yok"}</h2></div><span className={styles.statusPill} data-tone="neutral">{projection.sourceState}</span></header><p>{entries.length ? "Arama veya filtreyi genişletin; başka bir kaynakla doldurulmaz." : "Bu doğrulanmış kaynakta kampanya bulunmuyor; ekran başka bir portföy kaynağıyla doldurulmaz."}</p>{entries.length ? <div className={styles.canonicalPortfolioFilters}><label>Bul<input type="search" value={query} placeholder="Kampanya, hesap, amaç…" onChange={(event) => setQuery(event.target.value)} /></label><label>Hesap<select value={accountName} onChange={(event) => setAccountName(event.target.value)}><option value="">Tüm hesaplar</option>{accounts.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Durum<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tüm durumlar</option>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div> : null}</section>;
  const ads = selected.campaign.adSets.flatMap((adSet) => adSet.ads);
  const creatives = ads.filter((ad) => ad.creative !== null);
  return <section className={styles.splitWorkspace} aria-label="Portföy ve Slice çalışma masası">
    <section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>KANONİK META PORTFÖYÜ · SALT-OKUNUR</span><h2>Kampanyalar</h2></div><span className={styles.statusPill} data-tone="good">{filteredEntries.length}/{entries.length}</span></header><p>Yerel oturumla bağlanmış Meta aynası. Hesaplar ayrı tutulur; filtre, öneri, politika veya Meta değişikliği içermez.</p><div className={styles.canonicalPortfolioFilters}><label>Bul<input type="search" value={query} placeholder="Kampanya, hesap, amaç…" onChange={(event) => setQuery(event.target.value)} /></label><label>Hesap<select value={accountName} onChange={(event) => setAccountName(event.target.value)}><option value="">Tüm hesaplar</option>{accounts.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Durum<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tüm durumlar</option>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><div className={styles.selectorList}>{visibleEntries.map((entry) => <button key={entry.campaignRef} data-active={selected.campaignRef === entry.campaignRef} aria-pressed={selected.campaignRef === entry.campaignRef} type="button" onClick={() => { focusDetailAfterSelectionRef.current = true; setSelectedRef(entry.campaignRef); }}><span><strong>{entry.name}</strong><small>{entry.accountName} · {entry.currency} · {entry.objective ?? "Amaç bilinmiyor"}</small></span><span className={styles.statusPill} data-tone="neutral">{entry.status ?? "Durum bilinmiyor"}</span></button>)}</div>{pageCount > 1 ? <nav className={styles.canonicalPortfolioPagination} aria-label="Kampanya sayfaları"><button type="button" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Önceki</button><span>{safePage + 1} / {pageCount} · {CANONICAL_PORTFOLIO_PAGE_SIZE} satır</span><button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Sonraki</button></nav> : null}</section>
    <section className={styles.panel}><header className={styles.detailHeader}><div><span className={styles.kicker}>KANONİK KAMPANYA BAĞLAMI</span><h2 ref={detailHeadingRef} tabIndex={-1}>{selected.name}</h2><p>{selected.accountName} · {selected.objective ?? "Meta amacı bilinmiyor"} · {selected.status ?? "Durum bilinmiyor"}</p></div><div className={styles.agentActions}><button type="button" onClick={() => onOpenDecisionContext(selected.campaignRef, selected.name)}>İncele</button><button type="button" onClick={() => onOpenAgentContext(selected.campaignRef, selected.name)}>Agent’a sor ✦</button></div></header>
      <div className={styles.contextGrid}><div><span>Hesap</span><strong>{selected.accountName} · {selected.currency}</strong><small>Çalışma alanına bağlı kanonik ayna</small></div><div><span>Bütçe sahibi</span><strong>{selected.campaign.budget.owner}</strong><small>Günlük: {budget(selected.campaign.budget.dailyMinor, selected.currency)}</small></div><div><span>Kampanya aynası</span><strong>{timestamp(selected.campaign.fetchedAt)}</strong><small>Hiyerarşi gözlemi; performans freshness’i değildir</small></div><div><span>Hesap kaynak durumu</span><strong>{streamState(selected.accountFreshness)}</strong><small>Son ayna: {timestamp(selected.accountFreshness.latestObservedAt)}</small></div></div>
      <div className={styles.hierarchy}><div><span>Campaign</span><strong>{selected.name}</strong></div><div><span>Ad set · {selected.campaign.adSets.length}</span><strong>{selected.campaign.adSets.map((adSet) => adSet.name).slice(0, 3).join(" · ") || "Yok"}</strong></div><div><span>Ad · {ads.length}</span><strong>{ads.filter((ad) => ad.status === "ACTIVE").length} active · aynalanmış durum</strong></div><div><span>Creative/post · {creatives.length}</span><strong>{creatives[0]?.creative?.sourceType ?? "Kreatif yok"}</strong></div></div>
      <section className={styles.canonicalHierarchyDrilldown}><header><div><span className={styles.kicker}>HİYERARŞİ · KANONİK AYNADAN</span><h3>Mevcut Meta kurulumu</h3></div><span className={styles.statusPill} data-tone="good">salt-okunur</span></header><details open><summary><span>Hesap</span><strong>{selected.accountName}</strong><small>{selected.currency}</small></summary><details open><summary><span>Kampanya</span><strong>{selected.name}</strong><small>{selected.campaign.status ?? "Durum bilinmiyor"}</small></summary>{selected.campaign.adSets.map((adSet) => <details key={adSet.adSetRef}><summary><span>Reklam seti</span><strong>{adSet.name}</strong><small>{adSet.status ?? "Durum bilinmiyor"} · {adSet.ads.length} reklam</small></summary>{adSet.ads.map((ad) => <div className={styles.canonicalCreativeLeaf} key={ad.adRef}><span>Reklam / kreatif</span><strong>{ad.name}</strong><small>{ad.status ?? "Durum bilinmiyor"} · {ad.creative?.sourceType ?? "kreatif yok"}</small></div>)}</details>)}</details></details></section>
      <div className={styles.copyPreview}><span className={styles.kicker}>AYNALANMIŞ REKLAM METNİ</span><h3>{detailText(selected.campaign)}</h3><p>İçerik yalnız kanıt olarak gösterilir; otomatik künye, öneri veya değişiklik üretmez.</p><footer><span className={styles.statusPill} data-tone="info">Mevcut creative</span></footer></div>
      <section className={styles.sliceScopePanel} aria-label="Kullanıcı tanımlı slice kapsamları"><header><div><span className={styles.kicker}>KULLANICI TANIMLI SLICELAR · AYRI KAPSAM</span><h3>Bağlı çalışma kuralları</h3></div><span className={styles.statusPill} data-tone="neutral">{sliceWorkspace.status === "ready" ? "hazır" : sliceWorkspace.status === "loading" ? "okunuyor" : "kullanılamıyor"}</span></header><p>Bu kapsamlar Meta hiyerarşisi değildir ve kampanya adıyla otomatik eşleştirilmez. Aynı çalışma masasında bağlam sunar; yeni kural veya politika oluşturmaz.</p>{sliceWorkspace.status === "loading" ? <p role="status">Kullanıcı tanımlı slice kapsamları okunuyor…</p> : null}{sliceWorkspace.status === "unavailable" ? <p role="status">{sliceWorkspace.message}</p> : null}{sliceWorkspace.status === "ready" && sliceWorkspace.snapshot.items.length === 0 ? <p>Kayıtlı kullanıcı tanımlı slice yok. Bu nedenle kapsam veya kural tahmin edilmiyor.</p> : null}{sliceWorkspace.status === "ready" ? <div className={styles.sliceScopeList}>{sliceWorkspace.snapshot.items.map((item) => <article key={item.draftRef}><div><strong>{sliceScopeLabel(item)}</strong><small>{sliceRuleLabel(item)} · revizyon {item.revision} · öneri ve insan incelemesi</small></div><div className={styles.agentActions}><button type="button" onClick={() => onOpenCanonicalRule(item.seriesRef, item.revision)}>Kuralı aç</button><button type="button" onClick={() => onOpenAgentContext(item.seriesRef, `Slice kapsamı · ${sliceScopeLabel(item)} · revizyon ${item.revision}`)}>Agent’a sor ✦</button></div></article>)}</div> : null}</section>
      <CampaignPerformanceEvidencePanel campaignRef={selected.campaignRef} />
    </section>
  </section>;
}
