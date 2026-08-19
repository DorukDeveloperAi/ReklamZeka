import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaGraphClient, type MetaFetch } from "@/connectors/meta/graph-client";
import { discoverMetaInventory, maskMetaId } from "@/connectors/meta/inventory";
import { GET as getMetaInventory } from "@/app/api/meta/inventory/route";

const token = "fixture-sensitive-meta-token";

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function inventoryFetch(): MetaFetch {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);

    if (url.pathname.endsWith("/debug_token")) {
      return json({ data: { is_valid: true, scopes: ["ads_read", "ads_management", "pages_show_list"], expires_at: 1_790_154_955 } });
    }
    if (url.pathname.endsWith("/me/adaccounts")) {
      if (!url.searchParams.get("after")) {
        return json({ data: [{ id: "act_1234563907", name: "Hesap A", currency: "TRY", timezone_name: "Europe/Istanbul", account_status: 1 }], paging: { cursors: { after: "cursor-2" } } });
      }
      return json({ data: [{ id: "act_9876541362", name: "Hesap B", currency: "TRY", timezone_name: "Europe/Istanbul", account_status: 1 }] });
    }
    if (url.pathname.endsWith("/me/accounts")) {
      return json({ data: [
        { id: "378763705643314", name: "Doruk Hastaneleri", category: "Hastane", followers_count: 10_416, instagram_business_account: { id: "1784000000005513", username: "dorukhastaneleri", name: "Doruk Sağlık Grubu" } },
        { id: "111564900298929", name: "Doruk Hospital", category: "Hastane", followers_count: 4_129 },
      ] });
    }

    const account = url.pathname.includes("1234563907") ? "a" : "b";
    if (url.pathname.endsWith("/campaigns")) {
      return json({ data: account === "a" ? [{ id: "cmp_12345678", name: "Instagram gönderisi: örnek", effective_status: "ACTIVE", objective: "LINK_CLICKS" }] : [], summary: { total_count: account === "a" ? 52 : 0 } });
    }
    if (url.pathname.endsWith("/adsets")) return json({ data: [], summary: { total_count: account === "a" ? 80 : 0 } });
    if (url.pathname.endsWith("/ads")) {
      return json({ data: account === "a" ? [{ id: "ad_12345678", name: "Mevcut gönderi", effective_status: "ACTIVE", creative: { body: "Yayındaki reklam metni", instagram_permalink_url: "https://www.instagram.com/p/example/" } }] : [], summary: { total_count: account === "a" ? 120 : 0 } });
    }
    if (url.pathname.endsWith("/insights")) return json({ data: [{ date_start: "2026-08-01", date_stop: "2026-08-07" }] });
    return json({ error: { message: "unexpected" } }, 404);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Meta read-only inventory", () => {
  it("paginates discovery, masks identifiers and keeps granted write scopes disabled", async () => {
    const snapshot = await discoverMetaInventory({
      token,
      fetchImpl: inventoryFetch(),
      securityStatus: "temporary_exposed",
      now: () => new Date("2026-08-07T09:00:00.000Z"),
    });

    expect(snapshot.summary).toMatchObject({ adAccounts: 2, pages: 2, linkedInstagramAccounts: 1, campaigns: 52, adSets: 80, ads: 120, accountsWithCampaigns: 1 });
    expect(snapshot.accounts[0]).toMatchObject({ id: "act_…3907", name: "Hesap A", campaignCount: 52 });
    expect(snapshot.pages[0]?.instagram).toMatchObject({ id: "1784…5513", username: "dorukhastaneleri" });
    expect(snapshot.connection.expiresAt).toBe("2026-09-23T09:15:55.000Z");
    expect(snapshot.audit).toMatchObject({ action: "connection.inventory_refreshed", writeOperations: 0 });
    expect(snapshot.capabilities.find((item) => item.id === "ads.write")).toMatchObject({ granted: true, verified: false, enabled: false });
    expect(JSON.stringify(snapshot)).not.toContain(token);
    expect(JSON.stringify(snapshot)).not.toContain("1234563907");
    expect(JSON.stringify(snapshot)).not.toContain("1784000000005513");
  });

  it("retries a rate limit without leaking authorization material", async () => {
    let calls = 0;
    const fetchImpl: MetaFetch = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? json({ error: {} }, 429, { "retry-after": "0" }) : json({ data: [] });
    });
    const client = new MetaGraphClient(token, fetchImpl);
    await expect(client.get("/me")).resolves.toEqual({ data: [] });
    expect(calls).toBe(2);
  });

  it("bounds a response body that never completes", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl: MetaFetch = vi.fn(async (_input, init) => {
      signal = init?.signal ?? undefined;
      return ({
      ok: true,
      headers: new Headers(),
      json: async () => new Promise<never>(() => undefined),
      }) as unknown as Response;
    });
    const client = new MetaGraphClient(token, fetchImpl, { requestTimeoutMs: 1_000 });
    await expect(client.get("/me")).rejects.toMatchObject({ code: "invalid_data", retryable: false });
    expect(signal?.aborted).toBe(true);
  }, 2_000);

  it("fails closed for an invalid token", async () => {
    const fetchImpl: MetaFetch = vi.fn(async () => json({ data: { is_valid: false } }));
    await expect(discoverMetaInventory({ token, fetchImpl })).rejects.toMatchObject({ code: "authentication" });
  });

  it("keeps the public route fail-closed without a network call even when a server token exists", async () => {
    const previous = process.env.META_ACCESS_TOKEN;
    const previousStatus = process.env.META_TOKEN_SECURITY_STATUS;
    process.env.META_ACCESS_TOKEN = token;
    process.env.META_TOKEN_SECURITY_STATUS = "temporary_exposed";
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network must remain unreachable"));
    try {
      const response = await getMetaInventory();
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).toContain("mevcut token güvenlik incelemesinde");
      expect(body).toContain("normal salt-okunur sync");
      expect(body).not.toContain(token);
      expect(JSON.parse(body)).toMatchObject({ source: { kind: "graph_capability", state: "unavailable",
        reasonCodes: ["graph_capability_not_configured"] }, error: { code: "not_configured" } });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(network).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = previous;
      if (previousStatus === undefined) delete process.env.META_TOKEN_SECURITY_STATUS;
      else process.env.META_TOKEN_SECURITY_STATUS = previousStatus;
    }
  });

  it("masks both account and generic Meta identifiers", () => {
    expect(maskMetaId("act_1234563907")).toBe("act_…3907");
    expect(maskMetaId("1784000000005513")).toBe("1784…5513");
  });
});
