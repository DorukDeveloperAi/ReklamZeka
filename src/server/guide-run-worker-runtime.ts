import {
  GuideRunOrchestrationService,
  type GuideRunDailyAgentPort,
  type GuideRunFrozenScopePort,
  type GuideRunHolisticAgentPort,
  type GuideRunTrustedDataHealthPort,
} from "@/application/guide-run-orchestration-service";
import { DrizzleGuideRunRepository } from "@/connectors/guides/guide-run-drizzle-repository";
import { DrizzleGuideRunP01LedgerProjector } from "@/connectors/guides/guide-run-p01-ledger-projector";
import {
  DrizzleGuideRunActionBindingRepository,
  type GuideRunCandidateActionStagingPort,
} from "@/connectors/guides/guide-run-action-binding-drizzle-repository";
import { DrizzleGuideRunFrozenScopeRepository } from "@/connectors/guides/guide-run-frozen-scope-drizzle-repository";
import { DrizzleGuideLifecycleRepository } from "@/connectors/guides/guide-lifecycle-drizzle-repository";
import { DrizzleGuideRunCandidateStagingContextRepository } from "@/connectors/guides/guide-run-candidate-staging-context-drizzle-repository";
import { DrizzleGuideRunEffectiveOverlapRepository } from "@/connectors/guides/guide-run-effective-overlap-drizzle";
import { DrizzleOperationReadRepository } from "@/connectors/operations/operation-read-drizzle-repository";
import { DrizzleP06LimitedAutonomyAdmissionRepository } from "@/connectors/actions/p06-limited-autonomy-admission-drizzle-repository";
import { planScheduledGuideRuns } from "@/domain/guides/guide-run-scheduler";
import type { GuideRevision } from "@/domain/guides/guide-revision";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  resolveP08RolloutControl,
  type P08RolloutEnvironment,
} from "@/server/p08-rollout-control";
import { createLocalCodexGuideRunAgents } from "@/server/guide-run-codex-agent-adapter";
import { DrizzleGuideRunMemberMetricEvidenceRepository } from "@/connectors/guides/guide-run-member-metric-evidence-drizzle-repository";
import { DrizzleGuideRunStageableStatusCandidateRepository } from "@/connectors/guides/guide-run-stageable-status-candidate-drizzle-repository";

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
  listActiveSchedules(
    input: Readonly<{ now: string }>,
  ): Promise<readonly ActiveGuideSchedule[]>;
}
export interface GuideRunLimitedAutonomyAdmissionPort {
  reserve(
    input: Readonly<{ workspaceId: string; runRef: string }>,
  ): Promise<
    Readonly<{
      admissionId: string;
      admissionHash: string;
      quotaOrdinal: number;
      replay: boolean;
    }>
  >;
}

/** Production loader: only a non-tombstoned Guide whose exact revision is the
 * current active head in an active workspace can reach the scheduler. */
