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

export type CanonicalScopeSourceState = "ready" | "partial" | "empty" | "unavailable";

export function canonicalAccountSourceState(account: MetaReadMirrorProjection["connections"][number]["accounts"][number]): CanonicalScopeSourceState {
  const value = account.freshness;
  const states = [value.inventoryStatus, value.creativeStatus, value.insightStatus];
  if (states.some((state) => state === "failed" || state === "cancelled")) return "unavailable";
  if (account.campaigns.length === 0) return "empty";
  if (states.every((state) => state === "completed")) return "ready";
  return "partial";
}

function scopeStateLabel(state: CanonicalScopeSourceState): string {
  return state === "ready" ? "hazır" : state === "partial" ? "kısmi" : state === "empty" ? "boş" : "kullanılamıyor";
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

function campaignEvidenceSummary(state: CanonicalScopeSourceState): string {
  return state === "ready" ? "Performans ayrıntıda hazır kaynakla doğrulanır" : state === "partial" ? "Performans kanıtı kısmi olabilir" : state === "empty" ? "Performans kanıtı yok" : "Performans kaynağı kullanılamıyor";
}

type SliceWorkspaceState = Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; snapshot: SliceRuleWorkspaceSnapshot }>
  | Readonly<{ status: "empty"; snapshot: SliceRuleWorkspaceSnapshot }>
  | Readonly<{ status: "unavailable"; message: string }>;
type PortfolioLinksState = Readonly<{ status: "loading" }> | Readonly<{ status: "ready"; links: readonly PortfolioRuleLink[] }> | Readonly<{ status: "unavailable"; message: string }>;
type PortfolioRuleLink = Readonly<{ campaignRef: string; rule: Readonly<{ seriesRef: string; revision: number; kind: string }>; source: Readonly<{ state: "bound"; boundAt: string }>; decision: Readonly<{ actionUnit: Readonly<{ presence: boolean; status: "not_materialized" | "awaiting_approval" | "approved" | "rejected" | "changes_requested" }> }> | null }>;

function portfolioLinks(value: unknown): readonly PortfolioRuleLink[] {
  const valid = (link: unknown) => { if (!link || typeof link !== "object" || Array.isArray(link) || Object.keys(link).length !== 4) return false; const item = link as Record<string, unknown>; const rule = item.rule as Record<string, unknown> | null; const source = item.source as Record<string, unknown> | null; const decision = item.decision as Record<string, unknown> | null; return /^campaign_[a-f0-9]{24}$/.test(String(item.campaignRef)) && !!rule && typeof rule === "object" && Object.keys(rule).length === 3 && /^[a-z][a-z0-9_.:-]{0,127}$/.test(String(rule.seriesRef)) && Number.isInteger(rule.revision) && Number(rule.revision) > 0 && typeof rule.kind === "string" && !!source && typeof source === "object" && Object.keys(source).length === 2 && source.state === "bound" && typeof source.boundAt === "string" && Number.isFinite(Date.parse(source.boundAt)) && (decision === null || !!decision && typeof decision === "object" && Object.keys(decision).length === 1 && !!decision.actionUnit && typeof decision.actionUnit === "object" && Object.keys(decision.actionUnit as object).length === 2 && typeof (decision.actionUnit as Record<string, unknown>).presence === "boolean" && ["not_materialized", "awaiting_approval", "approved", "rejected", "changes_requested"].includes(String((decision.actionUnit as Record<string, unknown>).status))); };
  if (!value || typeof value !== "object" || !("contractVersion" in value) || value.contractVersion !== "slice-rule-portfolio-links/1.0.0" || !("links" in value) || !Array.isArray(value.links) || value.links.length > 100 || !value.links.every(valid)) throw new Error("Bağlı Slice kanıtı sözleşmesi güvenli değil.");
  return value.links as PortfolioRuleLink[];
}
function ruleKindLabel(kind: string): string { return kind === "period_budget_cap" ? "Bütçe tavanı" : kind === "budget_distribution" ? "Bütçe dağılımı" : kind === "winner_continuation_rotation" ? "Kazananı sürdürme / rotasyon" : kind === "targeting_budget_preservation" ? "Hedefleme bütçe koruması" : "Bağlı Slice kuralı"; }
function decisionLabel(link: PortfolioRuleLink): string { if (!link.decision) return "Seçilmiş karar izi yok"; return ({ not_materialized: "Seçildi · işlem birimi yok", awaiting_approval: "İnsan onayı bekliyor", approved: "İnsan onayı kaydedildi", rejected: "İnsan onayı reddetti", changes_requested: "İnsan değişiklik istedi" })[link.decision.actionUnit.status]; }

