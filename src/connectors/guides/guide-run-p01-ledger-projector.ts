import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DevelopmentLogIntent, FindingObservationIntent } from "@/application/guide-run-orchestration-service";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>; type Exec = Pick<Database, "execute">;
const zero = "0".repeat(64);
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(stable(v))).digest("hex");
const rows = <T>(v: unknown) => (v && typeof v === "object" && "rows" in v && Array.isArray(v.rows) ? v.rows as T[] : (() => { throw new Error("guide run ledger corrupt store"); })());
const HASH = /^[a-f0-9]{64}$/;
const CLOSED = JSON.stringify({ canMutateGuide: false, canApprove: false, canExecute: false, canWriteMeta: false });
const CLOSED_HASH = hash(JSON.parse(CLOSED));
function artifactIntent(value: unknown, kind: "finding_observation" | "development_log_intent"): FindingObservationIntent | DevelopmentLogIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("guide run ledger corrupt artifact");
  const record = value as Record<string, unknown>;
  if (kind === "finding_observation") {
    const keys = ["observationRef", "findingRef", "evidenceHash", "fingerprint", "observationEvidenceHash", "lifecycle", "source", "memberRef", "authority"];
    if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record)) || !HASH.test(String(record.evidenceHash)) || !HASH.test(String(record.observationEvidenceHash)) || !HASH.test(String(record.fingerprint)) || record.lifecycle !== "observed" || !["member", "holistic"].includes(String(record.source)) || hash(record.authority) !== CLOSED_HASH) throw new Error("guide run ledger corrupt artifact");
    return record as unknown as FindingObservationIntent;
  }
  const keys = ["category", "producer", "state", "outcome", "candidateRef", "recommendationRef", "authority"];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record)) || record.category !== "agent_proposed_analysis" || record.producer !== "agent" || record.state !== "proposed" || !["finding", "no_change"].includes(String(record.outcome)) || hash(record.authority) !== CLOSED_HASH) throw new Error("guide run ledger corrupt artifact");
  return record as unknown as DevelopmentLogIntent;
}