export class DrizzleGuideRunActiveSchedulePort implements GuideRunActiveSchedulePort {
  constructor(
    private readonly database: Pick<Database, "execute" | "transaction">,
  ) {}
  async listActiveSchedules(): Promise<readonly ActiveGuideSchedule[]> {
    const result = await this.database.execute(sql`
      select r.workspace_id::text workspace_id,r.id::text revision_id,r.guide_id::text guide_id,
        a.created_at::text activated_at,
        (select receipt.scheduled_for::text from guide_run_schedule_receipts receipt where receipt.workspace_id=r.workspace_id and receipt.guide_revision_id=r.id and receipt.scheduled_for>=a.created_at order by receipt.scheduled_for desc limit 1) last_scheduled_for
      from guide_revisions r join guide_heads h on h.workspace_id=r.workspace_id and h.guide_id=r.guide_id and h.current_active_revision_id=r.id
      join guides g on g.workspace_id=r.workspace_id and g.id=r.guide_id and g.tombstoned_at is null
      join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active'
      join lateral (select created_at from guide_activation_outbox activation where activation.workspace_id=r.workspace_id and activation.guide_id=r.guide_id and activation.guide_revision_id=r.id order by activation.created_at desc,activation.id desc limit 1) a on true
      order by r.workspace_id,r.id limit 1001`);
    const rows = result.rows as Array<Record<string, unknown>>;
    if (rows.length > 1000) throw new Error("guide schedule set exceeds bound");
    const lifecycle = new DrizzleGuideLifecycleRepository(this.database);
    return Object.freeze(
      await Promise.all(
        rows.map(async (row) => {
          if (
            typeof row.workspace_id !== "string" ||
            typeof row.guide_id !== "string" ||
            typeof row.revision_id !== "string" ||
            typeof row.activated_at !== "string"
          )
            throw new Error("guide schedule corrupt store");
          const guide = await lifecycle.loadCanonicalRevision({
            workspaceId: row.workspace_id,
            guideId: row.guide_id,
            revisionId: row.revision_id,
          });
          return Object.freeze({
            workspaceId: row.workspace_id,
            guideRevisionId: row.revision_id,
            guide,
            activatedAt: new Date(row.activated_at).toISOString(),
            lastScheduledFor:
              row.last_scheduled_for === null
                ? null
                : new Date(String(row.last_scheduled_for)).toISOString(),
          });
        }),
      ),
    );
  }
}

/** Composition-only server boundary: its ports have no approval, execution, guide-edit, or Meta-write capability. */
export function createGuideRunWorker(
  input: Readonly<{
    database: Pick<Database, "execute" | "transaction">;
    frozenScopes: GuideRunFrozenScopePort;
    dailyAnalysis: GuideRunDailyAgentPort;
    holisticAnalysis: GuideRunHolisticAgentPort;
    dataHealth: GuideRunTrustedDataHealthPort;
    /** Optional until the server installs the canonical P06 staging composition.
     * Its absence is fail-closed: no action binding is materialized. */
    candidateActionStaging?: GuideRunCandidateActionStagingPort;
    limitedAutonomyAdmissions?: GuideRunLimitedAutonomyAdmissionPort;
  }>,
) {
  const persistence = new DrizzleGuideRunRepository(input.database);
  const service = new GuideRunOrchestrationService(
    persistence,
    input.frozenScopes,
    input.dailyAnalysis,
    input.holisticAnalysis,
    input.dataHealth,
    persistence,
  );
  return Object.freeze({
    service,
    persistence,
    ledger: new DrizzleGuideRunP01LedgerProjector(input.database),
    actionBindings: input.candidateActionStaging
      ? new DrizzleGuideRunActionBindingRepository(
          input.database,
          input.candidateActionStaging,
        )
      : null,
    limitedAutonomyAdmissions: input.limitedAutonomyAdmissions ?? null,
  });
}

/**
 * Production composition entrypoint.  Keeping the schedule reader here makes
 * the worker reachable from a server scheduler without giving a transport
 * caller a way to substitute client-provided schedule state.
 */
export function createGuideRunSchedulerWorker(
  input: Readonly<{
    database: Pick<Database, "execute" | "transaction">;
    dailyAnalysis: GuideRunDailyAgentPort;
    holisticAnalysis: GuideRunHolisticAgentPort;
    dataHealth: GuideRunTrustedDataHealthPort;
    candidateActionStaging?: GuideRunCandidateActionStagingPort;
    limitedAutonomyAdmissions?: GuideRunLimitedAutonomyAdmissionPort;
  }>,
): GuideRunSchedulerWorker {
  // Scheduler runs span tenants; scope identity is therefore derived from the
  // persisted run/revision chain, never from an injected fixed-workspace port.
  const database = input.database as Database;
  const overlap = new DrizzleGuideRunEffectiveOverlapRepository(database);
  const contexts = new DrizzleGuideRunCandidateStagingContextRepository(
    database,
    overlap,
  );
  const limitedAutonomyAdmissions =
    input.limitedAutonomyAdmissions ??
    new DrizzleP06LimitedAutonomyAdmissionRepository(
      database,
      contexts,
      new DrizzleOperationReadRepository(database),
    );
  const worker = createGuideRunWorker({
    ...input,
    frozenScopes: new DrizzleGuideRunFrozenScopeRepository(input.database),
    limitedAutonomyAdmissions,
  });
  return new GuideRunSchedulerWorker(
    worker,
    new DrizzleGuideRunActiveSchedulePort(input.database),
  );
}

