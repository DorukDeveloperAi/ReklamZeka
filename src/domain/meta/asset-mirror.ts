import { createHash } from "node:crypto";

export const META_ASSET_MIRROR_SCHEMA_VERSION = 1 as const;

export type MetaAssetType =
  | "facebook_page"
  | "instagram_account"
  | "pixel"
  | "dataset"
  | "app"
  | "whatsapp_account";

export type MetaAssetCapabilityStatus =
  | "verified"
  | "granted_unverified"
  | "permission_missing"
  | "unsupported"
  | "unknown";

export type MetaAssetCapability = Readonly<{
  operation: "read" | "advertise" | "promote_existing_post" | "measure" | "message";
  status: MetaAssetCapabilityStatus;
  reason: string | null;
}>;

export type MetaAssetOwnership = Readonly<{
  kind: "owned" | "shared" | "linked" | "accessible" | "unknown";
  ownerBusinessExternalId: string | null;
  evidence: string;
}>;

export type MetaAssetProvenance = Readonly<{
  sourceEdge: string;
  fetchedAt: string;
  sourceGraphVersion: string;
  fieldCatalogVersion: string;
  rawPayloadHash: string;
}>;

export type MetaMirroredAsset = Readonly<{
  externalAssetId: string;
  assetType: MetaAssetType;
  displayName: string | null;
  username: string | null;
  ownership: MetaAssetOwnership;
  capabilities: readonly MetaAssetCapability[];
  orphanReason: "parent_asset_unavailable" | "owner_unavailable" | null;
  provenance: MetaAssetProvenance;
}>;

export type MetaAssetEdge = Readonly<{
  sourceType: "connection" | "ad_account" | "business" | "asset";
  sourceExternalId: string;
  targetExternalAssetId: string;
  relationship:
    | "has_access_to_page"
    | "page_links_instagram"
    | "uses_pixel"
    | "owns_pixel"
    | "owns_dataset"
    | "owns_app"
    | "owns_whatsapp_business_account";
  provenance: MetaAssetProvenance;
}>;

export type MetaAssetDiscovery = Readonly<{
  resource: "ad_accounts" | "pages" | "pixels" | "datasets" | "apps" | "whatsapp_business_accounts";
  sourceType: "connection" | "ad_account" | "business";
  sourceExternalId: string | null;
  status: "verified" | "empty" | "permission_missing" | "unsupported" | "unavailable";
  reason: string | null;
  itemCount: number;
  provenance: MetaAssetProvenance;
}>;

export type MetaAssetMirrorSnapshotInput = Readonly<{
  schemaVersion: typeof META_ASSET_MIRROR_SCHEMA_VERSION;
  workspaceId: string;
  connectionExternalKey: string;
  adAccountExternalIds: readonly string[];
  assets: readonly MetaMirroredAsset[];
  edges: readonly MetaAssetEdge[];
  discoveries: readonly MetaAssetDiscovery[];
  fetchedAt: string;
  writeOperations: 0;
}>;

export type CanonicalMetaAssetMirrorSnapshot = MetaAssetMirrorSnapshotInput & Readonly<{
  snapshotHash: string;
}>;

export class MetaAssetMirrorValidationError extends Error {
  readonly entityReference: string;

  constructor(
    readonly code: "invalid_snapshot" | "duplicate_identity" | "orphan_edge" | "unredacted_public_id",
    entityExternalId: string,
    message: string,
  ) {
    super(message);
    this.name = "MetaAssetMirrorValidationError";
    this.entityReference = maskExternalId(entityExternalId);
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, stableValue(entryValue)]),
    );
  }
  return value;
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new MetaAssetMirrorValidationError("invalid_snapshot", value, `${label} zorunludur`);
}

function assertProvenance(provenance: MetaAssetProvenance, externalId: string): void {
  if (
    !provenance.sourceEdge.trim()
    || !provenance.sourceGraphVersion.trim()
    || !provenance.fieldCatalogVersion.trim()
    || !/^[a-f0-9]{64}$/.test(provenance.rawPayloadHash)
    || !Number.isFinite(Date.parse(provenance.fetchedAt))
  ) {
    throw new MetaAssetMirrorValidationError("invalid_snapshot", externalId, "Asset provenance eksik veya geçersiz");
  }
}

