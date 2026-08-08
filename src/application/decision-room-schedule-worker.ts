import type { DecisionRoomDueSchedule } from "@/connectors/decisions/decision-room-drizzle-adapters";
import type { DecisionRoomExecutionResult } from "@/domain/decisions/executor";
import {
  decisionRoomScheduleDefinitionHash,
  planDecisionRoomScheduleTick,
  scheduledDecisionRoomRequest,
} from "@/domain/decisions/schedule";

export const DECISION_ROOM_SCHEDULE_WORKER_VERSION = "decision-room-schedule-worker/1.0.0" as const;

export type DecisionRoomScheduleWorkerRegistry = Readonly<{
  listDue(now: string, limit: number): Promise<readonly DecisionRoomDueSchedule[]>;
  recordTick(input: Readonly<{
    scheduleRef: string;
    revision: number;
    definitionHash: string;
    scheduledFor: string;
    nextRunAt: string | null;
  }>): Promise<boolean>;
}>;

export type DecisionRoomScheduleWorkerExecutor = Readonly<{
  execute(input: Parameters<import("@/domain/decisions/executor").DecisionRoomExecutor["execute"]>[0]):
    Promise<DecisionRoomExecutionResult>;
}>;

export type DecisionRoomScheduleWorkerItem = Readonly<{
  scheduleRef: string;
  revision: number;
  definitionHash: string;
  outcome:
    | DecisionRoomExecutionResult["status"]
    | "stale_skipped"
    | "definition_mismatch"
    | "tick_conflict"
    | "isolated_error";
  runRef: string | null;
  scheduledFor: string | null;
  tickAdvanced: boolean;
}>;

export type DecisionRoomScheduleWorkerResult = Readonly<{
  version: typeof DECISION_ROOM_SCHEDULE_WORKER_VERSION;
  now: string;
  batchSize: number;
  dueCount: number;
  tickAdvancedCount: number;
  items: readonly DecisionRoomScheduleWorkerItem[];
  actionAuthority: "none";
  notificationChannel: "in_app_inbox";
}>;

export class DecisionRoomScheduleWorkerError extends Error {
  constructor(readonly code: "invalid_input" | "registry_failure") {
    super(`Decision Room schedule worker güvenli biçimde çalıştırılamadı: ${code}`);
    this.name = "DecisionRoomScheduleWorkerError";
  }
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DecisionRoomScheduleWorkerError("invalid_input");
  }
  return new Date(value).toISOString();
}

function batch(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new DecisionRoomScheduleWorkerError("invalid_input");
  }
  return value as number;
}

function item(
  due: DecisionRoomDueSchedule,
  outcome: DecisionRoomScheduleWorkerItem["outcome"],
  runRef: string | null,
  scheduledFor: string | null,
  tickAdvanced: boolean,
): DecisionRoomScheduleWorkerItem {
  return Object.freeze({
    scheduleRef: due.schedule.scheduleRef,
    revision: due.revision,
    definitionHash: due.definitionHash,
    outcome,
    runRef,
    scheduledFor,
    tickAdvanced,
  });
}

/**
 * Bounded, partial-failure-isolated worker tick. It cannot authorize or execute
 * advertising writes; the only notification path remains the executor inbox.
 */
export async function runDecisionRoomScheduleWorker(
  input: Readonly<{ now: string; batchSize?: number }>,
  registry: DecisionRoomScheduleWorkerRegistry,
  executor: DecisionRoomScheduleWorkerExecutor,
): Promise<DecisionRoomScheduleWorkerResult> {
  if (!input || Object.keys(input).some((key) => !["now", "batchSize"].includes(key))) {
    throw new DecisionRoomScheduleWorkerError("invalid_input");
  }
  const now = instant(input.now);
  const batchSize = batch(input.batchSize ?? 25);
  let due: readonly DecisionRoomDueSchedule[];
  try {
    due = await registry.listDue(now, batchSize);
  } catch {
    throw new DecisionRoomScheduleWorkerError("registry_failure");
  }
  if (!Array.isArray(due) || due.length > batchSize) {
    throw new DecisionRoomScheduleWorkerError("registry_failure");
  }

  const items: DecisionRoomScheduleWorkerItem[] = [];
  for (const candidate of due) {
    try {
      if (decisionRoomScheduleDefinitionHash(candidate.schedule) !== candidate.definitionHash) {
        items.push(item(candidate, "definition_mismatch", null, null, false));
        continue;
      }
      const planningLast = candidate.lastScheduledFor
        ?? new Date(Date.parse(candidate.nextRunAt) - 1).toISOString();
      const plan = planDecisionRoomScheduleTick({
        schedule: candidate.schedule,
        now,
        lastScheduledFor: planningLast,
      });
      const scheduledFor = plan.dueSlots[0] ?? null;
      if (scheduledFor === null) {
        // A deterministic skip is the only non-execution path allowed to move
        // the cursor; it prevents a stale skip-policy row from remaining due.
        const advanced = await registry.recordTick({
          scheduleRef: candidate.schedule.scheduleRef,
          revision: candidate.revision,
          definitionHash: candidate.definitionHash,
          scheduledFor: candidate.nextRunAt,
          nextRunAt: plan.nextRunAt,
        });
        items.push(item(candidate, advanced ? "stale_skipped" : "tick_conflict", null, candidate.nextRunAt, advanced));
        continue;
      }
      const request = scheduledDecisionRoomRequest({ schedule: candidate.schedule, scheduledFor, requestedAt: now });
      if (request.trigger.kind !== "scheduled"
        || request.trigger.scheduleDefinitionHash !== candidate.definitionHash) {
        items.push(item(candidate, "definition_mismatch", null, scheduledFor, false));
        continue;
      }
      const result = await executor.execute(request);
      if (result.status !== "completed" && result.status !== "duplicate_completed") {
        items.push(item(candidate, result.status, result.runRef, scheduledFor, false));
        continue;
      }
      const advanced = await registry.recordTick({
        scheduleRef: candidate.schedule.scheduleRef,
        revision: candidate.revision,
        definitionHash: candidate.definitionHash,
        scheduledFor,
        nextRunAt: plan.nextRunAt,
      });
      items.push(item(candidate, advanced ? result.status : "tick_conflict", result.runRef, scheduledFor, advanced));
    } catch {
      items.push(item(candidate, "isolated_error", null, null, false));
    }
  }

  return Object.freeze({
    version: DECISION_ROOM_SCHEDULE_WORKER_VERSION,
    now,
    batchSize,
    dueCount: due.length,
    tickAdvancedCount: items.filter((entry) => entry.tickAdvanced).length,
    items: Object.freeze(items),
    actionAuthority: "none",
    notificationChannel: "in_app_inbox",
  });
}
