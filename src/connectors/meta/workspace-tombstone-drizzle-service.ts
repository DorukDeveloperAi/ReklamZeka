import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  META_DATA_LIFECYCLE_POLICY_VERSION,
  type WorkspaceLifecycleState,
} from "@/domain/meta/data-lifecycle";

type ReklamZekaDatabase = NodePgDatabase<typeof schema>;
type DrizzleExecutor = Pick<ReklamZekaDatabase, "execute">;

export type WorkspaceTombstonePurgeEvidence = Readonly<{
  revision: string;
  candidateCount: number;
}>;

/**
 * The implementation must use an explicit table allowlist. It may remove
 * memberships and non-audit workspace rows only; audit_events, workspaces and
 * meta_connections are owned by this adapter and must never be mutated here.
 */
export type WorkspaceTombstonePurgePort = Readonly<{
  inspect(executor: DrizzleExecutor, workspaceId: string): Promise<WorkspaceTombstonePurgeEvidence>;
  purge(executor: DrizzleExecutor, input: Readonly<{
    workspaceId: string;
    expectedRevision: string;
  }>): Promise<Readonly<{ purgedRowCount: number; membershipCount: number }>>;
}>;

export type WorkspaceTombstoneApprovalVerifier = Readonly<{
  authorize(input: Readonly<{
    approvalRef: string;
    planRef: string;
    workspaceRef: string;
    expectedRevision: string;
    expiresAt: string;
    action: "workspace.tombstone.execute";
  }>): Promise<boolean>;
}>;

export type WorkspaceTombstonePreview = Readonly<{
  policyVersion: typeof META_DATA_LIFECYCLE_POLICY_VERSION;
  mode: "dry_run";
  planRef: string;
  workspaceRef: string;
  revisionRef: string;
  candidateCount: number;
  connectionCount: number;
  issuedAt: string;
  expiresAt: string;
}>;

export type WorkspaceTombstoneResult = Readonly<{
  policyVersion: typeof META_DATA_LIFECYCLE_POLICY_VERSION;
  mode: "execute";
  planRef: string;
  workspaceRef: string;
  purgedRowCount: number;
  membershipCount: number;
  revokedConnectionCount: number;
  auditEventsAppended: 2;
  executedAt: string;
}>;

type InternalSnapshot = Readonly<{
  state: WorkspaceLifecycleState;
  generation: number;
  revision: string;
  purgeRevision: string;
  candidateCount: number;
  connectionCount: number;
}>;

type InternalPlan = Readonly<{
  planRef: string;
  workspaceId: string;
  workspaceRef: string;
  expectedRevision: string;
  expectedPurgeRevision: string;
  expectedGeneration: number;
  expiresAt: string;
  consumed: boolean;
}>;

export type WorkspaceTombstoneStore = Readonly<{
  inspect(workspaceId: string): Promise<InternalSnapshot>;
  execute(input: Readonly<{
    workspaceId: string;
    workspaceRef: string;
    expectedRevision: string;
    expectedPurgeRevision: string;
    expectedGeneration: number;
    lifecycleActorId: string;
    occurredAt: string;
  }>): Promise<Readonly<{
    purgedRowCount: number;
    membershipCount: number;
    revokedConnectionCount: number;
  }>>;
}>;

export type WorkspaceTombstoneErrorCode =
  | "invalid_input"
  | "workspace_unavailable"
  | "plan_missing"
  | "plan_consumed"
  | "plan_expired"
  | "approval_required"
  | "revision_changed";

export class WorkspaceTombstoneError extends Error {
  constructor(readonly code: WorkspaceTombstoneErrorCode) {
    super("Workspace tombstone işlemi güvenli biçimde tamamlanamadı");
    this.name = "WorkspaceTombstoneError";
  }
}

