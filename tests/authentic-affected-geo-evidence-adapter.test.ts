import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  ExistingPostPromotionProtectionEvidenceMaterializer,
  type ProtectionEvidenceScope,
} from "@/application/existing-post-promotion-protection-evidence-materializer";
import {
  AuthenticAffectedGeoEvidenceAdapter,
  createDrizzleAuthenticAffectedGeoEvidenceAdapter,
  DrizzleMetaAffectedGeoEvidenceScopeResolver,
  type MetaAffectedGeoEvidenceScopeResolver,
  type MetaAffectedGeoEvidenceSnapshotReader,
} from "@/connectors/actions/authentic-affected-geo-evidence-adapter";
import type { MetaAffectedGeoSnapshotExactScope } from "@/connectors/meta/meta-affected-geo-snapshot-drizzle-repository";
import {
  hashMetaAffectedGeoSourceSubtree,
  normalizeMetaAffectedGeoCountries,
  type CanonicalAffectedGeoCountrySnapshot,
} from "@/domain/meta/affected-geo-country-snapshot";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const foreignWorkspaceId = "99999999-9999-4999-8999-999999999999";
const accountId = "22222222-2222-4222-8222-222222222222";
const campaignId = "33333333-3333-4333-8333-333333333333";
const adSetId = "44444444-4444-4444-8444-444444444444";
const h = (value: string) => value.repeat(64);

const scope: ProtectionEvidenceScope = Object.freeze({
  workspaceId,
  workspaceRef: "workspace_alpha",
  accountRef: "account_doruk",
  campaignRef: "campaign_leads",
  entity: Object.freeze({ level: "adset", ref: "adset_leads" }),
  notBefore: "2026-08-08T11:00:00.000Z",
  evaluatedAt: "2026-08-08T13:00:00.000Z",
});

function snapshot(): CanonicalAffectedGeoCountrySnapshot {
  const targeting = { geo_locations: { countries: ["TR", "DE"], location_types: ["home", "recent"] } };
  const result = normalizeMetaAffectedGeoCountries({
    sourceKind: "meta_graph_adset_targeting",
    scope: { workspaceRef: scope.workspaceRef, accountRef: scope.accountRef,
      campaignRef: scope.campaignRef, adSetRef: scope.entity.ref },
    sourceGraphVersion: "v23.0",
    fieldCatalogVersion: "catalog-meta/1.0.0",
    fetchedAt: "2026-08-08T12:00:00.000Z",
    provenance: { observationRunRef: "observation_sync", sliceRef: "slice_adsets", pageRef: "page_one",
      rawPayloadHash: h("a"), sourceGeoSubtreeHash: hashMetaAffectedGeoSourceSubtree(targeting) },
    targeting,
  });
  if (result.status !== "known") throw new Error("fixture_failed");
  return result;
}

function identity(value = snapshot(), patch: Partial<MetaAffectedGeoSnapshotExactScope> = {}): MetaAffectedGeoSnapshotExactScope {
  return Object.freeze({
    workspaceId, workspaceRef: value.scope.workspaceRef, adAccountId: accountId, accountRef: value.scope.accountRef,
    campaignId, campaignRef: value.scope.campaignRef, adSetId, adSetRef: value.scope.adSetRef,
    capturedAt: value.capturedAt, sourceGraphVersion: value.source.sourceGraphVersion,
    fieldCatalogVersion: value.source.fieldCatalogVersion, rawPayloadHash: value.source.rawPayloadHash,
    sourceGeoSubtreeHash: value.source.sourceGeoSubtreeHash, snapshotHash: value.snapshotHash,
    ...patch,
  });
}

function scopeRow(value = identity(), patch: Record<string, unknown> = {}) {
  return {
    workspace_id: value.workspaceId, workspace_ref: value.workspaceRef,
    ad_account_id: value.adAccountId, account_ref: value.accountRef,
    campaign_id: value.campaignId, campaign_ref: value.campaignRef,
    ad_set_id: value.adSetId, ad_set_ref: value.adSetRef,
    captured_at: value.capturedAt, source_graph_version: value.sourceGraphVersion,
    field_catalog_version: value.fieldCatalogVersion, raw_payload_hash: value.rawPayloadHash,
    source_geo_subtree_hash: value.sourceGeoSubtreeHash, snapshot_hash: value.snapshotHash,
    ...patch,
  };
}

