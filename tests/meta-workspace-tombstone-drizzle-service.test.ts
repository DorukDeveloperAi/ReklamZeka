import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  DrizzleWorkspaceTombstoneStore,
  WorkspaceTombstoneError,
  WorkspaceTombstoneService,
  hashWorkspaceLifecycleAuditEvent,
  type WorkspaceTombstoneApprovalVerifier,
  type WorkspaceTombstonePurgePort,
  type WorkspaceTombstoneStore,
} from "@/connectors/meta/workspace-tombstone-drizzle-service";

function fixture() {
  let revision = "revision-a";
  const store: WorkspaceTombstoneStore = {
    inspect: vi.fn(async () => ({
      state: "active" as const,
      generation: 3,
      revision,
      purgeRevision: "purge-revision-a",
      candidateCount: 14,
      connectionCount: 2,
    })),
    execute: vi.fn(async (input) => {
      if (input.expectedRevision !== revision) throw new WorkspaceTombstoneError("revision_changed");
      return { purgedRowCount: 12, membershipCount: 2, revokedConnectionCount: 2 };
    }),
  };
  const approvals: WorkspaceTombstoneApprovalVerifier & {
    authorize: ReturnType<typeof vi.fn<(input: unknown) => Promise<boolean>>>;
  } = { authorize: vi.fn(async () => true) };
  return { store, approvals, setRevision(value: string) { revision = value; } };
}

