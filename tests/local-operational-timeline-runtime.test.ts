import { describe, expect, it, vi } from "vitest";

import { createLocalOperationalTimelineHandler } from "@/server/local-operational-timeline-runtime";
import { localDecisionRoomConfig, type LocalDecisionRoomEnvironment } from "@/server/local-decision-room-runtime";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";

function environment(): LocalDecisionRoomEnvironment {
  return {
    DATABASE_URL: "postgresql://server-only.invalid/database",
    REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
    REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
    REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
    REKLAMZEKA_LOCAL_USER_ID: userId,
    REKLAMZEKA_LOCAL_READER_REF: "reader_local",
    REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: Buffer.alloc(32, 7).toString("base64"),
  };
}

function request() {
  return new Request("http://localhost:3000/api/operational-timeline", {
    headers: {
      Host: "localhost:3000",
      "Sec-Fetch-Site": "same-origin",
    },
  });
}

describe("local operational timeline runtime", () => {
  it("returns a contextual 401 before database access when the dashboard session is missing", async () => {
    const database = { execute: vi.fn() };
    const handler = createLocalOperationalTimelineHandler({
      database: database as never,
      config: localDecisionRoomConfig(environment())!,
    });

    const response = await handler(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "local_session_required",
        message: "Operasyon izi için yerel dashboard oturumunu bağlayın.",
      },
    });
    expect(database.execute).not.toHaveBeenCalled();
  });
});
