export type P08RolloutEnvironment = Readonly<Record<string, string | undefined>>;

export type P08RolloutControl = Readonly<{
  version: "p08-rollout-control/1.0.0";
  metaReadEnabled: boolean;
  guideSchedulerEnabled: boolean;
  humanActionExecutionEnabled: boolean;
  limitedAutonomyEnabled: boolean;
  metaWriteEnabled: boolean;
}>;

const enabled = (value: string | undefined) => value === "true";

/**
 * One server-owned, default-off rollout authority. Product-stage flags never
 * grant a write independently: every human or limited-autonomy route also
 * requires the global Meta write boundary. Limited autonomy additionally
 * requires the read and Guide scheduler stages that produce its evidence.
 */
export function resolveP08RolloutControl(
  environment: P08RolloutEnvironment = process.env,
): P08RolloutControl {
  const metaReadEnabled = enabled(environment.META_READ_ENABLED);
  const metaWriteEnabled = enabled(environment.META_WRITE_ENABLED);
  const guideSchedulerEnabled =
    metaReadEnabled && enabled(environment.GUIDE_SCHEDULER_ENABLED);
  const humanActionExecutionEnabled =
    metaWriteEnabled && enabled(environment.HUMAN_ACTION_EXECUTION_ENABLED);
  const limitedAutonomyEnabled =
    metaWriteEnabled &&
    metaReadEnabled &&
    guideSchedulerEnabled &&
    enabled(environment.LIMITED_AUTONOMY_ENABLED);
  return Object.freeze({
    version: "p08-rollout-control/1.0.0",
    metaReadEnabled,
    guideSchedulerEnabled,
    humanActionExecutionEnabled,
    limitedAutonomyEnabled,
    metaWriteEnabled,
  });
}
