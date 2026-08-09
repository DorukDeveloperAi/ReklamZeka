import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  InstructionPolicyLifecycleError,
  lifecycleInvalidationReason,
  lifecycleStatus,
  type InstructionPolicyLifecycleRepository,
  type InstructionPolicyLifecycleState,
  type InstructionPolicyPublicDiff,
  type InstructionPolicyPublicRevision,
} from "@/application/instruction-policy-lifecycle-service";
import { type InstructionPolicyImpactRepository } from "@/application/instruction-policy-impact-service";
import { DrizzleInstructionPolicyImpactRepository } from
  "@/connectors/policies/instruction-policy-impact-drizzle-repository";
import { assertStrictInstructionPolicyArtifact, parseRawInstructionProvenance,
  parseStrictInstructionPolicy, type StrictInstructionPolicy } from "@/domain/policies/instruction-policy-dsl";
import { EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF } from "@/analyses/effective-campaign-context";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type Row = Readonly<{ id: unknown; raw_provenance_id: unknown; workspace_ref: unknown; policy_ref: unknown;
  policy_version: unknown; previous_version_hash: unknown; policy_type: unknown; status: unknown;
  raw_provenance_ref: unknown; raw_text_hash: unknown; canonical_hash: unknown; policy_payload: unknown;
  raw_text: unknown; captured_by_actor_ref: unknown; captured_at: unknown; recorded_at: unknown }>;
type InternalRevision = Readonly<InstructionPolicyPublicRevision & { id: string; rawProvenanceId: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

function rows<T>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new InstructionPolicyLifecycleError("conflict");
  }
  return value.rows as readonly T[];
}

function digest(value: unknown): string {
  const stable = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(stable)
    : entry && typeof entry === "object" ? Object.fromEntries(Object.entries(entry as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)])) : entry;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new InstructionPolicyLifecycleError("conflict");
  return value.toLowerCase();
}

function instant(value: unknown): string {
  if (!(typeof value === "string" || value instanceof Date) || !Number.isFinite(Date.parse(String(value)))) {
    throw new InstructionPolicyLifecycleError("conflict");
  }
  return new Date(value).toISOString();
}

function boundedRawText(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 16_000 || !value.trim() || value.includes("\u0000")) {
    throw new InstructionPolicyLifecycleError("conflict");
  }
  return value;
}

function reference(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(value)) {
    throw new InstructionPolicyLifecycleError("conflict");
  }
  return value;
}

