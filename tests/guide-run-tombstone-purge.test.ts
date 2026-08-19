import { describe, expect, it } from "vitest";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

describe("P05 guide-run tombstone purge order", () => {
  it("purges every P05 table child-first before Guide parents", () => {
    const entries = ["guide_run_schedule_receipts", "guide_run_artifacts", "guide_run_heads", "guide_run_events", "guide_runs", "guide_revisions", "guides"].map(name => WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf(name as never));
    expect(entries.every(index => index >= 0)).toBe(true);
    expect(entries).toEqual([...entries].sort((left, right) => left - right));
  });
  it("purges limited-autonomy quota evidence before its P05 run parent", () => {
    const admission = WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("p06_limited_autonomy_admissions" as never);
    const run = WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("guide_runs" as never);
    expect(admission).toBeGreaterThanOrEqual(0);
    expect(admission).toBeLessThan(run);
  });
});
