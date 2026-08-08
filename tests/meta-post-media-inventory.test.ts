import { describe, expect, it } from "vitest";
import { discoverMetaPostMediaInventory } from "@/connectors/meta/post-media-inventory";
import { redactMetaPostMediaInventory } from "@/domain/meta/content/post-media-inventory";

const USER_TOKEN = "user-secret-token-value";
const PAGE_ONE_TOKEN = "page-one-secret-token";
const PAGE_TWO_TOKEN = "page-two-secret-token";
const NOW = "2026-08-07T10:00:00.000Z";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fixtureFetch(calls: Array<{ url: URL; method: string; authorization: string }>) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    calls.push({ url, method, authorization });
    if (method !== "GET") return jsonResponse({ error: { code: 999 } }, 405);

    if (url.pathname.endsWith("/me/accounts") && !url.searchParams.has("after")) {
      return jsonResponse({
        data: [{
          id: "page_11112222",
          name: "Doruk Hastaneleri",
          access_token: PAGE_ONE_TOKEN,
          instagram_business_account: { id: "ig_33334444", username: "dorukhastaneleri", name: "Doruk" },
        }],
        paging: { cursors: { after: "account-page-2" } },
      });
    }
    if (url.pathname.endsWith("/me/accounts") && url.searchParams.get("after") === "account-page-2") {
      return jsonResponse({ data: [{ id: "page_55556666", name: "Doruk Arabic", access_token: PAGE_TWO_TOKEN }] });
    }
    if (url.pathname.endsWith("/page_11112222/posts") && !url.searchParams.has("after")) {
      return jsonResponse({
        data: [{
          id: "page_11112222_77778888",
          message: "  Sağlıklı günler  ",
          created_time: "2026-08-01T09:30:00+0000",
          permalink_url: "https://www.facebook.com/doruk/posts/77778888",
          is_published: true,
          attachments: { data: [{ media_type: "photo", type: "photo" }] },
        }],
        paging: { cursors: { after: "post-page-2" } },
      });
    }
    if (url.pathname.endsWith("/page_11112222/posts") && url.searchParams.get("after") === "post-page-2") {
      return jsonResponse({
        data: [{
          id: "page_11112222_99990000",
          message: "Yayından kaldırılmış duyuru",
          created_time: "2026-07-30T08:00:00Z",
          is_published: false,
        }],
      });
    }
    if (url.pathname.endsWith("/ig_33334444/media")) {
      return jsonResponse({
        error: {
          message: `Permission denied; request contained ${PAGE_ONE_TOKEN}`,
          type: "OAuthException",
          code: 10,
        },
      }, 400);
    }
    if (url.pathname.endsWith("/page_55556666/posts")) {
      return jsonResponse({ error: { message: `Forbidden ${PAGE_TWO_TOKEN}`, code: 200 } }, 403);
    }
    return jsonResponse({ error: { code: 100 } }, 404);
  };
}

