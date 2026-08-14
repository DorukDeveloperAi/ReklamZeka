import { createHash } from "node:crypto";

export const SKILL_CATALOG_VERSION = "skill-catalog/1.0.0" as const;
export const WORKSPACE_SKILL_CATALOG_BINDING_VERSION = "workspace-skill-catalog-binding/1.0.0" as const;
export const CORE_SKILL_MANIFESTS = Object.freeze([
  ["campaign_context_resolver", "CampaignContextResolver"],
  ["analysis_director", "AnalysisDirector"],
  ["budget_steward", "BudgetSteward"],
  ["rule_coach", "RuleCoach"],
  ["decision_cadence_guard", "DecisionCadenceGuard"],
  ["action_readiness_explainer", "ActionReadinessExplainer"],
  ["evidence_integrity_auditor", "EvidenceIntegrityAuditor"],
  ["cohort_comparator", "CohortComparator"],
  ["official_source_verifier", "OfficialSourceVerifier"],
] as const).map(([ref, name]) => Object.freeze({
  ref, name, version: "1.0.0", lifecycle: "released" as const,
  allowedIntents: Object.freeze(["read", "explain", "compare", "question"]),
  allowedReadTools: Object.freeze([] as string[]), allowedDraftTools: Object.freeze([] as string[]),
  negativeCapabilities: Object.freeze(["persist", "create_rule", "draft_policy", "alter_scope", "publish",
    "approve", "execute", "meta_write", "raw_meta", "raw_sql"]),
  outputContract: ref === "rule_coach" ? "evidence-matrix-only" : ref === "action_readiness_explainer"
    ? "risk-dependency-only" : "read-only-evidence",
  citationRequired: true,
  hash: "", // completed below after canonical fields are stable
})).map((manifest) => Object.freeze({ ...manifest,
  hash: createHash("sha256").update(JSON.stringify({ ...manifest, hash: undefined })).digest("hex"),
}));

export type CoreSkillManifest = (typeof CORE_SKILL_MANIFESTS)[number];
export const CLOSED_SKILL_AUTHORITY = Object.freeze({ canPersist: false, canCreateRule: false, canDraftPolicy: false,
  canAlterScope: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false });

export function coreSkillManifest(ref: string, version: string, hash: string): CoreSkillManifest {
  const manifest = CORE_SKILL_MANIFESTS.find((item) => item.ref === ref && item.version === version && item.hash === hash);
  if (!manifest) throw new Error("skill_catalog_mismatch");
  return manifest;
}

export function defaultSkillCatalogBinding() {
  const profile = { version: SKILL_CATALOG_VERSION, profileRef: "profile_release_default", revision: 1,
    profileHash: createHash("sha256").update(JSON.stringify(CORE_SKILL_MANIFESTS.map(({ ref, version, hash }) => ({ ref, version, hash })))).digest("hex") };
  const manifests = CORE_SKILL_MANIFESTS.map(({ ref, version, hash }) => Object.freeze({ ref, version, hash }));
  const bindingHash = createHash("sha256").update(JSON.stringify({ profile, manifests })).digest("hex");
  return Object.freeze({ profile, manifests: Object.freeze(manifests), bindingHash });
}

export type WorkspacePlaybookSnapshot = Readonly<{
  playbookRef: string;
  revision: number;
  playbookHash: string;
  sourceRef: string;
}>;
export type WorkspacePlaybookGuidance = Readonly<WorkspacePlaybookSnapshot & { title: string; body: string }>;
export type WorkspaceSkillCatalogBinding = Readonly<{
  profile: Readonly<{ version: typeof SKILL_CATALOG_VERSION; profileRef: string; revision: number; profileHash: string }>;
  manifests: readonly Readonly<{ ref: string; version: string; hash: string }>[];
  playbooks: readonly WorkspacePlaybookGuidance[];
  bindingHash: string;
}>;
export type WorkspaceSkillCatalogTurnSnapshot = Readonly<{
  profile: WorkspaceSkillCatalogBinding["profile"];
  manifests: WorkspaceSkillCatalogBinding["manifests"];
  playbooks: readonly WorkspacePlaybookSnapshot[];
  bindingHash: string;
}>;
export type UnavailableWorkspaceSkillCatalogTurnSnapshot = Readonly<{
  profile: Readonly<{ version: "unavailable_not_bound" }>;
  manifests: readonly never[];
  playbooks: readonly never[];
  bindingHash: "UNAVAILABLE_NOT_BOUND";
}>;

export class WorkspaceSkillCatalogBindingError extends Error {
  constructor() { super("workspace_skill_catalog_unavailable"); this.name = "WorkspaceSkillCatalogBindingError"; }
}

