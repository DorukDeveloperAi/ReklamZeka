import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { projectMetaDataHealthObservationEvents, type MetaDataHealthObservationHead, type MetaDataHealthObservationSink } from "@/domain/meta/data-health-observation-lifecycle";
import { META_DATA_HEALTH_MAX_PROJECTED_EVENTS, META_DATA_HEALTH_MAX_RETAINED_FINDING_HEADS, type MetaDataHealthReport } from "@/domain/meta/data-health";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type LedgerDatabase = Pick<Database, "execute" | "transaction">;
/**
 * A transaction-bound executor supplied by a trusted server caller.  This is
 * deliberately capability-shaped: callers can join an existing unit of work,
 * but cannot alter the repository's SQL contract or disable its locks/CAS.
 */
export type DataHealthLedgerExecutionContext = Executor;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Current reports cap at 1,501, retained distinct state fingerprints at 4,751,
// and a lifecycle projection at their exact sum: 6,252 events.
const HASH = /^[a-f0-9]{64}$/; const HEAD_LIMIT = META_DATA_HEALTH_MAX_RETAINED_FINDING_HEADS; const EVENT_LIMIT = META_DATA_HEALTH_MAX_PROJECTED_EVENTS; const ZERO = "0".repeat(64);
export class DataHealthFindingLedgerRepositoryError extends Error { constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "corrupt_store" | "bound_exceeded" | "write_conflict") { super(`Data health finding ledger rejected: ${code}`); this.name = "DataHealthFindingLedgerRepositoryError"; } }
function fail(code: DataHealthFindingLedgerRepositoryError["code"]): never { throw new DataHealthFindingLedgerRepositoryError(code); }
function rows<T>(v: unknown): readonly T[] { if (!v || typeof v !== "object" || !("rows" in v) || !Array.isArray(v.rows)) fail("corrupt_store"); return v.rows as readonly T[]; }
function stable(v: unknown): unknown { if (Array.isArray(v)) return v.map(stable); if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])); return v; }
function digest(v: unknown): string { return createHash("sha256").update(JSON.stringify(stable(v))).digest("hex"); }
function workspaceRef(id: string): string { return `workspace_${createHash("sha256").update(id).digest("hex").slice(0, 24)}`; }
function instant(v: string) { return Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v; }
type FindingHead = { scope_ref: string; fingerprint: string; sequence: number | string; state: "open" | "resolved"; evidence_hash: string; event_hash: string };
type LogHead = { fingerprint: string; sequence: number | string; state: string; event_hash: string; latest_event_id: string };

/** Current report scopes are the only historical heads eligible for resolution. */
export function eligibleDataHealthScopeRefs(report: MetaDataHealthReport, reference: string): readonly string[] {
  const scopes = [reference, ...report.accounts.map(account => account.accountRef)];
  if (!/^(workspace)_[a-f0-9]{24}$/.test(reference) || new Set(scopes).size !== scopes.length
    || scopes.some(scope => !/^(workspace|account)_[a-f0-9]{24}$/.test(scope))) fail("invalid_input");
  return Object.freeze(scopes);
}

