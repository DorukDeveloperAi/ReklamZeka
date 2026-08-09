"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./starter-category-adoption.module.css";

type BlockerCode = "atomic_multi_command_category_adoption_unavailable" | "category_profile_registry_unavailable"
  | "owner_configuration_required" | "incompatible_existing_dimension";
type Plan = Readonly<{ contractVersion: "starter-category-adoption/1.0.0";
  catalogVersion: "starter-category-playbooks/1.1.0"; catalogHash: string;
  registryHash: string; planHash: string; status: "preview_only" | "blocked"; summary: Readonly<{ canonicalDimensions: 14;
    dimensionsToCreate: number; definitionsToCreate: number; profileProposals: number; satisfied: number;
    conflicts: number; ownerConfigurationRequired: number }>;
  dimensionCoverage: readonly Readonly<{ dimensionKey: string; disposition: "create" | "satisfied" | "conflict";
    reasonCode: "missing" | "already_present" | "incompatible_existing_definition" }>[];
  categoryCommands: readonly unknown[]; profileProposals: readonly unknown[];
  blockers: readonly Readonly<{ code: BlockerCode; refs: readonly string[] }>[]; ownerConfirmationRequired: true;
  confirmationLiteral: "adopt_starter_category_playbook";
  authority: Readonly<{ canPersist: false; canConfirm: boolean; canAuthorizeAction: false;
    canWriteMeta: false; canPublishPolicy: false }> }>;
const HASH = /^[a-f0-9]{64}$/;
const DIMENSIONS = ["service_line", "brand_clinic", "geo_market", "language", "campaign_role", "funnel_intent",
  "audience_strategy", "destination", "budget_pool", "operating_mode", "lifecycle", "experiment",
  "protection_class", "custom"] as const;
const OBJECTIVES = new Set(["awareness", "traffic", "engagement", "lead_generation", "app_growth", "sales"]);
const BLOCKER_CODES = new Set<BlockerCode>(["atomic_multi_command_category_adoption_unavailable",
  "category_profile_registry_unavailable", "owner_configuration_required", "incompatible_existing_dimension"]);
const PLAN_KEYS = ["contractVersion", "catalogVersion", "catalogHash", "registryHash", "planHash", "status", "summary",
  "dimensionCoverage", "categoryCommands", "profileProposals", "blockers", "ownerConfirmationRequired",
  "confirmationLiteral", "authority"] as const;
