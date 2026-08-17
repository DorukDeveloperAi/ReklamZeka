import { GuideRunOrchestrationService, type GuideRunDailyAgentPort, type GuideRunFrozenScopePort, type GuideRunHolisticAgentPort, type GuideRunTrustedDataHealthPort } from "@/application/guide-run-orchestration-service";
import { DrizzleGuideRunRepository } from "@/connectors/guides/guide-run-drizzle-repository";
import { DrizzleGuideRunP01LedgerProjector } from "@/connectors/guides/guide-run-p01-ledger-projector";
import { planScheduledGuideRuns } from "@/domain/guides/guide-run-scheduler";
import type { GuideRevision } from "@/domain/guides/guide-revision";
import * as schema from "@/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type Database = NodePgDatabase<typeof schema>;

/** Trusted, server-side schedule state only; never construct this from HTTP input. */
export type ActiveGuideSchedule = Readonly<{
  workspaceId: string;
  guideRevisionId: string;
  guide: GuideRevision;
  activatedAt: string;
  lastScheduledFor: string | null;
}>;
export interface GuideRunActiveSchedulePort {
  listActiveSchedules(input: Readonly<{ now: string }>): Promise<readonly ActiveGuideSchedule[]>;
}

/** Composition-only server boundary: its ports have no approval, execution, guide-edit, or Meta-write capability. */
export function createGuideRunWorker(input: Readonly<{
  database: Pick<Database, "execute" | "transaction">;
  frozenScopes: GuideRunFrozenScopePort;
  dailyAnalysis: GuideRunDailyAgentPort;
  holisticAnalysis: GuideRunHolisticAgentPort;
  dataHealth: GuideRunTrustedDataHealthPort;
}>) {
  const persistence = new DrizzleGuideRunRepository(input.database);
  const service = new GuideRunOrchestrationService(persistence, input.frozenScopes, input.dailyAnalysis, input.holisticAnalysis, input.dataHealth, persistence);
  return Object.freeze({ service, persistence, ledger: new DrizzleGuideRunP01LedgerProjector(input.database) });
}

/**
 * Narrow scheduler-to-worker transport. A schedule fire is first recorded as
 * an immutable receipt, then materialized by the same idempotency key, fenced,
 * and resumed from immutable artifacts. It owns neither Meta nor approvals.
 */
export class GuideRunSchedulerWorker {
  constructor(private readonly worker: ReturnType<typeof createGuideRunWorker>, private readonly schedules: GuideRunActiveSchedulePort) {}
  async tick(input: Readonly<{ now: string; leaseToken: string; leaseUntil: string }>) {
    const outputs: Array<Readonly<{ runRef: string; state: string }>> = [];
    for (const entry of await this.schedules.listActiveSchedules({ now: input.now })) {
      const plan = planScheduledGuideRuns({ guide: { guideRef: entry.guide.guideRef, revisionHash: entry.guide.revisionHash, schedule: entry.guide.schedule, active: true }, head: { activatedAt: entry.activatedAt, lastScheduledFor: entry.lastScheduledFor }, now: input.now });
      if (plan.missed) await this.worker.persistence.recordScheduleReceipt({ workspaceId: entry.workspaceId, guideRevisionId: entry.guideRevisionId, scheduledFor: plan.missed.lastScheduledFor, missedFrom: plan.missed.firstScheduledFor, missedTo: plan.missed.lastScheduledFor, missedCount: plan.missed.count, runRef: null, createdAt: input.now });
      if (!plan.claim) continue;
      const due = await this.worker.service.fire({ guide: entry.guide, trigger: { kind: "scheduled", scheduledFor: plan.claim.scheduledFor }, occurredAt: input.now });
      await this.worker.persistence.recordScheduleReceipt({ workspaceId: entry.workspaceId, guideRevisionId: entry.guideRevisionId, scheduledFor: plan.claim.scheduledFor, missedFrom: null, missedTo: null, missedCount: 0, runRef: due.runRef, createdAt: input.now });
      const claimed = due.state === "due" ? await this.worker.service.claim(due, { leaseToken: input.leaseToken, leaseUntil: input.leaseUntil, occurredAt: input.now }) : due;
      const complete = await this.worker.service.execute({ run: claimed, guide: entry.guide, leaseToken: input.leaseToken, occurredAt: input.now });
      // The projector itself reads/decodes immutable records and is a no-op for
      // runs without finding artifacts; callers never provide agent payloads.
      await this.worker.ledger.projectPersisted({ workspaceId: entry.workspaceId, runRef: complete.run.runRef });
      outputs.push(Object.freeze({ runRef: complete.run.runRef, state: complete.run.state }));
    }
    return Object.freeze(outputs);
  }
}
