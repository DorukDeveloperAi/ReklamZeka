"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ExistingPostPromotionPreflightRequest,
  ExistingPostPromotionPreflightResult,
} from "@/application/existing-post-promotion-preflight-service";
import type { ExistingPostPromotionProposalResult } from "@/application/existing-post-promotion-proposal-service";
import {
  parseExistingPostPromotionCatalogResult,
  type ExistingPostPromotionCatalog as PromotionPreflightCatalog,
  type PromotionCatalogOption as PromotionPreflightOption,
} from "@/application/existing-post-promotion-catalog";
import {
  PROMOTION_TEMPLATE_AUTHORING_VERSION,
  type PromotionTemplateAuthoringDryRunEnvelope,
  type PromotionTemplateAuthoringInspection,
  type PromotionTemplateAuthoringSelection,
} from "@/application/promotion-template-authoring";
import {
  PROMOTION_TEMPLATE_LIFECYCLE_SERVICE_VERSION,
  type PromotionTemplateLifecycleCommand,
  type PromotionTemplateLifecyclePublicState,
} from "@/application/promotion-template-lifecycle-service";
import styles from "./operating-dashboard.module.css";

export type { PromotionPreflightCatalog, PromotionPreflightOption };

export type PromotionPreflightSurfaceState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>
  | Readonly<{
    status: "ready";
    catalog: PromotionPreflightCatalog;
    selection: Partial<ExistingPostPromotionPreflightRequest>;
    result: ExistingPostPromotionPreflightResult | null;
    evaluating: boolean;
    drafting?: boolean;
    draftResult?: ExistingPostPromotionProposalResult | null;
    message: string | null;
  }>;

type SelectionKey = keyof ExistingPostPromotionPreflightRequest;
type MutableSelection = { -readonly [K in SelectionKey]?: ExistingPostPromotionPreflightRequest[K] };
type ErrorEnvelope = Readonly<{ error?: Readonly<{ message?: string }> }>;
type PromotionTemplateAuthoringState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>
  | Readonly<{
    status: "ready";
    inspection: PromotionTemplateAuthoringInspection;
    selection: PromotionTemplateAuthoringSelection;
    result: PromotionTemplateAuthoringDryRunEnvelope["result"] | null;
    evaluating: boolean;
    message: string | null;
  }>;
type PromotionTemplateLifecycleEnvelope = Readonly<PromotionTemplateLifecyclePublicState & {
  contractVersion: typeof PROMOTION_TEMPLATE_LIFECYCLE_SERVICE_VERSION;
  authority: Readonly<{ canRead: true; canDraft: boolean; canRevise: boolean; canPublish: boolean;
    canArchive: boolean; canAuthorizeAction: false; canExecuteWrite: false; canWriteMeta: false; canGrantApproval: false }>;
}>;
type PromotionTemplateLifecycleState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; value: PromotionTemplateLifecycleEnvelope; alias: string; mutating: boolean;
      message: string | null }>;

const SAFE_REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const PROMOTION_SCOPE_REF = /^promotion_scope_[a-f0-9]{24}$/;
const HASH = /^[a-f0-9]{64}$/;
const ROLES = new Set(["owner", "admin", "analyst", "viewer"]);

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)));
}

function validAuthoringCapabilities(value: unknown): boolean {
  const keys = ["canRead", "canDryRun", "canPersistDraft", "canPublish", "canWriteMeta", "canChangeTargeting",
    "canGenerateCreative", "canProposeAction", "canGrantApproval"] as const;
  return exactObject(value, keys) && value.canRead === true && typeof value.canDryRun === "boolean"
    && keys.slice(2).every((key) => value[key] === false);
}

function validLifecycle(value: unknown): boolean {
  return exactObject(value, ["draftPersistence", "publishMutation", "blocker"])
    && value.draftPersistence === "unavailable" && value.publishMutation === "unavailable"
    && value.blocker === "immutable_registry_has_no_authoring_occ_audit_lifecycle";
}

function parsePromotionTemplateAuthoringInspection(value: unknown): PromotionTemplateAuthoringInspection {
  if (!exactObject(value, ["contractVersion", "catalog", "role", "capabilities", "lifecycle"])
    || value.contractVersion !== PROMOTION_TEMPLATE_AUTHORING_VERSION || typeof value.role !== "string" || !ROLES.has(value.role)
    || !validAuthoringCapabilities(value.capabilities) || !validLifecycle(value.lifecycle)
    || !exactObject(value.catalog, ["scopes"]) || !Array.isArray(value.catalog.scopes) || value.catalog.scopes.length > 100) {
    throw new Error("Güvenli PromotionTemplate authoring kataloğu doğrulanamadı.");
  }
  for (const scope of value.catalog.scopes) {
    if (!exactObject(scope, ["scopeRef", "label", "actorType", "categoryCount", "postTypes", "instructionAliases"])
      || typeof scope.scopeRef !== "string" || !PROMOTION_SCOPE_REF.test(scope.scopeRef)
      || typeof scope.label !== "string" || scope.label.length < 1 || scope.label.length > 120
      || !["page", "instagram"].includes(String(scope.actorType))
      || !Number.isSafeInteger(scope.categoryCount) || (scope.categoryCount as number) < 1
      || !Array.isArray(scope.postTypes) || scope.postTypes.length < 1
      || scope.postTypes.some((item) => !["image", "video", "carousel", "reel"].includes(String(item)))
      || !Array.isArray(scope.instructionAliases) || scope.instructionAliases.length < 1
      || scope.instructionAliases.some((item) => typeof item !== "string" || item.length < 1 || item.length > 80)) {
      throw new Error("Güvenli PromotionTemplate authoring kataloğu doğrulanamadı.");
    }
  }
  if (/"(?:targeting|accountRef|actorRef|internalCategoryRefs)"/.test(JSON.stringify(value.catalog))) {
    throw new Error("Güvenli PromotionTemplate authoring kataloğu doğrulanamadı.");
  }
  return value as unknown as PromotionTemplateAuthoringInspection;
}

function validSelectorCapabilities(value: unknown): boolean {
  const keys = ["canPublish", "canPersist", "canWriteMeta", "canChangeTargeting", "canGenerateCreative", "canProposeAction",
    "canGrantApproval"] as const;
  return exactObject(value, keys) && keys.every((key) => value[key] === false);
}

