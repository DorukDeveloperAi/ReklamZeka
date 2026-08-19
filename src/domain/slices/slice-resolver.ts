import { compareSliceText, stableSliceHash, type CanonicalMarketKey, type SliceEntityLevel, type SliceRevision } from "./slice-definition";

export const SLICE_RESOLVER_VERSION = "slice-resolver/1.0.0" as const;

export type EntityDimensionEvidence = Readonly<{
  dimensionId: string;
  valueIds: readonly string[];
  /** The ids are authoritative for matching; keys are retained as explainable evidence. */
  valueKeys: readonly string[];
  evidenceRefs: readonly string[];
}>;
export type EntityMarketEvidence = Readonly<{
  state: "resolved" | "missing" | "ambiguous" | "conflicting";
  dimensionId?: string;
  valueId?: string;
  key?: CanonicalMarketKey;
  evidenceRefs: readonly string[];
}>;
export type SliceEntityCandidate = Readonly<{
  entityRef: string;
  entityLevel: SliceEntityLevel;
  market: EntityMarketEvidence;
  dimensions: readonly EntityDimensionEvidence[];
}>;

export type SliceMembershipReason =
  | "dynamic_filter"
  | "explicit_include"
  | "excluded_explicit"
  | "excluded_market_missing"
  | "excluded_market_ambiguous"
  | "excluded_market_conflicting"
  | "excluded_market_mismatch"
  | "excluded_no_match";
export type SliceMembershipEvaluation = Readonly<{
  entityRef: string;
  entityLevel: SliceEntityLevel;
  included: boolean;
  reason: SliceMembershipReason;
  marketEvidenceRefs: readonly string[];
  matchedDimensionIds: readonly string[];
  /** Exact category-assignment evidence used for all successful predicates. */
  matchedDimensionEvidenceRefs: readonly string[];
}>;
export type SliceResolution = Readonly<{
  version: typeof SLICE_RESOLVER_VERSION;
  sliceRef: string;
  revisionRef: string;
  definitionHash: string;
  resolvedAt: string;
  memberships: readonly SliceMembershipEvaluation[];
  included: readonly SliceMembershipEvaluation[];
}>;
export type FrozenSliceMember = Readonly<{
  entityRef: string;
  entityLevel: SliceEntityLevel;
  reason: "dynamic_filter" | "explicit_include";
  marketEvidenceRefs: readonly string[];
  matchedDimensionIds: readonly string[];
  matchedDimensionEvidenceRefs: readonly string[];
}>;
export type FrozenSliceSnapshot = Readonly<{
  version: typeof SLICE_RESOLVER_VERSION;
  sliceRef: string;
  revisionRef: string;
  definitionHash: string;
  resolvedAt: string;
  members: readonly FrozenSliceMember[];
  snapshotHash: string;
}>;

export class SliceResolverError extends Error {
  constructor(readonly code: "invalid_candidate" | "duplicate_candidate" | "invalid_timestamp" | "invalid_snapshot") {
    super(`Slice resolver rejected: ${code}`);
    this.name = "SliceResolverError";
  }
}

const REF = /^[a-z][a-z0-9]{0,63}_[a-z0-9][a-z0-9_.:-]{0,190}$/;
const KEY = /^[a-z][a-z0-9_.:-]{0,127}$/;
function fail(code: SliceResolverError["code"]): never { throw new SliceResolverError(code); }
function freeze<T>(value: T): T { return Object.freeze(value); }
function refs(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !REF.test(value))) fail("invalid_candidate");
  return freeze([...new Set(values)].sort(compareSliceText));
}
function timestamp(value: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("invalid_timestamp");
  return new Date(value).toISOString();
}
function candidate(candidate: SliceEntityCandidate): SliceEntityCandidate {
  if (!candidate || typeof candidate !== "object" || !REF.test(candidate.entityRef)
    || Object.keys(candidate).length !== 4
    || Object.keys(candidate).some((name) => !["entityRef", "entityLevel", "market", "dimensions"].includes(name))
    || !["organization_campaign", "campaign", "ad_set"].includes(candidate.entityLevel)
    || !candidate.market || !Array.isArray(candidate.market.evidenceRefs) || !Array.isArray(candidate.dimensions)) fail("invalid_candidate");
  const market = candidate.market;
  if (!["resolved", "missing", "ambiguous", "conflicting"].includes(market.state)
    || Object.keys(market).some((name) => !["state", "dimensionId", "valueId", "key", "evidenceRefs"].includes(name))) fail("invalid_candidate");
  if (market.state === "resolved") {
    if (Object.keys(market).length !== 5 || !market.dimensionId || !REF.test(market.dimensionId)
      || !market.valueId || !REF.test(market.valueId) || (market.key !== "yerli" && market.key !== "yabanci")) fail("invalid_candidate");
  } else if (Object.keys(market).length !== 2) fail("invalid_candidate");
  const dimensions: EntityDimensionEvidence[] = candidate.dimensions.map((dimension: EntityDimensionEvidence): EntityDimensionEvidence => {
    if (!dimension || typeof dimension !== "object" || !REF.test(dimension.dimensionId)
      || Object.keys(dimension).length !== 4
      || Object.keys(dimension).some((name) => !["dimensionId", "valueIds", "valueKeys", "evidenceRefs"].includes(name))
      || !Array.isArray(dimension.valueIds) || !Array.isArray(dimension.valueKeys) || !Array.isArray(dimension.evidenceRefs)
      || dimension.valueIds.length === 0 || dimension.valueIds.length !== dimension.valueKeys.length
      || dimension.valueIds.some((value: string) => !REF.test(value)) || dimension.valueKeys.some((value: string) => !KEY.test(value))) fail("invalid_candidate");
    return freeze({ dimensionId: dimension.dimensionId, valueIds: refs(dimension.valueIds), valueKeys: freeze([...new Set<string>(dimension.valueKeys)].sort(compareSliceText)), evidenceRefs: refs(dimension.evidenceRefs) });
  }).sort((left: EntityDimensionEvidence, right: EntityDimensionEvidence) => compareSliceText(left.dimensionId, right.dimensionId));
  if (new Set(dimensions.map((item) => item.dimensionId)).size !== dimensions.length) fail("invalid_candidate");
  return freeze({ entityRef: candidate.entityRef, entityLevel: candidate.entityLevel, market: freeze({ ...market, evidenceRefs: refs(market.evidenceRefs) }), dimensions: freeze(dimensions) });
}

