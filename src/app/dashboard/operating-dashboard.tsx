"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MetaInventoryApiError, MetaInventorySnapshot } from "@/connectors/meta/types";
import { DecisionRoomPanel } from "./decision-room-panel";
import { BudgetLabPanel } from "./budget-lab-panel";
import { PracticeLabPanel } from "./practice-lab-panel";
import styles from "./operating-dashboard.module.css";

export type OperatingDashboardModel = Readonly<{
  periodDays: number;
  spend: string;
  conversions: number;
  cpa: string;
  roas: string;
  freshnessHours: number;
  freshnessLabel: string;
  currency: string;
  timezone: string;
  attribution: string;
}>;

type ViewId = "today" | "campaigns" | "analysis" | "decision-room" | "practice-lab" | "budgets" | "rules" | "agent" | "approvals" | "timeline" | "meta";
type ApprovalState = "pending" | "approved" | "rejected";
type RuleCard = Readonly<{
  id: string;
  kind: string;
  tone: string;
  title: string;
  scope: string;
  applies: string;
  text: string;
  updated: string;
}>;

const navGroups: ReadonlyArray<Readonly<{ label: string; items: ReadonlyArray<Readonly<{ id: ViewId; label: string; icon: string; badge?: string }>> }>> = [
  { label: "Çalışma", items: [
    { id: "today", label: "Bugün", icon: "⌂", badge: "3" },
    { id: "campaigns", label: "Kampanyalar", icon: "◫" },
    { id: "analysis", label: "Analizler", icon: "⌁", badge: "2" },
    { id: "decision-room", label: "Decision Room", icon: "◇" },
    { id: "budgets", label: "Bütçeler", icon: "₺" },
  ] },
  { label: "Yönetim", items: [
    { id: "rules", label: "Kurallar & akışlar", icon: "≡" },
    { id: "practice-lab", label: "Practice Lab", icon: "◈" },
    { id: "meta", label: "Meta bağlantısı", icon: "◎" },
    { id: "agent", label: "Orchestrator Agent", icon: "✦", badge: "●" },
    { id: "approvals", label: "Onay kuyruğu", icon: "✓", badge: "3" },
    { id: "timeline", label: "Timeline", icon: "↺" },
  ] },
];

const campaigns = [
  { id: "cmp-istanbul", name: "İstanbul · Saç Ekimi · WhatsApp", objective: "OUTCOME_LEADS", category: "Doktor tanıtım", tags: ["İstanbul", "TR", "Prospecting"], spend: "₺318", conversions: 54, cpa: "₺5,89", budget: "₺42.000", health: "İzle", tone: "watch", progress: 74 },
  { id: "cmp-gcc", name: "GCC · Doktor Tanıtım · Leads", objective: "OUTCOME_LEADS", category: "Uluslararası hasta", tags: ["GCC", "AR", "Evergreen"], spend: "₺241", conversions: 42, cpa: "₺5,74", budget: "₺51.000", health: "Stabil", tone: "stable", progress: 63 },
  { id: "cmp-awareness", name: "TR · Marka · Evergreen Awareness", objective: "OUTCOME_AWARENESS", category: "Marka koruma", tags: ["Türkiye", "TR", "No-pause"], spend: "₺136", conversions: 29, cpa: "₺4,69", budget: "₺35.000", health: "Korunan", tone: "protected", progress: 48 },
] as const;

const initialRules: ReadonlyArray<RuleCard> = [
  { id: "rule-geo", kind: "Hard policy", tone: "hard", title: "İstanbul bütçesi taşınamaz", scope: "Kategori · geo_market=istanbul", applies: "6 kampanya", text: "İstanbul kategorisindeki bütçe pahalılaşsa dahi başka bölgeye aktarılmaz. Aylık ₺38.000 taban korunur.", updated: "Bugün · siz" },
  { id: "rule-cadence", kind: "Guidance", tone: "guidance", title: "Learning döneminde sakin kal", scope: "Meta · OUTCOME_LEADS", applies: "12 kampanya", text: "Learning veya 72 saatlik observation window içindeki kampanyalarda acil harcama riski yoksa yeni optimizasyon önermeden önce izle seçeneğini değerlendir.", updated: "Dün · Orchestrator ile" },
  { id: "rule-campaign", kind: "Campaign note", tone: "note", title: "GCC lead kalitesini öncele", scope: "Kampanya · GCC Doktor Tanıtım", applies: "1 kampanya", text: "Meta CPL tek başına başarı değildir. Qualified lead oranı düşüyorsa ucuz lead nedeniyle bütçe artırma.", updated: "3 gün önce · siz" },
];

const analysisRuns = [
  { title: "Günlük portföy kontrolü", schedule: "Her gün · 09:00", scope: "Tüm Meta hesapları", status: "Tamamlandı", result: "2 izle · 1 onay bekliyor", next: "Yarın 09:00" },
  { title: "Bölgesel bütçe ve pacing", schedule: "Pazartesi · 10:30", scope: "geo_market kategorileri", status: "Planlandı", result: "Son koşum: değişiklik yok", next: "10 Ağu 10:30" },
  { title: "Learning sonrası karar", schedule: "after_sync + settle", scope: "lifecycle=learning", status: "Bekliyor", result: "3 kampanya settle döneminde", next: "Kanıt yeterli olduğunda" },
] as const;

