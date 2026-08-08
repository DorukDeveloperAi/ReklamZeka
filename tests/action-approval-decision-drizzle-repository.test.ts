import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  ActionApprovalDecisionRepositoryError,
  DrizzleActionApprovalDecisionRepository,
} from "@/connectors/actions/action-approval-decision-drizzle-repository";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import {
  ACTION_APPROVAL_POLICY_VERSION,
  createActionBundle,
  initializeApprovalLifecycle,
  type ApprovalDecisionCommand,
  type ApprovalLifecycle,
} from "@/domain/actions/approval-lifecycle";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const bundleId = "10000000-0000-4000-8000-000000000001";
const unitId = "20000000-0000-4000-8000-000000000001";
const decisionId = "30000000-0000-4000-8000-000000000001";
const unitRef = `action_unit_${"a".repeat(20)}`;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function initial(): ApprovalLifecycle {
  const bundle = createActionBundle({
    bundleRef: `action_bundle_${"b".repeat(20)}`,
    plan: { planRef: "plan_daily", revision: 1, planHash: "1".repeat(64) },
    units: [{
      unitRef,
      scope: { workspaceRef: "workspace_alpha", accountRef: "act_12345", entityRef: "campaign_12345", actionType: "status_pause" },
      risk: "K2",
      sourceHash: "2".repeat(64), contextHash: "3".repeat(64), specHash: "4".repeat(64),
      dependencies: [], requester: { actorRef: "actor_operator", role: "operator" },
      proposedAt: "2026-08-07T18:00:00.000Z", expiresAt: "2026-08-08T18:00:00.000Z",
    }],
  });
  return initializeApprovalLifecycle({
    bundle,
    policy: {
      version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "policy_queue", revision: 1,
      autonomyMode: "approval_only", requesterRoles: ["operator"],
      approverRoles: [{ risk: "K2", roles: ["owner"] }], grantConsumerRoles: ["owner"],
      separationOfDutiesRisks: ["K3"], maximumProtectionEvidenceAgeSeconds: 3_600,
      maximumProposalLifetimeSeconds: 86_400,
      maximumGrantLifetimeSeconds: 300,
    },
    initializedAt: "2026-08-07T18:00:00.000Z", eventRef: "event_initialized",
  }).lifecycle;
}

function command(lifecycle: ApprovalLifecycle): ApprovalDecisionCommand {
  const unit = lifecycle.bundle.units[0]!;
  const freshness = lifecycle.bundle.units.map((candidate) => ({
    unitRef: candidate.unitRef, planRevision: candidate.plan.revision, planHash: candidate.plan.planHash,
    sourceHash: candidate.sourceHash, contextHash: candidate.contextHash, specHash: candidate.specHash,
  }));
  return {
    kind: "approve", commandRef: "decision_daily", unitRef, actor: { actorRef: "actor_owner", role: "owner" },
    decidedAt: "2026-08-07T18:01:00.000Z", reasonCode: "approved_after_review", freshness,
    authorization: {
      authorizationRef: "presence_authorization", unitRef, unitHash: unit.unitHash, scopeHash: unit.scopeHash,
      actor: { actorRef: "actor_owner", role: "owner" }, issuedAt: "2026-08-07T18:00:30.000Z",
      expiresAt: "2026-08-07T18:02:00.000Z", humanPresence: true, canExecute: false,
    },
    grantRef: "grant_daily",
  };
}

class AtomicDecisionDatabase {
  private readonly dialect = new PgDialect();
  private decisions: Record<string, unknown>[] = [];
  private grants: Record<string, unknown>[] = [];
  readonly queries: string[] = [];
  readonly seed = initial();
  failGrant = false;

  execute = vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    const rendered = this.dialect.sqlToQuery(query);
    const statement = rendered.sql.toLowerCase();
    const params = rendered.params;
    this.queries.push(statement);
    if (statement.includes("select id from workspaces")) return { rows: [{ id: workspaceId }] };
    if (statement.includes("select b.id as bundle_id")) return { rows: [{ bundle_id: bundleId, unit_id: unitId }] };
    if (statement.includes("coalesce(jsonb_agg")) {
      const event = this.seed.trace[0]!;
      return { rows: [{
        lifecycle_hash: digest(this.seed), trace_hash: this.seed.traceHash,
        bundle_payload: this.seed.bundle, policy_payload: this.seed.policy, unit_payloads: this.seed.bundle.units,
        initial_event_ref: event.eventRef, initial_sequence: event.sequence,
        initial_previous_hash: event.previousHash, initial_event_hash: event.eventHash,
        initial_event_type: event.eventType, initial_occurred_at: new Date(event.occurredAt),
        initial_reason_code: event.reasonCode,
      }] };
    }
    if (statement.includes("from action_approval_decision_events") && !statement.includes("insert into")) {
      return { rows: this.decisions };
    }
    if (statement.includes("from action_approval_evidence_grants") && !statement.includes("insert into")) {
      return { rows: this.grants.map((grant) => ({
        command_ref: grant.command_ref, grant_hash: grant.grant_hash, grant_payload: grant.grant_payload,
      })) };
    }
    if (statement.includes("insert into action_approval_decision_events")) {
      const row = {
        id: decisionId, unit_id: unitId, ordinal: params[3], command_ref: params[4], unit_ref: params[6],
        unit_hash: params[7], command_hash: params[12], lifecycle_before_hash: params[14],
        lifecycle_after_hash: params[15], trace_after_hash: params[16],
        command_payload: JSON.parse(params[17] as string), event_payloads: JSON.parse(params[18] as string),
      };
      this.decisions.push(row);
      return { rows: [{ id: decisionId }] };
    }
    if (statement.includes("insert into action_approval_evidence_grants")) {
      if (this.failGrant) throw new Error("injected_grant_failure");
      this.grants.push({ command_ref: this.decisions.at(-1)!.command_ref, grant_hash: params[15],
        grant_payload: JSON.parse(params[16] as string) });
      return { rows: [{ id: "40000000-0000-4000-8000-000000000001" }] };
    }
    throw new Error(`unexpected_query:${statement}`);
  });

  transaction = async <T>(work: (database: AtomicDecisionDatabase) => Promise<T>): Promise<T> => {
    const decisionSnapshot = this.decisions.map((row) => ({ ...row }));
    const grantSnapshot = this.grants.map((row) => ({ ...row }));
    try { return await work(this); } catch (error) {
      this.decisions = decisionSnapshot;
      this.grants = grantSnapshot;
      throw error;
    }
  };

  counts() { return { decisions: this.decisions.length, grants: this.grants.length }; }
}

