import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { CanonicalAffectedGeoCountrySnapshot } from "@/domain/meta/affected-geo-country-snapshot";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type RepositoryDatabase = Pick<Database, "execute" | "transaction">;

export class MetaAffectedGeoSnapshotRepositoryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "inactive_workspace"
    | "hierarchy_scope_mismatch"
    | "snapshot_conflict"
    | "not_found"
    | "ambiguous"
    | "corrupt_store") {
    super("Meta affected-geo snapshot kalıcı depoda güvenli biçimde işlenemedi");
    this.name = "MetaAffectedGeoSnapshotRepositoryError";
  }
}

export type MetaAffectedGeoSnapshotBinding = Readonly<{
  workspaceId: string;
  adAccountId: string;
  campaignId: string;
  adSetId: string;
  snapshot: CanonicalAffectedGeoCountrySnapshot;
}>;

export type MetaAffectedGeoSnapshotExactScope = Readonly<{
  workspaceId: string;
  workspaceRef: string;
  adAccountId: string;
  accountRef: string;
  campaignId: string;
  campaignRef: string;
  adSetId: string;
  adSetRef: string;
  capturedAt: string;
  sourceGraphVersion: string;
  fieldCatalogVersion: string;
  rawPayloadHash: string;
  sourceGeoSubtreeHash: string;
  snapshotHash: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9./_-]{0,127}$/;
const SNAPSHOT_KEYS = ["version", "sourceKind", "status", "scope", "capturedAt", "source", "items", "locationTypes",
  "snapshotHash", "capabilities"] as const;

type SnapshotRow = Readonly<{
  id: string;
  workspace_id: string;
  ad_account_id: string;
  campaign_id: string;
  ad_set_id: string;
  workspace_ref: string;
  account_ref: string;
  campaign_ref: string;
  ad_set_ref: string;
  schema_version: string;
  source_kind: string;
  status: string;
  source_graph_version: string;
  field_catalog_version: string;
  captured_at: string | Date;
  observation_run_ref: string;
  slice_ref: string;
  page_ref: string;
  raw_payload_hash: string;
  source_geo_subtree_hash: string;
  snapshot_hash: string;
  item_count: number;
  location_type_count: number;
}>;
type ItemRow = Readonly<{ polarity: string; geo_type: string; geo_ref: string }>;
type LocationTypeRow = Readonly<{ location_type: string }>;

