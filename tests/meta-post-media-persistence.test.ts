import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  classifyMetaCanonicalDelta,
  MetaAssetContentPersistenceRun,
  type MetaAssetContentRepository,
  type MetaAssetContentScope,
  type MetaAssetContentTransaction,
  type MetaCanonicalWriteOutcome,
} from "@/connectors/meta/sync/asset-content-persistence";
import {
  contentHashFor,
  normalizeMetaPostMediaInventory,
} from "@/domain/meta/content/post-media-inventory";
import {
  metaAssetDiscoveryResource,
  metaAssetDiscoverySourceType,
  metaAssetDiscoveryStatus,
} from "@/db/schema";

const scope: MetaAssetContentScope = {
  workspaceId: "workspace-post-media",
  connectionId: "connection-post-media",
  connectionExternalKey: "meta-post-media",
};

function inventory(overrides: { workspaceId?: string; connectionExternalKey?: string } = {}) {
  const fetchedAt = "2026-08-07T11:30:00.000Z";
  const pageInput = {
    externalContentId: "page-fixture_post-fixture",
    contentKind: "page_post" as const,
    actorType: "facebook_page" as const,
    actorExternalId: "page-fixture",
    messageOrCaption: "Fixture page message",
    mediaType: "image" as const,
    publishedAt: "2026-08-07T10:00:00.000Z",
    lifecycle: "published" as const,
  };
  return normalizeMetaPostMediaInventory({
    schemaVersion: 1,
    workspaceId: overrides.workspaceId ?? scope.workspaceId,
    connectionExternalKey: overrides.connectionExternalKey ?? scope.connectionExternalKey,
    fetchedAt,
    items: [{
      externalContentId: pageInput.externalContentId,
      contentKind: pageInput.contentKind,
      actor: { type: pageInput.actorType, externalId: pageInput.actorExternalId, displayName: "Fixture", username: null },
      messageOrCaption: pageInput.messageOrCaption,
      mediaType: pageInput.mediaType,
      publishedAt: pageInput.publishedAt,
      lifecycle: pageInput.lifecycle,
      contentHash: contentHashFor(pageInput),
      ownership: { kind: "accessible", evidence: "/me/accounts" },
      readCapability: { status: "verified", evidence: "edge_read_succeeded" },
      promotionEligibility: { status: "unknown", reason: "not_verified_by_inventory_read" },
      previewSource: { classification: "server_only_sensitive", permalink: "https://example.test/private-preview" },
      provenance: {
        sourceEdge: "/page-fixture/posts",
        sourceGraphVersion: "v24.0",
        fieldCatalogVersion: "post-media-v1",
        fetchedAt,
        rawPayloadHash: "a".repeat(64),
      },
    }],
    discoveries: [{
      actorType: "facebook_page",
      actorExternalId: "page-fixture",
      sourceEdge: "/page-fixture/posts",
      status: "partial",
      itemCount: 1,
      reason: "pagination_limit",
      promotionEligibility: "unknown",
    }, {
      actorType: "instagram_account",
      actorExternalId: "instagram-fixture",
      sourceEdge: "/instagram-fixture/media",
      status: "permission_missing",
      itemCount: 0,
      reason: "permission_missing",
      promotionEligibility: "permission_missing",
    }],
    writeOperations: 0,
  });
}

type Stored = Readonly<{ sourceRevision: string; sourcePayloadHash: string }>;

class InventoryRepository implements MetaAssetContentRepository {
  readonly values = new Map<string, Stored>();
  readonly discoveryEvidence: Array<Record<string, unknown>> = [];
  transactions = 0;
  checkpoints = 0;

  async resolveRunScope(input: MetaAssetContentScope) {
    return { ...input, accountIdByExternalId: new Map<string, string>() };
  }