describe("DrizzleActionApprovalDecisionRepository", () => {
  it("locks, invokes proof callback after trace revalidation, and atomically appends non-executable approval evidence", async () => {
    const database = new AtomicDecisionDatabase();
    const repository = new DrizzleActionApprovalDecisionRepository(database as never, workspaceId);
    const callback = vi.fn(async (snapshot: { lifecycle: ApprovalLifecycle }) => command(snapshot.lifecycle));
    const result = await repository.decideAtomically({
      workspaceId, unitRef, expectedTraceHash: database.seed.traceHash, buildCommand: callback,
    });
    expect(result).toMatchObject({ outcome: "inserted", executionAuthority: "none", executionPerformed: false });
    expect(result.lifecycle.units[0]).toMatchObject({ state: "approved", grant: {
      capability: "approval_evidence_only", canExecute: false, consumedAt: null, consumedBy: null,
    } });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(database.counts()).toEqual({ decisions: 1, grants: 1 });
    expect(database.queries.findIndex((query) => query.includes("for update of b, u")))
      .toBeLessThan(database.queries.findIndex((query) => query.includes("insert into action_approval_decision_events")));
  });

  it("rejects stale trace before consuming proof and rolls back a partial approval", async () => {
    const stale = new AtomicDecisionDatabase();
    const callback = vi.fn(async () => command(stale.seed));
    await expect(new DrizzleActionApprovalDecisionRepository(stale as never, workspaceId).decideAtomically({
      workspaceId, unitRef, expectedTraceHash: "f".repeat(64), buildCommand: callback,
    })).rejects.toEqual(expect.objectContaining<Partial<ActionApprovalDecisionRepositoryError>>({ code: "decision_conflict" }));
    expect(callback).not.toHaveBeenCalled();
    expect(stale.counts()).toEqual({ decisions: 0, grants: 0 });

    const rollback = new AtomicDecisionDatabase();
    rollback.failGrant = true;
    await expect(new DrizzleActionApprovalDecisionRepository(rollback as never, workspaceId).decideAtomically({
      workspaceId, unitRef, expectedTraceHash: rollback.seed.traceHash,
      buildCommand: async (snapshot) => command(snapshot.lifecycle),
    })).rejects.toThrow("injected_grant_failure");
    expect(rollback.counts()).toEqual({ decisions: 0, grants: 0 });
  });

  it("replays restart state and treats only the exact command as idempotent", async () => {
    const database = new AtomicDecisionDatabase();
    const repository = new DrizzleActionApprovalDecisionRepository(database as never, workspaceId);
    const first = await repository.decideAtomically({ workspaceId, unitRef, expectedTraceHash: database.seed.traceHash,
      buildCommand: async (snapshot) => command(snapshot.lifecycle) });
    const replayed = await new DrizzleActionApprovalDecisionRepository(database as never, workspaceId).decideAtomically({
      workspaceId, unitRef, expectedTraceHash: first.traceHash,
      buildCommand: async () => command(database.seed),
    });
    expect(replayed.outcome).toBe("unchanged");
    expect(database.counts()).toEqual({ decisions: 1, grants: 1 });

    await expect(repository.decideAtomically({ workspaceId, unitRef, expectedTraceHash: first.traceHash,
      buildCommand: async () => ({ ...command(database.seed), reasonCode: "different_reason" }) }))
      .rejects.toEqual(expect.objectContaining<Partial<ActionApprovalDecisionRepositoryError>>({ code: "idempotency_conflict" }));
  });

  it("keeps decision tables dark, immutable, tenant-bound and tombstone-aware", () => {
    const migration = readFileSync("drizzle/20260807180433_fixed_tarantula.sql", "utf8");
    for (const table of ["action_approval_decision_events", "action_approval_evidence_grants"]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE "${table}" FROM PUBLIC, anon, authenticated`);
      expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain(table);
    }
    expect(migration).toContain("action_approval_decision_append_only");
    expect(migration).toContain("approval_evidence_only");
    expect(migration.indexOf("action_approval_decision_events_workspace_row_unique"))
      .toBeLessThan(migration.indexOf("action_approval_evidence_grants_decision_scope_fk"));
  });
});
