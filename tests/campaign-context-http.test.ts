import { describe, expect, it } from "vitest";
import { CampaignContextReadService } from "@/application/campaign-context-read-service";
import { createCampaignContextHttpHandler, createCampaignContextListHttpHandler } from "@/server/campaign-context-http";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const campaignRef = "ref_fc75620250e2";

describe("campaign context HTTP", () => {
  it("rejects unknown parameters and never returns a write authority header", async () => {
    const service = new CampaignContextReadService({ loadLatestValidCampaignPublic: async () => null, listLatestValidCampaignPublic: async () => [] });
    const handler = createCampaignContextHttpHandler({ service, workspaceId: async () => workspaceId });
    const invalid = await handler(new Request(`http://local/campaign-context?campaignRef=${campaignRef}&raw=1`));
    expect(invalid.status).toBe(400);
    const ready = await handler(new Request(`http://local/campaign-context?campaignRef=${campaignRef}`));
    expect(ready.status).toBe(200);
    expect(ready.headers.get("X-ReklamZeka-Action-Authority")).toBe("none");
    await expect(ready.json()).resolves.toMatchObject({ view: "empty", campaignRef, writeOperations: 0 });
  });

  it("serves a session-bound list with no query surface or action authority", async () => {
    const service = new CampaignContextReadService({ loadLatestValidCampaignPublic: async () => null, listLatestValidCampaignPublic: async () => [] });
    const handler = createCampaignContextListHttpHandler({ service, workspaceId: async () => workspaceId });
    expect((await handler(new Request("http://local/campaign-contexts?raw=1"))).status).toBe(400);
    const ready = await handler(new Request("http://local/campaign-contexts"));
    expect(ready.headers.get("X-ReklamZeka-Action-Authority")).toBe("none");
    await expect(ready.json()).resolves.toEqual({ contractVersion: "campaign-context-list-read-model/1.0.0", view: "list", items: [], writeOperations: 0 });
  });
});
