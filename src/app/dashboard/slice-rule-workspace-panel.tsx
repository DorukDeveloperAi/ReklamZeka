"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { BudgetLabDraftResult } from "@/application/budget-lab-draft-service";
import type { UserBudgetScenarioCommand } from "@/application/slice-rule-budget-impact-context-candidate-service";
import type { SliceRule } from "@/domain/campaigns/slice-operating-rule";
import styles from "./slice-rule-workspace-panel.module.css";

type Market = "domestic" | "international";
type Platform = "facebook" | "instagram" | "mixed";
type Scope = Readonly<{
  market: Market;
  serviceRef: string;
  campaignFamilyRef: string;
  countryOrRegion?: string;
  audienceStrategy?: string;
  platform?: Platform;
  conversionRoute?: "lead_form" | "whatsapp" | "landing_page";
}>;
type ClosedAuthority = Readonly<{
  canPublish: false;
  canApprove: false;
  canExecute: false;
  canWriteMeta: false;
  canEnableAutomation: false;
}>;
export type SliceRuleWorkspaceItem = Readonly<{
  schemaVersion: "public-slice-rule-workspace-draft/1.0.0";
  seriesRef: string;
  revision: number;
  draftRef: string;
  draftHash: string;
  status: "draft";
  operatingMode: "recommendation_only";
  scope: Scope;
  operatingRule: Readonly<{ rule: SliceRule; priority: number; verification: Readonly<{
    metric: "qualified_leads" | "cost_per_qualified_lead" | "engagement_rate" | "delivery_health";
    reviewCadence: "daily" | "weekly" | "monthly";
    rollbackWhen: string;
  }>; authority: ClosedAuthority }>;
  createdAt: string;
  authority: ClosedAuthority;
}>;
export type SliceRuleWorkspaceSnapshot = Readonly<{
  contractVersion: "slice-rule-workspace-http/1.0.0";
  items: readonly SliceRuleWorkspaceItem[];
  authority: Readonly<{ canRead: true; canSaveDraft: boolean } & ClosedAuthority>;
}>;

type State = Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>
  | Readonly<{ status: "ready"; snapshot: SliceRuleWorkspaceSnapshot }>;

type ImpactResult = Readonly<{
  contractVersion: "slice-rule-budget-impact/1.0.0";
  mode: "read_only_impact_preview";
  binding: Readonly<{ seriesRef: string; draftRef: string; draftHash: string; scope: Scope;
    ruleKind: SliceRule["kind"]; evidenceRefs: readonly string[] }>;
  budgetPreview: BudgetLabDraftResult;
  persistence: "none";
  writeOperations: 0;
  authority: Readonly<{ recommendationOnly: true; canPublish: false; canApprove: false;
    canCreateProposal: false; canExecute: false; canWriteMeta: false }>;
}>;
type SavedImpactResult = Readonly<{
  contractVersion: "slice-rule-budget-impact/1.0.0";
  mode: "saved_advisory_draft";
  binding: ImpactResult["binding"];
  budgetProposal: BudgetLabDraftResult["proposal"];
  persistence: "inserted" | "unchanged";
  provenance: "inserted" | "unchanged";
  authority: ImpactResult["authority"];
}>;
type ImpactState = Readonly<{ status: "idle" | "loading" }>
  | Readonly<{ status: "ready"; result: ImpactResult }>
  | Readonly<{ status: "saved"; result: SavedImpactResult }>
  | Readonly<{ status: "unsupported" | "unavailable" | "stale" | "scope" | "error"; message: string }>;
type ApprovalQueueSelection = Readonly<{ selectionRef: string; selectedAt: string }>;
type ActionPreparationFlag = Readonly<{ visible: true; enabled: false; reason: "server_disabled" }>;
type DecisionTraceItem = Readonly<{
  selectionRef: string;
  selectedAt: string;
  actionUnit: Readonly<{ presence: boolean; status: "not_materialized" | "awaiting_approval" | "approved" | "rejected" | "changes_requested" }>;
  decisionHistory: readonly Readonly<{ decision: "proposed" | "approved" | "rejected" | "changes_requested"; occurredAt: string; reasonCode: string | null }>[];
  execution: Readonly<{ safetyState: "server_disabled"; closure: "not_admitted" | "admission_closed" }>;
}>;
type ApprovalQueueState = Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; selections: readonly ApprovalQueueSelection[]; decisionTrace: readonly DecisionTraceItem[]; actionPreparation: ActionPreparationFlag }>
  | Readonly<{ status: "queued"; selectionRef: string; actionUnitRef: string; persistence: "inserted" | "unchanged" }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>;
type SelectionCandidate = Readonly<{ candidateRef: string; scenarioLabel: string; beforeAmountMinor: number; afterAmountMinor: number; currency: string;
  status: "selectable" | "blocked"; blockReason: "delivery_hold" | "market_boundary" | "scope_unavailable" | "stale_source" | "already_selected" | null }>;
type SelectionState = Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; candidates: readonly SelectionCandidate[] }>
  | Readonly<{ status: "selected"; selectionRef: string; persistence: "inserted" | "unchanged" }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>;
type TemporalCandidate = Readonly<{ candidateRef: string; ruleSeriesRef: string; reviewCadence: "daily" | "weekly" | "monthly"; windowRef: string; capturedAt: string }>;
type TemporalState = Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; candidates: readonly TemporalCandidate[]; result: string | null }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>;
type ScopeCandidate = Readonly<{ campaignRef: string; scope: Scope; requiresFrozenContext: true; budgetImpactReady: false }>;
type ScopeCandidateState = Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; candidates: readonly ScopeCandidate[] }>
  | Readonly<{ status: "unavailable" }>;
type OperationalReadiness = Readonly<{ candidateRef: string; scope: Scope; frozenContext: "ready" | "missing" | "not_eligible"; budgetImpact: "eligible" | "blocked" }>;
type OperationalReadinessState = Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; items: readonly OperationalReadiness[] }>
  | Readonly<{ status: "unavailable" }>;
type PoolBinding = Readonly<{ draftHash: string; hierarchyHash: string; poolRef: string; market: Market; boundAt: string; authority: ClosedAuthority }>;
type PoolNode = Readonly<{ poolRef: string; parentPoolRef: string | null; layer: "market" | "service_family" | "constraint" | "named"; market: Market; currency: string; hardCapDecimal: string; effectiveFrom: string; effectiveTo: string }>;
type PoolBindingSnapshot = Readonly<{ contractVersion: "slice-rule-budget-pool-binding-http/1.0.0"; bindings: readonly PoolBinding[]; hierarchy: Readonly<{ hierarchyHash: string; nodes: readonly PoolNode[]; authority: ClosedAuthority }> | null; authority: Readonly<{ canRead: true; canBind: boolean } & ClosedAuthority> }>;
type PoolBindingState = Readonly<{ status: "loading" }> | Readonly<{ status: "ready"; snapshot: PoolBindingSnapshot; selectedPoolRef: string }> | Readonly<{ status: "saving"; snapshot: PoolBindingSnapshot; selectedPoolRef: string }> | Readonly<{ status: "unavailable" | "error"; message: string }>;

type Form = Readonly<{
  seriesRef: string;
  market: Market;
  serviceRef: string;
  campaignFamilyRef: string;
  countryOrRegion: string;
  audienceStrategy: string;
  platform: "" | Platform;
  conversionRoute: "" | "lead_form" | "whatsapp" | "landing_page";
  ruleKind: "period_budget_cap" | "budget_distribution" | "winner_continuation_rotation" | "delivery_guardrail";
  period: "daily" | "weekly" | "monthly";
  currency: string;
  maximumDecimal: string;
  distributionDimension: "countryOrRegion" | "campaignCategory" | "conversionRoute";
  distributionAllocations: string;
  continuationPercent: string;
  evaluationWindowDays: string;
  condition: "delivery_interrupted" | "capacity_constrained" | "payment_or_account_review";
  priority: string;
  metric: "qualified_leads" | "cost_per_qualified_lead" | "engagement_rate" | "delivery_health";
  reviewCadence: "daily" | "weekly" | "monthly";
  rollbackWhen: string;
}>;

const CLOSED: ClosedAuthority = Object.freeze({ canPublish: false, canApprove: false, canExecute: false,
  canWriteMeta: false, canEnableAutomation: false });
const EMPTY_FORM: Form = Object.freeze({ seriesRef: "", market: "international", serviceRef: "",
  campaignFamilyRef: "", countryOrRegion: "", audienceStrategy: "", platform: "", conversionRoute: "", ruleKind: "period_budget_cap",
  period: "monthly", currency: "TRY", maximumDecimal: "", distributionDimension: "countryOrRegion",
  distributionAllocations: "", continuationPercent: "80", evaluationWindowDays: "7",
  condition: "delivery_interrupted", priority: "50", metric: "cost_per_qualified_lead", reviewCadence: "weekly",
  rollbackWhen: "Yeni sonuç kanıtı, teslimat kesintisi veya kapsam değişimi insan incelemesini gerektirirse." });