function changedPaths(left: unknown, right: unknown, prefix = ""): string[] {
  if (JSON.stringify(left) === JSON.stringify(right)) return [];
  if (!left || !right || typeof left !== "object" || typeof right !== "object"
    || Array.isArray(left) || Array.isArray(right)) return [prefix || "$policy"];
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.flatMap((key) => changedPaths((left as Record<string, unknown>)[key],
    (right as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key));
}

function project(row: Row): InternalRevision {
  let policy: StrictInstructionPolicy;
  try { policy = assertStrictInstructionPolicyArtifact(row.policy_payload); }
  catch { throw new InstructionPolicyLifecycleError("conflict"); }
  if (policy.workspaceRef !== row.workspace_ref || policy.policyRef !== row.policy_ref
    || policy.policyVersion !== Number(row.policy_version) || policy.previousVersionHash !== row.previous_version_hash
    || policy.policyType !== row.policy_type || policy.status !== row.status
    || policy.source.rawProvenanceRef !== row.raw_provenance_ref || policy.source.rawTextHash !== row.raw_text_hash
    || policy.canonicalHash !== row.canonical_hash) throw new InstructionPolicyLifecycleError("conflict");
  const rawText = boundedRawText(row.raw_text);
  if (createHash("sha256").update(rawText).digest("hex") !== policy.source.rawTextHash) {
    throw new InstructionPolicyLifecycleError("conflict");
  }
  return Object.freeze({ id: uuid(row.id), rawProvenanceId: uuid(row.raw_provenance_id), policy,
    rawProvenance: Object.freeze({ provenanceRef: policy.source.rawProvenanceRef, rawText,
      rawTextHash: policy.source.rawTextHash, capturedByActorRef: reference(row.captured_by_actor_ref),
      capturedAt: instant(row.captured_at) }), recordedAt: instant(row.recorded_at) });
}

async function load(database: Executor, workspaceId: string): Promise<Readonly<{
  state: InstructionPolicyLifecycleState; internal: readonly InternalRevision[] }>> {
  const internal = rows<Row>(await database.execute(sql`
    select revision.id::text, revision.raw_provenance_id::text, revision.workspace_ref,
      revision.policy_ref, revision.policy_version, revision.previous_version_hash,
      revision.policy_type, revision.status, revision.raw_provenance_ref, revision.raw_text_hash,
      revision.canonical_hash, revision.policy_payload, provenance.raw_text,
      provenance.captured_by_actor_ref, provenance.captured_at, revision.recorded_at
    from strict_instruction_policy_revisions revision
    join instruction_policy_raw_provenance provenance on provenance.workspace_id = revision.workspace_id
      and provenance.id = revision.raw_provenance_id
    where revision.workspace_id = ${workspaceId}::uuid
    order by revision.policy_ref, revision.policy_version
  `)).map(project);
  if (internal.length > 20_000) throw new InstructionPolicyLifecycleError("conflict");
  const current = internal.filter((entry, index) => internal.findIndex((candidate) =>
    candidate.policy.policyRef === entry.policy.policyRef && candidate.policy.policyVersion > entry.policy.policyVersion) < 0);
  const registryHash = digest(current.map((entry) => ({ policyRef: entry.policy.policyRef,
    policyVersion: entry.policy.policyVersion, canonicalHash: entry.policy.canonicalHash, status: entry.policy.status })));
  const diffs: InstructionPolicyPublicDiff[] = [];
  for (let index = 1; index < internal.length; index += 1) {
    const before = internal[index - 1]!; const after = internal[index]!;
    if (before.policy.policyRef !== after.policy.policyRef) continue;
    diffs.push(Object.freeze({ policyRef: after.policy.policyRef, fromVersion: before.policy.policyVersion,
      toVersion: after.policy.policyVersion,
      changedPaths: Object.freeze(changedPaths(before.policy, after.policy)
        .filter((path) => path !== "canonicalHash" && !path.startsWith("authority")).sort()) }));
  }
  const publicRevision = (entry: InternalRevision): InstructionPolicyPublicRevision =>
    Object.freeze({ policy: entry.policy, rawProvenance: entry.rawProvenance, recordedAt: entry.recordedAt });
  return Object.freeze({ internal: Object.freeze(internal), state: Object.freeze({ registryHash,
    current: Object.freeze(current.map(publicRevision)), history: Object.freeze(internal.map(publicRevision)),
    diffs: Object.freeze(diffs) }) });
}

function currentFor(entries: readonly InternalRevision[], policyRef: string): InternalRevision | undefined {
  return [...entries].reverse().find((entry) => entry.policy.policyRef === policyRef);
}

function lifecycleArtifact(current: StrictInstructionPolicy, status: "published" | "paused" | "archived",
  reasonCode: string): StrictInstructionPolicy {
  const { authority: _authority, canonicalHash: _hash, ...input } = current;
  return parseStrictInstructionPolicy({ ...input, policyVersion: current.policyVersion + 1,
    previousVersionHash: current.canonicalHash, status, reasonCode });
}

export class DrizzleInstructionPolicyLifecycleRepository implements InstructionPolicyLifecycleRepository {
  constructor(private readonly database: Database,
    private readonly impactRepositoryFactory: (database: Database) => InstructionPolicyImpactRepository =
      (database) => new DrizzleInstructionPolicyImpactRepository(database)) {}

  async inspect(workspaceId: string): Promise<InstructionPolicyLifecycleState> {
    if (!UUID.test(workspaceId)) throw new InstructionPolicyLifecycleError("invalid_input");
    return (await load(this.database, workspaceId)).state;
  }

  async mutate(input: Parameters<InstructionPolicyLifecycleRepository["mutate"]>[0]) {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !Number.isFinite(Date.parse(input.occurredAt))) {
      throw new InstructionPolicyLifecycleError("invalid_input");
    }
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid
        and lifecycle_state = 'active' for update`)).length !== 1) throw new InstructionPolicyLifecycleError("not_found");
      const memberships = rows<{ role: string }>(await tx.execute(sql`select role::text from memberships
        where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid limit 2`));
      if (memberships.length !== 1 || memberships[0]!.role !== input.role
        || !["owner", "admin", "analyst"].includes(memberships[0]!.role)) {
        throw new InstructionPolicyLifecycleError("forbidden");
      }
      const before = await load(tx, input.workspaceId);
      if (before.state.registryHash !== input.command.expectedRegistryHash) {
        throw new InstructionPolicyLifecycleError("conflict");
      }
      const command = input.command;
      let policy: StrictInstructionPolicy;
      let rawProvenanceId: string;
      let recomputedImpact: Awaited<ReturnType<InstructionPolicyImpactRepository["preview"]>> = null;
      if (command.operation === "create_draft" || command.operation === "revise_draft") {
        policy = assertStrictInstructionPolicyArtifact(command.policy);
        const current = currentFor(before.internal, policy.policyRef);
        if (command.operation === "create_draft" ? current !== undefined : !current
          || command.operation === "revise_draft" && (current!.policy.status !== "draft"
            || current!.policy.policyVersion !== command.expectedVersion
            || current!.policy.canonicalHash !== command.expectedPolicyHash
            || current!.policy.source.rawProvenanceRef === policy.source.rawProvenanceRef)) {
          throw new InstructionPolicyLifecycleError(command.operation === "create_draft" ? "conflict" : "invalid_transition");
        }
        const provenance = parseRawInstructionProvenance({ version: "raw-instruction-provenance/1.0.0",
          workspaceRef: input.workspaceRef, provenanceRef: policy.source.rawProvenanceRef,
          capturedAt: input.occurredAt, capturedByRef: input.actorRef, rawText: command.rawText });
        rawProvenanceId = randomUUID();
        await tx.execute(sql`insert into instruction_policy_raw_provenance (
          id, workspace_id, workspace_ref, provenance_ref, raw_text, raw_text_hash, captured_by_actor_ref, captured_at
        ) values (${rawProvenanceId}::uuid, ${input.workspaceId}::uuid, ${input.workspaceRef},
          ${provenance.provenanceRef}, ${provenance.rawText}, ${provenance.rawTextHash},
          ${provenance.capturedByRef}, ${provenance.capturedAt}::timestamptz)`);
      } else {
        const current = currentFor(before.internal, command.policyRef);
        if (!current) throw new InstructionPolicyLifecycleError("not_found");
        if (current.policy.policyVersion !== command.expectedVersion
          || current.policy.canonicalHash !== command.expectedPolicyHash) throw new InstructionPolicyLifecycleError("conflict");
        const nextStatus = lifecycleStatus(command.operation);
        const allowed = command.operation === "publish" ? current.policy.status === "draft" || current.policy.status === "paused"
          : command.operation === "pause" ? current.policy.status === "published" : current.policy.status !== "archived";
        if (!allowed) throw new InstructionPolicyLifecycleError("invalid_transition");
        if (!["owner", "admin"].includes(input.role)) throw new InstructionPolicyLifecycleError("forbidden");
        const impact = await this.impactRepositoryFactory(tx).preview(input.workspaceId, command.policyRef, command.operation);
        if (!impact) throw new InstructionPolicyLifecycleError("not_found");
        if (impact.operation !== command.operation || impact.registryHash !== before.state.registryHash
          || impact.target.policyRef !== command.policyRef || impact.target.policyVersion !== command.expectedVersion
          || impact.target.policyHash !== command.expectedPolicyHash || impact.target.status !== current.policy.status
          || impact.impactHash !== command.expectedImpactHash) {
          throw new InstructionPolicyLifecycleError("conflict");
        }
        const integrityFailed = Object.values(impact.coverage.integrity).some((value) => value !== 0);
        if (!impact.coverage.complete || impact.coverage.partialOrUnknown.length !== 0 || integrityFailed
          || impact.disposition !== "review_required" || !impact.mutationAllowed
          || Object.values(impact.exactBlockers).some((value) => value !== 0)) {
          throw new InstructionPolicyLifecycleError("dependency_blocked");
        }
        recomputedImpact = impact;
        policy = lifecycleArtifact(current.policy, nextStatus, command.reasonCode);
        rawProvenanceId = current.rawProvenanceId;
      }
      await tx.execute(sql`insert into strict_instruction_policy_revisions (
        id, workspace_id, raw_provenance_id, workspace_ref, policy_ref, policy_version, previous_version_hash,
        policy_type, status, raw_provenance_ref, raw_text_hash, actor_ref, actor_role,
        canonical_hash, policy_payload, recorded_at
      ) values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${rawProvenanceId}::uuid, ${policy.workspaceRef},
        ${policy.policyRef}, ${policy.policyVersion}, ${policy.previousVersionHash}, ${policy.policyType}, ${policy.status},
        ${policy.source.rawProvenanceRef}, ${policy.source.rawTextHash}, ${input.actorRef}, ${input.role},
        ${policy.canonicalHash}, ${JSON.stringify(policy)}::jsonb, ${input.occurredAt}::timestamptz)`);

      let contextInvalidationAppended = false;
      const invalidationReasonCode = lifecycleInvalidationReason(command.operation);
      if (command.operation === "publish" || command.operation === "pause" || command.operation === "archive") {
        const invalidation = Object.freeze({ workspaceId: input.workspaceId, componentType: "instruction_policy",
          componentRef: EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF, componentVersion: before.state.registryHash,
          scopeKind: "workspace_component", entityType: null, entityRef: null,
          reasonCode: invalidationReasonCode!,
          observedAt: input.occurredAt });
        const inserted = rows(await tx.execute(sql`insert into effective_campaign_context_invalidations (
          workspace_id, event_hash, component_type, component_ref, component_version,
          scope_kind, entity_type, entity_ref, reason_code, observed_at
        ) values (${input.workspaceId}::uuid, ${digest(invalidation)}, 'instruction_policy',
          ${EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF}, ${before.state.registryHash}, 'workspace_component', null, null,
          ${invalidation.reasonCode}, ${input.occurredAt}::timestamptz)
        on conflict (workspace_id, event_hash) do nothing returning id`));
        contextInvalidationAppended = inserted.length === 1;
      }

      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousHash = String(rows<{ event_hash: string }>(await tx.execute(sql`select event_hash from audit_events
        where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`
      ))[0]?.event_hash ?? "GENESIS");
      const event = Object.freeze({ id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId,
        action: `instruction_policy.${command.operation}`, resourceType: "strict_instruction_policy",
        resourceId: policy.policyRef, occurredAt: input.occurredAt, previousHash,
        metadata: Object.freeze({ role: input.role, policyVersion: policy.policyVersion,
          expectedRegistryHash: command.expectedRegistryHash,
          expectedImpactHash: "expectedImpactHash" in command ? command.expectedImpactHash : null,
          actualImpactHash: recomputedImpact?.impactHash ?? null,
          invalidationPlanContexts: recomputedImpact?.invalidationPlan.contextsNeedingInvalidation ?? 0,
          invalidationEventsAppended: contextInvalidationAppended ? 1 : 0,
          invalidationReasonCode,
          reasonCode: "reasonCode" in command ? command.reasonCode : null, contextInvalidationAppended }) });
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
        metadata, previous_hash, event_hash, occurred_at) values (${event.id}::uuid, ${event.workspaceId}::uuid,
        ${event.actorId}::uuid, ${event.action}, ${event.resourceType}, ${event.resourceId},
        ${JSON.stringify(event.metadata)}::jsonb, ${event.previousHash}, ${digest(event)}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ state: (await load(tx, input.workspaceId)).state, auditAppended: true as const,
        contextInvalidationAppended });
    });
  }
}
