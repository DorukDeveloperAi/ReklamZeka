import { createHash } from "node:crypto";

export const META_COMPATIBILITY_ARTIFACT_VERSION = "meta-compatibility-artifact/1.0.0" as const;
export const META_COMPATIBILITY_DIMENSIONS = Object.freeze([
  "destination", "optimization", "placement", "special_category", "tracking",
] as const);

export type MetaCompatibilityDimension = (typeof META_COMPATIBILITY_DIMENSIONS)[number];
export type MetaCompatibilityArtifactState = "draft" | "reviewed" | "published" | "tombstoned";
export type MetaCompatibilityOutcome = "confirmed" | "rejected" | "unknown";
export type MetaCompatibilityAuthorRole = "owner" | "admin" | "analyst";
export type MetaCompatibilityReviewerRole = "owner" | "admin";

export type MetaCompatibilityMappingContent = Readonly<{
  kind: "mapping";
  scopeRef: string;
  internalRef: string;
  semanticRef: string;
  observedValueHash: string;
  constraintsHash: string;
}>;

export type MetaCompatibilityEvidenceContent = Readonly<{
  kind: "evidence";
  selectionHash: string;
  mapping: Readonly<{ artifactRef: string; revision: number; canonicalHash: string }> | null;
  mirrorSnapshotHash: string;
  fieldCatalogVersion: string;
  outcome: MetaCompatibilityOutcome;
  reasonCode: string;
  observedAt: string;
  freshUntil: string;
}>;

export type MetaCompatibilityArtifact = Readonly<{
  version: typeof META_COMPATIBILITY_ARTIFACT_VERSION;
  artifactRef: string;
  revision: number;
  workspaceRef: string;
  dimension: MetaCompatibilityDimension;
  state: MetaCompatibilityArtifactState;
  previousHash: string | null;
  content: MetaCompatibilityMappingContent | MetaCompatibilityEvidenceContent;
  provenance: Readonly<{
    normalizedByActorRef: string;
    normalizedByRole: MetaCompatibilityAuthorRole;
    sourceRefs: readonly string[];
    sourceHashes: readonly string[];
    reviewedByActorRef: string | null;
    reviewedByRole: MetaCompatibilityReviewerRole | null;
    reviewDecisionRef: string | null;
    reviewedAt: string | null;
    reviewBy: string | null;
    publishedByActorRef: string | null;
    publishedByRole: MetaCompatibilityReviewerRole | null;
    publicationDecisionRef: string | null;
    publishedAt: string | null;
    tombstonedByActorRef: string | null;
    tombstoneDecisionRef: string | null;
    tombstonedAt: string | null;
  }>;
  authority: Readonly<{
    canExecute: false;
    canWriteMeta: false;
    canGrantApproval: false;
    canCreatePolicy: false;
    canPromoteGuidance: false;
  }>;
  canonicalHash: string;
}>;

export type MetaCompatibilityDraftInput = Readonly<{
  artifactRef: string;
  revision: 1;
  workspaceRef: string;
  dimension: MetaCompatibilityDimension;
  content: MetaCompatibilityMappingContent | MetaCompatibilityEvidenceContent;
  normalizedBy: Readonly<{ actorRef: string; role: MetaCompatibilityAuthorRole }>;
  sourceRefs: readonly string[];
  sourceHashes: readonly string[];
}>;

export class MetaCompatibilityArtifactError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "invalid_transition"
    | "review_forbidden"
    | "publish_forbidden"
    | "tombstone_forbidden"
    | "corrupt_registry"
    | "workspace_scope_mismatch") {
    super("Meta uyumluluk kanıtı güvenli biçimde işlenemedi");
    this.name = "MetaCompatibilityArtifactError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const REASON = /^[a-z][a-z0-9_.:-]{0,126}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9./_-]{0,127}$/;
const AUTHORITY = Object.freeze({
  canExecute: false as const, canWriteMeta: false as const, canGrantApproval: false as const,
  canCreatePolicy: false as const, canPromoteGuidance: false as const,
});

function fail(code: MetaCompatibilityArtifactError["code"]): never { throw new MetaCompatibilityArtifactError(code); }

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}

function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)
    || /(token|secret|prompt|raw[_-]?(payload|request|response|json))/i.test(value)) fail("invalid_input");
  return value;
}

