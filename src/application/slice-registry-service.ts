import { createSliceRevision, type SliceDefinitionDraft, type SliceRevision } from "@/domain/slices/slice-definition";

/** Server-resolved IDs are never accepted from a browser as tenant authority. */
export type SliceRegistryBindings = Readonly<{
  marketDefinitionId: string;
  predicates: readonly Readonly<{ dimensionId: string; valueIds: readonly string[] }> [];
  overrides: readonly Readonly<{
    operation: "include" | "exclude";
    entityLevel: "organization_campaign" | "campaign" | "ad_set";
    organizationCampaignId?: string;
    campaignId?: string;
    adSetId?: string;
  }>[];
}>;

export type SliceRegistryRepository = Readonly<{
  create(input: Readonly<{ workspaceId: string; actorId: string; label: string; revision: SliceRevision; bindings: SliceRegistryBindings }>): Promise<Readonly<{ sliceId: string; revisionId: string }>>;
  publish(input: Readonly<{ workspaceId: string; actorId: string; sliceId: string; revision: SliceRevision; bindings: SliceRegistryBindings }>): Promise<Readonly<{ revisionId: string }>>;
  freeze(input: Readonly<{ workspaceId: string; actorId: string; revisionId: string; snapshot: import("@/domain/slices/slice-resolver").FrozenSliceSnapshot; members: readonly SliceRegistrySnapshotMember[] }>): Promise<Readonly<{ snapshotId: string }>>;
}>;

export type SliceRegistrySnapshotMember = Readonly<{
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
function bindings(value: SliceRegistryBindings, revision: SliceRevision): SliceRegistryBindings {
  if (!value || typeof value !== "object" || !Array.isArray(value.predicates) || !Array.isArray(value.overrides)) throw new SliceRegistryError("invalid_binding");
  uuid(value.marketDefinitionId);
  if (value.predicates.length !== revision.predicates.length) throw new SliceRegistryError("invalid_binding");
  for (const predicate of value.predicates) {
    uuid(predicate.dimensionId); if (!Array.isArray(predicate.valueIds) || predicate.valueIds.length === 0) throw new SliceRegistryError("invalid_binding");
    predicate.valueIds.forEach(uuid);
  }
  for (const override of value.overrides) {
    const targets = [override.organizationCampaignId, override.campaignId, override.adSetId].filter((item) => item !== undefined);
    if (!override || !["include", "exclude"].includes(override.operation) || targets.length !== 1) throw new SliceRegistryError("invalid_binding");
    targets.forEach(uuid);
    if ((override.entityLevel === "organization_campaign") !== Boolean(override.organizationCampaignId)
      || (override.entityLevel === "campaign") !== Boolean(override.campaignId)
      || (override.entityLevel === "ad_set") !== Boolean(override.adSetId)) throw new SliceRegistryError("invalid_binding");
  }
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
  async publish(input: Readonly<{ workspaceId: string; actorId: string; sliceId: string; draft: SliceDefinitionDraft; bindings: SliceRegistryBindings }>) {
    uuid(input.workspaceId); uuid(input.actorId); uuid(input.sliceId); const revision = createSliceRevision(input.draft); const resolved = bindings(input.bindings, revision);
    return this.repository.publish({ workspaceId: input.workspaceId, actorId: input.actorId, sliceId: input.sliceId, revision, bindings: resolved });
  }
}
