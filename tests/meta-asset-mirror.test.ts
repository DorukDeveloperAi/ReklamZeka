import { describe, expect, it, vi } from "vitest";
import { discoverMetaAssetMirror } from "@/connectors/meta/asset-mirror";
import type { MetaFetch } from "@/connectors/meta/graph-client";
import {
  MetaAssetMirrorValidationError,
  normalizeMetaAssetMirror,
  redactMetaAssetMirror,
  type MetaAssetMirrorSnapshotInput,
} from "@/domain/meta/asset-mirror";

const token = "fixture-sensitive-asset-token";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function assetFetch(): MetaFetch {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);

    if (url.pathname.endsWith("/me/adaccounts")) {
      return json({ data: [{ id: "act_1234567890", name: "Hesap", business: { id: "biz_1234567890", name: "Business" } }] });
    }
    if (url.pathname.endsWith("/me/accounts")) {
      return json({ data: [{
        id: "page_1234567890",
        name: "Doruk Hastaneleri",
        tasks: ["ANALYZE", "ADVERTISE"],
        instagram_business_account: {
          id: "ig_1234567890",
          username: "dorukhastaneleri",
          name: "Doruk Sağlık Grubu",
        },
      }] });
    }
    if (url.pathname.endsWith("/act_1234567890/adspixels")) {
      return json({ data: [{ id: "pixel_1234567890", name: "Main Pixel" }] });
    }
    if (url.pathname.endsWith("/biz_1234567890/owned_pixels")) {
      return json({ data: [{ id: "pixel_1234567890", name: "Main Pixel" }] });
    }
    if (url.pathname.endsWith("/biz_1234567890/owned_datasets")) {
      return json({ error: { message: "Unsupported get request" } }, 400);
    }
    if (url.pathname.endsWith("/biz_1234567890/owned_apps")) {
      return json({ data: [{ id: "app_1234567890", app_name: "Doruk App" }] });
    }
    if (url.pathname.endsWith("/biz_1234567890/owned_whatsapp_business_accounts")) {
      return json({ error: { message: "Permission denied" } }, 403);
    }
    return json({ error: { message: "Unexpected edge" } }, 404);
  });
}

describe("Meta asset mirror discovery", () => {
  it("normalizes ownership, capability and partial edge failures without a write call", async () => {
    const fetchImpl = assetFetch();
    const snapshot = await discoverMetaAssetMirror({
      token,
      workspaceId: "workspace-1",
      connectionExternalKey: "connection-1",
      fetchImpl,
      now: () => new Date("2026-08-07T10:00:00.000Z"),
    });

    expect(snapshot.writeOperations).toBe(0);
    expect(snapshot.assets.map((asset) => asset.assetType)).toEqual([
      "app",
      "facebook_page",
      "instagram_account",
      "pixel",
    ]);
    expect(snapshot.assets.find((asset) => asset.assetType === "pixel")).toMatchObject({
      ownership: { kind: "owned", ownerBusinessExternalId: "biz_1234567890" },
      capabilities: [
        { operation: "measure", status: "verified" },
        { operation: "read", status: "verified" },
      ],
    });
    expect(snapshot.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationship: "has_access_to_page" }),
      expect.objectContaining({ relationship: "page_links_instagram" }),
      expect.objectContaining({ relationship: "uses_pixel" }),
      expect.objectContaining({ relationship: "owns_pixel" }),
      expect.objectContaining({ relationship: "owns_app" }),
    ]));
    expect(snapshot.discoveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: "datasets", status: "unsupported", itemCount: 0 }),
      expect.objectContaining({ resource: "whatsapp_business_accounts", status: "permission_missing", itemCount: 0 }),
    ]));
    expect(snapshot.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchImpl).toHaveBeenCalled();
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.every((call) => call[1]?.method === "GET")).toBe(true);
  });

  it("produces a UI/agent-safe projection with every technical ID masked", async () => {
    const snapshot = await discoverMetaAssetMirror({
      token,
      workspaceId: "workspace-1",
      connectionExternalKey: "connection-1",
      fetchImpl: assetFetch(),
      now: () => new Date("2026-08-07T10:00:00.000Z"),
    });

    const publicSnapshot = redactMetaAssetMirror(snapshot);
    const serialized = JSON.stringify(publicSnapshot);
    expect(publicSnapshot.accountIds).toEqual(["act_…7890"]);
    expect(publicSnapshot.assetRows.find((asset) => asset.type === "instagram_account")).toMatchObject({
      id: "ig_1…7890",
      username: "dorukhastaneleri",
    });
    for (const sensitive of [
      token,
      "act_1234567890",
      "biz_1234567890",
      "page_1234567890",
      "ig_1234567890",
      "pixel_1234567890",
      "app_1234567890",
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
    expect(serialized).not.toContain("rawPayloadHash");
    expect(serialized).not.toContain("connection-1");
    expect(publicSnapshot.edgeRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "connection", sourceId: "[connection]", relationship: "has_access_to_page" }),
    ]));
  });

  it("fails closed when an edge points to a missing parent asset", () => {
    const trace = {
      sourceEdge: "/fixture",
      fetchedAt: "2026-08-07T10:00:00.000Z",
      sourceGraphVersion: "v23.0",
      fieldCatalogVersion: "fixture-v1",
      rawPayloadHash: "a".repeat(64),
    };
    const input: MetaAssetMirrorSnapshotInput = {
      schemaVersion: 1,
      workspaceId: "workspace-1",
      connectionExternalKey: "connection-1",
      adAccountExternalIds: ["act_1"],
      assets: [{
        externalAssetId: "page_1",
        assetType: "facebook_page",
        displayName: "Page",
        username: null,
        ownership: { kind: "accessible", ownerBusinessExternalId: null, evidence: "/me/accounts" },
        capabilities: [{ operation: "read", status: "verified", reason: null }],
        orphanReason: null,
        provenance: trace,
      }],
      edges: [{
        sourceType: "asset",
        sourceExternalId: "missing_page",
        targetExternalAssetId: "page_1",
        relationship: "page_links_instagram",
        provenance: trace,
      }],
      discoveries: [],
      fetchedAt: "2026-08-07T10:00:00.000Z",
      writeOperations: 0,
    };

    expect(() => normalizeMetaAssetMirror(input)).toThrowError(
      expect.objectContaining<Partial<MetaAssetMirrorValidationError>>({ code: "orphan_edge" }),
    );
  });
});
