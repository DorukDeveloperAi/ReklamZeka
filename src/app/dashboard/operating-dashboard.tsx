"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MetaInventoryAccount, MetaInventoryApiError, MetaInventorySnapshot } from "@/connectors/meta/types";
import type { MetaReadMirrorProjection } from "@/domain/meta/read-mirror-projection";
import { DecisionRoomPanel } from "./decision-room-panel";
import { BudgetLabPanel } from "./budget-lab-panel";
import { PracticeLabPanel } from "./practice-lab-panel";
import { ApprovalQueuePanel } from "./approval-queue-panel";
import { PromotionPreflightPanel } from "./promotion-preflight-panel";
import { AutonomyStudioPanel } from "./autonomy-studio-panel";
import { GuidanceStudioPanel } from "./guidance-studio-panel";
import { SliceRuleWorkspacePanel } from "./slice-rule-workspace-panel";
import { CategoryInventoryPanel } from "./category-inventory-panel";
import { InstructionPolicyStudioPanel } from "./instruction-policy-studio-panel";
import type { CampaignIntentTemplateRef } from "./normalization-workbench-panel";
import { CAMPAIGN_BRIEF_SCENARIOS, CampaignPlanningBriefPanel, type CampaignBriefScenarioRef, type CampaignPlanningBriefContext } from "./campaign-planning-brief-panel";
import { offlineWorkbookPortfolioSnapshot, type OfflineWorkbookBriefScenarioRef } from "@/domain/campaigns/offline-workbook-portfolio-snapshot";
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
type OrchestratorConversationSummary = Readonly<{
  conversationRef: string;
  createdAt: string;
  pageGuide: Readonly<{ pageId: DashboardViewId; pageLabel: string }> | null;
  providerThreadRef: string | null;
  messages: readonly Readonly<{ messageRef: string; role: "user" | "assistant"; content: string; createdAt: string }>[];
}>;
type PersistedCampaignContextSummary = Readonly<{ campaignRef: string; label: string; objective: string | null; capturedAt: string; sourceState: "frozen_valid" }>;
type PortfolioCapabilitySummary = Readonly<{
  connections: readonly Readonly<{ connectionRef: string; displayName: string; status: "active" | "disconnected" | "revoked" | "invalid"; readReady: boolean; accountCount: number; }>[],
  accounts: readonly Readonly<{ accountRef: string; connectionRef: string; name: string; currency: string; timezone: string; spendCapMinor: number | null; groupRefs: readonly string[]; readReadiness: "ready" | "partial" | "unavailable"; reasonCodes: readonly string[]; capabilities: Readonly<{ canRead: boolean; canPlan: boolean; canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false; }> }>[],
}>;

type MetaReadMirrorLoadState = "loading" | "ready" | "session_required" | "unavailable";

function plainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const nullableText = (value: unknown): boolean => value === null || typeof value === "string";
const isoText = (value: unknown): boolean => typeof value === "string" && Number.isFinite(Date.parse(value));
function mirrorBudget(value: unknown, owners: readonly string[]): boolean {
  if (!plainRecord(value) || !owners.includes(value.owner as string)) return false;
  return [value.dailyMinor, value.lifetimeMinor].every((amount) => amount === null || Number.isSafeInteger(amount) && (amount as number) >= 0);
}

/** Fail closed before presenting an API response as canonical Meta evidence. */
export function metaReadMirrorFromResponse(value: unknown): MetaReadMirrorProjection | null {
  if (!plainRecord(value) || value.version !== "meta-read-mirror-projection/1.0.0"
    || !["ready", "partial", "stale", "empty", "unavailable"].includes(value.sourceState as string)
    || typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt))
    || !(value.latestCanonicalObservationAt === null || typeof value.latestCanonicalObservationAt === "string" && Number.isFinite(Date.parse(value.latestCanonicalObservationAt)))
    || !(value.freshnessAgeMinutes === null || Number.isSafeInteger(value.freshnessAgeMinutes) && (value.freshnessAgeMinutes as number) >= 0)
    || !Number.isSafeInteger(value.freshnessThresholdMinutes) || (value.freshnessThresholdMinutes as number) < 1
    || !Array.isArray(value.reasonCodes) || value.reasonCodes.some((code) => typeof code !== "string")
    || !plainRecord(value.summary) || !plainRecord(value.authority) || !Array.isArray(value.connections)
    || value.authority.actionAuthority !== "none" || value.authority.canPublish !== false
    || value.authority.canApprove !== false || value.authority.canExecute !== false || value.authority.canWriteMeta !== false) return null;
  const summary = value.summary as Record<string, unknown>;
  const summaryKeys = ["connections", "accounts", "campaigns", "adSets", "ads", "creatives", "posts"];
  if (summaryKeys.some((key) => !Number.isSafeInteger(summary[key]) || (summary[key] as number) < 0)) return null;
  for (const connection of value.connections) {
    if (!plainRecord(connection) || typeof connection.connectionRef !== "string" || typeof connection.name !== "string"
      || !["active", "disconnected", "revoked", "invalid"].includes(connection.status as string)
      || connection.accessMode !== "read_only" || !Array.isArray(connection.accounts)) return null;
    for (const account of connection.accounts) {
      if (!plainRecord(account) || typeof account.accountRef !== "string" || typeof account.name !== "string"
        || typeof account.currency !== "string" || !/^[A-Z]{3}$/.test(account.currency) || typeof account.timezone !== "string" || !plainRecord(account.freshness)
        || !(account.freshness.latestObservedAt === null || isoText(account.freshness.latestObservedAt))
        || !Array.isArray(account.campaigns)) return null;
      for (const campaign of account.campaigns) {
        if (!plainRecord(campaign) || typeof campaign.campaignRef !== "string" || typeof campaign.name !== "string"
          || !nullableText(campaign.status) || !nullableText(campaign.objective) || !isoText(campaign.fetchedAt)
          || !mirrorBudget(campaign.budget, ["campaign", "ad_set", "unknown"]) || !Array.isArray(campaign.adSets)) return null;
        for (const adSet of campaign.adSets) {
          if (!plainRecord(adSet) || typeof adSet.adSetRef !== "string" || typeof adSet.name !== "string"
            || !nullableText(adSet.status) || !nullableText(adSet.optimizationGoal) || !isoText(adSet.fetchedAt)
            || !(adSet.targetingSummary === null || plainRecord(adSet.targetingSummary))
            || !mirrorBudget(adSet.budget, ["ad_set", "campaign", "unknown"]) || !Array.isArray(adSet.ads)) return null;
          for (const ad of adSet.ads) {
            if (!plainRecord(ad) || typeof ad.adRef !== "string" || typeof ad.name !== "string"
              || !nullableText(ad.status) || !isoText(ad.fetchedAt) || !(ad.creative === null || plainRecord(ad.creative))) return null;
            if (plainRecord(ad.creative)) {
              const creative = ad.creative;
              if (typeof creative.creativeRef !== "string" || typeof creative.sourceType !== "string" || !isoText(creative.fetchedAt)
                || [creative.name, creative.primaryText, creative.headline, creative.description, creative.caption,
                  creative.callToActionType, creative.destinationUrl, creative.format].some((field) => !nullableText(field))
                || !(creative.post === null || plainRecord(creative.post))) return null;
              if (plainRecord(creative.post) && (typeof creative.post.postRef !== "string" || !isoText(creative.post.fetchedAt)
                || [creative.post.mediaType, creative.post.permalink, creative.post.message, creative.post.caption,
                  creative.post.publishedAt].some((field) => !nullableText(field)))) return null;
            }
          }
        }
      }
    }
  }
  return value as unknown as MetaReadMirrorProjection;
}

export function metaReadMirrorErrorState(status: number, value: unknown): Exclude<MetaReadMirrorLoadState, "loading" | "ready"> {
  if ((status === 401 || status === 403) && plainRecord(value) && plainRecord(value.error)
    && ["local_session_required", "forbidden"].includes(value.error.code as string)) return "session_required";
  return "unavailable";
}

/**
 * A list item authenticates only its opaque alias, capture time and Meta
 * objective. The rest of the planning taxonomy remains human-confirmed until
 * the exact single-context read has completed, so a demo campaign can never
 * silently prefill a persisted campaign brief.
 */
const PERSISTED_UNCONFIRMED_BRIEF_INPUT = Object.freeze({
  businessGoal: "classification_triage" as const,
  market: "unknown" as const,
  language: null,
  serviceRef: null,
  countryOrRegion: null,
  conversionRoute: "unknown" as const,
  deliveryHealth: "unknown" as const,
  classification: "unclassified" as const,
  capacity: "unknown" as const,
  creativeReady: false,
});

export function persistedCampaignContextsFromResponse(value: unknown): readonly PersistedCampaignContextSummary[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4 || record.contractVersion !== "campaign-context-list-read-model/1.0.0" || record.view !== "list" || record.writeOperations !== 0 || !Array.isArray(record.items) || record.items.length > 25) return null;
  const items: PersistedCampaignContextSummary[] = [];
  for (const item of record.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const candidate = item as Record<string, unknown>;
    if (Object.keys(candidate).length !== 5 || typeof candidate.campaignRef !== "string" || !/^ref_[a-f0-9]{12}$/.test(candidate.campaignRef) || typeof candidate.label !== "string" || candidate.label.length < 1 || candidate.label.length > 128 || !(candidate.objective === null || typeof candidate.objective === "string" && candidate.objective.length <= 128) || typeof candidate.capturedAt !== "string" || !Number.isFinite(Date.parse(candidate.capturedAt)) || candidate.sourceState !== "frozen_valid") return null;
    items.push(Object.freeze(candidate as PersistedCampaignContextSummary));
  }
  return Object.freeze(items);
}

export function isLocalSessionRequiredResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  if (Object.keys(response).length !== 1 || !response.error || typeof response.error !== "object" || Array.isArray(response.error)) return false;
  const error = response.error as Record<string, unknown>;
  return Object.keys(error).length === 2
    && error.code === "local_session_required"
    && typeof error.message === "string" && error.message.length > 0 && error.message.length <= 240;
}