  async transaction<T>(work: (transaction: MetaAssetContentTransaction) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const before = new Map(this.values);
    const transaction: MetaAssetContentTransaction = {
      upsertAssets: async () => [],
      upsertDiscoveries: async () => [],
      upsertEdges: async () => [],
      upsertContent: async () => [],
      validateReferences: async () => undefined,
      validatePostMediaReferences: async (rows, discoveries) => {
        const itemActors = rows.map((row) => row.item.actor.externalId);
        const discoveryActors = discoveries.map((row) => row.discovery.actorExternalId);
        if ([...itemActors, ...discoveryActors].some((actor) => !["page-fixture", "instagram-fixture"].includes(actor))) {
          throw new Error("masked actor scope error");
        }
      },
      upsertPostMediaItems: async (rows) => rows.map((row) =>
        this.upsert(`post:${row.item.externalContentId}`, row.sourceRevision, row.sourcePayloadHash)),
      upsertPostMediaDiscoveries: async (rows) => rows.map((row) => {
        this.discoveryEvidence.push({
          status: row.discovery.status,
          promotionEligibility: row.discovery.promotionEligibility,
          graphVersion: row.sourceGraphVersion,
        });
        return this.upsert(
          `discovery:${row.discovery.actorType}:${row.discovery.actorExternalId}`,
          row.sourceRevision,
          row.sourcePayloadHash,
        );
      }),
      saveCheckpoint: async () => { this.checkpoints += 1; },
    };
    try {
      return await work(transaction);
    } catch (error) {
      this.values.clear();
      for (const [key, value] of before) this.values.set(key, value);
      throw error;
    }
  }

  private upsert(key: string, revision: string, hash: string): MetaCanonicalWriteOutcome {
    const current = this.values.get(key);
    const result = classifyMetaCanonicalDelta(current ?? null, { sourceRevision: revision, sourcePayloadHash: hash });
    if (result === "inserted" || result === "updated") {
      this.values.set(key, { sourceRevision: revision, sourcePayloadHash: hash });
    }
    return result;
  }
}

describe("Meta linked post/media persistence port", () => {
  it("extends the fail-closed discovery table with additive enum values only", () => {
    expect(metaAssetDiscoveryResource.enumValues).toEqual(expect.arrayContaining(["page_posts", "instagram_media"]));
    expect(metaAssetDiscoverySourceType.enumValues).toContain("asset");
    expect(metaAssetDiscoveryStatus.enumValues).toContain("partial");
    const migration = readFileSync(
      new URL("../drizzle/20260807114303_cool_union_jack.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("ALTER TYPE");
    expect(migration).not.toContain("CREATE TABLE");
    expect(migration).not.toContain("DISABLE ROW LEVEL SECURITY");
  });

  it("batches canonical items and discovery gaps with the checkpoint in one transaction", async () => {
    const repository = new InventoryRepository();
    const run = await MetaAssetContentPersistenceRun.begin({ repository, scope, batchSize: 250 });
    const page = {
      sliceKey: "post-media:fixture",
      cursor: "after-fixture",
      checkpoint: { edge: "posts" },
      postMediaInventory: inventory(),
      content: [],
    };
    expect(await run.writePage(page)).toMatchObject({ inserted: 3, recordCount: 3, cursor: "after-fixture" });
    const replay = await run.writePage(page);
    expect(replay).toEqual({ inserted: 0, updated: 0, unchanged: 3, stale: 0, cursor: "after-fixture", recordCount: 3 });
    expect(repository.transactions).toBe(2);
    expect(repository.checkpoints).toBe(2);
    expect(repository.discoveryEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "partial", promotionEligibility: "unknown", graphVersion: "v24.0" }),
      expect.objectContaining({ status: "permission_missing", promotionEligibility: "permission_missing", graphVersion: "unknown" }),
    ]));
  });

  it("rejects a cross-scope inventory before opening a transaction", async () => {
    const repository = new InventoryRepository();
    const run = await MetaAssetContentPersistenceRun.begin({ repository, scope });
    await expect(run.writePage({
      sliceKey: "post-media:fixture",
      cursor: null,
      checkpoint: {},
      postMediaInventory: inventory({ workspaceId: "another-workspace" }),
      content: [],
    })).rejects.toMatchObject({ code: "invalid_scope" });
    expect(repository.transactions).toBe(0);
  });
});