function parsePromotionTemplateAuthoringDryRun(value: unknown): PromotionTemplateAuthoringDryRunEnvelope {
  if (!exactObject(value, ["contractVersion", "result", "role", "capabilities", "lifecycle"])
    || value.contractVersion !== PROMOTION_TEMPLATE_AUTHORING_VERSION || typeof value.role !== "string" || !ROLES.has(value.role)
    || !validAuthoringCapabilities(value.capabilities)
    || (value.capabilities as Record<string, unknown>).canDryRun !== true || !validLifecycle(value.lifecycle)
    || !exactObject(value.result, ["version", "status", "dryRunOnly", "publishReady", "recommendation", "reasons", "questions",
      "capabilities", "selectionHash"])
    || value.result.version !== "promotion-template-selector/1.0.0"
    || !["recommended", "ambiguous", "unresolved"].includes(String(value.result.status))
    || value.result.dryRunOnly !== true || typeof value.result.publishReady !== "boolean"
    || typeof value.result.selectionHash !== "string" || !HASH.test(value.result.selectionHash)
    || !validSelectorCapabilities(value.result.capabilities)
    || !Array.isArray(value.result.reasons) || !Array.isArray(value.result.questions)) {
    throw new Error("Güvenli PromotionTemplate dry-run sözleşmesi doğrulanamadı.");
  }
  if (value.result.recommendation !== null) {
    const recommendation = value.result.recommendation;
    if (!exactObject(recommendation, ["promotionTemplate", "audiencePreset"])
      || !exactObject(recommendation.promotionTemplate, ["templateRef", "revision", "versionRef"])
      || !exactObject(recommendation.audiencePreset, ["presetRef", "revision", "versionRef"])
      || !SAFE_REF.test(String(recommendation.promotionTemplate.templateRef))
      || !SAFE_REF.test(String(recommendation.promotionTemplate.versionRef))
      || !Number.isSafeInteger(recommendation.promotionTemplate.revision)
      || !SAFE_REF.test(String(recommendation.audiencePreset.presetRef))
      || !SAFE_REF.test(String(recommendation.audiencePreset.versionRef))
      || !Number.isSafeInteger(recommendation.audiencePreset.revision)) {
      throw new Error("Güvenli PromotionTemplate dry-run sözleşmesi doğrulanamadı.");
    }
  }
  if (value.result.reasons.some((item) => !exactObject(item, ["code", "outcome", "candidateCount"]))
    || value.result.questions.some((item) => !exactObject(item, ["code", "field", "prompt"]))
    || /"(?:targeting|creative|accountRef|actorRef|internalCategoryRefs)"/.test(JSON.stringify(value))) {
    throw new Error("Güvenli PromotionTemplate dry-run sözleşmesi doğrulanamadı.");
  }
  return value as unknown as PromotionTemplateAuthoringDryRunEnvelope;
}

function parsePromotionTemplateLifecycle(value: unknown): PromotionTemplateLifecycleEnvelope {
  const rootKeys = ["contractVersion", "registryHash", "presetCurrent", "presetHistory", "templateCurrent",
    "templateHistory", "authority"] as const;
  const presetKeys = ["presetRef", "lifecycleVersion", "recordHash", "status", "presetRevision",
    "presetMaterialHash", "publishedPresetHash", "actorRole", "reasonCode", "recordedAt"] as const;
  const templateKeys = ["templateRef", "lifecycleVersion", "recordHash", "status", "presetRef", "presetRevision",
    "presetHash", "templateRevision", "templateMaterialHash", "publishedTemplateHash", "publishedBindingHash",
    "actorRole", "reasonCode", "recordedAt"] as const;
  const authorityKeys = ["canRead", "canDraft", "canRevise", "canPublish", "canArchive", "canAuthorizeAction",
    "canExecuteWrite", "canWriteMeta", "canGrantApproval"] as const;
  if (!exactObject(value, rootKeys) || value.contractVersion !== PROMOTION_TEMPLATE_LIFECYCLE_SERVICE_VERSION
    || typeof value.registryHash !== "string" || !HASH.test(value.registryHash)
    || !exactObject(value.authority, authorityKeys) || value.authority.canRead !== true
    || value.authority.canAuthorizeAction !== false || value.authority.canExecuteWrite !== false
    || value.authority.canWriteMeta !== false || value.authority.canGrantApproval !== false
    || ["canDraft", "canRevise", "canPublish", "canArchive"].some((key) =>
      typeof (value.authority as Record<string, unknown>)[key] !== "boolean")) throw new Error("Lifecycle sözleşmesi doğrulanamadı.");
  for (const [key, keys] of [["presetCurrent", presetKeys], ["presetHistory", presetKeys],
    ["templateCurrent", templateKeys], ["templateHistory", templateKeys]] as const) {
    const items = value[key];
    if (!Array.isArray(items) || items.length > 10_000 || items.some((item) => !exactObject(item, keys))) {
      throw new Error("Lifecycle sözleşmesi doğrulanamadı.");
    }
    const presetItems = key.startsWith("preset");
    for (const item of items as Record<string, unknown>[]) {
      const publishedHashes = presetItems ? [item.publishedPresetHash]
        : [item.publishedTemplateHash, item.publishedBindingHash];
      if (typeof item[presetItems ? "presetRef" : "templateRef"] !== "string"
        || !SAFE_REF.test(item[presetItems ? "presetRef" : "templateRef"] as string)
        || !Number.isSafeInteger(item.lifecycleVersion) || (item.lifecycleVersion as number) < 1
        || (item.lifecycleVersion as number) > 1_000_000 || typeof item.recordHash !== "string" || !HASH.test(item.recordHash)
        || !["draft", "published", "archived"].includes(String(item.status))
        || !Number.isSafeInteger(item.presetRevision) || (item.presetRevision as number) < 1
        || (item.presetRevision as number) > 1_000_000
        || typeof item[presetItems ? "presetMaterialHash" : "presetHash"] !== "string"
        || !HASH.test(item[presetItems ? "presetMaterialHash" : "presetHash"] as string)
        || !["owner", "admin", "analyst"].includes(String(item.actorRole))
        || typeof item.reasonCode !== "string" || !/^[a-z][a-z0-9_]{1,63}$/.test(item.reasonCode)
        || typeof item.recordedAt !== "string" || !Number.isFinite(Date.parse(item.recordedAt))
        || new Date(item.recordedAt).toISOString() !== item.recordedAt
        || publishedHashes.some((hash) => hash !== null && (typeof hash !== "string" || !HASH.test(hash)))) {
        throw new Error("Lifecycle sözleşmesi doğrulanamadı.");
      }
      if (!presetItems && (typeof item.presetRef !== "string" || !SAFE_REF.test(item.presetRef)
        || !Number.isSafeInteger(item.templateRevision) || (item.templateRevision as number) < 1
        || (item.templateRevision as number) > 1_000_000 || typeof item.templateMaterialHash !== "string"
        || !HASH.test(item.templateMaterialHash))) throw new Error("Lifecycle sözleşmesi doğrulanamadı.");
      if (item.status === "draft" && publishedHashes.some((hash) => hash !== null)
        || item.status === "published" && publishedHashes.some((hash) => hash === null)) {
        throw new Error("Lifecycle sözleşmesi doğrulanamadı.");
      }
    }
  }
  const serialized = JSON.stringify(value);
  if (/"(?:targeting|source|aliases|accountRefs|actorRef|internalCategoryRefs|budget|timeframe|publishedAt)"/.test(serialized)) {
    throw new Error("Lifecycle yanıtı güvenli özet sınırını aştı.");
  }
  return value as unknown as PromotionTemplateLifecycleEnvelope;
}

