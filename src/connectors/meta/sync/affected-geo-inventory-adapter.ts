import { createHash } from "node:crypto";
import { stableHash } from "./types";
import { META_INVENTORY_FIELD_CATALOG_VERSION } from "./inventory-materialization";
import {
  hashMetaAffectedGeoSourceSubtree,
  META_AFFECTED_GEO_VERIFIED_GRAPH_VERSION,
  normalizeMetaAffectedGeoCountries,
  type AffectedGeoCountryNormalizationResult,
} from "@/domain/meta/affected-geo-country-snapshot";

export const META_AFFECTED_GEO_INVENTORY_ADAPTER_VERSION = "meta-affected-geo-inventory-adapter/1.0.0" as const;
export const META_AFFECTED_GEO_SOURCE_FIELD_CATALOG_VERSION = META_INVENTORY_FIELD_CATALOG_VERSION;

type NoAuthority = Readonly<{
  canApprove: false;
  canExecute: false;
  canWriteMeta: false;
  canGrantApproval: false;
}>;

export type MetaAffectedGeoInventoryBinding = Readonly<{
  workspaceRef: `workspace_${string}`;
  connectionRef: `connection_${string}`;
  accountRef: `account_${string}`;
  campaignRef: `campaign_${string}`;
  adSetRef: `adset_${string}`;
  observationRunRef: `observation_${string}`;
  sliceRef: `slice_${string}`;
  cursorRef: `cursor_${string}`;
  pageRef: `page_${string}`;
}>;

export type MetaAffectedGeoInventoryAdapterResult =
  | Readonly<{
    version: typeof META_AFFECTED_GEO_INVENTORY_ADAPTER_VERSION;
    status: "bound";
    binding: MetaAffectedGeoInventoryBinding;
    snapshot: AffectedGeoCountryNormalizationResult;
    capabilities: NoAuthority;
  }>
  | Readonly<{
    version: typeof META_AFFECTED_GEO_INVENTORY_ADAPTER_VERSION;
    status: "unknown";
    availability: "mixed_unavailable";
    reasonCode: "invalid_inventory_boundary" | "raw_payload_hash_mismatch";
    capabilities: NoAuthority;
  }>;

const CAPABILITIES = Object.freeze({ canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canGrantApproval: false as const });
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const INPUT_KEYS = ["workspaceId", "connectionId", "externalAccountId", "entityLevel", "parentRunId", "sliceId", "cursorId",
  "pageHash", "observedAt", "sourceGraphVersion", "fieldCatalogVersion", "rawPayloadHash", "rawRecord"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isObject(value) && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function canonicalInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function ref<P extends string>(prefix: P, namespace: string, values: readonly string[]): `${P}_${string}` {
  return `${prefix}_${digest(["meta-affected-geo-private-ref/1.0.0", namespace, ...values])}`;
}

function unknown(reasonCode: "invalid_inventory_boundary" | "raw_payload_hash_mismatch"):
MetaAffectedGeoInventoryAdapterResult {
  return Object.freeze({ version: META_AFFECTED_GEO_INVENTORY_ADAPTER_VERSION, status: "unknown",
    availability: "mixed_unavailable", reasonCode, capabilities: CAPABILITIES });
}

function validBoundary(input: Record<string, unknown>): boolean {
  return identifier(input.workspaceId) && identifier(input.connectionId) && identifier(input.externalAccountId)
    && input.entityLevel === "ad_set" && identifier(input.parentRunId)
    && typeof input.sliceId === "string" && input.sliceId.length > 0
    && input.sliceId.length <= 512 && HASH.test(input.cursorId as string) && HASH.test(input.pageHash as string)
    && canonicalInstant(input.observedAt) && input.sourceGraphVersion === META_AFFECTED_GEO_VERIFIED_GRAPH_VERSION
    && input.fieldCatalogVersion === META_AFFECTED_GEO_SOURCE_FIELD_CATALOG_VERSION
    && typeof input.rawPayloadHash === "string" && HASH.test(input.rawPayloadHash)
    && isObject(input.rawRecord) && identifier(input.rawRecord.id) && identifier(input.rawRecord.campaign_id);
}

/**
 * Server-private extraction boundary. The raw record exists only for this call;
 * neither it nor any targeting value is copied to the returned contract.
 */
export function affectedGeoSnapshotFromCanonicalInventoryAdSetRaw(
  candidate: unknown,
): MetaAffectedGeoInventoryAdapterResult {
  if (!exact(candidate, INPUT_KEYS) || !validBoundary(candidate)) return unknown("invalid_inventory_boundary");
  const rawRecord = candidate.rawRecord as Record<string, unknown>;
  let computedRawPayloadHash: string;
  try { computedRawPayloadHash = stableHash(rawRecord); }
  catch { return unknown("invalid_inventory_boundary"); }
  if (computedRawPayloadHash !== candidate.rawPayloadHash) return unknown("raw_payload_hash_mismatch");

  const workspaceRef = ref("workspace", "workspace", [candidate.workspaceId as string]);
  const connectionRef = ref("connection", "connection", [candidate.workspaceId as string, candidate.connectionId as string]);
  const accountRef = ref("account", "account", [connectionRef, candidate.externalAccountId as string]);
  const campaignRef = ref("campaign", "campaign", [accountRef, rawRecord.campaign_id as string]);
  const adSetRef = ref("adset", "adset", [campaignRef, rawRecord.id as string]);
  const observationRunRef = ref("observation", "observation", [connectionRef, candidate.parentRunId as string]);
  const sliceRef = ref("slice", "slice", [observationRunRef, candidate.sliceId as string]);
  const cursorRef = ref("cursor", "cursor", [sliceRef, candidate.cursorId as string]);
  const pageRef = ref("page", "page", [cursorRef, candidate.pageHash as string]);
  const binding = Object.freeze({ workspaceRef, connectionRef, accountRef, campaignRef, adSetRef,
    observationRunRef, sliceRef, cursorRef, pageRef });
  const targeting = Object.hasOwn(rawRecord, "targeting") ? rawRecord.targeting : undefined;
  const snapshot = normalizeMetaAffectedGeoCountries({
    sourceKind: "meta_graph_adset_targeting",
    scope: { workspaceRef, accountRef, campaignRef, adSetRef },
    sourceGraphVersion: candidate.sourceGraphVersion,
    fieldCatalogVersion: candidate.fieldCatalogVersion,
    fetchedAt: candidate.observedAt,
    provenance: { observationRunRef, sliceRef, pageRef, rawPayloadHash: computedRawPayloadHash,
      sourceGeoSubtreeHash: hashMetaAffectedGeoSourceSubtree(targeting) },
    targeting,
  });
  return Object.freeze({ version: META_AFFECTED_GEO_INVENTORY_ADAPTER_VERSION, status: "bound",
    binding, snapshot, capabilities: CAPABILITIES });
}
