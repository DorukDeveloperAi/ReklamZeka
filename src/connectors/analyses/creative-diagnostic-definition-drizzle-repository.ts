import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  createCreativeDiagnosticDefinition,
  type CreativeDiagnosticDefinition,
} from "@/analyses/creative-diagnostic-definition";
import { advanceCreativeDiagnosticDefinition } from "@/analyses/creative-diagnostic-definition-lifecycle";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;

export class CreativeDiagnosticDefinitionRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "corrupt_store") {
    super(`Creative diagnostic definition rejected: ${code}`);
    this.name = "CreativeDiagnosticDefinitionRepositoryError";
  }
}

function fail(code: CreativeDiagnosticDefinitionRepositoryError["code"]): never {
  throw new CreativeDiagnosticDefinitionRepositoryError(code);
}
function rows<T extends Row = Row>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}
function opaqueRef(value: unknown): string {
  if (typeof value !== "string" || !OPAQUE_REF.test(value)) fail("invalid_input");
  return value;
}
function reconstruct(row: Readonly<{ revision: unknown; definition_hash: unknown; previous_hash: unknown; state: unknown; definition_payload: unknown }>): CreativeDiagnosticDefinition {
  if (!row.definition_payload || typeof row.definition_payload !== "object" || Array.isArray(row.definition_payload)
    || typeof row.revision !== "number" || typeof row.definition_hash !== "string"
    || (row.previous_hash !== null && typeof row.previous_hash !== "string") || typeof row.state !== "string") fail("corrupt_store");
  const payload = row.definition_payload as Record<string, unknown>;
  let definition: CreativeDiagnosticDefinition;
  try {
    definition = createCreativeDiagnosticDefinition({
      definitionRef: payload.definitionRef as string,
      revision: payload.revision as number,
      previousHash: payload.previousHash as string | null,
      state: payload.state as "draft" | "published" | "retired",
      minimumImpressions: payload.minimumImpressions as number,
      minimumFrequencyIncreaseFraction: payload.minimumFrequencyIncreaseFraction as number,
      minimumCtrDeclineFraction: payload.minimumCtrDeclineFraction as number,
      maximumCoverageGapDays: payload.maximumCoverageGapDays as number,
    });
  } catch { fail("corrupt_store"); }
  if (definition.revision !== row.revision || definition.definitionHash !== row.definition_hash
    || definition.previousHash !== row.previous_hash || definition.state !== row.state
    || JSON.stringify(stable(payload)) !== JSON.stringify(stable(definition))) fail("corrupt_store");
  return definition;
}

export type PrivateCreativeDiagnosticDefinitionCommand = Readonly<{
  definition: Omit<CreativeDiagnosticDefinition, "contractVersion" | "definitionHash">;
}>;

/**
 * Server-private append-only threshold-definition writer. It has no route,
 * action transport, Meta write, approval, or publish capability.
 */
export class DrizzleCreativeDiagnosticDefinitionRepository {
  constructor(private readonly database: Database) {}

  /** Reads one exact latest published revision; it never falls back to an older threshold set. */
  async loadCurrentPublished(input: Readonly<{ workspaceId: string; definitionRef: string }>): Promise<CreativeDiagnosticDefinition> {
    return this.loadCurrentPublishedInTransaction(this.database, input);
  }

  /** Caller-owned transaction variant for immutable diagnostic asset materialization. */
  async loadCurrentPublishedInTransaction(executor: Pick<Database, "execute">, input: Readonly<{ workspaceId: string; definitionRef: string }>): Promise<CreativeDiagnosticDefinition> {
    if (!UUID.test(input.workspaceId)) fail("invalid_input");
    let definitionRef: string;
    try { definitionRef = opaqueRef(input.definitionRef); } catch { fail("invalid_input"); }
    const found = rows<{ revision: unknown; definition_hash: unknown; previous_hash: unknown; state: unknown; definition_payload: unknown }>(await executor.execute(sql`
      select revision, definition_hash, previous_hash, state, definition_payload
      from creative_diagnostic_definition_revisions
      where workspace_id = ${input.workspaceId}::uuid and definition_ref = ${definitionRef}
      order by revision desc limit 1`));
    if (found.length === 0) fail("not_found");
    const definition = reconstruct(found[0]!);
    if (definition.state !== "published") fail("not_found");
    return definition;
  }