export async function requestPromotionTemplateLifecycle(fetcher: typeof fetch): Promise<PromotionTemplateLifecycleEnvelope> {
  const response = await fetcher("/api/promotion-template-authoring", { method: "GET", credentials: "same-origin",
    cache: "no-store", headers: { "X-ReklamZeka-Intent": "promotion-template-lifecycle-read" } });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(payload && typeof payload === "object" && "error" in payload
    ? (payload as ErrorEnvelope).error?.message ?? "Lifecycle okunamadı." : "Lifecycle okunamadı.");
  return parsePromotionTemplateLifecycle(payload);
}

export async function requestPromotionTemplateLifecycleMutation(fetcher: typeof fetch,
  command: PromotionTemplateLifecycleCommand): Promise<PromotionTemplateLifecycleEnvelope> {
  const lifecycleMutation = command.operation.startsWith("publish_") || command.operation.startsWith("archive_");
  const response = await fetcher("/api/promotion-template-authoring", { method: "POST", credentials: "same-origin",
    cache: "no-store", headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": lifecycleMutation
      ? "promotion-template-lifecycle-publish" : "promotion-template-lifecycle-draft" },
    body: JSON.stringify({ command }) });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(payload && typeof payload === "object" && "error" in payload
    ? (payload as ErrorEnvelope).error?.message ?? "Lifecycle değişikliği reddedildi." : "Lifecycle değişikliği reddedildi.");
  if (!exactObject(payload, ["contractVersion", "state", "auditAppended", "contextInvalidationAppended",
    "publishedMaterial", "authority"]) || payload.auditAppended !== true || !exactObject(payload.state,
      ["registryHash", "presetCurrent", "presetHistory", "templateCurrent", "templateHistory"])
    || typeof payload.contextInvalidationAppended !== "boolean" || typeof payload.publishedMaterial !== "boolean") {
    throw new Error("Lifecycle mutation kanıtı doğrulanamadı.");
  }
  const parsed = parsePromotionTemplateLifecycle({ contractVersion: payload.contractVersion, ...payload.state,
    authority: payload.authority });
  const publication = command.operation.startsWith("publish_");
  const archive = command.operation.startsWith("archive_");
  if (payload.publishedMaterial !== publication
    || payload.contextInvalidationAppended !== (publication || archive)
    || parsed.registryHash === command.expectedRegistryHash) throw new Error("Lifecycle mutation kanıtı doğrulanamadı.");
  if ("presetRef" in command) {
    const head = parsed.presetCurrent.find((item) => item.presetRef === command.presetRef);
    if (!head || publication && head.status !== "published" || archive && head.status !== "archived"
      || (publication || archive) && (!("reasonCode" in command) || head.reasonCode !== command.reasonCode)) {
      throw new Error("Lifecycle mutation kanıtı doğrulanamadı.");
    }
  }
  if ("templateRef" in command) {
    const head = parsed.templateCurrent.find((item) => item.templateRef === command.templateRef);
    if (!head || publication && head.status !== "published" || archive && head.status !== "archived"
      || (publication || archive) && (!("reasonCode" in command) || head.reasonCode !== command.reasonCode)) {
      throw new Error("Lifecycle mutation kanıtı doğrulanamadı.");
    }
  }
  return parsed;
}

export async function requestPromotionTemplateAuthoringCatalog(fetcher: typeof fetch): Promise<PromotionTemplateAuthoringInspection> {
  const response = await fetcher("/api/promotion-template-authoring", { method: "GET", credentials: "same-origin", cache: "no-store",
    headers: { "X-ReklamZeka-Intent": "promotion-template-authoring-read" } });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? (payload as ErrorEnvelope).error?.message : undefined;
    throw Object.assign(new Error(message ?? "PromotionTemplate authoring kataloğu alınamadı."), { unavailable: response.status === 503 });
  }
  return parsePromotionTemplateAuthoringInspection(payload);
}

export async function requestPromotionTemplateAuthoringDryRun(
  fetcher: typeof fetch,
  selection: PromotionTemplateAuthoringSelection,
): Promise<PromotionTemplateAuthoringDryRunEnvelope> {
  const response = await fetcher("/api/promotion-template-authoring", { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "promotion-template-authoring-dry-run" },
    body: JSON.stringify({ selection }) });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? (payload as ErrorEnvelope).error?.message : undefined;
    throw new Error(message ?? "PromotionTemplate dry-run tamamlanamadı.");
  }
  return parsePromotionTemplateAuthoringDryRun(payload);
}

const FIELDS: readonly Readonly<{
  key: SelectionKey;
  label: string;
  placeholder: string;
}>[] = [
  { key: "accountRef", label: "Reklam hesabı", placeholder: "Hesap seçin" },
  { key: "adSetRef", label: "Mevcut reklam seti", placeholder: "Reklam seti seçin" },
  { key: "actorRef", label: "Yayın kimliği", placeholder: "Page / Instagram seçin" },
  { key: "postRef", label: "Mevcut gönderi", placeholder: "Yayınlanmış gönderi seçin" },
  { key: "internalCategoryRef", label: "İç kampanya kategorisi", placeholder: "Kategori seçin" },
  { key: "objectiveRef", label: "Amaç", placeholder: "Amaç seçin" },
  { key: "promotionTemplateRef", label: "Yayınlanmış şablon", placeholder: "Şablon seçin" },
  { key: "audiencePresetRef", label: "Zorunlu hedef kitle preset’i", placeholder: "Şablonun preset’ini seçin" },
  { key: "budgetPlanRef", label: "Bütçe planı", placeholder: "Plan seçin" },
  { key: "timeframeRef", label: "Zaman aralığı", placeholder: "Timeframe seçin" },
] as const;

