"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./category-profile-studio.module.css";

type Status = "draft" | "active" | "paused" | "archived";
const BINDING_KEYS = ["analysisPlaybookRefs", "ruleInstructionBundleRefs", "budgetPolicyRefs", "transferPolicyRefs",
  "schedulePolicyRefs", "actionPolicyRefs", "creativePolicyRefs"] as const;
type BindingKey = typeof BINDING_KEYS[number];
type Bindings = Readonly<Record<BindingKey, readonly string[]>>;
const BINDING_PREFIXES: Readonly<Record<BindingKey, readonly string[]>> = Object.freeze({
  analysisPlaybookRefs: ["analysis_playbook_"], ruleInstructionBundleRefs: ["instruction_bundle_", "rule_bundle_"],
  budgetPolicyRefs: ["budget_policy_", "budget_envelope_"], transferPolicyRefs: ["transfer_policy_"],
  schedulePolicyRefs: ["schedule_policy_", "cadence_profile_"],
  actionPolicyRefs: ["action_policy_", "approval_policy_", "guardrail_", "autonomy_rule_"],
  creativePolicyRefs: ["creative_policy_"],
});
type Profile = Readonly<{ schemaVersion: "category-profile/1.0.0"; workspaceRef: string; profileRef: string;
  categoryRef: string; parentCategoryRef: string | null; version: number; previousProfileHash: string | null;
  label: string; description: string; color: string; ownerRef: string; status: Status; bindings: Bindings;
  authority: Readonly<{ canAuthorizeAction: false; canExecuteWrite: false; canWriteMeta: false; canGrantApproval: false }>;
  profileHash: string }>;
type Definition = Readonly<{ dimensionRef: string; dimensionKey: string; definitionRef: string; label: string;
  description: string | null; currentProfile: Profile | null }>;
type Authority = Readonly<{ canRead: true; canCreate: boolean; canRevise: boolean; canPublish: boolean;
  canPause: boolean; canArchive: boolean; canPublishPolicy: false; canAuthorizeAction: false;
  canExecute: false; canWriteMeta: false }>;
export type CategoryProfileStudioSnapshot = Readonly<{ contractVersion: "category-profile-lifecycle/1.0.0";
  registryHash: string; definitions: readonly Definition[]; authority: Authority }>;
export type CategoryProfileCommand =
  | Readonly<{ operation: "create_draft"; definitionRef: string; parentDefinitionRef: string | null; label: string;
      description: string; color: string; bindings: Bindings; expectedRegistryHash: string }>
  | Readonly<{ operation: "revise_draft"; profileRef: string; parentDefinitionRef: string | null; label: string;
      description: string; color: string; bindings: Bindings; expectedVersion: number; expectedProfileHash: string;
      expectedRegistryHash: string }>
  | Readonly<{ operation: "publish" | "pause" | "archive"; profileRef: string; expectedVersion: number;
      expectedProfileHash: string; expectedRegistryHash: string; reasonCode: string }>;

const HASH = /^[a-f0-9]{64}$/;
const DEFINITION_REF = /^category_[a-f0-9]{24}$/;
const DIMENSION_REF = /^dimension_[a-f0-9]{24}$/;
const PROFILE_REF = /^category_profile_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const WORKSPACE_REF = /^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const OWNER_REF = /^actor_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const OPAQUE_REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const DIMENSION_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const SENSITIVE_REF = /(?:token|secret|authorization|raw[_-]?(?:payload|request|response|json))/i;
const PROFILE_KEYS = ["schemaVersion", "workspaceRef", "profileRef", "categoryRef", "parentCategoryRef", "version",
  "previousProfileHash", "label", "description", "color", "ownerRef", "status", "bindings", "authority", "profileHash"];
const AUTHORITY_KEYS = ["canRead", "canCreate", "canRevise", "canPublish", "canPause", "canArchive",
  "canPublishPolicy", "canAuthorizeAction", "canExecute", "canWriteMeta"];
const PROFILE_AUTHORITY_KEYS = ["canAuthorizeAction", "canExecuteWrite", "canWriteMeta", "canGrantApproval"];

