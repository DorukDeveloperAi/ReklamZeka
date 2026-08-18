import { describe, expect, it } from "vitest";
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
});
