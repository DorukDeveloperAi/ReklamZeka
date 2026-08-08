import { createHash } from "node:crypto";
import { ConnectorError } from "@/connectors/contract";
import { MetaGraphClient, type MetaFetch } from "@/connectors/meta/graph-client";
import {
  META_ASSET_MIRROR_SCHEMA_VERSION,
  normalizeMetaAssetMirror,
  type CanonicalMetaAssetMirrorSnapshot,
  type MetaAssetCapability,
  type MetaAssetDiscovery,
  type MetaAssetEdge,
  type MetaAssetOwnership,
  type MetaAssetProvenance,
  type MetaAssetType,
  type MetaMirroredAsset,
} from "@/domain/meta/asset-mirror";

const META_ASSET_FIELD_CATALOG_VERSION = "meta-assets-v1";

type RawBusiness = Readonly<{ id?: string; name?: string }>;
type RawAdAccount = Readonly<{ id?: string; name?: string; business?: RawBusiness }>;
type RawInstagramAccount = Readonly<{ id?: string; username?: string; name?: string }>;
type RawPage = Readonly<{
  id?: string;
  name?: string;
  tasks?: readonly string[];
  instagram_business_account?: RawInstagramAccount;
}>;
type RawNamedAsset = Readonly<{ id?: string; name?: string; app_name?: string }>;

type DiscoveryResult<T> = Readonly<{
  rows: readonly T[];
  discovery: MetaAssetDiscovery;
}>;

export type DiscoverMetaAssetMirrorOptions = Readonly<{
  token: string;
  workspaceId: string;
  connectionExternalKey: string;
  fetchImpl?: MetaFetch;
  now?: () => Date;
}>;

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

function provenance(
  sourceEdge: string,
  raw: unknown,
  fetchedAt: string,
  graphVersion: string,
): MetaAssetProvenance {
  return {
    sourceEdge,
    fetchedAt,
    sourceGraphVersion: graphVersion,
    fieldCatalogVersion: META_ASSET_FIELD_CATALOG_VERSION,
    rawPayloadHash: createHash("sha256").update(JSON.stringify(stableValue(raw))).digest("hex"),
  };
}

function failureStatus(error: unknown): Pick<MetaAssetDiscovery, "status" | "reason"> {
  if (error instanceof ConnectorError) {
    if (error.code === "authentication") {
      return { status: "permission_missing", reason: "Meta bu varlık edge'i için erişim vermedi" };
    }
    if (error.code === "invalid_data") {
      return { status: "unsupported", reason: "Edge Graph sürümü veya bağlantı türü için desteklenmiyor" };
    }
  }
  return { status: "unavailable", reason: "Meta varlık edge'i geçici olarak okunamadı" };
}

async function discoverEdge<T>(
  client: MetaGraphClient,
  input: Readonly<{
    path: string;
    fields: string;
    resource: MetaAssetDiscovery["resource"];
    sourceType: MetaAssetDiscovery["sourceType"];
    sourceExternalId: string | null;
    fetchedAt: string;
  }>,
): Promise<DiscoveryResult<T>> {
  try {
    const rows = await client.listAll<T>(input.path, { fields: input.fields, limit: "100" });
    return {
      rows,
      discovery: {
        resource: input.resource,
        sourceType: input.sourceType,
        sourceExternalId: input.sourceExternalId,
        status: rows.length ? "verified" : "empty",
        reason: null,
        itemCount: rows.length,
        provenance: provenance(input.path, rows, input.fetchedAt, client.graphApiVersion),
      },
    };
  } catch (error) {
    const failure = failureStatus(error);
    return {
      rows: [],
      discovery: {
        resource: input.resource,
        sourceType: input.sourceType,
        sourceExternalId: input.sourceExternalId,
        ...failure,
        itemCount: 0,
        provenance: provenance(input.path, failure, input.fetchedAt, client.graphApiVersion),
      },
    };
  }
}

function capability(
  operation: MetaAssetCapability["operation"],
  status: MetaAssetCapability["status"],
  reason: string | null = null,
): MetaAssetCapability {
  return { operation, status, reason };
}

function mergeCapabilities(
  left: readonly MetaAssetCapability[],
  right: readonly MetaAssetCapability[],
): readonly MetaAssetCapability[] {
  const rank: Record<MetaAssetCapability["status"], number> = {
    verified: 5,
    granted_unverified: 4,
    permission_missing: 3,
    unsupported: 2,
    unknown: 1,
  };
  const merged = new Map<MetaAssetCapability["operation"], MetaAssetCapability>();
  for (const entry of [...left, ...right]) {
    const current = merged.get(entry.operation);
    if (!current || rank[entry.status] > rank[current.status]) merged.set(entry.operation, entry);
  }
  return [...merged.values()].sort((a, b) => a.operation.localeCompare(b.operation));
}