describe("Meta linked post/media inventory", () => {
  it("paginates Page actors and posts with GET only while isolating actor failures", async () => {
    const calls: Array<{ url: URL; method: string; authorization: string }> = [];
    const snapshot = await discoverMetaPostMediaInventory({
      token: USER_TOKEN,
      workspaceId: "workspace-1",
      connectionExternalKey: "meta-primary",
      fetchImpl: fixtureFetch(calls),
      now: () => new Date(NOW),
    });

    expect(calls).toHaveLength(6);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.filter((call) => call.url.pathname.endsWith("/me/accounts")))
      .toHaveLength(2);
    expect(calls.find((call) => call.url.pathname.endsWith("/page_11112222/posts"))?.authorization)
      .toBe(`Bearer ${PAGE_ONE_TOKEN}`);
    expect(calls.find((call) => call.url.pathname.endsWith("/ig_33334444/media"))?.authorization)
      .toBe(`Bearer ${PAGE_ONE_TOKEN}`);

    expect(snapshot.writeOperations).toBe(0);
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0]).toMatchObject({
      contentKind: "page_post",
      actor: { type: "facebook_page", externalId: "page_11112222", displayName: "Doruk Hastaneleri" },
      messageOrCaption: "Sağlıklı günler",
      mediaType: "image",
      lifecycle: "published",
      promotionEligibility: { status: "unknown" },
      previewSource: { classification: "server_only_sensitive" },
    });
    expect(snapshot.discoveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorExternalId: "page_11112222", status: "verified", itemCount: 2 }),
      expect.objectContaining({
        actorExternalId: "ig_33334444",
        status: "permission_missing",
        reason: "permission_missing",
        promotionEligibility: "permission_missing",
      }),
      expect.objectContaining({ actorExternalId: "page_55556666", status: "permission_missing", itemCount: 0 }),
    ]));
  });

  it("keeps tokens, full IDs, permalinks and provenance out of the public projection", async () => {
    const snapshot = await discoverMetaPostMediaInventory({
      token: USER_TOKEN,
      workspaceId: "workspace-1",
      connectionExternalKey: "meta-primary",
      fetchImpl: fixtureFetch([]),
      now: () => new Date(NOW),
    });
    const publicProjection = redactMetaPostMediaInventory(snapshot);
    const serialized = JSON.stringify(publicProjection);

    expect(serialized).not.toContain(USER_TOKEN);
    expect(serialized).not.toContain(PAGE_ONE_TOKEN);
    expect(serialized).not.toContain(PAGE_TWO_TOKEN);
    expect(serialized).not.toContain("page_11112222_77778888");
    expect(serialized).not.toContain("page_11112222");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("rawPayloadHash");
    expect(publicProjection.items[0]?.previewAvailable).toBe(true);
    expect(publicProjection.items[0]?.id).toMatch(/…/);
  });

  it("redacts hostile Graph error details and returns deterministic replay output", async () => {
    const first = await discoverMetaPostMediaInventory({
      token: USER_TOKEN,
      workspaceId: "workspace-1",
      connectionExternalKey: "meta-primary",
      fetchImpl: fixtureFetch([]),
      now: () => new Date(NOW),
    });
    const second = await discoverMetaPostMediaInventory({
      token: USER_TOKEN,
      workspaceId: "workspace-1",
      connectionExternalKey: "meta-primary",
      fetchImpl: fixtureFetch([]),
      now: () => new Date(NOW),
    });

    expect(second).toEqual(first);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain(USER_TOKEN);
    expect(serialized).not.toContain(PAGE_ONE_TOKEN);
    expect(serialized).not.toContain(PAGE_TWO_TOKEN);
    expect(first.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.items.every((item) => item.contentHash.match(/^[a-f0-9]{64}$/))).toBe(true);
  });

  it("fails a top-level Page connection explicitly without leaking Graph details or using a write method", async () => {
    const methods: string[] = [];
    let failure: unknown;
    try {
      await discoverMetaPostMediaInventory({
        token: USER_TOKEN,
        workspaceId: "workspace-1",
        connectionExternalKey: "meta-primary",
        now: () => new Date(NOW),
        fetchImpl: async (_input, init) => {
          methods.push(init?.method ?? "GET");
          return jsonResponse({ error: { message: USER_TOKEN, code: 10 } }, 400);
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(methods).toEqual(["GET"]);
    expect(failure).toMatchObject({ code: "authentication", message: "Meta Page bağlantısı için erişim izni bulunamadı" });
    expect(JSON.stringify(failure)).not.toContain(USER_TOKEN);
  });

  it("retains bounded rows and marks an actor partial when its pagination limit is reached", async () => {
    const snapshot = await discoverMetaPostMediaInventory({
      token: USER_TOKEN,
      workspaceId: "workspace-1",
      connectionExternalKey: "meta-primary",
      now: () => new Date(NOW),
      maxPagesPerActor: 1,
      fetchImpl: async (input, init) => {
        expect(init?.method).toBe("GET");
        const url = new URL(input);
        if (url.pathname.endsWith("/me/accounts")) {
          return jsonResponse({ data: [{ id: "page_11112222", name: "Doruk", access_token: PAGE_ONE_TOKEN }] });
        }
        return jsonResponse({
          data: [{ id: "post_11112222", message: "İlk sayfa", created_time: NOW, is_published: true }],
          paging: { cursors: { after: "bounded-cursor" } },
        });
      },
    });

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.discoveries).toContainEqual(expect.objectContaining({
      actorExternalId: "page_11112222",
      status: "partial",
      reason: "pagination_limit",
      itemCount: 1,
    }));
  });
});