const PROFILE_REF = /^profile_[a-z0-9][a-z0-9_-]{0,86}$/;
const PLAYBOOK_REF = /^playbook_[a-z0-9][a-z0-9_-]{0,86}$/;
const SOURCE_REF = /^source_[a-z0-9_.:-]{1,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export const MAX_ACTIVE_PLAYBOOKS = 12;
export const MAX_PLAYBOOK_GUIDANCE_BYTES = 48 * 1024;

function bindingFail(): never { throw new WorkspaceSkillCatalogBindingError(); }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

/**
 * Builds the private, server-resolved catalog evidence for one turn. Playbook
 * bodies deliberately stay out of the ledger snapshots and are used only in
 * the bounded model prompt assembled by the conversation service.
 */
export function createWorkspaceSkillCatalogBinding(input: Readonly<{
  profile: Readonly<{ profileRef: string; revision: number; profileHash: string }>;
  manifests: readonly Readonly<{ ref: string; version: string; hash: string }>[];
  playbooks: readonly WorkspacePlaybookGuidance[];
}>): WorkspaceSkillCatalogBinding {
  if (!PROFILE_REF.test(input.profile.profileRef) || !Number.isSafeInteger(input.profile.revision)
    || input.profile.revision < 1 || !HASH.test(input.profile.profileHash)
    || input.manifests.length !== CORE_SKILL_MANIFESTS.length || input.playbooks.length > MAX_ACTIVE_PLAYBOOKS) bindingFail();
  const manifests = input.manifests.map((manifest) => {
    if (!exact(manifest, ["ref", "version", "hash"])) bindingFail();
    const found = coreSkillManifest(manifest.ref, manifest.version, manifest.hash);
    return Object.freeze({ ref: found.ref, version: found.version, hash: found.hash });
  }).sort((a, b) => a.ref.localeCompare(b.ref));
  if (new Set(manifests.map((manifest) => manifest.ref)).size !== CORE_SKILL_MANIFESTS.length) bindingFail();
  const playbooks = input.playbooks.map((playbook) => {
    if (!PLAYBOOK_REF.test(playbook.playbookRef) || !Number.isSafeInteger(playbook.revision) || playbook.revision < 1
      || !HASH.test(playbook.playbookHash) || !SOURCE_REF.test(playbook.sourceRef) || typeof playbook.title !== "string"
      || !playbook.title.trim() || playbook.title.length > 240 || CONTROL.test(playbook.title) || typeof playbook.body !== "string"
      || !playbook.body.trim() || playbook.body.length > 16_000 || CONTROL.test(playbook.body)) bindingFail();
    return Object.freeze({ playbookRef: playbook.playbookRef, revision: playbook.revision,
      playbookHash: playbook.playbookHash, sourceRef: playbook.sourceRef, title: playbook.title.trim(), body: playbook.body.trim() });
  }).sort((a, b) => a.playbookRef.localeCompare(b.playbookRef));
  if (new Set(playbooks.map((playbook) => playbook.playbookRef)).size !== playbooks.length
    || Buffer.byteLength(playbooks.map(({ title, body }) => `${title}\n${body}`).join("\n"), "utf8") > MAX_PLAYBOOK_GUIDANCE_BYTES) bindingFail();
  const profile = Object.freeze({ version: SKILL_CATALOG_VERSION, profileRef: input.profile.profileRef,
    revision: input.profile.revision, profileHash: input.profile.profileHash });
  const snapshots = playbooks.map(({ playbookRef, revision, playbookHash, sourceRef }) => Object.freeze({ playbookRef, revision, playbookHash, sourceRef }));
  const bindingHash = createHash("sha256").update(JSON.stringify({ profile, manifests, playbooks: snapshots })).digest("hex");
  return Object.freeze({ profile, manifests: Object.freeze(manifests), playbooks: Object.freeze(playbooks), bindingHash });
}

export function unavailableWorkspaceSkillCatalogBinding() {
  return Object.freeze({ profile: Object.freeze({ version: "unavailable_not_bound" }), manifests: Object.freeze([]),
    playbooks: Object.freeze([]), bindingHash: "UNAVAILABLE_NOT_BOUND" as const });
}

export function workspaceSkillCatalogTurnSnapshot(binding: WorkspaceSkillCatalogBinding): WorkspaceSkillCatalogTurnSnapshot {
  return Object.freeze({ profile: binding.profile, manifests: binding.manifests,
    playbooks: Object.freeze(binding.playbooks.map(({ playbookRef, revision, playbookHash, sourceRef }) =>
      Object.freeze({ playbookRef, revision, playbookHash, sourceRef }))), bindingHash: binding.bindingHash });
}