function strongerOwnership(left: MetaAssetOwnership, right: MetaAssetOwnership): MetaAssetOwnership {
  const rank: Record<MetaAssetOwnership["kind"], number> = {
    owned: 5,
    shared: 4,
    linked: 3,
    accessible: 2,
    unknown: 1,
  };
  return rank[right.kind] > rank[left.kind] ? right : left;
}

function addAsset(
  assets: Map<string, MetaMirroredAsset>,
  input: MetaMirroredAsset,
): void {
  const existing = assets.get(input.externalAssetId);
  if (!existing) {
    assets.set(input.externalAssetId, input);
    return;
  }
  assets.set(input.externalAssetId, {
    ...existing,
    displayName: existing.displayName ?? input.displayName,
    username: existing.username ?? input.username,
    ownership: strongerOwnership(existing.ownership, input.ownership),
    capabilities: mergeCapabilities(existing.capabilities, input.capabilities),
    orphanReason: existing.orphanReason ?? input.orphanReason,
  });
}

function addEdge(edges: Map<string, MetaAssetEdge>, edge: MetaAssetEdge): void {
  const key = `${edge.sourceType}:${edge.sourceExternalId}:${edge.relationship}:${edge.targetExternalAssetId}`;
  if (!edges.has(key)) edges.set(key, edge);
}

function validRows<T extends Readonly<{ id?: string }>>(rows: readonly T[]): readonly (T & { id: string })[] {
  return rows.filter((row): row is T & { id: string } => Boolean(row.id?.trim()));
}

/**
 * Reads the actor/destination asset graph. It intentionally exposes no mutation method;
 * every network operation is delegated to MetaGraphClient.get/listAll (HTTP GET only).
 */