function fail(code: MetaAffectedGeoSnapshotRepositoryError["code"]): never {
  throw new MetaAffectedGeoSnapshotRepositoryError(code);
}
function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly T[];
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value as object).length === keys.length
    && Object.keys(value as object).every((key) => keys.includes(key));
}
function codePointCompare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => codePointCompare(left, right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function canonicalInstant(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  const normalized = new Date(value).toISOString(); return normalized === value ? normalized : null;
}
function storedInstant(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
function validRef(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.startsWith(prefix) && REF.test(value);
}
function validUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }

function validateSnapshot(value: unknown): CanonicalAffectedGeoCountrySnapshot {
  if (!exact(value, SNAPSHOT_KEYS) || value.version !== "meta-affected-geo-country-snapshot/1.0.0"
    || value.sourceKind !== "canonical_meta_affected_geo_snapshot" || value.status !== "known"
    || !exact(value.scope, ["workspaceRef", "accountRef", "campaignRef", "adSetRef"])
    || !validRef(value.scope.workspaceRef, "workspace_") || !validRef(value.scope.accountRef, "account_")
    || !validRef(value.scope.campaignRef, "campaign_") || !validRef(value.scope.adSetRef, "adset_")
    || canonicalInstant(value.capturedAt) === null
    || !exact(value.source, ["sourceGraphVersion", "fieldCatalogVersion", "observationRunRef", "sliceRef", "pageRef",
      "rawPayloadHash", "sourceGeoSubtreeHash"])
    || value.source.sourceGraphVersion !== "v23.0" || typeof value.source.fieldCatalogVersion !== "string"
    || !VERSION.test(value.source.fieldCatalogVersion) || !validRef(value.source.observationRunRef, "observation_")
    || !validRef(value.source.sliceRef, "slice_") || !validRef(value.source.pageRef, "page_")
    || typeof value.source.rawPayloadHash !== "string" || !HASH.test(value.source.rawPayloadHash)
    || typeof value.source.sourceGeoSubtreeHash !== "string" || !HASH.test(value.source.sourceGeoSubtreeHash)
    || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 250
    || !Array.isArray(value.locationTypes) || value.locationTypes.length < 1 || value.locationTypes.length > 2
    || !exact(value.capabilities, ["canApprove", "canExecute", "canWriteMeta", "canGrantApproval"])
    || value.capabilities.canApprove !== false || value.capabilities.canExecute !== false
    || value.capabilities.canWriteMeta !== false || value.capabilities.canGrantApproval !== false
    || typeof value.snapshotHash !== "string" || !HASH.test(value.snapshotHash)) fail("invalid_input");
  const itemRefs: string[] = [];
  for (const item of value.items) {
    if (!exact(item, ["polarity", "geoType", "geoRef"]) || item.polarity !== "included" || item.geoType !== "country"
      || typeof item.geoRef !== "string" || !/^geo_[a-f0-9]{64}$/.test(item.geoRef)) fail("invalid_input");
    itemRefs.push(item.geoRef);
  }
  if (new Set(itemRefs).size !== itemRefs.length
    || [...itemRefs].sort(codePointCompare).some((item, index) => item !== itemRefs[index])) fail("invalid_input");
  const locationTypes = value.locationTypes as unknown[];
  if (locationTypes.some((item) => item !== "home" && item !== "recent") || new Set(locationTypes).size !== locationTypes.length
    || [...locationTypes].sort((left, right) => codePointCompare(String(left), String(right)))
      .some((item, index) => item !== locationTypes[index])) fail("invalid_input");
  const { snapshotHash, ...core } = value;
  if (digest(core) !== snapshotHash) fail("invalid_input");
  return value as unknown as CanonicalAffectedGeoCountrySnapshot;
}

function reconstruct(row: SnapshotRow, items: readonly ItemRow[], locations: readonly LocationTypeRow[]): CanonicalAffectedGeoCountrySnapshot {
  if (!validUuid(row.id) || !validUuid(row.workspace_id) || !validUuid(row.ad_account_id) || !validUuid(row.campaign_id)
    || !validUuid(row.ad_set_id) || !Number.isSafeInteger(row.item_count) || !Number.isSafeInteger(row.location_type_count)
    || items.length !== row.item_count || locations.length !== row.location_type_count) fail("corrupt_store");
  const snapshot = {
    version: row.schema_version,
    sourceKind: row.source_kind,
    status: row.status,
    scope: { workspaceRef: row.workspace_ref, accountRef: row.account_ref, campaignRef: row.campaign_ref, adSetRef: row.ad_set_ref },
    capturedAt: storedInstant(row.captured_at),
    source: { sourceGraphVersion: row.source_graph_version, fieldCatalogVersion: row.field_catalog_version,
      observationRunRef: row.observation_run_ref, sliceRef: row.slice_ref, pageRef: row.page_ref,
      rawPayloadHash: row.raw_payload_hash, sourceGeoSubtreeHash: row.source_geo_subtree_hash },
    items: items.map((item) => ({ polarity: item.polarity, geoType: item.geo_type, geoRef: item.geo_ref })),
    locationTypes: locations.map((item) => item.location_type),
    snapshotHash: row.snapshot_hash,
    capabilities: { canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false },
  };
  try { return validateSnapshot(snapshot); } catch { return fail("corrupt_store"); }
}

async function lockWorkspace(database: Pick<Database, "execute">, workspaceId: string, mode: "share" | "update") {
  const result = mode === "update" ? await database.execute(sql`
    select id, lifecycle_state from workspaces where id = ${workspaceId}::uuid limit 1 for update
  `) : await database.execute(sql`
    select id, lifecycle_state from workspaces where id = ${workspaceId}::uuid limit 1 for share
  `);
  const found = rows<{ id: string; lifecycle_state: string }>(result);
  if (found.length !== 1) fail("workspace_scope_mismatch");
  if (found[0]!.lifecycle_state !== "active") fail("inactive_workspace");
}

const SELECT_COLUMNS = sql.raw(`id, workspace_id, ad_account_id, campaign_id, ad_set_id, workspace_ref, account_ref,
  campaign_ref, ad_set_ref, schema_version, source_kind, status, source_graph_version, field_catalog_version,
  captured_at, observation_run_ref, slice_ref, page_ref, raw_payload_hash, source_geo_subtree_hash, snapshot_hash,
  item_count, location_type_count`);

/** Private immutable persistence port. It has no Meta transport, policy, approval, or execution capability. */
export class DrizzleMetaAffectedGeoSnapshotRepository {
  private readonly workspaceId: string;
  constructor(private readonly database: RepositoryDatabase, workspaceId: string) {
    if (!UUID.test(workspaceId)) fail("invalid_input");
    this.workspaceId = workspaceId.toLowerCase();
  }

  async append(input: MetaAffectedGeoSnapshotBinding): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    snapshotId: string;
    snapshotHash: string;
  }>> {
    if (!exact(input, ["workspaceId", "adAccountId", "campaignId", "adSetId", "snapshot"])
      || !validUuid(input.workspaceId) || !validUuid(input.adAccountId) || !validUuid(input.campaignId)
      || !validUuid(input.adSetId)) fail("invalid_input");
    if (input.workspaceId.toLowerCase() !== this.workspaceId) fail("workspace_scope_mismatch");
    const snapshot = validateSnapshot(input.snapshot);
    return this.database.transaction(async (transaction) => {
      await lockWorkspace(transaction, this.workspaceId, "update");
      const hierarchy = rows<{ id: string }>(await transaction.execute(sql`
        select ad_set.id from meta_ad_sets ad_set
        where ad_set.workspace_id = ${this.workspaceId}::uuid and ad_set.id = ${input.adSetId}::uuid
          and ad_set.campaign_id = ${input.campaignId}::uuid and ad_set.ad_account_id = ${input.adAccountId}::uuid
        limit 2 for share
      `));
      if (hierarchy.length !== 1) fail("hierarchy_scope_mismatch");
      const existing = rows<SnapshotRow>(await transaction.execute(sql`
        select ${SELECT_COLUMNS} from meta_affected_geo_snapshots
        where workspace_id = ${this.workspaceId}::uuid and (
          snapshot_hash = ${snapshot.snapshotHash}
          or (ad_set_id = ${input.adSetId}::uuid and captured_at = ${snapshot.capturedAt}::timestamptz
            and raw_payload_hash = ${snapshot.source.rawPayloadHash}
            and source_geo_subtree_hash = ${snapshot.source.sourceGeoSubtreeHash}
            and source_graph_version = ${snapshot.source.sourceGraphVersion}
            and field_catalog_version = ${snapshot.source.fieldCatalogVersion})
        )
        limit 2
      `));
      if (existing.length > 1) fail("corrupt_store");
      if (existing[0]) {
        if (existing[0].snapshot_hash !== snapshot.snapshotHash) fail("snapshot_conflict");
        const restored = await this.loadChildren(transaction, existing[0]);
        if (existing[0].ad_account_id !== input.adAccountId || existing[0].campaign_id !== input.campaignId
          || existing[0].ad_set_id !== input.adSetId || JSON.stringify(stable(restored)) !== JSON.stringify(stable(snapshot))) {
          fail("snapshot_conflict");
        }
        return Object.freeze({ outcome: "unchanged" as const, snapshotId: existing[0].id, snapshotHash: snapshot.snapshotHash });
      }
      const inserted = rows<{ id: string }>(await transaction.execute(sql`
        insert into meta_affected_geo_snapshots (
          workspace_id, ad_account_id, campaign_id, ad_set_id, workspace_ref, account_ref, campaign_ref, ad_set_ref,
          schema_version, source_kind, status, source_graph_version, field_catalog_version, captured_at,
          observation_run_ref, slice_ref, page_ref, raw_payload_hash, source_geo_subtree_hash, snapshot_hash,
          item_count, location_type_count
        ) values (
          ${this.workspaceId}::uuid, ${input.adAccountId}::uuid, ${input.campaignId}::uuid, ${input.adSetId}::uuid,
          ${snapshot.scope.workspaceRef}, ${snapshot.scope.accountRef}, ${snapshot.scope.campaignRef}, ${snapshot.scope.adSetRef},
          ${snapshot.version}, ${snapshot.sourceKind}, ${snapshot.status}, ${snapshot.source.sourceGraphVersion},
          ${snapshot.source.fieldCatalogVersion}, ${snapshot.capturedAt}::timestamptz, ${snapshot.source.observationRunRef},
          ${snapshot.source.sliceRef}, ${snapshot.source.pageRef}, ${snapshot.source.rawPayloadHash},
          ${snapshot.source.sourceGeoSubtreeHash}, ${snapshot.snapshotHash}, ${snapshot.items.length}, ${snapshot.locationTypes.length}
        ) returning id
      `));
      if (inserted.length !== 1 || !validUuid(inserted[0]!.id)) fail("corrupt_store");
      const snapshotId = inserted[0]!.id;
      const itemInsert = rows<{ count: number | string }>(await transaction.execute(sql`
        with inserted as (
          insert into meta_affected_geo_snapshot_items (workspace_id, snapshot_id, polarity, geo_type, geo_ref)
          select ${this.workspaceId}::uuid, ${snapshotId}::uuid, value->>'polarity', value->>'geoType', value->>'geoRef'
          from jsonb_array_elements(${JSON.stringify(snapshot.items)}::jsonb) value returning 1
        ) select count(*)::int as count from inserted
      `));
      const locationInsert = rows<{ count: number | string }>(await transaction.execute(sql`
        with inserted as (
          insert into meta_affected_geo_snapshot_location_types (workspace_id, snapshot_id, location_type)
          select ${this.workspaceId}::uuid, ${snapshotId}::uuid, value #>> '{}'
          from jsonb_array_elements(${JSON.stringify(snapshot.locationTypes)}::jsonb) value returning 1
        ) select count(*)::int as count from inserted
      `));
      if (Number(itemInsert[0]?.count) !== snapshot.items.length
        || Number(locationInsert[0]?.count) !== snapshot.locationTypes.length) fail("corrupt_store");
      return Object.freeze({ outcome: "inserted" as const, snapshotId, snapshotHash: snapshot.snapshotHash });
    });
  }

  async resolveExact(input: MetaAffectedGeoSnapshotExactScope): Promise<CanonicalAffectedGeoCountrySnapshot> {
    if (!exact(input, ["workspaceId", "workspaceRef", "adAccountId", "accountRef", "campaignId", "campaignRef", "adSetId",
      "adSetRef", "capturedAt", "sourceGraphVersion", "fieldCatalogVersion", "rawPayloadHash", "sourceGeoSubtreeHash", "snapshotHash"])
      || !validUuid(input.workspaceId) || !validUuid(input.adAccountId) || !validUuid(input.campaignId) || !validUuid(input.adSetId)
      || !validRef(input.workspaceRef, "workspace_")
      || !validRef(input.accountRef, "account_") || !validRef(input.campaignRef, "campaign_") || !validRef(input.adSetRef, "adset_")
      || canonicalInstant(input.capturedAt) === null || input.sourceGraphVersion !== "v23.0" || !VERSION.test(input.fieldCatalogVersion)
      || !HASH.test(input.rawPayloadHash) || !HASH.test(input.sourceGeoSubtreeHash) || !HASH.test(input.snapshotHash)) fail("invalid_input");
    if (input.workspaceId.toLowerCase() !== this.workspaceId) fail("workspace_scope_mismatch");
    return this.database.transaction(async (transaction) => {
      await lockWorkspace(transaction, this.workspaceId, "share");
      const found = rows<SnapshotRow>(await transaction.execute(sql`
        select ${SELECT_COLUMNS} from meta_affected_geo_snapshots
        where workspace_id = ${this.workspaceId}::uuid and workspace_ref = ${input.workspaceRef}
          and ad_account_id = ${input.adAccountId}::uuid and account_ref = ${input.accountRef}
          and campaign_id = ${input.campaignId}::uuid and campaign_ref = ${input.campaignRef}
          and ad_set_id = ${input.adSetId}::uuid and ad_set_ref = ${input.adSetRef}
          and captured_at = ${input.capturedAt}::timestamptz and source_graph_version = ${input.sourceGraphVersion}
          and field_catalog_version = ${input.fieldCatalogVersion} and raw_payload_hash = ${input.rawPayloadHash}
          and source_geo_subtree_hash = ${input.sourceGeoSubtreeHash} and snapshot_hash = ${input.snapshotHash}
        limit 2
      `));
      if (found.length === 0) fail("not_found");
      if (found.length > 1) fail("ambiguous");
      const row = found[0]!;
      if (row.workspace_id.toLowerCase() !== this.workspaceId || row.ad_account_id !== input.adAccountId
        || row.campaign_id !== input.campaignId || row.ad_set_id !== input.adSetId) fail("corrupt_store");
      return this.loadChildren(transaction, row);
    });
  }

  private async loadChildren(database: Pick<Database, "execute">, row: SnapshotRow): Promise<CanonicalAffectedGeoCountrySnapshot> {
    const items = rows<ItemRow>(await database.execute(sql`
      select polarity, geo_type, geo_ref from meta_affected_geo_snapshot_items
      where workspace_id = ${this.workspaceId}::uuid and snapshot_id = ${row.id}::uuid
      order by geo_ref
      limit 251
    `));
    const locations = rows<LocationTypeRow>(await database.execute(sql`
      select location_type from meta_affected_geo_snapshot_location_types
      where workspace_id = ${this.workspaceId}::uuid and snapshot_id = ${row.id}::uuid
      order by location_type
      limit 3
    `));
    return reconstruct(row, items, locations);
  }
}