/** Server-only ledger adapter. It obtains the transaction lock before validating report/occurrence/head state. */
export class DrizzleDataHealthFindingDevelopmentLogRepository implements MetaDataHealthObservationSink {
  constructor(private readonly database: LedgerDatabase) {}
  private atomic<T>(context: DataHealthLedgerExecutionContext | undefined, work: (executor: Executor) => Promise<T>): Promise<T> {
    return context ? work(context) : this.database.transaction(transaction => work(transaction as Executor));
  }
  async append(input: Readonly<{ workspaceId: string; events: ReturnType<typeof projectMetaDataHealthObservationEvents>; reportHash?: string }>, context?: DataHealthLedgerExecutionContext) {
    if (!UUID.test(input.workspaceId) || !Array.isArray(input.events) || input.events.length > EVENT_LIMIT || (input.reportHash && !HASH.test(input.reportHash))) fail("invalid_input");
    if (!input.events.length) return Object.freeze({ outcome: "unchanged" as const, eventHashes: Object.freeze([]) });
    const ref = workspaceRef(input.workspaceId);
    if (input.events.some(e => e.workspaceRef !== ref || !/^data_quality_[a-f0-9]{32}$/.test(e.fingerprint) || !HASH.test(e.evidenceHash) || !HASH.test(e.previousEventHash) || !HASH.test(e.eventHash) || !instant(e.occurredAt) || !Number.isSafeInteger(e.sequence) || e.sequence < 1 || (e.observation !== null && new TextEncoder().encode(JSON.stringify(e.observation)).byteLength > 16878) || !["opened","observed","resolved","reopened"].includes(e.event) || !["open","resolved"].includes(e.state) || digest({ version:e.version,workspaceRef:e.workspaceRef,fingerprint:e.fingerprint,sequence:e.sequence,event:e.event,state:e.state,evidenceHash:e.evidenceHash,previousEventHash:e.previousEventHash,occurredAt:e.occurredAt,observation:e.observation,developmentLog:e.developmentLog }) !== e.eventHash)) fail("workspace_scope_mismatch");
    return this.atomic(context, tx => this.persist(tx, input.workspaceId, ref, input.events, input.reportHash ?? digest(input.events.map(e => e.eventHash))));
  }
  async materialize(input: Readonly<{ workspaceId: string; report: MetaDataHealthReport; occurredAt: string; resolveAbsent?: boolean }>, context?: DataHealthLedgerExecutionContext) {
    if (!UUID.test(input.workspaceId) || !instant(input.occurredAt) || !HASH.test(input.report.reportHash)
      || (input.resolveAbsent !== undefined && typeof input.resolveAbsent !== "boolean")) fail("invalid_input");
    const ref = workspaceRef(input.workspaceId); if (input.report.workspaceRef !== ref) fail("workspace_scope_mismatch");
    return this.atomic(context, async exec => {
      await exec.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`data-health-ledger:${input.workspaceId}:${ref}`}, 0))`);
      const activeWorkspace = rows<{ id: string }>(await exec.execute(sql`select id from workspaces where id=${input.workspaceId}::uuid and lifecycle_state='active' for key share limit 2`));
      if (activeWorkspace.length !== 1) fail("workspace_scope_mismatch");
      // A report hash is an occurrence identity, not merely event metadata.  Check
      // it before deriving from the current heads: a second identical run would
      // otherwise turn the original `opened` projection into an `observed` one.
      const alreadyMaterialized = rows<{ event_hash: string }>(await exec.execute(sql`select event_hash from finding_lifecycle_events where workspace_id=${input.workspaceId}::uuid and namespace='meta_data_health' and resolution_scope=${ref} and report_hash=${input.report.reportHash} order by event_hash limit ${EVENT_LIMIT + 1}`));
      if (alreadyMaterialized.length > EVENT_LIMIT) fail("bound_exceeded");
      if (alreadyMaterialized.length) return Object.freeze({ outcome: "unchanged" as const, eventHashes: Object.freeze(alreadyMaterialized.map(row => row.event_hash)) });
      // Canonical report validation occurs after the lock and before any projection/write.
      // Retained heads from absent historical accounts stay immutable in the
      // ledger. Only the workspace finding plus current report account scopes
      // can participate in this materialization (and therefore be resolved).
      const eligibleScopeRefs = eligibleDataHealthScopeRefs(input.report, ref);
      const eligibleValues = sql.join(eligibleScopeRefs.map(scope => sql`${scope}`), sql`, `);
      const allStored = rows<FindingHead>(await exec.execute(sql`select scope_ref,fingerprint,sequence,state,evidence_hash,event_hash from finding_heads where workspace_id=${input.workspaceId}::uuid and namespace='meta_data_health' and resolution_scope=${ref} and scope_ref in (${eligibleValues}) order by fingerprint limit ${HEAD_LIMIT + 1}`));
      const stored = input.resolveAbsent === false
        ? allStored.filter(head => input.report.observations.some(observation => observation.fingerprint === head.fingerprint))
        : allStored;
      if (allStored.length > HEAD_LIMIT || stored.length > HEAD_LIMIT) fail("bound_exceeded");
      const previousHeads: MetaDataHealthObservationHead[] = stored.map(h => {
        const sequence = Number(h.sequence); if (!Number.isSafeInteger(sequence) || sequence < 1 || !HASH.test(h.evidence_hash) || !HASH.test(h.event_hash)) fail("corrupt_store");
        if (!/^(workspace|account)_[a-f0-9]{24}$/.test(h.scope_ref)) fail("corrupt_store");
        return { workspaceRef: ref, fingerprint: h.fingerprint, sequence, state: h.state, evidenceHash: h.evidence_hash, eventHash: h.event_hash };
      });
      const events = projectMetaDataHealthObservationEvents({ workspaceRef: ref, report: input.report, previousHeads, occurredAt: input.occurredAt });
      if (events.length > EVENT_LIMIT) fail("bound_exceeded");
      if (!events.length) return Object.freeze({ outcome: "unchanged" as const, eventHashes: Object.freeze([]) });
      return this.persist(exec, input.workspaceId, ref, events, input.report.reportHash, true);
    });
  }
  /** User-only triage. Observations never call this path, so they retain the current triage state. */
  async triage(input: Readonly<{ workspaceId: string; userId: string; namespace: string; resolutionScope: string; fingerprint: string; state: "triaged" | "tasked" | "deferred" | "rejected" | "closed"; occurredAt: string; payload: Record<string, unknown> }>, context?: DataHealthLedgerExecutionContext) {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.userId) || !instant(input.occurredAt) || !/^[a-z][a-z0-9_.:-]{0,63}$/.test(input.namespace) || !input.resolutionScope || input.resolutionScope.length > 256 || !/^[a-z][a-z0-9_.:-]{0,127}$/.test(input.fingerprint) || JSON.stringify(input.payload).length > 16384) fail("invalid_input");
    return this.atomic(context, async exec => {
      const activeWorkspace = rows<{ id: string }>(await exec.execute(sql`select id from workspaces where id=${input.workspaceId}::uuid and lifecycle_state='active' for key share limit 2`));
      if (activeWorkspace.length !== 1) fail("workspace_scope_mismatch");
      await exec.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`development-log:${input.workspaceId}:${input.namespace}:${input.resolutionScope}:${input.fingerprint}`}, 0))`);
      const h = rows<LogHead & { finding_event_hash: string }>(await exec.execute(sql`select h.fingerprint,h.sequence,h.state,h.event_hash,h.latest_event_id,e.finding_event_hash from development_log_heads h join development_log_events e on e.workspace_id=h.workspace_id and e.id=h.latest_event_id where h.workspace_id=${input.workspaceId}::uuid and h.namespace=${input.namespace} and h.resolution_scope=${input.resolutionScope} and h.fingerprint=${input.fingerprint} for update limit 2`));
      if (h.length !== 1) fail("corrupt_store"); const head=h[0]!; const sequence=Number(head.sequence)+1; const source=digest({ version:"development-log-user-triage/1", previous:head.event_hash, state:input.state, occurredAt:input.occurredAt, payload:input.payload }); const eventHash=digest({ version:"development-log-event/2", namespace:input.namespace,resolutionScope:input.resolutionScope,fingerprint:input.fingerprint,sequence,findingEventHash:head.finding_event_hash,sourceOccurrenceHash:source,category:"data",state:input.state,eventType:input.state,actorKind:"tenant_member",actorUserId:input.userId,previousEventHash:head.event_hash,occurredAt:input.occurredAt,payload:input.payload });
      const inserted=rows<{id:string}>(await exec.execute(sql`insert into development_log_events(workspace_id,namespace,resolution_scope,fingerprint,sequence,finding_event_hash,source_occurrence_hash,category,state,event_type,actor_kind,actor_user_id,previous_event_hash,event_hash,occurred_at,payload) values(${input.workspaceId}::uuid,${input.namespace},${input.resolutionScope},${input.fingerprint},${sequence},${head.finding_event_hash},${source},'data',${input.state},${input.state},'tenant_member',${input.userId}::uuid,${head.event_hash},${eventHash},${input.occurredAt}::timestamptz,${JSON.stringify(input.payload)}::jsonb) returning id`));
      const advanced=rows<{id:string}>(await exec.execute(sql`update development_log_heads set sequence=${sequence},state=${input.state},event_hash=${eventHash},latest_event_id=${inserted[0]!.id}::uuid,updated_at=${input.occurredAt}::timestamptz where workspace_id=${input.workspaceId}::uuid and namespace=${input.namespace} and resolution_scope=${input.resolutionScope} and fingerprint=${input.fingerprint} and event_hash=${head.event_hash} returning id`)); if(advanced.length!==1) fail("write_conflict");
      return Object.freeze({ eventHash, sequence });
    });
  }
  private async persist(tx: Executor, workspaceId: string, ref: string, events: ReturnType<typeof projectMetaDataHealthObservationEvents>, reportHash: string, locked = false) {
    if (!locked) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`data-health-ledger:${workspaceId}:${ref}`}, 0))`);
    const activeWorkspace = rows<{ id: string }>(await tx.execute(sql`select id from workspaces where id=${workspaceId}::uuid and lifecycle_state='active' for key share limit 2`));
    if (activeWorkspace.length !== 1) fail("workspace_scope_mismatch");
    const occurrence = events.map(e => digest({ version: "finding-occurrence/1", namespace: "meta_data_health", resolutionScope: ref, fingerprint: e.fingerprint, reportHash }));
    // Deliberate bound + scalar placeholders: no driver-specific ANY(array)
    // coercion and no untrusted SQL construction.
    const occurrenceValues = sql.join(occurrence.map(value => sql`${value}`), sql`, `);
    const existing = rows<{ source_occurrence_hash: string; event_hash: string }>(await tx.execute(sql`select source_occurrence_hash,event_hash from finding_lifecycle_events where workspace_id=${workspaceId}::uuid and source_occurrence_hash in (${occurrenceValues}) limit ${EVENT_LIMIT + 1}`));
    if (existing.length > EVENT_LIMIT) fail("bound_exceeded"); const replay = new Map(existing.map(x => [x.source_occurrence_hash, x.event_hash]));
    for (let i=0; i<events.length; i++) {
      const event = events[i]!; const source = occurrence[i]!;
      if (replay.has(source)) { if (replay.get(source) !== event.eventHash) fail("corrupt_store"); continue; }
      // Exact expected predecessor prevents stale projection from winning even if a caller bypasses the advisory lock.
      const heads = rows<FindingHead>(await tx.execute(sql`select scope_ref,fingerprint,sequence,state,evidence_hash,event_hash from finding_heads where workspace_id=${workspaceId}::uuid and namespace='meta_data_health' and resolution_scope=${ref} and fingerprint=${event.fingerprint} for update limit 2`));
      if (heads.length > 1) fail("corrupt_store"); const head = heads[0];
      if ((head?.event_hash ?? ZERO) !== event.previousEventHash || (Number(head?.sequence ?? 0) + 1) !== event.sequence) fail("write_conflict");
      const scopeRef = event.observation?.accountRef ?? head?.scope_ref ?? ref;
      if (!/^(workspace|account)_[a-f0-9]{24}$/.test(scopeRef)) fail("corrupt_store");
      await tx.execute(sql`insert into finding_lifecycle_events(workspace_id,namespace,resolution_scope,scope_ref,fingerprint,sequence,event_type,state,evidence_hash,previous_event_hash,event_hash,source_occurrence_hash,report_hash,occurred_at,observation_payload) values(${workspaceId}::uuid,'meta_data_health',${ref},${scopeRef},${event.fingerprint},${event.sequence},${event.event},${event.state},${event.evidenceHash},${event.previousEventHash},${event.eventHash},${source},${reportHash},${event.occurredAt}::timestamptz,${event.observation === null ? null : JSON.stringify(event.observation)}::jsonb)`);
      // Do not use INSERT .. ON CONFLICT for guarded append-only heads: PostgreSQL
      // runs the BEFORE INSERT trigger before conflict resolution, so it would
      // see a non-genesis update as an invalid genesis insert.
      const advancedFinding = head
        ? rows<{ id: string }>(await tx.execute(sql`update finding_heads set sequence=${event.sequence},state=${event.state},evidence_hash=${event.evidenceHash},event_hash=${event.eventHash},updated_at=${event.occurredAt}::timestamptz where workspace_id=${workspaceId}::uuid and namespace='meta_data_health' and resolution_scope=${ref} and scope_ref=${scopeRef} and fingerprint=${event.fingerprint} and event_hash=${event.previousEventHash} returning id`))
        : rows<{ id: string }>(await tx.execute(sql`insert into finding_heads(workspace_id,namespace,resolution_scope,scope_ref,fingerprint,sequence,state,evidence_hash,event_hash,updated_at) values(${workspaceId}::uuid,'meta_data_health',${ref},${scopeRef},${event.fingerprint},${event.sequence},${event.state},${event.evidenceHash},${event.eventHash},${event.occurredAt}::timestamptz) returning id`));
      if (advancedFinding.length !== 1) fail("write_conflict");
      const logSource = digest({ version: "development-log-occurrence/1", source, findingEventHash: event.eventHash });
      const logHeads = rows<LogHead>(await tx.execute(sql`select fingerprint,sequence,state,event_hash,latest_event_id from development_log_heads where workspace_id=${workspaceId}::uuid and namespace='meta_data_health' and resolution_scope=${ref} and fingerprint=${event.fingerprint} for update limit 2`));
      if (logHeads.length > 1) fail("corrupt_store"); const logHead = logHeads[0];
      const logSequence = Number(logHead?.sequence ?? 0)+1; const logPrevious = logHead?.event_hash ?? ZERO;
      const logState = logHead?.state ?? "proposed";
      const logEventType = logHead ? "observed" : "proposed";
      const logPayload = { version: "development-log/observation/2.0.0", findingEventHash: event.eventHash, reportHash, preservesTriageState: Boolean(logHead), authority: { canTriage: false, canClose: false, canCreateTask: false } };
      const logHash = digest({ version: "development-log-event/2", namespace: "meta_data_health", resolutionScope: ref, fingerprint: event.fingerprint, sequence: logSequence, findingEventHash: event.eventHash, sourceOccurrenceHash: logSource, category: "data", state: logState, eventType: logEventType, actorKind: "system", previousEventHash: logPrevious, occurredAt: event.occurredAt, payload: logPayload });
      const inserted = rows<{ id: string }>(await tx.execute(sql`insert into development_log_events(workspace_id,namespace,resolution_scope,fingerprint,sequence,finding_event_hash,source_occurrence_hash,category,state,event_type,actor_kind,actor_user_id,previous_event_hash,event_hash,occurred_at,payload) values(${workspaceId}::uuid,'meta_data_health',${ref},${event.fingerprint},${logSequence},${event.eventHash},${logSource},'data',${logState},${logEventType},'system',null,${logPrevious},${logHash},${event.occurredAt}::timestamptz,${JSON.stringify(logPayload)}::jsonb) on conflict (workspace_id,source_occurrence_hash) do nothing returning id`));
      if (!inserted[0]) continue;
      const advancedLog = logHead
        ? rows<{ id: string }>(await tx.execute(sql`update development_log_heads set sequence=${logSequence},state=${logState},event_hash=${logHash},latest_event_id=${inserted[0].id}::uuid,updated_at=${event.occurredAt}::timestamptz where workspace_id=${workspaceId}::uuid and namespace='meta_data_health' and resolution_scope=${ref} and fingerprint=${event.fingerprint} and event_hash=${logPrevious} returning id`))
        : rows<{ id: string }>(await tx.execute(sql`insert into development_log_heads(workspace_id,namespace,resolution_scope,fingerprint,sequence,state,event_hash,latest_event_id,updated_at) values(${workspaceId}::uuid,'meta_data_health',${ref},${event.fingerprint},${logSequence},${logState},${logHash},${inserted[0].id}::uuid,${event.occurredAt}::timestamptz) returning id`));
      if (advancedLog.length !== 1) fail("write_conflict");
    }
    return Object.freeze({ outcome: existing.length === events.length ? "unchanged" as const : "inserted" as const, eventHashes: Object.freeze(events.map(e => e.eventHash)) });
  }
}
