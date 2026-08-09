"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./starter-category-adoption.module.css";

type BlockerCode = "pending_owner_configuration" | "incompatible_existing_dimension"
  | "existing_category_profile_conflict";
type Plan = Readonly<{ contractVersion: "starter-category-adoption/1.1.0";
  catalogVersion: "starter-category-playbooks/1.1.0"; catalogHash: string;
  registryHash: string; profileRegistryHash: string; planHash: string; status: "preview_only";
  summary: Readonly<{ canonicalDimensions: 14; dimensionsToCreate: number; definitionsToCreate: number;
    profileProposals: number; profileDraftsToCreate: number; profileDraftsSatisfied: number;
    satisfied: number; conflicts: number; ownerConfigurationRequired: number }>;
  dimensionCoverage: readonly Readonly<{ dimensionKey: string; disposition: "create" | "satisfied" | "conflict";
    reasonCode: "missing" | "already_present" | "incompatible_existing_definition" }> [];
  categoryCommands: readonly unknown[]; profileProposals: readonly unknown[]; profileDrafts: readonly unknown[];
  targetRefs: readonly string[];
  blockers: readonly Readonly<{ code: BlockerCode; blocking: boolean; refs: readonly string[] }> [];
  ownerConfirmationRequired: true; pendingOwnerConfigurationAcknowledgementRequired: true;
  confirmationLiteral: "adopt_starter_category_playbook";
  authority: Readonly<{ canPersist: boolean; canConfirm: boolean; canAuthorizeAction: false;
    canWriteMeta: false; canPublishPolicy: false }> }>;
type AdoptionSuccess = Readonly<{ outcome: "inserted" | "unchanged"; dimensionsCreated: number;
  definitionsCreated: number; profileDraftsCreated: number }>;
const HASH = /^[a-f0-9]{64}$/;
const DIMENSIONS = ["service_line", "brand_clinic", "geo_market", "language", "campaign_role", "funnel_intent",
  "audience_strategy", "destination", "budget_pool", "operating_mode", "lifecycle", "experiment",
  "protection_class", "custom"] as const;
const OBJECTIVES = new Set(["awareness", "traffic", "engagement", "lead_generation", "app_growth", "sales"]);
const BLOCKERS = new Set<BlockerCode>(["pending_owner_configuration", "incompatible_existing_dimension",
  "existing_category_profile_conflict"]);
