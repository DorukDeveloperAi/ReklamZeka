import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  AuthenticAffectedGeoEvidenceCandidate,
  AuthenticAffectedGeoEvidencePort,
  ProtectionEvidenceScope,
} from "@/application/existing-post-promotion-protection-evidence-materializer";
import {
  DrizzleMetaAffectedGeoSnapshotRepository,
  type MetaAffectedGeoSnapshotExactScope,
} from "@/connectors/meta/meta-affected-geo-snapshot-drizzle-repository";
import type { CanonicalAffectedGeoCountrySnapshot } from "@/domain/meta/affected-geo-country-snapshot";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type ScopeDatabase = Pick<Database, "execute">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9./_-]{0,127}$/;
const EXACT_KEYS = ["workspaceId", "workspaceRef", "adAccountId", "accountRef", "campaignId", "campaignRef",
  "adSetId", "adSetRef", "capturedAt", "sourceGraphVersion", "fieldCatalogVersion", "rawPayloadHash",
  "sourceGeoSubtreeHash", "snapshotHash"] as const;

export type MetaAffectedGeoEvidenceScopeResolver = Readonly<{
  /** Returns only immutable, server-derived exact snapshot identities. */
  resolve(scope: ProtectionEvidenceScope): Promise<readonly MetaAffectedGeoSnapshotExactScope[]>;
}>;

export type MetaAffectedGeoEvidenceSnapshotReader = Readonly<{
  resolveExact(scope: MetaAffectedGeoSnapshotExactScope): Promise<CanonicalAffectedGeoCountrySnapshot>;
}>;

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value as object).length === keys.length
    && Object.keys(value as object).every((key) => keys.includes(key));
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compare(left, right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function instant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function exactScope(value: unknown, scope: ProtectionEvidenceScope): value is MetaAffectedGeoSnapshotExactScope {
  if (!exact(value, EXACT_KEYS)) return false;
  return value.workspaceId === scope.workspaceId && value.workspaceRef === scope.workspaceRef
    // Public snapshot refs are mirror-derived opaque identities. The private
    // canonical hierarchy join in the resolver binds them to this external
    // context scope; they must not be compared as interchangeable strings.
    && typeof value.accountRef === "string" && REF.test(value.accountRef)
    && typeof value.campaignRef === "string" && REF.test(value.campaignRef)
    && typeof value.adSetRef === "string" && REF.test(value.adSetRef)
    && typeof value.adAccountId === "string" && UUID.test(value.adAccountId)
    && typeof value.campaignId === "string" && UUID.test(value.campaignId)
    && typeof value.adSetId === "string" && UUID.test(value.adSetId)
    && instant(value.capturedAt) && value.capturedAt >= scope.notBefore && value.capturedAt <= scope.evaluatedAt
    && value.sourceGraphVersion === "v23.0" && typeof value.fieldCatalogVersion === "string"
    && VERSION.test(value.fieldCatalogVersion) && typeof value.rawPayloadHash === "string" && HASH.test(value.rawPayloadHash)
    && typeof value.sourceGeoSubtreeHash === "string" && HASH.test(value.sourceGeoSubtreeHash)
    && typeof value.snapshotHash === "string" && HASH.test(value.snapshotHash);
}

function authenticSnapshot(
  value: unknown,
  identity: MetaAffectedGeoSnapshotExactScope,
): value is CanonicalAffectedGeoCountrySnapshot {
  if (!exact(value, ["version", "sourceKind", "status", "scope", "capturedAt", "source", "items", "locationTypes",
    "snapshotHash", "capabilities"]) || value.version !== "meta-affected-geo-country-snapshot/1.0.0"
    || value.sourceKind !== "canonical_meta_affected_geo_snapshot" || value.status !== "known"
    || !exact(value.scope, ["workspaceRef", "accountRef", "campaignRef", "adSetRef"])
    || value.scope.workspaceRef !== identity.workspaceRef || value.scope.accountRef !== identity.accountRef
    || value.scope.campaignRef !== identity.campaignRef || value.scope.adSetRef !== identity.adSetRef
    || value.capturedAt !== identity.capturedAt || !exact(value.source, ["sourceGraphVersion", "fieldCatalogVersion",
      "observationRunRef", "sliceRef", "pageRef", "rawPayloadHash", "sourceGeoSubtreeHash"])
    || value.source.sourceGraphVersion !== identity.sourceGraphVersion
    || value.source.fieldCatalogVersion !== identity.fieldCatalogVersion
    || value.source.rawPayloadHash !== identity.rawPayloadHash
    || value.source.sourceGeoSubtreeHash !== identity.sourceGeoSubtreeHash
    || value.snapshotHash !== identity.snapshotHash || !Array.isArray(value.items) || value.items.length < 1
    || value.items.length > 250 || !Array.isArray(value.locationTypes) || value.locationTypes.length < 1
    || value.locationTypes.length > 2 || !exact(value.capabilities, ["canApprove", "canExecute", "canWriteMeta", "canGrantApproval"])
    || Object.values(value.capabilities).some((capability) => capability !== false)) return false;
  const refs: string[] = [];
  for (const item of value.items) {
    if (!exact(item, ["polarity", "geoType", "geoRef"]) || item.polarity !== "included" || item.geoType !== "country"
      || typeof item.geoRef !== "string" || !/^geo_[a-f0-9]{64}$/.test(item.geoRef)) return false;
    refs.push(item.geoRef);
  }
  if (new Set(refs).size !== refs.length || [...refs].sort(compare).some((ref, index) => ref !== refs[index])) return false;
  const { snapshotHash, ...core } = value;
  return digest(core) === snapshotHash;
}

function revision(source: string, sourceHash: string) {
  return Object.freeze({ sourceRef: `affected_geo_${source}_${sourceHash.slice(0, 20)}`, revision: 1, sourceHash });
}

type ScopeRow = Readonly<{
  workspace_id: string;
  workspace_ref: string;
  ad_account_id: string;
  account_ref: string;
  campaign_id: string;
  campaign_ref: string;
  ad_set_id: string;
  ad_set_ref: string;
  captured_at: string | Date;
  source_graph_version: string;
  field_catalog_version: string;
  raw_payload_hash: string;
  source_geo_subtree_hash: string;
  snapshot_hash: string;
}>;

function resultRows(result: unknown): readonly ScopeRow[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new Error("affected_geo_scope_store_unavailable");
  }
  return result.rows as readonly ScopeRow[];
}

