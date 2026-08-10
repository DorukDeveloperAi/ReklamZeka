import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { evaluateExperiment, validateExperimentPlan, type ExperimentPlan } from "@/domain/decisions/cadence";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

export class ExperimentRecordRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "corrupt_store") {
    super(`Experiment record rejected: ${code}`); this.name = "ExperimentRecordRepositoryError";
  }
}
function fail(code: ExperimentRecordRepositoryError["code"]): never { throw new ExperimentRecordRepositoryError(code); }
function rows<T extends Row = Row>(value: unknown): readonly T[] { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store"); return value.rows as readonly T[]; }
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function iso(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input"); return value; }

function experimentRef(plan: ExperimentPlan): string {
  const valid = validateExperimentPlan(plan);
  return evaluateExperiment({ plan: valid, sampleSize: valid.minimumSampleSize, observedWindowHours: valid.minimumWindowHours,
    evidenceScore: valid.minimumEvidenceScore, contaminationRefs: [], guardrailBreaches: [], primaryMetric: { status: "available", effect: valid.desiredDirection === "increase" ? valid.minimumDetectableEffect + 1 : -valid.minimumDetectableEffect - 1 } }).experimentRef;
}

/** Private append-only persistence. It deliberately exposes no HTTP/MCP/action path. */
export class DrizzleExperimentRecordRepository {
  constructor(private readonly database: Database) {}

  async plan(input: Readonly<{ workspaceId: string; actorId: string; actorRef: string; role: "owner" | "admin" | "analyst";
    accountRef: string; campaignRef: string; cadenceProfileRevisionId: string; plan: ExperimentPlan; occurredAt: string }>) {
    const occurredAt = iso(input.occurredAt); if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !UUID.test(input.cadenceProfileRevisionId) || !input.actorRef.trim() || !["owner", "admin", "analyst"].includes(input.role) || !input.accountRef.trim() || !input.campaignRef.trim()) fail("invalid_input");
    let plan: ExperimentPlan; try { plan = validateExperimentPlan(input.plan); } catch { fail("invalid_input"); }
    const planHash = digest(plan); const ref = experimentRef(plan);
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const membership = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid limit 2`));
      if (membership.length !== 1 || membership[0]!.role !== input.role) fail("forbidden");
      const scope = rows<{ account_id: unknown; campaign_id: unknown }>(await tx.execute(sql`select account.id::text as account_id, campaign.id::text as campaign_id from ad_accounts account join ad_campaigns campaign on campaign.workspace_id = account.workspace_id and campaign.ad_account_id = account.id where account.workspace_id = ${input.workspaceId}::uuid and account.external_account_id = ${input.accountRef} and campaign.external_campaign_id = ${input.campaignRef} limit 2 for update`));
      if (scope.length !== 1 || typeof scope[0]!.account_id !== "string" || typeof scope[0]!.campaign_id !== "string") fail(scope.length ? "corrupt_store" : "not_found");
      if (rows(await tx.execute(sql`select id from decision_cadence_profile_revisions where workspace_id = ${input.workspaceId}::uuid and id = ${input.cadenceProfileRevisionId}::uuid and ad_account_id = ${scope[0]!.account_id}::uuid and campaign_id = ${scope[0]!.campaign_id}::uuid limit 2 for update`)).length !== 1) fail("not_found");
      const existing = rows<{ record_hash: unknown }>(await tx.execute(sql`select record_hash from experiment_record_revisions where workspace_id = ${input.workspaceId}::uuid and experiment_ref = ${ref} order by sequence desc limit 2 for update`));
      if (existing.length > 1) fail("corrupt_store"); if (existing[0]) return Object.freeze({ experimentRef: ref, recordHash: String(existing[0]!.record_hash), outcome: "unchanged" as const, capabilities: Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
      const core = { version: "experiment-record/1.0.0", experimentRef: ref, sequence: 1, previousRecordHash: "GENESIS", eventType: "planned", planHash, plan, outcome: null, actor: { ref: input.actorRef, role: input.role }, occurredAt };
      const recordHash = digest(core);
      await tx.execute(sql`insert into experiment_record_revisions (workspace_id, ad_account_id, campaign_id, cadence_profile_revision_id, experiment_ref, sequence, previous_record_hash, record_hash, event_type, plan_hash, plan_payload, outcome_payload, actor_ref, actor_role, occurred_at) values (${input.workspaceId}::uuid, ${scope[0]!.account_id}::uuid, ${scope[0]!.campaign_id}::uuid, ${input.cadenceProfileRevisionId}::uuid, ${ref}, 1, 'GENESIS', ${recordHash}, 'planned', ${planHash}, ${JSON.stringify(plan)}::jsonb, null, ${input.actorRef}, ${input.role}, ${occurredAt}::timestamptz)`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const audit = { workspaceId: input.workspaceId, actorId: input.actorId, action: "experiment_record.planned", resourceType: "experiment_record", resourceId: ref, metadata: { recordHash, planHash }, previousHash, occurredAt };
      await tx.execute(sql`insert into audit_events (workspace_id, actor_id, action, resource_type, resource_id, metadata, previous_hash, event_hash, occurred_at) values (${audit.workspaceId}::uuid, ${audit.actorId}::uuid, ${audit.action}, ${audit.resourceType}, ${audit.resourceId}, ${JSON.stringify(audit.metadata)}::jsonb, ${audit.previousHash}, ${digest(audit)}, ${audit.occurredAt}::timestamptz)`);
      return Object.freeze({ experimentRef: ref, recordHash, outcome: "inserted" as const, capabilities: Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
    });
  }

  async recordOutcome(input: Readonly<{ workspaceId: string; actorId: string; actorRef: string; role: "owner" | "admin" | "analyst";
    experimentRef: string; expectedRecordHash: string; observation: Omit<Parameters<typeof evaluateExperiment>[0], "plan">; occurredAt: string }>) {
    const occurredAt = iso(input.occurredAt); if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !/^experiment_[a-f0-9]{20}$/.test(input.experimentRef) || !HASH.test(input.expectedRecordHash) || !input.actorRef.trim() || !["owner", "admin", "analyst"].includes(input.role)) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const membership = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid limit 2`));
      if (membership.length !== 1 || membership[0]!.role !== input.role) fail("forbidden");
      const head = rows<{ sequence: unknown; record_hash: unknown; plan_hash: unknown; plan_payload: unknown; event_type: unknown; cadence_profile_revision_id: unknown; ad_account_id: unknown; campaign_id: unknown }>(await tx.execute(sql`select sequence, record_hash, plan_hash, plan_payload, event_type, cadence_profile_revision_id::text, ad_account_id::text, campaign_id::text from experiment_record_revisions where workspace_id = ${input.workspaceId}::uuid and experiment_ref = ${input.experimentRef} order by sequence desc limit 2 for update`));
      if (head.length !== 1) fail(head.length ? "corrupt_store" : "not_found");
      const prior = head[0]!; if (prior.record_hash !== input.expectedRecordHash || prior.event_type !== "planned" || typeof prior.plan_payload !== "object" || Array.isArray(prior.plan_payload)) fail("conflict");
      let plan: ExperimentPlan; let outcome: ReturnType<typeof evaluateExperiment>;
      try { plan = validateExperimentPlan(prior.plan_payload as ExperimentPlan); outcome = evaluateExperiment({ ...input.observation, plan }); } catch { fail("invalid_input"); }
      if (outcome.experimentRef !== input.experimentRef || digest(plan) !== prior.plan_hash) fail("corrupt_store");
      const sequence = Number(prior.sequence) + 1; if (!Number.isSafeInteger(sequence)) fail("corrupt_store");
      const core = { version: "experiment-record/1.0.0", experimentRef: input.experimentRef, sequence, previousRecordHash: input.expectedRecordHash, eventType: "outcome_recorded", planHash: prior.plan_hash, plan, outcome, actor: { ref: input.actorRef, role: input.role }, occurredAt };
      const recordHash = digest(core);
      await tx.execute(sql`insert into experiment_record_revisions (workspace_id, ad_account_id, campaign_id, cadence_profile_revision_id, experiment_ref, sequence, previous_record_hash, record_hash, event_type, plan_hash, plan_payload, outcome_payload, actor_ref, actor_role, occurred_at) values (${input.workspaceId}::uuid, ${prior.ad_account_id}::uuid, ${prior.campaign_id}::uuid, ${prior.cadence_profile_revision_id}::uuid, ${input.experimentRef}, ${sequence}, ${input.expectedRecordHash}, ${recordHash}, 'outcome_recorded', ${prior.plan_hash}, ${JSON.stringify(plan)}::jsonb, ${JSON.stringify(outcome)}::jsonb, ${input.actorRef}, ${input.role}, ${occurredAt}::timestamptz)`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const audit = { workspaceId: input.workspaceId, actorId: input.actorId, action: "experiment_record.outcome_recorded", resourceType: "experiment_record", resourceId: input.experimentRef, metadata: { recordHash, status: outcome.status, reason: outcome.reason }, previousHash, occurredAt };
      await tx.execute(sql`insert into audit_events (workspace_id, actor_id, action, resource_type, resource_id, metadata, previous_hash, event_hash, occurred_at) values (${audit.workspaceId}::uuid, ${audit.actorId}::uuid, ${audit.action}, ${audit.resourceType}, ${audit.resourceId}, ${JSON.stringify(audit.metadata)}::jsonb, ${audit.previousHash}, ${digest(audit)}, ${audit.occurredAt}::timestamptz)`);
      return Object.freeze({ experimentRef: input.experimentRef, recordHash, outcome, capabilities: Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
    });
  }
}
