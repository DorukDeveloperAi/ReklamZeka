"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MetaReadMirrorCampaign, MetaReadMirrorProjection } from "@/domain/meta/read-mirror-projection";
import styles from "./operating-dashboard.module.css";

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

export function CanonicalCampaignPortfolioPanel({ projection, onOpenAgentContext, onOpenDecisionContext }: Readonly<{
  projection: MetaReadMirrorProjection;
  onOpenAgentContext(campaignRef: string, label: string): void;
  onOpenDecisionContext(campaignRef: string, label: string): void;
}>) {
  const entries = useMemo(() => canonicalCampaignPortfolio(projection), [projection]);
  const [selectedRef, setSelectedRef] = useState("");
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusDetailAfterSelectionRef = useRef(false);
  useEffect(() => { setSelectedRef((current) => entries.some((entry) => entry.campaignRef === current) ? current : entries[0]?.campaignRef ?? ""); }, [entries]);
  const selected = entries.find((entry) => entry.campaignRef === selectedRef) ?? entries[0] ?? null;
  useEffect(() => {
    if (!selected || !focusDetailAfterSelectionRef.current) return;
    focusDetailAfterSelectionRef.current = false;
    detailHeadingRef.current?.focus();
  }, [selected]);
  if (!selected) return <section className={styles.panel} aria-label="Kanonik Meta kampanya portföyü"><header className={styles.panelHeader}><div><span className={styles.kicker}>KANONİK META PORTFÖYÜ · SALT-OKUNUR</span><h2>Aynada kampanya yok</h2></div><span className={styles.statusPill} data-tone="neutral">{projection.sourceState}</span></header><p>Bu doğrulanmış kaynakta kampanya bulunmuyor; ekran başka bir portföy kaynağıyla doldurulmaz.</p></section>;
  const ads = selected.campaign.adSets.flatMap((adSet) => adSet.ads);
  const creatives = ads.filter((ad) => ad.creative !== null);
  return <section className={styles.splitWorkspace} aria-label="Kanonik Meta kampanya portföyü">
    <section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>KANONİK META PORTFÖYÜ · SALT-OKUNUR</span><h2>Kampanyalar</h2></div><span className={styles.statusPill} data-tone="good">{entries.length} kampanya</span></header><p>Yerel oturumla bağlanmış Meta aynası. Filtre, öneri, politika veya Meta değişikliği içermez.</p><div className={styles.selectorList}>{entries.map((entry) => <button key={entry.campaignRef} data-active={selected.campaignRef === entry.campaignRef} aria-pressed={selected.campaignRef === entry.campaignRef} type="button" onClick={() => { focusDetailAfterSelectionRef.current = true; setSelectedRef(entry.campaignRef); }}><span><strong>{entry.name}</strong><small>{entry.accountName} · {entry.objective ?? "Amaç bilinmiyor"}</small></span><span className={styles.statusPill} data-tone="neutral">{entry.status ?? "Durum bilinmiyor"}</span></button>)}</div></section>
    <section className={styles.panel}><header className={styles.detailHeader}><div><span className={styles.kicker}>KANONİK KAMPANYA BAĞLAMI</span><h2 ref={detailHeadingRef} tabIndex={-1}>{selected.name}</h2><p>{selected.accountName} · {selected.objective ?? "Meta amacı bilinmiyor"} · {selected.status ?? "Durum bilinmiyor"}</p></div><div className={styles.agentActions}><button type="button" onClick={() => onOpenDecisionContext(selected.campaignRef, selected.name)}>Kararlarda incele</button><button type="button" onClick={() => onOpenAgentContext(selected.campaignRef, selected.name)}>Asistanla aç ✦</button></div></header>
      <div className={styles.contextGrid}><div><span>Bütçe sahibi</span><strong>{selected.campaign.budget.owner}</strong><small>Günlük: {budget(selected.campaign.budget.dailyMinor, selected.currency)}</small></div><div><span>Ömür boyu bütçe</span><strong>{budget(selected.campaign.budget.lifetimeMinor, selected.currency)}</strong><small>Yalnız aynalanmış değer</small></div><div><span>Son gözlem</span><strong>{new Date(selected.campaign.fetchedAt).toLocaleString("tr-TR")}</strong><small>Freshness aynanın kanıtıdır</small></div><div><span>Künye</span><strong>İnsan incelemesi gerekir</strong><small>Kategori kaynağı bu görünümde atanmaz</small></div></div>
      <div className={styles.hierarchy}><div><span>Campaign</span><strong>{selected.name}</strong></div><div><span>Ad set · {selected.campaign.adSets.length}</span><strong>{selected.campaign.adSets.map((adSet) => adSet.name).slice(0, 3).join(" · ") || "Yok"}</strong></div><div><span>Ad · {ads.length}</span><strong>{ads.filter((ad) => ad.status === "ACTIVE").length} active · aynalanmış durum</strong></div><div><span>Creative/post · {creatives.length}</span><strong>{creatives[0]?.creative?.sourceType ?? "Kreatif yok"}</strong></div></div>
      <section className={styles.canonicalHierarchyDrilldown}><header><div><span className={styles.kicker}>HİYERARŞİ · KANONİK AYNADAN</span><h3>Mevcut Meta kurulumu</h3></div><span className={styles.statusPill} data-tone="good">salt-okunur</span></header><details open><summary><span>Hesap</span><strong>{selected.accountName}</strong><small>{selected.currency}</small></summary><details open><summary><span>Kampanya</span><strong>{selected.name}</strong><small>{selected.campaign.status ?? "Durum bilinmiyor"}</small></summary>{selected.campaign.adSets.map((adSet) => <details key={adSet.adSetRef}><summary><span>Reklam seti</span><strong>{adSet.name}</strong><small>{adSet.status ?? "Durum bilinmiyor"} · {adSet.ads.length} reklam</small></summary>{adSet.ads.map((ad) => <div className={styles.canonicalCreativeLeaf} key={ad.adRef}><span>Reklam / kreatif</span><strong>{ad.name}</strong><small>{ad.status ?? "Durum bilinmiyor"} · {ad.creative?.sourceType ?? "kreatif yok"}</small></div>)}</details>)}</details></details></section>
      <div className={styles.copyPreview}><span className={styles.kicker}>AYNALANMIŞ REKLAM METNİ</span><h3>{detailText(selected.campaign)}</h3><p>İçerik yalnız kanıt olarak gösterilir; otomatik künye, öneri veya değişiklik üretmez.</p><footer><span className={styles.statusPill} data-tone="info">Mevcut creative</span></footer></div>
    </section>
  </section>;
}