const PLAN_KEYS = ["contractVersion", "catalogVersion", "catalogHash", "registryHash", "profileRegistryHash",
  "planHash", "status", "summary", "dimensionCoverage", "categoryCommands", "profileProposals", "profileDrafts",
  "targetRefs", "blockers", "ownerConfirmationRequired", "pendingOwnerConfigurationAcknowledgementRequired",
  "confirmationLiteral", "authority"] as const;
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function integer(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}
function safeRef(value: unknown): value is string {
  return typeof value === "string" && value.length >= 2 && value.length <= 159
    && /^[a-z][a-z0-9_.:-]+$/.test(value);
}
function commands(value: unknown) {
  return Array.isArray(value) && value.length <= 21 && value.every((command) => {
    if (!object(command) || typeof command.operation !== "string") return false;
    if (command.operation === "create_dimension") return exact(command,
      ["operation", "key", "name", "description", "cardinality", "allowedEntityLevels"])
      && typeof command.key === "string" && DIMENSIONS.includes(command.key as typeof DIMENSIONS[number])
      && typeof command.name === "string" && command.name.length <= 160
      && typeof command.description === "string" && command.description.length <= 2_000
      && ["single", "multi"].includes(String(command.cardinality)) && Array.isArray(command.allowedEntityLevels)
      && command.allowedEntityLevels.length >= 1 && command.allowedEntityLevels.length <= 4
      && new Set(command.allowedEntityLevels).size === command.allowedEntityLevels.length
      && command.allowedEntityLevels.every((level) => ["campaign", "ad_set", "ad", "creative"].includes(String(level)));
    return command.operation === "create_definition" && exact(command,
      ["operation", "dimensionRef", "key", "label", "description"])
      && typeof command.dimensionRef === "string" && /^dimension_[a-f0-9]{24}$/.test(command.dimensionRef)
      && typeof command.key === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(command.key)
      && typeof command.label === "string" && command.label.length <= 160
      && typeof command.description === "string" && command.description.length <= 2_000;
  });
}
function proposals(value: unknown) {
  if (!Array.isArray(value) || value.length > 42) return false; const seen = new Set<string>();
  return value.every((proposal) => {
    if (!exact(proposal, ["objective", "categoryTemplateRef", "proposalHash"])
      || typeof proposal.objective !== "string" || !OBJECTIVES.has(proposal.objective)
      || !safeRef(proposal.categoryTemplateRef) || typeof proposal.proposalHash !== "string"
      || !HASH.test(proposal.proposalHash)) return false;
    const key = `${proposal.objective}\0${proposal.categoryTemplateRef}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
}
function profileDrafts(value: unknown) {
  if (!Array.isArray(value) || value.length > 7) return false; const seen = new Set<string>();
  return value.every((draft) => {
    if (!exact(draft, ["categoryTemplateRef", "categoryRef", "profileRef", "proposalHashes",
      "profileDraftHash", "expectedProfileHash", "material", "disposition"]) || !safeRef(draft.categoryTemplateRef)
      || typeof draft.categoryRef !== "string" || !/^category_[a-f0-9]{24}$/.test(draft.categoryRef)
      || !safeRef(draft.profileRef) || !Array.isArray(draft.proposalHashes) || draft.proposalHashes.length !== 6
      || new Set(draft.proposalHashes).size !== 6 || draft.proposalHashes.some((hash) => typeof hash !== "string" || !HASH.test(hash))
      || JSON.stringify(draft.proposalHashes) !== JSON.stringify([...draft.proposalHashes].sort())
      || typeof draft.profileDraftHash !== "string" || !HASH.test(draft.profileDraftHash)
      || typeof draft.expectedProfileHash !== "string" || !HASH.test(draft.expectedProfileHash)
      || !["create", "satisfied", "conflict"].includes(String(draft.disposition))
      || !exact(draft.material, ["label", "description", "color", "bindings"])
      || typeof draft.material.label !== "string" || draft.material.label.length > 200
      || typeof draft.material.description !== "string" || draft.material.description.length > 2_000
      || typeof draft.material.color !== "string" || !/^#[0-9A-F]{6}$/.test(draft.material.color)
      || !exact(draft.material.bindings, ["analysisPlaybookRefs", "ruleInstructionBundleRefs", "budgetPolicyRefs",
        "transferPolicyRefs", "schedulePolicyRefs", "actionPolicyRefs", "creativePolicyRefs"])) return false;
    const bindings = draft.material.bindings;
    if (!Array.isArray(bindings.analysisPlaybookRefs) || bindings.analysisPlaybookRefs.length !== 6
      || bindings.analysisPlaybookRefs.some((ref) => !safeRef(ref))
      || Object.entries(bindings).some(([key, refs]) => key !== "analysisPlaybookRefs"
        && (!Array.isArray(refs) || refs.length !== 0))) return false;
    if (seen.has(draft.profileRef)) return false; seen.add(draft.profileRef); return true;
  });
}
export function parseStarterCategoryAdoptionPlan(value: unknown): Plan {
  if (!exact(value, PLAN_KEYS)) throw new Error("unsafe_response"); const plan = value;
  const categoryCommands = Array.isArray(plan.categoryCommands) ? plan.categoryCommands : [];
  const profileProposals = Array.isArray(plan.profileProposals) ? plan.profileProposals : [];
  const draftProfiles = Array.isArray(plan.profileDrafts) ? plan.profileDrafts : [];
  if (plan.contractVersion !== "starter-category-adoption/1.1.0"
    || plan.catalogVersion !== "starter-category-playbooks/1.1.0"
    || typeof plan.catalogHash !== "string" || !HASH.test(plan.catalogHash)
    || typeof plan.registryHash !== "string" || !HASH.test(plan.registryHash)
    || typeof plan.profileRegistryHash !== "string" || !HASH.test(plan.profileRegistryHash)
    || typeof plan.planHash !== "string" || !HASH.test(plan.planHash) || plan.status !== "preview_only"
    || !exact(plan.summary, ["canonicalDimensions", "dimensionsToCreate", "definitionsToCreate", "profileProposals",
      "profileDraftsToCreate", "profileDraftsSatisfied", "satisfied", "conflicts", "ownerConfigurationRequired"])
    || plan.summary.canonicalDimensions !== 14 || !integer(plan.summary.dimensionsToCreate, 14)
    || !integer(plan.summary.definitionsToCreate, 21) || !integer(plan.summary.profileProposals, 42)
    || !integer(plan.summary.profileDraftsToCreate, 7) || !integer(plan.summary.profileDraftsSatisfied, 7)
    || !integer(plan.summary.satisfied, 14) || !integer(plan.summary.conflicts, 21)
    || !integer(plan.summary.ownerConfigurationRequired, 17)
    || !Array.isArray(plan.dimensionCoverage) || plan.dimensionCoverage.length !== 14
    || new Set(plan.dimensionCoverage.map((item) => object(item) ? item.dimensionKey : null)).size !== 14
    || plan.dimensionCoverage.some((item) => !exact(item, ["dimensionKey", "disposition", "reasonCode"])
      || typeof item.dimensionKey !== "string" || !DIMENSIONS.includes(item.dimensionKey as typeof DIMENSIONS[number])
      || ![["create", "missing"], ["satisfied", "already_present"],
        ["conflict", "incompatible_existing_definition"]].some(([disposition, reason]) =>
        item.disposition === disposition && item.reasonCode === reason))
    || !commands(plan.categoryCommands) || !proposals(plan.profileProposals) || !profileDrafts(plan.profileDrafts)
    || plan.summary.dimensionsToCreate !== categoryCommands.filter((item) =>
      object(item) && item.operation === "create_dimension").length
    || plan.summary.definitionsToCreate !== categoryCommands.filter((item) =>
      object(item) && item.operation === "create_definition").length
    || plan.summary.profileProposals !== profileProposals.length
    || plan.summary.profileDraftsToCreate !== draftProfiles.filter((item) =>
      object(item) && item.disposition === "create").length
    || plan.summary.profileDraftsSatisfied !== draftProfiles.filter((item) =>
      object(item) && item.disposition === "satisfied").length
    || plan.summary.satisfied !== plan.dimensionCoverage.filter((item) => item.disposition === "satisfied").length
    || plan.summary.conflicts !== plan.dimensionCoverage.filter((item) => item.disposition === "conflict").length
      + draftProfiles.filter((item) => object(item) && item.disposition === "conflict").length
    || plan.summary.profileProposals !== draftProfiles.length * 6
    || !Array.isArray(plan.targetRefs) || plan.targetRefs.length < 1 || plan.targetRefs.length > 32
    || new Set(plan.targetRefs).size !== plan.targetRefs.length || plan.targetRefs.some((ref) => !safeRef(ref))
    || JSON.stringify(plan.targetRefs) !== JSON.stringify([...plan.targetRefs].sort())
    || !Array.isArray(plan.blockers) || plan.blockers.length < 1 || plan.blockers.length > 3
    || new Set(plan.blockers.map((item) => object(item) ? item.code : null)).size !== plan.blockers.length
    || plan.blockers.some((item) => !exact(item, ["code", "blocking", "refs"])
      || typeof item.code !== "string" || !BLOCKERS.has(item.code as BlockerCode) || typeof item.blocking !== "boolean"
      || (item.code === "pending_owner_configuration") !== (item.blocking === false)
      || !Array.isArray(item.refs) || item.refs.length < 1 || item.refs.length > 50
      || new Set(item.refs).size !== item.refs.length || item.refs.some((ref) => !safeRef(ref)))
    || !plan.blockers.some((item) => item.code === "pending_owner_configuration" && item.blocking === false)
    || plan.summary.ownerConfigurationRequired !== plan.blockers.find((item) =>
      item.code === "pending_owner_configuration")?.refs.length
    || plan.targetRefs.length !== 14 + draftProfiles.length * 2
    || plan.ownerConfirmationRequired !== true || plan.pendingOwnerConfigurationAcknowledgementRequired !== true
    || plan.confirmationLiteral !== "adopt_starter_category_playbook"
    || !exact(plan.authority, ["canPersist", "canConfirm", "canAuthorizeAction", "canWriteMeta", "canPublishPolicy"])
    || typeof plan.authority.canPersist !== "boolean" || typeof plan.authority.canConfirm !== "boolean"
    || plan.authority.canPersist && !plan.authority.canConfirm
    || plan.blockers.some((item) => item.blocking) && plan.authority.canPersist
    || plan.authority.canAuthorizeAction !== false
    || plan.authority.canWriteMeta !== false || plan.authority.canPublishPolicy !== false) throw new Error("unsafe_response");
  return plan as unknown as Plan;
}
export function parseStarterCategoryAdoptionSuccess(value: unknown, preview: Plan): AdoptionSuccess {
  if (!exact(value, ["contractVersion", "catalogVersion", "catalogHash", "planHash", "status",
    "pendingOwnerConfiguration", "result", "authority"]) || value.contractVersion !== preview.contractVersion
    || value.catalogVersion !== preview.catalogVersion || value.catalogHash !== preview.catalogHash
    || value.planHash !== preview.planHash || value.status !== "core_adopted_with_owner_configuration_pending"
    || !Array.isArray(value.pendingOwnerConfiguration) || value.pendingOwnerConfiguration.length < 1
    || value.pendingOwnerConfiguration.length > 17 || new Set(value.pendingOwnerConfiguration).size
      !== value.pendingOwnerConfiguration.length || value.pendingOwnerConfiguration.some((ref) => !safeRef(ref))
    || JSON.stringify(value.pendingOwnerConfiguration) !== JSON.stringify(preview.blockers.find((blocker) =>
      blocker.code === "pending_owner_configuration")?.refs)
    || !exact(value.result, ["outcome", "registryHash", "profileRegistryHash", "dimensionsCreated",
      "definitionsCreated", "profileDraftsCreated", "auditAppended", "categoryInvalidationsAppended",
      "profileInvalidationsAppended"]) || !["inserted", "unchanged"].includes(String(value.result.outcome))
    || typeof value.result.registryHash !== "string" || !HASH.test(value.result.registryHash)
    || typeof value.result.profileRegistryHash !== "string" || !HASH.test(value.result.profileRegistryHash)
    || !integer(value.result.dimensionsCreated, 14) || !integer(value.result.definitionsCreated, 21)
    || !integer(value.result.profileDraftsCreated, 7) || typeof value.result.auditAppended !== "boolean"
    || !integer(value.result.categoryInvalidationsAppended, 10_000)
    || !integer(value.result.profileInvalidationsAppended, 10_000)
    || value.result.categoryInvalidationsAppended !== 0 || value.result.profileInvalidationsAppended !== 0
    || (value.result.outcome === "inserted" && (value.result.dimensionsCreated !== preview.summary.dimensionsToCreate
      || value.result.definitionsCreated !== preview.summary.definitionsToCreate
      || value.result.profileDraftsCreated !== preview.summary.profileDraftsToCreate || value.result.auditAppended !== true))
    || (value.result.outcome === "unchanged" && (value.result.dimensionsCreated !== 0
      || value.result.definitionsCreated !== 0 || value.result.profileDraftsCreated !== 0
      || value.result.auditAppended !== false))
    || !exact(value.authority, ["canPersist", "canConfirm", "canAuthorizeAction", "canWriteMeta", "canPublishPolicy"])
    || value.authority.canPersist !== true || value.authority.canConfirm !== true
    || value.authority.canAuthorizeAction !== false || value.authority.canWriteMeta !== false
    || value.authority.canPublishPolicy !== false) throw new Error("unsafe_response");
  return value.result as AdoptionSuccess;
}
function message(payload: unknown, fallback: string) {
  return object(payload) && object(payload.error) && typeof payload.error.message === "string"
    ? payload.error.message : fallback;
}

export function StarterCategoryAdoption() {
  const [plan, setPlan] = useState<Plan | null>(null); const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false); const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<AdoptionSuccess | null>(null);
  const load = useCallback(async () => { setError(null); try {
    const response = await fetch("/api/starter-category-adoption", { credentials: "same-origin", cache: "no-store",
      headers: { "x-reklamzeka-intent": "starter-category-adoption-preview" } });
    const payload: unknown = await response.json(); if (!response.ok) throw new Error(message(payload, "Önizleme alınamadı."));
    setPlan(parseStarterCategoryAdoptionPlan(payload)); setAcknowledged(false); setSuccess(null);
  } catch (reason) { setPlan(null); setError(reason instanceof Error ? reason.message : "Önizleme alınamadı."); } }, []);
  useEffect(() => { void load(); }, [load]);
  const confirm = async () => { if (!plan || !acknowledged || !plan.authority.canConfirm
      || plan.blockers.some((blocker) => blocker.blocking)) return; setBusy(true); setError(null);
    try { const response = await fetch("/api/starter-category-adoption", { method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-reklamzeka-intent": "starter-category-adoption-confirm" },
      body: JSON.stringify({ planHash: plan.planHash, expectedRegistryHash: plan.registryHash,
        expectedProfileRegistryHash: plan.profileRegistryHash, targetRefs: plan.targetRefs,
        confirmation: plan.confirmationLiteral, acknowledgedPendingOwnerConfiguration: true }) });
      const payload: unknown = await response.json(); if (!response.ok) throw new Error(message(payload, "Adoption tamamlanamadı."));
      setSuccess(parseStarterCategoryAdoptionSuccess(payload, plan));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Adoption tamamlanamadı."); }
    finally { setBusy(false); }
  };
  return <section className={styles.panel} aria-label="Starter kategori adoption önizlemesi">
    <header><div><span>14-DIMENSION STARTER PLAN</span><h2>Başlangıç kategori playbook’u</h2></div>
      <button type="button" onClick={() => void load()} disabled={busy}>Yenile</button></header>
    {error ? <p className={styles.error} role="alert">{error}</p> : !plan ? <p>Plan yükleniyor…</p> : <>
      <div className={styles.metrics}><article><strong>{plan.summary.canonicalDimensions}</strong><span>Kanonik boyut</span></article>
        <article><strong>{plan.summary.dimensionsToCreate}</strong><span>Eksik boyut</span></article>
        <article><strong>{plan.summary.definitionsToCreate}</strong><span>Hazır tanım</span></article>
        <article><strong>{plan.summary.profileDraftsToCreate}</strong><span>Profile draft</span></article></div>
      <div className={styles.dimensions}>{plan.dimensionCoverage.map((item) => <span key={item.dimensionKey}
        data-state={item.disposition}>{item.dimensionKey}<b>{item.disposition === "create" ? "eksik"
          : item.disposition === "satisfied" ? "hazır" : "çatışma"}</b></span>)}</div>
      <div className={styles.blockers}><strong>Sınırlar ve takip işleri</strong>{plan.blockers.map((item) =>
        <p key={item.code}><code>{item.code}</code><span>{item.blocking ? "batch bloklu" : `${item.refs.length} owner girdisi bekliyor`}</span></p>)}</div>
      {plan.authority.canConfirm ? <div className={styles.confirm}><label><input type="checkbox" checked={acknowledged}
        onChange={(event) => setAcknowledged(event.target.checked)} /> Core batch’i ve owner-defined değerlerin ayrıca
        yapılandırılacağını onaylıyorum</label><button type="button" disabled={!acknowledged || busy
          || plan.blockers.some((blocker) => blocker.blocking)} onClick={() => void confirm()}>{busy
          ? "Kaydediliyor…" : "Core kategori ve draft profilleri oluştur"}</button></div>
        : <p className={styles.notice}>Adoption yalnız owner/admin rolüne açıktır.</p>}
      {success ? <p className={styles.notice} role="status"><strong>Core batch tamamlandı.</strong>{" "}
        {success.dimensionsCreated} boyut, {success.definitionsCreated} tanım ve {success.profileDraftsCreated} draft profile.
        Owner-defined değerler bekleyen yapılandırma olarak kaldı.</p> : null}
      <footer>Bu yüzey Meta write, action authorization veya policy publish yetkisi vermez. Bütün kayıtlar sunucuda tek transaction’dır.</footer>
    </>}
  </section>;
}
