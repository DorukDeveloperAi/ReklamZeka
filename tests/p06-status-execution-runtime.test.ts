import { describe, expect, it, vi } from "vitest";

import { createP06StatusExecutionRuntime } from "@/server/p06-status-execution-runtime";

describe("P06 status execution server runtime", () => {
  it("is default-off and never falls back to the generic Meta read token", () => {
    const runtime = createP06StatusExecutionRuntime({
      database: { execute: vi.fn(), transaction: vi.fn() } as never,
      environment: { META_ACCESS_TOKEN: "read-token" },
    });
    expect(runtime).toEqual({
      enabled: false,
      worker: null,
      scheduler: null,
      materializeApproved: null,
    });
  });

  it("requires a dedicated write credential and explicit enable before exposing a server worker", () => {
    const runtime = createP06StatusExecutionRuntime({
      database: { execute: vi.fn(), transaction: vi.fn() } as never,
      environment: {
        P06_META_STATUS_WRITE_ENABLED: "true",
        P06_META_WRITE_ACCESS_TOKEN: "write-token",
        P06_META_WRITE_KILL_SWITCH: "false",
        P06_META_WRITE_WORKSPACE_ALLOWLIST: "workspace_aaaaaaaaaaaaaaaa",
        P06_META_WRITE_ACCOUNT_ALLOWLIST: "act_12345",
        P06_META_WRITE_ACTION_ALLOWLIST: "status_pause",
      },
    });
    expect(runtime.enabled).toBe(true);
    expect(runtime.worker).not.toBeNull();
    expect(runtime.scheduler).not.toBeNull();
    expect(runtime.materializeApproved).toBeTypeOf("function");
    expect(JSON.stringify(runtime)).not.toContain("write-token");
  });
});