function marketReason(revision: SliceRevision, value: SliceEntityCandidate): SliceMembershipReason | null {
  if (value.market.state === "missing") return "excluded_market_missing";
  if (value.market.state === "ambiguous") return "excluded_market_ambiguous";
  if (value.market.state === "conflicting") return "excluded_market_conflicting";
  if (value.market.dimensionId !== revision.market.dimensionId || value.market.valueId !== revision.market.valueId || value.market.key !== revision.market.key) return "excluded_market_mismatch";
  return null;
}
function matchesDynamic(revision: SliceRevision, value: SliceEntityCandidate): Readonly<{ ids: readonly string[]; evidenceRefs: readonly string[] }> | null {
  const ids: string[] = []; const evidenceRefs: string[] = [];
  for (const predicate of revision.predicates) {
    const evidence = value.dimensions.find((item) => item.dimensionId === predicate.dimensionId);
    if (!evidence || !predicate.values.some((allowed) => evidence.valueIds.includes(allowed.valueId))) return null;
    ids.push(predicate.dimensionId);
    evidenceRefs.push(...evidence.evidenceRefs);
  }
  return freeze({ ids: freeze(ids), evidenceRefs: refs(evidenceRefs) });
}

/** Resolves an input set deterministically; the caller supplies tenant-bound facts through a port. */
export function resolveSlice(input: Readonly<{ revision: SliceRevision; candidates: readonly SliceEntityCandidate[]; resolvedAt: string }>): SliceResolution {
  const resolvedAt = timestamp(input.resolvedAt);
  const candidates = input.candidates.map(candidate).sort((left, right) => compareSliceText(left.entityRef, right.entityRef) || compareSliceText(left.entityLevel, right.entityLevel));
  if (new Set(candidates.map((item) => item.entityRef)).size !== candidates.length) fail("duplicate_candidate");
  const excluded = new Set(input.revision.explicitExcludeEntityRefs);
  const included = new Set(input.revision.explicitIncludeEntityRefs);
  const memberships = candidates.map((value) => {
    const market = marketReason(input.revision, value);
    const dynamic = matchesDynamic(input.revision, value);
    const matchedDimensionIds = dynamic?.ids ?? freeze([]);
    const matchedDimensionEvidenceRefs = dynamic?.evidenceRefs ?? freeze([]);
    let reason: SliceMembershipReason;
    let isIncluded = false;
    if (excluded.has(value.entityRef)) reason = "excluded_explicit";
    else if (market) reason = market;
    else if (included.has(value.entityRef)) { reason = "explicit_include"; isIncluded = true; }
    else if (matchedDimensionIds.length > 0 || input.revision.predicates.length === 0) { reason = "dynamic_filter"; isIncluded = true; }
    else reason = "excluded_no_match";
    return freeze({ entityRef: value.entityRef, entityLevel: value.entityLevel, included: isIncluded, reason,
      marketEvidenceRefs: value.market.evidenceRefs, matchedDimensionIds, matchedDimensionEvidenceRefs });
  });
  const frozenMemberships = freeze(memberships);
  return freeze({ version: SLICE_RESOLVER_VERSION, sliceRef: input.revision.sliceRef, revisionRef: input.revision.revisionRef,
    definitionHash: input.revision.definitionHash, resolvedAt, memberships: frozenMemberships,
    included: freeze(frozenMemberships.filter((item) => item.included)) });
}