function optionsFor(
  catalog: PromotionPreflightCatalog,
  selection: Partial<ExistingPostPromotionPreflightRequest>,
  key: SelectionKey,
): readonly PromotionPreflightOption[] {
  if (key === "accountRef") return catalog.accounts;
  if (key === "adSetRef") return catalog.adSets.filter((item) => item.accountRef === selection.accountRef);
  if (key === "actorRef") return catalog.actors.filter((item) => item.accountRef === selection.accountRef);
  if (key === "postRef") return catalog.posts.filter((item) => item.actorRef === selection.actorRef);
  if (key === "internalCategoryRef") return catalog.internalCategories;
  if (key === "objectiveRef") return catalog.objectives;
  if (key === "promotionTemplateRef") return catalog.templates.filter((item) =>
    (!selection.accountRef || item.accountRefs.includes(selection.accountRef))
    && (!selection.actorRef || item.actorRefs.includes(selection.actorRef))
    && (!selection.internalCategoryRef || item.internalCategoryRefs.includes(selection.internalCategoryRef))
    && (!selection.objectiveRef || item.objectiveRefs.includes(selection.objectiveRef)));
  if (key === "audiencePresetRef") {
    const template = catalog.templates.find((item) => item.ref === selection.promotionTemplateRef);
    return template ? catalog.audiencePresets.filter((item) => item.ref === template.requiredAudiencePresetRef) : [];
  }
  if (key === "budgetPlanRef") return catalog.budgetPlans;
  return catalog.timeframes;
}

function isComplete(selection: Partial<ExistingPostPromotionPreflightRequest>): selection is ExistingPostPromotionPreflightRequest {
  return FIELDS.every((field) => typeof selection[field.key] === "string" && selection[field.key]!.length > 0);
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
}

function timestamp(value: string, timezone: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

export async function requestExistingPostPromotionPreflight(
  fetcher: typeof fetch,
  selection: ExistingPostPromotionPreflightRequest,
): Promise<ExistingPostPromotionPreflightResult> {
  const response = await fetcher("/api/existing-post-promotion-preflight", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-ReklamZeka-Intent": "existing-post-promotion-preflight",
    },
    body: JSON.stringify({ selection }),
  });
  const payload = await response.json() as Readonly<{
    contractVersion?: unknown;
    result?: ExistingPostPromotionPreflightResult;
    authority?: Readonly<{ canPersist?: unknown; canApprove?: unknown; canExecute?: unknown; canWriteMeta?: unknown; canGenerateCreative?: unknown }>;
  }> | ErrorEnvelope;
  if (!response.ok || !("result" in payload) || !payload.result || !("authority" in payload) || !payload.authority) {
    const message = "error" in payload ? payload.error?.message : undefined;
    throw new Error(message ?? "Öne çıkarma ön kontrolü tamamlanamadı.");
  }
  const selectionMatches = Object.entries(selection).every(([key, value]) =>
    payload.result?.selection[key as keyof ExistingPostPromotionPreflightRequest] === value);
  if (payload.contractVersion !== "existing-post-promotion-agent/1.0.0" || !selectionMatches
    || payload.result.authority.ephemeral !== true || payload.result.authority.canPersistProposal !== false
    || payload.result.authority.canApprove !== false || payload.result.authority.canExecute !== false
    || payload.result.authority.canWriteMeta !== false || payload.result.authority.canGenerateCreative !== false
    || payload.authority.canPersist !== false
    || payload.authority.canApprove !== false || payload.authority.canWriteMeta !== false
    || payload.authority.canExecute !== false || payload.authority.canGenerateCreative !== false) {
    throw new Error("Güvenli preflight sözleşmesi doğrulanamadı.");
  }
  return payload.result;
}

export async function requestExistingPostPromotionProposalDraft(
  fetcher: typeof fetch,
  selection: ExistingPostPromotionPreflightRequest,
): Promise<ExistingPostPromotionProposalResult> {
  const response = await fetcher("/api/existing-post-promotion-preflight", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-ReklamZeka-Intent": "existing-post-promotion-proposal-draft",
    },
    body: JSON.stringify({ selection }),
  });
  const payload = await response.json() as Readonly<{
    contractVersion?: unknown;
    result?: ExistingPostPromotionProposalResult;
    authority?: Readonly<Record<string, unknown>>;
    error?: Readonly<{ message?: string }>;
  }>;
  const result = payload.result;
  const authority = payload.authority;
  const ref = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
  const resultAuthority = result?.authority;
  const exactKeys = (value: unknown, keys: readonly string[]) => Boolean(value && typeof value === "object"
    && !Array.isArray(value) && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key)));
  if (!response.ok || !exactKeys(payload, ["contractVersion", "result", "authority"])
    || payload.contractVersion !== "existing-post-promotion-draft/1.0.0" || !result || !authority
    || !exactKeys(result, ["contractVersion", "outcome", "proposalRef", "actionUnitRefs", "preflightRef", "disposition", "risk", "authority"])
    || !exactKeys(authority, ["canApprove", "canExecute", "canWriteMeta", "canGenerateCreative", "canChangeTargeting"])
    || !exactKeys(resultAuthority, ["canApprove", "canExecute", "canWriteMeta", "canGenerateCreative", "canChangeTargeting"])
    || result.contractVersion !== "existing-post-promotion-proposal/2.0.0"
    || !["inserted", "unchanged"].includes(result.outcome) || !ref.test(result.proposalRef)
    || !Array.isArray(result.actionUnitRefs) || result.actionUnitRefs.length !== 1 || !ref.test(result.actionUnitRefs[0]!)
    || !ref.test(result.preflightRef) || result.disposition !== "approval_required" || result.risk !== "K4"
    || authority.canApprove !== false || authority.canExecute !== false || authority.canWriteMeta !== false
    || authority.canGenerateCreative !== false || authority.canChangeTargeting !== false
    || !resultAuthority || resultAuthority.canApprove !== false || resultAuthority.canExecute !== false
    || resultAuthority.canWriteMeta !== false || resultAuthority.canGenerateCreative !== false
    || resultAuthority.canChangeTargeting !== false) {
    if (!response.ok) throw new Error(payload.error?.message ?? "Öneri taslağı oluşturulamadı.");
    throw new Error("Güvenli öneri taslağı sözleşmesi doğrulanamadı.");
  }
  return result;
}

export async function requestExistingPostPromotionCatalog(fetcher: typeof fetch): Promise<PromotionPreflightCatalog> {
  const response = await fetcher("/api/existing-post-promotion-preflight", {
    method: "GET", credentials: "same-origin", cache: "no-store",
    headers: { "X-ReklamZeka-Intent": "existing-post-promotion-catalog-read" },
  });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? (payload as ErrorEnvelope).error?.message : undefined;
    throw Object.assign(new Error(message ?? "Öne çıkarma seçim kataloğu alınamadı."), { unavailable: response.status === 503 });
  }
  return parseExistingPostPromotionCatalogResult(payload).catalog;
}