type BudgetImpactContextCandidate = Readonly<{ candidateRef: string; campaignRef: string; capturedAt: string; currency: string; currentBudgetDecimal: string; scope: Scope }>;
type BudgetImpactContextCandidateSnapshot = Readonly<{ contractVersion: "slice-rule-budget-impact-context-candidates/1.0.0"; seriesRef: string; candidates: readonly BudgetImpactContextCandidate[]; authority: Readonly<{ canPreview: false; canSave: false; canApprove: false; canExecute: false; canWriteMeta: false }> }>;
type TypedScenarioForm = Readonly<{ label: string; mode: "keep" | "conservative"; requestedBudgetDecimal: string; startDate: string; endDate: string }>;
const EMPTY_TYPED_SCENARIO: TypedScenarioForm = Object.freeze({ label: "keep", mode: "keep", requestedBudgetDecimal: "", startDate: "", endDate: "" });

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isClosed(value: unknown): value is ClosedAuthority {
  return object(value) && Object.keys(value).length === 5 && value.canPublish === false && value.canApprove === false
    && value.canExecute === false && value.canWriteMeta === false && value.canEnableAutomation === false;
}
function noOpenedAuthority(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(noOpenedAuthority);
  if (!object(value)) return true;
  for (const [key, child] of Object.entries(value)) {
    if (/^(canPublish|canApprove|canExecute|canWriteMeta|canEnableAutomation|approvalGranted|writeEnabled|policyPublished|actionAuthorized)$/i.test(key)
      && child !== false) return false;
    if (!noOpenedAuthority(child)) return false;
  }
  return true;
}
export function parseSliceRuleBudgetActionSelections(value: unknown): readonly ApprovalQueueSelection[] {
  if (!object(value) || value.contractVersion !== "slice-rule-budget-action-unit-http/1.0.0" || !Array.isArray(value.selections)
    || value.selections.length > 100 || !value.selections.every((entry) => object(entry)
      && typeof entry.selectionRef === "string" && /^selection_[a-f0-9]{64}$/.test(entry.selectionRef)
      && typeof entry.selectedAt === "string") || !object(value.authority) || value.authority.canApprove !== false
    || value.authority.canExecute !== false || value.authority.canWriteMeta !== false) throw new Error("Onay kuyruğu seçim sözleşmesi güvenli değil.");
  return value.selections as ApprovalQueueSelection[];
}
export function parseActionPreparationFlag(value: unknown): ActionPreparationFlag {
  if (!object(value) || !object(value.actionPreparation) || value.actionPreparation.visible !== true
    || value.actionPreparation.enabled !== false || value.actionPreparation.reason !== "server_disabled") {
    throw new Error("Action preparation flag sözleşmesi güvenli değil.");
  }
  return value.actionPreparation as ActionPreparationFlag;
}
export function parseSliceRuleDecisionTrace(value: unknown): readonly DecisionTraceItem[] {
  if (!object(value) || !object(value.decisionTrace) || value.decisionTrace.contractVersion !== "slice-rule-decision-trace/1.0.0"
    || !Array.isArray(value.decisionTrace.items) || value.decisionTrace.items.length > 100
    || !value.decisionTrace.items.every((item) => object(item) && Object.keys(item).length === 5
      && typeof item.selectionRef === "string" && /^selection_[a-f0-9]{64}$/.test(item.selectionRef)
      && typeof item.selectedAt === "string" && Number.isFinite(Date.parse(item.selectedAt))
      && object(item.actionUnit) && Object.keys(item.actionUnit).length === 2 && typeof item.actionUnit.presence === "boolean"
      && ["not_materialized", "awaiting_approval", "approved", "rejected", "changes_requested"].includes(String(item.actionUnit.status))
      && object(item.execution) && Object.keys(item.execution).length === 2 && item.execution.safetyState === "server_disabled"
      && ["not_admitted", "admission_closed"].includes(String(item.execution.closure))
      && Array.isArray(item.decisionHistory) && item.decisionHistory.length <= 2
      && item.decisionHistory.every((event) => object(event) && Object.keys(event).length === 3
        && ["proposed", "approved", "rejected", "changes_requested"].includes(String(event.decision))
        && typeof event.occurredAt === "string" && Number.isFinite(Date.parse(event.occurredAt))
        && (event.reasonCode === null || typeof event.reasonCode === "string" && /^[a-z][a-z0-9_.:-]{0,127}$/.test(event.reasonCode)))
      && (item.actionUnit.presence ? item.actionUnit.status !== "not_materialized" && item.decisionHistory.length >= 1
        && item.decisionHistory[0]?.decision === "proposed" && ["admission_closed", "not_admitted"].includes(String(item.execution.closure))
        : item.actionUnit.status === "not_materialized" && item.decisionHistory.length === 0 && item.execution.closure === "not_admitted"))) {
    throw new Error("Karar izi sözleşmesi güvenli değil.");
  }
  return value.decisionTrace.items as DecisionTraceItem[];
}
export function parseSliceRuleScenarioSelectionCandidates(value: unknown): readonly SelectionCandidate[] {
  if (!object(value) || value.contractVersion !== "slice-rule-scenario-selection/1.0.0" || !Array.isArray(value.candidates)
    || value.candidates.length > 100 || !object(value.authority) || Object.keys(value.authority).length !== 5 || value.authority.canSelect !== false || value.authority.canApprove !== false
    || value.authority.canExecute !== false || value.authority.canWriteMeta !== false || value.authority.canEnableAutomation !== false || !value.candidates.every((candidate) => object(candidate) && Object.keys(candidate).length === 7
      && typeof candidate.candidateRef === "string" && /^selection_candidate_[a-f0-9]{64}$/.test(candidate.candidateRef)
      && typeof candidate.scenarioLabel === "string" && Number.isSafeInteger(candidate.beforeAmountMinor) && Number.isSafeInteger(candidate.afterAmountMinor)
      && typeof candidate.currency === "string" && ["selectable", "blocked"].includes(String(candidate.status))
      && (candidate.blockReason === null || ["delivery_hold", "market_boundary", "scope_unavailable", "stale_source", "already_selected"].includes(String(candidate.blockReason))))) throw new Error("Senaryo seçimi sözleşmesi güvenli değil.");
  return value.candidates as SelectionCandidate[];
}
function isScope(value: unknown): value is Scope {
  if (!object(value) || !["domestic", "international"].includes(String(value.market))
    || typeof value.serviceRef !== "string" || !value.serviceRef || typeof value.campaignFamilyRef !== "string"
    || !value.campaignFamilyRef || value.countryOrRegion !== undefined && typeof value.countryOrRegion !== "string"
    || value.audienceStrategy !== undefined && typeof value.audienceStrategy !== "string"
    || value.platform !== undefined && !["facebook", "instagram", "mixed"].includes(String(value.platform))
    || value.conversionRoute !== undefined && !["lead_form", "whatsapp", "landing_page"].includes(String(value.conversionRoute))) return false;
  return Object.keys(value).every((key) => ["market", "serviceRef", "campaignFamilyRef", "countryOrRegion", "audienceStrategy", "platform", "conversionRoute"].includes(key));
}
function sameScope(left: Scope, right: Scope): boolean {
  const stable = (value: Scope) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}
function isItem(value: unknown): value is SliceRuleWorkspaceItem {
  return object(value) && value.schemaVersion === "public-slice-rule-workspace-draft/1.0.0"
    && typeof value.seriesRef === "string" && Number.isInteger(value.revision) && Number(value.revision) > 0
    && typeof value.draftRef === "string" && typeof value.draftHash === "string" && value.status === "draft"
    && value.operatingMode === "recommendation_only" && isScope(value.scope) && typeof value.createdAt === "string"
    && isClosed(value.authority) && object(value.operatingRule) && object(value.operatingRule.rule)
    && typeof value.operatingRule.priority === "number" && object(value.operatingRule.verification)
    && isClosed(value.operatingRule.authority) && noOpenedAuthority(value);
}

export function parseSliceRuleWorkspaceSnapshot(value: unknown): SliceRuleWorkspaceSnapshot {
  if (!object(value) || value.contractVersion !== "slice-rule-workspace-http/1.0.0" || !Array.isArray(value.items)
    || value.items.length > 100 || !value.items.every(isItem) || !object(value.authority)
    || Object.keys(value.authority).length !== 7 || value.authority.canRead !== true
    || typeof value.authority.canSaveDraft !== "boolean" || value.authority.canPublish !== false
    || value.authority.canApprove !== false || value.authority.canExecute !== false
    || value.authority.canWriteMeta !== false || value.authority.canEnableAutomation !== false
    || !noOpenedAuthority(value)) {
    throw new Error("Slice Rule Workspace güvenli sözleşmeyi döndürmedi.");
  }
  return value as unknown as SliceRuleWorkspaceSnapshot;
}
export function parseSliceRuleBudgetPoolBindingSnapshot(value: unknown): PoolBindingSnapshot {
  const node = (candidate: unknown): candidate is PoolNode => object(candidate) && Object.keys(candidate).length === 8
    && /^budget_pool_[a-z0-9][a-z0-9_.:-]{0,119}$/.test(String(candidate.poolRef))
    && (candidate.parentPoolRef === null || /^budget_pool_[a-z0-9][a-z0-9_.:-]{0,119}$/.test(String(candidate.parentPoolRef)))
    && ["market", "service_family", "constraint", "named"].includes(String(candidate.layer))
    && ["domestic", "international"].includes(String(candidate.market)) && /^[A-Z]{3}$/.test(String(candidate.currency))
    && typeof candidate.hardCapDecimal === "string" && typeof candidate.effectiveFrom === "string" && typeof candidate.effectiveTo === "string";
  const binding = (candidate: unknown): candidate is PoolBinding => object(candidate) && Object.keys(candidate).length === 6
    && /^[a-f0-9]{64}$/.test(String(candidate.draftHash)) && /^[a-f0-9]{64}$/.test(String(candidate.hierarchyHash))
    && /^budget_pool_[a-z0-9][a-z0-9_.:-]{0,119}$/.test(String(candidate.poolRef))
    && ["domestic", "international"].includes(String(candidate.market)) && typeof candidate.boundAt === "string" && isClosed(candidate.authority);
  if (!object(value) || value.contractVersion !== "slice-rule-budget-pool-binding-http/1.0.0" || !Array.isArray(value.bindings)
    || value.bindings.length > 100 || !value.bindings.every(binding) || !(value.hierarchy === null || object(value.hierarchy)
      && Object.keys(value.hierarchy).length === 3 && /^[a-f0-9]{64}$/.test(String(value.hierarchy.hierarchyHash))
      && Array.isArray(value.hierarchy.nodes) && value.hierarchy.nodes.length <= 200 && value.hierarchy.nodes.every(node)
      && isClosed(value.hierarchy.authority)) || !object(value.authority) || Object.keys(value.authority).length !== 7
    || value.authority.canRead !== true || typeof value.authority.canBind !== "boolean" || value.authority.canPublish !== false
    || value.authority.canApprove !== false || value.authority.canExecute !== false || value.authority.canWriteMeta !== false
    || value.authority.canEnableAutomation !== false || !noOpenedAuthority(value)) {
    throw new Error("Bütçe havuzu bağlama sözleşmesi güvenli değil.");
  }
  return value as unknown as PoolBindingSnapshot;
}

/** Candidate data may only prefill a new local form; it is never budget evidence. */
export function parseSliceScopeCandidates(value: unknown): readonly ScopeCandidate[] {
  if (!object(value) || value.version !== "slice-scope-candidates/1.0.0" || !Array.isArray(value.candidates)
    || value.candidates.length > 1000 || !value.candidates.every((candidate) => object(candidate)
      && typeof candidate.campaignRef === "string" && candidate.campaignRef.length > 0
      && isScope(candidate.scope) && candidate.requiresFrozenContext === true && candidate.budgetImpactReady === false)
    || !object(value.authority) || value.authority.canSave !== false || value.authority.canPublish !== false
    || value.authority.canApprove !== false || value.authority.canExecute !== false || value.authority.canWriteMeta !== false
    || !noOpenedAuthority(value)) throw new Error("Slice kapsam aday sözleşmesi güvenli değil.");
  return value.candidates as ScopeCandidate[];
}

