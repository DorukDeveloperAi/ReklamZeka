import { describe, expect, it, vi } from "vitest";
import { createLocalCampaignContextListRouteHandler } from "@/server/local-campaign-context-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";

const config = localDecisionRoomConfig({
  DATABASE_URL: "postgresql://server-only.invalid/database",
  REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
  REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
  REKLAMZEKA_LOCAL_WORKSPACE_ID: "11111111-1111-4111-a111-111111111111",
  REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
  REKLAMZEKA_LOCAL_USER_ID: "22222222-2222-4222-a222-222222222222",
  REKLAMZEKA_LOCAL_READER_REF: "reader_local_owner",
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: Buffer.alloc(32, 5).toString("base64"),
})!;

describe("local campaign-context runtime", () => {
  it("identifies a missing local cookie as a session requirement before reading the database", async () => {
    const database = { execute: vi.fn(), select: vi.fn() };
    const response = await createLocalCampaignContextListRouteHandler({ database: database as never, config })(new Request("http://localhost:3000/api/campaign-contexts", {
      headers: { Host: "localhost:3000", "Sec-Fetch-Site": "same-origin" },
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "local_session_required", message: "Kampanya bağlamı için yerel dashboard oturumunu bağlayın." } });
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(database.execute).not.toHaveBeenCalled();
  });
});