function catalogHasSelections(catalog: PromotionPreflightCatalog) {
  return catalog.accounts.length > 0 && catalog.actors.length > 0 && catalog.posts.length > 0 && catalog.templates.length > 0
    && catalog.audiencePresets.length > 0 && catalog.internalCategories.length > 0 && catalog.objectives.length > 0
    && catalog.adSets.length > 0 && catalog.budgetPlans.length > 0 && catalog.timeframes.length > 0;
}

export function PromotionTemplateAuthoringSurface(props: Readonly<{
  state: PromotionTemplateAuthoringState;
  onRetry(): void;
  onChange(selection: PromotionTemplateAuthoringSelection): void;
  onEvaluate(): void;
}>) {
  const ready = props.state.status === "ready" ? props.state : null;
  const scope = ready?.inspection.catalog.scopes.find((item) => item.scopeRef === ready.selection.scopeRef) ?? null;
  const complete = Boolean(ready?.selection.scopeRef && ready.selection.postType && ready.selection.instruction);
  return <section className={`${styles.panel} ${styles.promotionPreflightForm}`} aria-label="PromotionTemplate authoring dry-run">
    <header className={styles.panelHeader}><div><span className={styles.kicker}>PUBLISHED TEMPLATE AUTHORING · DRY-RUN</span><h2>Alias ve talimattan güvenli şablon önerisi</h2></div><span className={styles.readOnlyBadge}>NO PUBLISH · NO META WRITE</span></header>
    <p>Hesap, Page/Instagram ve iç kategori sunucunun yayınlanmış kapsamından çözülür. Form workspace, kullanıcı, ham Meta ID, hedefleme veya creative malzemesi kabul etmez.</p>
    {props.state.status === "loading" ? <p role="status">Yayınlanmış şablon kapsamları doğrulanıyor…</p> : null}
    {props.state.status === "unavailable" || props.state.status === "error" ? <div role="alert"><strong>{props.state.message}</strong><p>Güvenilir katalog olmadan şablon veya hedef kitle uydurulmaz.</p><button onClick={props.onRetry}>Tekrar kontrol et</button></div> : null}
    {ready ? <>
      <div className={styles.promotionPreflightFields}>
        <label><span>Yayınlanmış kapsam</span><select aria-label="Yayınlanmış template kapsamı" value={ready.selection.scopeRef ?? ""}
          disabled={ready.evaluating || ready.inspection.catalog.scopes.length === 0 || !ready.inspection.capabilities.canDryRun}
          onChange={(event) => props.onChange({ scopeRef: event.target.value || null, postType: null, instruction: null })}>
          <option value="">{ready.inspection.catalog.scopes.length ? "Kapsam seçin" : "Yayınlanmış kapsam yok"}</option>
          {ready.inspection.catalog.scopes.map((item) => <option key={item.scopeRef} value={item.scopeRef}>{item.label}</option>)}
        </select></label>
        <label><span>Gönderi / medya tipi</span><select aria-label="Promotion medya tipi" value={ready.selection.postType ?? ""}
          disabled={ready.evaluating || !scope || !ready.inspection.capabilities.canDryRun}
          onChange={(event) => props.onChange({ ...ready.selection,
            postType: (event.target.value || null) as PromotionTemplateAuthoringSelection["postType"] })}>
          <option value="">Medya tipi seçin</option>{scope?.postTypes.map((item) => <option key={item} value={item}>{item}</option>)}
        </select></label>
        <label><span>Yayınlanmış alias / talimat</span><input aria-label="Promotion template alias veya talimatı"
          list="promotion-template-authoring-aliases" value={ready.selection.instruction ?? ""} maxLength={500}
          disabled={ready.evaluating || !scope || !ready.inspection.capabilities.canDryRun}
          placeholder="Yayınlanmış alias veya açık talimat"
          onChange={(event) => props.onChange({ ...ready.selection, instruction: event.target.value || null })} />
          <datalist id="promotion-template-authoring-aliases">{scope?.instructionAliases.map((alias) => <option key={alias} value={alias} />)}</datalist>
        </label>
      </div>
      <footer><p>{ready.inspection.role === "viewer" ? "Viewer rolü salt okunurdur; dry-run başlatamaz."
        : "Bu deterministik seçim önizlemesidir; lifecycle taslak/yayın işlemleri aşağıdaki ayrı OCC ve audit sınırındadır."}</p>
        <button disabled={!complete || ready.evaluating || !ready.inspection.capabilities.canDryRun}
          onClick={props.onEvaluate}>{ready.evaluating ? "Çözülüyor…" : "Template dry-run çalıştır"}</button></footer>
      {ready.message ? <p className={styles.promotionPreflightMessage} role="alert">{ready.message}</p> : null}
      {ready.result ? <div className={styles.promotionPreflightPreview} role="status">
        <header><div><span className={styles.kicker}>DETERMINISTIC RESULT</span><h2>{ready.result.status === "recommended"
          ? "Tek yayınlanmış eşleşme bulundu" : ready.result.status === "ambiguous" ? "Alias belirsiz" : "Eksik veya desteklenmeyen gerçek var"}</h2></div>
          <span data-status={ready.result.status}>{ready.result.status}</span></header>
        {ready.result.recommendation ? <dl className={styles.promotionPreflightFacts}>
          <div><dt>PromotionTemplate</dt><dd>{ready.result.recommendation.promotionTemplate.versionRef}</dd></div>
          <div><dt>Immutable AudiencePreset</dt><dd>{ready.result.recommendation.audiencePreset.versionRef}</dd></div>
        </dl> : <div className={styles.promotionPreflightReasons}>{ready.result.questions.map((item) =>
          <p key={`${item.code}:${item.field}`}><span>{item.field}</span><strong>{item.prompt}</strong><i data-disposition="blocked">blocked</i></p>)}</div>}
        <footer><span>Dry-run persist: kapalı</span><span>Lifecycle: ayrı guard</span><span>Meta write: kapalı</span><span>Targeting/creative: kapalı</span></footer>
      </div> : null}
    </> : null}
  </section>;
}