/** A readiness response is explanatory only; it cannot supply a budget command or authority. */
export function parseSliceOperationalReadiness(value: unknown): readonly OperationalReadiness[] {
  if (!object(value) || value.version !== "slice-operational-readiness/1.0.0" || !Array.isArray(value.items)
    || value.items.length > 1000 || !value.items.every((item) => object(item) && typeof item.candidateRef === "string"
      && item.candidateRef.length > 0 && isScope(item.scope) && ["ready", "missing", "not_eligible"].includes(String(item.frozenContext))
      && ["eligible", "blocked"].includes(String(item.budgetImpact)))
    || !object(value.authority) || value.authority.canSave !== false || value.authority.canPublish !== false
    || value.authority.canApprove !== false || value.authority.canExecute !== false || value.authority.canWriteMeta !== false
    || !noOpenedAuthority(value)) throw new Error("Slice operasyon uygunluk sözleşmesi güvenli değil.");
  return value.items as OperationalReadiness[];
}

/** The panel accepts only opaque candidate references discovered by the server. */
export function parseTemporalEvaluationCandidates(value: unknown): readonly TemporalCandidate[] {
  if (!object(value) || value.contractVersion !== "temporal-recommendation-read/1.0.0" || !Array.isArray(value.candidates)
    || value.candidates.length > 50 || !value.candidates.every((candidate) => object(candidate)
      && /^temporal_candidate_[a-f0-9]{24}$/.test(String(candidate.candidateRef))
      && /^[a-z][a-z0-9_.:-]{0,127}$/.test(String(candidate.ruleSeriesRef))
      && ["daily", "weekly", "monthly"].includes(String(candidate.reviewCadence))
      && /^window_[a-f0-9]{24}$/.test(String(candidate.windowRef))
      && typeof candidate.capturedAt === "string" && Number.isFinite(Date.parse(candidate.capturedAt)))
    || !object(value.authority) || value.authority.canPublish !== false || value.authority.canApprove !== false
    || value.authority.canExecute !== false || value.authority.canWriteMeta !== false || !noOpenedAuthority(value)) {
    throw new Error("Zamansal değerlendirme aday sözleşmesi güvenli değil.");
  }
  return value.candidates as TemporalCandidate[];
}

/** Converts only decision-relevant user input. Mirror/pacing/allocation proof stays server-only. */
export function buildTypedBudgetImpactCommand(item: SliceRuleWorkspaceItem | undefined, form: TypedScenarioForm): UserBudgetScenarioCommand | null {
  if (!item || item.operatingRule.rule.kind === "delivery_guardrail" || !isClosed(item.authority)) return null;
  if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(form.label) || !["keep", "conservative"].includes(form.mode) || !/^(0|[1-9]\d{0,29})(?:\.\d{1,2})?$/.test(form.requestedBudgetDecimal) || !/^\d{4}-\d{2}-\d{2}$/.test(form.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(form.endDate) || form.startDate > form.endDate) return null;
  return Object.freeze({ ...form });
}
export function parseBudgetImpactContextCandidates(value: unknown): BudgetImpactContextCandidateSnapshot {
  if (!object(value) || value.contractVersion !== "slice-rule-budget-impact-context-candidates/1.0.0" || typeof value.seriesRef !== "string" || !Array.isArray(value.candidates)
    || !object(value.authority) || value.authority.canPreview !== false || value.authority.canSave !== false || value.authority.canApprove !== false || value.authority.canExecute !== false || value.authority.canWriteMeta !== false
    || !value.candidates.every((candidate) => object(candidate) && Object.keys(candidate).length === 6 && /^budget_impact_context_[a-f0-9]{24}$/.test(String(candidate.candidateRef)) && /^campaign_[a-f0-9]{16}$/.test(String(candidate.campaignRef)) && typeof candidate.capturedAt === "string" && /^[A-Z]{3}$/.test(String(candidate.currency)) && /^(0|[1-9]\d{0,29})(?:\.\d{1,2})?$/.test(String(candidate.currentBudgetDecimal)) && isScope(candidate.scope))) throw new Error("Bütçe etki bağlam aday sözleşmesi güvenli değil.");
  return value as unknown as BudgetImpactContextCandidateSnapshot;
}

export function parseSliceRuleBudgetImpactResult(value: unknown, expected: SliceRuleWorkspaceItem): ImpactResult {
  if (!object(value) || value.contractVersion !== "slice-rule-budget-impact/1.0.0"
    || value.mode !== "read_only_impact_preview" || value.persistence !== "none" || value.writeOperations !== 0
    || !object(value.binding) || value.binding.seriesRef !== expected.seriesRef
    || value.binding.draftRef !== expected.draftRef || value.binding.draftHash !== expected.draftHash
    || value.binding.ruleKind !== expected.operatingRule.rule.kind || !isScope(value.binding.scope)
    || !sameScope(value.binding.scope, expected.scope) || !Array.isArray(value.binding.evidenceRefs)
    || value.binding.evidenceRefs.length < 1 || !value.binding.evidenceRefs.every((ref) => typeof ref === "string" && ref.length > 0)
    || !object(value.authority) || value.authority.recommendationOnly !== true
    || value.authority.canPublish !== false || value.authority.canApprove !== false
    || value.authority.canCreateProposal !== false || value.authority.canExecute !== false
    || value.authority.canWriteMeta !== false || !object(value.budgetPreview)
    || value.budgetPreview.contractVersion !== "budget-lab-draft/1.0.0"
    || value.budgetPreview.mode !== "dry_run" || value.budgetPreview.persistence !== "none"
    || value.budgetPreview.auditAppended !== false || !object(value.budgetPreview.authority)
    || value.budgetPreview.authority.draftOnly !== true || value.budgetPreview.authority.canApprove !== false
    || value.budgetPreview.authority.canExecute !== false || value.budgetPreview.authority.canWriteMeta !== false
    || !object(value.budgetPreview.proposal) || value.budgetPreview.proposal.actionAuthority !== "none"
    || value.budgetPreview.proposal.writeOperations !== 0 || !Array.isArray(value.budgetPreview.proposal.alternatives)
    || !noOpenedAuthority(value)) {
    throw new Error("Bütçe etki önizlemesi güvenli sözleşmeyi döndürmedi.");
  }
  return value as unknown as ImpactResult;
}

/** The only writable outcome in this panel is an advisory BudgetProposal draft.
 * It is still explicitly not an approval, action, automation, or Meta write. */
export function parseSliceRuleBudgetImpactSavedResult(value: unknown, expected: SliceRuleWorkspaceItem): SavedImpactResult {
  if (!object(value) || value.contractVersion !== "slice-rule-budget-impact/1.0.0"
    || value.mode !== "saved_advisory_draft" || !object(value.binding)
    || value.binding.seriesRef !== expected.seriesRef || value.binding.draftRef !== expected.draftRef
    || value.binding.draftHash !== expected.draftHash || value.binding.ruleKind !== expected.operatingRule.rule.kind
    || !isScope(value.binding.scope) || !sameScope(value.binding.scope, expected.scope)
    || !Array.isArray(value.binding.evidenceRefs) || value.binding.evidenceRefs.length < 1
    || !value.binding.evidenceRefs.every((ref) => typeof ref === "string" && ref.length > 0)
    || !["inserted", "unchanged"].includes(String(value.persistence))
    || !["inserted", "unchanged"].includes(String(value.provenance))
    || !object(value.authority) || value.authority.recommendationOnly !== true
    || value.authority.canPublish !== false || value.authority.canApprove !== false
    || value.authority.canCreateProposal !== false || value.authority.canExecute !== false
    || value.authority.canWriteMeta !== false || !object(value.budgetProposal)
    || value.budgetProposal.actionAuthority !== "none" || value.budgetProposal.writeOperations !== 0
    || !noOpenedAuthority(value)) {
    throw new Error("Kaydedilen bütçe önerisi güvenli sözleşmeyi döndürmedi.");
  }
  return value as unknown as SavedImpactResult;
}

export function classifySliceRuleBudgetImpactFailure(code: string | undefined, status: number): Exclude<ImpactState, { status: "idle" | "loading" | "ready" }> {
  if (code === "stale_draft" || code === "draft_missing") return { status: "stale",
    message: "Seçili taslak artık güncel değil. Kayıt defterini yenileyip güncel revizyonu tekrar seçin." };
  if (code === "scope_evidence_not_ready") return { status: "scope",
    message: "Frozen kapsam kanıtı hazır, tekil ve güncel değil. Önizleme üretilmedi." };
  if (code === "market_boundary" || code === "scope_mismatch") return { status: "scope",
    message: "Kural kapsamı ile sunucunun frozen kampanya kanıtı eşleşmiyor. Pazar sınırı aşılmadı; önizleme üretilmedi." };
  if (status === 503 || code === "unsafe_budget_preview" || code === "unavailable") return { status: "unavailable",
    message: "Güvenli Budget Lab önizlemesi şu anda kullanılamıyor. Herhangi bir fallback veya kayıt işlemi yapılmadı." };
  return { status: "error", message: "Etki önizleme isteği reddedildi; hiçbir sonuç veya yetki varsayılmadı." };
}

/** Parses only explicit `slice key: percent` lines; no audience or geography is inferred. */
function parseDistributionAllocations(value: string): readonly Readonly<{ key: string; basisPoints: number }>[] | null {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2 || lines.length > 50) return null;
  const allocations = lines.map((line) => {
    const parts = line.split(":");
    if (parts.length !== 2) return null;
    const key = parts[0]?.trim() ?? "";
    const percent = parts[1]?.trim() ?? "";
    if (!key || key.length > 200 || !/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/.test(percent)) return null;
    const [whole, fractional = ""] = percent.split(".");
    return Object.freeze({ key, basisPoints: Number(whole) * 100 + Number(fractional.padEnd(2, "0")) });
  });
  if (allocations.some((allocation) => allocation === null)) return null;
  const exact = allocations as readonly Readonly<{ key: string; basisPoints: number }>[];
  if (new Set(exact.map((allocation) => allocation.key)).size !== exact.length
    || exact.reduce((sum, allocation) => sum + allocation.basisPoints, 0) !== 10_000) return null;
  return Object.freeze([...exact].sort((left, right) => left.key.localeCompare(right.key)));
}

