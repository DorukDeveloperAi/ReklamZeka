import { describe, expect, it } from "vitest";
import {
  classifyMetaCanonicalDelta,
  hashMetaContentPayload,
  MetaAssetContentPersistenceError,
  MetaAssetContentPersistenceRun,
  type MetaAssetContentRepository,
  type MetaAssetContentScope,
  type MetaAssetContentTransaction,
  type MetaAssetContentWriteSummary,
  type MetaCanonicalWriteOutcome,
  type MetaContentRow,
} from "@/connectors/meta/sync/asset-content-persistence";
import { normalizeMetaAssetMirror, type MetaAssetMirrorSnapshotInput } from "@/domain/meta/asset-mirror";
import { extractMetaAdContent } from "@/domain/meta/content/extract";

const scope: MetaAssetContentScope = {
  workspaceId: "workspace-a",
  connectionId: "connection-a",
  connectionExternalKey: "meta-main",
};

function assetSnapshot(overrides: Partial<MetaAssetMirrorSnapshotInput> = {}) {
  const fetchedAt = "2026-08-07T08:00:00.000Z";
  const hash = "a".repeat(64);
  return normalizeMetaAssetMirror({
    schemaVersion: 1,
    workspaceId: scope.workspaceId,
    connectionExternalKey: scope.connectionExternalKey,
    adAccountExternalIds: ["act-1"],
    assets: [{
      externalAssetId: "page-1",
      assetType: "facebook_page",
      displayName: "Page",
      username: null,
      ownership: { kind: "accessible", ownerBusinessExternalId: null, evidence: "/me/accounts" },
      capabilities: [{ operation: "read", status: "verified", reason: null }],
      orphanReason: null,
      provenance: { sourceEdge: "/me/accounts", fetchedAt, sourceGraphVersion: "v24.0", fieldCatalogVersion: "assets-v1", rawPayloadHash: hash },
    }],
    edges: [{
      sourceType: "ad_account",
      sourceExternalId: "act-1",
      targetExternalAssetId: "page-1",
      relationship: "has_access_to_page",
      provenance: { sourceEdge: "/act-1", fetchedAt, sourceGraphVersion: "v24.0", fieldCatalogVersion: "assets-v1", rawPayloadHash: hash },
    }],
    discoveries: [{
      resource: "pages",
      sourceType: "connection",
      sourceExternalId: null,
      status: "verified",
      reason: null,
      itemCount: 1,
      provenance: {
        sourceEdge: "/me/accounts",
        fetchedAt,
        sourceGraphVersion: "v24.0",
        fieldCatalogVersion: "assets-v1",
        rawPayloadHash: hash,
      },
    }],
    fetchedAt,
    writeOperations: 0,
    ...overrides,
  });
}

function contentRecord(overrides: Record<string, unknown> = {}) {
  const payload = {
    id: "ad-1",
    adset_id: "adset-1",
    campaign_id: "campaign-1",
    effective_status: "ACTIVE",
    creative: {
      id: "creative-1",
      body: "Read only text",
      effective_object_story_id: "page-1_post-1",
      object_story_spec: { page_id: "page-1", link_data: { link: "https://example.test" } },
    },
  };
  return {
    adAccountExternalId: "act-1",
    extraction: extractMetaAdContent(payload),
    sourceRevision: "10",
    sourcePayloadHash: hashMetaContentPayload(payload),
    sourceGraphVersion: "v24.0",
    fieldCatalogVersion: "content-v1",
    fetchedAt: "2026-08-07T08:00:00.000Z",
    ...overrides,
  };
}

type Stored = { revision: string; hash: string };

class FakeRepository implements MetaAssetContentRepository {
  resolveCalls = 0;
  transactionCalls = 0;
  checkpointCalls = 0;
  batches: number[] = [];
  knownActors = new Set(["page-1"]);
  private readonly values = new Map<string, Stored>();

  async resolveRunScope(input: MetaAssetContentScope) {
    this.resolveCalls += 1;
    return { ...input, accountIdByExternalId: new Map([["act-1", "account-uuid-1"]]) };
  }