export function PromotionTemplateLifecycleSurface(props: Readonly<{
  state: PromotionTemplateLifecycleState;
  selection: PromotionTemplateAuthoringSelection | null;
  recommended: boolean;
  onAlias(value: string): void;
  onMutate(command: PromotionTemplateLifecycleCommand): void;
  onRetry(): void;
}>) {
  if (props.state.status === "loading") return <section className={styles.panel} aria-label="PromotionTemplate lifecycle" role="status">
    <strong>Template/preset lifecycle doğrulanıyor…</strong></section>;
  if (props.state.status === "error") return <section className={styles.panel} aria-label="PromotionTemplate lifecycle" role="alert">
    <strong>{props.state.message}</strong><button onClick={props.onRetry}>Tekrar kontrol et</button></section>;
  const { value, alias, mutating, message } = props.state;
  const usablePresets = value.presetHistory.filter((item) => item.status === "published" && item.publishedPresetHash
    && value.presetCurrent.find((head) => head.presetRef === item.presetRef)?.status !== "archived")
    .sort((left, right) => right.lifecycleVersion - left.lifecycleVersion);
  const selectedPreset = usablePresets[0] ?? null;
  const selection = props.selection;
  const createReady = props.recommended && Boolean(selection?.scopeRef && selection.postType && selection.instruction)
    && alias.trim().length > 0;
  const presetOcc = (item: PromotionTemplateLifecycleEnvelope["presetCurrent"][number]) => ({
    expectedRegistryHash: value.registryHash, presetRef: item.presetRef, expectedLifecycleVersion: item.lifecycleVersion,
    expectedRecordHash: item.recordHash, expectedPresetRevision: item.presetRevision,
    expectedPresetHash: item.presetMaterialHash,
  });
  const templateOcc = (item: PromotionTemplateLifecycleEnvelope["templateCurrent"][number]) => ({
    expectedRegistryHash: value.registryHash, templateRef: item.templateRef, expectedLifecycleVersion: item.lifecycleVersion,
    expectedRecordHash: item.recordHash, expectedPresetRevision: item.presetRevision, expectedPresetHash: item.presetHash,
    expectedTemplateRevision: item.templateRevision, expectedTemplateHash: item.templateMaterialHash,
  });
  return <section className={`${styles.panel} ${styles.promotionPreflightForm}`} aria-label="PromotionTemplate lifecycle">
    <header className={styles.panelHeader}><div><span className={styles.kicker}>AUTHORING LIFECYCLE · OCC + AUDIT</span>
      <h2>Mutable template, immutable audience preset</h2></div><span className={styles.readOnlyBadge}>NO META WRITE</span></header>
    <p>Taslaklar yayın yetkisi taşımaz. Analyst taslak/revise edebilir; yalnız owner/admin immutable sürüm yayınlayabilir veya arşivleyebilir.</p>
    <label><span>Yeni alias</span><input aria-label="Lifecycle alias" value={alias} maxLength={80} disabled={mutating || !value.authority.canDraft}
      onChange={(event) => props.onAlias(event.target.value)} /></label>
    <div><button disabled={!createReady || mutating || !value.authority.canDraft} onClick={() => props.onMutate({
      operation: "create_preset_draft", expectedRegistryHash: value.registryHash, selection: selection!, alias: alias.trim(),
    })}>AudiencePreset taslağı oluştur</button>
    <button disabled={!createReady || !selectedPreset || mutating || !value.authority.canDraft} onClick={() => props.onMutate({
      operation: "create_template_draft", expectedRegistryHash: value.registryHash, selection: selection!, alias: alias.trim(),
      audiencePreset: { presetRef: selectedPreset!.presetRef, revision: selectedPreset!.presetRevision,
        presetHash: selectedPreset!.publishedPresetHash! },
    })}>PromotionTemplate taslağı oluştur</button></div>
    {message ? <p role="alert">{message}</p> : null}
    <div className={styles.promotionPreflightReasons}>
      {value.presetCurrent.map((item) => <p key={item.presetRef}><span>AudiencePreset v{item.presetRevision}</span>
        <strong>{item.presetRef} · {item.status}</strong><i>{item.reasonCode}</i>
        {item.status === "draft" ? <><button disabled={mutating || !value.authority.canRevise || !alias.trim()}
          onClick={() => props.onMutate({ operation: "revise_preset_draft", ...presetOcc(item), alias: alias.trim() })}>Revise</button>
          <button disabled={mutating || !value.authority.canPublish}
            onClick={() => props.onMutate({ operation: "publish_preset", ...presetOcc(item), reasonCode: "owner_publish" })}>Publish</button></> : null}
        {item.status !== "archived" ? <button disabled={mutating || !value.authority.canArchive}
          onClick={() => props.onMutate({ operation: "archive_preset", ...presetOcc(item), reasonCode: "owner_archive" })}>Archive</button> : null}
      </p>)}
      {value.templateCurrent.map((item) => <p key={item.templateRef}><span>PromotionTemplate v{item.templateRevision}</span>
        <strong>{item.templateRef} · {item.status}</strong><i>preset {item.presetRef}@{item.presetRevision}</i>
        {item.status === "draft" ? <><button disabled={mutating || !value.authority.canRevise || !alias.trim() || !selectedPreset}
          onClick={() => props.onMutate({ operation: "revise_template_draft", ...templateOcc(item), alias: alias.trim(),
            audiencePreset: { presetRef: selectedPreset!.presetRef, revision: selectedPreset!.presetRevision,
              presetHash: selectedPreset!.publishedPresetHash! } })}>Revise</button>
          <button disabled={mutating || !value.authority.canPublish}
            onClick={() => props.onMutate({ operation: "publish_template", ...templateOcc(item), reasonCode: "owner_publish" })}>Publish</button></> : null}
        {item.status !== "archived" ? <button disabled={mutating || !value.authority.canArchive}
          onClick={() => props.onMutate({ operation: "archive_template", ...templateOcc(item), reasonCode: "owner_archive" })}>Archive</button> : null}
      </p>)}
      {value.presetCurrent.length + value.templateCurrent.length === 0 ? <p><strong>Henüz lifecycle kaydı yok.</strong></p> : null}
    </div>
    <footer><span>Audit: zorunlu</span><span>OCC: exact hash/version</span><span>Approval: yok</span><span>Meta write: yok</span></footer>
  </section>;
}