/** Production rollout entrypoint. The lower-level factory remains injectable
 * for deterministic tests, while production composition is default-off until
 * both Meta read and Guide scheduler rollout stages are explicitly enabled. */
export function createGuideRunSchedulerRuntime(
  input: Readonly<{
    database: Pick<Database, "execute" | "transaction">;
    dailyAnalysis: GuideRunDailyAgentPort;
    holisticAnalysis: GuideRunHolisticAgentPort;
    dataHealth: GuideRunTrustedDataHealthPort;
    candidateActionStaging?: GuideRunCandidateActionStagingPort;
    limitedAutonomyAdmissions?: GuideRunLimitedAutonomyAdmissionPort;
    environment?: P08RolloutEnvironment;
  }>,
) {
  if (!resolveP08RolloutControl(input.environment).guideSchedulerEnabled) {
    return Object.freeze({ enabled: false as const, scheduler: null });
  }
  return Object.freeze({
    enabled: true as const,
    scheduler: createGuideRunSchedulerWorker(input),
  });
}

/** Server-owned local provider composition. Rollout and provider flags are
 * independent; neither scheduler nor interactive-agent enablement can launch
 * this provider implicitly. */
export function createLocalCodexGuideRunSchedulerRuntime(
  input: Readonly<{
    database: Pick<Database, "execute" | "transaction">;
    dataHealth: GuideRunTrustedDataHealthPort;
    candidateActionStaging?: GuideRunCandidateActionStagingPort;
    limitedAutonomyAdmissions?: GuideRunLimitedAutonomyAdmissionPort;
    environment?: P08RolloutEnvironment;
    serverCwd?: string;
  }>,
) {
  const environment = input.environment ?? process.env;
  if (!resolveP08RolloutControl(environment).guideSchedulerEnabled)
    return Object.freeze({ enabled: false as const, scheduler: null });
  const agents = createLocalCodexGuideRunAgents(
    environment,
    input.serverCwd,
    new DrizzleGuideRunMemberMetricEvidenceRepository(input.database),
    new DrizzleGuideRunStageableStatusCandidateRepository(input.database),
  );
  if (!agents)
    return Object.freeze({ enabled: false as const, scheduler: null });
  return createGuideRunSchedulerRuntime({
    database: input.database,
    dataHealth: input.dataHealth,
    candidateActionStaging: input.candidateActionStaging,
    limitedAutonomyAdmissions: input.limitedAutonomyAdmissions,
    environment,
    ...agents,
  });
}

/**
 * Narrow scheduler-to-worker transport. A schedule fire is first recorded as
 * an immutable receipt, then materialized by the same idempotency key, fenced,
 * and resumed from immutable artifacts. It owns neither Meta nor approvals.
 */