function publicRef(namespace: string, value: string): string {
  return `${namespace}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function validTime(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new WorkspaceTombstoneError("invalid_input");
  return parsed;
}

function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new WorkspaceTombstoneError("workspace_unavailable");
  }
  return result.rows as readonly T[];
}

function revisionOf(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

type LifecycleAuditEvent = Readonly<{
  workspaceId: string;
  actorId: string;
  action: "workspace.tombstone_requested" | "workspace.tombstoned";
  resourceType: "workspace";
  resourceId: string;
  occurredAt: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  id: string;
  previousHash: string;
}>;

/** Same JSON/SHA-256 envelope used by AppendOnlyAuditLog. */
export function hashWorkspaceLifecycleAuditEvent(event: LifecycleAuditEvent): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

export class WorkspaceTombstoneService {
  private readonly plans = new Map<string, InternalPlan>();

  constructor(
    private readonly store: WorkspaceTombstoneStore,
    private readonly approvals: WorkspaceTombstoneApprovalVerifier,
    private readonly lifecycleActorId: string,
    private readonly planTtlMs = 15 * 60 * 1000,
  ) {
    if (!lifecycleActorId || planTtlMs < 1) throw new WorkspaceTombstoneError("invalid_input");
  }

  async dryRun(workspaceId: string, now: string): Promise<WorkspaceTombstonePreview> {
    if (!workspaceId) throw new WorkspaceTombstoneError("invalid_input");
    const nowMs = validTime(now);
    const snapshot = await this.store.inspect(workspaceId);
    if (snapshot.state !== "active" || snapshot.generation < 1) {
      throw new WorkspaceTombstoneError("workspace_unavailable");
    }
    const planRef = `tombstone_${randomUUID()}`;
    const workspaceRef = publicRef("workspace", workspaceId);
    const expiresAt = new Date(nowMs + this.planTtlMs).toISOString();
    this.plans.set(planRef, Object.freeze({
      planRef,
      workspaceId,
      workspaceRef,
      expectedRevision: snapshot.revision,
      expectedPurgeRevision: snapshot.purgeRevision,
      expectedGeneration: snapshot.generation,
      expiresAt,
      consumed: false,
    }));
    return Object.freeze({
      policyVersion: META_DATA_LIFECYCLE_POLICY_VERSION,
      mode: "dry_run",
      planRef,
      workspaceRef,
      revisionRef: publicRef("revision", snapshot.revision),
      candidateCount: snapshot.candidateCount,
      connectionCount: snapshot.connectionCount,
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt,
    });
  }

  async execute(input: Readonly<{
    planRef: string;
    approvalRef: string;
    now: string;
  }>): Promise<WorkspaceTombstoneResult> {
    if (!input.approvalRef) throw new WorkspaceTombstoneError("approval_required");
    const plan = this.plans.get(input.planRef);
    if (!plan) throw new WorkspaceTombstoneError("plan_missing");
    if (plan.consumed) throw new WorkspaceTombstoneError("plan_consumed");
    const nowMs = validTime(input.now);
    if (nowMs > Date.parse(plan.expiresAt)) throw new WorkspaceTombstoneError("plan_expired");
    if (!await this.approvals.authorize({
      approvalRef: input.approvalRef,
      planRef: plan.planRef,
      workspaceRef: plan.workspaceRef,
      expectedRevision: plan.expectedRevision,
      expiresAt: plan.expiresAt,
      action: "workspace.tombstone.execute",
    })) throw new WorkspaceTombstoneError("approval_required");

    const result = await this.store.execute({
      workspaceId: plan.workspaceId,
      workspaceRef: plan.workspaceRef,
      expectedRevision: plan.expectedRevision,
      expectedPurgeRevision: plan.expectedPurgeRevision,
      expectedGeneration: plan.expectedGeneration,
      lifecycleActorId: this.lifecycleActorId,
      occurredAt: new Date(nowMs).toISOString(),
    });
    this.plans.set(plan.planRef, Object.freeze({ ...plan, consumed: true }));
    return Object.freeze({
      policyVersion: META_DATA_LIFECYCLE_POLICY_VERSION,
      mode: "execute",
      planRef: plan.planRef,
      workspaceRef: plan.workspaceRef,
      ...result,
      auditEventsAppended: 2,
      executedAt: new Date(nowMs).toISOString(),
    });
  }
}

export class DrizzleWorkspaceTombstoneStore implements WorkspaceTombstoneStore {
  constructor(
    private readonly database: ReklamZekaDatabase,
    private readonly purgePort: WorkspaceTombstonePurgePort,
  ) {}

  async inspect(workspaceId: string): Promise<InternalSnapshot> {
    return this.snapshot(this.database, workspaceId);
  }

  async execute(input: Readonly<{
    workspaceId: string;
    workspaceRef: string;
    expectedRevision: string;
    expectedPurgeRevision: string;
    expectedGeneration: number;
    lifecycleActorId: string;
    occurredAt: string;
  }>) {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.workspaceId}, 0))`);
      await transaction.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid for update`);
      const current = await this.snapshot(transaction as unknown as DrizzleExecutor, input.workspaceId);
      if (
        current.state !== "active"
        || current.generation !== input.expectedGeneration
        || current.revision !== input.expectedRevision
      ) throw new WorkspaceTombstoneError("revision_changed");

      const transitioned = rows<{ id: string }>(await transaction.execute(sql`
        update workspaces set lifecycle_state = 'tombstoning'
        where id = ${input.workspaceId}::uuid
          and lifecycle_state = 'active'
          and lifecycle_generation = ${input.expectedGeneration}
        returning id
      `));
      if (transitioned.length !== 1) throw new WorkspaceTombstoneError("revision_changed");
      const requestAuditHash = await this.appendAudit(
        transaction as unknown as DrizzleExecutor,
        input,
        "workspace.tombstone_requested",
        {
        policyVersion: META_DATA_LIFECYCLE_POLICY_VERSION,
        expectedGeneration: input.expectedGeneration,
        },
      );

      const revoked = rows<{ count: number }>(await transaction.execute(sql`
        with changed as (
          update meta_connections set
            external_connection_key = 'tombstoned_' || id::text,
            display_name = 'Tombstoned Meta connection',
            external_business_id = null,
            granted_scopes = '[]'::jsonb,
            enabled_capabilities = '[]'::jsonb,
            capability_snapshot = '{}'::jsonb,
            capability_checked_at = null,
            token_expires_at = null,
            data_access_expires_at = null,
            status = 'revoked',
            secret_reference_id = null,
            secret_provider = null,
            secret_key_version = null,
            secret_binding_name = null,
            secret_disabled_at = ${input.occurredAt}::timestamptz,
            secret_destroyed_at = ${input.occurredAt}::timestamptz,
            disconnected_at = coalesce(disconnected_at, ${input.occurredAt}::timestamptz),
            revoked_at = ${input.occurredAt}::timestamptz,
            lifecycle_generation = lifecycle_generation + 1,
            updated_at = ${input.occurredAt}::timestamptz
          where workspace_id = ${input.workspaceId}::uuid
          returning 1
        ) select count(*)::int as count from changed
      `))[0]?.count ?? 0;

      const purged = await this.purgePort.purge(transaction as unknown as DrizzleExecutor, {
        workspaceId: input.workspaceId,
        expectedRevision: input.expectedPurgeRevision,
      });
      await this.appendAudit(
        transaction as unknown as DrizzleExecutor,
        input,
        "workspace.tombstoned",
        {
          policyVersion: META_DATA_LIFECYCLE_POLICY_VERSION,
          purgedRowCount: purged.purgedRowCount,
          membershipCount: purged.membershipCount,
          revokedConnectionCount: revoked,
        },
        requestAuditHash,
      );
      const finalized = rows<{ id: string }>(await transaction.execute(sql`
        update workspaces set
          name = 'Tombstoned workspace',
          lifecycle_state = 'tombstoned',
          tombstoned_at = ${input.occurredAt}::timestamptz,
          lifecycle_generation = lifecycle_generation + 1
        where id = ${input.workspaceId}::uuid and lifecycle_state = 'tombstoning'
        returning id
      `));
      if (finalized.length !== 1) throw new WorkspaceTombstoneError("revision_changed");
      return {
        purgedRowCount: purged.purgedRowCount,
        membershipCount: purged.membershipCount,
        revokedConnectionCount: revoked,
      };
    }, { isolationLevel: "serializable", accessMode: "read write" });
  }

  private async snapshot(executor: DrizzleExecutor, workspaceId: string): Promise<InternalSnapshot> {
    const workspace = rows<{
      lifecycle_state: WorkspaceLifecycleState;
      lifecycle_generation: number;
      row_revision: string;
    }>(await executor.execute(sql`
      select lifecycle_state, lifecycle_generation,
        (xmin::text || ':' || ctid::text) as row_revision
      from workspaces where id = ${workspaceId}::uuid
    `))[0];
    if (!workspace) throw new WorkspaceTombstoneError("workspace_unavailable");
    const connections = rows<{ count: number; revision: string }>(await executor.execute(sql`
      select count(*)::int as count,
        coalesce(md5(string_agg(xmin::text || ':' || ctid::text, ',' order by ctid::text)), md5('')) as revision
      from meta_connections where workspace_id = ${workspaceId}::uuid
    `))[0]!;
    const audit = rows<{ revision: string }>(await executor.execute(sql`
      select coalesce(md5(string_agg(event_hash, ',' order by occurred_at, created_at, id)), md5('')) as revision
      from audit_events where workspace_id = ${workspaceId}::uuid
    `))[0]!;
    const purge = await this.purgePort.inspect(executor, workspaceId);
    return Object.freeze({
      state: workspace.lifecycle_state,
      generation: workspace.lifecycle_generation,
      revision: revisionOf([
        workspace.row_revision,
        connections.revision,
        audit.revision,
        purge.revision,
      ]),
      purgeRevision: purge.revision,
      candidateCount: purge.candidateCount,
      connectionCount: connections.count,
    });
  }

  private async appendAudit(
    executor: DrizzleExecutor,
    input: Readonly<{
      workspaceId: string;
      workspaceRef: string;
      lifecycleActorId: string;
      occurredAt: string;
    }>,
    action: LifecycleAuditEvent["action"],
    metadata: LifecycleAuditEvent["metadata"],
    explicitPreviousHash?: string,
  ): Promise<string> {
    const previousHash = explicitPreviousHash ?? rows<{ event_hash: string }>(await executor.execute(sql`
        select event_hash from audit_events
        where workspace_id = ${input.workspaceId}::uuid
        order by occurred_at desc, created_at desc, id desc limit 1
      `))[0]?.event_hash ?? "GENESIS";
    const event: LifecycleAuditEvent = {
      workspaceId: input.workspaceId,
      actorId: input.lifecycleActorId,
      action,
      resourceType: "workspace",
      resourceId: input.workspaceRef,
      occurredAt: input.occurredAt,
      metadata,
      id: randomUUID(),
      previousHash,
    };
    const eventHash = hashWorkspaceLifecycleAuditEvent(event);
    await executor.execute(sql`
      insert into audit_events (
        id, workspace_id, actor_id, action, resource_type, resource_id,
        metadata, previous_hash, event_hash, occurred_at
      ) values (
        ${event.id}::uuid, ${event.workspaceId}::uuid, ${event.actorId}::uuid,
        ${event.action}, ${event.resourceType}, ${event.resourceId},
        ${JSON.stringify(event.metadata)}::jsonb, ${event.previousHash},
        ${eventHash}, ${event.occurredAt}::timestamptz
      )
    `);
    return eventHash;
  }
}