export function normalizeMetaAssetMirror(
  input: MetaAssetMirrorSnapshotInput,
): CanonicalMetaAssetMirrorSnapshot {
  if (input.schemaVersion !== META_ASSET_MIRROR_SCHEMA_VERSION || input.writeOperations !== 0) {
    throw new MetaAssetMirrorValidationError("invalid_snapshot", String(input.schemaVersion), "Asset mirror salt okunur olmalıdır");
  }
  assertNonEmpty(input.workspaceId, "Workspace ID");
  assertNonEmpty(input.connectionExternalKey, "Connection external key");
  if (!Number.isFinite(Date.parse(input.fetchedAt))) {
    throw new MetaAssetMirrorValidationError("invalid_snapshot", input.fetchedAt, "Fetch zamanı geçersiz");
  }

  const assetIds = new Set<string>();
  for (const asset of input.assets) {
    assertNonEmpty(asset.externalAssetId, "Asset external ID");
    const identity = `${asset.assetType}:${asset.externalAssetId}`;
    if (assetIds.has(asset.externalAssetId)) {
      throw new MetaAssetMirrorValidationError("duplicate_identity", identity, "Asset external ID snapshot içinde tekrarlanamaz");
    }
    assetIds.add(asset.externalAssetId);
    assertProvenance(asset.provenance, identity);
  }

  const accountIds = new Set(input.adAccountExternalIds);
  for (const edge of input.edges) {
    if (!assetIds.has(edge.targetExternalAssetId)) {
      throw new MetaAssetMirrorValidationError("orphan_edge", edge.targetExternalAssetId, "Asset edge hedefi snapshot içinde yok");
    }
    if (edge.sourceType === "asset" && !assetIds.has(edge.sourceExternalId)) {
      throw new MetaAssetMirrorValidationError("orphan_edge", edge.sourceExternalId, "Asset edge kaynağı snapshot içinde yok");
    }
    if (edge.sourceType === "ad_account" && !accountIds.has(edge.sourceExternalId)) {
      throw new MetaAssetMirrorValidationError("orphan_edge", edge.sourceExternalId, "Asset edge reklam hesabı snapshot içinde yok");
    }
    assertProvenance(edge.provenance, `${edge.sourceExternalId}:${edge.targetExternalAssetId}`);
  }
  for (const discovery of input.discoveries) {
    if (!Number.isInteger(discovery.itemCount) || discovery.itemCount < 0) {
      throw new MetaAssetMirrorValidationError(
        "invalid_snapshot",
        discovery.resource,
        "Discovery item count negatif olamaz",
      );
    }
    assertProvenance(
      discovery.provenance,
      `${discovery.sourceType}:${discovery.sourceExternalId ?? "connection"}:${discovery.resource}`,
    );
  }

  const canonical = stableValue({
    ...input,
    adAccountExternalIds: [...input.adAccountExternalIds].sort(),
    assets: [...input.assets].sort((left, right) =>
      `${left.assetType}:${left.externalAssetId}`.localeCompare(`${right.assetType}:${right.externalAssetId}`)),
    edges: [...input.edges].sort((left, right) =>
      `${left.sourceType}:${left.sourceExternalId}:${left.relationship}:${left.targetExternalAssetId}`
        .localeCompare(`${right.sourceType}:${right.sourceExternalId}:${right.relationship}:${right.targetExternalAssetId}`)),
    discoveries: [...input.discoveries].sort((left, right) =>
      `${left.resource}:${left.sourceType}:${left.sourceExternalId ?? ""}`
        .localeCompare(`${right.resource}:${right.sourceType}:${right.sourceExternalId ?? ""}`)),
  }) as MetaAssetMirrorSnapshotInput;
  const snapshotHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return { ...canonical, snapshotHash };
}

function maskExternalId(value: string): string {
  const raw = value.startsWith("act_") ? value.slice(4) : value;
  const prefix = value.startsWith("act_") ? "act_" : raw.slice(0, 4);
  return raw.length <= 4 ? `${prefix}…` : `${prefix}…${raw.slice(-4)}`;
}

export type PublicMetaAssetMirrorSnapshot = Readonly<{
  schemaVersion: typeof META_ASSET_MIRROR_SCHEMA_VERSION;
  accountIds: readonly string[];
  assetRows: readonly Readonly<{
    id: string;
    type: MetaAssetType;
    displayName: string | null;
    username: string | null;
    ownership: Readonly<{ kind: MetaAssetOwnership["kind"]; ownerBusinessId: string | null; evidence: string }>;
    capabilities: readonly MetaAssetCapability[];
    orphanReason: MetaMirroredAsset["orphanReason"];
  }>[];
  edgeRows: readonly Readonly<{
    sourceType: MetaAssetEdge["sourceType"];
    sourceId: string;
    targetId: string;
    relationship: MetaAssetEdge["relationship"];
  }>[];
  discoveries: readonly Readonly<{
    resource: MetaAssetDiscovery["resource"];
    sourceType: MetaAssetDiscovery["sourceType"];
    sourceId: string | null;
    status: MetaAssetDiscovery["status"];
    reason: string | null;
    itemCount: number;
  }>[];
  fetchedAt: string;
  writeOperations: 0;
  snapshotHash: string;
}>;

/** Produces the only UI/agent-safe view; provenance and full external IDs stay server-side. */
export function redactMetaAssetMirror(snapshot: CanonicalMetaAssetMirrorSnapshot): PublicMetaAssetMirrorSnapshot {
  return {
    schemaVersion: snapshot.schemaVersion,
    accountIds: snapshot.adAccountExternalIds.map(maskExternalId),
    assetRows: snapshot.assets.map((asset) => ({
      id: maskExternalId(asset.externalAssetId),
      type: asset.assetType,
      displayName: asset.displayName,
      username: asset.username,
      ownership: {
        kind: asset.ownership.kind,
        ownerBusinessId: asset.ownership.ownerBusinessExternalId
          ? maskExternalId(asset.ownership.ownerBusinessExternalId)
          : null,
        evidence: asset.ownership.evidence,
      },
      capabilities: asset.capabilities,
      orphanReason: asset.orphanReason,
    })),
    edgeRows: snapshot.edges.map((edge) => ({
      sourceType: edge.sourceType,
      sourceId: edge.sourceType === "connection" ? "[connection]" : maskExternalId(edge.sourceExternalId),
      targetId: maskExternalId(edge.targetExternalAssetId),
      relationship: edge.relationship,
    })),
    discoveries: snapshot.discoveries.map((discovery) => ({
      resource: discovery.resource,
      sourceType: discovery.sourceType,
      sourceId: discovery.sourceExternalId ? maskExternalId(discovery.sourceExternalId) : null,
      status: discovery.status,
      reason: discovery.reason,
      itemCount: discovery.itemCount,
    })),
    fetchedAt: snapshot.fetchedAt,
    writeOperations: 0,
    snapshotHash: snapshot.snapshotHash,
  };
}