  async transaction<T>(work: (transaction: MetaAssetContentTransaction) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    const before = new Map(this.values);
    const checkpointBefore = this.checkpointCalls;
    const transaction: MetaAssetContentTransaction = {
      upsertAssets: async (rows) => {
        this.batches.push(rows.length);
        for (const row of rows) this.knownActors.add(row.asset.externalAssetId);
        return rows.map((row) => this.upsert(`asset:${row.asset.assetType}:${row.asset.externalAssetId}`, row.sourceRevision, row.asset.provenance.rawPayloadHash));
      },
      upsertDiscoveries: async (rows) => {
        this.batches.push(rows.length);
        return rows.map((row) => this.upsert(
          `discovery:${row.discovery.sourceType}:${row.discovery.sourceExternalId ?? "connection"}:${row.discovery.resource}`,
          row.sourceRevision,
          row.discovery.provenance.rawPayloadHash,
        ));
      },
      upsertEdges: async (rows) => {
        this.batches.push(rows.length);
        return rows.map((row) => this.upsert(`edge:${row.edge.sourceExternalId}:${row.edge.targetExternalAssetId}:${row.edge.relationship}`, row.sourceRevision, row.edge.provenance.rawPayloadHash));
      },
      validateReferences: async (rows) => {
        for (const row of rows) {
          const post = row.record.extraction.post;
          const actors = [post?.actorPageExternalId, post?.actorInstagramExternalId].filter((value): value is string => Boolean(value));
          if (actors.some((actor) => !this.knownActors.has(actor))) {
            throw new MetaAssetContentPersistenceError("wrong_actor", "Actor workspace/connection kapsamında değil");
          }
        }
      },
      upsertContent: async (rows) => {
        this.batches.push(rows.length);
        return rows.map((row) => this.upsert(contentIdentity(row), row.record.sourceRevision, row.record.sourcePayloadHash));
      },
      saveCheckpoint: async () => { this.checkpointCalls += 1; },
    };
    try {
      return await work(transaction);
    } catch (error) {
      this.values.clear();
      for (const [key, value] of before) this.values.set(key, value);
      this.checkpointCalls = checkpointBefore;
      throw error;
    }
  }

  private upsert(identity: string, revision: string, hash: string): MetaCanonicalWriteOutcome {
    const current = this.values.get(identity);
    const outcome = classifyMetaCanonicalDelta(
      current ? { sourceRevision: current.revision, sourcePayloadHash: current.hash } : null,
      { sourceRevision: revision, sourcePayloadHash: hash },
    );
    if (outcome === "inserted" || outcome === "updated") {
      this.values.set(identity, { revision, hash });
    }
    return outcome;
  }
}

function contentIdentity(row: MetaContentRow): string {
  return `content:${row.adAccountId}:${row.record.extraction.adContext.externalAdId}`;
}

async function write(repository: FakeRepository, page: Parameters<MetaAssetContentPersistenceRun["writePage"]>[0]): Promise<MetaAssetContentWriteSummary> {
  const run = await MetaAssetContentPersistenceRun.begin({ repository, scope, batchSize: 250 });
  return run.writePage(page);
}