class ProfileStudioError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ProfileStudioError"; }
}
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function boundedText(value: unknown, maximum: number, nullable = false): boolean {
  if (nullable && value === null) return true;
  return typeof value === "string" && value.length >= 1 && value.length <= maximum
    && value === value.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
function bindings(value: unknown): value is Bindings {
  return exact(value, BINDING_KEYS) && BINDING_KEYS.every((key) => {
    const entries = value[key];
    return Array.isArray(entries) && entries.length <= 64 && (key !== "analysisPlaybookRefs" || entries.length > 0)
      && entries.every((entry) => typeof entry === "string" && entry.length <= 159 && OPAQUE_REF.test(entry)
        && BINDING_PREFIXES[key].some((prefix) => entry.startsWith(prefix)) && !SENSITIVE_REF.test(entry))
      && new Set(entries).size === entries.length;
  });
}
function profile(value: unknown): value is Profile {
  const candidateAuthority = object(value) ? value.authority : null;
  return exact(value, PROFILE_KEYS) && value.schemaVersion === "category-profile/1.0.0"
    && typeof value.workspaceRef === "string" && WORKSPACE_REF.test(value.workspaceRef)
    && typeof value.profileRef === "string" && PROFILE_REF.test(value.profileRef)
    && typeof value.categoryRef === "string" && DEFINITION_REF.test(value.categoryRef)
    && (value.parentCategoryRef === null || typeof value.parentCategoryRef === "string" && DEFINITION_REF.test(value.parentCategoryRef))
    && Number.isSafeInteger(value.version) && Number(value.version) >= 1
    && (value.previousProfileHash === null || typeof value.previousProfileHash === "string" && HASH.test(value.previousProfileHash))
    && boundedText(value.label, 200) && boundedText(value.description, 2_000) && typeof value.color === "string"
    && /^#[0-9A-F]{6}$/.test(value.color) && typeof value.ownerRef === "string" && OWNER_REF.test(value.ownerRef)
    && ["draft", "active", "paused", "archived"].includes(String(value.status)) && bindings(value.bindings)
    && exact(candidateAuthority, PROFILE_AUTHORITY_KEYS)
    && PROFILE_AUTHORITY_KEYS.every((key) => candidateAuthority[key] === false)
    && typeof value.profileHash === "string" && HASH.test(value.profileHash);
}
function authority(value: unknown): value is Authority {
  return exact(value, AUTHORITY_KEYS) && value.canRead === true
    && ["canCreate", "canRevise", "canPublish", "canPause", "canArchive"].every((key) => typeof value[key] === "boolean")
    && ["canPublishPolicy", "canAuthorizeAction", "canExecute", "canWriteMeta"].every((key) => value[key] === false);
}
export function parseCategoryProfileStudioSnapshot(value: unknown): CategoryProfileStudioSnapshot {
  if (!exact(value, ["contractVersion", "registryHash", "definitions", "authority"])
    || value.contractVersion !== "category-profile-lifecycle/1.0.0" || typeof value.registryHash !== "string"
    || !HASH.test(value.registryHash) || !Array.isArray(value.definitions) || value.definitions.length > 20_000
    || !value.definitions.every((entry) =>
      exact(entry, ["dimensionRef", "dimensionKey", "definitionRef", "label", "description", "currentProfile"])
      && typeof entry.dimensionRef === "string" && DIMENSION_REF.test(entry.dimensionRef)
      && typeof entry.dimensionKey === "string" && DIMENSION_KEY.test(entry.dimensionKey)
      && typeof entry.definitionRef === "string" && DEFINITION_REF.test(entry.definitionRef)
      && boundedText(entry.label, 200) && boundedText(entry.description, 2_000, true)
      && (entry.currentProfile === null || profile(entry.currentProfile) && entry.currentProfile.categoryRef === entry.definitionRef))
    || !authority(value.authority)) throw new ProfileStudioError("unsafe_response",
      "Kategori profili kaynağı güvenli sözleşmeyi döndürmedi.");
  const definitions = value.definitions as readonly Definition[];
  if (new Set(definitions.map((entry) => entry.definitionRef)).size !== definitions.length
    || new Set(definitions.flatMap((entry) => entry.currentProfile ? [entry.currentProfile.profileRef] : [])).size
      !== definitions.filter((entry) => entry.currentProfile).length) {
    throw new ProfileStudioError("unsafe_response", "Kategori profili kaynağı benzersiz ref sözleşmesini bozdu.");
  }
  return value as unknown as CategoryProfileStudioSnapshot;
}
export async function loadCategoryProfileStudioSnapshot(request: typeof fetch = fetch) {
  const response = await request("/api/category-profiles", { cache: "no-store", credentials: "same-origin",
    headers: { "X-ReklamZeka-Intent": "category-profile-read" } });
  let payload: unknown = null; try { payload = await response.json(); } catch { /* public fallback */ }
  if (!response.ok) throw new ProfileStudioError(String(response.status), object(payload) && object(payload.error)
    && typeof payload.error.message === "string" ? payload.error.message : "Kategori profili kaynağı kullanılamıyor.");
  return parseCategoryProfileStudioSnapshot(payload);
}
export async function runCategoryProfileMutation(command: CategoryProfileCommand, request: typeof fetch = fetch) {
  const response = await request("/api/category-profiles", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "category-profile-mutate" },
    body: JSON.stringify({ command }) });
  let payload: unknown = null; try { payload = await response.json(); } catch { /* public fallback */ }
  if (!response.ok) throw new ProfileStudioError(response.status === 409 ? "conflict" : String(response.status),
    object(payload) && object(payload.error) && typeof payload.error.message === "string"
      ? payload.error.message : "Kategori profili işlemi tamamlanamadı.");
  if (!object(payload) || payload.canPublishPolicy !== false || payload.canAuthorizeAction !== false
    || payload.canExecute !== false || payload.canWriteMeta !== false || !authority(payload.authority)) {
    throw new ProfileStudioError("unsafe_response", "Kategori profili mutation yanıtı güvenli authority sınırını korumadı.");
  }
}

