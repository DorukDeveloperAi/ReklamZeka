import { describe, expect, it } from "vitest";
import { ConnectorError } from "@/connectors/contract";
import {
  MetaS14LiveAssetContentService,
  type MetaAssetContentPageWriter,
} from "@/connectors/meta/sync/live-asset-content-service";
import type { MetaAssetContentPage, MetaAssetContentWriteSummary } from "@/connectors/meta/sync/asset-content-persistence";
import type { MetaReadRequest, MetaReadTransport } from "@/connectors/meta/sync/types";
import { planMetaReadSync } from "@/connectors/meta/sync/planner";
import { META_ASSET_MIRROR_SCHEMA_VERSION, normalizeMetaAssetMirror } from "@/domain/meta/asset-mirror";
import {
  META_POST_MEDIA_INVENTORY_SCHEMA_VERSION,
  normalizeMetaPostMediaInventory,
} from "@/domain/meta/content/post-media-inventory";

const fetchedAt = "2026-08-07T09:00:00.000Z";
const hash = "a".repeat(64);
const secret = "fixture-super-secret-token-never-return";
const accountA = "act_111111111111111";
const accountB = "act_222222222222222";
const adText = "private ad copy must stay in persistence only";

function assetSnapshot() {
  return normalizeMetaAssetMirror({
    schemaVersion: META_ASSET_MIRROR_SCHEMA_VERSION,
    workspaceId: "workspace-fixture",
    connectionExternalKey: "connection-external-fixture",
    adAccountExternalIds: [accountA, accountB],
    assets: [],
    edges: [],
    discoveries: [{
      resource: "ad_accounts",
      sourceType: "connection",
      sourceExternalId: null,
      status: "verified",
      reason: null,
      itemCount: 2,
      provenance: {
        sourceEdge: "/me/adaccounts",
        fetchedAt,
        sourceGraphVersion: "v23.0",
        fieldCatalogVersion: "fixture-v1",
        rawPayloadHash: hash,
      },
    }],
    fetchedAt,
    writeOperations: 0,
  });
}

function postInventory() {
  return normalizeMetaPostMediaInventory({
    schemaVersion: META_POST_MEDIA_INVENTORY_SCHEMA_VERSION,
    workspaceId: "workspace-fixture",
    connectionExternalKey: "connection-external-fixture",
    fetchedAt,
    items: [],
    discoveries: [],
    writeOperations: 0,
  });
}

class CapturingWriter implements MetaAssetContentPageWriter {
  readonly pages: MetaAssetContentPage[] = [];

  async writePage(page: MetaAssetContentPage): Promise<MetaAssetContentWriteSummary> {
    this.pages.push(structuredClone(page));
    const recordCount = (page.assetSnapshot?.assets.length ?? 0)
      + (page.assetSnapshot?.edges.length ?? 0)
      + (page.assetSnapshot?.discoveries.length ?? 0)
      + page.content.length;
    return {
      inserted: recordCount,
      updated: 0,
      unchanged: 0,
      stale: 0,
      cursor: page.cursor,
      recordCount,
    };
  }
}

class FixtureTransport implements MetaReadTransport {
  readonly requests: MetaReadRequest[] = [];

  async get(request: MetaReadRequest) {
    this.requests.push(structuredClone(request));
    if (request.accountId === accountB) {
      throw new ConnectorError("transient", `network failed with ${secret}`, true);
    }
    if (request.cursor === null) {
      return {
        records: [{
          id: "ad-private-1",
          updated_time: "2026-08-07T08:00:00.000Z",
          creative: { id: "creative-private-1", body: adText },
        }],
        nextCursor: "opaque-page-two",
        usageHeadroom: 0.1,
      };
    }
    return {
      records: [{
        id: "ad-private-2",
        creative: {
          id: "creative-private-2",
          effective_object_story_id: "page-private_post-private",
          object_story_spec: { page_id: "page-private", link_data: { message: "second private copy" } },
        },
      }],
      nextCursor: null,
      usageHeadroom: 0.5,
    };
  }
}

