import { createHash } from "node:crypto";

export const SKILL_CATALOG_VERSION = "skill-catalog/1.0.0" as const;
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
