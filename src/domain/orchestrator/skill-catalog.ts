import { createHash } from "node:crypto";
import { isOfficialGuidanceSourceUrl } from "@/domain/guidance/registry";

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

export type WorkspacePlaybookSourceCitation = Readonly<{
  sourceTitle: string;
  sourceType: "owner_statement" | "official_meta_guidance" | "business_strategy" | "observed_result" | "experiment_outcome" | "operating_note";
  sourceUrl: string | null;
  freshness: "fresh" | "stale" | "not_scheduled";
}>;
export type WorkspacePlaybookSnapshot = Readonly<{
  playbookRef: string;
  revision: number;
  playbookHash: string;
  sourceRef: string;
  citation: WorkspacePlaybookSourceCitation;
}>;
export type WorkspacePlaybookGuidance = Readonly<WorkspacePlaybookSnapshot & { title: string; body: string }>;
export type WorkspaceInterviewKitGuidance = Readonly<{ kitRef: string; revision: number; kitHash: string; name: string; explanation: string; questions: readonly string[]; pages: readonly string[]; intents: readonly string[]; source: Readonly<{ title: string; url: string; version: number; recordHash: string; reviewBy: string }> }>;
export type WorkspaceSkillCatalogBinding = Readonly<{
  profile: Readonly<{ version: typeof SKILL_CATALOG_VERSION; profileRef: string; revision: number; profileHash: string }>;
  manifests: readonly Readonly<{ ref: string; version: string; hash: string }>[];
  playbooks: readonly WorkspacePlaybookGuidance[];
  interviewKits: readonly WorkspaceInterviewKitGuidance[];
  bindingHash: string;
}>;
export type WorkspaceSkillCatalogTurnSnapshot = Readonly<{
  profile: WorkspaceSkillCatalogBinding["profile"];
  manifests: WorkspaceSkillCatalogBinding["manifests"];
  playbooks: readonly WorkspacePlaybookSnapshot[];
  interviewKits: readonly Readonly<{ kitRef: string; revision: number; kitHash: string; source: Readonly<{ title: string; url: string; version: number; recordHash: string; reviewBy: string }> }>[];
  bindingHash: string;
}>;
export type UnavailableWorkspaceSkillCatalogTurnSnapshot = Readonly<{
  profile: Readonly<{ version: "unavailable_not_bound" }>;
  manifests: readonly never[]; playbooks: readonly never[]; interviewKits: readonly never[];
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
  playbooks: readonly WorkspacePlaybookGuidance[]; interviewKits?: readonly WorkspaceInterviewKitGuidance[];
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
      || !playbook.body.trim() || playbook.body.length > 16_000 || CONTROL.test(playbook.body)
      || !exact(playbook.citation, ["sourceTitle", "sourceType", "sourceUrl", "freshness"])
      || typeof playbook.citation.sourceTitle !== "string" || !playbook.citation.sourceTitle.trim()
      || playbook.citation.sourceTitle.length > 160 || CONTROL.test(playbook.citation.sourceTitle)
      || playbook.citation.sourceType !== "official_meta_guidance"
      || playbook.citation.freshness !== "fresh"
      || typeof playbook.citation.sourceUrl !== "string"
      || !isOfficialGuidanceSourceUrl(playbook.citation.sourceUrl)) bindingFail();
    return Object.freeze({ playbookRef: playbook.playbookRef, revision: playbook.revision,
      playbookHash: playbook.playbookHash, sourceRef: playbook.sourceRef, citation: Object.freeze({
        sourceTitle: playbook.citation.sourceTitle.trim(), sourceType: playbook.citation.sourceType as WorkspacePlaybookSourceCitation["sourceType"],
        sourceUrl: playbook.citation.sourceUrl, freshness: playbook.citation.freshness as WorkspacePlaybookSourceCitation["freshness"],
      }), title: playbook.title.trim(), body: playbook.body.trim() });
  }).sort((a, b) => a.playbookRef.localeCompare(b.playbookRef));
  if (new Set(playbooks.map((playbook) => playbook.playbookRef)).size !== playbooks.length
    || Buffer.byteLength(playbooks.map(({ title, body }) => `${title}\n${body}`).join("\n"), "utf8") > MAX_PLAYBOOK_GUIDANCE_BYTES) bindingFail();
  const interviewKits = (input.interviewKits ?? []).map((kit) => {
    if (!/^interview_kit_[a-f0-9]{32}$/.test(kit.kitRef) || !Number.isSafeInteger(kit.revision) || kit.revision < 1 || !HASH.test(kit.kitHash)
      || typeof kit.name !== "string" || !kit.name.trim() || typeof kit.explanation !== "string" || !kit.explanation.trim() || !Array.isArray(kit.questions) || kit.questions.length < 1 || kit.questions.length > 12
      || !Array.isArray(kit.pages) || !kit.pages.length || !Array.isArray(kit.intents) || !kit.intents.length || !exact(kit.source, ["title","url","version","recordHash","reviewBy"])
      || typeof kit.source.title !== "string" || !isOfficialGuidanceSourceUrl(kit.source.url) || !Number.isInteger(kit.source.version) || !HASH.test(kit.source.recordHash) || !Number.isFinite(Date.parse(kit.source.reviewBy))) bindingFail();
    return Object.freeze({ ...kit, questions: Object.freeze([...kit.questions]), pages: Object.freeze([...kit.pages]), intents: Object.freeze([...kit.intents]), source: Object.freeze({ ...kit.source }) });
  });
  const profile = Object.freeze({ version: SKILL_CATALOG_VERSION, profileRef: input.profile.profileRef,
    revision: input.profile.revision, profileHash: input.profile.profileHash });
  const snapshots = playbooks.map(({ playbookRef, revision, playbookHash, sourceRef, citation }) => Object.freeze({ playbookRef, revision, playbookHash, sourceRef, citation }));
  const bindingHash = createHash("sha256").update(JSON.stringify({ profile, manifests, playbooks: snapshots, interviewKits })).digest("hex");
  return Object.freeze({ profile, manifests: Object.freeze(manifests), playbooks: Object.freeze(playbooks), interviewKits: Object.freeze(interviewKits), bindingHash });
}

export function unavailableWorkspaceSkillCatalogBinding() {
  return Object.freeze({ profile: Object.freeze({ version: "unavailable_not_bound" }), manifests: Object.freeze([]),
    playbooks: Object.freeze([]), interviewKits: Object.freeze([]), bindingHash: "UNAVAILABLE_NOT_BOUND" as const });
}

export function workspaceSkillCatalogTurnSnapshot(binding: WorkspaceSkillCatalogBinding): WorkspaceSkillCatalogTurnSnapshot {
  return Object.freeze({ profile: binding.profile, manifests: binding.manifests,
    playbooks: Object.freeze(binding.playbooks.map(({ playbookRef, revision, playbookHash, sourceRef, citation }) =>
      Object.freeze({ playbookRef, revision, playbookHash, sourceRef, citation }))), interviewKits: Object.freeze(binding.interviewKits.map(({ kitRef, revision, kitHash, source }) => Object.freeze({ kitRef, revision, kitHash, source }))), bindingHash: binding.bindingHash });
}