function harness(input: Readonly<{
  identities?: readonly MetaAffectedGeoSnapshotExactScope[];
  value?: unknown;
}> = {}) {
  const value = Object.hasOwn(input, "value") ? input.value : snapshot();
  const scopes: MetaAffectedGeoEvidenceScopeResolver = {
    resolve: vi.fn(async () => input.identities ?? [identity(value as CanonicalAffectedGeoCountrySnapshot)]),
  };
  const snapshots: MetaAffectedGeoEvidenceSnapshotReader = {
    resolveExact: vi.fn(async () => value as CanonicalAffectedGeoCountrySnapshot),
  };
  return { scopes, snapshots, adapter: new AuthenticAffectedGeoEvidenceAdapter(
    scopes, snapshots, workspaceId, scope.workspaceRef,
  ) };
}

describe("AuthenticAffectedGeoEvidenceAdapter", () => {
  it("maps one exact current canonical snapshot to hash-only public evidence", async () => {
    const setup = harness();
    const candidates = await setup.adapter.resolveCandidates(scope);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      sourceKind: "canonical_meta_affected_geo_snapshot", workspaceId, workspaceRef: scope.workspaceRef,
      accountRef: scope.accountRef, campaignRef: scope.campaignRef, entity: scope.entity,
      capturedAt: "2026-08-08T12:00:00.000Z",
    });
    expect(candidates[0]!.geoRefs).toHaveLength(2);
    expect(candidates[0]!.geoRefs.every((ref) => /^geo_[a-f0-9]{64}$/.test(ref))).toBe(true);
    expect(candidates[0]!.sourceRevisions).toHaveLength(5);
    const serialized = JSON.stringify(candidates);
    for (const privateValue of [accountId, campaignId, adSetId, "TR", "DE", "geo_locations", "targeting"]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(setup.snapshots.resolveExact).toHaveBeenCalledWith(identity());
  });

  it("materializes known geo evidence while retaining zero authority", async () => {
    const setup = harness();
    const materializer = new ExistingPostPromotionProtectionEvidenceMaterializer(
      { resolveCandidates: async () => [] }, setup.adapter,
    );
    const material = await materializer.resolve(scope);
    expect(material.affectedGeoEvidence).toMatchObject({ status: "known", refs: expect.any(Array) });
    expect(material.capabilities).toEqual({ canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false });
  });

  it("constructs the Drizzle production composition without DB, network or write activity", () => {
    const execute = vi.fn();
    const transaction = vi.fn();
    const adapter = createDrizzleAuthenticAffectedGeoEvidenceAdapter({
      database: { execute, transaction } as never,
      workspaceId,
      workspaceRef: scope.workspaceRef,
    });
    expect(typeof adapter.resolveCandidates).toBe("function");
    expect(execute).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(Object.keys(adapter)).not.toEqual(expect.arrayContaining(["append", "write", "execute", "approve"]));
  });

  it("rejects caller cross-tenant and non-adset scopes before private resolution", async () => {
    const setup = harness();
    await expect(setup.adapter.resolveCandidates({ ...scope, workspaceRef: "workspace_foreign" })).resolves.toEqual([]);
    await expect(setup.adapter.resolveCandidates({ ...scope,
      entity: { level: "campaign", ref: scope.campaignRef } })).resolves.toEqual([]);
    expect(setup.scopes.resolve).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", []],
    ["stale", [identity(snapshot(), { capturedAt: "2026-08-08T10:59:59.000Z" })]],
    ["wrong account", [identity(snapshot(), { accountRef: "account_foreign" })]],
    ["wrong hierarchy", [identity(snapshot(), { adSetRef: "adset_foreign" })]],
  ])("fails closed for %s exact-scope resolution", async (_label, identities) => {
    const setup = harness({ identities });
    await expect(setup.adapter.resolveCandidates(scope)).resolves.toEqual([]);
    expect(setup.snapshots.resolveExact).not.toHaveBeenCalled();
  });

  it("returns two bounded authentic candidates so the materializer marks ambiguity", async () => {
    const duplicate = identity();
    const setup = harness({ identities: [duplicate, duplicate] });
    await expect(setup.adapter.resolveCandidates(scope)).resolves.toHaveLength(2);
    const materializer = new ExistingPostPromotionProtectionEvidenceMaterializer(
      { resolveCandidates: async () => [] }, setup.adapter,
    );
    await expect(materializer.resolve(scope)).resolves.toMatchObject({
      affectedGeoEvidenceRef: null,
      affectedGeoEvidence: { status: "unknown", reasonRef: "affected_geo_evidence_ambiguous" },
    });
    expect(setup.snapshots.resolveExact).toHaveBeenCalledTimes(4);
  });

  it("fails closed for missing, unknown or corrupt repository results", async () => {
    for (const value of [
      null,
      { version: "meta-affected-geo-country-snapshot/1.0.0", status: "unknown" },
      { ...snapshot(), snapshotHash: h("f") },
      { ...snapshot(), capabilities: { canApprove: true, canExecute: false, canWriteMeta: false, canGrantApproval: false } },
    ]) {
      const setup = harness({ value });
      vi.mocked(setup.scopes.resolve).mockResolvedValue([identity()]);
      await expect(setup.adapter.resolveCandidates(scope)).resolves.toEqual([]);
    }
    const unavailable = harness();
    vi.mocked(unavailable.snapshots.resolveExact).mockRejectedValue(new Error("private raw targeting"));
    await expect(unavailable.adapter.resolveCandidates(scope)).resolves.toEqual([]);
  });
});