/** Account selection is by canonical ref; display names are never an identity boundary. */
export function filterCanonicalCampaignPortfolio(entries: readonly CanonicalCampaignPortfolioEntry[], input: Readonly<{ query: string; accountRef: string; status: string }>): readonly CanonicalCampaignPortfolioEntry[] {
  const search = normal(input.query);
  return entries.filter((entry) => (!input.accountRef || entry.accountRef === input.accountRef)
    && (!input.status || entry.status === input.status)
    && (!search || [entry.name, entry.accountName, entry.objective, entry.status].some((value) => normal(value).includes(search))));
}

/** Keeps an incomplete mirror from being mistaken for a complete operating scope. */
export function portfolioSourceGuidance(state: MetaReadMirrorProjection["sourceState"]): string | null {
  if (state === "partial") return "Kaynak kısmi: gösterilen kampanyaları inceleyebilirsiniz; eksik hesap veya performans için kesin sonuç çıkarmayın. Sonraki adım, kaynak güncellendiğinde Portföyü yeniden kontrol etmektir.";
  if (state === "stale") return "Kaynak gecikmiş: hiyerarşi yalnız yön bulma içindir. Karar vermeden önce güncel kanıtı bekleyin.";
  if (state === "empty") return "Kaynak başarıyla okundu ancak gösterilebilir kampanya yok. Sonraki adım, kaynak ayarlarını doğrulamak; başka bir portföyü tahmin etmemektir.";
  return null;
}