const AUTHORITY_KEYS = ["canPersist", "canConfirm", "canAuthorizeAction", "canWriteMeta", "canPublishPolicy"] as const;
const REQUIRED_CAPABILITIES: Readonly<Record<BlockerCode, string>> = Object.freeze({
  atomic_multi_command_category_adoption_unavailable:
    "category_authoring_atomic_batch/1.0.0 + category_profile_atomic_batch/1.0.0",
  category_profile_registry_unavailable: "category_profile_authoritative_inventory/1.0.0",
  incompatible_existing_dimension: "owner_category_dimension_conflict_resolution/1.0.0",
  owner_configuration_required: "owner_starter_category_configuration/1.0.0",
});
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}
function boundedInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}
function safeRef(value: unknown, maximum = 160): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && /^[a-z][a-z0-9_.:/-]*$/.test(value);
}
function validCommands(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value) || value.length > 21) return false;
  return value.every((command) => {
    if (!object(command) || typeof command.operation !== "string") return false;
    if (command.operation === "create_dimension") return exact(command,
      ["operation", "key", "name", "description", "cardinality", "allowedEntityLevels"])
      && typeof command.key === "string" && DIMENSIONS.includes(command.key as typeof DIMENSIONS[number])
      && typeof command.name === "string" && command.name.length > 0 && command.name.length <= 160
      && typeof command.description === "string" && command.description.length <= 2_000
      && ["single", "multi"].includes(String(command.cardinality)) && Array.isArray(command.allowedEntityLevels)
      && command.allowedEntityLevels.length >= 1 && command.allowedEntityLevels.length <= 4
      && new Set(command.allowedEntityLevels).size === command.allowedEntityLevels.length
      && command.allowedEntityLevels.every((level) => ["campaign", "ad_set", "ad", "creative"].includes(String(level)));
    return command.operation === "create_definition" && exact(command,
      ["operation", "dimensionRef", "key", "label", "description"])
      && typeof command.dimensionRef === "string" && /^dimension_[a-f0-9]{24}$/.test(command.dimensionRef)
      && typeof command.key === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(command.key)
      && typeof command.label === "string" && command.label.length > 0 && command.label.length <= 160
      && typeof command.description === "string" && command.description.length <= 2_000;
  });
}
function validProfileProposals(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value) || value.length > 42) return false;
  const identities = new Set<string>();
  return value.every((proposal) => {
    if (!exact(proposal, ["objective", "categoryTemplateRef", "proposalHash"])
      || typeof proposal.objective !== "string" || !OBJECTIVES.has(proposal.objective)
      || !safeRef(proposal.categoryTemplateRef) || typeof proposal.proposalHash !== "string"
      || !HASH.test(proposal.proposalHash)) return false;
    const identity = `${proposal.objective}\0${proposal.categoryTemplateRef}`;
    if (identities.has(identity)) return false; identities.add(identity); return true;
  });
}
function parsePlan(value: unknown, status: Plan["status"], allowedKeys: readonly string[]): Plan {
  if (!exact(value, allowedKeys)) throw new Error("unsafe_response");
  const plan = value;
  if (plan.contractVersion !== "starter-category-adoption/1.0.0"
    || plan.catalogVersion !== "starter-category-playbooks/1.1.0"
    || typeof plan.catalogHash !== "string" || !HASH.test(plan.catalogHash)
    || typeof plan.planHash !== "string" || !HASH.test(plan.planHash)
    || typeof plan.registryHash !== "string" || !HASH.test(plan.registryHash) || plan.status !== status
    || !exact(plan.summary, ["canonicalDimensions", "dimensionsToCreate", "definitionsToCreate", "profileProposals",
      "satisfied", "conflicts", "ownerConfigurationRequired"]) || plan.summary.canonicalDimensions !== 14
    || !boundedInteger(plan.summary.dimensionsToCreate, 14) || !boundedInteger(plan.summary.definitionsToCreate, 21)
    || !boundedInteger(plan.summary.profileProposals, 42) || !boundedInteger(plan.summary.satisfied, 14)
    || !boundedInteger(plan.summary.conflicts, 14) || !boundedInteger(plan.summary.ownerConfigurationRequired, 17)
    || !Array.isArray(plan.dimensionCoverage) || plan.dimensionCoverage.length !== 14
    || new Set(plan.dimensionCoverage.map((item) => object(item) ? item.dimensionKey : null)).size !== 14
    || plan.dimensionCoverage.some((item) => !exact(item, ["dimensionKey", "disposition", "reasonCode"])
      || typeof item.dimensionKey !== "string" || !DIMENSIONS.includes(item.dimensionKey as typeof DIMENSIONS[number])
      || ![["create", "missing"], ["satisfied", "already_present"],
        ["conflict", "incompatible_existing_definition"]].some(([disposition, reason]) =>
        item.disposition === disposition && item.reasonCode === reason))
    || !validCommands(plan.categoryCommands) || !validProfileProposals(plan.profileProposals)
    || plan.summary.dimensionsToCreate !== plan.dimensionCoverage.filter((item) => item.disposition === "create").length
    || plan.summary.satisfied !== plan.dimensionCoverage.filter((item) => item.disposition === "satisfied").length
    || plan.summary.conflicts !== plan.dimensionCoverage.filter((item) => item.disposition === "conflict").length
    || plan.summary.definitionsToCreate !== plan.categoryCommands.filter((item) =>
      object(item) && item.operation === "create_definition").length
    || plan.summary.profileProposals !== plan.profileProposals.length || !Array.isArray(plan.blockers)
    || plan.blockers.length < 2 || plan.blockers.length > 4
    || new Set(plan.blockers.map((item) => object(item) ? item.code : null)).size !== plan.blockers.length
    || plan.blockers.some((item) => !exact(item, ["code", "refs"]) || typeof item.code !== "string"
      || !BLOCKER_CODES.has(item.code as BlockerCode) || !Array.isArray(item.refs) || item.refs.length > 50
      || new Set(item.refs).size !== item.refs.length || item.refs.some((ref) => !safeRef(ref)))
    || !plan.blockers.some((item) => item.code === "category_profile_registry_unavailable")
    || plan.ownerConfirmationRequired !== true || plan.confirmationLiteral !== "adopt_starter_category_playbook"
    || !exact(plan.authority, AUTHORITY_KEYS) || plan.authority.canPersist !== false
    || typeof plan.authority.canConfirm !== "boolean" || plan.authority.canAuthorizeAction !== false
    || plan.authority.canWriteMeta !== false || plan.authority.canPublishPolicy !== false) throw new Error("unsafe_response");
  return plan as unknown as Plan;
}
export function parseStarterCategoryAdoptionPlan(value: unknown): Plan {
  return parsePlan(value, "preview_only", PLAN_KEYS);
}
export function parseStarterCategoryAdoptionBlockedResponse(value: unknown,
  preview: Plan): Readonly<{ blocker: BlockerCode }> {
  const keys = [...PLAN_KEYS, "persistenceAttempted", "blocker", "continuation"];
  const plan = parsePlan(value, "blocked", keys);
  const blocker = object(value) && typeof value.blocker === "string" && BLOCKER_CODES.has(value.blocker as BlockerCode)
    ? value.blocker as BlockerCode : null;
  if (!object(value) || value.persistenceAttempted !== false
    || blocker === null || !preview.blockers.some((entry) => entry.code === blocker)
    || !exact(value.continuation, ["requiredCapability", "replay"])
    || value.continuation.requiredCapability !== REQUIRED_CAPABILITIES[blocker]
    || !exact(value.continuation.replay, ["planHash", "expectedRegistryHash", "confirmation"])
    || value.continuation.replay.planHash !== preview.planHash
    || value.continuation.replay.expectedRegistryHash !== preview.registryHash
    || value.continuation.replay.confirmation !== preview.confirmationLiteral
    || plan.planHash !== preview.planHash || plan.registryHash !== preview.registryHash
    || plan.catalogHash !== preview.catalogHash || plan.catalogVersion !== preview.catalogVersion
    || JSON.stringify(plan.summary) !== JSON.stringify(preview.summary)
    || JSON.stringify(plan.dimensionCoverage) !== JSON.stringify(preview.dimensionCoverage)
    || JSON.stringify(plan.categoryCommands) !== JSON.stringify(preview.categoryCommands)
    || JSON.stringify(plan.profileProposals) !== JSON.stringify(preview.profileProposals)
    || JSON.stringify(plan.blockers) !== JSON.stringify(preview.blockers)
    || plan.authority.canConfirm !== true) throw new Error("unsafe_response");
  return { blocker };
}
function message(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload && payload.error
    && typeof payload.error === "object" && "message" in payload.error && typeof payload.error.message === "string"
    ? payload.error.message : fallback;
}