function PromotionTemplateAuthoringPanel() {
  const [state, setState] = useState<PromotionTemplateAuthoringState>({ status: "loading" });
  const [lifecycle, setLifecycle] = useState<PromotionTemplateLifecycleState>({ status: "loading" });
  const loadLifecycle = useCallback(async () => {
    setLifecycle({ status: "loading" });
    try { setLifecycle({ status: "ready", value: await requestPromotionTemplateLifecycle(fetch), alias: "", mutating: false,
      message: null }); }
    catch (error) { setLifecycle({ status: "error", message: error instanceof Error ? error.message : "Lifecycle okunamadı." }); }
  }, []);
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const inspection = await requestPromotionTemplateAuthoringCatalog(fetch);
      setState({ status: "ready", inspection, selection: { scopeRef: null, postType: null, instruction: null },
        result: null, evaluating: false, message: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PromotionTemplate authoring kataloğu alınamadı.";
      setState({ status: error && typeof error === "object" && "unavailable" in error ? "unavailable" : "error", message });
    }
  }, []);
  useEffect(() => { void load(); void loadLifecycle(); }, [load, loadLifecycle]);
  const evaluate = useCallback(async () => {
    if (state.status !== "ready" || !state.inspection.capabilities.canDryRun) return;
    setState((current) => current.status === "ready" ? { ...current, evaluating: true, result: null, message: null } : current);
    try {
      const envelope = await requestPromotionTemplateAuthoringDryRun(fetch, state.selection);
      setState((current) => current.status === "ready" ? { ...current, evaluating: false, result: envelope.result, message: null } : current);
    } catch (error) {
      setState((current) => current.status === "ready" ? { ...current, evaluating: false, result: null,
        message: error instanceof Error ? error.message : "PromotionTemplate dry-run tamamlanamadı." } : current);
    }
  }, [state]);
  const mutateLifecycle = useCallback(async (command: PromotionTemplateLifecycleCommand) => {
    setLifecycle((current) => current.status === "ready" ? { ...current, mutating: true, message: null } : current);
    try {
      const value = await requestPromotionTemplateLifecycleMutation(fetch, command);
      setLifecycle((current) => ({ status: "ready", value, alias: current.status === "ready" ? current.alias : "",
        mutating: false, message: "Lifecycle kaydı audit ile eklendi." }));
    } catch (error) { setLifecycle((current) => current.status === "ready" ? { ...current, mutating: false,
      message: error instanceof Error ? error.message : "Lifecycle değişikliği reddedildi." } : current); }
  }, []);
  return <><PromotionTemplateAuthoringSurface state={state} onRetry={() => void load()}
    onChange={(selection) => setState((current) => current.status === "ready"
      ? { ...current, selection, result: null, message: null } : current)} onEvaluate={() => void evaluate()} />
    <PromotionTemplateLifecycleSurface state={lifecycle}
      selection={state.status === "ready" ? state.selection : null}
      recommended={state.status === "ready" && state.result?.status === "recommended"}
      onAlias={(alias) => setLifecycle((current) => current.status === "ready" ? { ...current, alias, message: null } : current)}
      onMutate={(command) => void mutateLifecycle(command)} onRetry={() => void loadLifecycle()} /></>;
}

export function PromotionPreflightSurface(props: Readonly<{
  state: PromotionPreflightSurfaceState;
  onRetry(): void;
  onChange(key: SelectionKey, value: string): void;
  onEvaluate(): void;
  onDraft(): void;
}>) {
  const ready = props.state.status === "ready" ? props.state : null;
  const preview = ready?.result?.proposalPreview ?? null;
  return <>
    <section className={styles.pageHero}>
      <div><span className={styles.kicker}>EXISTING POST PROMOTION · K4 PREFLIGHT</span><h1>Mevcut gönderiyi, kilitli şablon ve hedef kitleyle değerlendirin.</h1><p>Yalnız yayınlanmış Page/Instagram gönderileri ve sunucunun sunduğu referanslar kullanılabilir. Ön kontrol kendiliğinden taslak kaydetmez; ayrı komut yalnız K4 onay kuyruğu taslağı oluşturabilir. Kreatif üretme, hedef kitle değiştirme, onaylama ve Meta write kapalıdır.</p></div>
      <span className={styles.readOnlyBadge}>EPHEMERAL · APPROVAL REQUIRED</span>
    </section>
    {props.state.status === "loading" ? <section className={`${styles.panel} ${styles.promotionPreflightState}`} role="status"><strong>Kaynak doğrulanıyor</strong><h2>Yayınlanmış şablonlar ve mevcut gönderiler bekleniyor.</h2><p>Serbest ID, ham targeting veya kreatif alanı açılmaz.</p></section> : null}
    {props.state.status === "unavailable" ? <section className={`${styles.panel} ${styles.promotionPreflightState}`} role="alert"><strong>Kaynak henüz bağlı değil</strong><h2>{props.state.message}</h2><p>Güvenilir seçenek kataloğu olmadan gönderi, hesap, şablon veya hedef kitle uydurulmaz. Meta write ve proposal persistence kapalı kalır.</p><button onClick={props.onRetry}>Tekrar kontrol et</button></section> : null}
    {props.state.status === "error" ? <section className={`${styles.panel} ${styles.promotionPreflightState}`} role="alert"><strong>Preflight okunamadı</strong><h2>{props.state.message}</h2><p>Kısmi veya sözleşme dışı yanıtlar formu açmaz.</p><button onClick={props.onRetry}>Tekrar dene</button></section> : null}
    {ready && !catalogHasSelections(ready.catalog) ? <section className={`${styles.panel} ${styles.promotionPreflightState}`}><strong>Kaynak bağlı · katalog boş</strong><h2>Bu çalışma alanında henüz uygun öne çıkarma seçimi bulunmuyor.</h2><p>Yayınlanmış şablon, immutable preset ve mevcut gönderi tamamlanmadan form açılmaz.</p></section> : null}
    {ready && catalogHasSelections(ready.catalog) ? <div className={styles.promotionPreflightWorkspace}>
      <section className={`${styles.panel} ${styles.promotionPreflightForm}`} aria-label="Mevcut gönderi öne çıkarma seçimi">
        <header className={styles.panelHeader}><div><span className={styles.kicker}>GUIDED SELECTION</span><h2>Sunucu tarafından doğrulanan seçimler</h2></div><span>Ref-only</span></header>
        <div className={styles.promotionPreflightFields}>{FIELDS.map((field) => {
          const options = optionsFor(ready.catalog, ready.selection, field.key);
          return <label key={field.key}><span>{field.label}</span><select aria-label={field.label} value={ready.selection[field.key] ?? ""} disabled={ready.evaluating || options.length === 0} onChange={(event) => props.onChange(field.key, event.target.value)}><option value="">{options.length ? field.placeholder : "Uygun seçenek yok"}</option>{options.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}</select></label>;
        })}</div>
        <footer><p>Hedef kitle preset’i şablon tarafından zorunlu tutulur; geo, yaş, dil, ilgi alanı ve hariç tutmalar burada düzenlenemez.</p><button disabled={!isComplete(ready.selection) || ready.evaluating} onClick={props.onEvaluate}>{ready.evaluating ? "Kontrol ediliyor…" : "K4 ön kontrolünü çalıştır"}</button></footer>
        {ready.message ? <p className={styles.promotionPreflightMessage} role="alert">{ready.message}</p> : null}
      </section>
      <section className={`${styles.panel} ${styles.promotionPreflightPreview}`} aria-label="Öne çıkarma ön kontrol sonucu">
        {!ready.result ? <div className={styles.promotionPreflightPlaceholder}><strong>Henüz değerlendirilmedi</strong><h2>Exact before → after özeti burada görünür.</h2><p>Bu özet bir teklif kaydı veya Meta değişikliği değildir.</p></div> : <>
          <header><div><span className={styles.kicker}>COMPATIBILITY & GUIDANCE</span><h2>{ready.result.status === "ready_for_approval_proposal" ? "Onay önerisine hazırlanabilir" : ready.result.status === "blocked" ? "Kurallar nedeniyle engellendi" : "İnsan incelemesi gerekiyor"}</h2></div><span data-status={ready.result.status}>{ready.result.status}</span></header>
          {ready.result.reasons.length ? <div className={styles.promotionPreflightReasons}>{ready.result.reasons.map((item) => <p key={`${item.source}:${item.code}`}><span>{item.source}</span><strong>{item.code}</strong><i data-disposition={item.disposition}>{item.disposition}</i></p>)}</div> : <p className={styles.promotionPreflightClear}>Şablon, preset, Meta uygunluğu ve aktif guidance kontrollerinde engel bulunmadı.</p>}
          {preview ? <div className={styles.promotionBeforeAfter}><div><span>Önce</span><strong>Mevcut gönderi · değişmez</strong><small>{ready.selection.postRef}</small></div><b>→</b><div><span>Sonra</span><strong>K4 reklam önerisi · approval_required</strong><small>{preview.actorType} · {money(preview.budget.amountMinor, preview.budget.currency)} / {preview.budget.kind === "daily" ? "gün" : "dönem"}</small></div></div> : null}
          {preview ? <dl className={styles.promotionPreflightFacts}><div><dt>Şablon</dt><dd>{ready.selection.promotionTemplateRef}</dd></div><div><dt>Immutable preset</dt><dd>{ready.selection.audiencePresetRef}</dd></div><div><dt>Timeframe</dt><dd>{timestamp(preview.timeframe.startAt, preview.timeframe.timezone)}{preview.timeframe.endAt ? ` → ${timestamp(preview.timeframe.endAt, preview.timeframe.timezone)} · ${preview.timeframe.durationDays} gün` : " → sürekli"}</dd></div><div><dt>Risk / durum</dt><dd>{preview.risk} · {preview.disposition}</dd></div></dl> : null}
          {preview && !ready.draftResult ? <button disabled={ready.drafting} onClick={props.onDraft}>{ready.drafting ? "Taslak oluşturuluyor…" : "Tek ActionUnit onay taslağı oluştur"}</button> : null}
          {ready.draftResult ? <div className={styles.promotionPreflightClear} role="status"><strong>Onay kuyruğu taslağı hazır</strong><p>{ready.draftResult.proposalRef} · {ready.draftResult.actionUnitRefs[0]} · {ready.draftResult.outcome}</p></div> : null}
          <footer><span>Preflight persist: kapalı</span><span>Approval: kapalı</span><span>Execute: kapalı</span><span>Meta write: kapalı</span><span>Creative generation: kapalı</span></footer>
        </>}
      </section>
    </div> : null}
  </>;
}

