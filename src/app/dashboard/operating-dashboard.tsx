"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MetaInventoryAccount, MetaInventoryApiError, MetaInventorySnapshot } from "@/connectors/meta/types";
import type { MetaReadMirrorProjection } from "@/domain/meta/read-mirror-projection";
import type { MetaBootstrapPreflight } from "@/connectors/meta/bootstrap-preflight";
import { DecisionRoomPanel } from "./decision-room-panel";
import { BudgetLabPanel } from "./budget-lab-panel";
import { PracticeLabPanel } from "./practice-lab-panel";
import { ApprovalQueuePanel } from "./approval-queue-panel";
import { PromotionPreflightPanel, PromotionTemplateAuthoringPanel } from "./promotion-preflight-panel";
import { AutonomyStudioPanel } from "./autonomy-studio-panel";
import { GuidanceStudioPanel } from "./guidance-studio-panel";
import { SliceRuleWorkspacePanel } from "./slice-rule-workspace-panel";
import { BudgetPoolHierarchyPanel } from "./budget-pool-hierarchy-panel";
import { OperationalTimelinePanel } from "./operational-timeline-panel";
import { DeliveryHealthAlertPanel } from "./delivery-health-alert-panel";
import { CategoryInventoryPanel, type CategoryAssignmentHandoff } from "./category-inventory-panel";
import { CampaignClassificationReviewPanel } from "./campaign-classification-review-panel";
import { InstructionPolicyStudioPanel } from "./instruction-policy-studio-panel";
import type { CampaignIntentTemplateRef } from "./normalization-workbench-panel";
import { NormalizationWorkbenchPanel } from "./normalization-workbench-panel";
import { MetaTrustReadinessPanel } from "./meta-trust-readiness-panel";
import { CanonicalPerformancePanel } from "./canonical-performance-panel";
import { CanonicalCampaignPortfolioPanel } from "./canonical-campaign-portfolio-panel";
import { campaignContextBridge } from "./campaign-planning-brief-panel";
import { LocalSessionConnector } from "./local-session-connector";
import {
  dashboardLocationFromSearch,
  dashboardLocationHref,
  normalizeDashboardLocation,
  type BudgetArea,
  type CampaignArea,
  type DashboardLocation,
  type DashboardViewId,
  type RulesArea,
  type SettingsArea,
  type ViewId,
} from "./dashboard-location";
import styles from "./operating-dashboard.module.css";

export { normalizeDashboardLocation } from "./dashboard-location";
export type { DashboardLocation, DashboardViewId } from "./dashboard-location";

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
        || !(account.freshness.insightObservedAt === null || isoText(account.freshness.insightObservedAt))
        || !(account.freshness.insightStatus === null || ["pending", "running", "partial", "completed", "failed", "cancelled"].includes(account.freshness.insightStatus as string))
        || !Number.isSafeInteger(account.freshness.insightCanonicalRowCount) || (account.freshness.insightCanonicalRowCount as number) < 0
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

/** The public preflight is intentionally capability-free and secret-free. */
export function metaBootstrapPreflightFromResponse(value: unknown): MetaBootstrapPreflight | null {
  if (!plainRecord(value) || value.schemaVersion !== 1 || value.phase !== "preflight" || value.accessMode !== "read_only"
    || !["configured", "blocked"].includes(value.readiness as string)
    || !(value.blocker === null || ["rotation_required", "explicit_security_status_required", "secret_binding_missing"].includes(value.blocker as string))
    || !["temporary_exposed", "secure", "unknown"].includes(value.securityStatus as string)
    || typeof value.secretBindingConfigured !== "boolean" || value.doctorExecuted !== false || value.bootstrapExecuted !== false
    || value.networkCalls !== 0 || value.writeOperations !== 0 || typeof value.message !== "string" || typeof value.nextStep !== "string") return null;
  if (value.readiness === "configured" ? value.blocker !== null || value.securityStatus !== "secure" || !value.secretBindingConfigured
    : value.blocker === null) return null;
  return Object.freeze(value as unknown as MetaBootstrapPreflight);
}

/**
 * A list item authenticates only its opaque alias, capture time and Meta
 * objective. The rest of the planning taxonomy remains human-confirmed until
 * the exact single-context read has completed, so a fallback campaign can never
 * silently prefill a persisted campaign brief.
 */
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

/** Only the exact local-session envelope may offer a proof-connection recovery. */
export function campaignContextRecoveryState(status: number, value: unknown): "session_required" | "unavailable" {
  return status === 401 && isLocalSessionRequiredResponse(value) ? "session_required" : "unavailable";
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
    { id: "today", label: "Bugün", icon: "⌂" },
    { id: "campaigns", label: "Kampanyalar", icon: "◫" },
    { id: "decision-room", label: "Analiz & Kararlar", icon: "◇" },
    { id: "budgets", label: "Bütçeler", icon: "₺" },
    { id: "approvals", label: "Onay kuyruğu", icon: "✓" },
  ] },
  { label: "Yönetim", items: [
    { id: "rules", label: "Kurallar & Yetkiler", icon: "≡" },
    { id: "settings", label: "Ayarlar", icon: "◎" },
  ] },
];

export type PortfolioFilters = Readonly<{
  objective: string;
  category: string;
}>;

/**
 * The Today surface derives every inventory count from the validated,
 * tenant-bound canonical mirror. Missing projections stay unavailable.
 */
export type TodayCanonicalSummary = Readonly<{
  state: MetaReadMirrorProjection["sourceState"] | "unavailable";
  accounts: number | null;
  campaigns: number | null;
  adSets: number | null;
  ads: number | null;
  observedAt: string | null;
}>;

