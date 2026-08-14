/**
 * This package deliberately has no enable transport. A later, separately
 * approved server-only package may replace this closed adapter.
 */
export const ACTION_PREPARATION_FLAG = Object.freeze({
  key: "action_preparation" as const,
  visible: true as const,
  enabled: false as const,
  reason: "server_disabled" as const,
  source: "server_owned_static" as const,
  revision: "action-preparation/1.0.0" as const,
});

/** Public projection intentionally omits the private config source/revision. */
export const publicActionPreparationFlag = () => Object.freeze({
  visible: ACTION_PREPARATION_FLAG.visible,
  enabled: ACTION_PREPARATION_FLAG.enabled,
  reason: ACTION_PREPARATION_FLAG.reason,
});
