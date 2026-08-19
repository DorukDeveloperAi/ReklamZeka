import { describe, expect, it } from "vitest";

import { bootstrapMetaReadMirror } from "@/server/meta-read-bootstrap";
import { resolveP08RolloutControl } from "@/server/p08-rollout-control";

describe("P08 canonical rollout control", () => {
  it("is wholly default-off and accepts only exact true values", () => {
    expect(resolveP08RolloutControl({})).toEqual({
      version: "p08-rollout-control/1.0.0",
      metaReadEnabled: false,
      guideSchedulerEnabled: false,
      humanActionExecutionEnabled: false,
      limitedAutonomyEnabled: false,
      metaWriteEnabled: false,
    });
    expect(resolveP08RolloutControl({
      META_READ_ENABLED: "TRUE",
      META_WRITE_ENABLED: "1",
      HUMAN_ACTION_EXECUTION_ENABLED: "yes",
    }).metaWriteEnabled).toBe(false);
  });

  it("enforces rollout dependencies and never lets a child flag grant authority", () => {
    const isolated = resolveP08RolloutControl({
      GUIDE_SCHEDULER_ENABLED: "true",
      HUMAN_ACTION_EXECUTION_ENABLED: "true",
      LIMITED_AUTONOMY_ENABLED: "true",
    });
    expect(isolated).toMatchObject({
      guideSchedulerEnabled: false,
      humanActionExecutionEnabled: false,
      limitedAutonomyEnabled: false,
    });
    const human = resolveP08RolloutControl({
      META_WRITE_ENABLED: "true",
      HUMAN_ACTION_EXECUTION_ENABLED: "true",
    });
    expect(human.humanActionExecutionEnabled).toBe(true);
    expect(human.limitedAutonomyEnabled).toBe(false);
    const limited = resolveP08RolloutControl({
      META_READ_ENABLED: "true",
      GUIDE_SCHEDULER_ENABLED: "true",
      META_WRITE_ENABLED: "true",
      LIMITED_AUTONOMY_ENABLED: "true",
    });
    expect(limited.guideSchedulerEnabled).toBe(true);
    expect(limited.limitedAutonomyEnabled).toBe(true);
  });

  it("blocks Meta bootstrap before any repository or network access", async () => {
    await expect(bootstrapMetaReadMirror({
      database: {} as never,
      workspaceId: "00000000-0000-4000-8000-000000000001",
      actorId: "00000000-0000-4000-8000-000000000002",
      connectionId: "00000000-0000-4000-8000-000000000003",
      environment: {},
    })).rejects.toMatchObject({ code: "connection_unavailable" });
  });
});