export function CanonicalCampaignPortfolioPanel({ projection, onOpenAgentContext, onOpenDecisionContext, onOpenCanonicalRule, onOpenSliceWorkspace }: Readonly<{
  projection: MetaReadMirrorProjection;
  onOpenAgentContext(campaignRef: string, label: string): void;
  onOpenDecisionContext(campaignRef: string, label: string): void;
  onOpenCanonicalRule(ruleRef: string, revision: number): void;
  /** Carries only the canonical campaign reference; scope eligibility is re-checked server-side. */
  onOpenSliceWorkspace(campaignRef: string): void;
}>) {
  const entries = useMemo(() => canonicalCampaignPortfolio(projection), [projection]);
  const [selectedRef, setSelectedRef] = useState("");
  const [query, setQuery] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [sliceWorkspace, setSliceWorkspace] = useState<SliceWorkspaceState>({ status: "loading" });
  const [linkedRules, setLinkedRules] = useState<PortfolioLinksState>({ status: "loading" });
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusDetailAfterSelectionRef = useRef(false);
  const accounts = useMemo(() => projection.connections.flatMap((connection) => connection.accounts)
    .sort((left, right) => left.name.localeCompare(right.name, "tr") || left.accountRef.localeCompare(right.accountRef)), [projection]);
  const statuses = useMemo(() => [...new Set(entries.map((entry) => entry.status).filter((value): value is string => value !== null))].sort(), [entries]);
  const filteredEntries = useMemo(() => filterCanonicalCampaignPortfolio(entries, { query, accountRef, status }), [entries, query, accountRef, status]);
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / CANONICAL_PORTFOLIO_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleEntries = filteredEntries.slice(safePage * CANONICAL_PORTFOLIO_PAGE_SIZE, (safePage + 1) * CANONICAL_PORTFOLIO_PAGE_SIZE);
  useEffect(() => { setPage(0); }, [query, accountRef, status]);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);
  useEffect(() => { setSelectedRef((current) => filteredEntries.some((entry) => entry.campaignRef === current) ? current : filteredEntries[0]?.campaignRef ?? ""); }, [filteredEntries]);
  const selected = filteredEntries.find((entry) => entry.campaignRef === selectedRef) ?? filteredEntries[0] ?? null;
  const selectedLinks = selected && linkedRules.status === "ready"
    ? linkedRules.links.filter((link) => link.campaignRef === selected.campaignRef) : [];
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
        if (active) setSliceWorkspace(snapshot.items.length ? { status: "ready", snapshot } : { status: "empty", snapshot });
      } catch (error) {
        if (active) setSliceWorkspace({ status: "unavailable", message: error instanceof Error ? error.message : "Kullanıcı tanımlı slice kaynağı kullanılamıyor." });
      }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => { let active = true; void (async () => { try { const response = await fetch("/api/slice-rule-portfolio-links", { cache: "no-store", credentials: "same-origin", headers: { "X-ReklamZeka-Intent": "slice-rule-portfolio-links-read" } }); if (!response.ok) throw new Error("Bağlı Slice kanıtı kaynağı kullanılamıyor."); const links = portfolioLinks(await response.json()); if (active) setLinkedRules({ status: "ready", links }); } catch (error) { if (active) setLinkedRules({ status: "unavailable", message: error instanceof Error ? error.message : "Bağlı Slice kanıtı kaynağı kullanılamıyor." }); } })(); return () => { active = false; }; }, []);
  const filters = <div className={styles.canonicalPortfolioFilters}><label>Bul<input type="search" value={query} placeholder="Kampanya, hesap, amaç…" onChange={(event) => setQuery(event.target.value)} /></label><label>Hesap<select value={accountRef} onChange={(event) => setAccountRef(event.target.value)}><option value="">Tüm hesaplar</option>{accounts.map((account) => <option key={account.accountRef} value={account.accountRef}>{account.name} · {account.currency} · {scopeStateLabel(canonicalAccountSourceState(account))}</option>)}</select></label><label>Durum<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tüm durumlar</option>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div>;
  if (!selected) return <section className={styles.panel} aria-label="Kanonik Meta kampanya portföyü"><header className={styles.panelHeader}><div><span className={styles.kicker}>KANONİK META PORTFÖYÜ · SALT-OKUNUR</span><h2>{entries.length ? "Bu filtrede kampanya yok" : "Portföy kapsamı boş"}</h2></div><span className={styles.statusPill} data-tone="neutral">{projection.sourceState === "empty" ? "boş" : projection.sourceState === "unavailable" ? "kullanılamıyor" : projection.sourceState}</span></header><p>{entries.length ? "Arama veya filtreyi genişletin; başka bir kaynakla doldurulmaz." : "Doğrulanmış kanonik kaynakta kampanya yok; ekran başka bir portföy kaynağıyla doldurulmaz."}</p>{portfolioSourceGuidance(projection.sourceState) ? <p className={styles.metaAccountEmpty}>{portfolioSourceGuidance(projection.sourceState)}</p> : null}{entries.length ? filters : null}</section>;
  const ads = selected.campaign.adSets.flatMap((adSet) => adSet.ads);
  const creatives = ads.filter((ad) => ad.creative !== null);
  return <section className={styles.portfolioWorkbench} aria-label="Portföy ve Slice çalışma masası">
    <section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>KANONİK META PORTFÖYÜ · SALT-OKUNUR</span><h2>Operasyon tablosu</h2></div><span className={styles.statusPill} data-tone={projection.sourceState === "ready" ? "good" : "warning"}>{filteredEntries.length}/{entries.length}</span></header><p>Meta hiyerarşisi ve kullanıcı tanımlı slice'lar aynı kayıt değildir. Bu tablo yalnız doğrulanmış bağları gösterir; isimden, pazar adından veya zayıf kanıttan eşleme yapmaz.</p>{portfolioSourceGuidance(projection.sourceState) ? <p className={styles.metaAccountEmpty} role="status">{portfolioSourceGuidance(projection.sourceState)}</p> : null}{filters}<div className={styles.portfolioOperationTable}><table><caption>Seçili kapsamın kanonik Meta hiyerarşisi, kanıt durumu, bütçe sahibi, kullanıcı kuralı ve karar izi aynı çalışma bağlamında görünür.</caption><thead><tr><th scope="col">Kapsam</th><th scope="col">Performans kanıtı</th><th scope="col">Bütçe sahibi</th><th scope="col">Kaynak</th><th scope="col">Kullanıcı kuralı</th><th scope="col">Karar izi</th><th scope="col">İşlem</th></tr></thead><tbody>{visibleEntries.map((entry) => { const account = accounts.find((item) => item.accountRef === entry.accountRef)!; const sourceState = canonicalAccountSourceState(account); const links = linkedRules.status === "ready" ? linkedRules.links.filter((link) => link.campaignRef === entry.campaignRef) : []; return <tr key={entry.campaignRef} data-active={selected.campaignRef === entry.campaignRef}><td><strong>Meta kampanya · {entry.name}</strong><span>{entry.accountName} · {entry.objective ?? "Amaç bilinmiyor"} · {entry.status ?? "Durum bilinmiyor"}</span></td><td><strong>{campaignEvidenceSummary(sourceState)}</strong><span>Kesin metrikler yalnız İncele ayrıntısında gösterilir.</span></td><td><strong>{entry.campaign.budget.owner}</strong><span>Günlük: {budget(entry.campaign.budget.dailyMinor, entry.currency)}</span></td><td><strong title="Kaynak durumu; renk tek başına anlam taşımaz.">{scopeStateLabel(sourceState)}</strong><span>Son ayna: {timestamp(entry.accountFreshness.latestObservedAt)}</span></td><td>{linkedRules.status === "unavailable" ? <><strong title={linkedRules.message}>Bağ kaynağı kullanılamıyor</strong><span>Fail-closed: kural atanmadı.</span></> : links.length ? <><strong>{links.map((link) => `${ruleKindLabel(link.rule.kind)} · revizyon ${link.rule.revision}`).join(" / ")}</strong><span>Frozen kanıt bağında: {links.map((link) => timestamp(link.source.boundAt)).join(" / ")}</span></> : <><strong>Bağlı kural yok</strong><span>Slice veya kural kampanya adıyla tahmin edilmez.</span></>}</td><td>{linkedRules.status === "unavailable" ? <><strong title={linkedRules.message}>Karar kaynağı kullanılamıyor</strong><span>Fail-closed: karar atanmadı.</span></> : links.length ? <><strong>{links.map(decisionLabel).join(" / ")}</strong><span>Yürütme sunucuda kapalı; Meta yazma yetkisi yok.</span></> : <><strong>Bağlı karar izi yok</strong><span>Kanonik bağ olmadan karar atanmaz.</span></>}</td><td><div className={styles.operationRowActions}><button type="button" onClick={() => { focusDetailAfterSelectionRef.current = true; setSelectedRef(entry.campaignRef); }}>İncele</button><button type="button" onClick={() => onOpenAgentContext(entry.campaignRef, entry.name)}>Asistanla aç</button><button type="button" onClick={() => onOpenDecisionContext(entry.campaignRef, entry.name)}>Kararlarda incele</button></div></td></tr>; })}{sliceWorkspace.status === "ready" ? sliceWorkspace.snapshot.items.map((item) => <tr key={item.draftRef} data-kind="slice"><td><strong>Kullanıcı tanımlı slice</strong><span>{sliceScopeLabel(item)}</span></td><td><strong>Bu görünümde bağlı değil</strong><span>Meta performansı isimle slice'a bağlanmaz.</span></td><td><strong>Kanonik sahip bağlı değil</strong><span>Kural bütçe sahibi yerine geçmez.</span></td><td><strong>kullanıcı kaydı · hazır</strong><span>Meta kaynağından ayrı kapsam.</span></td><td><strong>{sliceRuleLabel(item)} · revizyon {item.revision}</strong><span>Öneri ve insan incelemesi</span></td><td><strong>Karar izi Kuralı aç içinde</strong><span>Bağlı iz yoksa sonuç uydurulmaz.</span></td><td><div className={styles.operationRowActions}><button type="button" onClick={() => onOpenCanonicalRule(item.seriesRef, item.revision)}>Kuralı aç</button><button type="button" onClick={() => onOpenAgentContext(item.seriesRef, `Slice kapsamı · ${sliceScopeLabel(item)} · revizyon ${item.revision}`)}>Asistanla aç</button></div></td></tr>) : null}</tbody></table></div>{linkedRules.status === "loading" ? <p role="status">Bağlı Slice kanıtı okunuyor…</p> : null}{linkedRules.status === "unavailable" ? <p role="status">{linkedRules.message}</p> : null}{sliceWorkspace.status === "loading" ? <p role="status">Kullanıcı tanımlı slice kapsamları okunuyor…</p> : null}{sliceWorkspace.status === "unavailable" ? <p role="status">{sliceWorkspace.message}</p> : null}{sliceWorkspace.status === "empty" ? <p className={styles.metaAccountEmpty}>Kayıtlı kullanıcı tanımlı slice yok. Bu nedenle kapsam veya kural tahmin edilmiyor.</p> : null}{pageCount > 1 ? <nav className={styles.canonicalPortfolioPagination} aria-label="Kampanya sayfaları"><button type="button" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Önceki</button><span>{safePage + 1} / {pageCount} · {CANONICAL_PORTFOLIO_PAGE_SIZE} satır</span><button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Sonraki</button></nav> : null}</section>
    <section className={styles.panel}><header className={styles.detailHeader}><div><span className={styles.kicker}>SEÇİLİ KANONİK KAMPANYA · AYRINTI</span><h2 ref={detailHeadingRef} tabIndex={-1}>{selected.name}</h2><p>{selected.accountName} · {selected.objective ?? "Meta amacı bilinmiyor"} · {selected.status ?? "Durum bilinmiyor"}</p></div><div className={styles.agentActions}>{selectedLinks.length === 1 ? <button type="button" onClick={() => onOpenCanonicalRule(selectedLinks[0]!.rule.seriesRef, selectedLinks[0]!.rule.revision)}>Kuralı aç</button> : <button type="button" onClick={() => onOpenSliceWorkspace(selected.campaignRef)}>Kural kapsamını incele</button>}<button type="button" onClick={() => onOpenDecisionContext(selected.campaignRef, selected.name)}>Kararlarda incele</button><button type="button" onClick={() => onOpenAgentContext(selected.campaignRef, selected.name)}>Asistanla aç</button></div></header>
      {selectedLinks.length === 1 ? null : <p className={styles.metaAccountEmpty}>Bu geçiş yalnız kanonik kampanya referansını taşır. Kural Kütüphanesi kapsam adayını yeniden doğrular; kural, policy, onay veya Meta işlemi oluşturmaz.</p>}
      <p className={styles.metaAccountEmpty}>Asistan kanıtı açıklar; kural/policy metni üretmez, alanlara kopyalamaz veya kayıt oluşturmaz.</p>
      <div className={styles.contextGrid}><div><span>Hesap</span><strong>{selected.accountName} · {selected.currency}</strong><small>Çalışma alanına bağlı kanonik ayna</small></div><div><span>Bütçe sahibi</span><strong>{selected.campaign.budget.owner}</strong><small>Günlük: {budget(selected.campaign.budget.dailyMinor, selected.currency)}</small></div><div><span>Kampanya aynası</span><strong>{timestamp(selected.campaign.fetchedAt)}</strong><small>Hiyerarşi gözlemi; performans freshness’i değildir</small></div><div><span>Hesap kaynak durumu</span><strong>{scopeStateLabel(canonicalAccountSourceState(accounts.find((account) => account.accountRef === selected.accountRef)!))}</strong><small>Son ayna: {timestamp(selected.accountFreshness.latestObservedAt)}</small></div></div>
      <div className={styles.hierarchy}><div><span>Campaign</span><strong>{selected.name}</strong></div><div><span>Ad set · {selected.campaign.adSets.length}</span><strong>{selected.campaign.adSets.map((adSet) => adSet.name).slice(0, 3).join(" · ") || "Yok"}</strong></div><div><span>Ad · {ads.length}</span><strong>{ads.filter((ad) => ad.status === "ACTIVE").length} active · aynalanmış durum</strong></div><div><span>Creative/post · {creatives.length}</span><strong>{creatives[0]?.creative?.sourceType ?? "Kreatif yok"}</strong></div></div>
      <section className={styles.canonicalHierarchyDrilldown}><header><div><span className={styles.kicker}>HİYERARŞİ · KANONİK AYNADAN</span><h3>Mevcut Meta kurulumu</h3></div><span className={styles.statusPill} data-tone="good">salt-okunur</span></header><details open><summary><span>Hesap</span><strong>{selected.accountName}</strong><small>{selected.currency}</small></summary><details open><summary><span>Kampanya</span><strong>{selected.name}</strong><small>{selected.campaign.status ?? "Durum bilinmiyor"}</small></summary>{selected.campaign.adSets.map((adSet) => <details key={adSet.adSetRef}><summary><span>Reklam seti</span><strong>{adSet.name}</strong><small>{adSet.status ?? "Durum bilinmiyor"} · {adSet.ads.length} reklam</small></summary>{adSet.ads.map((ad) => <div className={styles.canonicalCreativeLeaf} key={ad.adRef}><span>Reklam / kreatif</span><strong>{ad.name}</strong><small>{ad.status ?? "Durum bilinmiyor"} · {ad.creative?.sourceType ?? "kreatif yok"}</small></div>)}</details>)}</details></details></section>
      <div className={styles.copyPreview}><span className={styles.kicker}>AYNALANMIŞ REKLAM METNİ</span><h3>{detailText(selected.campaign)}</h3><p>İçerik yalnız kanıt olarak gösterilir; otomatik künye, öneri veya değişiklik üretmez.</p><footer><span className={styles.statusPill} data-tone="info">Mevcut creative</span></footer></div>
      <CampaignPerformanceEvidencePanel campaignRef={selected.campaignRef} />
    </section>
  </section>;
}