const approvalItems = [
  { id: "apr-budget", risk: "K2", title: "GCC günlük bütçesini %8 azalt", entity: "GCC · Doktor Tanıtım · Leads", before: "₺1.700 / gün", after: "₺1.564 / gün", evidence: "Pacing hedefin %14 üzerinde · quality guardrail stabil", policy: "Max değişim %10 · approval_only", dependency: "Yok" },
  { id: "apr-pause", risk: "K2", title: "Yorgun reklamı duraklat", entity: "Ad · AR Testimonial 03", before: "ACTIVE", after: "PAUSED", evidence: "Frequency 4,8 · CTR 7g içinde %31 düştü", policy: "Creative fatigue review · insan onayı", dependency: "Yeni reklam üretmez" },
  { id: "apr-observe", risk: "K1", title: "İstanbul kampanyasını izleme listesine al", entity: "İstanbul · Saç Ekimi · WhatsApp", before: "Normal izleme", after: "48 saat guardrail izleme", evidence: "CPL arttı fakat korunan bölge floor'u aktif", policy: "no-transfer · no-change preferred", dependency: "Meta write yok" },
] as const;

const timeline = [
  { time: "11:42", type: "Analysis", title: "Günlük portföy analizi tamamlandı", detail: "32 kampanya · 4 kategori · 3 karar adayı", actor: "ReklamZeka Worker" },
  { time: "11:39", type: "Data", title: "Deterministik ön işleme güncellendi", detail: "L1 canonical → L4 evidence · coverage %98,7", actor: "Pipeline" },
  { time: "11:31", type: "External", title: "Meta üzerinde harici bütçe değişikliği görüldü", detail: "GCC kampanyası · ₺1.600 → ₺1.700 / gün", actor: "Meta Ads Manager" },
  { time: "10:18", type: "Rule", title: "İstanbul bütçe koruması yayınlandı", detail: "geo_market=istanbul · floor ₺38.000 · no-transfer", actor: "Siz" },
  { time: "09:04", type: "Decision", title: "Evergreen awareness için no-change", detail: "Learning stabil · frequency guardrail içinde", actor: "Orchestrator Agent" },
] as const;

const agentSkills = [
  ["Campaign Context Resolver", "Meta yapısı + iç kategorileri tek effective contextte çözer."],
  ["Analysis Director", "Top-down gündemi ve kanıta bağlı drill-down'ı yönetir."],
  ["Budget Steward", "Hedef, pacing ve korunan tahsislerle senaryo hazırlar."],
  ["Rule Coach", "Talimatlarınızı guidance, policy veya practice olarak netleştirir."],
  ["Cadence Guard", "Learning, cooldown ve no-change kararını korur."],
  ["Action Proposal Builder", "Yetkili otonomiye göre taslak veya onay satırı üretir."],
] as const;

function Icon({ name }: { name: string }) {
  return <span aria-hidden="true" className={styles.navIcon}>{name}</span>;
}

function MiniTrend({ tone = "green" }: { tone?: "green" | "blue" | "amber" }) {
  const points = tone === "blue" ? "0,28 18,24 36,27 54,15 72,18 90,7 108,11" : tone === "amber" ? "0,12 18,8 36,16 54,11 72,23 90,19 108,25" : "0,24 18,20 36,22 54,12 72,15 90,8 108,4";
  return <svg className={styles.miniTrend} viewBox="0 0 108 32" role="img" aria-label="Son dönem eğilimi"><polyline points={points} data-tone={tone} /></svg>;
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={styles.statusPill} data-tone={tone}>{children}</span>;
}

function formatMetaTime(value: string | null) {
  if (!value) return "Bilinmiyor";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value));
}

function compactNumber(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("tr-TR").format(value);
}