function makeService(input: Readonly<{
  writer: CapturingWriter;
  transport: FixtureTransport;
  sleeps: number[];
  persistedInventories: unknown[];
}>) {
  return new MetaS14LiveAssetContentService({
    secretResolver: { resolve: async (reference) => {
      expect(reference).toBe("env:META_ACCESS_TOKEN");
      return secret;
    } },
    beginPersistenceRun: async (scope) => {
      expect(scope).toEqual({
        workspaceId: "workspace-fixture",
        connectionId: "connection-fixture",
        connectionExternalKey: "connection-external-fixture",
      });
      return input.writer;
    },
    transportFactory: (token) => {
      expect(token).toBe(secret);
      return input.transport;
    },
    discoverAssets: async (options) => {
      expect(options.token).toBe(secret);
      return assetSnapshot();
    },
    discoverPostInventory: async (options) => {
      expect(options.token).toBe(secret);
      return postInventory();
    },
    // Keep orchestration fixtures hermetic; recovery itself is verified against
    // a Graph-shaped GET fixture in the post-media inventory test suite.
    recoverPostInventory: async (options) => {
      expect(options.token).toBe(secret);
      return postInventory();
    },
    postInventoryPersistence: {
      persist: async (inventory) => { input.persistedInventories.push(structuredClone(inventory)); },
    },
    now: () => new Date(fetchedAt),
    sleep: async (milliseconds) => { input.sleeps.push(milliseconds); },
    random: () => 0,
    maxAttempts: 1,
    maxPagesPerAccount: 3,
    accountConcurrency: 2,
    initialPageSize: 100,
    minPageSize: 25,
  });
}

const canonicalPlan = planMetaReadSync({
  accountIds: [accountB, accountA],
  dateStart: "2026-08-07",
  dateStop: "2026-08-07",
});
const creativeSliceKeys = Object.fromEntries(canonicalPlan
  .filter((slice) => slice.stream === "creative_post")
  .map((slice) => [slice.accountId, slice.id]));

const runInput = {
  runId: "run-fixture",
  workspaceId: "workspace-fixture",
  connectionId: "connection-fixture",
  connectionExternalKey: "connection-external-fixture",
  secretReference: "env:META_ACCESS_TOKEN",
  selectedAdAccountExternalIds: [accountB, accountA],
  sliceKeys: {
    asset: "asset-mirror:durable-fixture",
    postMedia: "post-media:durable-fixture",
    creativeByAdAccountExternalId: creativeSliceKeys,
  },
} as const;