/** Captures only the exact membership and evidence used by this run. */
export function buildFrozenSliceSnapshot(resolution: SliceResolution): FrozenSliceSnapshot {
  const members = resolution.included.map((item) => freeze({ entityRef: item.entityRef, entityLevel: item.entityLevel,
    reason: item.reason as "dynamic_filter" | "explicit_include", marketEvidenceRefs: freeze([...item.marketEvidenceRefs]),
    matchedDimensionIds: freeze([...item.matchedDimensionIds]), matchedDimensionEvidenceRefs: freeze([...item.matchedDimensionEvidenceRefs]) }));
  const body = { version: SLICE_RESOLVER_VERSION, sliceRef: resolution.sliceRef, revisionRef: resolution.revisionRef,
    definitionHash: resolution.definitionHash, resolvedAt: resolution.resolvedAt, members: freeze(members) } as const;
  return freeze({ ...body, snapshotHash: stableSliceHash(body) });
}

/** Replays the frozen evidence only; later catalogue or entity changes are not consulted. */
export function replayFrozenSliceSnapshot(snapshot: FrozenSliceSnapshot): FrozenSliceSnapshot {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || Object.keys(snapshot).length !== 7 || Object.keys(snapshot).some((key) => !["version", "sliceRef", "revisionRef", "definitionHash", "resolvedAt", "members", "snapshotHash"].includes(key))
    || snapshot.version !== SLICE_RESOLVER_VERSION || !REF.test(snapshot.sliceRef) || !REF.test(snapshot.revisionRef)
    || typeof snapshot.definitionHash !== "string" || !/^[a-f0-9]{64}$/.test(snapshot.definitionHash)
    || typeof snapshot.snapshotHash !== "string" || !/^[a-f0-9]{64}$/.test(snapshot.snapshotHash)
    || !Array.isArray(snapshot.members) || !isCanonicalSnapshotTimestamp(snapshot.resolvedAt)) fail("invalid_snapshot");
  const members = snapshot.members.map(snapshotMember);
  if (!isStrictlyOrdered(members, (member) => `${member.entityRef}\u0000${member.entityLevel}`)
    || new Set(members.map((member) => member.entityRef)).size !== members.length) fail("invalid_snapshot");
  const body = { version: snapshot.version, sliceRef: snapshot.sliceRef, revisionRef: snapshot.revisionRef,
    definitionHash: snapshot.definitionHash, resolvedAt: snapshot.resolvedAt, members: snapshot.members };
  if (stableSliceHash(body) !== snapshot.snapshotHash) fail("invalid_snapshot");
  return freeze({ ...body, members: freeze(members.map((member) => freeze({ ...member,
    marketEvidenceRefs: freeze([...member.marketEvidenceRefs]), matchedDimensionIds: freeze([...member.matchedDimensionIds]),
    matchedDimensionEvidenceRefs: freeze([...member.matchedDimensionEvidenceRefs]) }))), snapshotHash: snapshot.snapshotHash });
}

function isCanonicalSnapshotTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function isStrictlyOrdered<T>(values: readonly T[], text: (value: T) => string): boolean {
  return values.every((value, index) => index === 0 || compareSliceText(text(values[index - 1]!), text(value)) < 0);
}
function canonicalSnapshotRefs(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !REF.test(item))
    || !isStrictlyOrdered(value, (item) => item) || new Set(value).size !== value.length) fail("invalid_snapshot");
  return freeze([...value]);
}
function snapshotMember(value: unknown): FrozenSliceMember {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 6
    || Object.keys(value).some((key) => !["entityRef", "entityLevel", "reason", "marketEvidenceRefs", "matchedDimensionIds", "matchedDimensionEvidenceRefs"].includes(key))) fail("invalid_snapshot");
  const member = value as Record<string, unknown>;
  if (typeof member.entityRef !== "string" || !REF.test(member.entityRef)
    || !(member.entityLevel === "organization_campaign" || member.entityLevel === "campaign" || member.entityLevel === "ad_set")
    || !(member.reason === "dynamic_filter" || member.reason === "explicit_include")) fail("invalid_snapshot");
  return freeze({ entityRef: member.entityRef, entityLevel: member.entityLevel, reason: member.reason,
    marketEvidenceRefs: canonicalSnapshotRefs(member.marketEvidenceRefs), matchedDimensionIds: canonicalSnapshotRefs(member.matchedDimensionIds),
    matchedDimensionEvidenceRefs: canonicalSnapshotRefs(member.matchedDimensionEvidenceRefs) });
}