/** P05's narrow bridge into the P01 generic ledgers. It never triages, closes, approves, or writes Meta. */
export class DrizzleGuideRunP01LedgerProjector {
  constructor(private readonly database: Pick<Database, "execute" | "transaction">) {}
  /**
   * Only persisted immutable P05 artifacts may enter the P01 bridge. This
   * deliberately has no public "project arbitrary agent output" entry point.
   */
  async projectPersisted(input: Readonly<{ workspaceId: string; runRef: string }>) {
    const found = rows<{ kind: "finding_observation" | "development_log_intent"; payload: unknown; payload_hash: string; authority: unknown; occurred_at: string }>(await this.database.execute(sql`
      select a.kind,a.payload,a.payload_hash,a.authority,a.occurred_at::text
      from guide_runs r join guide_run_artifacts a on a.workspace_id=r.workspace_id and a.run_id=r.id
      join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active'
      where r.workspace_id=${input.workspaceId}::uuid and r.run_ref=${input.runRef}
        and a.kind in ('finding_observation','development_log_intent')
      order by a.occurred_at,a.artifact_ref limit 10002`));
    if (found.length === 0) return Object.freeze([]);
    if (found.length > 10_001) throw new Error("guide run ledger artifact set unavailable");
    for (const row of found) {
      if (!HASH.test(row.payload_hash) || row.payload_hash !== hash(row.payload) || hash(row.authority) !== CLOSED_HASH) throw new Error("guide run ledger corrupt artifact");
    }
    const logs = found.filter((row) => row.kind === "development_log_intent");
    const observations = found.filter((row) => row.kind === "finding_observation");
    // A valid no_change run persists one proposed DevLog intent but no finding.
    // It must not manufacture a P01 finding merely to make projection happen.
    if (logs.length === 1 && observations.length === 0) return Object.freeze([]);
    if (logs.length !== 1 || observations.length < 1) throw new Error("guide run ledger artifact set unavailable");
    const developmentLog = artifactIntent(logs[0]!.payload, "development_log_intent") as DevelopmentLogIntent;
    return Promise.all(observations.map(async (row) => this.projectArtifactBound({ workspaceId: input.workspaceId, runRef: input.runRef, occurredAt: new Date(row.occurred_at).toISOString(), observation: artifactIntent(row.payload, "finding_observation") as FindingObservationIntent, developmentLog })));
  }
  private async projectArtifactBound(input: Readonly<{ workspaceId: string; runRef: string; occurredAt: string; observation: FindingObservationIntent; developmentLog: DevelopmentLogIntent }>) {
    const workspaceRef = `workspace_${createHash("sha256").update(input.workspaceId).digest("hex").slice(0, 24)}`;
    const namespace = "guide_run", scope = input.runRef, fingerprint = input.observation.fingerprint;
    return this.database.transaction(async tx => {
      const exec = tx as Exec; await exec.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`guide-run-ledger:${input.workspaceId}:${scope}:${fingerprint}`},0))`);
      const source = hash({ version: "guide-run-finding-occurrence/1", runRef: input.runRef, observationRef: input.observation.observationRef, evidenceHash: input.observation.evidenceHash });
      // Source occurrence is the replay identity. Check it before deriving a
      // successor from current heads, otherwise a replay looks like a new
      // observation after its own first write advanced the chain.
      const prior = rows<{ event_hash: string }>(await exec.execute(sql`select event_hash from finding_lifecycle_events where workspace_id=${input.workspaceId}::uuid and source_occurrence_hash=${source} limit 2`));
      if (prior.length > 1) throw new Error("guide run ledger corrupt replay");
      if (prior.length) return Object.freeze({ findingEventHash: prior[0]!.event_hash, developmentLogEventHash: null });
      const existing = rows<{ event_hash: string; sequence: number; state: string }>(await exec.execute(sql`select event_hash,sequence,state from finding_heads where workspace_id=${input.workspaceId}::uuid and namespace=${namespace} and resolution_scope=${scope} and fingerprint=${fingerprint} for update limit 2`));
      if (existing.length > 1) throw new Error("guide run ledger corrupt head"); const head = existing[0]; const sequence = Number(head?.sequence ?? 0) + 1;
      const eventHash = hash({ version: "guide-run-finding-event/1", namespace, resolutionScope: scope, scopeRef: workspaceRef, fingerprint, sequence, event: head ? "observed" : "opened", state: "open", evidenceHash: input.observation.evidenceHash, previousEventHash: head?.event_hash ?? zero, occurredAt: input.occurredAt, observation: input.observation });
      {
        await exec.execute(sql`insert into finding_lifecycle_events(workspace_id,namespace,resolution_scope,scope_ref,fingerprint,sequence,event_type,state,evidence_hash,previous_event_hash,event_hash,source_occurrence_hash,report_hash,occurred_at,observation_payload) values(${input.workspaceId}::uuid,${namespace},${scope},${workspaceRef},${fingerprint},${sequence},${head ? "observed" : "opened"},'open',${input.observation.evidenceHash},${head?.event_hash ?? zero},${eventHash},${source},${input.observation.evidenceHash},${input.occurredAt}::timestamptz,${JSON.stringify(input.observation)}::jsonb)`);
        if (head) await exec.execute(sql`update finding_heads set sequence=${sequence},state='open',evidence_hash=${input.observation.evidenceHash},event_hash=${eventHash},updated_at=${input.occurredAt}::timestamptz where workspace_id=${input.workspaceId}::uuid and namespace=${namespace} and resolution_scope=${scope} and fingerprint=${fingerprint} and event_hash=${head.event_hash}`);
        else await exec.execute(sql`insert into finding_heads(workspace_id,namespace,resolution_scope,scope_ref,fingerprint,sequence,state,evidence_hash,event_hash,updated_at) values(${input.workspaceId}::uuid,${namespace},${scope},${workspaceRef},${fingerprint},${sequence},'open',${input.observation.evidenceHash},${eventHash},${input.occurredAt}::timestamptz)`);
      }
      // Agent output is proposed-only. Existing human triage is preserved by an observed event.
      const logs = rows<{ sequence: number; state: string; event_hash: string; latest_event_id: string }>(await exec.execute(sql`select sequence,state,event_hash,latest_event_id::text from development_log_heads where workspace_id=${input.workspaceId}::uuid and namespace=${namespace} and resolution_scope=${scope} and fingerprint=${fingerprint} for update limit 2`));
      const log = logs[0], logSequence = Number(log?.sequence ?? 0) + 1, logSource = hash({ version: "guide-run-devlog-occurrence/1", source, eventHash });
      const actorKind = log ? "system" : "agent";
      const payload = { version: "guide-run-development-log/1.0.0", runRef: input.runRef, intent: input.developmentLog, authority: { canTriage: false, canClose: false, canCreateTask: false } }; const logHash = hash({ version: "development-log-event/2", namespace, resolutionScope: scope, fingerprint, sequence: logSequence, findingEventHash: eventHash, sourceOccurrenceHash: logSource, category: "agent", state: log?.state ?? "proposed", eventType: log ? "observed" : "proposed", actorKind, previousEventHash: log?.event_hash ?? zero, occurredAt: input.occurredAt, payload });
      const inserted = rows<{ id: string }>(await exec.execute(sql`insert into development_log_events(workspace_id,namespace,resolution_scope,fingerprint,sequence,finding_event_hash,source_occurrence_hash,category,state,event_type,actor_kind,actor_user_id,previous_event_hash,event_hash,occurred_at,payload) values(${input.workspaceId}::uuid,${namespace},${scope},${fingerprint},${logSequence},${eventHash},${logSource},'agent',${log?.state ?? "proposed"},${log ? "observed" : "proposed"},${actorKind},null,${log?.event_hash ?? zero},${logHash},${input.occurredAt}::timestamptz,${JSON.stringify(payload)}::jsonb) on conflict(workspace_id,source_occurrence_hash) do nothing returning id`));
      if (inserted.length) { if (log) await exec.execute(sql`update development_log_heads set sequence=${logSequence},state=${log.state},event_hash=${logHash},latest_event_id=${inserted[0]!.id}::uuid,updated_at=${input.occurredAt}::timestamptz where workspace_id=${input.workspaceId}::uuid and namespace=${namespace} and resolution_scope=${scope} and fingerprint=${fingerprint} and event_hash=${log.event_hash}`); else await exec.execute(sql`insert into development_log_heads(workspace_id,namespace,resolution_scope,fingerprint,sequence,state,event_hash,latest_event_id,updated_at) values(${input.workspaceId}::uuid,${namespace},${scope},${fingerprint},${logSequence},'proposed',${logHash},${inserted[0]!.id}::uuid,${input.occurredAt}::timestamptz)`); }
      return Object.freeze({ findingEventHash: eventHash, developmentLogEventHash: logHash });
    });
  }
}