  async append(input: Readonly<{
    workspaceId: string;
    actorId: string;
    actorRef: string;
    role: "owner" | "admin";
    occurredAt: string;
    command: PrivateCreativeDiagnosticDefinitionCommand;
  }>): Promise<Readonly<{ definition: CreativeDiagnosticDefinition; replayed: boolean; capabilities: Readonly<{
    canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false; canAccessNetwork: false;
  }> }>> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !["owner", "admin"].includes(input.role)) fail("invalid_input");
    opaqueRef(input.actorRef); const occurredAt = iso(input.occurredAt);
    let supplied: CreativeDiagnosticDefinition;
    try { supplied = createCreativeDiagnosticDefinition(input.command.definition); } catch { fail("invalid_input"); }

    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid
        and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const memberships = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships
        where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid for update`));
      if (memberships.length !== 1 || memberships[0]!.role !== input.role) fail("forbidden");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`creative-diagnostic-definition:${input.workspaceId}:${supplied.definitionRef}`}, 0))`);

      const priorRows = rows<{ revision: unknown; definition_hash: unknown; previous_hash: unknown; state: unknown; definition_payload: unknown }>(await tx.execute(sql`
        select revision, definition_hash, previous_hash, state, definition_payload
        from creative_diagnostic_definition_revisions
        where workspace_id = ${input.workspaceId}::uuid and definition_ref = ${supplied.definitionRef}
        order by revision desc limit 2 for update`));
      if (priorRows.length > 2) fail("corrupt_store");
      const previous = priorRows[0] ? reconstruct(priorRows[0]) : null;
      const predecessor = priorRows[1] ? reconstruct(priorRows[1]) : null;
      if (previous && predecessor && (previous.revision !== predecessor.revision + 1
        || previous.previousHash !== predecessor.definitionHash)) fail("corrupt_store");

      if (previous && JSON.stringify(stable(previous)) === JSON.stringify(stable(supplied))) {
        return Object.freeze({ definition: previous, replayed: true, capabilities: Object.freeze({
          canPublish: false as const, canApprove: false as const, canExecute: false as const,
          canWriteMeta: false as const, canAccessNetwork: false as const,
        }) });
      }
      let definition: CreativeDiagnosticDefinition;
      try { definition = advanceCreativeDiagnosticDefinition({ previous, next: input.command.definition }); }
      catch { fail("conflict"); }

      await tx.execute(sql`insert into creative_diagnostic_definition_revisions
        (id, workspace_id, definition_ref, revision, definition_hash, previous_hash, state, definition_payload)
        values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${definition.definitionRef}, ${definition.revision},
          ${definition.definitionHash}, ${definition.previousHash}, ${definition.state}, ${JSON.stringify(definition)}::jsonb)`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousAuditHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events
        where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const event = Object.freeze({ id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId,
        action: "creative_diagnostic_definition.append", resourceType: "creative_diagnostic_definition",
        resourceId: definition.definitionRef, metadata: Object.freeze({ revision: definition.revision,
          definitionHash: definition.definitionHash, state: definition.state, actorRef: input.actorRef }),
        previousHash: previousAuditHash, occurredAt });
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
        metadata, previous_hash, event_hash, occurred_at) values (${event.id}::uuid, ${event.workspaceId}::uuid,
        ${event.actorId}::uuid, ${event.action}, ${event.resourceType}, ${event.resourceId}, ${JSON.stringify(event.metadata)}::jsonb,
        ${event.previousHash}, ${digest(event)}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ definition, replayed: false, capabilities: Object.freeze({
        canPublish: false as const, canApprove: false as const, canExecute: false as const,
        canWriteMeta: false as const, canAccessNetwork: false as const,
      }) });
    });
  }
}
