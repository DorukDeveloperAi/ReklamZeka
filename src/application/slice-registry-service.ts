import { createSliceRevision, type SliceDefinitionDraft, type SliceRevision } from "@/domain/slices/slice-definition";

/** Server-resolved IDs are never accepted from a browser as tenant authority. */
export type SliceRegistryBindings = Readonly<{
  market: Readonly<{ dimensionRef: string; dimensionId: string; valueRef: string; valueId: string }>;
  predicates: readonly Readonly<{ dimensionRef: string; dimensionId: string; values: readonly Readonly<{ valueRef: string; valueId: string }>[] }> [];
  overrides: readonly Readonly<{
    operation: "include" | "exclude";
    entityLevel: "organization_campaign" | "campaign" | "ad_set";
    entityRef: string;
    organizationCampaignId?: string;
    campaignId?: string;
    adSetId?: string;
  }>[];
}>;

export type SliceRegistryRepository = Readonly<{
  create(input: Readonly<{ workspaceId: string; actorId: string; label: string; revision: SliceRevision; bindings: SliceRegistryBindings }>): Promise<Readonly<{ sliceId: string; revisionId: string }>>;
  publish(input: Readonly<{ workspaceId: string; actorId: string; sliceId: string; revision: SliceRevision; bindings: SliceRegistryBindings; expectedCurrent: Readonly<{ revisionId: string | null; definitionHash: string | null }> }>): Promise<Readonly<{ revisionId: string }>>;
  freeze(input: Readonly<{ workspaceId: string; revisionId: string; snapshot: import("@/domain/slices/slice-resolver").FrozenSliceSnapshot; members: readonly SliceRegistrySnapshotMember[] }>): Promise<Readonly<{ snapshotId: string }>>;
}>;

export type SliceRegistrySnapshotMember = Readonly<{
  entityRef: string;
  entityLevel: "organization_campaign" | "campaign" | "ad_set";
  organizationCampaignId?: string;
  campaignId?: string;
  adSetId?: string;
  reason: "dynamic_filter" | "explicit_include";
  marketEvidenceRefs: readonly string[];
  matchedDimensionIds: readonly string[];
  matchedDimensionEvidenceRefs: readonly string[];
}>;

export class SliceRegistryError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_binding") { super(`slice registry rejected: ${code}`); this.name = "SliceRegistryError"; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) throw new SliceRegistryError("invalid_binding"); return value; }
function label(value: unknown): string { if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > 160) throw new SliceRegistryError("invalid_input"); return value.trim(); }
function exact(value: unknown, names: readonly string[]): boolean { if (value === null || typeof value !== "object" || Array.isArray(value)) return false; const record = value as Record<string, unknown>; return Object.keys(record).length === names.length && Object.keys(record).every((key) => names.includes(key)); }
function refs(values: readonly string[]): readonly string[] { if (!values.every((value) => typeof value === "string" && /^[a-z][a-z0-9]{0,63}_[a-z0-9][a-z0-9_.:-]{0,190}$/.test(value))) throw new SliceRegistryError("invalid_binding"); return values; }
function bindings(value: SliceRegistryBindings, revision: SliceRevision): SliceRegistryBindings {
  if (!exact(value, ["market", "predicates", "overrides"]) || !exact(value.market, ["dimensionRef", "dimensionId", "valueRef", "valueId"]) || !Array.isArray(value.predicates) || !Array.isArray(value.overrides)) throw new SliceRegistryError("invalid_binding");
  if (value.market.dimensionRef !== revision.market.dimensionId || value.market.valueRef !== revision.market.valueId) throw new SliceRegistryError("invalid_binding");
  uuid(value.market.dimensionId); uuid(value.market.valueId);
  if (value.predicates.length !== revision.predicates.length) throw new SliceRegistryError("invalid_binding");
  for (const [index, predicate] of value.predicates.entries()) {
    const expected = revision.predicates[index];
    if (!expected || !exact(predicate, ["dimensionRef", "dimensionId", "values"]) || predicate.dimensionRef !== expected.dimensionId || !Array.isArray(predicate.values) || predicate.values.length !== expected.values.length) throw new SliceRegistryError("invalid_binding");
    uuid(predicate.dimensionId);
    for (const [valueIndex, item] of predicate.values.entries()) {
      const expectedValue = expected.values[valueIndex];
      if (!expectedValue || !exact(item, ["valueRef", "valueId"]) || item.valueRef !== expectedValue.valueId) throw new SliceRegistryError("invalid_binding");
      uuid(item.valueId);
    }
  }
  for (const override of value.overrides) {
    if (!exact(override, ["operation", "entityLevel", "entityRef", "organizationCampaignId", "campaignId", "adSetId"].filter((name) => name === "operation" || name === "entityLevel" || name === "entityRef" || (name === "organizationCampaignId" && "organizationCampaignId" in override) || (name === "campaignId" && "campaignId" in override) || (name === "adSetId" && "adSetId" in override)))) throw new SliceRegistryError("invalid_binding");
    const targets = [override.organizationCampaignId, override.campaignId, override.adSetId].filter((item) => item !== undefined);
    if (!["include", "exclude"].includes(override.operation) || targets.length !== 1) throw new SliceRegistryError("invalid_binding");
    refs([override.entityRef]);
    targets.forEach(uuid);
    if ((override.entityLevel === "organization_campaign") !== Boolean(override.organizationCampaignId)
      || (override.entityLevel === "campaign") !== Boolean(override.campaignId)
      || (override.entityLevel === "ad_set") !== Boolean(override.adSetId)) throw new SliceRegistryError("invalid_binding");
  }
  const overrideIdentity = value.overrides.map((item) => `${item.operation}\u0000${item.entityRef}`); if (new Set(overrideIdentity).size !== value.overrides.length || JSON.stringify(overrideIdentity) !== JSON.stringify([...overrideIdentity].sort())) throw new SliceRegistryError("invalid_binding");
  const expectedOverrides = [...revision.explicitIncludeEntityRefs.map((entityRef) => `include\u0000${entityRef}`), ...revision.explicitExcludeEntityRefs.map((entityRef) => `exclude\u0000${entityRef}`)].sort();
  if (JSON.stringify(overrideIdentity) !== JSON.stringify(expectedOverrides)) throw new SliceRegistryError("invalid_binding");
  return value;
}