describe("DrizzleMetaAffectedGeoEvidenceScopeResolver", () => {
  it("reads at most two newest identities from an active tenant and selects no targeting payload", async () => {
    const first = identity();
    const second = identity(snapshot(), { capturedAt: "2026-08-08T11:30:00.000Z", snapshotHash: h("e") });
    const execute = vi.fn(async (_query: unknown) => ({ rows: [scopeRow(first), scopeRow(second)] }));
    const resolver = new DrizzleMetaAffectedGeoEvidenceScopeResolver(
      { execute } as never, workspaceId, scope.workspaceRef,
    );

    await expect(resolver.resolve(scope)).resolves.toEqual([first, second]);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as never);
    expect(query.sql).toContain("workspace.lifecycle_state = 'active'");
    expect(query.sql).toContain("where snapshot.workspace_id =");
    expect(query.sql).toContain("snapshot.account_ref =");
    expect(query.sql).toContain("snapshot.campaign_ref =");
    expect(query.sql).toContain("snapshot.ad_set_ref =");
    expect(query.sql).toContain("snapshot.captured_at >=");
    expect(query.sql).toContain("snapshot.captured_at <=");
    expect(query.sql).toContain("limit 2");
    expect(query.sql).not.toMatch(/targeting|country_code|external_(account|campaign|ad_set)_id/i);
  });

  it("returns zero without DB access for cross-tenant and non-adset caller scopes", async () => {
    const execute = vi.fn();
    const resolver = new DrizzleMetaAffectedGeoEvidenceScopeResolver(
      { execute } as never, workspaceId, scope.workspaceRef,
    );
    await expect(resolver.resolve({ ...scope, workspaceRef: "workspace_foreign" })).resolves.toEqual([]);
    await expect(resolver.resolve({ ...scope, entity: { level: "ad", ref: "ad_foreign" } })).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects corrupt private identities so the adapter can fail closed", async () => {
    const execute = vi.fn(async (_query: unknown) => ({ rows: [scopeRow(identity(), { workspace_id: foreignWorkspaceId })] }));
    const resolver = new DrizzleMetaAffectedGeoEvidenceScopeResolver(
      { execute } as never, workspaceId, scope.workspaceRef,
    );
    await expect(resolver.resolve(scope)).rejects.toThrow("affected_geo_scope_store_corrupt");
  });
});