export function buildSliceRuleDraftCommand(form: Form, head?: SliceRuleWorkspaceItem) {
  const continuation = Number(form.continuationPercent);
  const priority = Number(form.priority);
  const window = Number(form.evaluationWindowDays);
  if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(form.seriesRef)
    || !/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(form.serviceRef)
    || !/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(form.campaignFamilyRef)
    || !Number.isInteger(priority) || priority < 0 || priority > 100
    || !form.rollbackWhen.trim()) return null;
  let rule: SliceRule;
  if (form.ruleKind === "period_budget_cap") {
    if (!/^[A-Z]{3}$/.test(form.currency) || !/^(0|[1-9]\d*)(?:\.\d{1,12})?$/.test(form.maximumDecimal)
      || Number(form.maximumDecimal) <= 0) return null;
    rule = { kind: form.ruleKind, period: form.period, currency: form.currency, maximumDecimal: form.maximumDecimal };
  } else if (form.ruleKind === "budget_distribution") {
    const allocations = parseDistributionAllocations(form.distributionAllocations);
    if (!allocations) return null;
    rule = { kind: form.ruleKind, dimension: form.distributionDimension, allocations };
  } else if (form.ruleKind === "winner_continuation_rotation") {
    if (!Number.isInteger(continuation) || continuation < 0 || continuation > 100 || !Number.isInteger(window)
      || window < 1 || window > 90 || form.metric === "delivery_health") return null;
    rule = { kind: form.ruleKind, metric: form.metric, continuationBasisPoints: continuation * 100,
      explorationBasisPoints: (100 - continuation) * 100, evaluationWindowDays: window };
  } else {
    rule = { kind: form.ruleKind, condition: form.condition, response: "needs_human_review" };
  }
  const scope = { market: form.market, serviceRef: form.serviceRef, campaignFamilyRef: form.campaignFamilyRef,
    ...(form.countryOrRegion.trim() ? { countryOrRegion: form.countryOrRegion.trim() } : {}),
    ...(form.audienceStrategy.trim() ? { audienceStrategy: form.audienceStrategy.trim() } : {}),
    ...(form.platform ? { platform: form.platform } : {}),
    ...(form.conversionRoute ? { conversionRoute: form.conversionRoute } : {}) };
  const revision = head ? head.revision + 1 : 1;
  return Object.freeze({ operation: "save_draft" as const, seriesRef: form.seriesRef, revision,
    previousDraftHash: head?.draftHash ?? "GENESIS", idempotencyKey: `${form.seriesRef}.r${revision}`,
    scope, rule, priority, verification: { metric: form.metric, reviewCadence: form.reviewCadence,
      rollbackWhen: form.rollbackWhen.trim() } });
}

function ruleLabel(rule: SliceRule): string {
  if (rule.kind === "period_budget_cap") return `${rule.period} tavan · ${rule.maximumDecimal} ${rule.currency}`;
  if (rule.kind === "budget_distribution") return `${rule.dimension} dağılımı · ${rule.allocations.length} dilim`;
  if (rule.kind === "winner_continuation_rotation") return `Kazanan %${rule.continuationBasisPoints / 100} · keşif %${rule.explorationBasisPoints / 100}`;
  if (rule.kind === "delivery_guardrail") return `Teslimat koruması · ${rule.condition}`;
  return rule.kind;
}

function scopeLabel(scope: Scope): string {
  return [scope.market === "domestic" ? "Yerli" : "Yabancı", scope.serviceRef, scope.campaignFamilyRef,
    scope.countryOrRegion, scope.audienceStrategy, scope.platform, scope.conversionRoute].filter(Boolean).join(" · ");
}

function followUpLabel(item: SliceRuleWorkspaceItem): string {
  const verification = item.operatingRule.verification;
  return `${verification.metric.replaceAll("_", " ")} · ${verification.reviewCadence} · öncelik ${item.operatingRule.priority}`;
}

function percent(basisPoints: number): string {
  return String(basisPoints / 100);
}

function isEditableRule(rule: SliceRule): rule is Extract<SliceRule, { kind: Form["ruleKind"] }> {
  return rule.kind === "period_budget_cap" || rule.kind === "budget_distribution"
    || rule.kind === "winner_continuation_rotation" || rule.kind === "delivery_guardrail";
}

/** A selected immutable head becomes the exact starting point for its next revision. */
function formFromItem(item: SliceRuleWorkspaceItem): Form {
  const rule = item.operatingRule.rule;
  const shared = { ...EMPTY_FORM, seriesRef: item.seriesRef, market: item.scope.market,
    serviceRef: item.scope.serviceRef, campaignFamilyRef: item.scope.campaignFamilyRef,
    countryOrRegion: item.scope.countryOrRegion ?? "", audienceStrategy: item.scope.audienceStrategy ?? "",
    platform: item.scope.platform ?? "", conversionRoute: item.scope.conversionRoute ?? "", ruleKind: isEditableRule(rule) ? rule.kind : "period_budget_cap",
    priority: String(item.operatingRule.priority),
    metric: item.operatingRule.verification.metric, reviewCadence: item.operatingRule.verification.reviewCadence,
    rollbackWhen: item.operatingRule.verification.rollbackWhen } as Form;
  if (!isEditableRule(rule)) return shared;
  if (rule.kind === "period_budget_cap") return { ...shared, period: rule.period, currency: rule.currency, maximumDecimal: rule.maximumDecimal };
  if (rule.kind === "budget_distribution") return { ...shared, distributionDimension: rule.dimension,
    distributionAllocations: rule.allocations.map((allocation) => `${allocation.key}: ${percent(allocation.basisPoints)}`).join("\n") };
  if (rule.kind === "winner_continuation_rotation") return { ...shared, continuationPercent: percent(rule.continuationBasisPoints),
    evaluationWindowDays: String(rule.evaluationWindowDays) };
  if (rule.kind === "delivery_guardrail") return { ...shared, condition: rule.condition };
  return shared;
}
function date(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value));
}