function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input"); return value; }
function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail("invalid_input");
  const parsed = new Date(value); if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) fail("invalid_input");
  return value;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function refs(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) fail("invalid_input");
  const result = value.map(ref); if (new Set(result).size !== result.length) fail("invalid_input");
  return Object.freeze([...result].sort());
}
function hashes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) fail("invalid_input");
  const result = value.map(hash); if (new Set(result).size !== result.length) fail("invalid_input");
  return Object.freeze([...result].sort());
}

function content(value: unknown, dimension: MetaCompatibilityDimension): MetaCompatibilityArtifact["content"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_input");
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "mapping") {
    exact(candidate, ["kind", "scopeRef", "internalRef", "semanticRef", "observedValueHash", "constraintsHash"]);
    return Object.freeze({ kind: "mapping", scopeRef: ref(candidate.scopeRef), internalRef: ref(candidate.internalRef),
      semanticRef: ref(candidate.semanticRef), observedValueHash: hash(candidate.observedValueHash), constraintsHash: hash(candidate.constraintsHash) });
  }
  if (candidate.kind === "evidence") {
    exact(candidate, ["kind", "selectionHash", "mapping", "mirrorSnapshotHash", "fieldCatalogVersion", "outcome", "reasonCode", "observedAt", "freshUntil"]);
    if (!["confirmed", "rejected", "unknown"].includes(candidate.outcome as string)
      || typeof candidate.reasonCode !== "string" || !REASON.test(candidate.reasonCode)
      || typeof candidate.fieldCatalogVersion !== "string" || !VERSION.test(candidate.fieldCatalogVersion)) fail("invalid_input");
    let mapping: MetaCompatibilityEvidenceContent["mapping"] = null;
    if (candidate.mapping !== null) {
      exact(candidate.mapping, ["artifactRef", "revision", "canonicalHash"]);
      if (!Number.isSafeInteger(candidate.mapping.revision) || (candidate.mapping.revision as number) < 1) fail("invalid_input");
      mapping = Object.freeze({ artifactRef: ref(candidate.mapping.artifactRef), revision: candidate.mapping.revision as number,
        canonicalHash: hash(candidate.mapping.canonicalHash) });
    }
    if (candidate.outcome !== "unknown" && mapping === null) fail("invalid_input");
    const observedAt = instant(candidate.observedAt); const freshUntil = instant(candidate.freshUntil);
    if (freshUntil <= observedAt) fail("invalid_input");
    return Object.freeze({ kind: "evidence", selectionHash: hash(candidate.selectionHash), mapping,
      mirrorSnapshotHash: hash(candidate.mirrorSnapshotHash), fieldCatalogVersion: candidate.fieldCatalogVersion,
      outcome: candidate.outcome as MetaCompatibilityOutcome, reasonCode: candidate.reasonCode,
      observedAt, freshUntil });
  }
  void dimension;
  fail("invalid_input");
}

function freezeArtifact(core: Omit<MetaCompatibilityArtifact, "canonicalHash">): MetaCompatibilityArtifact {
  const artifact = { ...core, content: Object.freeze({ ...core.content }), provenance: Object.freeze({ ...core.provenance,
    sourceRefs: Object.freeze([...core.provenance.sourceRefs]), sourceHashes: Object.freeze([...core.provenance.sourceHashes]) }), authority: AUTHORITY };
  return Object.freeze({ ...artifact, canonicalHash: digest(artifact) });
}

export function createMetaCompatibilityDraft(input: MetaCompatibilityDraftInput): MetaCompatibilityArtifact {
  exact(input, ["artifactRef", "revision", "workspaceRef", "dimension", "content", "normalizedBy", "sourceRefs", "sourceHashes"]);
  exact(input.normalizedBy, ["actorRef", "role"]);
  if (input.revision !== 1 || !META_COMPATIBILITY_DIMENSIONS.includes(input.dimension)
    || !["owner", "admin", "analyst"].includes(input.normalizedBy.role)) fail("invalid_input");
  const sourceRefs = refs(input.sourceRefs); const sourceHashes = hashes(input.sourceHashes);
  if (sourceRefs.length !== sourceHashes.length) fail("invalid_input");
  return freezeArtifact({
    version: META_COMPATIBILITY_ARTIFACT_VERSION, artifactRef: ref(input.artifactRef), revision: 1,
    workspaceRef: ref(input.workspaceRef), dimension: input.dimension, state: "draft", previousHash: null,
    content: content(input.content, input.dimension),
    provenance: Object.freeze({ normalizedByActorRef: ref(input.normalizedBy.actorRef), normalizedByRole: input.normalizedBy.role,
      sourceRefs, sourceHashes, reviewedByActorRef: null, reviewedByRole: null, reviewDecisionRef: null, reviewedAt: null, reviewBy: null,
      publishedByActorRef: null, publishedByRole: null, publicationDecisionRef: null, publishedAt: null,
      tombstonedByActorRef: null, tombstoneDecisionRef: null, tombstonedAt: null }), authority: AUTHORITY,
  });
}