/** Accept only the deliberately redacted, read-only portfolio contract. */
export function portfolioCapabilityFromResponse(value: unknown): PortfolioCapabilitySummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (Object.keys(response).length !== 3 || response.version !== "meta-portfolio-capability/1.0.0"
    || !Array.isArray(response.connections) || !Array.isArray(response.accounts)) return null;
  const opaque = (candidate: unknown, prefix: string) => typeof candidate === "string" && new RegExp(`^${prefix}_[a-f0-9]{24}$`).test(candidate);
  const connections = response.connections.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).length !== 5 || !opaque(item.connectionRef, "meta_connection") || typeof item.displayName !== "string" || item.displayName.length < 1 || item.displayName.length > 256
      || !["active", "disconnected", "revoked", "invalid"].includes(item.status as string) || typeof item.readReady !== "boolean" || !Number.isSafeInteger(item.accountCount) || (item.accountCount as number) < 0) return null;
    return Object.freeze(item as PortfolioCapabilitySummary["connections"][number]);
  });
  const accounts = response.accounts.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    const capability = item.capabilities;
    if (Object.keys(item).length !== 10 || !opaque(item.accountRef, "ad_account") || !opaque(item.connectionRef, "meta_connection")
      || typeof item.name !== "string" || item.name.length < 1 || item.name.length > 256 || typeof item.currency !== "string" || !/^[A-Z]{3}$/.test(item.currency)
      || typeof item.timezone !== "string" || item.timezone.length < 1 || item.timezone.length > 128 || !(item.spendCapMinor === null || Number.isSafeInteger(item.spendCapMinor) && (item.spendCapMinor as number) >= 0)
      || !Array.isArray(item.groupRefs) || item.groupRefs.some((ref) => typeof ref !== "string" || !/^account_group_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(ref))
      || !["ready", "partial", "unavailable"].includes(item.readReadiness as string) || !Array.isArray(item.reasonCodes) || item.reasonCodes.some((code) => typeof code !== "string" || !/^[a-z0-9_]{1,96}$/.test(code))
      || !capability || typeof capability !== "object" || Array.isArray(capability) || Object.keys(capability as object).length !== 6
      || typeof (capability as Record<string, unknown>).canRead !== "boolean" || typeof (capability as Record<string, unknown>).canPlan !== "boolean"
      || (capability as Record<string, unknown>).canPublish !== false || (capability as Record<string, unknown>).canApprove !== false || (capability as Record<string, unknown>).canExecute !== false || (capability as Record<string, unknown>).canWriteMeta !== false) return null;
    return Object.freeze(item as PortfolioCapabilitySummary["accounts"][number]);
  });
  const validConnections = connections.filter((entry): entry is PortfolioCapabilitySummary["connections"][number] => entry !== null);
  const validAccounts = accounts.filter((entry): entry is PortfolioCapabilitySummary["accounts"][number] => entry !== null);
  if (validConnections.length !== connections.length || validAccounts.length !== accounts.length) return null;
  return Object.freeze({ connections: Object.freeze(validConnections), accounts: Object.freeze(validAccounts) });
}

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
  { id: "cmp-gcc", name: "Arap Bölgesi · FTR · WhatsApp", objective: "OUTCOME_LEADS", category: "Fizik tedavi / rehabilitasyon", tags: ["Arap Bölgesi", "AR", "WhatsApp"], spend: "₺241", conversions: 42, cpa: "₺5,74", budget: "₺51.000", health: "Stabil", tone: "stable", progress: 63, planningContext: { campaignRef: "cmp_gcc", persistedCampaignRef: null, campaignLabel: "Arap Bölgesi · FTR · WhatsApp", input: { businessGoal: "lead_acquisition", market: "international", language: "ar", serviceRef: "service_physical_therapy_rehab", countryOrRegion: "Arap Bölgesi", conversionRoute: "whatsapp", deliveryHealth: "healthy", classification: "classified", capacity: "confirmed", creativeReady: true } } },
  { id: "cmp-awareness", name: "TR · Marka · Evergreen Awareness", objective: "OUTCOME_AWARENESS", category: "Marka koruma", tags: ["Türkiye", "TR", "No-pause"], spend: "₺136", conversions: 29, cpa: "₺4,69", budget: "₺35.000", health: "Korunan", tone: "protected", progress: 48, planningContext: { campaignRef: "cmp_awareness", persistedCampaignRef: null, campaignLabel: "TR · Marka · Evergreen Awareness", input: { businessGoal: "upper_funnel_education", market: "domestic", language: "tr", serviceRef: "service_medical_aesthetics", countryOrRegion: null, conversionRoute: "not_applicable", deliveryHealth: "healthy", classification: "classified", capacity: "confirmed", creativeReady: true } } },
] as const satisfies readonly Readonly<{ id: string; name: string; objective: string; category: string; tags: readonly string[]; spend: string; conversions: number; cpa: string; budget: string; health: string; tone: "watch" | "stable" | "protected"; progress: number; planningContext: CampaignPlanningBriefContext; }>[];

/**
 * This is intentionally a tiny, deterministic navigation specimen rather than
 * an asset graph read model.  In particular, it is never combined with a
 * selected persisted frozen context: the labels exist solely to make the demo
 * campaign hierarchy inspectable before a tenant-bound hierarchy reader lands.
 */
type DemoHierarchy = Readonly<{
  portfolioLabel: string;
  accountLabel: string;
  adSets: readonly Readonly<{
    name: string;
    delivery: string;
    ads: readonly Readonly<{
      name: string;
      status: string;
      creative: string;
      creativeType: string;
    }>[];
  }>[];
}>;

const demoHierarchyByCampaignId: Readonly<Record<(typeof campaigns)[number]["id"], DemoHierarchy>> = {
  "cmp-istanbul": { portfolioLabel: "Demo Marka · Türkiye", accountLabel: "Meta Ads · TR Acquisition", adSets: [{ name: "Broad · İstanbul", delivery: "Aktif · WhatsApp", ads: [{ name: "Uzman ekip · video", status: "ACTIVE", creative: "IG post · uzman görüşü", creativeType: "Mevcut video/post" }] }, { name: "Remarketing · 30g", delivery: "Aktif · WhatsApp", ads: [{ name: "Soru-cevap · carousel", status: "ACTIVE", creative: "Carousel · SSS", creativeType: "Mevcut asset" }] }] },
  "cmp-gcc": { portfolioLabel: "Demo Marka · International", accountLabel: "Meta Ads · GCC Leads", adSets: [{ name: "Broad · GCC", delivery: "Aktif · Lead form", ads: [{ name: "Doctor introduction · AR", status: "ACTIVE", creative: "Lead form video · AR", creativeType: "Mevcut video" }] }, { name: "LAL · qualified leads", delivery: "Learning · Lead form", ads: [{ name: "Patient story · AR", status: "LEARNING", creative: "IG post · testimonial", creativeType: "Mevcut post" }] }] },
  "cmp-awareness": { portfolioLabel: "Demo Marka · Türkiye", accountLabel: "Meta Ads · Brand", adSets: [{ name: "Broad · Türkiye", delivery: "Aktif · Awareness", ads: [{ name: "Marka filmi · 15s", status: "ACTIVE", creative: "Brand video · 15s", creativeType: "Mevcut video" }] }, { name: "Engagers · 90g", delivery: "Aktif · Awareness", ads: [{ name: "Clinic carousel", status: "ACTIVE", creative: "Carousel · klinik", creativeType: "Mevcut asset" }] }] },
};

export type PortfolioFilters = Readonly<{
  objective: string;
  category: string;
}>;

/**
 * The Today surface may only call inventory totals "verified" after the
 * read-only inventory endpoint has supplied a structurally usable snapshot.
 * Dashboard demo campaigns and planning fixtures are deliberately excluded:
 * they are navigation specimens, not a live account count.
 */
export type TodayInventorySummary = Readonly<{
  state: "verified" | "unavailable";
  adAccounts: number | null;
  campaigns: number | null;
  refreshedAt: string | null;
}>;

export function todayInventorySummary(metaInventory: MetaInventorySnapshot | null): TodayInventorySummary {
  if (!metaInventory
    || !Number.isSafeInteger(metaInventory.summary.adAccounts) || metaInventory.summary.adAccounts < 0
    || !Number.isSafeInteger(metaInventory.summary.campaigns) || metaInventory.summary.campaigns < 0
    || !Number.isFinite(Date.parse(metaInventory.refreshedAt))) {
    return Object.freeze({ state: "unavailable", adAccounts: null, campaigns: null, refreshedAt: null });
  }
  return Object.freeze({
    state: "verified",
    adAccounts: metaInventory.summary.adAccounts,
    campaigns: metaInventory.summary.campaigns,
    refreshedAt: metaInventory.refreshedAt,
  });
}

/**
 * Account focus is a local, read-only UI preference. It deliberately falls
 * back to the first current inventory account rather than preserving an ID
 * from an older snapshot, which could otherwise make a removed account look
 * selectable.
 */
export function resolveMetaAccountFocus(
  accounts: readonly MetaInventoryAccount[],
  currentAccountId: string,
): string {
  return accounts.some((account) => account.id === currentAccountId)
    ? currentAccountId
    : accounts[0]?.id ?? "";
}

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
  { id: "apr-budget", risk: "K2", title: "Arap Bölgesi FTR bütçesini gözden geçir", entity: "Arap Bölgesi · FTR · WhatsApp", before: "₺1.700 / gün", after: "İnsan incelemesi gerekli", evidence: "Pacing hedefin %14 üzerinde · route/kalite doğrulaması bekleniyor", policy: "Max değişim %10 · approval_only", dependency: "Yok" },
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

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={styles.statusPill} data-tone={tone}>{children}</span>;
}

function formatMetaTime(value: string | null) {
  if (!value) return "Bilinmiyor";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value));
}

function formatMinorBudget(value: number | null, currency: string): string {
  if (value === null) return "Tanımlı değil";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value / 100);
}