export function SliceRuleWorkspaceSurface(props: Readonly<{
  state: State;
  onRetry(): void;
  onSaved(): Promise<void>;
  onApprovalQueueHandoff?(actionUnitRef: string): void;
}>) {
  const snapshot = props.state.status === "ready" ? props.state.snapshot : null;
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [headRef, setHeadRef] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [scenarioForm, setScenarioForm] = useState<TypedScenarioForm>(EMPTY_TYPED_SCENARIO);
  const [impactContexts, setImpactContexts] = useState<Readonly<{ status: "idle" | "loading" | "ready" | "unavailable"; candidates: readonly BudgetImpactContextCandidate[]; selectedRef: string; message?: string }>>({ status: "idle", candidates: [], selectedRef: "" });
  const [impactState, setImpactState] = useState<ImpactState>({ status: "idle" });
  const [selection, setSelection] = useState<SelectionState>({ status: "loading" });
  const [approvalQueue, setApprovalQueue] = useState<ApprovalQueueState>({ status: "loading" });
  const [temporal, setTemporal] = useState<TemporalState>({ status: "loading" });
  const [scopeCandidates, setScopeCandidates] = useState<ScopeCandidateState>({ status: "loading" });
  const [operationalReadiness, setOperationalReadiness] = useState<OperationalReadinessState>({ status: "loading" });
  const [poolBinding, setPoolBinding] = useState<PoolBindingState>({ status: "loading" });
  const head = snapshot?.items.find((item) => item.seriesRef === headRef) ?? undefined;
  const frozenPoolBinding = head && (poolBinding.status === "ready" || poolBinding.status === "saving")
    ? poolBinding.snapshot.bindings.find((binding) => binding.draftHash === head.draftHash) ?? null : null;
  const sameMarketPoolNodes = head && (poolBinding.status === "ready" || poolBinding.status === "saving")
    ? poolBinding.snapshot.hierarchy?.nodes.filter((node) => node.market === head.scope.market) ?? [] : [];
  const editableHead = head === undefined || isEditableRule(head.operatingRule.rule);
  const command = useMemo(() => editableHead ? buildSliceRuleDraftCommand(form, head) : null, [editableHead, form, head]);
  const impactCommand = useMemo(() => frozenPoolBinding ? buildTypedBudgetImpactCommand(head, scenarioForm) : null, [head, scenarioForm, frozenPoolBinding]);
  const selectedImpactContext = impactContexts.candidates.find((candidate) => candidate.candidateRef === impactContexts.selectedRef) ?? null;
  const update = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const loadSelectionCandidates = useCallback(async () => {
    try {
      const response = await fetch("/api/slice-rule-scenario-selections", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "slice-rule-scenario-selection-read" } });
      if (!response.ok) throw new Error("Seçilebilir senaryolar okunamadı.");
      setSelection({ status: "ready", candidates: parseSliceRuleScenarioSelectionCandidates(await response.json()) });
    } catch (reason) { setSelection({ status: "unavailable", message: reason instanceof Error ? reason.message : "Seçilebilir senaryolar okunamadı." }); }
  }, []);
  useEffect(() => { void loadSelectionCandidates(); }, [loadSelectionCandidates]);
  const loadApprovalSelections = useCallback(async () => {
    try {
      const response = await fetch("/api/slice-rule-budget-action-units", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "slice-rule-budget-action-unit-read" } });
      const payload = await response.json();
      if (!response.ok) throw new Error("Seçilmiş senaryolar okunamadı.");
      setApprovalQueue({ status: "ready", selections: parseSliceRuleBudgetActionSelections(payload), decisionTrace: parseSliceRuleDecisionTrace(payload), actionPreparation: parseActionPreparationFlag(payload) });
    } catch (reason) { setApprovalQueue({ status: "unavailable", message: reason instanceof Error ? reason.message : "Seçilmiş senaryolar okunamadı." }); }
  }, []);
  useEffect(() => { void loadApprovalSelections(); }, [loadApprovalSelections]);
  const loadTemporalCandidates = useCallback(async (result: string | null = null) => {
    try {
      const response = await fetch("/api/temporal-recommendations", { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json();
      if (!response.ok) throw new Error("Zamansal adaylar okunamadı.");
      setTemporal({ status: "ready", candidates: parseTemporalEvaluationCandidates(payload), result });
    } catch (reason) { setTemporal({ status: "unavailable", message: reason instanceof Error ? reason.message : "Zamansal adaylar okunamadı." }); }
  }, []);
  useEffect(() => { void loadTemporalCandidates(); }, [loadTemporalCandidates]);
  const loadScopeCandidates = useCallback(async () => {
    try {
      const response = await fetch("/api/slice-scope-candidates", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "slice-scope-candidates-read" } });
      if (!response.ok) throw new Error("Slice kapsam adayları okunamadı.");
      setScopeCandidates({ status: "ready", candidates: parseSliceScopeCandidates(await response.json()) });
    } catch { setScopeCandidates({ status: "unavailable" }); }
  }, []);
  useEffect(() => { void loadScopeCandidates(); }, [loadScopeCandidates]);
  const loadOperationalReadiness = useCallback(async () => {
    try {
      const response = await fetch("/api/slice-operational-readiness", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "slice-operational-readiness-read" } });
      if (!response.ok) throw new Error("Slice operasyon uygunluğu okunamadı.");
      setOperationalReadiness({ status: "ready", items: parseSliceOperationalReadiness(await response.json()) });
    } catch { setOperationalReadiness({ status: "unavailable" }); }
  }, []);
  useEffect(() => { void loadOperationalReadiness(); }, [loadOperationalReadiness]);
  const loadPoolBinding = useCallback(async () => {
    try {
      const response = await fetch("/api/slice-rule-budget-pool-bindings", { cache: "no-store", credentials: "same-origin", headers: { "X-ReklamZeka-Intent": "slice-rule-budget-pool-binding-read" } });
      const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message ?? "Bütçe havuzu bağları okunamadı.");
      const parsed = parseSliceRuleBudgetPoolBindingSnapshot(payload);
      setPoolBinding({ status: "ready", snapshot: parsed, selectedPoolRef: "" });
    } catch (reason) { setPoolBinding({ status: "unavailable", message: reason instanceof Error ? reason.message : "Bütçe havuzu bağları okunamadı." }); }
  }, []);
  useEffect(() => { void loadPoolBinding(); }, [loadPoolBinding]);
  const loadImpactContexts = useCallback(async (seriesRef: string) => {
    setImpactContexts({ status: "loading", candidates: [], selectedRef: "" });
    try {
      const response = await fetch(`/api/slice-rule-budget-impact-context-candidates?${new URLSearchParams({ seriesRef })}`, { cache: "no-store", credentials: "same-origin", headers: { "X-ReklamZeka-Intent": "slice-rule-budget-impact-context-candidates-read" } });
      if (!response.ok) throw new Error("Bütçe etki bağlamları okunamadı.");
      const result = parseBudgetImpactContextCandidates(await response.json());
      setImpactContexts({ status: "ready", candidates: result.candidates, selectedRef: "" });
    } catch (reason) { setImpactContexts({ status: "unavailable", candidates: [], selectedRef: "", message: reason instanceof Error ? reason.message : "Bütçe etki bağlamları okunamadı." }); }
  }, []);
  useEffect(() => { if (head && frozenPoolBinding && head.operatingRule.rule.kind !== "delivery_guardrail") void loadImpactContexts(head.seriesRef); else setImpactContexts({ status: "idle", candidates: [], selectedRef: "" }); }, [frozenPoolBinding, head, loadImpactContexts]);
  const applyScopeCandidate = (candidate: ScopeCandidate) => {
    setHeadRef(null); setImpactState({ status: "idle" });
    setForm((current) => ({ ...current, market: candidate.scope.market, serviceRef: candidate.scope.serviceRef,
      campaignFamilyRef: candidate.scope.campaignFamilyRef, countryOrRegion: candidate.scope.countryOrRegion ?? "",
      audienceStrategy: candidate.scope.audienceStrategy ?? "", platform: candidate.scope.platform ?? "",
      conversionRoute: candidate.scope.conversionRoute ?? "" }));
  };
  const evaluateTemporal = async (candidate: TemporalCandidate) => {
    setTemporal({ status: "loading" });
    try {
      const response = await fetch("/api/temporal-recommendations", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "temporal-recommendation-evaluate" },
        body: JSON.stringify({ candidateRef: candidate.candidateRef }) });
      const payload = await response.json() as { outcome?: string; reason?: string; persistence?: string; authority?: ClosedAuthority; error?: { message?: string } };
      if (!response.ok || !["recommendation", "no_change"].includes(String(payload.outcome)) || !["inserted", "unchanged"].includes(String(payload.persistence))
        || !isClosed(payload.authority)) throw new Error(payload.error?.message ?? "Zamansal değerlendirme isteği reddedildi.");
      const result = `${payload.outcome === "recommendation" ? "Öneri kaydedildi" : "Değişiklik önerilmedi"} · ${String(payload.reason).replaceAll("_", " ")} · ${payload.persistence}`;
      await loadTemporalCandidates(result);
    } catch (reason) { setTemporal({ status: "error", message: reason instanceof Error ? reason.message : "Zamansal değerlendirme isteği reddedildi." }); }
  };
  const sendToApprovalQueue = async (selection: ApprovalQueueSelection) => {
    setApprovalQueue({ status: "loading" }); const proposedAt = new Date().toISOString(); const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    try {
      const response = await fetch("/api/slice-rule-budget-action-units", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "slice-rule-budget-action-unit-materialize" },
        body: JSON.stringify({ command: { selectionRef: selection.selectionRef, idempotencyKey: `approval_${selection.selectionRef.slice(-20)}`, proposedAt, expiresAt } }) });
      const payload = await response.json() as { selectionRef?: string; actionUnitRef?: string; persistence?: "inserted" | "unchanged"; error?: { message?: string } };
      if (!response.ok || payload.selectionRef !== selection.selectionRef || !/^action_unit_[a-f0-9]{20}$/.test(String(payload.actionUnitRef))
        || (payload.persistence !== "inserted" && payload.persistence !== "unchanged")) throw new Error(payload.error?.message ?? "İnsan onay kuyruğu isteği reddedildi.");
      const actionUnitRef = String(payload.actionUnitRef);
      setApprovalQueue({ status: "queued", selectionRef: selection.selectionRef, actionUnitRef, persistence: payload.persistence });
      props.onApprovalQueueHandoff?.(actionUnitRef);
    } catch (reason) { setApprovalQueue({ status: "error", message: reason instanceof Error ? reason.message : "İnsan onay kuyruğu isteği reddedildi." }); }
  };
  const selectScenario = async (candidate: SelectionCandidate) => {
    setSelection({ status: "loading" });
    try {
      const response = await fetch("/api/slice-rule-scenario-selections", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "slice-rule-scenario-select" },
        body: JSON.stringify({ command: { candidateRef: candidate.candidateRef, idempotencyKey: `selection.${candidate.candidateRef.slice(-20)}` } }) });
      const payload = await response.json() as { selectionRef?: string; persistence?: "inserted" | "unchanged"; error?: { message?: string } };
      if (!response.ok || !/^selection_[a-f0-9]{64}$/.test(String(payload.selectionRef)) || (payload.persistence !== "inserted" && payload.persistence !== "unchanged")) throw new Error(payload.error?.message ?? "Senaryo seçimi reddedildi.");
      const selectionRef = String(payload.selectionRef);
      setSelection({ status: "selected", selectionRef, persistence: payload.persistence });
      await loadApprovalSelections();
    } catch (reason) { setSelection({ status: "error", message: reason instanceof Error ? reason.message : "Senaryo seçimi reddedildi." }); }
  };
  const bindPool = async () => {
    if (!head || poolBinding.status !== "ready" || !poolBinding.selectedPoolRef || !poolBinding.snapshot.hierarchy) return;
    setPoolBinding({ ...poolBinding, status: "saving" });
    try {
      const response = await fetch("/api/slice-rule-budget-pool-bindings", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "slice-rule-budget-pool-binding-save" }, body: JSON.stringify({ command: { draftHash: head.draftHash, hierarchyHash: poolBinding.snapshot.hierarchy.hierarchyHash, poolRef: poolBinding.selectedPoolRef, market: head.scope.market, idempotencyKey: `pool_binding.${head.draftHash.slice(0, 24)}` } }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message ?? "Bütçe havuzu bağlama isteği reddedildi.");
      await loadPoolBinding();
    } catch (reason) { setPoolBinding({ status: "error", message: reason instanceof Error ? reason.message : "Bütçe havuzu bağlama isteği reddedildi." }); }
  };
  const save = async () => {
    if (!command || !snapshot?.authority.canSaveDraft) return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/slice-rule-workspace", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "slice-rule-workspace-save" },
        body: JSON.stringify({ command }) });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Taslak kaydedilemedi.");
      setMessage("Recommendation-only taslak append-only kayıt defterine eklendi.");
      setHeadRef(command.seriesRef);
      setImpactState({ status: "idle" });
      await props.onSaved();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Taslak kaydedilemedi."); }
    finally { setSaving(false); }
  };
  const previewImpact = async () => {
    if (!head || head.operatingRule.rule.kind === "delivery_guardrail") {
      setImpactState({ status: "unsupported", message: "Teslimat koruması bütçe etki önizlemesi üretmez. Bu kural delivery inceleme akışında değerlendirilir." });
      return;
    }
    if (!impactCommand || !selectedImpactContext) {
      setImpactState({ status: "error", message: "Önizleme için doğrulanmış bir frozen bağlam ve eksiksiz kullanıcı senaryosu gerekir." });
      return;
    }
    const requestedHead = head;
    setImpactState({ status: "loading" });
    try {
      const response = await fetch("/api/slice-rule-workspace", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "slice-rule-budget-impact-preview" },
        body: JSON.stringify({ command: { seriesRef: requestedHead.seriesRef, candidateRef: selectedImpactContext?.candidateRef, budgetCommand: impactCommand } }) });
      const payload = await response.json() as { error?: { code?: string } };
      if (!response.ok) { setImpactState(classifySliceRuleBudgetImpactFailure(payload.error?.code, response.status)); return; }
      setImpactState({ status: "ready", result: parseSliceRuleBudgetImpactResult(payload, requestedHead) });
    } catch (reason) {
      setImpactState({ status: "unavailable", message: reason instanceof Error
        ? reason.message : "Etki önizlemesi kullanılamıyor; hiçbir fallback uygulanmadı." });
    }
  };
  const saveAdvisoryDraft = async () => {
    if (!head || impactState.status !== "ready" || !impactCommand || !selectedImpactContext) return;
    const requestedHead = head;
    setImpactState({ status: "loading" });
    try {
      const response = await fetch("/api/slice-rule-workspace", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "slice-rule-budget-impact-save" },
        body: JSON.stringify({ command: { seriesRef: requestedHead.seriesRef, candidateRef: selectedImpactContext?.candidateRef, budgetCommand: impactCommand } }) });
      const payload = await response.json() as { error?: { code?: string } };
      if (!response.ok) { setImpactState(classifySliceRuleBudgetImpactFailure(payload.error?.code, response.status)); return; }
      setImpactState({ status: "saved", result: parseSliceRuleBudgetImpactSavedResult(payload, requestedHead) });
    } catch (reason) {
      setImpactState({ status: "unavailable", message: reason instanceof Error
        ? reason.message : "Öneri taslağı kaydedilemedi; hiçbir action veya Meta write yapılmadı." });
    }
  };
  return <div className={styles.workspace}>
    <header className={styles.hero}><div><span>SLICE RULE WORKSPACE</span><h2>Slice, kural ve takip yaklaşımını aynı çalışma tablosunda görün.</h2><p>Her satır bir kullanıcı yazarlı scope ve kural serisidir: analiz/bütçe yaklaşımını, değerlendirme ritmini ve geri alma koşulunu birlikte önizlersiniz. Agent yalnız kanıt ve eksik sorularla yardımcı olur.</p></div><strong>RECOMMENDATION ONLY · AUTHORITY NONE</strong></header>
    {props.state.status === "loading" ? <section className={styles.state} role="status">Taslak kayıt defteri doğrulanıyor…</section> : null}
    {props.state.status === "unavailable" || props.state.status === "error" ? <section className={styles.state} role="alert"><h2>{props.state.status === "unavailable" ? "Kaynak bağlı değil" : "Çalışma alanı okunamadı"}</h2><p>{props.state.message}</p><button onClick={props.onRetry}>Tekrar dene</button></section> : null}
    {snapshot ? <div className={styles.grid}>
      <section className={`${styles.panel} ${styles.workspaceTablePanel}`}><div className={styles.panelTitle}><div><span>SLICE & KURAL ÇALIŞMA TABLOSU</span><h2>{snapshot.items.length} güncel seri</h2></div><small>Append-only · kullanıcı yazarlı</small></div>
        {snapshot.items.length === 0 ? <p>Henüz kayıtlı slice rule taslağı yok. Önce kanıtlı bir scope seçin, ardından kendi kuralınızı yazın.</p> : <div className={styles.tableScroll}><table className={styles.workspaceTable}><caption>Her satırın kapsamı, kuralı ve takip yaklaşımı birlikte önizlenir.</caption><thead><tr><th scope="col">Slice</th><th scope="col">Kural / bütçe yaklaşımı</th><th scope="col">Takip yaklaşımı</th><th scope="col">Durum</th></tr></thead><tbody>{snapshot.items.map((item) => <tr key={item.draftRef} data-active={headRef === item.seriesRef}><td><strong>{item.seriesRef} · r{item.revision}</strong><span>{scopeLabel(item.scope)}</span></td><td><strong>{ruleLabel(item.operatingRule.rule)}</strong><span>{item.operatingMode === "recommendation_only" ? "Öneri ve insan incelemesi" : "—"}</span></td><td><strong>{followUpLabel(item)}</strong><span>{item.operatingRule.verification.rollbackWhen}</span></td><td><button type="button" onClick={() => { setHeadRef(item.seriesRef); setImpactState({ status: "idle" }); setForm(formFromItem(item)); }}>{headRef === item.seriesRef ? "Açık" : "Kuralı gözden geçir"}</button><small>{date(item.createdAt)}</small></td></tr>)}</tbody></table></div>}
        <section className={styles.unruledSlices} aria-label="Kuralsız kanıtlı slice adayları"><strong>Kuralsız kanıtlı slice adayları</strong><span>Bu satırlar gerçek kategori kanıtından gelir; yalnız henüz aynı kapsamda kayıtlı bir kullanıcı kuralı yoktur. Kural otomatik oluşturulmaz.</span>{scopeCandidates.status === "loading" ? <small>Aday slice’lar okunuyor…</small> : null}{scopeCandidates.status === "unavailable" ? <small>Aday slice’lar kullanılamıyor; formda tahmin veya fallback yok.</small> : null}{scopeCandidates.status === "ready" ? (() => { const unruled = scopeCandidates.candidates.filter((candidate) => !snapshot.items.some((item) => sameScope(item.scope, candidate.scope))).slice(0, 25); return unruled.length ? <div className={styles.unruledList}>{unruled.map((candidate) => <div key={candidate.campaignRef}><span>{scopeLabel(candidate.scope)}</span><button type="button" disabled={!snapshot.authority.canSaveDraft} onClick={() => applyScopeCandidate(candidate)}>Bu slice ile yeni kural yaz</button></div>)}</div> : <small>Mevcut kanıtlı slice’ların her biri en az bir güncel kural serisiyle eşleşiyor.</small>; })() : null}</section>
        <button className={styles.newButton} type="button" onClick={() => { setHeadRef(null); setImpactState({ status: "idle" }); setForm(EMPTY_FORM); }}>+ Yeni seri</button>
      </section>
      <section className={styles.panel}><div className={styles.panelTitle}><div><span>{head ? `REVİZYON ${head.revision + 1}` : "YENİ TASLAK"}</span><h2>{head ? "Kuralı pekiştir veya yeni revizyon yaz" : "Kapsam ve kural"}</h2></div><small>{snapshot.authority.canSaveDraft ? "Owner · Admin · Analyst" : "Viewer · salt okunur"}</small></div>
        {!head ? <section className={styles.impactResult} aria-label="Kanıtlı slice kapsam adayları"><strong>Kanıtlı kapsam adayları</strong><span>Yalnız tekil ve tutarlı mevcut kategori anahtarları yeni formu doldurur. Frozen context, bütçe etkisi, policy ve action yetkisi üretmez.</span>
          {scopeCandidates.status === "loading" ? <span>Kapsam adayları okunuyor…</span> : null}
          {scopeCandidates.status === "ready" && scopeCandidates.candidates.length === 0 ? <span>Tekil zorunlu kapsam kanıtı olan kampanya yok.</span> : null}
          {scopeCandidates.status === "ready" ? scopeCandidates.candidates.slice(0, 50).map((candidate) => <div className={styles.row} key={candidate.campaignRef}><span>{candidate.campaignRef.slice(0, 18)}… · {candidate.scope.market} · {candidate.scope.serviceRef} · {candidate.scope.campaignFamilyRef}</span><button type="button" className={styles.preview} disabled={!snapshot.authority.canSaveDraft} onClick={() => applyScopeCandidate(candidate)}>Formu doldur</button></div>) : null}
          {scopeCandidates.status === "unavailable" ? <span>Kapsam adayları şu an kullanılamıyor; formda hiçbir fallback uygulanmadı.</span> : null}
        </section> : null}
        <fieldset disabled={!snapshot.authority.canSaveDraft || saving} className={styles.form}>
          <label>Seri referansı<input value={form.seriesRef} disabled={Boolean(head)} onChange={(event) => update("seriesRef", event.target.value)} placeholder="slice_rule.ftr.ar" /></label>
          <div className={styles.row}><label>Pazar<select value={form.market} disabled={Boolean(head)} onChange={(event) => update("market", event.target.value as Market)}><option value="domestic">Yerli</option><option value="international">Yabancı</option></select></label><label>Platform (opsiyonel)<select value={form.platform} disabled={Boolean(head)} onChange={(event) => update("platform", event.target.value as Form["platform"])}><option value="">Tümü / belirtilmedi</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="mixed">Karma</option></select></label></div>
          <label>Sonuç rotası (opsiyonel)<select value={form.conversionRoute} disabled={Boolean(head)} onChange={(event) => update("conversionRoute", event.target.value as Form["conversionRoute"])}><option value="">Belirtilmedi</option><option value="lead_form">Lead formu</option><option value="whatsapp">WhatsApp</option><option value="landing_page">Landing page</option></select></label>
          <label>Hizmet referansı<input value={form.serviceRef} disabled={Boolean(head)} onChange={(event) => update("serviceRef", event.target.value)} placeholder="service_physical_therapy" /></label>
          <label>Kampanya ailesi referansı<input value={form.campaignFamilyRef} disabled={Boolean(head)} onChange={(event) => update("campaignFamilyRef", event.target.value)} placeholder="campaign_family_intensive_ftr" /></label>
          <div className={styles.row}><label>Ülke / bölge (opsiyonel)<input value={form.countryOrRegion} disabled={Boolean(head)} onChange={(event) => update("countryOrRegion", event.target.value)} /></label><label>Hedefleme stratejisi (opsiyonel)<input value={form.audienceStrategy} disabled={Boolean(head)} onChange={(event) => update("audienceStrategy", event.target.value)} /></label></div>
          <label>Kural türü<select value={form.ruleKind} onChange={(event) => update("ruleKind", event.target.value as Form["ruleKind"])}><option value="period_budget_cap">Dönemsel bütçe tavanı</option><option value="budget_distribution">Bütçe dağılımı</option><option value="winner_continuation_rotation">Kazananı sürdür / keşif rotasyonu</option><option value="delivery_guardrail">Teslimat koruması</option></select></label>
          {form.ruleKind === "period_budget_cap" ? <div className={styles.row}><label>Dönem<select value={form.period} onChange={(event) => update("period", event.target.value as Form["period"])}><option value="daily">Günlük</option><option value="weekly">Haftalık</option><option value="monthly">Aylık</option></select></label><label>Tavan<input value={form.maximumDecimal} onChange={(event) => update("maximumDecimal", event.target.value)} inputMode="decimal" placeholder="250000" /></label><label>Para birimi<input value={form.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} maxLength={3} /></label></div> : null}
          {form.ruleKind === "budget_distribution" ? <><label>Dağıtım boyutu<select value={form.distributionDimension} onChange={(event) => update("distributionDimension", event.target.value as Form["distributionDimension"])}><option value="countryOrRegion">Ülke / bölge</option><option value="campaignCategory">Kampanya kategorisi</option><option value="conversionRoute">Sonuç rotası</option></select></label><label>Dilim ve paylar<textarea value={form.distributionAllocations} onChange={(event) => update("distributionAllocations", event.target.value)} rows={4} placeholder={"Arap Bölgesi: 60\nAvrupa: 40"} /><small>Her satır <strong>dilim: yüzde</strong> biçiminde olmalı; toplam tam %100 olmalı. Bu yalnız insan incelemeli bir dağılım önerisidir.</small></label></> : null}
          {form.ruleKind === "winner_continuation_rotation" ? <div className={styles.row}><label>Kazanan payı %<input value={form.continuationPercent} onChange={(event) => update("continuationPercent", event.target.value)} inputMode="numeric" /></label><label>Ölçüm penceresi (gün)<input value={form.evaluationWindowDays} onChange={(event) => update("evaluationWindowDays", event.target.value)} inputMode="numeric" /></label></div> : null}
          {form.ruleKind === "delivery_guardrail" ? <label>Koşul<select value={form.condition} onChange={(event) => update("condition", event.target.value as Form["condition"])}><option value="delivery_interrupted">Teslimat kesintisi</option><option value="capacity_constrained">Kapasite kısıtı</option><option value="payment_or_account_review">Ödeme / hesap incelemesi</option></select></label> : null}
          <div className={styles.row}><label>Öncelik (0–100)<input value={form.priority} onChange={(event) => update("priority", event.target.value)} inputMode="numeric" /></label><label>İnceleme sıklığı<select value={form.reviewCadence} onChange={(event) => update("reviewCadence", event.target.value as Form["reviewCadence"])}><option value="daily">Günlük</option><option value="weekly">Haftalık</option><option value="monthly">Aylık</option></select></label></div>
          <label>Beklenen metrik<select value={form.metric} onChange={(event) => update("metric", event.target.value as Form["metric"])}><option value="qualified_leads">Nitelikli lead</option><option value="cost_per_qualified_lead">Nitelikli lead maliyeti</option><option value="engagement_rate">Etkileşim oranı</option><option value="delivery_health">Teslimat sağlığı</option></select></label>
          <label>Geri alma / yeniden inceleme koşulu<textarea value={form.rollbackWhen} onChange={(event) => update("rollbackWhen", event.target.value)} rows={3} /></label>
        </fieldset>
        {head && !editableHead ? <p className={styles.impactNotice} role="status"><strong>Bu taslak türü bu ilk editörde değiştirilemez.</strong> Kayıt korunur; yanlışlıkla başka bir kurala dönüştürülemez.</p> : null}
        <div className={styles.safety}><strong>Yetki sınırı</strong><span>Policy yayınlama: kapalı</span><span>Onay: kapalı</span><span>Action/Meta write: kapalı</span><span>Otomasyon: kapalı</span></div>
        <section className={styles.impact} aria-label="Bütçe havuzu bağlama">
          <div className={styles.panelTitle}><div><span>IMMUTABLE DRAFT · BUDGET POOL</span><h2>Bütçe havuzu bağı</h2></div><small>Öneri · Meta write kapalı</small></div>
          {!head ? <p className={styles.impactNotice}>Bir bütçe havuzu seçebilmek için önce kayıtlı, immutable bir kural taslağı seçin.</p> : null}
          {head && poolBinding.status === "loading" ? <p className={styles.impactNotice}>Mevcut havuz hiyerarşisi ve frozen bağ kanıtı okunuyor…</p> : null}
          {head && (poolBinding.status === "unavailable" || poolBinding.status === "error") ? <p className={styles.impactFailure} role="alert">{poolBinding.message}</p> : null}
          {head && frozenPoolBinding ? <div className={styles.impactResult} role="status"><strong>Frozen bütçe havuzu bağı</strong><span>{frozenPoolBinding.market === "domestic" ? "Yerli" : "Yabancı"} · {frozenPoolBinding.poolRef}</span><span>Draft: {frozenPoolBinding.draftHash.slice(0, 16)}… · hiyerarşi: {frozenPoolBinding.hierarchyHash.slice(0, 16)}…</span><span>{date(frozenPoolBinding.boundAt)} · immutable · onay/action/Meta write kapalı</span></div> : null}
          {head && !frozenPoolBinding && (poolBinding.status === "ready" || poolBinding.status === "saving") ? <div className={styles.impactResult}>
            {!poolBinding.snapshot.hierarchy ? <span>Kaydedilmiş bütçe havuzu hiyerarşisi yok; bağ oluşturulmadı.</span> : sameMarketPoolNodes.length === 0 ? <span>Bu kuralın pazarıyla aynı pazar havuz düğümü bulunamadı; pazar sınırı aşılmadı.</span> : <><span>Yalnız <strong>{head.scope.market === "domestic" ? "yerli" : "yabancı"}</strong> hiyerarşi düğümü seçilebilir. Tarayıcı kapsam veya tutar göndermez.</span><label>Havuz düğümü<select value={poolBinding.selectedPoolRef} disabled={!poolBinding.snapshot.authority.canBind || poolBinding.status === "saving"} onChange={(event) => setPoolBinding({ ...poolBinding, selectedPoolRef: event.target.value })}><option value="">Havuz seçin</option>{sameMarketPoolNodes.map((node) => <option key={node.poolRef} value={node.poolRef}>{node.poolRef} · {node.layer} · {node.hardCapDecimal} {node.currency}</option>)}</select></label><button className={styles.save} type="button" disabled={!poolBinding.snapshot.authority.canBind || !poolBinding.selectedPoolRef || poolBinding.status === "saving"} onClick={() => void bindPool()}>{poolBinding.status === "saving" ? "Bağ doğrulanıyor…" : "Immutable taslağa havuzu bağla"}</button></>}
          </div> : null}
          <small>Bu bağ yalnız kullanıcı tarafından kaydedilmiş taslağın bütçe kapsamı kanıtıdır; policy üretmez, onaylamaz, action açmaz ve Meta’da değişiklik yapmaz.</small>
        </section>
        <section className={styles.impact} aria-label="Operasyon uygunluğu">
          <div className={styles.panelTitle}><div><span>FROZEN CONTEXT · READINESS</span><h2>Operasyon uygunluğu</h2></div><small>Salt-okur</small></div>
          {operationalReadiness.status === "loading" ? <p className={styles.impactNotice}>Frozen context uygunluğu okunuyor…</p> : null}
          {operationalReadiness.status === "unavailable" ? <p className={styles.impactNotice}>Uygunluk kaynağı şu anda kullanılamıyor.</p> : null}
          {operationalReadiness.status === "ready" && operationalReadiness.items.length === 0 ? <p className={styles.impactNotice}>Kapsam adayı için henüz frozen context uygunluğu yok.</p> : null}
          {operationalReadiness.status === "ready" ? operationalReadiness.items.map((item) => <div className={styles.impactResult} key={item.candidateRef}>
            <strong>{item.scope.market === "domestic" ? "Yerli" : "Yabancı"} · {item.scope.serviceRef} · {item.scope.campaignFamilyRef}</strong>
            <span>Frozen context: {item.frozenContext === "ready" ? "hazır" : item.frozenContext === "missing" ? "eksik" : "kapsamla eşleşmiyor"}</span>
            <span>Bütçe etki önizlemesi: {item.budgetImpact === "eligible" ? "uygun" : "engelli"}</span>
          </div>) : null}
          <small>Bu gösterge frozen context oluşturmaz; policy, action, onay veya Meta write yetkisi vermez.</small>
        </section>
        {message ? <p className={styles.message} role="status">{message}</p> : null}
        <button className={styles.save} type="button" disabled={!command || !snapshot.authority.canSaveDraft || saving} onClick={() => void save()}>{saving ? "Kaydediliyor…" : head ? "Yeni revizyonu kaydet" : "Taslağı kaydet"}</button>
        <section className={styles.impact} aria-labelledby="slice-rule-impact-heading">
          <div className={styles.panelTitle}><div><span>BUDGET LAB · ÖNİZLEME / TASLAK</span><h2 id="slice-rule-impact-heading">Kayıtlı taslağın bütçe etkisi</h2></div><small>Onay · action · Meta write kapalı</small></div>
          {!head ? <p className={styles.impactNotice}>Önizleme için önce kayıt defterindeki güncel bir taslağı seçin. Kaydedilmemiş form kapsamı kullanılmaz.</p> : null}
          {head && head.operatingRule.rule.kind !== "delivery_guardrail" && !frozenPoolBinding ? <p className={styles.impactNotice} role="status"><strong>Önizleme kapalı.</strong> Bu bütçeyi etkileyen taslak için önce aynı pazar içindeki immutable bütçe havuzu bağını kaydedin.</p> : null}
          {head?.operatingRule.rule.kind === "delivery_guardrail" ? <p className={styles.impactNotice} role="status"><strong>Desteklenmiyor.</strong> Teslimat koruması doğrudan bütçe senaryosu değildir; otomatik bir bütçe etkisi varsayılmaz.</p> : null}
          {head && head.operatingRule.rule.kind !== "delivery_guardrail" ? <>
            <div className={styles.impactResult} aria-label="Frozen bütçe bağlamı">
              <strong>Doğrulanmış frozen bağlam</strong>
              <span>Bağlam yalnız sunucuda çözülür; kampanya UUID’si, hesap UUID’si ve context hash tarayıcıya gelmez.</span>
              {impactContexts.status === "loading" ? <span>Uygun bağlamlar doğrulanıyor…</span> : null}
              {impactContexts.status === "unavailable" ? <span role="alert">{impactContexts.message}</span> : null}
              {impactContexts.status === "ready" && impactContexts.candidates.length === 0 ? <span>Bu immutable kapsam ve havuz için hazır bağlam yok.</span> : null}
              {impactContexts.status === "ready" && impactContexts.candidates.length > 0 ? <label>Bağlam<select value={impactContexts.selectedRef} onChange={(event) => { setImpactContexts({ ...impactContexts, selectedRef: event.target.value }); setImpactState({ status: "idle" }); }}><option value="">Frozen bağlam seçin</option>{impactContexts.candidates.map((candidate) => <option key={candidate.candidateRef} value={candidate.candidateRef}>{candidate.campaignRef} · {candidate.currentBudgetDecimal} {candidate.currency} · {date(candidate.capturedAt)}</option>)}</select></label> : null}
            </div>
            <fieldset className={styles.impactInput}><legend>Kullanıcının bütçe senaryosu</legend><small>Bu form yalnız senaryo girdisini taşır. Kural, policy, onay, action veya Meta write üretmez.</small>
              <div className={styles.fields}><label>Senaryo etiketi<input value={scenarioForm.label} onChange={(event) => setScenarioForm({ ...scenarioForm, label: event.target.value })} /></label><label>Mod<select value={scenarioForm.mode} onChange={(event) => setScenarioForm({ ...scenarioForm, mode: event.target.value as TypedScenarioForm["mode"] })}><option value="keep">Mevcutu koru</option><option value="conservative">Temkinli</option></select></label><label>İstenen bütçe<input inputMode="decimal" value={scenarioForm.requestedBudgetDecimal} onChange={(event) => setScenarioForm({ ...scenarioForm, requestedBudgetDecimal: event.target.value })} /></label><label>Dönem başlangıcı<input type="date" value={scenarioForm.startDate} onChange={(event) => setScenarioForm({ ...scenarioForm, startDate: event.target.value })} /></label><label>Dönem bitişi<input type="date" value={scenarioForm.endDate} onChange={(event) => setScenarioForm({ ...scenarioForm, endDate: event.target.value })} /></label></div><small>Mevcut bütçe, allocation, kategori/geo, zaman damgası ve pacing kanıtı yalnız seçili frozen bağlamdan sunucuda türetilir; eksikse önizleme üretilemez.</small></fieldset>
            <button className={styles.preview} type="button" disabled={impactState.status === "loading" || !impactCommand || !selectedImpactContext}
              onClick={() => void previewImpact()}>{impactState.status === "loading" ? "Kanıt doğrulanıyor…" : "Salt-okur etkiyi önizle"}</button>
          </> : null}
          {["unsupported", "unavailable", "stale", "scope", "error"].includes(impactState.status)
            ? <p className={styles.impactFailure} role="alert"><strong>Önizleme kapalı.</strong> {"message" in impactState ? impactState.message : ""}</p> : null}
          {impactState.status === "ready" ? <div className={styles.impactResult} role="status">
            <strong>Exact draft ve frozen kapsam doğrulandı</strong>
            <span>{impactState.result.binding.seriesRef} · {impactState.result.binding.ruleKind}</span>
            <span>{impactState.result.binding.evidenceRefs.length} kapsam kanıtı · {impactState.result.budgetPreview.proposal.alternatives.length} senaryo</span>
            <span>Kalıcı kayıt: yok · write operation: 0 · onay/execute/Meta write: kapalı</span>
            <button className={styles.save} type="button" disabled={!impactCommand}
              onClick={() => void saveAdvisoryDraft()}>Bu öneri taslağını kaydet</button>
            <small>Bu işlem yalnız exact kural–bütçe önerisi bağını kayıt altına alır. Policy yayınlamaz, onay oluşturmaz ve Meta’da değişiklik yapmaz.</small>
          </div> : null}
          {impactState.status === "saved" ? <div className={styles.impactResult} role="status">
            <strong>Öneri taslağı ve kural kaynağı birlikte kaydedildi</strong>
            <span>Proposal: {impactState.result.persistence} · provenance: {impactState.result.provenance}</span>
            <span>Onay · action · otomasyon · Meta write: kapalı</span>
          </div> : null}
          <div className={styles.impactResult} aria-label="Exact senaryo seçimi">
            <strong>Exact senaryo ve allocation seçimi</strong>
            <span>Yalnız sunucunun mevcut rule-linked öneriden türettiği tek allocation seçilir. Tarayıcı tutar, entity, kapsam, action veya approval göndermez.</span>
            {selection.status === "loading" ? <span>Seçilebilir senaryolar doğrulanıyor…</span> : null}
            {selection.status === "ready" && selection.candidates.length === 0 ? <span>Seçilebilir immutable senaryo yok.</span> : null}
            {selection.status === "ready" ? selection.candidates.map((candidate) => <div className={styles.row} key={candidate.candidateRef}>
              <span>{candidate.scenarioLabel} · {candidate.beforeAmountMinor} → {candidate.afterAmountMinor} {candidate.currency}{candidate.blockReason ? ` · ${candidate.blockReason.replaceAll("_", " ")}` : ""}</span>
              <button className={styles.save} type="button" disabled={candidate.status !== "selectable"} onClick={() => void selectScenario(candidate)}>{candidate.status === "selectable" ? "Bu senaryoyu seç" : "Seçim kapalı"}</button>
            </div>) : null}
            {selection.status === "selected" ? <span>Seçim kaydedildi: {selection.selectionRef.slice(0, 20)}… · {selection.persistence}. Approval, action ve Meta write kapalıdır.</span> : null}
            {(selection.status === "unavailable" || selection.status === "error") ? <span role="alert">{selection.message}</span> : null}
          </div>
          <div className={styles.impactResult} aria-label="İnsan onay kuyruğu">
            <strong>Seçilmiş senaryoyu insan onay kuyruğuna gönder</strong>
            <span>Yalnız seçilmiş immutable allocation kullanılır; tutar, kampanya, policy veya Meta kimliği tarayıcıdan gönderilmez.</span>
            {approvalQueue.status === "ready" && approvalQueue.actionPreparation.visible ? <span>Action preparation görünür, ancak execution varsayılan olarak kapalıdır ({approvalQueue.actionPreparation.reason}).</span> : null}
            {approvalQueue.status === "loading" ? <span>Seçilmiş senaryolar okunuyor…</span> : null}
            {approvalQueue.status === "ready" && approvalQueue.selections.length === 0 ? <span>Onaya gönderilecek seçilmiş senaryo yok.</span> : null}
            {approvalQueue.status === "ready" ? approvalQueue.selections.map((selection) => <div className={styles.row} key={selection.selectionRef}>
              <span>Seçim: {selection.selectionRef.slice(0, 20)}… · {date(selection.selectedAt)}</span>
              <button className={styles.save} type="button" onClick={() => void sendToApprovalQueue(selection)}>İnsan onay kuyruğuna gönder</button>
            </div>) : null}
            {approvalQueue.status === "queued" ? <span>Seçim onay kuyruğuna eklendi ({approvalQueue.persistence}). Onay kaydı için Onay Kuyruğu açıldı; execute ve Meta write hâlâ kapalıdır.</span> : null}
            {(approvalQueue.status === "unavailable" || approvalQueue.status === "error") ? <span role="alert">{approvalQueue.message}</span> : null}
          </div>
          <div className={styles.impactResult} aria-label="Karar izi">
            <strong>Karar izi</strong>
            <span>Selection → ActionUnit → insan kararı → execution closure zinciri salt okunurdur. Meta write kapalıdır.</span>
            {approvalQueue.status === "loading" ? <span>Karar izi doğrulanıyor…</span> : null}
            {approvalQueue.status === "ready" && approvalQueue.decisionTrace.length === 0 ? <span>Gösterilebilecek doğrulanmış karar izi yok.</span> : null}
            {approvalQueue.status === "ready" ? approvalQueue.decisionTrace.map((trace) => <div className={styles.row} key={trace.selectionRef}>
              <span>Seçim: {trace.selectionRef.slice(0, 20)}… · {date(trace.selectedAt)}</span>
              <span>ActionUnit: {trace.actionUnit.presence ? trace.actionUnit.status.replaceAll("_", " ") : "hazırlanmadı"}</span>
              <span>Kararlar: {trace.decisionHistory.length ? trace.decisionHistory.map((event) => `${event.decision.replaceAll("_", " ")} · ${date(event.occurredAt)}${event.reasonCode ? ` · ${event.reasonCode}` : ""}`).join(" | ") : "henüz yok"}</span>
              <span>Execution: {trace.execution.safetyState} · {trace.execution.closure.replaceAll("_", " ")}</span>
            </div>) : null}
            {(approvalQueue.status === "unavailable" || approvalQueue.status === "error") ? <span role="alert">Karar izi güvenli biçimde okunamadı.</span> : null}
          </div>
          <div className={styles.impactResult} aria-label="Zamansal değerlendirme">
            <strong>Zamansal değerlendirme</strong>
            <span>Yalnız sunucunun güncel kural başı, frozen campaign context’i ve hazır L3 penceresinden türettiği adaylar değerlendirilir.</span>
            {temporal.status === "loading" ? <span>Uygun pencereler doğrulanıyor…</span> : null}
            {temporal.status === "ready" && temporal.result ? <span role="status">{temporal.result}</span> : null}
            {temporal.status === "ready" && temporal.candidates.length === 0 ? <span>Şu anda değerlendirilebilir, hazır bir zaman penceresi yok.</span> : null}
            {temporal.status === "ready" ? temporal.candidates.map((candidate) => <div className={styles.row} key={candidate.candidateRef}>
              <span>{candidate.ruleSeriesRef} · {candidate.reviewCadence} · frozen pencere · {date(candidate.capturedAt)}</span>
              <button className={styles.save} type="button" onClick={() => void evaluateTemporal(candidate)}>Salt-okur değerlendir</button>
            </div>) : null}
            {(temporal.status === "unavailable" || temporal.status === "error") ? <span role="alert">{temporal.message}</span> : null}
            <small>Bu işlem policy yayınlamaz, ActionUnit oluşturmaz, onay/execute yetkisi vermez ve Meta’ya yazmaz. Sonuç ana operasyon timeline’ına immutable olay olarak eklenir.</small>
          </div>
        </section>
      </section>
    </div> : null}
  </div>;
}

export function SliceRuleWorkspacePanel({ onApprovalQueueHandoff }: Readonly<{ onApprovalQueueHandoff?(actionUnitRef: string): void }>) {
  const [state, setState] = useState<State>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/slice-rule-workspace", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "slice-rule-workspace-read" } });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setState({ status: response.status === 503 || response.status === 401 ? "unavailable" : "error",
          message: payload.error?.message ?? "Slice Rule Workspace yanıtı alınamadı." }); return;
      }
      setState({ status: "ready", snapshot: parseSliceRuleWorkspaceSnapshot(payload) });
    } catch { setState({ status: "error", message: "Slice Rule Workspace bağlantısı kurulamadı." }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <SliceRuleWorkspaceSurface state={state} onRetry={() => void load()} onSaved={load} onApprovalQueueHandoff={onApprovalQueueHandoff} />;
}

export { CLOSED as SLICE_RULE_CLOSED_AUTHORITY, EMPTY_FORM as EMPTY_SLICE_RULE_FORM };