export function StarterCategoryAdoption() {
  const [plan, setPlan] = useState<Plan | null>(null); const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false);
  const [blocker, setBlocker] = useState<string | null>(null);
  const load = useCallback(async () => { setError(null); try {
    const response = await fetch("/api/starter-category-adoption", { credentials: "same-origin", cache: "no-store",
      headers: { "x-reklamzeka-intent": "starter-category-adoption-preview" } });
    const payload: unknown = await response.json(); if (!response.ok) throw new Error(message(payload, "Önizleme alınamadı."));
    setPlan(parseStarterCategoryAdoptionPlan(payload)); setConfirmed(false); setBlocker(null);
  } catch (reason) { setPlan(null); setError(reason instanceof Error ? reason.message : "Önizleme alınamadı."); } }, []);
  useEffect(() => { void load(); }, [load]);
  const confirm = async () => { if (!plan || !confirmed || !plan.authority.canConfirm) return; setBusy(true); setError(null);
    try { const response = await fetch("/api/starter-category-adoption", { method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-reklamzeka-intent": "starter-category-adoption-confirm" },
      body: JSON.stringify({ planHash: plan.planHash, expectedRegistryHash: plan.registryHash,
        confirmation: plan.confirmationLiteral }) });
      const payload: unknown = await response.json(); if (!response.ok) throw new Error(message(payload, "Onay doğrulanamadı."));
      setBlocker(parseStarterCategoryAdoptionBlockedResponse(payload, plan).blocker);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Onay doğrulanamadı."); }
    finally { setBusy(false); }
  };
  return <section className={styles.panel} aria-label="Starter kategori adoption önizlemesi">
    <header><div><span>14-DIMENSION STARTER PLAN</span><h2>Başlangıç kategori playbook’u</h2></div>
      <button type="button" onClick={() => void load()} disabled={busy}>Yenile</button></header>
    {error ? <p className={styles.error} role="alert">{error}</p> : !plan ? <p>Plan yükleniyor…</p> : <>
      <div className={styles.metrics}><article><strong>{plan.summary.canonicalDimensions}</strong><span>Kanonik boyut</span></article>
        <article><strong>{plan.summary.dimensionsToCreate}</strong><span>Eksik boyut</span></article>
        <article><strong>{plan.summary.definitionsToCreate}</strong><span>Hazır tanım</span></article>
        <article><strong>{plan.summary.profileProposals}</strong><span>Profile önerisi</span></article></div>
      <div className={styles.dimensions}>{plan.dimensionCoverage.map((item) => <span key={item.dimensionKey}
        data-state={item.disposition}>{item.dimensionKey}<b>{item.disposition === "create" ? "eksik"
          : item.disposition === "satisfied" ? "hazır" : "çatışma"}</b></span>)}</div>
      <div className={styles.blockers}><strong>Güvenli sınırlar</strong>{plan.blockers.map((item) =>
        <p key={item.code}><code>{item.code}</code><span>{item.refs.length} bağlı gereksinim</span></p>)}</div>
      {plan.authority.canConfirm ? <div className={styles.confirm}><label><input type="checkbox" checked={confirmed}
        onChange={(event) => setConfirmed(event.target.checked)} /> Planı inceledim; tenant adoption niyetini doğrula</label>
        <button type="button" disabled={!confirmed || busy} onClick={() => void confirm()}>{busy ? "Doğrulanıyor…" : "Adoption niyetini doğrula"}</button></div>
        : <p className={styles.notice}>Adoption doğrulaması yalnız owner/admin rolüne açıktır.</p>}
      {blocker ? <p className={styles.notice} role="status"><strong>Persistence açılmadı.</strong> Exact blocker: <code>{blocker}</code>. Gerekli güvenli capability sağlandığında aynı plan hash ile replay hazırdır.</p> : null}
      <footer>Bu yüzey Meta write, action authorization veya policy publish yetkisi vermez. Komutlar tarayıcıdan zincirlenmez.</footer>
    </>}
  </section>;
}