/**
 * Application boundary for canonical Slice persistence. Resolution of public
 * category/entity refs to these server-owned IDs is intentionally a separate,
 * trusted read concern; no HTTP handler accepts this binding object directly.
 */
export class SliceRegistryService {
  constructor(private readonly repository: SliceRegistryRepository) {}
  async create(input: Readonly<{ workspaceId: string; actorId: string; label: unknown; draft: SliceDefinitionDraft; bindings: SliceRegistryBindings }>) {
    uuid(input.workspaceId); uuid(input.actorId); const revision = createSliceRevision(input.draft); const resolved = bindings(input.bindings, revision);
    return this.repository.create({ workspaceId: input.workspaceId, actorId: input.actorId, label: label(input.label), revision, bindings: resolved });
  }
  async publish(input: Readonly<{ workspaceId: string; actorId: string; sliceId: string; draft: SliceDefinitionDraft; bindings: SliceRegistryBindings; expectedCurrent: Readonly<{ revisionId: string | null; definitionHash: string | null }> }>) {
    uuid(input.workspaceId); uuid(input.actorId); uuid(input.sliceId); const revision = createSliceRevision(input.draft); const resolved = bindings(input.bindings, revision);
    if (!exact(input.expectedCurrent, ["revisionId", "definitionHash"]) || (input.expectedCurrent.revisionId === null) !== (input.expectedCurrent.definitionHash === null)) throw new SliceRegistryError("invalid_input");
    if (input.expectedCurrent.revisionId !== null) { uuid(input.expectedCurrent.revisionId); if (!/^[a-f0-9]{64}$/.test(input.expectedCurrent.definitionHash!)) throw new SliceRegistryError("invalid_input"); }
    return this.repository.publish({ workspaceId: input.workspaceId, actorId: input.actorId, sliceId: input.sliceId, revision, bindings: resolved, expectedCurrent: input.expectedCurrent });
  }
  async freeze(input: Readonly<{ workspaceId: string; revisionId: string; revision: Pick<SliceRevision, "sliceRef" | "revisionRef" | "definitionHash">; snapshot: import("@/domain/slices/slice-resolver").FrozenSliceSnapshot; bindings: readonly SliceRegistrySnapshotMember[] }>) {
    uuid(input.workspaceId); uuid(input.revisionId);
    const { replayFrozenSliceSnapshot } = await import("@/domain/slices/slice-resolver"); const snapshot = replayFrozenSliceSnapshot(input.snapshot);
    if (snapshot.sliceRef !== input.revision.sliceRef || snapshot.revisionRef !== input.revision.revisionRef || snapshot.definitionHash !== input.revision.definitionHash || snapshot.members.length !== input.bindings.length) throw new SliceRegistryError("invalid_binding");
    const members = input.bindings.map((binding, index) => {
      const expected = snapshot.members[index]; if (!expected || !exact(binding, ["entityRef", "entityLevel", "organizationCampaignId", "campaignId", "adSetId", "reason", "marketEvidenceRefs", "matchedDimensionIds", "matchedDimensionEvidenceRefs"].filter((name) => name === "entityRef" || name === "entityLevel" || name === "reason" || name === "marketEvidenceRefs" || name === "matchedDimensionIds" || name === "matchedDimensionEvidenceRefs" || (name === "organizationCampaignId" && "organizationCampaignId" in binding) || (name === "campaignId" && "campaignId" in binding) || (name === "adSetId" && "adSetId" in binding))) || binding.entityRef !== expected.entityRef || binding.entityLevel !== expected.entityLevel || binding.reason !== expected.reason || JSON.stringify(binding.marketEvidenceRefs) !== JSON.stringify(expected.marketEvidenceRefs) || JSON.stringify(binding.matchedDimensionIds) !== JSON.stringify(expected.matchedDimensionIds) || JSON.stringify(binding.matchedDimensionEvidenceRefs) !== JSON.stringify(expected.matchedDimensionEvidenceRefs)) throw new SliceRegistryError("invalid_binding");
      refs([binding.entityRef]); const targets = [binding.organizationCampaignId, binding.campaignId, binding.adSetId].filter((item) => item !== undefined); if (targets.length !== 1 || (binding.entityLevel === "organization_campaign") !== Boolean(binding.organizationCampaignId) || (binding.entityLevel === "campaign") !== Boolean(binding.campaignId) || (binding.entityLevel === "ad_set") !== Boolean(binding.adSetId)) throw new SliceRegistryError("invalid_binding"); targets.forEach(uuid); return binding;
    });
    return this.repository.freeze({ workspaceId: input.workspaceId, revisionId: input.revisionId, snapshot, members });
  }
}