export function reviewMetaCompatibilityArtifact(input: Readonly<{ draft: MetaCompatibilityArtifact; actor: Readonly<{ actorRef: string; role: MetaCompatibilityReviewerRole }>; decisionRef: string; reviewedAt: string; reviewBy: string }>): MetaCompatibilityArtifact {
  exact(input, ["draft", "actor", "decisionRef", "reviewedAt", "reviewBy"]); exact(input.actor, ["actorRef", "role"]);
  const draft = assertValidMetaCompatibilityArtifact(input.draft); if (draft.state !== "draft") fail("invalid_transition");
  if (!(["owner", "admin"] as const).includes(input.actor.role)) fail("review_forbidden");
  const reviewedAt = instant(input.reviewedAt); const reviewBy = instant(input.reviewBy); if (reviewBy <= reviewedAt) fail("invalid_input");
  return freezeArtifact({ ...withoutHash(draft), revision: draft.revision + 1, state: "reviewed", previousHash: draft.canonicalHash,
    provenance: Object.freeze({ ...draft.provenance, reviewedByActorRef: ref(input.actor.actorRef), reviewedByRole: input.actor.role,
      reviewDecisionRef: ref(input.decisionRef), reviewedAt, reviewBy }) });
}

export function publishMetaCompatibilityArtifact(input: Readonly<{ reviewed: MetaCompatibilityArtifact; actor: Readonly<{ actorRef: string; role: MetaCompatibilityReviewerRole }>; decisionRef: string; publishedAt: string }>): MetaCompatibilityArtifact {
  exact(input, ["reviewed", "actor", "decisionRef", "publishedAt"]); exact(input.actor, ["actorRef", "role"]);
  const reviewed = assertValidMetaCompatibilityArtifact(input.reviewed); if (reviewed.state !== "reviewed") fail("invalid_transition");
  if (!(["owner", "admin"] as const).includes(input.actor.role)) fail("publish_forbidden");
  const publishedAt = instant(input.publishedAt); if (reviewed.provenance.reviewedAt! > publishedAt || reviewed.provenance.reviewBy! <= publishedAt) fail("invalid_input");
  return freezeArtifact({ ...withoutHash(reviewed), revision: reviewed.revision + 1, state: "published", previousHash: reviewed.canonicalHash,
    provenance: Object.freeze({ ...reviewed.provenance, publishedByActorRef: ref(input.actor.actorRef), publishedByRole: input.actor.role,
      publicationDecisionRef: ref(input.decisionRef), publishedAt }) });
}

export function tombstoneMetaCompatibilityArtifact(input: Readonly<{ published: MetaCompatibilityArtifact; actor: Readonly<{ actorRef: string; role: MetaCompatibilityReviewerRole }>; decisionRef: string; tombstonedAt: string }>): MetaCompatibilityArtifact {
  exact(input, ["published", "actor", "decisionRef", "tombstonedAt"]); exact(input.actor, ["actorRef", "role"]);
  const published = assertValidMetaCompatibilityArtifact(input.published); if (published.state !== "published") fail("invalid_transition");
  if (!(["owner", "admin"] as const).includes(input.actor.role)) fail("tombstone_forbidden");
  const tombstonedAt = instant(input.tombstonedAt); if (published.provenance.publishedAt! > tombstonedAt) fail("invalid_input");
  return freezeArtifact({ ...withoutHash(published), revision: published.revision + 1, state: "tombstoned", previousHash: published.canonicalHash,
    provenance: Object.freeze({ ...published.provenance, tombstonedByActorRef: ref(input.actor.actorRef),
      tombstoneDecisionRef: ref(input.decisionRef), tombstonedAt }) });
}

function withoutHash(artifact: MetaCompatibilityArtifact): Omit<MetaCompatibilityArtifact, "canonicalHash"> {
  const { canonicalHash: _hash, ...core } = artifact; return core;
}

