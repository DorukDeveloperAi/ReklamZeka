import { createHash } from "node:crypto";

export const META_POST_MEDIA_INVENTORY_SCHEMA_VERSION = 1 as const;

export type MetaContentActorType = "facebook_page" | "instagram_account";
export type MetaContentKind = "page_post" | "instagram_media";
export type MetaContentLifecycle = "published" | "hidden" | "expired" | "unknown";
export type MetaContentMediaType = "text" | "image" | "video" | "carousel" | "link" | "unknown";
export type MetaContentDiscoveryStatus = "verified" | "empty" | "partial" | "permission_missing" | "unavailable";

export type MetaPostMediaProvenance = Readonly<{
  sourceEdge: string;
  sourceGraphVersion: string;
  fieldCatalogVersion: string;
  fetchedAt: string;
  rawPayloadHash: string;
}>;

export type MetaPostMediaItem = Readonly<{
  externalContentId: string;
  contentKind: MetaContentKind;
  actor: Readonly<{
    type: MetaContentActorType;
    externalId: string;
    displayName: string | null;
    username: string | null;
  }>;
  messageOrCaption: string | null;
  mediaType: MetaContentMediaType;
  publishedAt: string | null;
  lifecycle: MetaContentLifecycle;
  contentHash: string;
  ownership: Readonly<{
    kind: "accessible" | "linked";
    evidence: "/me/accounts" | "facebook_page.instagram_business_account";
  }>;
  readCapability: Readonly<{
    status: "verified";
    evidence: "edge_read_succeeded";
  }>;
  promotionEligibility: Readonly<{
    status: "unknown";
    reason: "not_verified_by_inventory_read";
  }>;
  previewSource: Readonly<{
    classification: "server_only_sensitive";
    permalink: string | null;
  }>;
  provenance: MetaPostMediaProvenance;
}>;

export type MetaPostMediaDiscovery = Readonly<{
  actorType: MetaContentActorType;
  actorExternalId: string;
  sourceEdge: string;
  status: MetaContentDiscoveryStatus;
  itemCount: number;
  reason: "permission_missing" | "temporarily_unavailable" | "pagination_limit" | null;
  promotionEligibility: "unknown" | "permission_missing";
}>;

export type MetaPostMediaInventoryInput = Readonly<{
  schemaVersion: typeof META_POST_MEDIA_INVENTORY_SCHEMA_VERSION;
  workspaceId: string;
  connectionExternalKey: string;
  fetchedAt: string;
  items: readonly MetaPostMediaItem[];
  discoveries: readonly MetaPostMediaDiscovery[];
  writeOperations: 0;
}>;

export type CanonicalMetaPostMediaInventory = MetaPostMediaInventoryInput & Readonly<{
  snapshotHash: string;
}>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function maskExternalId(value: string): string {
  const normalized = value.startsWith("act_") ? value.slice(4) : value;
  const prefix = value.startsWith("act_") ? "act_" : normalized.slice(0, 4);
  return normalized.length <= 4 ? `${prefix}…` : `${prefix}…${normalized.slice(-4)}`;
}

function assertIsoOrNull(value: string | null, label: string): void {
  if (value !== null && !Number.isFinite(Date.parse(value))) throw new TypeError(`${label} must be an ISO timestamp or null`);
}

export function contentHashFor(input: Readonly<{
  externalContentId: string;
  contentKind: MetaContentKind;
  actorType: MetaContentActorType;
  actorExternalId: string;
  messageOrCaption: string | null;
  mediaType: MetaContentMediaType;
  publishedAt: string | null;
  lifecycle: MetaContentLifecycle;
}>): string {
  return digest(input);
}