export async function discoverMetaAssetMirror(
  options: DiscoverMetaAssetMirrorOptions,
): Promise<CanonicalMetaAssetMirrorSnapshot> {
  const client = new MetaGraphClient(options.token, options.fetchImpl);
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  const discoveries: MetaAssetDiscovery[] = [];
  const assets = new Map<string, MetaMirroredAsset>();
  const edges = new Map<string, MetaAssetEdge>();

  const accountResult = await discoverEdge<RawAdAccount>(client, {
    path: "/me/adaccounts",
    fields: "id,name,business{id,name}",
    resource: "ad_accounts",
    sourceType: "connection",
    sourceExternalId: null,
    fetchedAt,
  });
  discoveries.push(accountResult.discovery);
  const accounts = validRows(accountResult.rows);

  const pageResult = await discoverEdge<RawPage>(client, {
    path: "/me/accounts",
    fields: "id,name,tasks,instagram_business_account{id,username,name}",
    resource: "pages",
    sourceType: "connection",
    sourceExternalId: null,
    fetchedAt,
  });
  discoveries.push(pageResult.discovery);
  for (const page of validRows(pageResult.rows)) {
    const pageTrace = provenance("/me/accounts", page, fetchedAt, client.graphApiVersion);
    const canAdvertise = page.tasks?.includes("ADVERTISE") ?? false;
    addAsset(assets, {
      externalAssetId: page.id,
      assetType: "facebook_page",
      displayName: page.name ?? null,
      username: null,
      ownership: { kind: "accessible", ownerBusinessExternalId: null, evidence: "/me/accounts" },
      capabilities: [
        capability("read", "verified"),
        capability("advertise", canAdvertise ? "verified" : "unknown", canAdvertise ? null : "Page task listesinde ADVERTISE doğrulanmadı"),
      ],
      orphanReason: null,
      provenance: pageTrace,
    });
    addEdge(edges, {
      sourceType: "connection",
      sourceExternalId: options.connectionExternalKey,
      targetExternalAssetId: page.id,
      relationship: "has_access_to_page",
      provenance: pageTrace,
    });

    const instagram = page.instagram_business_account;
    if (!instagram?.id) continue;
    const instagramTrace = provenance(
      "/me/accounts.instagram_business_account",
      instagram,
      fetchedAt,
      client.graphApiVersion,
    );
    addAsset(assets, {
      externalAssetId: instagram.id,
      assetType: "instagram_account",
      displayName: instagram.name ?? null,
      username: instagram.username ?? null,
      ownership: { kind: "linked", ownerBusinessExternalId: null, evidence: "facebook_page.instagram_business_account" },
      capabilities: [
        capability("read", "verified"),
        capability(
          "promote_existing_post",
          canAdvertise ? "granted_unverified" : "unknown",
          "Post düzeyi promotion eligibility ayrıca doğrulanmalıdır",
        ),
      ],
      orphanReason: null,
      provenance: instagramTrace,
    });
    addEdge(edges, {
      sourceType: "asset",
      sourceExternalId: page.id,
      targetExternalAssetId: instagram.id,
      relationship: "page_links_instagram",
      provenance: instagramTrace,
    });
  }

  for (const account of accounts) {
    const pixelResult = await discoverEdge<RawNamedAsset>(client, {
      path: `/${account.id}/adspixels`,
      fields: "id,name,last_fired_time",
      resource: "pixels",
      sourceType: "ad_account",
      sourceExternalId: account.id,
      fetchedAt,
    });
    discoveries.push(pixelResult.discovery);
    for (const pixel of validRows(pixelResult.rows)) {
      const trace = provenance(`/${account.id}/adspixels`, pixel, fetchedAt, client.graphApiVersion);
      addAsset(assets, {
        externalAssetId: pixel.id,
        assetType: "pixel",
        displayName: pixel.name ?? null,
        username: null,
        ownership: {
          kind: account.business?.id ? "shared" : "unknown",
          ownerBusinessExternalId: account.business?.id ?? null,
          evidence: "ad_account.adspixels",
        },
        capabilities: [capability("read", "verified"), capability("measure", "verified")],
        orphanReason: account.business?.id ? null : "owner_unavailable",
        provenance: trace,
      });
      addEdge(edges, {
        sourceType: "ad_account",
        sourceExternalId: account.id,
        targetExternalAssetId: pixel.id,
        relationship: "uses_pixel",
        provenance: trace,
      });
    }
  }

  const businesses = new Map<string, RawBusiness & { id: string }>();
  for (const account of accounts) {
    if (account.business?.id) businesses.set(account.business.id, { ...account.business, id: account.business.id });
  }

  const businessEdges: readonly Readonly<{
    path: string;
    resource: MetaAssetDiscovery["resource"];
    assetType: MetaAssetType;
    relationship: MetaAssetEdge["relationship"];
    capabilities: readonly MetaAssetCapability[];
  }>[] = [
    { path: "owned_pixels", resource: "pixels", assetType: "pixel", relationship: "owns_pixel", capabilities: [capability("read", "verified"), capability("measure", "verified")] },
    { path: "owned_datasets", resource: "datasets", assetType: "dataset", relationship: "owns_dataset", capabilities: [capability("read", "verified"), capability("measure", "verified")] },
    { path: "owned_apps", resource: "apps", assetType: "app", relationship: "owns_app", capabilities: [capability("read", "verified"), capability("advertise", "granted_unverified", "Ad account bağlantısı ayrıca doğrulanmalıdır")] },
    { path: "owned_whatsapp_business_accounts", resource: "whatsapp_business_accounts", assetType: "whatsapp_account", relationship: "owns_whatsapp_business_account", capabilities: [capability("read", "verified"), capability("message", "granted_unverified", "Mesajlaşma ve reklam yetkileri ayrı doğrulanmalıdır")] },
  ];

  for (const business of businesses.values()) {
    for (const descriptor of businessEdges) {
      const sourceEdge = `/${business.id}/${descriptor.path}`;
      const result = await discoverEdge<RawNamedAsset>(client, {
        path: sourceEdge,
        fields: "id,name,app_name",
        resource: descriptor.resource,
        sourceType: "business",
        sourceExternalId: business.id,
        fetchedAt,
      });
      discoveries.push(result.discovery);
      for (const rawAsset of validRows(result.rows)) {
        const trace = provenance(sourceEdge, rawAsset, fetchedAt, client.graphApiVersion);
        addAsset(assets, {
          externalAssetId: rawAsset.id,
          assetType: descriptor.assetType,
          displayName: rawAsset.name ?? rawAsset.app_name ?? null,
          username: null,
          ownership: { kind: "owned", ownerBusinessExternalId: business.id, evidence: descriptor.path },
          capabilities: descriptor.capabilities,
          orphanReason: null,
          provenance: trace,
        });
        addEdge(edges, {
          sourceType: "business",
          sourceExternalId: business.id,
          targetExternalAssetId: rawAsset.id,
          relationship: descriptor.relationship,
          provenance: trace,
        });
      }
    }
  }

  return normalizeMetaAssetMirror({
    schemaVersion: META_ASSET_MIRROR_SCHEMA_VERSION,
    workspaceId: options.workspaceId,
    connectionExternalKey: options.connectionExternalKey,
    adAccountExternalIds: accounts.map((account) => account.id),
    assets: [...assets.values()],
    edges: [...edges.values()],
    discoveries,
    fetchedAt,
    writeOperations: 0,
  });
}