export function assertValidMetaCompatibilityArtifact(value: unknown): MetaCompatibilityArtifact {
  exact(value, ["version", "artifactRef", "revision", "workspaceRef", "dimension", "state", "previousHash", "content", "provenance", "authority", "canonicalHash"]);
  exact(value.provenance, ["normalizedByActorRef", "normalizedByRole", "sourceRefs", "sourceHashes", "reviewedByActorRef", "reviewedByRole", "reviewDecisionRef", "reviewedAt", "reviewBy", "publishedByActorRef", "publishedByRole", "publicationDecisionRef", "publishedAt", "tombstonedByActorRef", "tombstoneDecisionRef", "tombstonedAt"]);
  exact(value.authority, ["canExecute", "canWriteMeta", "canGrantApproval", "canCreatePolicy", "canPromoteGuidance"]);
  if (value.version !== META_COMPATIBILITY_ARTIFACT_VERSION || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || !META_COMPATIBILITY_DIMENSIONS.includes(value.dimension as MetaCompatibilityDimension)
    || !["draft", "reviewed", "published", "tombstoned"].includes(value.state as string)
    || Object.values(value.authority).some((entry) => entry !== false)) fail("invalid_input");
  const sourceRefs = refs(value.provenance.sourceRefs); const sourceHashes = hashes(value.provenance.sourceHashes);
  if (sourceRefs.length !== sourceHashes.length) fail("invalid_input");
  if (!["owner", "admin", "analyst"].includes(value.provenance.normalizedByRole as string)
    || value.provenance.reviewedByRole !== null && !["owner", "admin"].includes(value.provenance.reviewedByRole as string)
    || value.provenance.publishedByRole !== null && !["owner", "admin"].includes(value.provenance.publishedByRole as string)) fail("invalid_input");
  const state = value.state as MetaCompatibilityArtifactState;
  const reviewed = state !== "draft"; const published = state === "published" || state === "tombstoned"; const tombstoned = state === "tombstoned";
  const expectedRevision = state === "draft" ? 1 : state === "reviewed" ? 2 : state === "published" ? 3 : 4;
  const reviewValues = [value.provenance.reviewedByActorRef, value.provenance.reviewedByRole, value.provenance.reviewDecisionRef, value.provenance.reviewedAt, value.provenance.reviewBy];
  const publishValues = [value.provenance.publishedByActorRef, value.provenance.publishedByRole, value.provenance.publicationDecisionRef, value.provenance.publishedAt];
  const tombstoneValues = [value.provenance.tombstonedByActorRef, value.provenance.tombstoneDecisionRef, value.provenance.tombstonedAt];
  if (value.revision !== expectedRevision
    || (value.previousHash === null) !== (state === "draft") || value.previousHash !== null && !HASH.test(value.previousHash as string)
    || reviewed && reviewValues.some((entry) => entry === null) || !reviewed && reviewValues.some((entry) => entry !== null)
    || published && publishValues.some((entry) => entry === null) || !published && publishValues.some((entry) => entry !== null)
    || tombstoned && tombstoneValues.some((entry) => entry === null) || !tombstoned && tombstoneValues.some((entry) => entry !== null)) fail("invalid_input");
  if (reviewed && (value.provenance.reviewBy as string) <= (value.provenance.reviewedAt as string)
    || published && ((value.provenance.publishedAt as string) < (value.provenance.reviewedAt as string)
      || (value.provenance.publishedAt as string) >= (value.provenance.reviewBy as string))
    || tombstoned && (value.provenance.tombstonedAt as string) < (value.provenance.publishedAt as string)) fail("invalid_input");
  const normalized = freezeArtifact({ version: META_COMPATIBILITY_ARTIFACT_VERSION, artifactRef: ref(value.artifactRef), revision: value.revision as number,
    workspaceRef: ref(value.workspaceRef), dimension: value.dimension as MetaCompatibilityDimension, state, previousHash: value.previousHash as string | null,
    content: content(value.content, value.dimension as MetaCompatibilityDimension), provenance: Object.freeze({
      normalizedByActorRef: ref(value.provenance.normalizedByActorRef), normalizedByRole: value.provenance.normalizedByRole as MetaCompatibilityAuthorRole,
      sourceRefs, sourceHashes,
      reviewedByActorRef: value.provenance.reviewedByActorRef === null ? null : ref(value.provenance.reviewedByActorRef),
      reviewedByRole: value.provenance.reviewedByRole as MetaCompatibilityReviewerRole | null,
      reviewDecisionRef: value.provenance.reviewDecisionRef === null ? null : ref(value.provenance.reviewDecisionRef),
      reviewedAt: value.provenance.reviewedAt === null ? null : instant(value.provenance.reviewedAt), reviewBy: value.provenance.reviewBy === null ? null : instant(value.provenance.reviewBy),
      publishedByActorRef: value.provenance.publishedByActorRef === null ? null : ref(value.provenance.publishedByActorRef),
      publishedByRole: value.provenance.publishedByRole as MetaCompatibilityReviewerRole | null,
      publicationDecisionRef: value.provenance.publicationDecisionRef === null ? null : ref(value.provenance.publicationDecisionRef),
      publishedAt: value.provenance.publishedAt === null ? null : instant(value.provenance.publishedAt),
      tombstonedByActorRef: value.provenance.tombstonedByActorRef === null ? null : ref(value.provenance.tombstonedByActorRef),
      tombstoneDecisionRef: value.provenance.tombstoneDecisionRef === null ? null : ref(value.provenance.tombstoneDecisionRef),
      tombstonedAt: value.provenance.tombstonedAt === null ? null : instant(value.provenance.tombstonedAt),
    }), authority: AUTHORITY });
  if (normalized.canonicalHash !== value.canonicalHash) fail("invalid_input"); return normalized;
}