describe("workspace tombstone boundary", () => {
  it("resumes only an evidenced tombstoning workspace and consumes its plan", async () => {
    const { store, approvals, setRevision } = fixture(); setRevision("resume-r");
    (store.inspect as ReturnType<typeof vi.fn>).mockResolvedValue({ state:"tombstoning", generation:3, revision:"resume-r", purgeRevision:"purge-r", candidateCount:4, connectionCount:0 });
    const service=new WorkspaceTombstoneService(store,approvals,"lifecycle-actor",60_000);
    await expect(service.dryRun("workspace-a","2026-08-07T12:00:00Z")).rejects.toMatchObject({code:"workspace_unavailable"});
    await expect(service.resumeTombstoning("workspace-a","wrong",4,"2026-08-07T12:00:00Z")).rejects.toMatchObject({code:"revision_changed"});
    const plan=await service.resumeTombstoning("workspace-a","resume-r",4,"2026-08-07T12:00:00Z");
    approvals.authorize.mockResolvedValue(false);
    await expect(service.execute({planRef:plan.planRef,approvalRef:"no",now:"2026-08-07T12:00:01Z"})).rejects.toMatchObject({code:"approval_required"});
    approvals.authorize.mockResolvedValue(true);
    await service.execute({planRef:plan.planRef,approvalRef:"yes",now:"2026-08-07T12:00:02Z"});
    expect(store.execute).toHaveBeenCalledWith(expect.objectContaining({resume:true,expectedRevision:"resume-r"}));
    await expect(service.execute({planRef:plan.planRef,approvalRef:"yes",now:"2026-08-07T12:00:03Z"})).rejects.toMatchObject({code:"plan_consumed"});
  });
  it("returns masked aggregate evidence and requires an application approval verifier", async () => {
    const { store, approvals } = fixture();
    approvals.authorize.mockResolvedValue(false);
    const service = new WorkspaceTombstoneService(store, approvals, "lifecycle-actor", 60_000);
    const preview = await service.dryRun("private-workspace", "2026-08-07T12:00:00Z");

    expect(preview).toMatchObject({ candidateCount: 14, connectionCount: 2, mode: "dry_run" });
    expect(JSON.stringify(preview)).not.toContain("private-workspace");
    await expect(service.execute({
      planRef: preview.planRef,
      approvalRef: "caller-claim",
      now: "2026-08-07T12:00:30Z",
    })).rejects.toMatchObject({ code: "approval_required" });
    expect(store.execute).not.toHaveBeenCalled();
  });

  it("binds execution to revision and TTL, then consumes a successful plan once", async () => {
    const { store, approvals, setRevision } = fixture();
    const service = new WorkspaceTombstoneService(store, approvals, "lifecycle-actor", 60_000);
    const stale = await service.dryRun("workspace-a", "2026-08-07T12:00:00Z");
    setRevision("revision-b");
    await expect(service.execute({
      planRef: stale.planRef,
      approvalRef: "approved",
      now: "2026-08-07T12:00:30Z",
    })).rejects.toMatchObject({ code: "revision_changed" });

    const fresh = await service.dryRun("workspace-a", "2026-08-07T12:01:00Z");
    const result = await service.execute({
      planRef: fresh.planRef,
      approvalRef: "approved",
      now: "2026-08-07T12:01:30Z",
    });
    expect(result).toMatchObject({
      purgedRowCount: 12,
      membershipCount: 2,
      revokedConnectionCount: 2,
      auditEventsAppended: 2,
    });
    expect(JSON.stringify(result)).not.toContain("workspace-a");
    await expect(service.execute({
      planRef: fresh.planRef,
      approvalRef: "approved",
      now: "2026-08-07T12:01:31Z",
    })).rejects.toMatchObject({ code: "plan_consumed" });

    const expired = await service.dryRun("workspace-a", "2026-08-07T12:02:00Z");
    await expect(service.execute({
      planRef: expired.planRef,
      approvalRef: "approved",
      now: "2026-08-07T12:03:01Z",
    })).rejects.toMatchObject({ code: "plan_expired" });
  });

  it("uses the existing append-only JSON/SHA-256 audit envelope", () => {
    const event = {
      workspaceId: "workspace-a",
      actorId: "actor-a",
      action: "workspace.tombstone_requested" as const,
      resourceType: "workspace" as const,
      resourceId: "workspace_masked",
      occurredAt: "2026-08-07T12:00:00.000Z",
      metadata: { expectedGeneration: 3 },
      id: "event-a",
      previousHash: "GENESIS",
    };
    expect(hashWorkspaceLifecycleAuditEvent(event)).toBe(
      createHash("sha256").update(JSON.stringify(event)).digest("hex"),
    );
  });

  it("locks the workspace and only appends lifecycle audit rows", async () => {
    const statements: string[] = [];
    const statementParams: unknown[][] = [];
    const dialect = new PgDialect();
    const executor = {
      execute: vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const rendered = dialect.sqlToQuery(query);
        const statement = rendered.sql;
        statements.push(statement);
        statementParams.push(rendered.params);
        if (statement.includes("select lifecycle_state")) {
          return { rows: [{ lifecycle_state: "active", lifecycle_generation: 1, row_revision: "1:(0,1)" }] };
        }
        if (statement.includes("from meta_connections where")) {
          return { rows: [{ count: 0, revision: "connections" }] };
        }
        if (statement.includes("coalesce(md5(string_agg(event_hash")) {
          return { rows: [{ revision: "audit" }] };
        }
        if (statement.includes("select event_hash from audit_events")) return { rows: [] };
        if (statement.includes("with changed as")) return { rows: [{ count: 0 }] };
        if (statement.includes("update workspaces set") && statement.includes("returning id")) {
          return { rows: [{ id: "workspace" }] };
        }
        return { rows: [] };
      }),
    };
    const database = {
      ...executor,
      transaction: vi.fn(async (work: (tx: typeof executor) => Promise<unknown>) => work(executor)),
    };
    const purgePort: WorkspaceTombstonePurgePort = {
      inspect: vi.fn(async () => ({ revision: "purge", candidateCount: 0 })),
      purge: vi.fn(async () => ({ purgedRowCount: 0, membershipCount: 0 })),
    };
    const store = new DrizzleWorkspaceTombstoneStore(
      database as never,
      purgePort,
    );
    const snapshot = await store.inspect("00000000-0000-0000-0000-000000000001");
    await store.execute({
      workspaceId: "00000000-0000-0000-0000-000000000001",
      workspaceRef: "workspace_masked",
      expectedRevision: snapshot.revision,
      expectedPurgeRevision: snapshot.purgeRevision,
      expectedGeneration: 1,
      lifecycleActorId: "00000000-0000-0000-0000-000000000002",
      occurredAt: "2026-08-07T12:00:00.000Z",
    });

    expect(statements.some((statement) => statement.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(statements.filter((statement) => statement.includes("insert into audit_events"))).toHaveLength(2);
    expect(statements.filter((statement) => statement.includes("select event_hash from audit_events"))).toHaveLength(1);
    expect(statements.some((statement) => /(?:update|delete) audit_events/.test(statement))).toBe(false);
    expect(purgePort.purge).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      expectedRevision: "purge",
    }));
    const auditParams = statementParams.filter((_, index) => statements[index]?.includes("insert into audit_events"));
    const requestHash = auditParams[0]?.at(-2);
    expect(requestHash).toEqual(expect.any(String));
    expect(auditParams[1]).toContain(requestHash);
    expect(database.transaction).toHaveBeenCalledOnce();
  });
});
