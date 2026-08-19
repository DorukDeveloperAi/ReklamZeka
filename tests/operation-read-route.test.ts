import { describe, expect, it, vi } from "vitest";
import {
  createOperationReadRouteHandler,
  localOperationEnvironment,
} from "@/app/api/operations/route";

const environment = {
  DATABASE_URL: "postgresql://server-only.invalid/database",
  REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
  REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
  REKLAMZEKA_LOCAL_WORKSPACE_ID: "11111111-1111-4111-a111-111111111111",
  REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
  REKLAMZEKA_LOCAL_USER_ID: "22222222-2222-4222-a222-222222222222",
  REKLAMZEKA_LOCAL_READER_REF: "reader_local_owner",
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: Buffer.alloc(32, 7).toString("base64"),
  UNRELATED_PROCESS_VALUE: "must-not-reach-local-boundary",
} as unknown as NodeJS.ProcessEnv;

describe("operations route assembly", () => {
  it("allows only the local-boundary environment contract despite unrelated process variables", async () => {
    const exactEnvironment = localOperationEnvironment(environment);
    expect(Object.keys(exactEnvironment)).toEqual([
      "DATABASE_URL", "REKLAMZEKA_LOCAL_SESSION_ENABLED", "REKLAMZEKA_LOCAL_ORIGIN",
      "REKLAMZEKA_LOCAL_WORKSPACE_ID", "REKLAMZEKA_LOCAL_WORKSPACE_REF", "REKLAMZEKA_LOCAL_USER_ID",
      "REKLAMZEKA_LOCAL_READER_REF", "REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY",
    ]);
    const database = { execute: vi.fn(), transaction: vi.fn() };
    const handler = createOperationReadRouteHandler({ environment: exactEnvironment, database: database as never });
    const response = await handler!(new Request("http://localhost:3000/api/operations", { headers: {
      Host: "localhost:3000", "Sec-Fetch-Site": "same-origin", "X-ReklamZeka-Intent": "operation-read",
    } }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "local_session_required" } });
    expect(database.execute).not.toHaveBeenCalled();
  });
});