function targetingLabel(value: Record<string, unknown> | null): string {
  if (!value) return "Hedefleme özeti yok";
  const labels = Object.entries(value).slice(0, 4).map(([key, item]) => {
    const rendered = Array.isArray(item) ? item.slice(0, 3).join(", ")
      : typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? String(item) : "tanımlı";
    return `${key}: ${rendered}`;
  });
  return labels.length ? labels.join(" · ") : "Hedefleme özeti boş";
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

/**
 * This is deliberately a manual bridge, rather than a browser-to-desktop
 * protocol. It gives the operator a bounded, safe task to paste into Codex
 * while the actual conversation remains in their selected CLI session.
 */
export type CodexPageGuide = Readonly<{
  pageLabel: string;
  purpose: string;
  componentPath: string;
  recordGuide: string;
}>;

export function codexPageGuide(view: DashboardViewId, pageLabel: string): CodexPageGuide {
  const guides: Partial<Record<DashboardViewId, Omit<CodexPageGuide, "pageLabel">>> = {
    budgets: { purpose: "Bütçe havuzları, limitler ve yalnız öneri niteliğindeki dağıtım kararları.", componentPath: "src/app/dashboard/budget-lab-panel.tsx", recordGuide: "Bütçe önerisi ve approval kayıtlarını, server-side repository sözleşmeleri üzerinden incele; doğrudan tablo veya Meta değişikliği yapma." },
    rules: { purpose: "İnsan kaynaklı rehberlik, kural taslağı ve kapsam/slice tanımı.", componentPath: "src/app/dashboard/guidance-studio-panel.tsx", recordGuide: "Guidance/normalization taslaklarını ve bunların immutable kaynak bağlarını incele; taslak policy değildir." },
    "strict-policies": { purpose: "Bağlayıcı policy taslağı, iki kişiyle yayın ve kapsam/limit doğrulaması.", componentPath: "src/app/dashboard/instruction-policy-studio-panel.tsx", recordGuide: "Strict policy lifecycle kayıtlarını ve approval gereğini incele; yayınlama veya onaylama yapma." },
    "decision-room": { purpose: "Frozen kanıtla analiz ve karar taslağı üretimi.", componentPath: "src/app/dashboard/decision-room-panel.tsx", recordGuide: "Decision Room run/asset ve frozen-context sözleşmelerini yalnız oku; yeni action üretme." },
    approvals: { purpose: "Onay bekleyen typed action önerilerinin salt-okunur incelemesi.", componentPath: "src/app/dashboard/approval-queue-panel.tsx", recordGuide: "Approval Queue kayıtlarını yalnız yorumla; approve/reject/execute yapma." },
    autonomy: { purpose: "Otonomi sınırları, izin valfleri ve insan onayı kuralları.", componentPath: "src/app/dashboard/autonomy-studio-panel.tsx", recordGuide: "Autonomy policy/scope sözleşmesini incele; capability veya action yetkisi açma." },
    categories: { purpose: "İç kampanya kategorileri ve slice/künye kapsamı.", componentPath: "src/app/dashboard/category-inventory-panel.tsx", recordGuide: "Kategori profile/assignment kanıtlarını incele; belirsiz künye için yalnız inceleme önerisi üret." },
    promotions: { purpose: "Gönderi öne çıkarma için preflight ve insan onaylı hazırlık.", componentPath: "src/app/dashboard/promotion-preflight-panel.tsx", recordGuide: "Promotion preflight/binding kayıtlarını incele; yayın veya Meta write yapma." },
    analysis: { purpose: "Zaman aralığına bağlı, kanıt tabanlı analiz taslağı.", componentPath: "src/app/dashboard/operating-dashboard.tsx#renderAnalysis", recordGuide: "Frozen context, analiz run ve outcome kanıtını incele; eksik veri varsa açıkça belirt." },
  };
  const guide = guides[view] ?? { purpose: "Bu görünümün operasyonel bağlamını ve açık karar sorusunu inceleme.", componentPath: "src/app/dashboard/operating-dashboard.tsx", recordGuide: "İlgili read-model ve server-side repository sözleşmesini önce bul; doğrudan kalıcı değişiklik yapma." };
  return { pageLabel, ...guide };
}

export function buildCodexManualTask(guide: CodexPageGuide): string {
  return [
    "ReklamZeka Orchestrator görevi",
    "",
    `Ekran: ${guide.pageLabel}`,
    `Ekranın amacı: ${guide.purpose}`,
    `Uygulama adresi: ${guide.componentPath}`,
    `Kalıcı kayıt kılavuzu: ${guide.recordGuide}`,
    "Genel kılavuz: plans/proje/v2/STATE.md ve plans/proje/v2/CHECKLIST.md dosyalarını önce oku.",
    "",
    "Önce mevcut kanıtı, belirsizlikleri ve gerekli soruları çıkar. Ardından yalnız taslak analiz, künye düzeltme önerisi veya kural önerisi sun.",
    "Kısıt: policy yayınlama/onaylama, action yürütme, bütçe veya durum değiştirme ve Meta write yapma. Her öneri insan onayı beklemeli.",
    "",
    "Operatör isteği: [buraya kendi talimatınızı ekleyin]",
  ].join("\n");
}

export function OperatingDashboard({ model, initialView = "today" }: { model: OperatingDashboardModel; initialView?: DashboardViewId }) {
  const [activeView, setActiveView] = useState<ViewId>(initialView);
  const [selectedCampaign, setSelectedCampaign] = useState<string>(campaigns[0].id);
  const [workbookBriefScenario, setWorkbookBriefScenario] = useState<CampaignBriefScenarioRef>("");
  const [portfolioFilters, setPortfolioFilters] = useState<PortfolioFilters>({ objective: "all", category: "all" });
  const [approvalQueueCampaignRef, setApprovalQueueCampaignRef] = useState<string | null>(null);
  const [persistedContexts, setPersistedContexts] = useState<readonly PersistedCampaignContextSummary[]>([]);
  const [persistedContextsState, setPersistedContextsState] = useState<"loading" | "ready" | "session_required" | "unavailable">("loading");
  const [selectedPersistedCampaignRef, setSelectedPersistedCampaignRef] = useState<string | null>(null);
  const [autonomy, setAutonomy] = useState<Record<string, string>>({ analysis: "Otomatik", recommendation: "Otomatik", decrease: "Onaya sun", increase: "Onaya sun", pause: "Onaya sun", create: "Her zaman manuel" });
  const agentMessages: Array<{ from: "agent" | "user"; text: string }> = [
    { from: "agent", text: "Bu alan aynı workspace ve operatöre bağlı kalıcı Orchestrator konuşmasıdır. Codex CLI yalnız read-only model çalışma transportudur; karar, policy ve action yetkisi taşımaz." },
  ];
  const [toast, setToast] = useState<string | null>(null);
  const [metaInventory, setMetaInventory] = useState<MetaInventorySnapshot | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [selectedMetaAccountId, setSelectedMetaAccountId] = useState("");
  const [metaReadMirror, setMetaReadMirror] = useState<MetaReadMirrorProjection | null>(null);
  const [metaReadMirrorState, setMetaReadMirrorState] = useState<MetaReadMirrorLoadState>("loading");
  const [metaReadMirrorError, setMetaReadMirrorError] = useState<string | null>(null);
  const [selectedMirrorAccountRef, setSelectedMirrorAccountRef] = useState("");
  const [portfolioCapability, setPortfolioCapability] = useState<PortfolioCapabilitySummary | null>(null);
  const [portfolioCapabilityState, setPortfolioCapabilityState] = useState<"loading" | "ready" | "session_required" | "unavailable">("loading");
  const [agentSessions, setAgentSessions] = useState<AgentSessionSummary[]>([]);
  const [agentSessionsLoading, setAgentSessionsLoading] = useState(true);
  const [agentSessionError, setAgentSessionError] = useState<string | null>(null);
  const [selectedAgentSessionRef, setSelectedAgentSessionRef] = useState("");
  const [agentHandoff, setAgentHandoff] = useState<AgentHandoffSummary | null>(null);
  const [agentHandoffLoading, setAgentHandoffLoading] = useState(false);
  const [agentEntityRef, setAgentEntityRef] = useState("portfolio_current");
  const [agentEntityLabel, setAgentEntityLabel] = useState("Tüm Meta portföyü");
  const [codexManualTask, setCodexManualTask] = useState<string | null>(null);
  const [orchestratorConversation, setOrchestratorConversation] = useState<OrchestratorConversationSummary | null>(null);
  const [orchestratorState, setOrchestratorState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [orchestratorInput, setOrchestratorInput] = useState("");
  const [orchestratorSending, setOrchestratorSending] = useState(false);
  const [orchestratorError, setOrchestratorError] = useState<string | null>(null);
  const [agentSourceView, setAgentSourceView] = useState<DashboardViewId>(initialView === "agent" ? "today" : initialView);
  const [draftPolicyTemplate, setDraftPolicyTemplate] = useState<CampaignIntentTemplateRef>("");

  const filteredCampaigns = useMemo(() => filterCampaignPortfolio(campaigns, portfolioFilters), [portfolioFilters]);
  const currentCampaign = filteredCampaigns.find((campaign) => campaign.id === selectedCampaign) ?? filteredCampaigns[0] ?? campaigns[0];
  const currentDemoHierarchy = demoHierarchyByCampaignId[currentCampaign.id];
  const selectedPersistedContext = persistedContexts.find((context) => context.campaignRef === selectedPersistedCampaignRef) ?? null;
  const planningContext: CampaignPlanningBriefContext = selectedPersistedContext
    ? { campaignRef: `persisted_${selectedPersistedContext.campaignRef}`, campaignLabel: selectedPersistedContext.label, persistedCampaignRef: selectedPersistedContext.campaignRef, input: PERSISTED_UNCONFIRMED_BRIEF_INPUT }
    : currentCampaign.planningContext;
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
      setSelectedMetaAccountId((current) => resolveMetaAccountFocus(snapshot.accounts, current));
      if (announce) setToast(`Meta envanteri yenilendi: ${snapshot.summary.adAccounts} hesap · ${snapshot.summary.pages} sayfa · ${snapshot.audit.writeOperations} write.`);
    } catch (error) {
      setMetaError(error instanceof Error ? error.message : "Meta envanteri yenilenemedi");
    } finally {
      setMetaLoading(false);
    }
  }, []);

  const refreshMetaReadMirror = useCallback(async (announce = false) => {
    setMetaReadMirrorState("loading");
    setMetaReadMirrorError(null);
    try {
      const response = await fetch("/api/meta/read-mirror", { cache: "no-store", credentials: "same-origin" });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setMetaReadMirror(null);
        setMetaReadMirrorState(metaReadMirrorErrorState(response.status, payload));
        const message = plainRecord(payload) && plainRecord(payload.error) && typeof payload.error.message === "string"
          ? payload.error.message : "Kanonik Meta aynası kullanılamıyor.";
        setMetaReadMirrorError(message);
        return;
      }
      const projection = metaReadMirrorFromResponse(payload);
      if (!projection) throw new Error("Kanonik Meta aynası beklenen salt-okunur sözleşmeyle eşleşmedi.");
      setMetaReadMirror(projection);
      setMetaReadMirrorState("ready");
      const accounts = projection.connections.flatMap((connection) => connection.accounts);
      setSelectedMirrorAccountRef((current) => accounts.some((account) => account.accountRef === current)
        ? current : accounts[0]?.accountRef ?? "");
      if (announce) setToast(`Kanonik Meta aynası yenilendi: ${projection.summary.campaigns} kampanya · ${projection.summary.ads} reklam · 0 write.`);
    } catch (error) {
      setMetaReadMirror(null);
      setMetaReadMirrorState("unavailable");
      setMetaReadMirrorError(error instanceof Error ? error.message : "Kanonik Meta aynası kullanılamıyor.");
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

  useEffect(() => {
    void refreshMetaReadMirror();
    const timer = window.setInterval(() => void refreshMetaReadMirror(), 15 * 60_000);
    return () => window.clearInterval(timer);
  }, [refreshMetaReadMirror]);

  useEffect(() => { void refreshAgentSessions(); }, [refreshAgentSessions]);

  const refreshOrchestratorConversation = useCallback(async () => {
    try {
      const response = await fetch("/api/orchestrator-conversation", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "orchestrator-conversation-read" } });
      const payload = await response.json() as { conversation?: OrchestratorConversationSummary | null;
        error?: { message?: string } };
      if (!response.ok || !("conversation" in payload)) throw new Error(payload.error?.message ?? "Orchestrator sohbeti kullanılamıyor.");
      setOrchestratorConversation(payload.conversation ?? null);
      setOrchestratorState("ready");
      setOrchestratorError(null);
    } catch (error) {
      setOrchestratorState("unavailable");
      setOrchestratorError(error instanceof Error ? error.message : "Orchestrator sohbeti kullanılamıyor.");
    }
  }, []);

  useEffect(() => { void refreshOrchestratorConversation(); }, [refreshOrchestratorConversation]);

  const sendOrchestratorMessage = useCallback(async () => {
    const message = orchestratorInput.trim();
    if (!message || orchestratorSending || orchestratorState === "unavailable") return;
    setOrchestratorSending(true);
    setOrchestratorError(null);
    try {
      const body = JSON.stringify({ conversationRef: orchestratorConversation?.conversationRef ?? null,
        pageId: agentSourceView, message });
      const response = await fetch("/api/orchestrator-conversation", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "orchestrator-conversation-send" }, body });
      const payload = await response.json() as { conversation?: OrchestratorConversationSummary;
        error?: { message?: string } };
      if (!response.ok || !payload.conversation) throw new Error(payload.error?.message ?? "Codex yanıtı alınamadı.");
      setOrchestratorConversation(payload.conversation);
      setOrchestratorInput("");
      setOrchestratorState("ready");
    } catch (error) {
      setOrchestratorError(error instanceof Error ? error.message : "Codex yanıtı alınamadı.");
      await refreshOrchestratorConversation();
    } finally { setOrchestratorSending(false); }
  }, [agentSourceView, orchestratorConversation?.conversationRef, orchestratorInput,
    orchestratorSending, orchestratorState, refreshOrchestratorConversation]);

  useEffect(() => {
    let active = true;
    void fetch("/api/meta/portfolio-capability", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => ({ response, payload: await response.json() as unknown }))
      .then(({ response, payload }) => {
        if (!active) return;
        const capability = response.ok ? portfolioCapabilityFromResponse(payload) : null;
        setPortfolioCapability(capability);
        setPortfolioCapabilityState(capability ? "ready" : !response.ok && isLocalSessionRequiredResponse(payload) ? "session_required" : "unavailable");
      })
      .catch(() => { if (active) { setPortfolioCapability(null); setPortfolioCapabilityState("unavailable"); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/campaign-contexts", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => ({ response, payload: await response.json() as unknown }))
      .then(({ response, payload }) => {
        if (!active) return;
        const items = response.ok ? persistedCampaignContextsFromResponse(payload) : null;
        setPersistedContexts(items ?? []);
        setPersistedContextsState(items ? "ready" : !response.ok && isLocalSessionRequiredResponse(payload) ? "session_required" : "unavailable");
      })
      .catch(() => { if (active) { setPersistedContexts([]); setPersistedContextsState("unavailable"); } });
    return () => { active = false; };
  }, []);

  const createAgentHandoff = useCallback(async (entityRef: string): Promise<AgentHandoffSummary | null> => {
    if (!selectedAgentSessionRef || !agentSessions.some((session) => session.sessionRef === selectedAgentSessionRef)) {
      setAgentSessionError(agentSessions.length > 1 ? "Devam edilecek session'ı açıkça seçin." : "Aktif bir CLI session bulunamadı.");
      return null;
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
      return payload.handoff;
    } catch (error) {
      setAgentSessionError(error instanceof Error ? error.message : "Handoff oluşturulamadı.");
      return null;
    } finally {
      setAgentHandoffLoading(false);
    }
  }, [agentSessions, selectedAgentSessionRef]);

  const transferCurrentContextToCodex = useCallback(async () => {
    const guide = codexPageGuide(activeView, activeTitle);
    if (activeView !== "agent") setAgentSourceView(activeView);
    setAgentEntityRef("portfolio_current");
    setAgentEntityLabel(`${guide.pageLabel} · çalışma kılavuzu`);
    setAgentHandoff(null);
    const task = buildCodexManualTask(guide);
    setCodexManualTask(task);
    try {
      await navigator.clipboard.writeText(task);
      setToast("Codex görevi kopyalandı. Codex Desktop'a geçip yapıştırın.");
    } catch {
      setToast("Görev Orchestrator alanında hazır; Codex Desktop'a geçip elle kopyalayın.");
    }
    setActiveView("agent");
  }, [activeTitle, activeView]);

  function navigate(view: ViewId) {
    if (view === "agent" && activeView !== "agent") setAgentSourceView(activeView);
    setActiveView(view);
    setToast(null);
  }

  function selectCampaign(campaignId: string) {
    setApprovalQueueCampaignRef((current) => approvalQueueScopeAfterCampaignSelection(selectedCampaign, campaignId, current));
    setSelectedCampaign(campaignId);
    setSelectedPersistedCampaignRef(null);
    setWorkbookBriefScenario("");
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
    const inventorySummary = todayInventorySummary(metaInventory);
    const hasVerifiedInventory = inventorySummary.state === "verified";
    return <>
      <section className={styles.pageHero}>
        <div><span className={styles.kicker}>7 AĞUSTOS CUMA · OPERATING REVIEW</span><h1>{hasVerifiedInventory ? "Günaydın. Doğrulanmış Meta inventory hazır." : "Günaydın. Meta inventory henüz doğrulanmadı."}</h1><p>{hasVerifiedInventory ? `${inventorySummary.campaigns} kampanya · ${inventorySummary.adAccounts} hesap · ${formatMetaTime(inventorySummary.refreshedAt)}. Hiçbir Meta değişikliği onayınız olmadan yürütülmez.` : "Bu görünümdeki operasyon metrikleri deterministik demo özetidir; doğrulanmış Meta kampanya veya hesap sayısı gösterilmez."}</p></div>
        <button className={styles.primaryButton} onClick={() => navigate("agent")}><span>✦</span> Orchestrator ile çalış</button>
      </section>

      <section className={styles.signalStrip} aria-label="Sistem durumu">
        <div><span className={hasVerifiedInventory ? styles.liveDot : undefined} /> <strong>{hasVerifiedInventory ? "Meta inventory doğrulandı" : metaLoading ? "Meta inventory yükleniyor · demo" : "Meta inventory kullanılamıyor · demo"}</strong><small>{hasVerifiedInventory ? `${formatMetaTime(inventorySummary.refreshedAt)} · read-only mirror` : metaError ? "Doğrulanmış inventory kaynağı yanıt vermedi; demo sayıları canlı veri değildir." : "Doğrulanmış inventory gelene kadar demo sayıları canlı veri değildir."}</small></div>
        <div><strong>{hasVerifiedInventory ? `${inventorySummary.campaigns} doğrulanmış kampanya` : "Kampanya sayısı doğrulanmadı"}</strong><small>{hasVerifiedInventory ? `${inventorySummary.adAccounts} hesap · ${formatMetaTime(inventorySummary.refreshedAt)}` : "Hesap sayısı ve freshness unavailable; demo portföy ayrı kalır."}</small></div>
        <div><strong>Otonomi: approval_only</strong><small>K1–K4 onaya sunulur</small></div>
        <button onClick={() => navigate("timeline")}>Tüm timeline <span>→</span></button>
      </section>

      <section className={styles.metricGrid} aria-label="Canlı performans durumu">
        <article className={styles.metricCard}><div><span>{model.periodDays} günlük harcama</span><StatusPill tone="neutral">Kaynak bekleniyor</StatusPill></div><strong>—</strong><footer><span>Doğrulanmış insight/timeframe henüz bağlı değil.</span></footer></article>
        <article className={styles.metricCard}><div><span>Sonuç</span><StatusPill tone="neutral">Kaynak bekleniyor</StatusPill></div><strong>—</strong><footer><span>Canlı outcome metriği olmadan CPA gösterilmez.</span></footer></article>
        <article className={styles.metricCard}><div><span>Nitelikli lead</span><StatusPill tone="neutral">Kaynak bekleniyor</StatusPill></div><strong>—</strong><footer><span>CRM/kalite kanıtı bağlanmadan oran çıkarılmaz.</span></footer></article>
        <article className={styles.metricCard}><div><span>Bütçe gerçekleşmesi</span><StatusPill tone="neutral">Kaynak bekleniyor</StatusPill></div><strong>—</strong><footer><span>Budget owner ve gerçekleşen harcama ayrı doğrulanır.</span></footer></article>
      </section>

      <div className={styles.dashboardColumns}>
        <section className={styles.panel} aria-labelledby="decision-title">
          <header className={styles.panelHeader}><div><span className={styles.kicker}>KARAR MASASI · DEMO</span><h2 id="decision-title">Örnek karar biçimleri</h2></div><button onClick={() => navigate("approvals")}>Gerçek kuyruğu aç <span>→</span></button></header>
          <div className={styles.decisionList}>
            {approvalItems.map((item, index) => <article key={item.id} className={styles.decisionRow}>
              <div className={styles.decisionIndex}>0{index + 1}</div>
              <div className={styles.decisionBody}><div><StatusPill tone={item.risk === "K1" ? "info" : "warning"}>{item.risk}</StatusPill><span>{item.entity}</span></div><h3>{item.title}</h3><p>{item.evidence}</p><small>{item.policy}</small></div>
              <div className={styles.decisionAction}><StatusPill tone="neutral">Demo örneği</StatusPill><button className={styles.iconButton} onClick={() => navigate("approvals")} aria-label={`${item.title} için gerçek onay kuyruğunu aç`}>→</button></div>
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
        <header className={styles.panelHeader}><div><span className={styles.kicker}>PORTFÖY · DEMO</span><h2 id="portfolio-title">Planlama senaryoları</h2></div><button onClick={() => navigate("campaigns")}>3 senaryoyu aç <span>→</span></button></header>
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
      <section className={styles.panel} aria-label="Offline çalışma kitabı portföy özeti">
        <header className={styles.panelHeader}><div><span className={styles.kicker}>OFFLINE ÇALIŞMA KİTABI SNAPSHOT · SALT-OKUNUR</span><h2>{offlineWorkbookPortfolioSnapshot.period}</h2></div><StatusPill tone="neutral">Canlı Meta mirror değil</StatusPill></header>
        <p>Kaynak: {offlineWorkbookPortfolioSnapshot.source} · {formatMetaTime(offlineWorkbookPortfolioSnapshot.capturedAt)}. Bu özet yalnız sınıflandırma ve brief senaryolarına yön verir; güncel KPI, approval veya Meta yetkisi değildir.</p>
        <div className={styles.contextGrid}><div><span>Kampanya</span><strong>{offlineWorkbookPortfolioSnapshot.totals.campaigns}</strong><small>tarihli workbook kapsamı</small></div><div><span>Harcama</span><strong>{new Intl.NumberFormat("tr-TR", { style: "currency", currency: offlineWorkbookPortfolioSnapshot.currency, maximumFractionDigits: 0 }).format(offlineWorkbookPortfolioSnapshot.totals.spend)}</strong><small>yalnız bu tarihli dönem</small></div><div><span>Toplam lead</span><strong>{new Intl.NumberFormat("tr-TR").format(offlineWorkbookPortfolioSnapshot.totals.leads)}</strong><small>form ve WhatsApp ayrı tutulur</small></div><div><span>Kesinti kuralı</span><strong>Önce teslimatı doğrula</strong><small>Kesinti penceresinde performans hükmü yok</small></div></div>
        <div className={styles.campaignTable} role="table" aria-label="Çalışma kitabı pazar ve dönüşüm şeritleri"><div className={styles.tableHead} role="row"><span>Pazar</span><span>Kampanya</span><span>Lead</span><span>Form</span><span>WhatsApp</span><span>Sınır</span></div>{offlineWorkbookPortfolioSnapshot.markets.map((market) => <div className={styles.tableRow} role="row" key={market.market}><span><strong>{market.market}</strong></span><span>{market.campaigns}</span><span>{market.leads}</span><span>{market.formLeads}</span><span>{market.whatsappLeads}</span><span>Diğer pazar veya rota ile varsayılan kıyas yok</span></div>)}</div>
        <div className={styles.briefPlan}><div><span>SIRALI PLANLAMA ÇERÇEVESİ</span><ol>{offlineWorkbookPortfolioSnapshot.planningOrder.map((item) => <li key={item.step}><strong>{item.step}. {item.title}</strong><small>{item.rationale}</small></li>)}</ol></div></div>
        <div className={styles.decisionList}>{offlineWorkbookPortfolioSnapshot.lanes.map((lane) => <article className={styles.decisionRow} key={lane.label}><div className={styles.decisionBody}><div><StatusPill tone="neutral">Offline şerit</StatusPill><span>{lane.market} · {lane.language} · {lane.route}</span></div><h3>{lane.label}</h3><p>{lane.service} · {lane.leads} tarihli lead. Bu yalnız başlangıç sınıflandırmasıdır.</p></div><div className={styles.decisionAction}><button type="button" onClick={() => setWorkbookBriefScenario(lane.briefScenarioRef as OfflineWorkbookBriefScenarioRef)}>Brief'te aç</button></div></article>)}</div>
        <section className={styles.panel} aria-labelledby="campaign-template-library-title">
          <header className={styles.panelHeader}><div><span className={styles.kicker}>İNSAN İNCELEMELİ ŞABLON KÜTÜPHANESİ</span><h3 id="campaign-template-library-title">Amaç ve ihtiyaca göre brief başlangıcı seçin</h3></div><StatusPill tone="neutral">geçici planlama</StatusPill></header>
          <p>Şablonlar çalışma kitabındaki sınıflandırmayı görünür ve düzenlenebilir bir brief başlangıcına çevirir. Kaynak, campaign, policy veya Meta yetkisi taşımaz.</p>
          <div className={styles.decisionList}>{Object.entries(CAMPAIGN_BRIEF_SCENARIOS).map(([scenarioRef, scenario]) => <article className={styles.decisionRow} key={scenarioRef}>
            <div className={styles.decisionBody}><div><StatusPill tone="neutral">Taslak örnek</StatusPill><span>{scenario.input.businessGoal} · {scenario.input.conversionRoute}</span></div><h3>{scenario.label}</h3><p>{scenario.input.deliveryHealth === "interrupted" ? "Önce teslimat ve hesap sağlığını doğrulayan toparlanma briefi." : "Pazar, dil, hizmet, rota, kapasite ve kreatifi insan incelemesine taşıyan brief başlangıcı."}</p></div>
            <div className={styles.decisionAction}><button type="button" onClick={() => setWorkbookBriefScenario(scenarioRef as CampaignBriefScenarioRef)}>Brief'te aç</button></div>
          </article>)}</div>
        </section>
      </section>
      <section className={styles.portfolioOverview} aria-labelledby="portfolio-overview-title">
        <header><div><span className={styles.kicker}>BUGÜN / PORTFÖY HİYERARŞİSİ</span><h2 id="portfolio-overview-title">Demo Marka <i>→</i> Meta portföyü <i>→</i> {filteredCampaigns.length} görünür kampanya</h2><p>Filtreler yalnız bu demo/read-only snapshot'ı daraltır; account, category veya Meta yetkisi değiştirmez.</p></div><StatusPill tone="neutral">unbound demo context</StatusPill></header>
        <div className={styles.portfolioFilters} aria-label="Portföy filtreleri">
          <label htmlFor="portfolio-meta-filter"><span>Meta objective</span><select id="portfolio-meta-filter" value={portfolioFilters.objective} onChange={(event) => changePortfolioFilter("objective", event.target.value)}><option value="all">Tümü</option>{[...new Set(campaigns.map((campaign) => campaign.objective))].map((objective) => <option key={objective} value={objective}>{objective}</option>)}</select></label>
          <label htmlFor="portfolio-category-filter"><span>İç kategori</span><select id="portfolio-category-filter" value={portfolioFilters.category} onChange={(event) => changePortfolioFilter("category", event.target.value)}><option value="all">Tümü</option>{[...new Set(campaigns.map((campaign) => campaign.category))].map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <small>Kaynak: deterministik demo snapshot · persisted account-group/asset graph taklit edilmez.</small>
        </div>
      </section>
      <section className={styles.persistedContextPicker} aria-label="Persisted frozen kampanya bağlamı seçimi">
        <div><span className={styles.kicker}>PERSISTED FROZEN CONTEXT · SALT-OKUNUR</span><strong>Doğrulanmış bağlam seçimi</strong><small>{persistedContextsState === "loading" ? "Kullanılabilir frozen contextler okunuyor." : persistedContextsState === "session_required" ? "Önce Decision Room'da güvenli yerel oturumu bağlayın; demo bağlamı ayrı kalır." : persistedContextsState === "unavailable" ? "Doğrulanmış context listesi kullanılamıyor; demo bağlamı ayrı kalır." : persistedContexts.length ? "Liste yalnız en güncel geçerli frozen context alias’larını içerir." : "Bu oturumda seçilebilir frozen campaign context yok."}</small></div>
        {persistedContexts.length ? <div className={styles.persistedContextOptions}>{persistedContexts.map((context) => <button key={context.campaignRef} type="button" data-active={context.campaignRef === selectedPersistedCampaignRef} onClick={() => { setApprovalQueueCampaignRef(null); setSelectedPersistedCampaignRef(context.campaignRef); }}><strong>{context.label}</strong><small>{context.objective ?? "Meta amacı bilinmiyor"} · {formatMetaTime(context.capturedAt)}</small></button>)}</div> : null}
        {persistedContextsState === "session_required" ? <button className={styles.secondaryButton} type="button" onClick={() => navigate("decision-room")}>Yerel oturumu bağla</button> : null}
        {selectedPersistedContext ? <button className={styles.secondaryButton} type="button" onClick={() => { setApprovalQueueCampaignRef(null); setSelectedPersistedCampaignRef(null); }}>Demo seçimine dön</button> : null}
      </section>
      <div className={styles.splitWorkspace}>
        <section className={styles.panel}><header className={styles.panelHeader}><div><span className={styles.kicker}>{filteredCampaigns.length} / {campaigns.length} GÖRÜNÜR</span><h2>Kampanyalar</h2></div><StatusPill tone="good">%98,7 coverage</StatusPill></header><div className={styles.selectorList}>{filteredCampaigns.map((campaign) => <button key={campaign.id} data-active={currentCampaign.id === campaign.id} onClick={() => selectCampaign(campaign.id)}><span><strong>{campaign.name}</strong><small>{campaign.objective}</small></span><StatusPill tone={campaign.tone}>{campaign.health}</StatusPill></button>)}</div></section>
        <section className={styles.panel}><header className={styles.detailHeader}><div><span className={styles.kicker}>EFFECTIVE CAMPAIGN CONTEXT</span><h2>{currentCampaign.name}</h2><p>{currentCampaign.objective} · Campaign budget · 7d click / 1d view</p></div><button onClick={() => openAgentContext(`campaign_${currentCampaign.id.replace("cmp-", "")}`, currentCampaign.name)}>Agent ile aç ✦</button></header>
          <div className={styles.contextGrid}><div><span>İç kategori</span><strong>{currentCampaign.category}</strong><small>{currentCampaign.tags.join(" · ")}</small></div><div><span>Bütçe sahibi</span><strong>Campaign / CBO</strong><small>{currentCampaign.budget} aylık plan</small></div><div><span>Karar temposu</span><strong>72 saat observation</strong><small>Son hamle: 31 saat önce</small></div><div><span>Aktif koruma</span><strong>{currentCampaign.id === "cmp-istanbul" ? "no-transfer · floor" : "max-change %10"}</strong><small>Policy v4 · yayınlandı</small></div></div>
          <div className={styles.hierarchy}><div><span>Campaign</span><strong>{currentCampaign.name}</strong></div><div><span>Ad set · 3</span><strong>Broad · Remarketing · LAL</strong></div><div><span>Ad · 8</span><strong>6 active · 1 learning · 1 paused</strong></div><div><span>Creative/post</span><strong>5 mevcut asset · yeni üretim yok</strong></div></div>
          <section className={styles.demoHierarchyDrilldown} aria-labelledby="demo-hierarchy-title">
            <header><div><span className={styles.kicker}>PORTFÖY DRILL-DOWN · SALT-OKUNUR</span><h3 id="demo-hierarchy-title">{currentCampaign.name} içindeki mevcut demo katmanları</h3></div><StatusPill tone="neutral">deterministik demo</StatusPill></header>
            <p>Bu açılır görünüm yalnız filtrelerden sonra seçili demo kampanyasını gösterir. Frozen context, asset graph veya Meta kaynağı temsil etmez; hiçbir katman yazma ya da onay yetkisi vermez.</p>
            <details open>
              <summary><span>Portföy</span><strong>{currentDemoHierarchy.portfolioLabel}</strong><small>1 demo hesap</small></summary>
              <details>
                <summary><span>Hesap</span><strong>{currentDemoHierarchy.accountLabel}</strong><small>yalnız örnek hiyerarşi</small></summary>
                <details>
                  <summary><span>Kampanya</span><strong>{currentCampaign.name}</strong><small>{currentCampaign.objective} · {currentCampaign.category}</small></summary>
                  <div className={styles.demoAdSetList}>{currentDemoHierarchy.adSets.map((adSet) => <details key={adSet.name}>
                    <summary><span>Ad set</span><strong>{adSet.name}</strong><small>{adSet.delivery} · {adSet.ads.length} demo reklam</small></summary>
                    <div className={styles.demoAdList}>{adSet.ads.map((ad) => <details key={ad.name}>
                      <summary><span>Ad</span><strong>{ad.name}</strong><small>{ad.status}</small></summary>
                      <div className={styles.demoCreativeLeaf}><span>Creative/post</span><strong>{ad.creative}</strong><small>{ad.creativeType} · salt-okunur demo tanımı</small></div>
                    </details>)}</div>
                  </details>)}</div>
                </details>
              </details>
            </details>
          </section>
          <div className={styles.copyPreview}><span className={styles.kicker}>YAYINDAKİ REKLAM METNİ</span><h3>Saç ekimi hakkında merak ettiklerinizi uzman ekibimize sorun.</h3><p>Primary text · CTA: WhatsApp'tan mesaj gönder · Instagram post bağlı</p><footer><StatusPill tone="info">Mevcut creative</StatusPill><button>Performansını incele</button></footer></div>
        </section>
      </div>
      <CampaignPlanningBriefPanel
        context={planningContext}
        initialScenarioRef={workbookBriefScenario}
        onApprovalQueueCampaignRef={setApprovalQueueCampaignRef}
        onOpenDraftOnlyPolicy={(template) => { setDraftPolicyTemplate(template); navigate("strict-policies"); }}
      />
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
    const sourceTitle = navGroups.flatMap((group) => group.items)
      .find((item) => item.id === agentSourceView)?.label ?? "Bugün";
    const visibleMessages = orchestratorConversation?.messages.length
      ? orchestratorConversation.messages.map((message) => ({ key: message.messageRef,
        from: message.role === "assistant" ? "agent" as const : "user" as const, text: message.content }))
      : agentMessages.map((message, index) => ({ key: `intro-${index}`, ...message }));
    return <>
      <section className={styles.pageHero}><div><span className={styles.kicker}>REKLAMZEKA ORCHESTRATOR</span><h1>Tek agent, farklı vendor; aynı yetki ve karar sözleşmesi.</h1><p>Codex veya Claude session'ı değişebilir. Kampanya bağlamı, kurallar, skill'ler ve otonomi valfi ReklamZeka'da kalır.</p></div><StatusPill tone={agentSessions.length ? "good" : agentSessionError ? "warning" : "neutral"}>{agentSessionsLoading ? "Session kontrolü" : agentSessions.length ? `● ${agentSessions.length} session bağlı` : "Session bağlı değil"}</StatusPill></section>
      <div className={styles.agentWorkspace}>
        <section className={styles.agentChat}>
          <header><div><span className={styles.agentMark}>✦</span><div><strong>Orchestrator çalışma alanı</strong><small>Kaynak ekran: {sourceTitle} · konuşma sayfalar arasında korunur</small></div></div><button onClick={() => void refreshOrchestratorConversation()}>Sohbeti yenile</button></header>
          <div className={styles.chatMessages}>
            {visibleMessages.map((message) => <div key={message.key} data-from={message.from}><span>{message.from === "agent" ? "RZ" : "Siz"}</span><p>{message.text}</p></div>)}
          </div>
          {orchestratorError ? <p className={styles.agentChatError} role="alert">{orchestratorError}</p> : null}
          {codexManualTask ? <div className={styles.codexManualTask}><header><strong>Codex için hazır görev</strong><button onClick={() => void navigator.clipboard.writeText(codexManualTask).then(() => setToast("Görev yeniden kopyalandı."), () => setToast("Kopyalama kullanılamadı; metni seçip kopyalayın."))}>Tekrar kopyala</button></header><textarea aria-label="Codex görevi" readOnly value={codexManualTask} /><small>Bu manuel aktarım Meta veya policy işlemi başlatmaz.</small></div> : null}
          <div className={styles.chatComposer}><textarea aria-label="Orchestrator'a mesaj" placeholder={orchestratorState === "unavailable" ? "Kalıcı sohbet kapalı; manuel Codex aktarımını kullanın." : "Bu ekran bağlamında neyi analiz edelim veya hangi taslak kuralı hazırlayalım?"} value={orchestratorInput} disabled={orchestratorState !== "ready" || orchestratorSending} onChange={(event) => setOrchestratorInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendOrchestratorMessage(); } }} /><button disabled={orchestratorState !== "ready" || orchestratorSending || !orchestratorInput.trim()} onClick={() => void sendOrchestratorMessage()}>{orchestratorSending ? "Yanıt bekleniyor…" : "Gönder"}</button></div>
          <footer>Codex CLI · read-only sandbox · yalnız nihai yanıt ledger'a yazılır · approval/action/Meta writer yok</footer>
        </section>
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

  function renderCanonicalMetaMirror() {
    const projection = metaReadMirror;
    const mirrorAccounts = projection?.connections.flatMap((connection) => connection.accounts) ?? [];
    const account = mirrorAccounts.find((item) => item.accountRef === selectedMirrorAccountRef) ?? mirrorAccounts[0] ?? null;
    const sourceTone = projection?.sourceState === "ready" ? "good"
      : projection?.sourceState === "partial" || projection?.sourceState === "stale" ? "warning"
        : projection?.sourceState === "empty" ? "neutral" : "danger";
    const sourceLabel = projection?.sourceState === "ready" ? "Güncel"
      : projection?.sourceState === "partial" ? "Kısmi"
        : projection?.sourceState === "stale" ? "Bayat"
          : projection?.sourceState === "empty" ? "Kampanya yok" : "Kaynak yok";

    return <section className={`${styles.panel} ${styles.canonicalMirror}`} aria-label="Kanonik Meta salt okunur aynası">
      <header className={styles.panelHeader}>
        <div><span className={styles.kicker}>KANONİK DB AYNASI · SALT-OKUNUR</span><h2>Campaign → ad set → ad → creative/post</h2></div>
        <div className={styles.canonicalMirrorActions}><StatusPill tone={metaReadMirrorState === "session_required" ? "warning" : sourceTone}>{metaReadMirrorState === "loading" ? "Okunuyor" : metaReadMirrorState === "session_required" ? "Oturum gerekli" : projection ? sourceLabel : "Kullanılamıyor"}</StatusPill><button disabled={metaReadMirrorState === "loading"} onClick={() => void refreshMetaReadMirror(true)}>Aynayı yenile</button></div>
      </header>
      {metaReadMirrorState !== "ready" || !projection ? <div className={styles.canonicalMirrorNotice} role={metaReadMirrorError ? "alert" : undefined}>
        <strong>{metaReadMirrorState === "loading" ? "Kanonik kayıtlar okunuyor."
          : metaReadMirrorState === "session_required" ? "Doğrulanmış yerel dashboard oturumu gerekli."
            : "Kanonik Meta aynası şu anda kullanılamıyor."}</strong>
        <p>{metaReadMirrorError ?? "Bu alan demo veya Graph envanterini canlı hiyerarşi gibi göstermez."}</p>
      </div> : <>
        <div className={styles.canonicalMirrorSummary}>
          <div><span>Kaynak durumu</span><strong>{sourceLabel}</strong><small>Gözlem: {formatMetaTime(projection.observedAt)}</small></div>
          <div><span>Freshness</span><strong>{projection.freshnessAgeMinutes === null ? "Bilinmiyor" : `${projection.freshnessAgeMinutes} dk`}</strong><small>Eşik: {projection.freshnessThresholdMinutes} dk</small></div>
          <div><span>Hiyerarşi</span><strong>{projection.summary.campaigns} / {projection.summary.adSets} / {projection.summary.ads}</strong><small>kampanya / ad set / reklam</small></div>
          <div><span>İçerik</span><strong>{projection.summary.creatives} / {projection.summary.posts}</strong><small>creative / post</small></div>
        </div>
        {projection.reasonCodes.length ? <div className={styles.canonicalMirrorReasons}><strong>Kaynak notları</strong><p>{projection.reasonCodes.join(" · ")}</p></div> : null}
        {projection.sourceState === "empty" ? <div className={styles.canonicalMirrorNotice}><strong>Kanonik hesap kaydı var; kampanya hiyerarşisi boş.</strong><p>Boş sonuç canlı kampanya olmadığı anlamına gelir; demo kampanyalar burada gösterilmez.</p></div>
          : projection.sourceState === "unavailable" ? <div className={styles.canonicalMirrorNotice}><strong>Bağlantı veya hesap kaynağı kullanılamıyor.</strong><p>Eski ya da demo varlıklarla boşluk doldurulmadı.</p></div>
            : account ? <>
              <div className={styles.canonicalMirrorFocus}>
                <div><span>Seçili kanonik hesap</span><strong>{account.name}</strong><small>{account.currency} · {account.timezone} · son kayıt {formatMetaTime(account.freshness.latestObservedAt)}</small></div>
                <label htmlFor="canonical-meta-account"><span>Hesap</span><select id="canonical-meta-account" value={account.accountRef} onChange={(event) => setSelectedMirrorAccountRef(event.target.value)}>{mirrorAccounts.map((item) => <option key={item.accountRef} value={item.accountRef}>{item.name}</option>)}</select></label>
              </div>
              <div className={styles.canonicalHierarchy}>
                {account.campaigns.slice(0, 10).map((campaign) => <details key={campaign.campaignRef}>
                  <summary><div><strong>{campaign.name}</strong><small>{campaign.status ?? "Durum bilinmiyor"} · {campaign.objective ?? "Amaç bilinmiyor"} · {formatMetaTime(campaign.fetchedAt)}</small></div><div><strong>{campaign.adSets.length}</strong><small>ad set</small></div></summary>
                  <div className={styles.canonicalCampaignBody}>
                    <p><strong>Bütçe sahibi: {campaign.budget.owner}</strong><span>Günlük {formatMinorBudget(campaign.budget.dailyMinor, account.currency)} · ömür boyu {formatMinorBudget(campaign.budget.lifetimeMinor, account.currency)}</span></p>
                    {campaign.adSets.slice(0, 6).map((adSet) => <details key={adSet.adSetRef}>
                      <summary><div><strong>{adSet.name}</strong><small>{adSet.status ?? "Durum bilinmiyor"} · {adSet.optimizationGoal ?? "Optimizasyon bilinmiyor"}</small></div><div><strong>{adSet.ads.length}</strong><small>reklam</small></div></summary>
                      <div className={styles.canonicalAdSetBody}>
                        <p><strong>{targetingLabel(adSet.targetingSummary)}</strong><span>Bütçe sahibi: {adSet.budget.owner} · günlük {formatMinorBudget(adSet.budget.dailyMinor, account.currency)}</span></p>
                        {adSet.ads.slice(0, 6).map((ad) => <article key={ad.adRef}>
                          <header><div><strong>{ad.name}</strong><small>{ad.status ?? "Durum bilinmiyor"} · {formatMetaTime(ad.fetchedAt)}</small></div><StatusPill tone={ad.creative ? "info" : "warning"}>{ad.creative ? "İçerik bağlı" : "İçerik yok"}</StatusPill></header>
                          {ad.creative ? <div className={styles.canonicalCreative}><span>{ad.creative.sourceType}{ad.creative.format ? ` · ${ad.creative.format}` : ""}</span><strong>{ad.creative.headline ?? ad.creative.name ?? "Başlık yok"}</strong><p>{ad.creative.primaryText ?? ad.creative.description ?? ad.creative.caption ?? "Okunabilir reklam metni yok."}</p><small>CTA: {ad.creative.callToActionType ?? "yok"} · destination: {ad.creative.destinationUrl ?? "yok"}</small>{ad.creative.post ? <small>Post: {ad.creative.post.mediaType ?? "tür yok"} · {ad.creative.post.message ?? ad.creative.post.caption ?? "metin yok"}</small> : null}</div> : null}
                        </article>)}
                        {adSet.ads.length > 6 ? <small>İlk 6 / {adSet.ads.length} reklam gösteriliyor.</small> : null}
                      </div>
                    </details>)}
                    {campaign.adSets.length > 6 ? <small>İlk 6 / {campaign.adSets.length} ad set gösteriliyor.</small> : null}
                  </div>
                </details>)}
                {!account.campaigns.length ? <p className={styles.metaAccountEmpty}>Bu kanonik hesapta kampanya yok.</p> : null}
              </div>
              {account.campaigns.length > 10 ? <p className={styles.canonicalSliceNote}>İlk 10 / {account.campaigns.length} kampanya gösteriliyor. Bu ilk salt-okunur dilimdir.</p> : null}
            </> : <div className={styles.canonicalMirrorNotice}><strong>Seçilebilir kanonik reklam hesabı yok.</strong><p>Demo hesap gösterilmedi.</p></div>}
      </>}
      <footer className={styles.canonicalAuthority}>Yetki: none · publish kapalı · approve kapalı · execute kapalı · Meta write kapalı</footer>
    </section>;
  }

  function renderMetaConnection() {
    if (!metaInventory) {
      return <>
        <section className={styles.pageHero}><div><span className={styles.kicker}>META READ MIRROR</span><h1>Meta erişim envanteri hazırlanıyor.</h1><p>Token yalnız sunucu tarafında okunur; dashboard ve agent bağlamına hiçbir zaman eklenmez.</p></div><button className={styles.primaryButton} disabled={metaLoading} onClick={() => void refreshMetaInventory(true)}>{metaLoading ? "Kontrol ediliyor…" : "Yeniden dene"}</button></section>
        {renderCanonicalMetaMirror()}
        <section className={`${styles.panel} ${styles.metaEmpty}`}><StatusPill tone={metaError ? "danger" : "neutral"}>{metaError ? "Bağlantı hatası" : "Salt okunur keşif"}</StatusPill><h2>{metaError ?? "Meta Graph yanıtı bekleniyor"}</h2><p>Bu alan yalnız Graph erişim envanteridir; kanonik DB aynasının yerine geçmez. Hiçbir kampanya, bütçe, reklam seti veya reklam değiştirilmiyor.</p></section>
        <section className={styles.panel} aria-label="Portföy kapsamı"><header className={styles.panelHeader}><div><span className={styles.kicker}>PORTFÖY KAPSAMI</span><h2>Hesap grupları ve salt-okur erişim</h2></div><StatusPill tone={portfolioCapabilityState === "session_required" ? "warning" : "neutral"}>{portfolioCapabilityState === "session_required" ? "Oturum gerekli" : "Kaynak yok"}</StatusPill></header><p className={styles.metaAccountEmpty}>{portfolioCapabilityState === "session_required" ? "Gerçek hesap gruplarını görmek için önce yerel dashboard oturumunu bağlayın." : "Portföy kapsamı kaynağı henüz güvenli biçimde bağlanmadı; demo gruplar gösterilmiyor."}</p><p className={styles.safetyNote}>Bu görünümden bütçe, yayın, onay veya Meta yazma yapılamaz.</p></section>
      </>;
    }

    const inventory = metaInventory;
    const focusedMetaAccount = inventory.accounts.find((account) => account.id === selectedMetaAccountId)
      ?? inventory.accounts[0]
      ?? null;
    return <>
      <section className={styles.pageHero}>
        <div><span className={styles.kicker}>META READ MIRROR · {inventory.connection.graphApiVersion}</span><h1>Hangi varlığa erişebildiğimiz açık ve doğrulanmış.</h1><p>İzin kapsamı, canlı erişim ve ReklamZeka’da etkin yetenek birbirinden ayrıdır. Tam Meta ID’leri bu yüzeye çıkmaz.</p></div>
        <button className={styles.primaryButton} disabled={metaLoading} onClick={() => void refreshMetaInventory(true)}>{metaLoading ? "Yenileniyor…" : "Envanteri yenile"}</button>
      </section>

      {inventory.connection.securityStatus === "temporary_exposed" ? <section className={styles.securityBanner}><span>!</span><div><strong>Geçici ve riskli kimlik bilgisi</strong><p>Bu token daha önce terminal çıktısında göründü. Salt okunur kullanım zorlanıyor; ilk bakım adımı token rotasyonu olmalı.</p></div><StatusPill tone="warning">Rotation gerekli</StatusPill></section> : null}

      {renderCanonicalMetaMirror()}

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

      <section className={styles.panel} aria-label="Portföy kapsamı">
        <header className={styles.panelHeader}><div><span className={styles.kicker}>PORTFÖY KAPSAMI</span><h2>Hesap grupları ve salt-okur erişim</h2></div><StatusPill tone={portfolioCapabilityState === "ready" ? "good" : portfolioCapabilityState === "session_required" ? "warning" : "neutral"}>{portfolioCapabilityState === "ready" ? "Doğrulandı" : portfolioCapabilityState === "session_required" ? "Oturum gerekli" : "Kaynak yok"}</StatusPill></header>
        {portfolioCapabilityState === "ready" && portfolioCapability ? <div className={styles.metaAccountList}>{portfolioCapability.accounts.length ? portfolioCapability.accounts.map((account) => <article key={account.accountRef} className={styles.metaAccountDetail}>
          <div><span className={styles.kicker}>HESAP · SALT-OKUR</span><strong>{account.name}</strong><small>{account.currency} · {account.timezone} · {account.groupRefs.length ? `${account.groupRefs.length} tanımlı hesap grubu` : "Hesap grubu tanımlı değil"}</small></div>
          <dl><div><dt>Okuma</dt><dd>{account.capabilities.canRead ? "Hazır" : account.readReadiness}</dd></div><div><dt>Plan</dt><dd>{account.capabilities.canPlan ? "Sadece öneri" : "Kapalı"}</dd></div><div><dt>Onay / uygulama</dt><dd>Kapalı</dd></div><div><dt>Meta yazma</dt><dd>Kapalı</dd></div></dl>
          {account.reasonCodes.length ? <p>Eksik kanıt: {account.reasonCodes.join(" · ")}</p> : null}
        </article>) : <p className={styles.metaAccountEmpty}>Bağlı portföyde seçilebilir reklam hesabı yok.</p>}</div> : <p className={styles.metaAccountEmpty}>{portfolioCapabilityState === "session_required" ? "Gerçek hesap gruplarını görmek için önce yerel dashboard oturumunu bağlayın." : "Portföy kapsamı kaynağı henüz güvenli biçimde bağlanmadı; demo gruplar gösterilmiyor."}</p>}
        <p className={styles.safetyNote}>Hesap grubu yalnız kapsam etiketidir; hesap yetkisini genişletmez. Bütçe, yayın, onay ve Meta yazma bu görünümden yapılamaz.</p>
      </section>

      <div className={styles.metaInventoryColumns}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span className={styles.kicker}>AD ACCOUNTS</span><h2>Erişilebilir reklam hesapları</h2></div><span>{inventory.accounts.length} hesap</span></header>
          {focusedMetaAccount ? <section className={styles.metaAccountFocus} aria-label="Seçili Meta reklam hesabı">
            <div><span className={styles.kicker}>HESAP ODAĞI · SALT-OKUNUR</span><strong>{focusedMetaAccount.name}</strong><small>{focusedMetaAccount.currency ?? "Para birimi bilinmiyor"} · {focusedMetaAccount.timezone ?? "Saat dilimi bilinmiyor"} · Insights {focusedMetaAccount.insightAccess.verified ? "doğrulandı" : "doğrulanmadı"}</small></div>
            <label htmlFor="meta-account-focus"><span>Görüntülenen hesap</span><select id="meta-account-focus" value={focusedMetaAccount.id} onChange={(event) => setSelectedMetaAccountId(resolveMetaAccountFocus(inventory.accounts, event.target.value))}>{inventory.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <p>Bu seçim yalnız ekrandaki odağı değiştirir. Hesap grubu, sayfa eşleşmesi veya Meta değişikliği çıkarımı yapmaz.</p>
          </section> : <p className={styles.metaAccountEmpty}>Bu envanterde erişilebilir reklam hesabı yok.</p>}
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

  const content = activeView === "today" ? renderToday() : activeView === "campaigns" ? renderCampaigns() : activeView === "analysis" ? renderAnalysis() : activeView === "decision-room" ? <DecisionRoomPanel /> : activeView === "practice-lab" ? <PracticeLabPanel /> : activeView === "budgets" ? <BudgetLabPanel /> : activeView === "rules" ? <><SliceRuleWorkspacePanel /><GuidanceStudioPanel onOpenSession={() => navigate("decision-room")} /></> : activeView === "strict-policies" ? <InstructionPolicyStudioPanel initialCampaignIntentTemplate={draftPolicyTemplate} /> : activeView === "categories" ? <CategoryInventoryPanel onOpenSession={() => navigate("decision-room")} /> : activeView === "autonomy" ? <AutonomyStudioPanel /> : activeView === "meta" ? renderMetaConnection() : activeView === "agent" ? renderAgent() : activeView === "approvals" ? <ApprovalQueuePanel campaignRef={approvalQueueCampaignRef} /> : activeView === "promotions" ? <PromotionPreflightPanel /> : renderTimeline();

  return <main className={styles.appShell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><span>RZ</span><div><strong>ReklamZeka</strong><small>Operating System</small></div><i>DEMO</i></div>
      <nav aria-label="Ana navigasyon">{navGroups.map((group) => <div key={group.label}><span>{group.label}</span>{group.items.map((item) => <button key={item.id} data-active={activeView === item.id} onClick={() => navigate(item.id)}><Icon name={item.icon} /><strong>{item.label}</strong>{item.badge ? <i data-live={item.badge === "●"}>{item.badge}</i> : null}</button>)}</div>)}</nav>
      <div className={styles.sidebarFooter}><span className={styles.liveDot} /><div><strong>Meta Mirror</strong><small>{metaInventory ? `${metaInventory.summary.adAccounts} hesap · read-only` : `${model.freshnessLabel} · kontrol ediliyor`}</small></div><button aria-label="Bağlantı ayarları" onClick={() => navigate("meta")}>•••</button></div>
    </aside>
    <section className={styles.workspace}>
      <header className={styles.topbar}><div className={styles.mobileBrand}><span>RZ</span><strong>ReklamZeka</strong></div><button className={styles.workspacePicker} onClick={() => navigate("meta")}><span className={styles.avatar}>DM</span><span><strong>Demo Marka</strong><small>{metaInventory ? `${metaInventory.summary.adAccounts} Meta hesabı` : "Meta kontrol ediliyor"}</small></span><i>⌄</i></button><div className={styles.topActions}><button aria-label="Ara">⌕</button><button aria-label="Bildirimler">♢</button><button className={styles.codexTransferButton} disabled={agentHandoffLoading} onClick={() => void transferCurrentContextToCodex()}>{agentHandoffLoading ? "Hazırlanıyor…" : "Codex'e aktar"}</button><button className={styles.autonomyButton} onClick={() => navigate("agent")}><span className={styles.liveDot} /> approval_only <i>⌄</i></button><button className={styles.profileButton}>AY</button></div></header>
      <div className={styles.mobileNav}>{navGroups.flatMap((group) => group.items).map((item) => <button key={item.id} data-active={activeView === item.id} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</div>
      <div className={styles.content} aria-label={activeTitle}>{content}</div>
      <footer className={styles.sourceFooter}><span>{activeView === "meta" ? metaReadMirror ? `Kanonik DB aynası · ${formatMetaTime(metaReadMirror.observedAt)} · ${metaReadMirror.sourceState}` : `Kanonik DB aynası · ${metaReadMirrorState === "session_required" ? "oturum gerekli" : metaReadMirrorState === "loading" ? "okunuyor" : "kullanılamıyor"}` : activeView === "decision-room" ? "Decision Room read model · canlı kaynak bağlanmadan fixture kullanılmaz" : activeView === "practice-lab" ? "Practice Lab read model · append-only lifecycle doğrulaması" : activeView === "budgets" ? "Budget Lab read model · doğrulanmış proposal ledger" : activeView === "rules" ? "Slice Rule Workspace + Guidance Studio · append-only taslak ve kaynak registry" : activeView === "strict-policies" ? "Strict policy registry · raw provenance + normalize DSL + append-only diff" : activeView === "categories" ? "Category Registry · aktif tanımlar ve doğrudan atama kapsamı" : activeView === "approvals" ? "Approval Queue read model · tenant-bound ActionUnit projection" : activeView === "promotions" ? "Existing-post preflight · yalnız server-provided ref kataloğu" : `Demo snapshot · ${model.currency} · ${model.timezone} · ${model.attribution}`}</span><span>{activeView === "meta" ? "Kanonik hiyerarşi DB kaynaklı · Graph envanteri ayrı · action authority none · Meta write yok" : activeView === "decision-room" ? "Server-bound workspace · bounded cursor · action authority yok" : activeView === "practice-lab" ? "Public-safe projection · draft ephemeral · promotion/automation/action yok" : activeView === "budgets" ? "Public-safe projection · draft/approval/execute/Meta yok" : activeView === "rules" ? "Recommendation-only draft · publish/approval/action/automation/Meta write kapalı" : activeView === "strict-policies" ? "Cookie-only · OCC guarded · approve/execute/schedule/tool/network/Meta write kapalı" : activeView === "categories" ? "Public-safe refs · inherited context değil · assign/action/Meta kapalı" : activeView === "approvals" ? "Public-safe projection · approve/reject/grant/execute/Meta kapalı" : activeView === "promotions" ? "Ephemeral K4 preview · persist/approve/execute/Meta/creative kapalı" : "Deterministik veriler mevcut fixture/API'dan; operasyon bağlamı ürün vizyonu demosudur."}</span></footer>
    </section>
    {toast ? <div className={styles.toast} role="status"><span>✓</span><p>{toast}</p><button onClick={() => setToast(null)} aria-label="Bildirimi kapat">×</button></div> : null}
  </main>;
}