export function PromotionPreflightPanel() {
  const [state, setState] = useState<PromotionPreflightSurfaceState>({ status: "loading" });
  const selection = state.status === "ready" ? state.selection : {};
  const requiredPreset = useMemo(() => {
    if (state.status !== "ready") return null;
    return state.catalog.templates.find((item) => item.ref === state.selection.promotionTemplateRef)?.requiredAudiencePresetRef ?? null;
  }, [state]);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const catalog = await requestExistingPostPromotionCatalog(fetch);
      setState({ status: "ready", catalog, selection: {}, result: null, evaluating: false, drafting: false, draftResult: null, message: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Öne çıkarma seçim kataloğu alınamadı.";
      setState({ status: error && typeof error === "object" && "unavailable" in error ? "unavailable" : "error", message });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const change = useCallback((key: SelectionKey, value: string) => {
    setState((current) => {
      if (current.status !== "ready") return current;
      const next: MutableSelection = { ...current.selection, [key]: value || undefined };
      if (key === "accountRef") { delete next.adSetRef; delete next.actorRef; delete next.postRef; delete next.promotionTemplateRef; delete next.audiencePresetRef; }
      if (key === "actorRef") { delete next.postRef; delete next.promotionTemplateRef; delete next.audiencePresetRef; }
      if (key === "internalCategoryRef" || key === "objectiveRef") { delete next.promotionTemplateRef; delete next.audiencePresetRef; }
      if (key === "promotionTemplateRef") {
        const template = current.catalog.templates.find((item) => item.ref === value);
        next.audiencePresetRef = template?.requiredAudiencePresetRef;
      }
      return { ...current, selection: next, result: null, draftResult: null, message: null };
    });
  }, []);

  const evaluate = useCallback(async () => {
    if (state.status !== "ready" || !isComplete(selection) || requiredPreset !== selection.audiencePresetRef) return;
    setState((current) => current.status === "ready" ? { ...current, evaluating: true, message: null } : current);
    try {
      const result = await requestExistingPostPromotionPreflight(fetch, selection);
      setState((current) => current.status === "ready" ? { ...current, evaluating: false, result, message: null } : current);
    } catch (error) {
      setState((current) => current.status === "ready" ? { ...current, evaluating: false, result: null, message: error instanceof Error ? error.message : "Preflight tamamlanamadı." } : current);
    }
  }, [requiredPreset, selection, state.status]);

  const draft = useCallback(async () => {
    if (state.status !== "ready" || state.result?.status !== "ready_for_approval_proposal"
      || !state.result.proposalPreview || !isComplete(selection)) return;
    setState((current) => current.status === "ready" ? { ...current, drafting: true, message: null } : current);
    try {
      const draftResult = await requestExistingPostPromotionProposalDraft(fetch, selection);
      setState((current) => current.status === "ready" ? { ...current, drafting: false, draftResult, message: null } : current);
    } catch (error) {
      setState((current) => current.status === "ready" ? { ...current, drafting: false,
        message: error instanceof Error ? error.message : "Öneri taslağı oluşturulamadı." } : current);
    }
  }, [selection, state]);

  return <><PromotionTemplateAuthoringPanel /><PromotionPreflightSurface state={state} onRetry={() => void load()} onChange={change}
    onEvaluate={() => void evaluate()} onDraft={() => void draft()} /></>;
}