export function todayCanonicalSummary(projection: MetaReadMirrorProjection | null): TodayCanonicalSummary {
  if (!projection || !Number.isFinite(Date.parse(projection.observedAt))) {
    return Object.freeze({ state: "unavailable", accounts: null, campaigns: null, adSets: null, ads: null, observedAt: null });
  }
  return Object.freeze({
    state: projection.sourceState,
    accounts: projection.summary.accounts,
    campaigns: projection.summary.campaigns,
    adSets: projection.summary.adSets,
    ads: projection.summary.ads,
    observedAt: projection.observedAt,
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

function Icon({ name }: { name: string }) {
  return <span aria-hidden="true" className={styles.navIcon}>{name}</span>;
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={styles.statusPill} data-tone={tone}>{children}</span>;
}

function SectionNav<T extends string>(props: Readonly<{
  label: string;
  active: T;
  items: readonly Readonly<{ id: T; label: string; description: string }>[];
  onChange(value: T): void;
}>) {
  return <nav className={styles.contextTabs} aria-label={props.label}>{props.items.map((item) => <button
    type="button" key={item.id} data-active={props.active === item.id}
    aria-current={props.active === item.id ? "page" : undefined}
    onClick={() => props.onChange(item.id)}><strong>{item.label}</strong><small>{item.description}</small></button>)}</nav>;
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
    campaigns: { purpose: "Kanonik kampanya bağlamında portföy, künye, gönderi ön kontrolü ve operasyon geçmişini inceleme.", componentPath: "src/app/dashboard/operating-dashboard.tsx", recordGuide: "Meta read mirror, classification review, promotion preflight ve timeline kaynaklarını ayrı authority sınırlarıyla incele; seçili bağlam yoksa çıkarım yapma." },
    budgets: { purpose: "Bütçe havuzları, limitler ve yalnız öneri niteliğindeki dağıtım kararları.", componentPath: "src/app/dashboard/budget-lab-panel.tsx + src/app/dashboard/budget-pool-hierarchy-panel.tsx", recordGuide: "Bütçe önerisi, havuz ve approval kayıtlarını server-side repository sözleşmeleri üzerinden incele; doğrudan tablo veya Meta değişikliği yapma." },
    rules: { purpose: "Guidance, normalize kural, strict policy, yetki ve insan kapılı öğrenim yaşam döngüsü.", componentPath: "src/app/dashboard/guidance-studio-panel.tsx + src/app/dashboard/normalization-workbench-panel.tsx + src/app/dashboard/slice-rule-workspace-panel.tsx + src/app/dashboard/instruction-policy-studio-panel.tsx + src/app/dashboard/autonomy-studio-panel.tsx + src/app/dashboard/practice-lab-panel.tsx", recordGuide: "Guidance → Normalization → Slice Rule → Policy → Authority zincirindeki immutable kaynakları incele; yayın, onay veya execution yapma." },
    settings: { purpose: "Meta bağlantısı, kategori registry ve promotion şablonlarının seyrek kullanılan yönetim ayarları.", componentPath: "src/app/dashboard/operating-dashboard.tsx", recordGuide: "Yalnız seçili ayarın server-backed readiness ve lifecycle kayıtlarını incele; secret, raw Meta kimliği veya kapsam dışı mutation üretme." },
    "strict-policies": { purpose: "Bağlayıcı policy taslağı, iki kişiyle yayın ve kapsam/limit doğrulaması.", componentPath: "src/app/dashboard/instruction-policy-studio-panel.tsx", recordGuide: "Strict policy lifecycle kayıtlarını ve approval gereğini incele; yayınlama veya onaylama yapma." },
    "decision-room": { purpose: "Gerçek rutin, koşum ve analiz sonuçlarını frozen kanıtla inceleme.", componentPath: "src/app/dashboard/decision-room-panel.tsx", recordGuide: "Decision Room run/asset ve frozen-context sözleşmelerini yalnız oku; yeni action üretme." },
    approvals: { purpose: "Onay bekleyen typed action önerilerinin salt-okunur incelemesi.", componentPath: "src/app/dashboard/approval-queue-panel.tsx", recordGuide: "Approval Queue kayıtlarını yalnız yorumla; approve/reject/execute yapma." },
    alerts: { purpose: "Ödeme veya teslimat kesintisi kanıtını, insan kontrol listesini ve öneri bekletme durumunu inceleme.", componentPath: "src/app/dashboard/delivery-health-alert-panel.tsx", recordGuide: "Delivery health alert ledger kayıtlarını yalnız yorumla; alarm çözme, onay, action veya Meta write yapma." },
    autonomy: { purpose: "Otonomi sınırları, izin valfleri ve insan onayı kuralları.", componentPath: "src/app/dashboard/autonomy-studio-panel.tsx", recordGuide: "Autonomy policy/scope sözleşmesini incele; capability veya action yetkisi açma." },
    categories: { purpose: "İç kampanya kategorileri ve slice/künye kapsamı.", componentPath: "src/app/dashboard/category-inventory-panel.tsx", recordGuide: "Kategori profile/assignment kanıtlarını incele; belirsiz künye için yalnız inceleme önerisi üret." },
    promotions: { purpose: "Gönderi öne çıkarma için preflight ve insan onaylı hazırlık.", componentPath: "src/app/dashboard/promotion-preflight-panel.tsx", recordGuide: "Promotion preflight/binding kayıtlarını incele; yayın veya Meta write yapma." },
    analysis: { purpose: "Gerçek rutin, koşum ve analiz sonuçlarını frozen kanıtla inceleme.", componentPath: "src/app/dashboard/decision-room-panel.tsx", recordGuide: "Eski Analizler yüzeyi Analiz & Kararlar altında birleşmiştir. Decision Room run/asset ve frozen-context sözleşmelerini yalnız oku; eksik veri varsa açıkça belirt." },
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

export function OperatingDashboard({ initialView = "today", initialLocation }: Readonly<{
  model?: OperatingDashboardModel;
  initialView?: DashboardViewId;
  initialLocation?: DashboardLocation;
}>) {
  const initialLocationRef = useRef(initialLocation ?? normalizeDashboardLocation(initialView));
  const [activeView, setActiveView] = useState<ViewId>(initialLocationRef.current.view);
  const [budgetArea, setBudgetArea] = useState<BudgetArea>(initialLocationRef.current.budgetArea);
  const [campaignArea, setCampaignArea] = useState<CampaignArea>(initialLocationRef.current.campaignArea);
  const [rulesArea, setRulesArea] = useState<RulesArea>(initialLocationRef.current.rulesArea);
  const [settingsArea, setSettingsArea] = useState<SettingsArea>(initialLocationRef.current.settingsArea);
  const [assistantOpen, setAssistantOpen] = useState(initialLocationRef.current.assistantOpen);
  const assistantTriggerRef = useRef<HTMLButtonElement>(null);
  const assistantCloseRef = useRef<HTMLButtonElement>(null);
  const assistantDrawerRef = useRef<HTMLElement>(null);
  const assistantWasOpenRef = useRef(initialLocationRef.current.assistantOpen);
  const contentRef = useRef<HTMLElement>(null);
  const lastContentFocusKeyRef = useRef("");
  const [requestedCampaignRef, setRequestedCampaignRef] = useState<string | null>(initialLocationRef.current.campaignRef);
  const requestedCampaignRefRef = useRef<string | null>(initialLocationRef.current.campaignRef);
  const campaignContextRequestRef = useRef(0);
  const [requestedCampaignLabel, setRequestedCampaignLabel] = useState("Seçili kampanya");
  const [campaignContextResolution, setCampaignContextResolution] = useState<"idle" | "loading" | "session_required" | "unavailable" | "ready">("idle");
  const [approvalQueueCampaignRef, setApprovalQueueCampaignRef] = useState<string | null>(null);
  const [campaignDecisionContext, setCampaignDecisionContext] = useState<Readonly<{
    sourceCampaignRef: string;
    label: string;
    decisionRoomCampaignRef: string;
    approvalQueueCampaignRef: string;
  }> | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [metaInventory, setMetaInventory] = useState<MetaInventorySnapshot | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [selectedMetaAccountId, setSelectedMetaAccountId] = useState("");
  const [metaReadMirror, setMetaReadMirror] = useState<MetaReadMirrorProjection | null>(null);
  const [metaReadMirrorState, setMetaReadMirrorState] = useState<MetaReadMirrorLoadState>("loading");
  const [metaReadMirrorError, setMetaReadMirrorError] = useState<string | null>(null);
  const [localSessionGeneration, setLocalSessionGeneration] = useState(0);
  const [metaBootstrapPreflight, setMetaBootstrapPreflight] = useState<MetaBootstrapPreflight | null>(null);
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
  const [orchestratorState, setOrchestratorState] = useState<"loading" | "ready" | "session_required" | "unavailable">("loading");
  const [orchestratorInput, setOrchestratorInput] = useState("");
  const [orchestratorSending, setOrchestratorSending] = useState(false);
  const [orchestratorError, setOrchestratorError] = useState<string | null>(null);
  const [agentSourceView, setAgentSourceView] = useState<ViewId>(initialLocationRef.current.view);
  const [draftPolicyTemplate, setDraftPolicyTemplate] = useState<CampaignIntentTemplateRef>("");
  const [rulesSessionRequired, setRulesSessionRequired] = useState<boolean | null>(null);
  const [categoryAssignmentHandoff, setCategoryAssignmentHandoff] = useState<CategoryAssignmentHandoff | null>(null);

  const dashboardLocation = useMemo<DashboardLocation>(() => ({ view: activeView,
    budgetArea, campaignArea, rulesArea, settingsArea, assistantOpen,
    campaignRef: activeView === "decision-room" || activeView === "approvals" ? requestedCampaignRef : null }),
  [activeView, assistantOpen, budgetArea, campaignArea, requestedCampaignRef, rulesArea, settingsArea]);
  const contentFocusKey = `${activeView}:${budgetArea}:${campaignArea}:${rulesArea}:${settingsArea}:${requestedCampaignRef ?? ""}`;
  const applyDashboardLocation = useCallback((location: DashboardLocation) => {
    setActiveView(location.view);
    setBudgetArea(location.budgetArea);
    setCampaignArea(location.campaignArea);
    setRulesArea(location.rulesArea);
    setSettingsArea(location.settingsArea);
    setAssistantOpen(location.assistantOpen);
    const campaignChanged = requestedCampaignRefRef.current !== location.campaignRef;
    if (campaignChanged) {
      // Any response for the previous opaque alias is no longer allowed to
      // resolve this screen after a navigation or a history restoration.
      campaignContextRequestRef.current += 1;
      requestedCampaignRefRef.current = location.campaignRef;
      setRequestedCampaignLabel("Seçili kampanya");
      setCampaignDecisionContext(null);
      setApprovalQueueCampaignRef(null);
      setCampaignContextResolution(location.campaignRef === null ? "idle" : "loading");
    }
    setRequestedCampaignRef(location.campaignRef);
    if (location.campaignRef === null) {
      setCampaignDecisionContext(null);
      setApprovalQueueCampaignRef(null);
      setCampaignContextResolution("idle");
    }
    setToast(null);
  }, []);
  const commitDashboardLocation = useCallback((location: DashboardLocation, mode: "push" | "replace" = "push") => {
    applyDashboardLocation(location);
    const href = dashboardLocationHref(location);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current === href) return;
    window.history[mode === "push" ? "pushState" : "replaceState"]({ dashboardLocation: location }, "", href);
  }, [applyDashboardLocation]);

  useEffect(() => {
    const initial = initialLocationRef.current;
    const canonicalHref = dashboardLocationHref(initial);
    if (`${window.location.pathname}${window.location.search}` !== canonicalHref) {
      window.history.replaceState({ dashboardLocation: initial }, "", canonicalHref);
    }
    const restoreLocation = () => applyDashboardLocation(dashboardLocationFromSearch(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, [applyDashboardLocation]);

  useEffect(() => {
    if (lastContentFocusKeyRef.current === "") {
      lastContentFocusKeyRef.current = contentFocusKey;
      return;
    }
    if (lastContentFocusKeyRef.current === contentFocusKey) return;
    lastContentFocusKeyRef.current = contentFocusKey;
    const frame = window.requestAnimationFrame(() => contentRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [contentFocusKey]);

  const activeTitle = useMemo(() => navGroups.flatMap((group) => group.items).find((item) => item.id === activeView)?.label ?? "Bugün", [activeView]);

  const refreshRequestedCampaignContext = useCallback(async (): Promise<boolean> => {
    const requestId = campaignContextRequestRef.current + 1;
    campaignContextRequestRef.current = requestId;
    if (!requestedCampaignRef) return false;
    if (campaignDecisionContext?.sourceCampaignRef === requestedCampaignRef) {
      if (requestedCampaignRefRef.current === requestedCampaignRef && campaignContextRequestRef.current === requestId) {
        setCampaignContextResolution("ready");
      }
      return true;
    }
    setCampaignContextResolution("loading");
    try {
      const response = await fetch(`/api/campaign-context?campaignRef=${encodeURIComponent(requestedCampaignRef)}`, {
      cache: "no-store", credentials: "same-origin",
      });
      const payload: unknown = await response.json();
      if (requestedCampaignRefRef.current !== requestedCampaignRef || campaignContextRequestRef.current !== requestId) return false;
      const bridge = response.ok ? campaignContextBridge(payload, requestedCampaignRef) : null;
      if (!bridge) {
        setCampaignDecisionContext(null);
        setApprovalQueueCampaignRef(null);
        setCampaignContextResolution(campaignContextRecoveryState(response.status, payload));
        return false;
      }
      setCampaignDecisionContext(Object.freeze({ sourceCampaignRef: requestedCampaignRef, label: requestedCampaignLabel, decisionRoomCampaignRef: bridge.decisionRoomCampaignRef, approvalQueueCampaignRef: bridge.approvalQueueCampaignRef }));
      setApprovalQueueCampaignRef(bridge.approvalQueueCampaignRef);
      setCampaignContextResolution("ready");
      return true;
    } catch {
      if (requestedCampaignRefRef.current !== requestedCampaignRef || campaignContextRequestRef.current !== requestId) return false;
      setCampaignDecisionContext(null);
      setApprovalQueueCampaignRef(null);
      setCampaignContextResolution("unavailable");
      return false;
    }
  }, [campaignDecisionContext?.sourceCampaignRef, requestedCampaignLabel, requestedCampaignRef]);

  useEffect(() => { if (requestedCampaignRef) void refreshRequestedCampaignContext(); else setCampaignContextResolution("idle"); }, [refreshRequestedCampaignContext, requestedCampaignRef]);

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
        return null;
      }
      const projection = metaReadMirrorFromResponse(payload);
      if (!projection) throw new Error("Kanonik Meta aynası beklenen salt-okunur sözleşmeyle eşleşmedi.");
      setMetaReadMirror(projection);
      setMetaReadMirrorState("ready");
      const accounts = projection.connections.flatMap((connection) => connection.accounts);
      setSelectedMirrorAccountRef((current) => accounts.some((account) => account.accountRef === current)
        ? current : accounts[0]?.accountRef ?? "");
      if (announce) setToast(`Kanonik Meta aynası yenilendi: ${projection.summary.campaigns} kampanya · ${projection.summary.ads} reklam · 0 write.`);
      return projection;
    } catch (error) {
      setMetaReadMirror(null);
      setMetaReadMirrorState("unavailable");
      setMetaReadMirrorError(error instanceof Error ? error.message : "Kanonik Meta aynası kullanılamıyor.");
      return null;
    }
  }, []);

  const refreshMetaBootstrapPreflight = useCallback(async () => {
    try {
      const response = await fetch("/api/meta/bootstrap-status", { cache: "no-store", credentials: "same-origin" });
      const candidate: unknown = await response.json();
      setMetaBootstrapPreflight(response.ok ? metaBootstrapPreflightFromResponse(candidate) : null);
    } catch { setMetaBootstrapPreflight(null); }
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
    if (activeView !== "settings" || settingsArea !== "meta") return;
    void refreshMetaInventory();
    const timer = window.setInterval(() => void refreshMetaInventory(), 15 * 60_000);
    return () => window.clearInterval(timer);
  }, [activeView, refreshMetaInventory, settingsArea]);

  useEffect(() => {
    void refreshMetaReadMirror();
    const timer = window.setInterval(() => void refreshMetaReadMirror(), 15 * 60_000);
    return () => window.clearInterval(timer);
  }, [refreshMetaReadMirror]);

  useEffect(() => {
    if (activeView === "settings" && settingsArea === "meta") void refreshMetaBootstrapPreflight();
  }, [activeView, refreshMetaBootstrapPreflight, settingsArea]);

  useEffect(() => {
    if (assistantOpen) void refreshAgentSessions();
  }, [assistantOpen, refreshAgentSessions]);

  const refreshOrchestratorConversation = useCallback(async (): Promise<boolean> => {
    setOrchestratorState("loading");
    try {
      const response = await fetch("/api/orchestrator-conversation", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "orchestrator-conversation-read" } });
      const payload = await response.json() as { conversation?: OrchestratorConversationSummary | null;
        error?: { code?: string; message?: string } };
      if (!response.ok || !("conversation" in payload)) {
        setOrchestratorState(response.status === 401 || payload.error?.code === "local_session_required"
          ? "session_required" : "unavailable");
        setOrchestratorError(payload.error?.message ?? "Orchestrator sohbeti kullanılamıyor.");
        return false;
      }
      setOrchestratorConversation(payload.conversation ?? null);
      setOrchestratorState("ready");
      setOrchestratorError(null);
      return true;
    } catch (error) {
      setOrchestratorState("unavailable");
      setOrchestratorError(error instanceof Error ? error.message : "Orchestrator sohbeti kullanılamıyor.");
      return false;
    }
  }, []);

  useEffect(() => {
    if (assistantOpen) void refreshOrchestratorConversation();
  }, [assistantOpen, refreshOrchestratorConversation]);

  useEffect(() => {
    if (!assistantOpen) {
      if (assistantWasOpenRef.current) window.setTimeout(() => assistantTriggerRef.current?.focus(), 0);
      assistantWasOpenRef.current = false;
      return;
    }
    assistantWasOpenRef.current = true;
    assistantCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        commitDashboardLocation({ ...dashboardLocation, assistantOpen: false }, "replace");
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = assistantDrawerRef.current;
      if (!drawer) return;
      const focusable = [...drawer.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")]
        .filter((element) => element.getAttribute("aria-hidden") !== "true");
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [assistantOpen, commitDashboardLocation, dashboardLocation]);

  const verifyOrchestratorWorkspace = useCallback(async () => {
    const connected = await refreshOrchestratorConversation();
    if (connected) await refreshAgentSessions();
    return connected;
  }, [refreshAgentSessions, refreshOrchestratorConversation]);

  const sendOrchestratorMessage = useCallback(async () => {
    const message = orchestratorInput.trim();
    if (!message || orchestratorSending || orchestratorState !== "ready") return;
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

  const refreshPortfolioCapability = useCallback(async () => {
    try {
      const response = await fetch("/api/meta/portfolio-capability", { cache: "no-store", credentials: "same-origin" });
      const payload: unknown = await response.json();
      const capability = response.ok ? portfolioCapabilityFromResponse(payload) : null;
      setPortfolioCapability(capability);
      setPortfolioCapabilityState(capability ? "ready" : !response.ok && isLocalSessionRequiredResponse(payload) ? "session_required" : "unavailable");
    } catch {
      setPortfolioCapability(null);
      setPortfolioCapabilityState("unavailable");
    }
  }, []);

  useEffect(() => {
    if (activeView === "settings" && settingsArea === "meta") void refreshPortfolioCapability();
  }, [activeView, refreshPortfolioCapability, settingsArea]);

  const verifyAndRefreshLocalSession = useCallback(async () => {
    const projection = await refreshMetaReadMirror(true);
    if (!projection || projection.sourceState === "unavailable") return false;
    setLocalSessionGeneration((current) => current + 1);
    await Promise.all([refreshPortfolioCapability(), refreshAgentSessions(), refreshOrchestratorConversation()]);
    return true;
  }, [refreshAgentSessions, refreshMetaReadMirror, refreshOrchestratorConversation, refreshPortfolioCapability]);

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
    setAgentSourceView(activeView);
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
    commitDashboardLocation({ ...dashboardLocation, assistantOpen: true });
  }, [activeTitle, activeView, commitDashboardLocation, dashboardLocation]);

  function navigate(view: ViewId) {
    const keepsCampaignContext = view === "decision-room" || view === "approvals";
    commitDashboardLocation({ ...dashboardLocation, view, assistantOpen: false,
      campaignRef: keepsCampaignContext ? requestedCampaignRef : null });
  }

  function openSettings(area: SettingsArea = "meta") {
    commitDashboardLocation({ ...dashboardLocation, view: "settings", settingsArea: area, assistantOpen: false });
  }

  function openAgentContext(entityRef: string, label: string) {
    setAgentSourceView(activeView);
    setAgentEntityRef(entityRef);
    setAgentEntityLabel(label);
    setAgentHandoff(null);
    commitDashboardLocation({ ...dashboardLocation, assistantOpen: true });
  }

  function openCampaignDecisionContext(campaignRef: string, label: string) {
    commitDashboardLocation({ ...dashboardLocation, view: "decision-room", assistantOpen: false, campaignRef });
    // Navigation resets untrusted labels. Keep the current mirror label only
    // for this immediate in-app transition; shared URLs remain deliberately generic.
    setRequestedCampaignLabel(label);
  }

  function clearCampaignDecisionContext() {
    commitDashboardLocation({ ...dashboardLocation, campaignRef: null }, "replace");
  }

  function closeAssistant() {
    commitDashboardLocation({ ...dashboardLocation, assistantOpen: false }, "replace");
  }

  function renderToday() {
    const summary = todayCanonicalSummary(metaReadMirror);
    const hasCanonicalSource = metaReadMirrorState === "ready" && metaReadMirror !== null
      && metaReadMirror.sourceState !== "unavailable";
    const sourceLabel = metaReadMirrorState === "loading" ? "Kanonik ayna okunuyor"
      : metaReadMirrorState === "session_required" ? "Yerel oturum gerekli"
        : metaReadMirrorState === "unavailable" ? "Kanonik ayna kullanılamıyor"
          : summary.state === "ready" ? "Kanonik ayna güncel"
            : summary.state === "partial" ? "Kanonik ayna kısmi"
              : summary.state === "stale" ? "Kanonik ayna gecikmiş"
                : summary.state === "empty" ? "Kanonik ayna boş"
                  : "Kanonik kaynak hazır değil";
    const sourceTone = summary.state === "ready" ? "good"
      : summary.state === "partial" || summary.state === "stale" ? "warning" : "neutral";

    return <>
      <section className={styles.pageHero}>
        <div><span className={styles.kicker}>GÜNLÜK OPERASYON · KANONİK KAYNAK</span><h1>Bugün neye güvenebileceğinizi tek bakışta görün.</h1><p>Hesap ve kampanya sayıları yalnız bu çalışma alanına bağlı Meta aynasından; performans yalnız yeterli günlük veri kapsamından gelir. Eksik veri sıfır veya örnek değer olarak gösterilmez.</p></div>
        <button className={styles.primaryButton} onClick={() => openAgentContext("portfolio_current", "Bugün · kanonik portföy")}><span>✦</span> Asistanla çalış</button>
      </section>

      <section className={styles.signalStrip} aria-label="Kanonik kaynak durumu">
        <div><span className={summary.state === "ready" ? styles.liveDot : undefined} /><strong>{sourceLabel}</strong><small>{summary.observedAt ? `${formatMetaTime(summary.observedAt)} · salt-okunur` : metaReadMirrorError ?? "Kaynak doğrulaması tamamlanmadı."}</small></div>
        <div><strong>{summary.campaigns === null ? "Kampanya sayısı kullanılamıyor" : `${summary.campaigns} kampanya`}</strong><small>{summary.accounts === null ? "Hesap sayısı kullanılamıyor" : `${summary.accounts} hesap · ${summary.adSets} ad set · ${summary.ads} reklam`}</small></div>
        <div><strong>Yetki: salt-okunur</strong><small>Yayınlama, onay, uygulama ve Meta değişikliği kapalı</small></div>
        <button onClick={() => void refreshMetaReadMirror(true)}>Kaynağı yenile <span>→</span></button>
      </section>

      <CanonicalPerformancePanel key={localSessionGeneration} />

      <div className={`${styles.dashboardColumns} ${styles.dashboardColumnsSingle}`}>
        <section className={styles.panel} aria-labelledby="portfolio-summary-title">
          <header className={styles.panelHeader}><div><span className={styles.kicker}>KANONİK PORTFÖY ÖZETİ</span><h2 id="portfolio-summary-title">{hasCanonicalSource ? "Aynalanmış Meta yapısı" : "Portföy kaynağı bekleniyor"}</h2></div><StatusPill tone={sourceTone}>{sourceLabel}</StatusPill></header>
          {hasCanonicalSource ? <div className={styles.contextGrid}>
            <div><span>Hesap</span><strong>{summary.accounts}</strong><small>çalışma alanına bağlı ayna</small></div>
            <div><span>Kampanya</span><strong>{summary.campaigns}</strong><small>örnek satır eklenmez</small></div>
            <div><span>Ad set</span><strong>{summary.adSets}</strong><small>kanonik hiyerarşi</small></div>
            <div><span>Reklam</span><strong>{summary.ads}</strong><small>salt-okunur durum</small></div>
          </div> : <p>{metaReadMirrorState === "session_required" ? "Kanonik portföy yerel oturum sınırının arkasında. Oturum bağlanmadan hesap veya kampanya sayısı gösterilmez." : "Kanonik portföy doğrulanamadı. Bu alan sahte veya eski bir portföyle doldurulmaz."}</p>}
          {metaReadMirrorState === "session_required" ? <LocalSessionConnector title="Kanonik Meta portföyünü bağlayın" onVerify={verifyAndRefreshLocalSession} /> : null}
          <div className={styles.agentActions}><button className={styles.primaryButton} onClick={() => navigate("campaigns")}>Kampanyaları aç</button><button onClick={() => openSettings("meta")}>Kaynak ayarları</button></div>
        </section>

      </div>

      {metaReadMirrorState === "ready" ? <DeliveryHealthAlertPanel embedded /> : null}
    </>;
  }

  function renderCampaigns() {
    const hasCanonicalCampaignSource = metaReadMirrorState === "ready" && metaReadMirror !== null
      && metaReadMirror.sourceState !== "unavailable";
    const unavailableTitle = metaReadMirrorState === "loading" ? "Kampanya kaynağı okunuyor"
      : metaReadMirrorState === "session_required" ? "Kampanyalar için yerel oturum gerekli"
        : "Kanonik kampanya kaynağı kullanılamıyor";
    return <>
      <section className={styles.pageHero}><div><span className={styles.kicker}>KAMPANYA ÇALIŞMA ALANI · KANONİK BAĞLAM</span><h1>Kampanyayı bulun, sınıflandırın ve ilgili operasyonu aynı bağlamda yürütün.</h1><p>Portföy, künye incelemesi, mevcut gönderi ön kontrolü ve operasyon geçmişi birbirinden kopuk sayfalar değildir. Her işlev yalnız gerçek kaynağı ve kendi yetki sınırı hazır olduğunda açılır.</p></div>{campaignArea === "portfolio" ? <button className={styles.primaryButton} onClick={() => void refreshMetaReadMirror(true)}>Kaynağı yenile</button> : null}</section>
      <SectionNav<CampaignArea> label="Kampanya çalışma alanı" active={campaignArea} onChange={(area) => commitDashboardLocation({ ...dashboardLocation, campaignArea: area })} items={[
        { id: "portfolio", label: "Portföy", description: "Kampanya → kreatif" },
        { id: "classification", label: "Künye inceleme", description: "Eksik ve çelişkili sınıflar" },
        { id: "promotion", label: "Gönderi öne çıkarma", description: "K4 ön kontrol" },
        { id: "timeline", label: "Geçmiş", description: "Kural, alarm ve karar izi" },
      ]} />
      {campaignArea === "portfolio" && hasCanonicalCampaignSource && metaReadMirror
        ? <CanonicalCampaignPortfolioPanel projection={metaReadMirror} onOpenAgentContext={openAgentContext} onOpenDecisionContext={(campaignRef, label) => void openCampaignDecisionContext(campaignRef, label)} />
        : campaignArea === "portfolio" ? <section className={styles.panel} aria-labelledby="campaign-source-state-title">
          <header className={styles.panelHeader}><div><span className={styles.kicker}>KAYNAK DURUMU</span><h2 id="campaign-source-state-title">{unavailableTitle}</h2></div><StatusPill tone={metaReadMirrorState === "unavailable" ? "warning" : "neutral"}>{metaReadMirrorState}</StatusPill></header>
          <p>{metaReadMirrorState === "session_required" ? "Çalışma alanına bağlı kampanya aynası yerel oturum olmadan okunamaz. Bu sınır aşılmadan kampanya adı, bütçe, performans veya hiyerarşi gösterilmez." : metaReadMirrorState === "loading" ? "Kanonik ayna doğrulanıyor. Sonuç gelene kadar ekran örnek içerikle doldurulmaz." : metaReadMirrorError ?? "Kanonik ayna beklenen salt-okunur sözleşmeyle doğrulanamadı."}</p>
          {metaReadMirrorState === "session_required" ? <LocalSessionConnector title="Kanonik kampanya kaynağını bağlayın" onVerify={verifyAndRefreshLocalSession} /> : null}
          <div className={styles.agentActions}>{metaReadMirrorState === "session_required" ? null : <button className={styles.primaryButton} onClick={() => void refreshMetaReadMirror(true)}>Tekrar dene</button>}<button onClick={() => openSettings("meta")}>Kaynak ayarları</button></div>
        </section> : campaignArea === "classification" ? <CampaignClassificationReviewPanel onPrepareAssignment={(handoff) => {
          setCategoryAssignmentHandoff(handoff); openSettings("categories");
        }} />
          : campaignArea === "promotion" ? <PromotionPreflightPanel embedded />
            : <OperationalTimelinePanel embedded />}
    </>;
  }

  function renderAgent() {
    const sourceTitle = navGroups.flatMap((group) => group.items)
      .find((item) => item.id === agentSourceView)?.label ?? "Bugün";
    const visibleMessages = orchestratorState === "ready"
      ? (orchestratorConversation?.messages.map((message) => ({ key: message.messageRef,
          from: message.role === "assistant" ? "agent" as const : "user" as const, text: message.content })) ?? [])
      : [];
    return <div className={`${styles.agentWorkspace} ${orchestratorState === "ready" ? "" : styles.agentWorkspaceSingle}`}>
        <section className={styles.agentChat}>
          <header><div><span className={styles.agentMark}>✦</span><div><strong>Orchestrator çalışma alanı</strong><small>Kaynak ekran: {sourceTitle} · konuşma sayfalar arasında korunur</small></div></div><button onClick={() => void refreshOrchestratorConversation()}>Sohbeti yenile</button></header>
          <div className={styles.chatMessages}>
            {orchestratorState === "loading" ? <p role="status">Kalıcı konuşma kaynağı doğrulanıyor…</p> : null}
            {orchestratorState === "session_required" ? <LocalSessionConnector title="Orchestrator konuşmasını bağlayın" onVerify={verifyOrchestratorWorkspace} /> : null}
            {orchestratorState === "unavailable" ? <p role="alert">{orchestratorError ?? "Kalıcı Orchestrator konuşması kullanılamıyor."} Manuel Codex aktarımı kullanılabilir.</p> : null}
            {orchestratorState === "ready" && !visibleMessages.length ? <p>Kalıcı konuşma bağlı; henüz mesaj yok.</p> : null}
            {visibleMessages.map((message) => <div key={message.key} data-from={message.from}><span>{message.from === "agent" ? "RZ" : "Siz"}</span><p>{message.text}</p></div>)}
          </div>
          {orchestratorError && orchestratorState === "ready" ? <p className={styles.agentChatError} role="alert">{orchestratorError}</p> : null}
          {codexManualTask ? <div className={styles.codexManualTask}><header><strong>Codex için hazır görev</strong><button onClick={() => void navigator.clipboard.writeText(codexManualTask).then(() => setToast("Görev yeniden kopyalandı."), () => setToast("Kopyalama kullanılamadı; metni seçip kopyalayın."))}>Tekrar kopyala</button></header><textarea aria-label="Codex görevi" readOnly value={codexManualTask} /><small>Bu manuel aktarım Meta veya policy işlemi başlatmaz.</small></div> : null}
          <div className={styles.chatComposer}><textarea aria-label="Orchestrator'a mesaj" placeholder={orchestratorState === "ready" ? "Bu ekran bağlamında neyi analiz edelim veya hangi taslak kuralı hazırlayalım?" : "Kalıcı konuşma kaynağı bağlandığında mesaj gönderebilirsiniz."} value={orchestratorInput} disabled={orchestratorState !== "ready" || orchestratorSending} onChange={(event) => setOrchestratorInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendOrchestratorMessage(); } }} /><button disabled={orchestratorState !== "ready" || orchestratorSending || !orchestratorInput.trim()} onClick={() => void sendOrchestratorMessage()}>{orchestratorSending ? "Yanıt bekleniyor…" : "Gönder"}</button></div>
          <footer>Codex CLI · salt-okunur çalışma alanı · yalnız nihai yanıt kayda yazılır · onay, uygulama veya Meta değişikliği yok</footer>
        </section>
        {orchestratorState === "ready" ? <aside className={styles.agentConfiguration}>
          <section className={`${styles.panel} ${styles.agentSessionHub}`}><header className={styles.panelHeader}><div><span className={styles.kicker}>LOCAL SESSION HUB</span><h2>Dashboard ↔ CLI handoff</h2></div><StatusPill tone={agentSessions.length ? "good" : "neutral"}>{agentSessionsLoading ? "Kontrol" : `${agentSessions.length} aktif`}</StatusPill></header>
            {agentSessionError ? <p role="alert">{agentSessionError}</p> : null}
            {!agentSessionsLoading && !agentSessions.length ? <div><strong>Aktif CLI session bulunamadı</strong><small>Codex veya Claude tarafı bearer session ile register olduğunda burada görünür.</small></div> : null}
            {agentSessions.length ? <label htmlFor="agent-session-target"><span>Hedef session</span><select id="agent-session-target" value={selectedAgentSessionRef} onChange={(event) => setSelectedAgentSessionRef(event.target.value)}><option value="" disabled>{agentSessions.length > 1 ? "Session seçin" : "Session"}</option>{agentSessions.map((session) => <option key={session.sessionRef} value={session.sessionRef}>{session.clientRef} · {session.transport} · {formatMetaTime(session.lastSeenAt)}</option>)}</select></label> : null}
            <dl><div><dt>Seçili bağlam</dt><dd>{agentEntityLabel}</dd></div><div><dt>Handoff zaman aralığı</dt><dd>Son 7 gün · sabit</dd></div><div><dt>Yetki</dt><dd>Yalnız koordinasyon</dd></div></dl>
            <button className={styles.primaryButton} disabled={!selectedAgentSessionRef || agentHandoffLoading} onClick={() => void createAgentHandoff(agentEntityRef)}>{agentHandoffLoading ? "Hazırlanıyor…" : "Kısa ömürlü handoff hazırla"}</button>
            {agentHandoff ? <div className={styles.handoffReceipt}><span>Handoff hazır</span><code>{agentHandoff.handoffRef}</code><small>{formatMetaTime(agentHandoff.expiresAt)} tarihinde sona erer · tek kullanımlık</small></div> : null}
          </section>
        </aside> : null}
      </div>;
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
        <p>{metaReadMirrorError ?? "Bu alan yalnız doğrulanmış kanonik hiyerarşiyi gösterir; Graph keşif envanteri bunun yerine kullanılamaz."}</p>
        {metaReadMirrorState === "session_required" ? <LocalSessionConnector title="Kanonik Meta aynasını bağlayın" onVerify={verifyAndRefreshLocalSession} /> : null}
      </div> : <>
        <div className={styles.canonicalMirrorSummary}>
          <div><span>Kaynak durumu</span><strong>{sourceLabel}</strong><small>Gözlem: {formatMetaTime(projection.observedAt)}</small></div>
          <div><span>Freshness</span><strong>{projection.freshnessAgeMinutes === null ? "Bilinmiyor" : `${projection.freshnessAgeMinutes} dk`}</strong><small>Eşik: {projection.freshnessThresholdMinutes} dk</small></div>
          <div><span>Hiyerarşi</span><strong>{projection.summary.campaigns} / {projection.summary.adSets} / {projection.summary.ads}</strong><small>kampanya / ad set / reklam</small></div>
          <div><span>İçerik</span><strong>{projection.summary.creatives} / {projection.summary.posts}</strong><small>creative / post</small></div>
          <div><span>Günlük insight</span><strong>{account?.freshness.insightStatus === "completed" ? account.freshness.insightCanonicalRowCount === 0 ? "Doğrulanmış boş" : `${account.freshness.insightCanonicalRowCount} kayıt` : "Hazır değil"}</strong><small>{account?.freshness.insightStatus === "completed" ? "Meta teslimatı / canonical kayıt" : "Performans önerileri beklemede"}</small></div>
        </div>
        {projection.reasonCodes.length ? <div className={styles.canonicalMirrorReasons}><strong>Kaynak notları</strong><p>{projection.reasonCodes.join(" · ")}</p></div> : null}
        {projection.sourceState === "empty" ? <div className={styles.canonicalMirrorNotice}><strong>Kanonik hesap kaydı var; kampanya hiyerarşisi boş.</strong><p>Kaynak başarıyla okundu; bu hesaplarda gösterilebilir kampanya bulunamadı.</p></div>
          : projection.sourceState === "unavailable" ? <div className={styles.canonicalMirrorNotice}><strong>Bağlantı veya hesap kaynağı kullanılamıyor.</strong><p>Kanonik kaynak doğrulanmadan eski varlıklar gösterilmez.</p></div>
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
            </> : <div className={styles.canonicalMirrorNotice}><strong>Seçilebilir kanonik reklam hesabı yok.</strong><p>Kaynakta görüntülenebilir bir reklam hesabı bulunamadı.</p></div>}
      </>}
      <footer className={styles.canonicalAuthority}>Yetki: none · publish kapalı · approve kapalı · execute kapalı · Meta write kapalı</footer>
    </section>;
  }

  function renderMetaConnection() {
    const preflight = metaBootstrapPreflight;
    const preflightNotice = preflight ? <section className={`${styles.panel} ${styles.metaEmpty}`} aria-label="Meta bootstrap güvenlik ön kontrolü">
      <StatusPill tone={preflight.readiness === "configured" ? "good" : "warning"}>{preflight.readiness === "configured" ? "Salt-okunur doctor hazır" : "Bootstrap kapalı"}</StatusPill>
      <h2>{preflight.message}</h2><p>{preflight.nextStep}</p>
      <small>Doctor: çalıştırılmadı · Bootstrap: çalıştırılmadı · Network: 0 · Meta write: 0</small>
    </section> : null;
    if (!metaInventory) {
      return <>
        <section className={styles.pageHero}><div><span className={styles.kicker}>META READ MIRROR</span><h1>Meta erişim envanteri hazırlanıyor.</h1><p>Token yalnız sunucu tarafında okunur; dashboard ve agent bağlamına hiçbir zaman eklenmez.</p></div><button className={styles.primaryButton} disabled={metaLoading} onClick={() => void refreshMetaInventory(true)}>{metaLoading ? "Kontrol ediliyor…" : "Yeniden dene"}</button></section>
        {renderCanonicalMetaMirror()}
        {preflightNotice}
        {metaReadMirrorState === "session_required" ? null : <><MetaTrustReadinessPanel />
          <section className={`${styles.panel} ${styles.metaEmpty}`}><StatusPill tone={metaError ? "danger" : "neutral"}>{metaError ? "Bağlantı hatası" : "Salt okunur keşif"}</StatusPill><h2>{metaError ?? "Meta Graph yanıtı bekleniyor"}</h2><p>Bu alan yalnız Graph erişim envanteridir; kanonik DB aynasının yerine geçmez. Hiçbir kampanya, bütçe, reklam seti veya reklam değiştirilmiyor.</p></section>
          <section className={styles.panel} aria-label="Portföy kapsamı"><header className={styles.panelHeader}><div><span className={styles.kicker}>PORTFÖY KAPSAMI</span><h2>Hesap grupları ve salt-okur erişim</h2></div><StatusPill tone={portfolioCapabilityState === "session_required" ? "warning" : "neutral"}>{portfolioCapabilityState === "session_required" ? "Oturum gerekli" : "Kaynak yok"}</StatusPill></header><p className={styles.metaAccountEmpty}>{portfolioCapabilityState === "session_required" ? "Gerçek hesap gruplarını görmek için yukarıdaki yerel oturum bağlantısını kullanın." : "Portföy kapsamı kaynağı henüz güvenli biçimde bağlanmadı."}</p><p className={styles.safetyNote}>Bu görünümden bütçe, yayın, onay veya Meta yazma yapılamaz.</p></section></>}
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

      {preflightNotice}

      {renderCanonicalMetaMirror()}
      <MetaTrustReadinessPanel />

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
        <header className={styles.panelHeader}><div><span className={styles.kicker}>YETKİ VE HAZIRLIK</span><h2>Yetki, doğrulama ve etkinlik</h2></div><StatusPill tone="good">Yalnız okuma</StatusPill></header>
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
        </article>) : <p className={styles.metaAccountEmpty}>Bağlı portföyde seçilebilir reklam hesabı yok.</p>}</div> : <p className={styles.metaAccountEmpty}>{portfolioCapabilityState === "session_required" ? "Gerçek hesap gruplarını görmek için kanonik ayna alanındaki yerel oturum bağlantısını kullanın." : "Portföy kapsamı kaynağı henüz güvenli biçimde bağlanmadı."}</p>}
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
          <div className={styles.metaAccountList}>{inventory.accounts.map((account) => <details key={account.id}><summary><div><strong>{account.name}</strong><small>{account.currency ?? "—"} · {account.timezone ?? "—"}</small></div><StatusPill tone={account.status === "ACTIVE" ? "good" : "warning"}>{account.status}</StatusPill><div><strong>{compactNumber(account.campaignCount)}</strong><small>kampanya</small></div></summary><div className={styles.metaAccountDetail}><dl><div><dt>Campaign</dt><dd>{compactNumber(account.campaignCount)}</dd></div><div><dt>Ad set</dt><dd>{compactNumber(account.adSetCount)}</dd></div><div><dt>Ad</dt><dd>{compactNumber(account.adCount)}</dd></div><div><dt>Insights</dt><dd>{account.insightAccess.verified ? `${account.insightAccess.dateStart ?? "7g"} → ${account.insightAccess.dateStop ?? "bugün"}` : "Doğrulanamadı"}</dd></div></dl>{account.campaignExamples.length ? <div><span className={styles.kicker}>OKUNAN KAMPANYALAR</span>{account.campaignExamples.map((campaign) => <p key={campaign.id}><strong>{campaign.name}</strong><small>{campaign.status} · {campaign.objective ?? "objective yok"}</small></p>)}</div> : <p>Bu hesapta kampanya bulunamadı.</p>}{account.adCopyExamples.some((ad) => ad.body || ad.title || ad.instagramPermalink) ? <div><span className={styles.kicker}>OKUNABİLEN REKLAM METİNLERİ</span>{account.adCopyExamples.filter((ad) => ad.body || ad.title || ad.instagramPermalink).slice(0, 2).map((ad) => <blockquote key={ad.id}><strong>{ad.title ?? ad.name}</strong><p>{ad.body ?? "Metin yok; mevcut gönderi bağlantısı okunabiliyor."}</p>{ad.instagramPermalink ? <a href={ad.instagramPermalink} target="_blank" rel="noreferrer">Instagram gönderisini aç ↗</a> : null}</blockquote>)}</div> : null}</div></details>)}</div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span className={styles.kicker}>PAGES & INSTAGRAM</span><h2>Sayfa bağlantıları</h2></div><StatusPill tone="info">{inventory.summary.linkedInstagramAccounts} IG bağlı</StatusPill></header>
          <div className={styles.metaPageList}>{inventory.pages.map((page) => <article key={page.id}><div><strong>{page.name}</strong><small>{page.category ?? "Kategori yok"}</small></div><div><span>{page.followers === null ? "—" : compactNumber(page.followers)}</span><small>takipçi</small></div>{page.instagram ? <div className={styles.instagramIdentity}><span>◎</span><p><strong>@{page.instagram.username ?? "kullanıcı-adı-yok"}</strong><small>{page.instagram.name ?? "Bağlı profesyonel hesap"}</small></p></div> : <StatusPill tone="neutral">IG bağı yok</StatusPill>}</article>)}</div>
        </section>
      </div>

      {inventory.errors.length || metaError ? <section className={styles.metaErrors}><strong>Kısmi erişim notları</strong>{metaError ? <p>{metaError}</p> : null}{inventory.errors.map((error) => <p key={`${error.resource}-${error.message}`}><span>{error.resource}</span>{error.message}</p>)}</section> : null}

      <section className={styles.scopeDisclosure}><div><span>Token kapsamları</span><p>{inventory.connection.grantedScopes.join(" · ")}</p></div><strong>Scope ≠ execute yetkisi</strong></section>
    </>;
  }

  function renderBudgets() {
    return <>
      <SectionNav<BudgetArea> label="Bütçe çalışma alanı" active={budgetArea} onChange={(area) => commitDashboardLocation({ ...dashboardLocation, budgetArea: area })} items={[
        { id: "proposals", label: "Öneriler", description: "Önce/sonra ve sınırlar" },
        { id: "pools", label: "Bütçe havuzları", description: "Hiyerarşi ve tavanlar" },
      ]} />
      {budgetArea === "proposals" ? <BudgetLabPanel /> : <>
        <section className={styles.pageHero}><div><span className={styles.kicker}>BÜTÇE HAVUZLARI · İLERİ DÜZEY</span><h1>Bütçe sınırlarını önerilerle aynı çalışma alanında yönetin.</h1><p>Havuz hiyerarşisi bütçe kararının girdisidir; kural sayfasında ayrı bir teknik modül değildir. Kaynak bağlı değilse limit veya pazar dağılımı uydurulmaz.</p></div><StatusPill>Yalnız taslak</StatusPill></section>
        <BudgetPoolHierarchyPanel />
      </>}
    </>;
  }

  function renderRules() {
    return <>
      <SectionNav<RulesArea> label="Kurallar ve yetkiler" active={rulesArea} onChange={(area) => commitDashboardLocation({ ...dashboardLocation, rulesArea: area })} items={[
        { id: "guidance", label: "Rehberler & kurallar", description: "Talimat → normalize kural" },
        { id: "policies", label: "Bağlayıcı politikalar", description: "Yaşam döngüsü ve etki" },
        { id: "authority", label: "Yetki & onay", description: "Yetki sınırları ve onay politikaları" },
        { id: "learning", label: "Öğrenim", description: "İnsan onaylı yaklaşımlar" },
      ]} />
      {rulesArea === "guidance" ? <><GuidanceStudioPanel onSessionRequiredChange={setRulesSessionRequired} />
        {rulesSessionRequired === false ? <><NormalizationWorkbenchPanel initialCampaignIntentTemplate={draftPolicyTemplate} /><SliceRuleWorkspacePanel /></> : null}</>
        : rulesArea === "policies" ? <InstructionPolicyStudioPanel />
          : rulesArea === "authority" ? <AutonomyStudioPanel />
            : <PracticeLabPanel />}
    </>;
  }

  function renderSettings() {
    return <>
      <SectionNav<SettingsArea> label="Yönetim ayarları" active={settingsArea} onChange={(area) => commitDashboardLocation({ ...dashboardLocation, settingsArea: area })} items={[
        { id: "meta", label: "Meta bağlantısı", description: "Hazırlık ve kaynak tanısı" },
        { id: "categories", label: "Kategori registry", description: "Tanım, profil ve atama" },
        { id: "promotion-templates", label: "Öne çıkarma şablonları", description: "Şablon yaşam döngüsü" },
      ]} />
      {settingsArea === "meta" ? renderMetaConnection() : settingsArea === "categories" ? <CategoryInventoryPanel
        assignmentHandoff={categoryAssignmentHandoff} onAssignmentHandoffConsumed={() => setCategoryAssignmentHandoff(null)} /> : <>
        <section className={styles.pageHero}><div><span className={styles.kicker}>ÖNE ÇIKARMA ŞABLONLARI · İLERİ DÜZEY</span><h1>Gönderi akışında kullanılan şablonları ayrı bir yönetim bağlamında hazırlayın.</h1><p>Şablon ve değiştirilemez hedef kitle ön ayarı yaşam döngüsü burada yönetilir; gerçek gönderi ön kontrolü Kampanyalar içindeki ilgili akışta kalır.</p></div><StatusPill>İnsan onaylı</StatusPill></section>
        <PromotionTemplateAuthoringPanel />
      </>}
    </>;
  }

  function renderCampaignContextRecovery() {
    const sessionRequired = campaignContextResolution === "session_required";
    const loading = campaignContextResolution === "loading";
    return <section className={`${styles.panel} ${styles.decisionRoomState}`} role={loading ? "status" : "alert"} aria-label="Seçili kampanya bağlamı doğrulama">
      <strong>SEÇİLİ KAMPANYA BAĞLAMI</strong><h2>{loading ? "Kampanya bağlamı doğrulanıyor" : sessionRequired ? "Kampanya bağlamı için yerel oturum gerekli" : "Kampanya bağlamı doğrulanamadı"}</h2>
      <p>{loading ? "Analiz ve onay kayıtları, frozen bağlam doğrulanana kadar açılmaz." : sessionRequired ? "Bu linkteki kampanya için analiz ve onay kayıtlarını açmak üzere yerel dashboard oturumunu bağlayın." : "Kampanya kaynağı veya frozen context güvenli biçimde okunamadı; genel çalışma alanı kayıtları gösterilmedi."}</p>
      {sessionRequired ? <LocalSessionConnector title="Kampanya bağlamını bağlayın" onVerify={refreshRequestedCampaignContext} /> : loading ? null : <button onClick={() => void refreshRequestedCampaignContext()}>Tekrar kontrol et</button>}
      {!loading ? <button onClick={clearCampaignDecisionContext}>Tüm çalışma alanına dön</button> : null}
    </section>;
  }

  const campaignContextReady = requestedCampaignRef === null || (campaignContextResolution === "ready"
    && campaignDecisionContext?.sourceCampaignRef === requestedCampaignRef);
  const content = activeView === "today" ? renderToday()
    : activeView === "campaigns" ? renderCampaigns()
      : activeView === "decision-room" ? !campaignContextReady ? renderCampaignContextRecovery() : <DecisionRoomPanel campaignContext={campaignDecisionContext ? { label: campaignDecisionContext.label, campaignRef: campaignDecisionContext.decisionRoomCampaignRef } : null} campaignContextPending={!campaignContextReady} onClearCampaignContext={clearCampaignDecisionContext} />
        : activeView === "budgets" ? renderBudgets()
          : activeView === "approvals" ? !campaignContextReady ? renderCampaignContextRecovery() : <ApprovalQueuePanel campaignRef={approvalQueueCampaignRef} campaignLabel={campaignDecisionContext?.label ?? null} campaignContextPending={!campaignContextReady} onClearCampaignContext={campaignDecisionContext ? clearCampaignDecisionContext : undefined} />
            : activeView === "rules" ? renderRules() : renderSettings();
  const firstMirrorAccount = metaReadMirror?.connections.flatMap((connection) => connection.accounts)[0] ?? null;
  const workspaceName = firstMirrorAccount?.name ?? metaReadMirror?.connections[0]?.name ?? "Çalışma alanı";
  const workspaceSource = metaReadMirror
    ? `${metaReadMirror.summary.accounts} hesap · ${metaReadMirror.sourceState}`
    : metaReadMirrorState === "loading" ? "Kanonik kaynak kontrol ediliyor"
      : metaReadMirrorState === "session_required" ? "Yerel oturum gerekli" : "Kanonik kaynak kullanılamıyor";
  const sourceFooter = activeView === "today" ? "Kanonik Meta özeti + teslimat sağlığı alarm kayıtları"
    : activeView === "campaigns" ? campaignArea === "portfolio" ? "Kanonik Meta kampanya → kreatif hiyerarşisi"
      : campaignArea === "classification" ? "Kanonik sınıflandırma inceleme kuyruğu"
        : campaignArea === "promotion" ? "Mevcut gönderi K4 ön kontrolü · sunucu kataloğu"
          : "Değiştirilemez operasyon ve zamansal öneri geçmişi"
      : activeView === "decision-room" ? "Analiz ve karar kayıtları · dondurulmuş kanıt"
        : activeView === "budgets" ? budgetArea === "proposals" ? "Bütçe önerileri kayıtları" : "Değiştirilemez bütçe havuzu hiyerarşisi"
          : activeView === "approvals" ? "Alanlar arası onay kuyruğu kayıtları"
            : activeView === "rules" ? rulesArea === "guidance" ? "Rehber → normalizasyon → dilim kuralı"
              : rulesArea === "policies" ? "Bağlayıcı politika kayıtları ve etki analizi"
                : rulesArea === "authority" ? "Yetki revizyonları ve onay/güvenlik politikaları"
                  : "İnsan onaylı öğrenim yaşam döngüsü"
              : settingsArea === "meta" ? "Meta bağlantısı, hazırlık ve salt-okunur tanı"
                : settingsArea === "categories" ? "Kategori kayıtları ve korumalı düzenleme"
                  : "Öne çıkarma şablonları ve yaşam döngüsü";
  const authorityFooter = activeView === "approvals"
    ? "Karar kaydı var · yetki verme, uygulama veya Meta değişikliği yok"
    : "Kaynağın izin verdiği kadar yetki · kapsam dışı uygulama veya Meta değişikliği yok";

  return <div className={styles.appShell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><span>RZ</span><div><strong>ReklamZeka</strong><small>Operating System</small></div></div>
      <nav aria-label="Ana navigasyon">{navGroups.map((group) => <div key={group.label}><span>{group.label}</span>{group.items.map((item) => <button type="button" key={item.id} data-active={activeView === item.id} aria-current={activeView === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} /><strong>{item.label}</strong>{item.badge ? <i data-live={item.badge === "●"}>{item.badge}</i> : null}</button>)}</div>)}</nav>
      <div className={styles.sidebarFooter}><span className={metaReadMirror?.sourceState === "ready" ? styles.liveDot : undefined} /><div><strong>Meta veri aynası</strong><small>{workspaceSource}</small></div><button aria-label="Bağlantı ayarları" onClick={() => openSettings("meta")}>•••</button></div>
    </aside>
    <section className={styles.workspace}>
      <header className={styles.topbar}><div className={styles.mobileBrand}><span>RZ</span><strong>ReklamZeka</strong></div><button type="button" className={styles.workspacePicker} aria-label={`${workspaceName} kaynak ayarlarını aç`} onClick={() => openSettings("meta")}><span className={styles.avatar}>RZ</span><span><strong>{workspaceName}</strong><small>{workspaceSource}</small></span><i aria-hidden="true">Ayarlar</i></button><div className={styles.topActions}><button type="button" className={styles.codexTransferButton} disabled={agentHandoffLoading} onClick={() => void transferCurrentContextToCodex()}>{agentHandoffLoading ? "Hazırlanıyor…" : "Codex'e aktar"}</button><button type="button" ref={assistantTriggerRef} className={styles.autonomyButton} aria-expanded={assistantOpen} aria-controls="dashboard-assistant" onClick={() => { setAgentSourceView(activeView); commitDashboardLocation({ ...dashboardLocation, assistantOpen: true }); }}><span className={styles.liveDot} /> Asistan</button></div></header>
      <div className={styles.mobileNav}>{navGroups.flatMap((group) => group.items).map((item) => <button type="button" key={item.id} data-active={activeView === item.id} aria-current={activeView === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</div>
      <main ref={contentRef} className={styles.content} tabIndex={-1} aria-label={activeTitle}>{content}</main>
      <footer className={styles.sourceFooter}><span>{sourceFooter}</span><span>{authorityFooter}</span></footer>
    </section>
    {assistantOpen ? <div className={styles.assistantBackdrop}>
      <button type="button" tabIndex={-1} className={styles.assistantDismiss} aria-label="Asistanı kapat" onClick={closeAssistant} />
      <aside ref={assistantDrawerRef} id="dashboard-assistant" className={styles.assistantDrawer} role="dialog" aria-modal="true" aria-labelledby="dashboard-assistant-title">
        <header className={styles.assistantDrawerHeader}><div><span className={styles.kicker}>REKLAMZEKA ORCHESTRATOR</span><h2 id="dashboard-assistant-title">Bağlamı kaybetmeden çalışın.</h2><p>Kalıcı konuşma ve kısa ömürlü CLI handoff; policy, approval, action veya Meta write yetkisi taşımaz.</p></div><div><StatusPill tone={agentSessions.length ? "good" : agentSessionError ? "warning" : "neutral"}>{agentSessionsLoading ? "Session kontrolü" : agentSessions.length ? `${agentSessions.length} session` : "Session yok"}</StatusPill><button ref={assistantCloseRef} type="button" aria-label="Asistanı kapat" onClick={closeAssistant}>×</button></div></header>
        <div className={styles.assistantDrawerBody}>{renderAgent()}</div>
      </aside>
    </div> : null}
    {toast ? <div className={styles.toast} role="status"><span>✓</span><p>{toast}</p><button onClick={() => setToast(null)} aria-label="Bildirimi kapat">×</button></div> : null}
  </div>;
}
