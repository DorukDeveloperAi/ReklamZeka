import { describe, expect, it } from "vitest";
import { createLocalGuidanceStudioHandlers } from "@/server/local-guidance-studio-runtime";

const config = Object.freeze({ origin: "http://localhost:3000",
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_test",
  userId: "22222222-2222-4222-8222-222222222222", readerRef: "reader_test",
  signingKey: Buffer.alloc(32, 7) });

describe("local Guidance Studio runtime", () => {
  it("distinguishes a missing dashboard capability from an unavailable data source", async () => {
    const handlers = createLocalGuidanceStudioHandlers({ database: {} as never, config });
    const response = await handlers.GET(new Request("http://localhost:3000/api/guidance-studio", { headers: {
      host: "localhost:3000", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "guidance-studio-read",
    } }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "local_session_required" },
      authority: { canWriteMeta: false, canAuthorizeAction: false, canEnforcePolicy: false } });
  });

  it("treats an expired or malformed dashboard capability as a new-session requirement", async () => {
    const handlers = createLocalGuidanceStudioHandlers({ database: {} as never, config });
    const response = await handlers.GET(new Request("http://localhost:3000/api/guidance-studio", { headers: {
      host: "localhost:3000", cookie: "__Host-rzka_local_session=invalid", "sec-fetch-site": "same-origin",
      "x-reklamzeka-intent": "guidance-studio-read",
    } }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "local_session_required" } });
  });
});