function storedInstant(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

/** Workspace-bound private resolver. It reads hashes and IDs only; targeting payloads are never selected. */
export class DrizzleMetaAffectedGeoEvidenceScopeResolver implements MetaAffectedGeoEvidenceScopeResolver {
  constructor(
    private readonly database: ScopeDatabase,
    private readonly workspaceId: string,
    private readonly workspaceRef: string,
  ) {
    if (!UUID.test(workspaceId) || !REF.test(workspaceRef)) throw new Error("invalid_affected_geo_scope_binding");
  }

  async resolve(scope: ProtectionEvidenceScope): Promise<readonly MetaAffectedGeoSnapshotExactScope[]> {
    if (scope.workspaceId !== this.workspaceId || scope.workspaceRef !== this.workspaceRef
      || scope.entity.level !== "adset" || !REF.test(scope.entity.ref) || !REF.test(scope.accountRef)
      || !REF.test(scope.campaignRef) || !instant(scope.notBefore) || !instant(scope.evaluatedAt)
      || scope.notBefore > scope.evaluatedAt) return [];
    const result = await this.database.execute(sql`
      select snapshot.workspace_id::text, snapshot.workspace_ref,
        snapshot.ad_account_id::text, snapshot.account_ref,
        snapshot.campaign_id::text, snapshot.campaign_ref,
        snapshot.ad_set_id::text, snapshot.ad_set_ref,
        snapshot.captured_at, snapshot.source_graph_version, snapshot.field_catalog_version,
        snapshot.raw_payload_hash, snapshot.source_geo_subtree_hash, snapshot.snapshot_hash
      from meta_affected_geo_snapshots snapshot
      join workspaces workspace
        on workspace.id = snapshot.workspace_id and workspace.lifecycle_state = 'active'
      join ad_accounts account
        on account.workspace_id = snapshot.workspace_id and account.id = snapshot.ad_account_id
      join ad_campaigns campaign
        on campaign.workspace_id = snapshot.workspace_id and campaign.id = snapshot.campaign_id
          and campaign.ad_account_id = snapshot.ad_account_id
      join meta_ad_sets ad_set
        on ad_set.workspace_id = snapshot.workspace_id and ad_set.id = snapshot.ad_set_id
          and ad_set.campaign_id = snapshot.campaign_id and ad_set.ad_account_id = snapshot.ad_account_id
      where snapshot.workspace_id = ${this.workspaceId}::uuid
        and snapshot.workspace_ref = ${this.workspaceRef}
        and account.external_account_id = ${scope.accountRef}
        and campaign.external_campaign_id = ${scope.campaignRef}
        and ad_set.external_ad_set_id = ${scope.entity.ref}
        and snapshot.captured_at >= ${scope.notBefore}::timestamptz
        and snapshot.captured_at <= ${scope.evaluatedAt}::timestamptz
        and snapshot.source_graph_version = 'v23.0'
        and snapshot.field_catalog_version ~ '^[A-Za-z0-9][A-Za-z0-9./_-]{0,127}$'
        and snapshot.raw_payload_hash ~ '^[a-f0-9]{64}$'
        and snapshot.source_geo_subtree_hash ~ '^[a-f0-9]{64}$'
        and snapshot.snapshot_hash ~ '^[a-f0-9]{64}$'
      order by snapshot.captured_at desc, snapshot.id desc
      limit 2
    `);
    const identities: MetaAffectedGeoSnapshotExactScope[] = [];
    for (const row of resultRows(result)) {
      const capturedAt = storedInstant(row.captured_at);
      const candidate = {
        workspaceId: row.workspace_id, workspaceRef: row.workspace_ref,
        adAccountId: row.ad_account_id, accountRef: row.account_ref,
        campaignId: row.campaign_id, campaignRef: row.campaign_ref,
        adSetId: row.ad_set_id, adSetRef: row.ad_set_ref,
        capturedAt, sourceGraphVersion: row.source_graph_version,
        fieldCatalogVersion: row.field_catalog_version, rawPayloadHash: row.raw_payload_hash,
        sourceGeoSubtreeHash: row.source_geo_subtree_hash, snapshotHash: row.snapshot_hash,
      };
      if (capturedAt === null || !exactScope(candidate, scope)) throw new Error("affected_geo_scope_store_corrupt");
      identities.push(Object.freeze(candidate as MetaAffectedGeoSnapshotExactScope));
    }
    if (identities.length > 2) throw new Error("affected_geo_scope_store_corrupt");
    return Object.freeze(identities);
  }
}

/** Read-only adapter; it carries hashes and canonical geo refs, never targeting or raw Meta identifiers. */
export class AuthenticAffectedGeoEvidenceAdapter implements AuthenticAffectedGeoEvidencePort {
  constructor(
    private readonly scopes: MetaAffectedGeoEvidenceScopeResolver,
    private readonly snapshots: MetaAffectedGeoEvidenceSnapshotReader,
    private readonly workspaceId: string,
    private readonly workspaceRef: string,
  ) {
    if (!UUID.test(workspaceId) || !REF.test(workspaceRef)) throw new Error("invalid_affected_geo_evidence_binding");
  }

  async resolveCandidates(scope: ProtectionEvidenceScope): Promise<readonly AuthenticAffectedGeoEvidenceCandidate[]> {
    if (scope.workspaceId !== this.workspaceId || scope.workspaceRef !== this.workspaceRef
      || scope.entity.level !== "adset" || !REF.test(scope.entity.ref) || !REF.test(scope.accountRef)
      || !REF.test(scope.campaignRef) || !instant(scope.notBefore) || !instant(scope.evaluatedAt)
      || scope.notBefore > scope.evaluatedAt) return [];
    try {
      const identities = await this.scopes.resolve(scope);
      if (!Array.isArray(identities) || identities.length > 2
        || identities.some((identity) => !exactScope(identity, scope))) return [];
      const candidates: AuthenticAffectedGeoEvidenceCandidate[] = [];
      for (const identity of identities) {
        const snapshot = await this.snapshots.resolveExact(identity);
        if (!authenticSnapshot(snapshot, identity)) return [];
        const geoRefs = Object.freeze(snapshot.items.map((item) => item.geoRef));
        const sourceRevisions = Object.freeze([
          revision("graph", digest({ sourceGraphVersion: snapshot.source.sourceGraphVersion })),
          revision("catalog", digest({ fieldCatalogVersion: snapshot.source.fieldCatalogVersion })),
          revision("raw", snapshot.source.rawPayloadHash),
          revision("subtree", snapshot.source.sourceGeoSubtreeHash),
          revision("snapshot", snapshot.snapshotHash),
        ].sort((left, right) => compare(left.sourceRef, right.sourceRef)));
        if (new Set(sourceRevisions.map((item) => item.sourceRef)).size !== sourceRevisions.length) return [];
        candidates.push(Object.freeze({
          sourceKind: "canonical_meta_affected_geo_snapshot" as const,
          workspaceId: this.workspaceId,
          workspaceRef: this.workspaceRef,
          accountRef: scope.accountRef,
          campaignRef: scope.campaignRef,
          entity: Object.freeze({ ...scope.entity }),
          capturedAt: snapshot.capturedAt,
          geoRefs,
          sourceRevisions,
        }));
      }
      return Object.freeze(candidates);
    } catch { return []; }
  }
}

/** Production composition; construction performs no query and exposes no Meta transport or write method. */
export function createDrizzleAuthenticAffectedGeoEvidenceAdapter(input: Readonly<{
  database: Pick<Database, "execute" | "transaction">;
  workspaceId: string;
  workspaceRef: string;
}>): AuthenticAffectedGeoEvidencePort {
  return new AuthenticAffectedGeoEvidenceAdapter(
    new DrizzleMetaAffectedGeoEvidenceScopeResolver(input.database, input.workspaceId, input.workspaceRef),
    new DrizzleMetaAffectedGeoSnapshotRepository(input.database, input.workspaceId),
    input.workspaceId,
    input.workspaceRef,
  );
}
