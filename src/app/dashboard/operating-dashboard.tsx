"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MetaInventoryApiError, MetaInventorySnapshot } from "@/connectors/meta/types";
import { DecisionRoomPanel } from "./decision-room-panel";
import { BudgetLabPanel } from "./budget-lab-panel";
import { PracticeLabPanel } from "./practice-lab-panel";
import { ApprovalQueuePanel } from "./approval-queue-panel";
import { PromotionPreflightPanel } from "./promotion-preflight-panel";
import { AutonomyStudioPanel } from "./autonomy-studio-panel";
import { GuidanceStudioPanel } from "./guidance-studio-panel";
import { CategoryInventoryPanel } from "./category-inventory-panel";
import { InstructionPolicyStudioPanel } from "./instruction-policy-studio-panel";
import { CampaignPlanningBriefPanel, type CampaignPlanningBriefContext } from "./campaign-planning-brief-panel";
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

export type DashboardViewId = "today" | "campaigns" | "analysis" | "decision-room" | "practice-lab" | "budgets" | "rules" | "strict-policies" | "categories" | "autonomy" | "agent" | "approvals" | "promotions" | "timeline" | "meta";
type ViewId = DashboardViewId;

type AgentSessionSummary = Readonly<{
  clientRef: string;
  sessionRef: string;
  transport: "deterministic_fixture" | "project_stdio" | "loopback_http";
  workspaceRef: string;
  startedAt: string;
  lastSeenAt: string;
  expiresAt: string;
}>;
type AgentHandoffSummary = Readonly<{
  handoffRef: string;
  targetSessionRef: string;
  createdAt: string;
  expiresAt: string;
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
    { id: "strict-policies", label: "Strict policies", icon: "§" },
    { id: "categories", label: "İç kategoriler", icon: "⊞" },
    { id: "autonomy", label: "Autonomy Studio", icon: "◉" },
    { id: "practice-lab", label: "Practice Lab", icon: "◈" },
    { id: "meta", label: "Meta bağlantısı", icon: "◎" },
    { id: "agent", label: "Orchestrator Agent", icon: "✦", badge: "●" },
    { id: "approvals", label: "Onay kuyruğu", icon: "✓" },
    { id: "promotions", label: "Gönderi öne çıkarma", icon: "↗" },
    { id: "timeline", label: "Timeline", icon: "↺" },
  ] },
];

const campaigns = [
  { id: "cmp-istanbul", name: "İstanbul · Saç Ekimi · WhatsApp", objective: "OUTCOME_LEADS", category: "Doktor tanıtım", tags: ["İstanbul", "TR", "Prospecting"], spend: "₺318", conversions: 54, cpa: "₺5,89", budget: "₺42.000", health: "İzle", tone: "watch", progress: 74, planningContext: { campaignRef: "cmp_istanbul", persistedCampaignRef: null, campaignLabel: "İstanbul · Saç Ekimi · WhatsApp", input: { businessGoal: "lead_acquisition", market: "domestic", language: "tr", serviceRef: "service_hair_transplant", countryOrRegion: null, conversionRoute: "whatsapp", deliveryHealth: "healthy", classification: "classified", capacity: "confirmed", creativeReady: true } } },
  { id: "cmp-gcc", name: "GCC · Doktor Tanıtım · Leads", objective: "OUTCOME_LEADS", category: "Uluslararası hasta", tags: ["GCC", "AR", "Evergreen"], spend: "₺241", conversions: 42, cpa: "₺5,74", budget: "₺51.000", health: "Stabil", tone: "stable", progress: 63, planningContext: { campaignRef: "cmp_gcc", persistedCampaignRef: null, campaignLabel: "GCC · Doktor Tanıtım · Leads", input: { businessGoal: "lead_acquisition", market: "international", language: "ar", serviceRef: "service_doctor_introduction", countryOrRegion: "GCC", conversionRoute: "lead_form", deliveryHealth: "healthy", classification: "classified", capacity: "confirmed", creativeReady: true } } },
  { id: "cmp-awareness", name: "TR · Marka · Evergreen Awareness", objective: "OUTCOME_AWARENESS", category: "Marka koruma", tags: ["Türkiye", "TR", "No-pause"], spend: "₺136", conversions: 29, cpa: "₺4,69", budget: "₺35.000", health: "Korunan", tone: "protected", progress: 48, planningContext: { campaignRef: "cmp_awareness", persistedCampaignRef: null, campaignLabel: "TR · Marka · Evergreen Awareness", input: { businessGoal: "upper_funnel_education", market: "domestic", language: "tr", serviceRef: "service_medical_aesthetics", countryOrRegion: null, conversionRoute: "not_applicable", deliveryHealth: "healthy", classification: "classified", capacity: "confirmed", creativeReady: true } } },
] as const satisfies readonly Readonly<{ id: string; name: string; objective: string; category: string; tags: readonly string[]; spend: string; conversions: number; cpa: string; budget: string; health: string; tone: "watch" | "stable" | "protected"; progress: number; planningContext: CampaignPlanningBriefContext; }>[];