export function OperatingDashboard({ model }: { model: OperatingDashboardModel }) {
  const [activeView, setActiveView] = useState<ViewId>("today");
  const [selectedCampaign, setSelectedCampaign] = useState<string>(campaigns[0].id);
  const [rules, setRules] = useState<RuleCard[]>(initialRules.map((rule) => ({ ...rule })));
  const [selectedRuleId, setSelectedRuleId] = useState<string>(rules[0]!.id);
  const selectedRule = rules.find((rule) => rule.id === selectedRuleId) ?? rules[0]!;
  const [ruleDraft, setRuleDraft] = useState<string>(selectedRule.text);
  const [ruleSaved, setRuleSaved] = useState(true);
  const [approvalState, setApprovalState] = useState<Record<string, ApprovalState>>({});
  const [autonomy, setAutonomy] = useState<Record<string, string>>({ analysis: "Otomatik", recommendation: "Otomatik", decrease: "Onaya sun", increase: "Onaya sun", pause: "Onaya sun", create: "Her zaman manuel" });
  const [agentMessages, setAgentMessages] = useState<Array<{ from: "agent" | "user"; text: string }>>([
    { from: "agent", text: "Portföy bağlamı hazır. Bugün üç karar adayı var; İstanbul bütçe koruması nedeniyle bir değişikliği özellikle bastırdım." },
  ]);
  const [agentInput, setAgentInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [metaInventory, setMetaInventory] = useState<MetaInventorySnapshot | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const pendingApprovals = approvalItems.filter((item) => !approvalState[item.id]).length;
  const currentCampaign = campaigns.find((campaign) => campaign.id === selectedCampaign) ?? campaigns[0];
  const activeTitle = useMemo(() => navGroups.flatMap((group) => group.items).find((item) => item.id === activeView)?.label ?? "Bugün", [activeView]);

  const refreshMetaInventory = useCallback(async (announce = false) => {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const response = await fetch("/api/meta/inventory", { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json() as MetaInventoryApiError;
        throw new Error(payload.error?.message ?? "Meta envanteri yenilenemedi");
      }
      const snapshot = await response.json() as MetaInventorySnapshot;
      setMetaInventory(snapshot);
      if (announce) setToast(`Meta envanteri yenilendi: ${snapshot.summary.adAccounts} hesap · ${snapshot.summary.pages} sayfa · ${snapshot.audit.writeOperations} write.`);
    } catch (error) {
      setMetaError(error instanceof Error ? error.message : "Meta envanteri yenilenemedi");
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMetaInventory();
    const timer = window.setInterval(() => void refreshMetaInventory(), 15 * 60_000);
    return () => window.clearInterval(timer);
  }, [refreshMetaInventory]);

  function navigate(view: ViewId) {
    setActiveView(view);
    setToast(null);
  }

  function selectRule(id: string) {
    const next = rules.find((rule) => rule.id === id);
    if (!next) return;
    setSelectedRuleId(id);
    setRuleDraft(next.text);
    setRuleSaved(true);
  }

  function saveRule() {
    setRules((current) => current.map((rule) => rule.id === selectedRuleId ? { ...rule, text: ruleDraft, updated: "Şimdi · siz" } : rule));
    setRuleSaved(true);
    setToast("Talimat yeni taslak sürüm olarak kaydedildi. Yayınlanmadan eylemleri değiştirmez.");
  }

  function setApproval(id: string, state: ApprovalState) {
    setApprovalState((current) => ({ ...current, [id]: state }));
    setToast(state === "approved" ? "ActionUnit onaylandı; approval execute değildir. Demo modunda Meta write kapalı." : "ActionUnit reddedildi ve bağımlı adımlar durduruldu.");
  }

  function sendAgentMessage() {
    const text = agentInput.trim();
    if (!text) return;
    setAgentMessages((current) => [...current, { from: "user", text }, { from: "agent", text: "Bu talebi önce kampanya kapsamı, mevcut talimatlar ve otonomi valfiyle karşılaştıracağım. Bağlayıcı bir kural gerekiyorsa doğrudan uygulamak yerine guidance/policy ayrımını ve etki önizlemesini birlikte netleştireceğiz." }]);
    setAgentInput("");
  }

  function renderToday() {
    return <>
      <section className={styles.pageHero}>
        <div><span className={styles.kicker}>7 AĞUSTOS CUMA · OPERATING REVIEW</span><h1>Günaydın. Sistem sakin, üç karar sizi bekliyor.</h1><p>Veriler işlendi, kategori ve talimatlar uygulandı. Hiçbir Meta değişikliği onayınız olmadan yürütülmez.</p></div>
        <button className={styles.primaryButton} onClick={() => navigate("agent")}><span>✦</span> Orchestrator ile çalış</button>
      </section>

      <section className={styles.signalStrip} aria-label="Sistem durumu">
        <div><span className={styles.liveDot} /> <strong>Pipeline güncel</strong><small>{Math.round(model.freshnessHours)} saat önce · L0→L4 tamam</small></div>
        <div><strong>32 aktif kampanya</strong><small>4 hesap · 11 iç kategori</small></div>
        <div><strong>Otonomi: approval_only</strong><small>K1–K4 onaya sunulur</small></div>
        <button onClick={() => navigate("timeline")}>Tüm timeline <span>→</span></button>
      </section>

      <section className={styles.metricGrid} aria-label="Temel metrikler">
        <article className={styles.metricCard}><div><span>{model.periodDays} günlük harcama</span><StatusPill tone="good">Plan içinde</StatusPill></div><strong>{model.spend}</strong><footer><span>Önceki döneme göre +%6,4</span><MiniTrend /></footer></article>
        <article className={styles.metricCard}><div><span>Sonuç</span><StatusPill tone="info">Meta proxy</StatusPill></div><strong>{model.conversions}</strong><footer><span>CPA {model.cpa}</span><MiniTrend tone="blue" /></footer></article>
        <article className={styles.metricCard}><div><span>Nitelikli lead</span><StatusPill tone="good">Manual signal</StatusPill></div><strong>82</strong><footer><span>%65,6 qualification</span><MiniTrend /></footer></article>
        <article className={styles.metricCard}><div><span>Planlanan aylık bütçe</span><StatusPill tone="neutral">Ağu</StatusPill></div><strong>₺128.000</strong><footer><span>%34,1 gerçekleşti</span><div className={styles.tinyProgress}><i style={{ width: "34%" }} /></div></footer></article>
      </section>

      <div className={styles.dashboardColumns}>
        <section className={styles.panel} aria-labelledby="decision-title">
          <header className={styles.panelHeader}><div><span className={styles.kicker}>KARAR MASASI</span><h2 id="decision-title">Öncelikli kararlar</h2></div><button onClick={() => navigate("approvals")}>Tümünü gör <span>→</span></button></header>
          <div className={styles.decisionList}>
            {approvalItems.map((item, index) => <article key={item.id} className={styles.decisionRow}>
              <div className={styles.decisionIndex}>0{index + 1}</div>
              <div className={styles.decisionBody}><div><StatusPill tone={item.risk === "K1" ? "info" : "warning"}>{item.risk}</StatusPill><span>{item.entity}</span></div><h3>{item.title}</h3><p>{item.evidence}</p><small>{item.policy}</small></div>
              <div className={styles.decisionAction}>{approvalState[item.id] ? <StatusPill tone={approvalState[item.id] === "approved" ? "good" : "danger"}>{approvalState[item.id] === "approved" ? "Onaylandı" : "Reddedildi"}</StatusPill> : <><button onClick={() => setApproval(item.id, "approved")}>Onayla</button><button className={styles.iconButton} onClick={() => navigate("approvals")} aria-label={`${item.title} ayrıntısı`}>→</button></>}</div>
            </article>)}
          </div>
        </section>

        <aside className={`${styles.panel} ${styles.agentCard}`}>
          <div className={styles.agentGlow} />
          <header><span className={styles.agentMark}>✦</span><div><span className={styles.kicker}>REKLAMZEKA ORCHESTRATOR</span><h2>Agent session hazır</h2></div><StatusPill tone="good">Bağlı</StatusPill></header>
          <p>Codex CLI · workspace context senkronize · 6 skill aktif</p>
          <div className={styles.agentContext}><span>Aktif bağlam</span><strong>Tüm Meta portföyü</strong><small>11 kategori · 18 guidance · 7 policy · 4 experiment</small></div>
          <blockquote>“İstanbul kampanyasında CPL yükseldi; fakat no-transfer ve korunan floor nedeniyle bütçe taşıma önermedim. 48 saat izle daha güvenli.”</blockquote>
          <div className={styles.agentActions}><button className={styles.primaryButton} onClick={() => navigate("agent")}>Session'ı aç</button><button onClick={() => { setToast("Dashboard bağlamı için kısa ömürlü handoff hazırlandı."); navigate("agent"); }}>Codex'te devam et</button></div>
        </aside>
      </div>

      <section className={styles.panel} aria-labelledby="portfolio-title">
        <header className={styles.panelHeader}><div><span className={styles.kicker}>PORTFÖY</span><h2 id="portfolio-title">Kampanya sağlığı</h2></div><button onClick={() => navigate("campaigns")}>32 kampanyayı aç <span>→</span></button></header>
        <div className={styles.campaignTable} role="table" aria-label="Kampanya sağlığı">
          <div className={styles.tableHead} role="row"><span>Kampanya ve bağlam</span><span>7g harcama</span><span>Sonuç</span><span>CPA</span><span>Aylık bütçe</span><span>Durum</span></div>
          {campaigns.map((campaign) => <button key={campaign.id} className={styles.tableRow} role="row" onClick={() => { setSelectedCampaign(campaign.id); navigate("campaigns"); }}>
            <span className={styles.campaignIdentity}><strong>{campaign.name}</strong><small>{campaign.objective} · {campaign.category}</small><i>{campaign.tags.join(" · ")}</i></span><span>{campaign.spend}</span><span>{campaign.conversions}</span><span>{campaign.cpa}</span><span><strong>{campaign.budget}</strong><i className={styles.rowProgress}><b style={{ width: `${campaign.progress}%` }} /></i></span><span><StatusPill tone={campaign.tone}>{campaign.health}</StatusPill></span>
          </button>)}
        </div>
      </section>
    </>;
  }

  function renderCampaigns() {
    return <>
      <section className={styles.pageHero}><div><span className={styles.kicker}>META PORTFÖYÜ</span><h1>Kampanyayı metrikten önce bağlamıyla okuyun.</h1><p>Meta objective, reklam seti yapısı, mevcut kreatifler ve iç kategoriler aynı karar yüzeyinde.</p></div><button className={styles.primaryButton} onClick={() => navigate("analysis")}>Yeni analiz</button></section>
      <div className={styles.splitWorkspace}>
        <section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>32 AKTİF</span><h2>Kampanyalar</h2></div><StatusPill tone="good">%98,7 coverage</StatusPill></header><div className={styles.selectorList}>{campaigns.map((campaign) => <button key={campaign.id} data-active={selectedCampaign === campaign.id} onClick={() => setSelectedCampaign(campaign.id)}><span><strong>{campaign.name}</strong><small>{campaign.objective}</small></span><StatusPill tone={campaign.tone}>{campaign.health}</StatusPill></button>)}</div></section>
        <section className={styles.panel}><header className={styles.detailHeader}><div><span className={styles.kicker}>EFFECTIVE CAMPAIGN CONTEXT</span><h2>{currentCampaign.name}</h2><p>{currentCampaign.objective} · Campaign budget · 7d click / 1d view</p></div><button onClick={() => navigate("agent")}>Agent ile aç ✦</button></header>
          <div className={styles.contextGrid}><div><span>İç kategori</span><strong>{currentCampaign.category}</strong><small>{currentCampaign.tags.join(" · ")}</small></div><div><span>Bütçe sahibi</span><strong>Campaign / CBO</strong><small>{currentCampaign.budget} aylık plan</small></div><div><span>Karar temposu</span><strong>72 saat observation</strong><small>Son hamle: 31 saat önce</small></div><div><span>Aktif koruma</span><strong>{currentCampaign.id === "cmp-istanbul" ? "no-transfer · floor" : "max-change %10"}</strong><small>Policy v4 · yayınlandı</small></div></div>
          <div className={styles.hierarchy}><div><span>Campaign</span><strong>{currentCampaign.name}</strong></div><div><span>Ad set · 3</span><strong>Broad · Remarketing · LAL</strong></div><div><span>Ad · 8</span><strong>6 active · 1 learning · 1 paused</strong></div><div><span>Creative/post</span><strong>5 mevcut asset · yeni üretim yok</strong></div></div>
          <div className={styles.copyPreview}><span className={styles.kicker}>YAYINDAKİ REKLAM METNİ</span><h3>Saç ekimi hakkında merak ettiklerinizi uzman ekibimize sorun.</h3><p>Primary text · CTA: WhatsApp'tan mesaj gönder · Instagram post bağlı</p><footer><StatusPill tone="info">Mevcut creative</StatusPill><button>Performansını incele</button></footer></div>
        </section>
      </div>
    </>;
  }

  function renderAnalysis() {
    return <>
      <section className={styles.pageHero}><div><span className={styles.kicker}>ANALYSIS ROOM</span><h1>Anlık ve zamanlanmış analiz, aynı kanıt hattında.</h1><p>Timeframe başka, çalışma zamanı başkadır. Her koşum category, guidance, cadence ve outcome bağlamını dondurur.</p></div><button className={styles.primaryButton} onClick={() => setToast("Yeni analiz taslağı açıldı: kapsam ve karar sorusu bekleniyor.")}>+ Analiz oluştur</button></section>
      <section className={styles.analysisBuilder}><div><span>Kapsam</span><strong>Tüm Meta hesapları</strong><small>4 hesap · 32 kampanya</small></div><div><span>Timeframe</span><strong>Son 7 gün ↔ önceki 7 gün</strong><small>Europe/Istanbul</small></div><div><span>Agenda</span><strong>Genel → kategori → campaign</strong><small>10 pass · bounded drill-down</small></div><div><span>Karar profili</span><strong>Stable efficiency</strong><small>no-change zorunlu seçenek</small></div><button onClick={() => setToast("Dry-run analiz kuyruğa alındı. Meta write yetkisi yok.")}>Dry-run çalıştır →</button></section>
      <section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>SCHEDULED ANALYSIS</span><h2>Analiz rutinleri</h2></div><button>Takvimi yönet</button></header><div className={styles.runList}>{analysisRuns.map((run) => <article key={run.title}><div><StatusPill tone={run.status === "Tamamlandı" ? "good" : "neutral"}>{run.status}</StatusPill><h3>{run.title}</h3><p>{run.scope}</p></div><dl><div><dt>Çalışma</dt><dd>{run.schedule}</dd></div><div><dt>Sonuç</dt><dd>{run.result}</dd></div><div><dt>Sonraki</dt><dd>{run.next}</dd></div></dl><button>Detay →</button></article>)}</div></section>
    </>;
  }

  function renderRules() {
    return <>
      <section className={styles.pageHero}><div><span className={styles.kicker}>RULES & PLAYBOOKS</span><h1>İşletme yaklaşımınız görünür, düzenlenebilir ve sürümlü.</h1><p>Düz metin guidance kolayca saklanır; harcama veya yetkiyi bağlayan policy ancak review ve yayınla çalışır.</p></div><button className={styles.primaryButton} onClick={() => navigate("agent")}>✦ Agent ile kural tasarla</button></section>
      <div className={styles.ruleWorkspace}>
        <section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>18 GUIDANCE · 7 POLICY</span><h2>Talimat setleri</h2></div><button>+ Yeni</button></header><div className={styles.selectorList}>{rules.map((rule) => <button key={rule.id} data-active={selectedRuleId === rule.id} onClick={() => selectRule(rule.id)}><span><strong>{rule.title}</strong><small>{rule.scope}</small></span><StatusPill tone={rule.tone}>{rule.kind}</StatusPill></button>)}</div></section>
        <section className={styles.ruleEditor}><header><div><StatusPill tone={selectedRule.tone}>{selectedRule.kind}</StatusPill><h2>{selectedRule.title}</h2><p>{selectedRule.scope} · {selectedRule.applies}</p></div><span>{selectedRule.updated}</span></header><label htmlFor="rule-text">Talimat metni</label><textarea id="rule-text" value={ruleDraft} onChange={(event) => { setRuleDraft(event.target.value); setRuleSaved(false); }} /><div className={styles.ruleMeta}><div><span>Otorite</span><strong>{selectedRule.kind === "Hard policy" ? "Owner instruction · bağlayıcı" : "Owner guidance · analitik"}</strong></div><div><span>Çakışma</span><strong>Yok</strong></div><div><span>Uygulama nedeni</span><strong>Scope + category match</strong></div></div><footer><button>Arşivle</button><span>{ruleSaved ? "Tüm değişiklikler kaydedildi" : "Kaydedilmemiş değişiklik"}</span><button className={styles.primaryButton} onClick={saveRule} disabled={ruleSaved}>Taslağı kaydet</button></footer></section>
      </div>
    </>;
  }

  function renderAgent() {
    return <>
      <section className={styles.pageHero}><div><span className={styles.kicker}>REKLAMZEKA ORCHESTRATOR</span><h1>Tek agent, farklı vendor; aynı yetki ve karar sözleşmesi.</h1><p>Codex veya Claude session'ı değişebilir. Kampanya bağlamı, kurallar, skill'ler ve otonomi valfi ReklamZeka'da kalır.</p></div><StatusPill tone="good">● Codex CLI bağlı</StatusPill></section>
      <div className={styles.agentWorkspace}>
        <section className={styles.agentChat}><header><div><span className={styles.agentMark}>✦</span><div><strong>Orchestrator Session</strong><small>Workspace: Demo Marka · Tüm Meta portföyü</small></div></div><button onClick={() => setToast("Yeni kısa ömürlü context handoff oluşturuldu.")}>Handoff yenile</button></header><div className={styles.chatMessages}>{agentMessages.map((message, index) => <div key={`${message.from}-${index}`} data-from={message.from}><span>{message.from === "agent" ? "RZ" : "Siz"}</span><p>{message.text}</p></div>)}</div><div className={styles.chatComposer}><textarea aria-label="Orchestrator'a mesaj" placeholder="Örn. İstanbul kategorisi için bütçe karar yaklaşımını birlikte netleştirelim…" value={agentInput} onChange={(event) => setAgentInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendAgentMessage(); } }} /><button onClick={sendAgentMessage}>Gönder ↑</button></div><footer>Agent yalnız read/draft/proposal araçlarına erişir · L0 raw ve Meta writer yok</footer></section>
        <aside className={styles.agentConfiguration}><section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>SKILL PACK</span><h2>Aktif roller</h2></div><StatusPill tone="good">6 aktif</StatusPill></header><div className={styles.skillList}>{agentSkills.map(([name, description]) => <article key={name}><span>✦</span><div><strong>{name}</strong><p>{description}</p></div></article>)}</div></section><section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>AUTONOMY VALVE</span><h2>Hareket özgürlüğü</h2></div><StatusPill tone="warning">approval_only</StatusPill></header><div className={styles.autonomyList}>{Object.entries({ analysis: "Analiz çalıştır", recommendation: "Öneri hazırla", decrease: "Bütçe azalt", increase: "Bütçe artır", pause: "Kampanya/reklam duraklat", create: "Post promotion oluştur" }).map(([key, label]) => <label key={key}><span>{label}</span><select value={autonomy[key]} onChange={(event) => setAutonomy((current) => ({ ...current, [key]: event.target.value }))}><option>Otomatik</option><option>Onaya sun</option><option>Her zaman manuel</option></select></label>)}</div><small className={styles.safetyNote}>Alt kapsam yalnız özgürlüğü daraltabilir. K3/K4 her zaman insan onaylıdır.</small></section></aside>
      </div>
    </>;
  }

  function renderApprovals() {
    return <>
      <section className={styles.pageHero}><div><span className={styles.kicker}>APPROVAL INBOX</span><h1>Her hareketi tek tek görün, tek tek karar verin.</h1><p>Onay, execute değildir. Önce/sonra, kanıt, policy ve dependency her ActionUnit üzerinde dondurulur.</p></div><StatusPill tone="warning">{pendingApprovals} bekliyor</StatusPill></section>
      <section className={styles.approvalList}>{approvalItems.map((item) => <article key={item.id} data-state={approvalState[item.id] ?? "pending"}><header><div><StatusPill tone={item.risk === "K1" ? "info" : "warning"}>{item.risk}</StatusPill><span>{item.entity}</span></div><StatusPill tone="neutral">approval_only</StatusPill></header><h2>{item.title}</h2><div className={styles.beforeAfter}><div><span>Önce</span><strong>{item.before}</strong></div><span>→</span><div><span>Sonra</span><strong>{item.after}</strong></div></div><dl><div><dt>Kanıt</dt><dd>{item.evidence}</dd></div><div><dt>Policy</dt><dd>{item.policy}</dd></div><div><dt>Bağımlılık</dt><dd>{item.dependency}</dd></div></dl><footer>{approvalState[item.id] ? <><StatusPill tone={approvalState[item.id] === "approved" ? "good" : "danger"}>{approvalState[item.id] === "approved" ? "Onaylandı · execute bekliyor" : "Reddedildi"}</StatusPill>{approvalState[item.id] === "approved" ? <button onClick={() => setToast("Demo modunda Meta execute kapalı. Production write S4 valfi sonrasında açılacak.")}>Execute incele</button> : null}</> : <><button onClick={() => setApproval(item.id, "rejected")}>Reddet</button><button>Değişiklik iste</button><button className={styles.primaryButton} onClick={() => setApproval(item.id, "approved")}>Onayla</button></>}</footer></article>)}</section>
    </>;
  }

  function renderMetaConnection() {
    if (!metaInventory) {
      return <>
        <section className={styles.pageHero}><div><span className={styles.kicker}>META READ MIRROR</span><h1>Meta erişim envanteri hazırlanıyor.</h1><p>Token yalnız sunucu tarafında okunur; dashboard ve agent bağlamına hiçbir zaman eklenmez.</p></div><button className={styles.primaryButton} disabled={metaLoading} onClick={() => void refreshMetaInventory(true)}>{metaLoading ? "Kontrol ediliyor…" : "Yeniden dene"}</button></section>
        <section className={`${styles.panel} ${styles.metaEmpty}`}><StatusPill tone={metaError ? "danger" : "neutral"}>{metaError ? "Bağlantı hatası" : "Salt okunur keşif"}</StatusPill><h2>{metaError ?? "Meta Graph yanıtı bekleniyor"}</h2><p>Hiçbir kampanya, bütçe, reklam seti veya reklam değiştirilmiyor.</p></section>
      </>;
    }

    const inventory = metaInventory;
    return <>
      <section className={styles.pageHero}>
        <div><span className={styles.kicker}>META READ MIRROR · {inventory.connection.graphApiVersion}</span><h1>Hangi varlığa erişebildiğimiz açık ve doğrulanmış.</h1><p>İzin kapsamı, canlı erişim ve ReklamZeka’da etkin yetenek birbirinden ayrıdır. Tam Meta ID’leri bu yüzeye çıkmaz.</p></div>
        <button className={styles.primaryButton} disabled={metaLoading} onClick={() => void refreshMetaInventory(true)}>{metaLoading ? "Yenileniyor…" : "Envanteri yenile"}</button>
      </section>

      {inventory.connection.securityStatus === "temporary_exposed" ? <section className={styles.securityBanner}><span>!</span><div><strong>Geçici ve riskli kimlik bilgisi</strong><p>Bu token daha önce terminal çıktısında göründü. Salt okunur kullanım zorlanıyor; ilk bakım adımı token rotasyonu olmalı.</p></div><StatusPill tone="warning">Rotation gerekli</StatusPill></section> : null}

      <section className={styles.metaMetricGrid} aria-label="Meta erişim özeti">
        <article><span>Reklam hesabı</span><strong>{inventory.summary.adAccounts}</strong><small>{inventory.summary.accountsWithCampaigns} hesapta kampanya var</small></article>
        <article><span>Facebook sayfası</span><strong>{inventory.summary.pages}</strong><small>pages_show_list ile doğrulandı</small></article>
        <article><span>Bağlı Instagram</span><strong>{inventory.summary.linkedInstagramAccounts}</strong><small>Profesyonel hesap ilişkisi</small></article>
        <article><span>Kampanya / Ad set / Ad</span><strong>{compactNumber(inventory.summary.campaigns)}</strong><small>{compactNumber(inventory.summary.adSets)} ad set · {compactNumber(inventory.summary.ads)} reklam</small></article>
      </section>

      <section className={styles.metaConnectionBar}>
        <div><span className={styles.liveDot} /><p><strong>Token geçerli · read_only</strong><small>Son kontrol {formatMetaTime(inventory.refreshedAt)}</small></p></div>
        <div><span>Sona erme</span><strong>{formatMetaTime(inventory.connection.expiresAt)}</strong></div>
        <div><span>Sonraki otomatik kontrol</span><strong>{formatMetaTime(inventory.nextAutomaticRefreshAt)}</strong></div>
        <div><span>Audit</span><strong>{inventory.audit.action} · {inventory.audit.writeOperations} write</strong></div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}><div><span className={styles.kicker}>CAPABILITY MATRIX</span><h2>Yetki, doğrulama ve etkinlik</h2></div><StatusPill tone="good">GET-only connector</StatusPill></header>
        <div className={styles.capabilityTable} role="table" aria-label="Meta yetenekleri">
          <div className={styles.capabilityHead} role="row"><span>Yetenek</span><span>Token izni</span><span>Canlı doğrulama</span><span>ReklamZeka’da etkin</span><span>Açıklama</span></div>
          {inventory.capabilities.map((capability) => <div className={styles.capabilityRow} role="row" key={capability.id}><strong>{capability.label}</strong><StatusPill tone={capability.granted ? "good" : "neutral"}>{capability.granted ? "Var" : "Yok"}</StatusPill><StatusPill tone={capability.verified ? "info" : "neutral"}>{capability.verified ? "Doğrulandı" : "Çalıştırılmadı"}</StatusPill><StatusPill tone={capability.enabled ? "good" : "danger"}>{capability.enabled ? "Açık" : "Kapalı"}</StatusPill><small>{capability.note}</small></div>)}
        </div>
      </section>

      <div className={styles.metaInventoryColumns}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span className={styles.kicker}>AD ACCOUNTS</span><h2>Erişilebilir reklam hesapları</h2></div><span>{inventory.accounts.length} hesap</span></header>
          <div className={styles.metaAccountList}>{inventory.accounts.map((account) => <details key={account.id}><summary><div><strong>{account.name}</strong><small>{account.id} · {account.currency ?? "—"} · {account.timezone ?? "—"}</small></div><StatusPill tone={account.status === "ACTIVE" ? "good" : "warning"}>{account.status}</StatusPill><div><strong>{compactNumber(account.campaignCount)}</strong><small>kampanya</small></div></summary><div className={styles.metaAccountDetail}><dl><div><dt>Campaign</dt><dd>{compactNumber(account.campaignCount)}</dd></div><div><dt>Ad set</dt><dd>{compactNumber(account.adSetCount)}</dd></div><div><dt>Ad</dt><dd>{compactNumber(account.adCount)}</dd></div><div><dt>Insights</dt><dd>{account.insightAccess.verified ? `${account.insightAccess.dateStart ?? "7g"} → ${account.insightAccess.dateStop ?? "bugün"}` : "Doğrulanamadı"}</dd></div></dl>{account.campaignExamples.length ? <div><span className={styles.kicker}>KAMPANYA ÖRNEKLERİ</span>{account.campaignExamples.map((campaign) => <p key={campaign.id}><strong>{campaign.name}</strong><small>{campaign.status} · {campaign.objective ?? "objective yok"} · {campaign.id}</small></p>)}</div> : <p>Bu hesapta kampanya bulunamadı.</p>}{account.adCopyExamples.some((ad) => ad.body || ad.title || ad.instagramPermalink) ? <div><span className={styles.kicker}>OKUNABİLEN REKLAM METİNLERİ</span>{account.adCopyExamples.filter((ad) => ad.body || ad.title || ad.instagramPermalink).slice(0, 2).map((ad) => <blockquote key={ad.id}><strong>{ad.title ?? ad.name}</strong><p>{ad.body ?? "Metin yok; mevcut gönderi bağlantısı okunabiliyor."}</p>{ad.instagramPermalink ? <a href={ad.instagramPermalink} target="_blank" rel="noreferrer">Instagram gönderisini aç ↗</a> : null}</blockquote>)}</div> : null}</div></details>)}</div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span className={styles.kicker}>PAGES & INSTAGRAM</span><h2>Sayfa bağlantıları</h2></div><StatusPill tone="info">{inventory.summary.linkedInstagramAccounts} IG bağlı</StatusPill></header>
          <div className={styles.metaPageList}>{inventory.pages.map((page) => <article key={page.id}><div><strong>{page.name}</strong><small>{page.category ?? "Kategori yok"} · {page.id}</small></div><div><span>{page.followers === null ? "—" : compactNumber(page.followers)}</span><small>takipçi</small></div>{page.instagram ? <div className={styles.instagramIdentity}><span>◎</span><p><strong>@{page.instagram.username ?? "kullanıcı-adı-yok"}</strong><small>{page.instagram.name ?? page.instagram.id}</small></p></div> : <StatusPill tone="neutral">IG bağı yok</StatusPill>}</article>)}</div>
        </section>
      </div>

      {inventory.errors.length || metaError ? <section className={styles.metaErrors}><strong>Kısmi erişim notları</strong>{metaError ? <p>{metaError}</p> : null}{inventory.errors.map((error) => <p key={`${error.resource}-${error.message}`}><span>{error.resource}</span>{error.message}</p>)}</section> : null}

      <section className={styles.scopeDisclosure}><div><span>Token kapsamları</span><p>{inventory.connection.grantedScopes.join(" · ")}</p></div><strong>Scope ≠ execute yetkisi</strong></section>
    </>;
  }

  function renderTimeline() {
    return <><section className={styles.pageHero}><div><span className={styles.kicker}>APPEND-ONLY TIMELINE</span><h1>Veri, karar ve hareket aynı kronolojide.</h1><p>Sync'ten outcome'a kadar bizim ve Meta üzerindeki harici değişikliklerin tamamı tek izde.</p></div><button className={styles.secondaryButton}>Filtrele</button></section><section className={styles.panel}><div className={styles.timeline}>{timeline.map((event) => <article key={`${event.time}-${event.title}`}><time>{event.time}</time><span className={styles.timelineDot} data-type={event.type} /><div><StatusPill tone="neutral">{event.type}</StatusPill><h2>{event.title}</h2><p>{event.detail}</p><small>{event.actor}</small></div><button aria-label={`${event.title} detayını aç`}>→</button></article>)}</div></section></>;
  }

  const content = activeView === "today" ? renderToday() : activeView === "campaigns" ? renderCampaigns() : activeView === "analysis" ? renderAnalysis() : activeView === "decision-room" ? <DecisionRoomPanel /> : activeView === "practice-lab" ? <PracticeLabPanel /> : activeView === "budgets" ? <BudgetLabPanel /> : activeView === "rules" ? renderRules() : activeView === "meta" ? renderMetaConnection() : activeView === "agent" ? renderAgent() : activeView === "approvals" ? renderApprovals() : renderTimeline();

  return <main className={styles.appShell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><span>RZ</span><div><strong>ReklamZeka</strong><small>Operating System</small></div><i>DEMO</i></div>
      <nav aria-label="Ana navigasyon">{navGroups.map((group) => <div key={group.label}><span>{group.label}</span>{group.items.map((item) => <button key={item.id} data-active={activeView === item.id} onClick={() => navigate(item.id)}><Icon name={item.icon} /><strong>{item.label}</strong>{item.badge ? <i data-live={item.badge === "●"}>{item.badge === "3" && item.id === "approvals" ? pendingApprovals : item.badge}</i> : null}</button>)}</div>)}</nav>
      <div className={styles.sidebarFooter}><span className={styles.liveDot} /><div><strong>Meta Mirror</strong><small>{metaInventory ? `${metaInventory.summary.adAccounts} hesap · read-only` : `${model.freshnessLabel} · kontrol ediliyor`}</small></div><button aria-label="Bağlantı ayarları" onClick={() => navigate("meta")}>•••</button></div>
    </aside>
    <section className={styles.workspace}>
      <header className={styles.topbar}><div className={styles.mobileBrand}><span>RZ</span><strong>ReklamZeka</strong></div><button className={styles.workspacePicker} onClick={() => navigate("meta")}><span className={styles.avatar}>DM</span><span><strong>Demo Marka</strong><small>{metaInventory ? `${metaInventory.summary.adAccounts} Meta hesabı` : "Meta kontrol ediliyor"}</small></span><i>⌄</i></button><div className={styles.topActions}><button aria-label="Ara">⌕</button><button aria-label="Bildirimler">♢<i>{pendingApprovals}</i></button><button className={styles.autonomyButton} onClick={() => navigate("agent")}><span className={styles.liveDot} /> approval_only <i>⌄</i></button><button className={styles.profileButton}>AY</button></div></header>
      <div className={styles.mobileNav}>{navGroups.flatMap((group) => group.items).map((item) => <button key={item.id} data-active={activeView === item.id} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</div>
      <div className={styles.content} aria-label={activeTitle}>{content}</div>
      <footer className={styles.sourceFooter}><span>{activeView === "meta" && metaInventory ? `Canlı Meta Graph · ${formatMetaTime(metaInventory.refreshedAt)} · ${metaInventory.connection.accessMode}` : activeView === "decision-room" ? "Decision Room read model · canlı kaynak bağlanmadan fixture kullanılmaz" : activeView === "practice-lab" ? "Practice Lab read model · append-only lifecycle doğrulaması" : activeView === "budgets" ? "Budget Lab read model · doğrulanmış proposal ledger" : `Demo snapshot · ${model.currency} · ${model.timezone} · ${model.attribution}`}</span><span>{activeView === "meta" ? "Kimlikler maskeli · token server-only · write connector yok" : activeView === "decision-room" ? "Server-bound workspace · bounded cursor · action authority yok" : activeView === "practice-lab" ? "Public-safe projection · draft ephemeral · promotion/automation/action yok" : activeView === "budgets" ? "Public-safe projection · draft/approval/execute/Meta yok" : "Deterministik veriler mevcut fixture/API'dan; operasyon bağlamı ürün vizyonu demosudur."}</span></footer>
    </section>
    {toast ? <div className={styles.toast} role="status"><span>✓</span><p>{toast}</p><button onClick={() => setToast(null)} aria-label="Bildirimi kapat">×</button></div> : null}
  </main>;
}