export class GuideRunSchedulerWorker {
  constructor(
    private readonly worker: ReturnType<typeof createGuideRunWorker>,
    private readonly schedules: GuideRunActiveSchedulePort,
  ) {}
  async tick(
    input: Readonly<{ now: string; leaseToken: string; leaseUntil: string }>,
  ) {
    const outputs: Array<Readonly<{ runRef: string; state: string }>> = [];
    for (const entry of await this.schedules.listActiveSchedules({
      now: input.now,
    })) {
      const plan = planScheduledGuideRuns({
        guide: {
          guideRef: entry.guide.guideRef,
          revisionHash: entry.guide.revisionHash,
          schedule: entry.guide.schedule,
          active: true,
        },
        head: {
          activatedAt: entry.activatedAt,
          lastScheduledFor: entry.lastScheduledFor,
        },
        now: input.now,
      });
      if (plan.missed)
        await this.worker.persistence.recordScheduleReceipt({
          workspaceId: entry.workspaceId,
          guideRevisionId: entry.guideRevisionId,
          scheduledFor: plan.missed.lastScheduledFor,
          missedFrom: plan.missed.firstScheduledFor,
          missedTo: plan.missed.lastScheduledFor,
          missedCount: plan.missed.count,
          runRef: null,
          createdAt: input.now,
        });
      if (!plan.claim) continue;
      const due = await this.worker.service.fire({
        guide: entry.guide,
        trigger: { kind: "scheduled", scheduledFor: plan.claim.scheduledFor },
        occurredAt: input.now,
      });
      await this.worker.persistence.recordScheduleReceipt({
        workspaceId: entry.workspaceId,
        guideRevisionId: entry.guideRevisionId,
        scheduledFor: plan.claim.scheduledFor,
        missedFrom: null,
        missedTo: null,
        missedCount: 0,
        runRef: due.runRef,
        createdAt: input.now,
      });
      // A retry after a successful execution has no more agent work to do, but
      // still replays the immutable P01 projection (crash-after-completion).
      if (due.state === "completed") {
        await this.worker.ledger.projectPersisted({
          workspaceId: entry.workspaceId,
          runRef: due.runRef,
        });
        outputs.push(Object.freeze({ runRef: due.runRef, state: due.state }));
        continue;
      }
      let claimed = due;
      if (due.state === "due")
        claimed = await this.worker.service.claim(due, {
          leaseToken: input.leaseToken,
          leaseUntil: input.leaseUntil,
          occurredAt: input.now,
        });
      else if (
        due.lease &&
        Date.parse(due.lease.expiresAt) <= Date.parse(input.now)
      )
        claimed = await this.worker.service.reclaim(due, {
          leaseToken: input.leaseToken,
          leaseUntil: input.leaseUntil,
          occurredAt: input.now,
        });
      else if (due.lease?.token === input.leaseToken) {
        // A retry under the still-valid same fence executes/resumes directly.
        // Renew only when the requested expiry strictly advances the lease.
        if (Date.parse(input.leaseUntil) > Date.parse(due.lease.expiresAt))
          claimed = await this.worker.service.renew(due, {
            leaseToken: input.leaseToken,
            leaseUntil: input.leaseUntil,
            occurredAt: input.now,
          });
      } else continue; // another live worker owns the fence
      const complete = await this.worker.service.execute({
        run: claimed,
        guide: entry.guide,
        leaseToken: input.leaseToken,
        occurredAt: input.now,
      });
      // The projector itself reads/decodes immutable records and is a no-op for
      // runs without finding artifacts; callers never provide agent payloads.
      await this.worker.ledger.projectPersisted({
        workspaceId: entry.workspaceId,
        runRef: complete.run.runRef,
      });
      // Materialization is post-disposition only. The repository re-reads the
      // immutable artifact and refuses legacy/non-stageable candidates.
      if (complete.disposition.state === "staged") {
        if (
          complete.disposition.candidate?.routing === "human_approval" &&
          this.worker.actionBindings
        )
          await this.worker.actionBindings.bind({
            workspaceId: entry.workspaceId,
            runRef: complete.run.runRef,
          });
        if (
          complete.disposition.candidate?.routing ===
            "limited_autonomy_review" &&
          this.worker.limitedAutonomyAdmissions
        )
          await this.worker.limitedAutonomyAdmissions.reserve({
            workspaceId: entry.workspaceId,
            runRef: complete.run.runRef,
          });
      }
      outputs.push(
        Object.freeze({
          runRef: complete.run.runRef,
          state: complete.run.state,
        }),
      );
    }
    return Object.freeze(outputs);
  }
}