describe("Meta asset/content persistence run", () => {
  it("caches account mapping once and commits deltas plus checkpoint in one short transaction", async () => {
    const repository = new FakeRepository();
    const run = await MetaAssetContentPersistenceRun.begin({ repository, scope, batchSize: 250 });
    const page = { sliceKey: "creative:1", cursor: "after-1", checkpoint: { page: 1 }, assetSnapshot: assetSnapshot(), content: [contentRecord()] };
    expect(await run.writePage(page)).toMatchObject({ inserted: 4, updated: 0, unchanged: 0, stale: 0, cursor: "after-1", recordCount: 4 });
    expect(await run.writePage(page)).toMatchObject({ inserted: 0, unchanged: 4 });
    expect(repository.resolveCalls).toBe(1);
    expect(repository.transactionCalls).toBe(2);
    expect(repository.checkpointCalls).toBe(2);
    expect(repository.batches.every((size) => size <= 250)).toBe(true);
  });

  it("keeps stale revisions and changed revisions deterministic and idempotent", async () => {
    const repository = new FakeRepository();
    expect(await write(repository, { sliceKey: "c", cursor: null, checkpoint: {}, content: [contentRecord()] })).toMatchObject({ inserted: 1 });
    expect(await write(repository, { sliceKey: "c", cursor: null, checkpoint: {}, content: [contentRecord({ sourceRevision: "9", sourcePayloadHash: "b".repeat(64) })] })).toMatchObject({ stale: 1 });
    expect(await write(repository, { sliceKey: "c", cursor: null, checkpoint: {}, content: [contentRecord({ sourceRevision: "11", sourcePayloadHash: "c".repeat(64) })] })).toMatchObject({ updated: 1 });
  });

  it("rejects cross-account pages before opening a transaction", async () => {
    const repository = new FakeRepository();
    const run = await MetaAssetContentPersistenceRun.begin({ repository, scope });
    await expect(run.writePage({ sliceKey: "c", cursor: null, checkpoint: {}, content: [contentRecord({ adAccountExternalId: "act-other" })] }))
      .rejects.toMatchObject({ code: "cross_account" });
    expect(repository.transactionCalls).toBe(0);
  });

  it("rejects a wrong post identity before opening a transaction", async () => {
    const repository = new FakeRepository();
    const record = contentRecord();
    const extraction = record.extraction;
    const post = extraction.post;
    expect(post).not.toBeNull();
    await expect(write(repository, {
      sliceKey: "c", cursor: null, checkpoint: {}, content: [{
        ...record,
        extraction: { ...extraction, post: post ? { ...post, externalPostId: "unrelated-post" } : null },
      }],
    })).rejects.toMatchObject({ code: "wrong_post" });
    expect(repository.transactionCalls).toBe(0);
  });

  it("rolls back canonical writes and checkpoint when actor validation fails", async () => {
    const repository = new FakeRepository();
    const record = contentRecord();
    const post = record.extraction.post;
    await expect(write(repository, {
      sliceKey: "c", cursor: "after", checkpoint: {}, content: [{
        ...record,
        extraction: { ...record.extraction, post: post ? { ...post, actorPageExternalId: "page-other" } : null },
      }],
    })).rejects.toMatchObject({ code: "wrong_actor" });
    expect(repository.transactionCalls).toBe(1);
    expect(repository.checkpointCalls).toBe(0);
  });

  it("rejects secret-bearing checkpoints, bounds large pages and never exposes raw identifiers", async () => {
    const repository = new FakeRepository();
    const run = await MetaAssetContentPersistenceRun.begin({ repository, scope });
    await expect(run.writePage({ sliceKey: "c", cursor: null, checkpoint: { access_token: "do-not-store" }, content: [] }))
      .rejects.toMatchObject({ code: "secret_boundary" });
    await expect(run.writePage({ sliceKey: "c", cursor: null, checkpoint: { accessToken: "do-not-store" }, content: [] }))
      .rejects.toMatchObject({ code: "secret_boundary" });
    const many = Array.from({ length: 501 }, (_, index) => contentRecord({
      extraction: extractMetaAdContent({ id: `ad-${index}`, creative: { id: `creative-${index}`, body: "text" } }),
    }));
    await expect(run.writePage({ sliceKey: "c", cursor: null, checkpoint: {}, content: many }))
      .resolves.toMatchObject({ inserted: 501, recordCount: 501 });
    expect(repository.batches).toEqual([250, 250, 1]);
    await expect(run.writePage({ sliceKey: "c", cursor: null, checkpoint: {}, content: [contentRecord({ adAccountExternalId: "sensitive-account-id" })] }))
      .rejects.not.toThrow("sensitive-account-id");
  });

  it("hashes semantically identical object payloads deterministically", () => {
    expect(hashMetaContentPayload({ b: 2, a: { d: 4, c: 3 } })).toBe(
      hashMetaContentPayload({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });
});