type Draft = Readonly<{ parentDefinitionRef: string; label: string; description: string; color: string;
  bindings: Readonly<Record<BindingKey, string>> }>;
const EMPTY_BINDINGS = Object.freeze(Object.fromEntries(BINDING_KEYS.map((key) => [key, ""]))) as Draft["bindings"];
function fromDefinition(definition: Definition): Draft {
  const current = definition.currentProfile;
  return { parentDefinitionRef: current?.parentCategoryRef ?? "", label: current?.label ?? definition.label,
    description: current?.description ?? definition.description ?? "Kategori profili açıklaması",
    color: current?.color ?? "#2C7A5B", bindings: current ? Object.freeze(Object.fromEntries(BINDING_KEYS.map((key) =>
      [key, current.bindings[key].join("\n")]))) as Draft["bindings"] : EMPTY_BINDINGS };
}
function parseRefs(value: string): readonly string[] {
  return Object.freeze(value.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean).sort());
}
function draftBindings(draft: Draft): Bindings {
  return Object.freeze(Object.fromEntries(BINDING_KEYS.map((key) => [key, parseRefs(draft.bindings[key])]))) as Bindings;
}
export function buildCategoryProfileCommand(snapshot: CategoryProfileStudioSnapshot, definition: Definition,
  draft: Draft, operation: CategoryProfileCommand["operation"], reasonCode = "owner_reviewed"): CategoryProfileCommand | null {
  const current = definition.currentProfile; const editable = { parentDefinitionRef: draft.parentDefinitionRef || null,
    label: draft.label.trim(), description: draft.description.trim(), color: draft.color, bindings: draftBindings(draft) };
  const valid = editable.label && editable.description && /^#[0-9A-F]{6}$/.test(editable.color)
    && editable.bindings.analysisPlaybookRefs.length > 0;
  if (operation === "create_draft") return snapshot.authority.canCreate && !current && valid
    ? { operation, definitionRef: definition.definitionRef, ...editable, expectedRegistryHash: snapshot.registryHash } : null;
  if (!current) return null;
  if (operation === "revise_draft") return snapshot.authority.canRevise && current.status === "draft" && valid
    ? { operation, profileRef: current.profileRef, ...editable, expectedVersion: current.version,
      expectedProfileHash: current.profileHash, expectedRegistryHash: snapshot.registryHash } : null;
  const allowed = operation === "publish" ? snapshot.authority.canPublish && (current.status === "draft" || current.status === "paused")
    : operation === "pause" ? snapshot.authority.canPause && current.status === "active"
      : snapshot.authority.canArchive && current.status !== "archived";
  return allowed && /^[a-z][a-z0-9_]{1,63}$/.test(reasonCode) ? { operation, profileRef: current.profileRef,
    expectedVersion: current.version, expectedProfileHash: current.profileHash,
    expectedRegistryHash: snapshot.registryHash, reasonCode } : null;
}

const BINDING_LABELS: Readonly<Record<BindingKey, string>> = {
  analysisPlaybookRefs: "Analysis playbook refs (zorunlu)", ruleInstructionBundleRefs: "Rule / instruction bundle refs",
  budgetPolicyRefs: "Budget policy refs", transferPolicyRefs: "Transfer policy refs",
  schedulePolicyRefs: "Schedule / cadence refs", actionPolicyRefs: "Action / guardrail refs",
  creativePolicyRefs: "Creative policy refs",
};