export function normalizeMetaPostMediaInventory(
  input: MetaPostMediaInventoryInput,
): CanonicalMetaPostMediaInventory {
  if (input.schemaVersion !== META_POST_MEDIA_INVENTORY_SCHEMA_VERSION || input.writeOperations !== 0) {
    throw new TypeError("Post/media inventory must use the current read-only schema");
  }
  if (!input.workspaceId.trim() || !input.connectionExternalKey.trim()) throw new TypeError("Workspace and connection are required");
  assertIsoOrNull(input.fetchedAt, "fetchedAt");

  const identities = new Set<string>();
  for (const item of input.items) {
    if (!item.externalContentId.trim() || !item.actor.externalId.trim()) throw new TypeError("Content and actor identity are required");
    const identity = `${item.contentKind}:${item.actor.type}:${item.actor.externalId}:${item.externalContentId}`;
    if (identities.has(identity)) throw new TypeError(`Duplicate post/media identity: ${maskExternalId(item.externalContentId)}`);
    identities.add(identity);
    assertIsoOrNull(item.publishedAt, "publishedAt");
    assertIsoOrNull(item.provenance.fetchedAt, "provenance.fetchedAt");
    if (!/^[a-f0-9]{64}$/.test(item.contentHash) || !/^[a-f0-9]{64}$/.test(item.provenance.rawPayloadHash)) {
      throw new TypeError("Content hashes must be SHA-256 values");
    }
    if (item.previewSource.permalink !== null) {
      const url = new URL(item.previewSource.permalink);
      if (url.protocol !== "https:") throw new TypeError("Sensitive preview source must use HTTPS");
    }
  }

  const canonical = stableValue({
    ...input,
    items: [...input.items].sort((left, right) =>
      `${left.contentKind}:${left.actor.type}:${left.actor.externalId}:${left.externalContentId}`
        .localeCompare(`${right.contentKind}:${right.actor.type}:${right.actor.externalId}:${right.externalContentId}`)),
    discoveries: [...input.discoveries].sort((left, right) =>
      `${left.actorType}:${left.actorExternalId}:${left.sourceEdge}`
        .localeCompare(`${right.actorType}:${right.actorExternalId}:${right.sourceEdge}`)),
  }) as MetaPostMediaInventoryInput;
  return { ...canonical, snapshotHash: digest(canonical) };
}

export type PublicMetaPostMediaInventory = Readonly<{
  schemaVersion: typeof META_POST_MEDIA_INVENTORY_SCHEMA_VERSION;
  items: readonly Readonly<{
    id: string;
    contentKind: MetaContentKind;
    actor: Readonly<{
      type: MetaContentActorType;
      id: string;
      displayName: string | null;
      username: string | null;
    }>;
    messageOrCaption: string | null;
    mediaType: MetaContentMediaType;
    publishedAt: string | null;
    lifecycle: MetaContentLifecycle;
    contentHash: string;
    previewAvailable: boolean;
    promotionEligibility: MetaPostMediaItem["promotionEligibility"];
  }>[];
  discoveries: readonly Readonly<{
    actorType: MetaContentActorType;
    actorId: string;
    status: MetaContentDiscoveryStatus;
    itemCount: number;
    reason: MetaPostMediaDiscovery["reason"];
    promotionEligibility: MetaPostMediaDiscovery["promotionEligibility"];
  }>[];
  fetchedAt: string;
  writeOperations: 0;
  snapshotHash: string;
}>;

/** Agent/UI-safe projection: full IDs, provenance and sensitive permalinks never cross this boundary. */
export function redactMetaPostMediaInventory(
  inventory: CanonicalMetaPostMediaInventory,
): PublicMetaPostMediaInventory {
  return {
    schemaVersion: inventory.schemaVersion,
    items: inventory.items.map((item) => ({
      id: maskExternalId(item.externalContentId),
      contentKind: item.contentKind,
      actor: {
        type: item.actor.type,
        id: maskExternalId(item.actor.externalId),
        displayName: item.actor.displayName,
        username: item.actor.username,
      },
      messageOrCaption: item.messageOrCaption,
      mediaType: item.mediaType,
      publishedAt: item.publishedAt,
      lifecycle: item.lifecycle,
      contentHash: item.contentHash,
      previewAvailable: item.previewSource.permalink !== null,
      promotionEligibility: item.promotionEligibility,
    })),
    discoveries: inventory.discoveries.map((discovery) => ({
      actorType: discovery.actorType,
      actorId: maskExternalId(discovery.actorExternalId),
      status: discovery.status,
      itemCount: discovery.itemCount,
      reason: discovery.reason,
      promotionEligibility: discovery.promotionEligibility,
    })),
    fetchedAt: inventory.fetchedAt,
    writeOperations: 0,
    snapshotHash: inventory.snapshotHash,
  };
}
