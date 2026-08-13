import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  verifyBudgetPoolHierarchyRevision,
  type BudgetPoolHierarchyRevision,
  type BudgetPoolHierarchyRevisionPort,
} from "@/application/budget-pool-hierarchy-service";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "select" | "insert" | "execute" | "transaction">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BudgetPoolHierarchyRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "membership_required" | "role_denied" | "revision_conflict" | "idempotency_conflict" | "corrupt_store") {
    super("Bütçe havuzu kalıcılık işlemi güvenli biçimde tamamlanamadı");
    this.name = "BudgetPoolHierarchyRepositoryError";
  }
}

function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) throw new BudgetPoolHierarchyRepositoryError("corrupt_store");
  return result.rows as readonly T[];
}

async function access(database: Executor, workspaceId: string, actorId: string, write: boolean) {
  if (!UUID.test(workspaceId) || !UUID.test(actorId)) throw new BudgetPoolHierarchyRepositoryError("invalid_input");
  const lock = write ? sql` for update` : sql``;
  if (!rows<{ id: string }>(await database.execute(sql`select id from workspaces where id=${workspaceId}::uuid and lifecycle_state='active' limit 1${lock}`))[0]) {
    throw new BudgetPoolHierarchyRepositoryError("workspace_scope_mismatch");
  }
  const membership = rows<{ role: "owner" | "admin" | "analyst" | "viewer" }>(await database.execute(sql`
    select role from memberships where workspace_id=${workspaceId}::uuid and user_id=${actorId}::uuid limit 1${lock}
  `))[0];
  if (!membership) throw new BudgetPoolHierarchyRepositoryError("membership_required");
  if (write && membership.role === "viewer") throw new BudgetPoolHierarchyRepositoryError("role_denied");
}

function fromRow(row: typeof schema.budgetPoolHierarchyRevisions.$inferSelect): BudgetPoolHierarchyRevision {
  const value = { workspaceId: row.workspaceId, revision: row.revision, previousHierarchyHash: row.previousHierarchyHash,
    idempotencyKey: row.idempotencyKey, hierarchy: row.hierarchyPayload };
  if (!verifyBudgetPoolHierarchyRevision(value) || value.hierarchy.hierarchyHash !== row.hierarchyHash) throw new BudgetPoolHierarchyRepositoryError("corrupt_store");
  return value;
}

export class DrizzleBudgetPoolHierarchyRepository implements BudgetPoolHierarchyRevisionPort {
  constructor(private readonly database: Executor) {}

  async append(input: Readonly<{ revision: BudgetPoolHierarchyRevision; actorId: string }>) {
    if (!verifyBudgetPoolHierarchyRevision(input.revision) || !UUID.test(input.actorId)) throw new BudgetPoolHierarchyRepositoryError("invalid_input");
    const revision = input.revision;
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`budget-pool-hierarchy:${revision.workspaceId}`}, 0))`);
      await access(transaction, revision.workspaceId, input.actorId, true);
      const existing = await transaction.select().from(schema.budgetPoolHierarchyRevisions).where(and(
        eq(schema.budgetPoolHierarchyRevisions.workspaceId, revision.workspaceId),
        eq(schema.budgetPoolHierarchyRevisions.idempotencyKey, revision.idempotencyKey),
      )).limit(1);
      if (existing[0]) {
        const stored = fromRow(existing[0]);
        if (stored.hierarchy.hierarchyHash !== revision.hierarchy.hierarchyHash) throw new BudgetPoolHierarchyRepositoryError("idempotency_conflict");
        return Object.freeze({ outcome: "unchanged" as const, auditAppended: false });
      }
      const history = await transaction.select().from(schema.budgetPoolHierarchyRevisions).where(eq(schema.budgetPoolHierarchyRevisions.workspaceId, revision.workspaceId)).orderBy(asc(schema.budgetPoolHierarchyRevisions.revision));
      const previous = history.at(-1);
      if ((!previous && (revision.revision !== 1 || revision.previousHierarchyHash !== "GENESIS"))
        || (previous && (revision.revision !== previous.revision + 1 || revision.previousHierarchyHash !== previous.hierarchyHash))) throw new BudgetPoolHierarchyRepositoryError("revision_conflict");
      const starts = revision.hierarchy.nodes.map((node) => node.effectiveFrom).sort();
      const ends = revision.hierarchy.nodes.map((node) => node.effectiveTo).sort();
      await transaction.insert(schema.budgetPoolHierarchyRevisions).values({ workspaceId: revision.workspaceId, revision: revision.revision,
        previousHierarchyHash: revision.previousHierarchyHash, hierarchyHash: revision.hierarchy.hierarchyHash,
        idempotencyKey: revision.idempotencyKey, lifecycleState: "draft", createdByActorId: input.actorId,
        hierarchyPayload: revision.hierarchy as unknown as Record<string, unknown>, effectiveFrom: new Date(starts[0]!), effectiveTo: new Date(ends.at(-1)!) });
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${revision.workspaceId}`}, 0))`);
      const previousHash = rows<{ event_hash: string }>(await transaction.execute(sql`select event_hash from audit_events where workspace_id=${revision.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS";
      const event = { id: randomUUID(), workspaceId: revision.workspaceId, actorId: input.actorId, action: "budget_pool.hierarchy_drafted", resourceType: "budget_pool_hierarchy", resourceId: revision.hierarchy.hierarchyHash, occurredAt: starts[0]!, previousHash };
      const eventHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
      await transaction.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id, metadata, previous_hash, event_hash, occurred_at)
        values (${event.id}::uuid, ${event.workspaceId}::uuid, ${event.actorId}::uuid, ${event.action}, ${event.resourceType}, ${event.resourceId},
          ${JSON.stringify({ revision: revision.revision, recommendationOnly: true })}::jsonb, ${event.previousHash}, ${eventHash}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ outcome: "inserted" as const, auditAppended: true });
    });
  }
}