export type PortfolioFilters = Readonly<{
  objective: string;
  category: string;
}>;

export function filterCampaignPortfolio<T extends Readonly<{ objective: string; category: string }>>(
  items: readonly T[],
  filters: PortfolioFilters,
): readonly T[] {
  return items.filter((campaign) =>
    (filters.objective === "all" || campaign.objective === filters.objective)
    && (filters.category === "all" || campaign.category === filters.category),
  );
}

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

function correlationRef() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return `correlation_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function resolveAgentSessionSelection(sessions: readonly AgentSessionSummary[], current: string) {
  if (sessions.some((session) => session.sessionRef === current)) return current;
  return sessions.length === 1 ? sessions[0]!.sessionRef : "";
}

export function approvalQueueScopeAfterCampaignSelection(
  currentCampaignId: string,
  nextCampaignId: string,
  currentApprovalQueueCampaignRef: string | null,
) {
  return currentCampaignId === nextCampaignId ? currentApprovalQueueCampaignRef : null;
}

export function OperatingDashboard({ model, initialView = "today" }: { model: OperatingDashboardModel; initialView?: DashboardViewId }) {
  const [activeView, setActiveView] = useState<ViewId>(initialView);
  const [selectedCampaign, setSelectedCampaign] = useState<string>(campaigns[0].id);
  const [portfolioFilters, setPortfolioFilters] = useState<PortfolioFilters>({ objective: "all", category: "all" });
  const [approvalQueueCampaignRef, setApprovalQueueCampaignRef] = useState<string | null>(null);
  const [autonomy, setAutonomy] = useState<Record<string, string>>({ analysis: "Otomatik", recommendation: "Otomatik", decrease: "Onaya sun", increase: "Onaya sun", pause: "Onaya sun", create: "Her zaman manuel" });
  const agentMessages: Array<{ from: "agent" | "user"; text: string }> = [
    { from: "agent", text: "Bu dashboard model çalıştırmaz. Aktif Codex veya Claude session'ını doğrulayın, bağlam için kısa ömürlü handoff üretin ve konuşmayı seçtiğiniz CLI içinde sürdürün." },
  ];
  const [toast, setToast] = useState<string | null>(null);
  const [metaInventory, setMetaInventory] = useState<MetaInventorySnapshot | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [agentSessions, setAgentSessions] = useState<AgentSessionSummary[]>([]);
  const [agentSessionsLoading, setAgentSessionsLoading] = useState(true);
  const [agentSessionError, setAgentSessionError] = useState<string | null>(null);
  const [selectedAgentSessionRef, setSelectedAgentSessionRef] = useState("");
  const [agentHandoff, setAgentHandoff] = useState<AgentHandoffSummary | null>(null);
  const [agentHandoffLoading, setAgentHandoffLoading] = useState(false);
  const [agentEntityRef, setAgentEntityRef] = useState("portfolio_current");
  const [agentEntityLabel, setAgentEntityLabel] = useState("Tüm Meta portföyü");

  const filteredCampaigns = useMemo(() => filterCampaignPortfolio(campaigns, portfolioFilters), [portfolioFilters]);
  const currentCampaign = filteredCampaigns.find((campaign) => campaign.id === selectedCampaign) ?? filteredCampaigns[0] ?? campaigns[0];
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

  const refreshAgentSessions = useCallback(async (announce = false) => {
    setAgentSessionsLoading(true);
    setAgentSessionError(null);
    try {
      const response = await fetch("/api/local-agent-sessions", {
        cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "local-agent-sessions-read" },
      });
      const payload = await response.json() as { sessions?: AgentSessionSummary[]; error?: { message?: string } };
      if (!response.ok || !Array.isArray(payload.sessions)) {
        throw new Error(payload.error?.message ?? "Yerel agent session kaynağı kullanılamıyor.");
      }
      setAgentSessions(payload.sessions);
      setSelectedAgentSessionRef((current) => resolveAgentSessionSelection(payload.sessions!, current));
      if (announce) setToast(`${payload.sessions.length} aktif yerel agent session doğrulandı.`);
    } catch (error) {
      setAgentSessions([]);
      setSelectedAgentSessionRef("");
      setAgentSessionError(error instanceof Error ? error.message : "Yerel agent session kaynağı kullanılamıyor.");
    } finally {
      setAgentSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMetaInventory();
    const timer = window.setInterval(() => void refreshMetaInventory(), 15 * 60_000);
    return () => window.clearInterval(timer);
  }, [refreshMetaInventory]);

  useEffect(() => { void refreshAgentSessions(); }, [refreshAgentSessions]);

  const createAgentHandoff = useCallback(async (entityRef: string) => {
    if (!selectedAgentSessionRef || !agentSessions.some((session) => session.sessionRef === selectedAgentSessionRef)) {
      setAgentSessionError(agentSessions.length > 1 ? "Devam edilecek session'ı açıkça seçin." : "Aktif bir CLI session bulunamadı.");
      return;
    }
    setAgentHandoffLoading(true);
    setAgentSessionError(null);
    setAgentHandoff(null);
    try {
      const register = await fetch("/api/local-agent-sessions", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "local-agent-session-create" },
        body: "{}",
      });
      if (!register.ok && register.status !== 409) throw new Error("Dashboard session kaydı oluşturulamadı.");
      const response = await fetch("/api/local-agent-handoffs", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "local-agent-handoff-create" },
        body: JSON.stringify({
          targetSessionRef: selectedAgentSessionRef,
          context: { intent: "analysis", entityRef, timeframeRef: "timeframe_last_7d",
            contextRef: "context_dashboard_selection", contextVersion: 1, templateRef: null,
            correlationRef: correlationRef() },
          ttlSeconds: 60,
        }),
      });
      const payload = await response.json() as { handoff?: AgentHandoffSummary; error?: { message?: string } };
      if (!response.ok || !payload.handoff) throw new Error(payload.error?.message ?? "Handoff oluşturulamadı.");
      setAgentHandoff(payload.handoff);
      setToast(`Kısa ömürlü handoff ${payload.handoff.targetSessionRef.slice(0, 16)}… session'ı için hazır.`);
    } catch (error) {
      setAgentSessionError(error instanceof Error ? error.message : "Handoff oluşturulamadı.");
    } finally {
      setAgentHandoffLoading(false);
    }
  }, [agentSessions, selectedAgentSessionRef]);

  function navigate(view: ViewId) {
    setActiveView(view);
    setToast(null);
  }

  function selectCampaign(campaignId: string) {
    setApprovalQueueCampaignRef((current) => approvalQueueScopeAfterCampaignSelection(selectedCampaign, campaignId, current));
    setSelectedCampaign(campaignId);
  }

  function changePortfolioFilter(key: keyof PortfolioFilters, value: string) {
    const next = { ...portfolioFilters, [key]: value };
    const nextCampaigns = filterCampaignPortfolio(campaigns, next);
    setPortfolioFilters(next);
    if (!nextCampaigns.some((campaign) => campaign.id === selectedCampaign) && nextCampaigns[0]) {
      setApprovalQueueCampaignRef(null);
      setSelectedCampaign(nextCampaigns[0].id);
    }
  }

  function openAgentContext(entityRef: string, label: string) {
    setAgentEntityRef(entityRef);
    setAgentEntityLabel(label);
    setAgentHandoff(null);
    navigate("agent");
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
              <div className={styles.decisionAction}><StatusPill tone="neutral">Salt okunur</StatusPill><button className={styles.iconButton} onClick={() => navigate("approvals")} aria-label={`${item.title} için gerçek onay kuyruğunu aç`}>→</button></div>
            </article>)}
          </div>
        </section>

        <aside className={`${styles.panel} ${styles.agentCard}`}>
          <div className={styles.agentGlow} />
          <header><span className={styles.agentMark}>✦</span><div><span className={styles.kicker}>REKLAMZEKA ORCHESTRATOR</span><h2>{agentSessionsLoading ? "Session kontrol ediliyor" : agentSessions.length ? "Yerel agent session hazır" : "Agent session bekleniyor"}</h2></div><StatusPill tone={agentSessions.length ? "good" : agentSessionError ? "warning" : "neutral"}>{agentSessions.length ? `${agentSessions.length} bağlı` : "Bağlı değil"}</StatusPill></header>
          <p>{agentSessions.length ? `${agentSessions.map((session) => session.clientRef).join(" · ")} · doğrulanmış local session` : "API doğrulaması olmadan bağlı gösterilmez"}</p>
          <div className={styles.agentContext}><span>Aktif bağlam</span><strong>Tüm Meta portföyü</strong><small>11 kategori · 18 guidance · 7 policy · 4 experiment</small></div>
          <blockquote>“İstanbul kampanyasında CPL yükseldi; fakat no-transfer ve korunan floor nedeniyle bütçe taşıma önermedim. 48 saat izle daha güvenli.”</blockquote>
          <div className={styles.agentActions}><button className={styles.primaryButton} onClick={() => openAgentContext("portfolio_current", "Tüm Meta portföyü")}>Session merkezini aç</button><button disabled={!agentSessions.length || agentSessions.length > 1} onClick={() => { openAgentContext("portfolio_current", "Tüm Meta portföyü"); void createAgentHandoff("portfolio_current"); }}>CLI'da devam et</button></div>
        </aside>
      </div>

      <section className={styles.panel} aria-labelledby="portfolio-title">
        <header className={styles.panelHeader}><div><span className={styles.kicker}>PORTFÖY</span><h2 id="portfolio-title">Kampanya sağlığı</h2></div><button onClick={() => navigate("campaigns")}>32 kampanyayı aç <span>→</span></button></header>
        <div className={styles.campaignTable} role="table" aria-label="Kampanya sağlığı">
          <div className={styles.tableHead} role="row"><span>Kampanya ve bağlam</span><span>7g harcama</span><span>Sonuç</span><span>CPA</span><span>Aylık bütçe</span><span>Durum</span></div>
          {campaigns.map((campaign) => <button key={campaign.id} className={styles.tableRow} role="row" onClick={() => { selectCampaign(campaign.id); navigate("campaigns"); }}>
            <span className={styles.campaignIdentity}><strong>{campaign.name}</strong><small>{campaign.objective} · {campaign.category}</small><i>{campaign.tags.join(" · ")}</i></span><span>{campaign.spend}</span><span>{campaign.conversions}</span><span>{campaign.cpa}</span><span><strong>{campaign.budget}</strong><i className={styles.rowProgress}><b style={{ width: `${campaign.progress}%` }} /></i></span><span><StatusPill tone={campaign.tone}>{campaign.health}</StatusPill></span>
          </button>)}
        </div>
      </section>
    </>;
  }

  function renderCampaigns() {
    return <>
      <section className={styles.pageHero}><div><span className={styles.kicker}>META PORTFÖYÜ</span><h1>Kampanyayı metrikten önce bağlamıyla okuyun.</h1><p>Meta objective, reklam seti yapısı, mevcut kreatifler ve iç kategoriler aynı karar yüzeyinde.</p></div><button className={styles.primaryButton} onClick={() => navigate("analysis")}>Yeni analiz</button></section>
      <section className={styles.portfolioOverview} aria-labelledby="portfolio-overview-title">
        <header><div><span className={styles.kicker}>BUGÜN / PORTFÖY HİYERARŞİSİ</span><h2 id="portfolio-overview-title">Demo Marka <i>→</i> Meta portföyü <i>→</i> {filteredCampaigns.length} görünür kampanya</h2><p>Filtreler yalnız bu demo/read-only snapshot'ı daraltır; account, category veya Meta yetkisi değiştirmez.</p></div><StatusPill tone="neutral">unbound demo context</StatusPill></header>
        <div className={styles.portfolioFilters} aria-label="Portföy filtreleri">
          <label htmlFor="portfolio-meta-filter"><span>Meta objective</span><select id="portfolio-meta-filter" value={portfolioFilters.objective} onChange={(event) => changePortfolioFilter("objective", event.target.value)}><option value="all">Tümü</option>{[...new Set(campaigns.map((campaign) => campaign.objective))].map((objective) => <option key={objective} value={objective}>{objective}</option>)}</select></label>
          <label htmlFor="portfolio-category-filter"><span>İç kategori</span><select id="portfolio-category-filter" value={portfolioFilters.category} onChange={(event) => changePortfolioFilter("category", event.target.value)}><option value="all">Tümü</option>{[...new Set(campaigns.map((campaign) => campaign.category))].map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <small>Kaynak: deterministik demo snapshot · persisted account-group/asset graph taklit edilmez.</small>
        </div>
      </section>
      <div className={styles.splitWorkspace}>
        <section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>{filteredCampaigns.length} / {campaigns.length} GÖRÜNÜR</span><h2>Kampanyalar</h2></div><StatusPill tone="good">%98,7 coverage</StatusPill></header><div className={styles.selectorList}>{filteredCampaigns.map((campaign) => <button key={campaign.id} data-active={currentCampaign.id === campaign.id} onClick={() => selectCampaign(campaign.id)}><span><strong>{campaign.name}</strong><small>{campaign.objective}</small></span><StatusPill tone={campaign.tone}>{campaign.health}</StatusPill></button>)}</div></section>
        <section className={styles.panel}><header className={styles.detailHeader}><div><span className={styles.kicker}>EFFECTIVE CAMPAIGN CONTEXT</span><h2>{currentCampaign.name}</h2><p>{currentCampaign.objective} · Campaign budget · 7d click / 1d view</p></div><button onClick={() => openAgentContext(`campaign_${currentCampaign.id.replace("cmp-", "")}`, currentCampaign.name)}>Agent ile aç ✦</button></header>
          <div className={styles.contextGrid}><div><span>İç kategori</span><strong>{currentCampaign.category}</strong><small>{currentCampaign.tags.join(" · ")}</small></div><div><span>Bütçe sahibi</span><strong>Campaign / CBO</strong><small>{currentCampaign.budget} aylık plan</small></div><div><span>Karar temposu</span><strong>72 saat observation</strong><small>Son hamle: 31 saat önce</small></div><div><span>Aktif koruma</span><strong>{currentCampaign.id === "cmp-istanbul" ? "no-transfer · floor" : "max-change %10"}</strong><small>Policy v4 · yayınlandı</small></div></div>
          <div className={styles.hierarchy}><div><span>Campaign</span><strong>{currentCampaign.name}</strong></div><div><span>Ad set · 3</span><strong>Broad · Remarketing · LAL</strong></div><div><span>Ad · 8</span><strong>6 active · 1 learning · 1 paused</strong></div><div><span>Creative/post</span><strong>5 mevcut asset · yeni üretim yok</strong></div></div>
          <div className={styles.copyPreview}><span className={styles.kicker}>YAYINDAKİ REKLAM METNİ</span><h3>Saç ekimi hakkında merak ettiklerinizi uzman ekibimize sorun.</h3><p>Primary text · CTA: WhatsApp'tan mesaj gönder · Instagram post bağlı</p><footer><StatusPill tone="info">Mevcut creative</StatusPill><button>Performansını incele</button></footer></div>
        </section>
      </div>
      <CampaignPlanningBriefPanel context={currentCampaign.planningContext} onApprovalQueueCampaignRef={setApprovalQueueCampaignRef} />
    </>;
  }

  function renderAnalysis() {
    return <>
      <section className={styles.pageHero}><div><span className={styles.kicker}>ANALYSIS ROOM</span><h1>Anlık ve zamanlanmış analiz, aynı kanıt hattında.</h1><p>Timeframe başka, çalışma zamanı başkadır. Her koşum category, guidance, cadence ve outcome bağlamını dondurur.</p></div><button className={styles.primaryButton} onClick={() => setToast("Yeni analiz taslağı açıldı: kapsam ve karar sorusu bekleniyor.")}>+ Analiz oluştur</button></section>
      <section className={styles.analysisBuilder}><div><span>Kapsam</span><strong>Tüm Meta hesapları</strong><small>4 hesap · 32 kampanya</small></div><div><span>Timeframe</span><strong>Son 7 gün ↔ önceki 7 gün</strong><small>Europe/Istanbul</small></div><div><span>Agenda</span><strong>Genel → kategori → campaign</strong><small>10 pass · bounded drill-down</small></div><div><span>Karar profili</span><strong>Stable efficiency</strong><small>no-change zorunlu seçenek</small></div><button onClick={() => setToast("Dry-run analiz kuyruğa alındı. Meta write yetkisi yok.")}>Dry-run çalıştır →</button></section>
      <section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>SCHEDULED ANALYSIS</span><h2>Analiz rutinleri</h2></div><button>Takvimi yönet</button></header><div className={styles.runList}>{analysisRuns.map((run) => <article key={run.title}><div><StatusPill tone={run.status === "Tamamlandı" ? "good" : "neutral"}>{run.status}</StatusPill><h3>{run.title}</h3><p>{run.scope}</p></div><dl><div><dt>Çalışma</dt><dd>{run.schedule}</dd></div><div><dt>Sonuç</dt><dd>{run.result}</dd></div><div><dt>Sonraki</dt><dd>{run.next}</dd></div></dl><button>Detay →</button></article>)}</div></section>
    </>;
  }

  function renderAgent() {
    return <>
      <section className={styles.pageHero}><div><span className={styles.kicker}>REKLAMZEKA ORCHESTRATOR</span><h1>Tek agent, farklı vendor; aynı yetki ve karar sözleşmesi.</h1><p>Codex veya Claude session'ı değişebilir. Kampanya bağlamı, kurallar, skill'ler ve otonomi valfi ReklamZeka'da kalır.</p></div><StatusPill tone={agentSessions.length ? "good" : agentSessionError ? "warning" : "neutral"}>{agentSessionsLoading ? "Session kontrolü" : agentSessions.length ? `● ${agentSessions.length} session bağlı` : "Session bağlı değil"}</StatusPill></section>
      <div className={styles.agentWorkspace}>
        <section className={styles.agentChat}><header><div><span className={styles.agentMark}>✦</span><div><strong>Orchestrator çalışma alanı</strong><small>Bağlam: {agentEntityLabel}</small></div></div><button onClick={() => void refreshAgentSessions(true)}>Session'ları yenile</button></header><div className={styles.chatMessages}>{agentMessages.map((message, index) => <div key={`${message.from}-${index}`} data-from={message.from}><span>{message.from === "agent" ? "RZ" : "Siz"}</span><p>{message.text}</p></div>)}</div><div className={styles.chatComposer}><textarea aria-label="Orchestrator'a mesaj" placeholder="Sohbet Codex/Claude CLI transport'u bağlandıktan sonra burada devam edebilir." value="" disabled /><button disabled>CLI bekleniyor</button></div><footer>Bu sohbet yüzeyi model çalıştırmaz · Agent yalnız read/draft/proposal araçlarına erişir · Meta writer yok</footer></section>
        <aside className={styles.agentConfiguration}>
          <section className={`${styles.panel} ${styles.agentSessionHub}`}><header className={styles.panelHeader}><div><span className={styles.kicker}>LOCAL SESSION HUB</span><h2>Dashboard ↔ CLI handoff</h2></div><StatusPill tone={agentSessions.length ? "good" : "neutral"}>{agentSessionsLoading ? "Kontrol" : `${agentSessions.length} aktif`}</StatusPill></header>
            {agentSessionError ? <p role="alert">{agentSessionError}</p> : null}
            {!agentSessionsLoading && !agentSessions.length ? <div><strong>Aktif CLI session bulunamadı</strong><small>Codex veya Claude tarafı bearer session ile register olduğunda burada görünür.</small></div> : null}
            {agentSessions.length ? <label htmlFor="agent-session-target"><span>Hedef session</span><select id="agent-session-target" value={selectedAgentSessionRef} onChange={(event) => setSelectedAgentSessionRef(event.target.value)}><option value="" disabled>{agentSessions.length > 1 ? "Session seçin" : "Session"}</option>{agentSessions.map((session) => <option key={session.sessionRef} value={session.sessionRef}>{session.clientRef} · {session.transport} · {formatMetaTime(session.lastSeenAt)}</option>)}</select></label> : null}
            <dl><div><dt>Seçili bağlam</dt><dd>{agentEntityLabel}</dd></div><div><dt>Timeframe</dt><dd>Son 7 gün</dd></div><div><dt>Yetki</dt><dd>Coordination only</dd></div></dl>
            <button className={styles.primaryButton} disabled={!selectedAgentSessionRef || agentHandoffLoading} onClick={() => void createAgentHandoff(agentEntityRef)}>{agentHandoffLoading ? "Hazırlanıyor…" : "Kısa ömürlü handoff hazırla"}</button>
            {agentHandoff ? <div className={styles.handoffReceipt}><span>Handoff hazır</span><code>{agentHandoff.handoffRef}</code><small>{formatMetaTime(agentHandoff.expiresAt)} tarihinde sona erer · tek kullanımlık</small></div> : null}
          </section>
          <section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>SKILL PACK</span><h2>Aktif roller</h2></div><StatusPill tone="good">6 aktif</StatusPill></header><div className={styles.skillList}>{agentSkills.map(([name, description]) => <article key={name}><span>✦</span><div><strong>{name}</strong><p>{description}</p></div></article>)}</div></section><section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>AUTONOMY VALVE</span><h2>Hareket özgürlüğü</h2></div><StatusPill tone="warning">approval_only</StatusPill></header><div className={styles.autonomyList}>{Object.entries({ analysis: "Analiz çalıştır", recommendation: "Öneri hazırla", decrease: "Bütçe azalt", increase: "Bütçe artır", pause: "Kampanya/reklam duraklat", create: "Post promotion oluştur" }).map(([key, label]) => <label key={key}><span>{label}</span><select value={autonomy[key]} onChange={(event) => setAutonomy((current) => ({ ...current, [key]: event.target.value }))}><option>Otomatik</option><option>Onaya sun</option><option>Her zaman manuel</option></select></label>)}</div><small className={styles.safetyNote}>Alt kapsam yalnız özgürlüğü daraltabilir. K3/K4 her zaman insan onaylıdır.</small></section></aside>
      </div>
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

  const content = activeView === "today" ? renderToday() : activeView === "campaigns" ? renderCampaigns() : activeView === "analysis" ? renderAnalysis() : activeView === "decision-room" ? <DecisionRoomPanel /> : activeView === "practice-lab" ? <PracticeLabPanel /> : activeView === "budgets" ? <BudgetLabPanel /> : activeView === "rules" ? <GuidanceStudioPanel onOpenSession={() => navigate("decision-room")} /> : activeView === "strict-policies" ? <InstructionPolicyStudioPanel /> : activeView === "categories" ? <CategoryInventoryPanel onOpenSession={() => navigate("decision-room")} /> : activeView === "autonomy" ? <AutonomyStudioPanel /> : activeView === "meta" ? renderMetaConnection() : activeView === "agent" ? renderAgent() : activeView === "approvals" ? <ApprovalQueuePanel campaignRef={approvalQueueCampaignRef} /> : activeView === "promotions" ? <PromotionPreflightPanel /> : renderTimeline();

  return <main className={styles.appShell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><span>RZ</span><div><strong>ReklamZeka</strong><small>Operating System</small></div><i>DEMO</i></div>
      <nav aria-label="Ana navigasyon">{navGroups.map((group) => <div key={group.label}><span>{group.label}</span>{group.items.map((item) => <button key={item.id} data-active={activeView === item.id} onClick={() => navigate(item.id)}><Icon name={item.icon} /><strong>{item.label}</strong>{item.badge ? <i data-live={item.badge === "●"}>{item.badge}</i> : null}</button>)}</div>)}</nav>
      <div className={styles.sidebarFooter}><span className={styles.liveDot} /><div><strong>Meta Mirror</strong><small>{metaInventory ? `${metaInventory.summary.adAccounts} hesap · read-only` : `${model.freshnessLabel} · kontrol ediliyor`}</small></div><button aria-label="Bağlantı ayarları" onClick={() => navigate("meta")}>•••</button></div>
    </aside>
    <section className={styles.workspace}>
      <header className={styles.topbar}><div className={styles.mobileBrand}><span>RZ</span><strong>ReklamZeka</strong></div><button className={styles.workspacePicker} onClick={() => navigate("meta")}><span className={styles.avatar}>DM</span><span><strong>Demo Marka</strong><small>{metaInventory ? `${metaInventory.summary.adAccounts} Meta hesabı` : "Meta kontrol ediliyor"}</small></span><i>⌄</i></button><div className={styles.topActions}><button aria-label="Ara">⌕</button><button aria-label="Bildirimler">♢</button><button className={styles.autonomyButton} onClick={() => navigate("agent")}><span className={styles.liveDot} /> approval_only <i>⌄</i></button><button className={styles.profileButton}>AY</button></div></header>
      <div className={styles.mobileNav}>{navGroups.flatMap((group) => group.items).map((item) => <button key={item.id} data-active={activeView === item.id} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</div>
      <div className={styles.content} aria-label={activeTitle}>{content}</div>
      <footer className={styles.sourceFooter}><span>{activeView === "meta" && metaInventory ? `Canlı Meta Graph · ${formatMetaTime(metaInventory.refreshedAt)} · ${metaInventory.connection.accessMode}` : activeView === "decision-room" ? "Decision Room read model · canlı kaynak bağlanmadan fixture kullanılmaz" : activeView === "practice-lab" ? "Practice Lab read model · append-only lifecycle doğrulaması" : activeView === "budgets" ? "Budget Lab read model · doğrulanmış proposal ledger" : activeView === "rules" ? "Guidance Studio · kalıcı append-only registry ve iç kategori kataloğu" : activeView === "strict-policies" ? "Strict policy registry · raw provenance + normalize DSL + append-only diff" : activeView === "categories" ? "Category Registry · aktif tanımlar ve doğrudan atama kapsamı" : activeView === "approvals" ? "Approval Queue read model · tenant-bound ActionUnit projection" : activeView === "promotions" ? "Existing-post preflight · yalnız server-provided ref kataloğu" : `Demo snapshot · ${model.currency} · ${model.timezone} · ${model.attribution}`}</span><span>{activeView === "meta" ? "Kimlikler maskeli · token server-only · write connector yok" : activeView === "decision-room" ? "Server-bound workspace · bounded cursor · action authority yok" : activeView === "practice-lab" ? "Public-safe projection · draft ephemeral · promotion/automation/action yok" : activeView === "budgets" ? "Public-safe projection · draft/approval/execute/Meta yok" : activeView === "rules" ? "Public-safe refs · guidance_only · publish policy/action/Meta yetkisi üretmez" : activeView === "strict-policies" ? "Cookie-only · OCC guarded · approve/execute/schedule/tool/network/Meta write kapalı" : activeView === "categories" ? "Public-safe refs · inherited context değil · assign/action/Meta kapalı" : activeView === "approvals" ? "Public-safe projection · approve/reject/grant/execute/Meta kapalı" : activeView === "promotions" ? "Ephemeral K4 preview · persist/approve/execute/Meta/creative kapalı" : "Deterministik veriler mevcut fixture/API'dan; operasyon bağlamı ürün vizyonu demosudur."}</span></footer>
    </section>
    {toast ? <div className={styles.toast} role="status"><span>✓</span><p>{toast}</p><button onClick={() => setToast(null)} aria-label="Bildirimi kapat">×</button></div> : null}
  </main>;
}
