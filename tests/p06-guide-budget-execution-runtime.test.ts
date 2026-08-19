import { describe, expect, it, vi } from "vitest";
import { createP06GuideBudgetExecutionRuntime } from "@/server/p06-guide-budget-execution-runtime";

describe("P06 Guide budget execution runtime", () => {
  it("is default-off without the separate budget flag and credential", () => {
    const runtime = createP06GuideBudgetExecutionRuntime({ database: {} as never, environment: {} });
    expect(runtime).toEqual({ enabled: false, worker: null, scheduler: null });
  });

  it("does not reuse the status enable flag", () => {
    const runtime = createP06GuideBudgetExecutionRuntime({ database: {} as never,
      environment: { P06_META_STATUS_WRITE_ENABLED: "true", P06_META_WRITE_ACCESS_TOKEN: "secret" } });
    expect(runtime.enabled).toBe(false);
  });

  it("requires both the global Meta-write and human-execution rollout gates", () => {
    const base = {
      P06_META_BUDGET_WRITE_ENABLED: "true",
      P06_META_WRITE_ACCESS_TOKEN: "secret",
    };
    expect(createP06GuideBudgetExecutionRuntime({ database: {} as never,
      environment: { ...base, HUMAN_ACTION_EXECUTION_ENABLED: "true" } }).enabled).toBe(false);
    expect(createP06GuideBudgetExecutionRuntime({ database: {} as never,
      environment: { ...base, META_WRITE_ENABLED: "true", HUMAN_ACTION_EXECUTION_ENABLED: "true",
        P06_META_WRITE_KILL_SWITCH: "false", P06_META_WRITE_WORKSPACE_ALLOWLIST: "workspace_aaaaaaaaaaaaaaaa",
        P06_META_WRITE_ACCOUNT_ALLOWLIST: "act_12345", P06_META_BUDGET_WRITE_ACTION_ALLOWLIST: "budget_decrease" } }).enabled).toBe(true);
  });

  it("does not materialize or schedule new budget runs after the live kill switch closes", async () => {
    const environment: Record<string, string> = {
      META_WRITE_ENABLED: "true", HUMAN_ACTION_EXECUTION_ENABLED: "true",
      P06_META_BUDGET_WRITE_ENABLED: "true", P06_META_WRITE_ACCESS_TOKEN: "secret",
      P06_META_WRITE_KILL_SWITCH: "false", P06_META_WRITE_WORKSPACE_ALLOWLIST: "workspace_aaaaaaaaaaaaaaaa",
      P06_META_WRITE_ACCOUNT_ALLOWLIST: "act_12345", P06_META_BUDGET_WRITE_ACTION_ALLOWLIST: "budget_decrease",
    };
    const execute = vi.fn();
    const runtime = createP06GuideBudgetExecutionRuntime({
      database: { execute, transaction: vi.fn() } as never,
      environment,
    });
    expect(runtime.enabled).toBe(true);
    environment.P06_META_WRITE_KILL_SWITCH = "true";
    await expect(runtime.scheduler!.tick()).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
