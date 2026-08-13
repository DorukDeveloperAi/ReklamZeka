import { describe, expect, it } from "vitest";

import {
  MetaCreativeContentRuntimePersistence,
  META_CREATIVE_CONTENT_FIELD_CATALOG_VERSION,
} from "@/connectors/meta/sync/creative-content-runtime-persistence";
import type {
  MetaAssetContentPage,
  MetaAssetContentWriteSummary,
} from "@/connectors/meta/sync/asset-content-persistence";

const scope = {
  workspaceId: "workspace-fixture",
  connectionId: "connection-fixture",
  connectionExternalKey: "connection-fixture",
} as const;

describe("creative runtime canonical persistence adapter", () => {
  it("maps a completed GET-only creative_post page to the normal content writer", async () => {
    const pages: MetaAssetContentPage[] = [];
    let beginCount = 0;
    const persistence = new MetaCreativeContentRuntimePersistence(scope, async (receivedScope) => {
      beginCount += 1;
      expect(receivedScope).toEqual(scope);
      return {
        writePage: async (page): Promise<MetaAssetContentWriteSummary> => {
          pages.push(structuredClone(page));
          return { inserted: page.content.length, updated: 0, unchanged: 0, stale: 0, cursor: page.cursor, recordCount: page.content.length };
        },
      };
    });

    const result = await persistence.writeSourcePage({
      workspaceId: scope.workspaceId,
      connectionId: scope.connectionId,
      externalAccountId: "act_123",
      parentRunId: "run_fixture",
      sliceId: "creative_post:act_123:ad:all:all",
      cursorId: "a".repeat(64),
      nextCursor: null,
      observedAt: "2026-08-13T12:00:00.000Z",
      sourceGraphVersion: "v23.0",
      fieldCatalogVersion: META_CREATIVE_CONTENT_FIELD_CATALOG_VERSION,
      records: [{
        id: "ad_fixture",
        updated_time: "2026-08-13T11:00:00.000Z",
        creative: {
          id: "creative_fixture",
          body: "private creative copy",
          effective_object_story_id: "page_fixture_post_fixture",
        },
      }],
    });

    expect(result).toMatchObject({ inserted: 1, cursor: null, recordCount: 1 });
    expect(beginCount).toBe(1);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      sliceKey: "creative_post:act_123:ad:all:all",
      cursor: null,
      checkpoint: expect.objectContaining({ phase: "creative_post", terminal: true, recordCount: 1 }),
      content: [expect.objectContaining({
        adAccountExternalId: "act_123",
        sourceRevision: "2026-08-13T11:00:00.000Z",
        sourceGraphVersion: "v23.0",
        fieldCatalogVersion: META_CREATIVE_CONTENT_FIELD_CATALOG_VERSION,
        sourcePayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        extraction: expect.objectContaining({
          adContext: expect.objectContaining({ externalAdId: "ad_fixture" }),
          post: null,
          issues: expect.arrayContaining([expect.objectContaining({ code: "post_identity_unresolved" })]),
        }),
      })],
    });
    expect(JSON.stringify(pages[0]?.checkpoint)).not.toContain("private creative copy");
  });

  it("fails closed for a source page outside its resolved tenant/connection scope", async () => {
    const persistence = new MetaCreativeContentRuntimePersistence(scope, async () => ({
      writePage: async () => ({ inserted: 0, updated: 0, unchanged: 0, stale: 0, cursor: null, recordCount: 0 }),
    }));
    await expect(persistence.writeSourcePage({
      workspaceId: "other-workspace", connectionId: scope.connectionId, externalAccountId: "act_123",
      parentRunId: "run_fixture", sliceId: "creative_post:act_123:ad:all:all", cursorId: "a".repeat(64),
      nextCursor: null, observedAt: "2026-08-13T12:00:00.000Z", sourceGraphVersion: "v23.0",
      fieldCatalogVersion: META_CREATIVE_CONTENT_FIELD_CATALOG_VERSION, records: [],
    })).rejects.toThrow("scope");
  });
});