export function CategoryProfileStudioView(props: Readonly<{ snapshot: CategoryProfileStudioSnapshot; onReload(): Promise<void> }>) {
  const [selectedRef, setSelectedRef] = useState(props.snapshot.definitions[0]?.definitionRef ?? "");
  const selected = props.snapshot.definitions.find((entry) => entry.definitionRef === selectedRef) ?? props.snapshot.definitions[0] ?? null;
  const [draft, setDraft] = useState<Draft>(selected ? fromDefinition(selected) : { parentDefinitionRef: "", label: "",
    description: "", color: "#2C7A5B", bindings: EMPTY_BINDINGS });
  const [reasonCode, setReasonCode] = useState("owner_reviewed"); const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const parentOptions = useMemo(() => selected ? props.snapshot.definitions.filter((entry) =>
    entry.dimensionRef === selected.dimensionRef && entry.definitionRef !== selected.definitionRef) : [], [props.snapshot.definitions, selected]);
  const select = useCallback((definition: Definition) => {
    setSelectedRef(definition.definitionRef); setDraft(fromDefinition(definition)); setMessage(null);
  }, []);
  useEffect(() => {
    if (selected) setDraft(fromDefinition(selected));
  }, [selected?.currentProfile?.profileHash]);

  async function mutate(operation: CategoryProfileCommand["operation"]) {
    if (!selected || saving) return;
    const command = buildCategoryProfileCommand(props.snapshot, selected, draft, operation, reasonCode);
    if (!command) { setMessage("Bu rol, lifecycle durumu veya form profile mutation için hazır değil."); return; }
    setSaving(true); setMessage(null);
    try { await runCategoryProfileMutation(command); await props.onReload();
      setMessage(operation === "create_draft" ? "Profil taslağı oluşturuldu."
        : operation === "revise_draft" ? "Profil taslağı yeni sürümle kaydedildi."
          : operation === "publish" ? "Profil yayınlandı; önceki profile component geçersizleştirildi."
            : operation === "pause" ? "Profil duraklatıldı." : "Profil arşivlendi.");
    } catch (reason) { setMessage(reason instanceof ProfileStudioError && reason.code === "conflict"
      ? "Profil siz çalışırken değişti; görünümü yenileyip tekrar değerlendirin."
      : reason instanceof Error ? reason.message : "Kategori profili işlemi tamamlanamadı."); }
    finally { setSaving(false); }
  }

  return <section className={styles.studio} aria-label="Kategori profilleri">
    <header className={styles.header}><div><span className={styles.kicker}>CATEGORY PROFILE AUTHORING</span><h2>Kategori profilleri</h2>
      <p>Tanımın parent, görünüm ve typed policy bundle bağlarını append-only lifecycle ile yönetin.</p></div>
      <span className={styles.guard}>policy publish · action · Meta write yok</span></header>
    <p className={styles.boundary}><strong>Atomiklik sınırı:</strong> kategori tanımı ve profil ayrı mutation’lardır. Profilsiz tanım açıkça “profil bekliyor” görünür; bu yüzey tanım oluşturma/revizyonunu profile işlemiyle tek transaction gibi göstermez.</p>
    {!props.snapshot.definitions.length ? <p className={styles.empty}>Profil oluşturmak için önce aktif bir kategori tanımı gerekir.</p> : <div className={styles.workspace}>
      <div className={styles.index}>{props.snapshot.definitions.map((definition) => <button type="button"
        key={definition.definitionRef} data-active={selected?.definitionRef === definition.definitionRef} onClick={() => select(definition)}>
        <strong>{definition.label}</strong><span className={styles.status} data-status={definition.currentProfile?.status ?? "missing"}>
          {definition.currentProfile?.status ?? "profil bekliyor"}</span><small>{definition.dimensionKey} · {definition.definitionRef}</small></button>)}</div>
      {selected ? <div className={styles.editor}><div className={styles.row}><div><span className={styles.kicker}>PROFILE DETAIL</span>
        <h3>{selected.currentProfile?.label ?? selected.label}</h3><p>{selected.currentProfile
          ? `v${selected.currentProfile.version} · owner ${selected.currentProfile.ownerRef}` : "Henüz profile series yok"}</p></div>
        {selected.currentProfile ? <span className={styles.status} data-status={selected.currentProfile.status}>{selected.currentProfile.status}</span> : null}</div>
        {message ? <p className={styles.message} role="status">{message}</p> : null}
        <div className={styles.fields}><label>Parent kategori<select value={draft.parentDefinitionRef} disabled={saving || selected.currentProfile?.status !== "draft" && Boolean(selected.currentProfile)}
          onChange={(event) => setDraft((current) => ({ ...current, parentDefinitionRef: event.target.value }))}><option value="">Parent yok</option>
          {parentOptions.map((entry) => <option key={entry.definitionRef} value={entry.definitionRef}>{entry.label}</option>)}</select></label>
          <label>Renk<input type="text" pattern="#[0-9A-F]{6}" maxLength={7} value={draft.color}
            disabled={saving || selected.currentProfile?.status !== "draft" && Boolean(selected.currentProfile)}
            onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value.toUpperCase() }))} /></label>
          <label>Profil etiketi<input maxLength={200} value={draft.label} disabled={saving || selected.currentProfile?.status !== "draft" && Boolean(selected.currentProfile)}
            onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} /></label>
          <label data-wide="true">Profil açıklaması<textarea maxLength={2_000} value={draft.description}
            disabled={saving || selected.currentProfile?.status !== "draft" && Boolean(selected.currentProfile)}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label></div>
        <fieldset className={styles.bindings} disabled={saving || selected.currentProfile?.status !== "draft" && Boolean(selected.currentProfile)}><legend>7 typed policy ref bundle alanı</legend>
          {BINDING_KEYS.map((key) => <label key={key}>{BINDING_LABELS[key]}<textarea value={draft.bindings[key]}
            placeholder="Her satıra veya virgülle bir opaque ref" onChange={(event) => setDraft((current) => ({ ...current,
              bindings: { ...current.bindings, [key]: event.target.value } }))} /></label>)}</fieldset>
        <div className={styles.fields}><label>Lifecycle gerekçe kodu<input value={reasonCode} maxLength={64}
          pattern="[a-z][a-z0-9_]{1,63}" disabled={saving || !selected.currentProfile}
          onChange={(event) => setReasonCode(event.target.value)} /></label></div>
        <div className={styles.actions}><span>OCC: registry + profile version + profile hash</span>
          {!selected.currentProfile ? <button className={styles.primary} type="button" disabled={saving || !props.snapshot.authority.canCreate}
            onClick={() => void mutate("create_draft")}>Profil taslağı oluştur</button> : <>
            {selected.currentProfile.status === "draft" ? <button type="button" disabled={saving || !props.snapshot.authority.canRevise}
              onClick={() => void mutate("revise_draft")}>Taslak sürümü kaydet</button> : null}
            {(selected.currentProfile.status === "draft" || selected.currentProfile.status === "paused") ? <button className={styles.primary}
              type="button" disabled={saving || !props.snapshot.authority.canPublish} onClick={() => void mutate("publish")}>Profili yayınla</button> : null}
            {selected.currentProfile.status === "active" ? <button type="button" disabled={saving || !props.snapshot.authority.canPause}
              onClick={() => void mutate("pause")}>Duraklat</button> : null}
            {selected.currentProfile.status !== "archived" ? <button className={styles.danger} type="button"
              disabled={saving || !props.snapshot.authority.canArchive} onClick={() => void mutate("archive")}>Arşivle</button> : null}</>}
        </div></div> : null}
    </div>}
  </section>;
}

export function CategoryProfileStudio() {
  const [snapshot, setSnapshot] = useState<CategoryProfileStudioSnapshot | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => { setLoading(true); setError(null);
    try { setSnapshot(await loadCategoryProfileStudioSnapshot()); }
    catch (reason) { setSnapshot(null); setError(reason instanceof Error ? reason.message : "Kategori profili kaynağı kullanılamıyor."); }
    finally { setLoading(false); } }, []);
  useEffect(() => { void reload(); }, [reload]);
  if (loading) return <section className={styles.empty} aria-live="polite">Kategori profilleri yükleniyor…</section>;
  if (error || !snapshot) return <section className={styles.error} role="alert"><strong>Kategori profilleri kullanılamıyor.</strong>
    <p>{error ?? "Kategori profili kaynağı güvenli biçimde bağlanamadı."}</p><p>Policy publish, action ve Meta write kapalı kalır.</p>
    <button className={styles.retry} type="button" onClick={() => void reload()}>Tekrar dene</button></section>;
  return <CategoryProfileStudioView snapshot={snapshot} onReload={reload} />;
}