describe("Meta S1.4 live asset/content orchestration", () => {
  it("persists page deltas with advancing checkpoints and isolates a partial account", async () => {
    const writer = new CapturingWriter();
    const transport = new FixtureTransport();
    const sleeps: number[] = [];
    const persistedInventories: unknown[] = [];
    const result = await makeService({ writer, transport, sleeps, persistedInventories }).run(runInput);

    expect(result).toMatchObject({
      status: "partial",
      creativeEvidence: {
        selectedAccounts: 2,
        completedAccounts: 1,
        partialAccounts: 1,
        pagesRead: 2,
        adsObserved: 2,
        contentRecords: 2,
        contentWithCopy: 2,
        existingPostBindings: 1,
      },
      postInventoryEvidence: {
        status: "completed", persistenceInvoked: true, recoveryTargetActors: 1, recoveredItems: 0,
      },
      writeNetworkCalls: 0,
    });
    expect(result.creativeEvidence.accounts.map((entry) => entry.status).sort()).toEqual(["completed", "partial"]);
    expect(result.creativeEvidence.accounts.find((entry) => entry.status === "partial")?.failureReason).toBe("connection_lost");

    const creativePages = writer.pages.filter((page) => page.content.length > 0);
    expect(creativePages).toHaveLength(2);
    expect(creativePages.map((page) => page.content.length)).toEqual([1, 1]);
    expect(creativePages.map((page) => page.cursor)).toEqual(["opaque-page-two", null]);
    expect(creativePages.map((page) => page.checkpoint)).toEqual([
      expect.objectContaining({ pageOrdinal: 1, fetchedRecordCount: 1, nextCursorPresent: true, terminal: false }),
      expect.objectContaining({ pageOrdinal: 2, fetchedRecordCount: 1, nextCursorPresent: false, terminal: true }),
    ]);
    expect(writer.pages[0]).toMatchObject({ assetSnapshot: expect.any(Object), content: [], cursor: null });
    expect(writer.pages.find((page) => page.postMediaInventory)).toMatchObject({
      sliceKey: "post-media:durable-fixture",
      postMediaInventory: expect.any(Object),
      content: [],
      cursor: null,
    });
    expect(creativePages.map((page) => page.sliceKey)).toEqual([
      creativeSliceKeys[accountA],
      creativeSliceKeys[accountA],
    ]);
    expect(persistedInventories).toHaveLength(1);

    const accountARequests = transport.requests.filter((request) => request.accountId === accountA);
    expect(accountARequests.map((request) => request.cursor)).toEqual([null, "opaque-page-two"]);
    expect(accountARequests.map((request) => request.limit)).toEqual([100, 50]);
    expect(accountARequests.every((request) => request.correlation.sliceId === creativeSliceKeys[accountA])).toBe(true);
    expect(transport.requests.every((request) => request.method === "GET")).toBe(true);
    expect(sleeps).toEqual([250]);
  });

  it("keeps correlation deterministic while excluding secrets, full IDs and ad text from its result", async () => {
    const first = await makeService({
      writer: new CapturingWriter(),
      transport: new FixtureTransport(),
      sleeps: [],
      persistedInventories: [],
    }).run(runInput);
    const second = await makeService({
      writer: new CapturingWriter(),
      transport: new FixtureTransport(),
      sleeps: [],
      persistedInventories: [],
    }).run(runInput);

    expect(second.runCorrelationId).toBe(first.runCorrelationId);
    expect(second.creativeEvidence.accounts.map((entry) => [entry.accountRef, entry.correlationId]))
      .toEqual(first.creativeEvidence.accounts.map((entry) => [entry.accountRef, entry.correlationId]));
    const publicJson = JSON.stringify(first);
    expect(publicJson).not.toContain(secret);
    expect(publicJson).not.toContain(accountA);
    expect(publicJson).not.toContain(accountB);
    expect(publicJson).not.toContain("ad-private");
    expect(publicJson).not.toContain(adText);
    expect(publicJson).not.toContain("second private copy");
    expect(publicJson).not.toContain("opaque-page-two");
  });

  it("fails closed before resolving the secret when a planner slice mapping is missing", async () => {
    let secretReads = 0;
    const service = new MetaS14LiveAssetContentService({
      secretResolver: { resolve: async () => { secretReads += 1; return secret; } },
      beginPersistenceRun: async () => new CapturingWriter(),
      transportFactory: () => new FixtureTransport(),
      discoverAssets: async () => assetSnapshot(),
      discoverPostInventory: async () => postInventory(),
    });

    await expect(service.run({
      ...runInput,
      sliceKeys: {
        ...runInput.sliceKeys,
        creativeByAdAccountExternalId: { [accountA]: creativeSliceKeys[accountA]! },
      },
    })).rejects.toThrow("creative slice key");
    expect(secretReads).toBe(0);
  });

  it("redacts a secret resolver failure instead of propagating provider material", async () => {
    const service = new MetaS14LiveAssetContentService({
      secretResolver: { resolve: async () => { throw new Error(`provider failed: ${secret}`); } },
      beginPersistenceRun: async () => new CapturingWriter(),
    });

    const failure = await service.run(runInput).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConnectorError);
    expect(String((failure as Error).message)).not.toContain(secret);
    expect(failure).toMatchObject({ code: "authentication", retryable: false });
  });
});