export type MetaCompatibilityResolution = Readonly<{
  selectionHash: string;
  dimensions: readonly Readonly<{ dimension: MetaCompatibilityDimension; status: MetaCompatibilityOutcome; reasonCode: string; evidenceHash: string | null }> [];
  overallStatus: MetaCompatibilityOutcome;
  authority: typeof AUTHORITY;
}>;

export function resolveMetaCompatibility(input: Readonly<{ workspaceRef: string; selectionHash: string; evaluatedAt: string; artifacts: readonly MetaCompatibilityArtifact[] }>): MetaCompatibilityResolution {
  exact(input, ["workspaceRef", "selectionHash", "evaluatedAt", "artifacts"]); const workspaceRef = ref(input.workspaceRef);
  const selectionHash = hash(input.selectionHash); const evaluatedAt = instant(input.evaluatedAt);
  if (!Array.isArray(input.artifacts) || input.artifacts.length > 10_000) fail("invalid_input");
  const latest = new Map<string, MetaCompatibilityArtifact>();
  for (const raw of input.artifacts) {
    const artifact = assertValidMetaCompatibilityArtifact(raw); if (artifact.workspaceRef !== workspaceRef) fail("workspace_scope_mismatch");
    const current = latest.get(artifact.artifactRef);
    if (!current || artifact.revision > current.revision) latest.set(artifact.artifactRef, artifact);
    else if (artifact.revision === current.revision && artifact.canonicalHash !== current.canonicalHash) fail("corrupt_registry");
  }
  const mappings = new Map([...latest.values()].filter((item) => item.state === "published" && item.content.kind === "mapping"
      && item.provenance.reviewBy! > evaluatedAt)
    .map((item) => [item.artifactRef, item]));
  const dimensions = META_COMPATIBILITY_DIMENSIONS.map((dimension) => {
    const candidates = [...latest.values()].filter((item) => item.state === "published" && item.dimension === dimension
      && item.content.kind === "evidence" && item.content.selectionHash === selectionHash && item.content.observedAt <= evaluatedAt
      && item.content.freshUntil > evaluatedAt && item.provenance.reviewBy! > evaluatedAt);
    if (candidates.length !== 1) return Object.freeze({ dimension, status: "unknown" as const,
      reasonCode: candidates.length === 0 ? "compatibility.evidence_missing_or_stale" : "compatibility.evidence_conflict", evidenceHash: null });
    const evidence = candidates[0]!; const evidenceContent = evidence.content as MetaCompatibilityEvidenceContent;
    if (evidenceContent.mapping !== null) {
      const mapping = mappings.get(evidenceContent.mapping.artifactRef);
      if (!mapping || mapping.dimension !== dimension || mapping.revision !== evidenceContent.mapping.revision
        || mapping.canonicalHash !== evidenceContent.mapping.canonicalHash) return Object.freeze({ dimension, status: "unknown" as const,
        reasonCode: "compatibility.mapping_unavailable", evidenceHash: null });
    }
    return Object.freeze({ dimension, status: evidenceContent.outcome, reasonCode: evidenceContent.reasonCode, evidenceHash: evidence.canonicalHash });
  });
  const overallStatus: MetaCompatibilityOutcome = dimensions.some((item) => item.status === "rejected") ? "rejected"
    : dimensions.every((item) => item.status === "confirmed") ? "confirmed" : "unknown";
  return Object.freeze({ selectionHash, dimensions: Object.freeze(dimensions), overallStatus, authority: AUTHORITY });
}
