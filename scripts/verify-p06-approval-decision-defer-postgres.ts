import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { ActionProposalStagingService } from "@/application/action-proposal-staging-service";
import { ApprovalQueueReadService } from "@/application/approval-queue-read-service";
import { DrizzleActionApprovalDecisionRepository } from "@/connectors/actions/action-approval-decision-drizzle-repository";
import { DrizzleActionProposalQueueRepository } from "@/connectors/actions/action-proposal-queue-drizzle-repository";
import { DrizzleApprovalQueueReadRepository } from "@/connectors/actions/approval-queue-drizzle-read-repository";
import * as schema from "@/db/schema";
import { ACTION_APPROVAL_POLICY_VERSION, decideActionUnit } from "@/domain/actions/approval-lifecycle";
import { buildActionPlan, type AutonomyRule } from "@/domain/actions/autonomy-valve";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
const migrationPath = "drizzle/20260818000200_p06_approval_decision_defer.sql";
const migrationSql = readFileSync(migrationPath, "utf8");
const migrationHash = createHash("sha256").update(migrationSql).digest("hex");
const migrationTimestamp = 1_787_011_320_000;
const post = process.env.P06_DEFER_POST_APPROVED === "true";
const workspaceId = randomUUID();
const connectionId = randomUUID();
const sourceId = randomUUID();
const accountId = randomUUID();
const campaignId = randomUUID();
const contextId = randomUUID();
const rollback = Symbol("rollback");
const evidence = {
  mode: post ? "post_applied" : "pre_outer_rollback",
  migrationInstalled: false,
  exactMigrationLedger: false,
  exactConstraints: false,
  realDeferInserted: false,
  exactReplay: false,
  noGrantOrAuthority: false,
  queueProjectionDeferred: false,
  authorizationRejected: false,
  grantRejected: false,
  agentRejected: false,
  createRawRejected: false,
  appendOnly: false,
  journalUnchanged: false,
  zeroResidue: false,
};

const rows = (result: unknown): readonly Record<string, unknown>[] => result && typeof result === "object" &&
  "rows" in result && Array.isArray(result.rows) ? result.rows as readonly Record<string, unknown>[] : [];
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => [key, stable(child)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

const autonomyRule: AutonomyRule = {
  ruleRef: "autonomy_workspace", workspaceRef: "workspace_defer_verifier",
  scope: { level: "workspace", ref: "workspace_defer_verifier" }, mode: "approval_only", state: "published",
  effectiveFrom: "2026-08-18T00:00:00.000Z", expiresAt: null, killSwitch: false, maximumActionsPerRun: null,
};
const action = { kind: "status_change" as const, entity: { level: "campaign" as const, ref: "campaign_defer" },
  fromStatus: "ACTIVE" as const, toStatus: "PAUSED" as const };
const contextHash = "d".repeat(64);
const actionPlan = buildActionPlan(action, {
  workspaceRef: "workspace_defer_verifier", accountGroupRef: null, accountRef: "act_defer",
  internalCategoryRefs: [], campaignRef: "campaign_defer", entity: action.entity,
  evaluatedAt: "2026-08-18T12:00:00.000Z", rules: [autonomyRule], budgetLimits: null,
  protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [],
    changeDisposition: "allowed", policyRefs: [] }, frozenContextHash: contextHash,
});
const proposal = new ActionProposalStagingService({
  version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "policy_defer", revision: 1, autonomyMode: "approval_only",
  requesterRoles: ["operator"], approverRoles: [{ risk: "K2", roles: ["owner"] }],
  grantConsumerRoles: ["owner"], separationOfDutiesRisks: [], maximumProtectionEvidenceAgeSeconds: 3_600,
  maximumProposalLifetimeSeconds: 86_400, maximumGrantLifetimeSeconds: 300,
}).stage({
  plan: { planRef: "plan_defer", revision: 1, planHash: "a".repeat(64) },
  workspaceRef: "workspace_defer_verifier", accountRef: "act_defer",
  requester: { actorRef: "actor_operator", role: "operator" },
  proposedAt: "2026-08-18T12:00:00.000Z", expiresAt: "2026-08-19T12:00:00.000Z",
  units: [{ unitKey: "unit_campaign_defer", plan: { planRef: "plan_defer", revision: 1, planHash: "a".repeat(64) },
    actionPlan, workspaceRef: "workspace_defer_verifier", accountRef: "act_defer", entityRef: "campaign_defer",
    actionType: actionPlan.actionType, risk: actionPlan.risk, actionHash: digest(actionPlan.action), dependencies: [],
    summary: { safety: "public_safe", before: { label: "Önce", value: "Aktif" },
      after: { label: "Sonra", value: "Ertelendi" }, evidence: [{ evidenceRef: "evidence_defer", label: "Doğrulandı" }] } }],
});

const journalBefore = rows(await database.execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations`))[0]?.count;
const ledgerBefore = rows(await database.execute(sql`select count(*)::int as exact_count,
  count(*) filter (where hash=${migrationHash})::int as hash_count,
  count(*) filter (where created_at=${migrationTimestamp})::int as timestamp_count
  from drizzle.__drizzle_migrations where hash=${migrationHash} or created_at=${migrationTimestamp}`))[0];
evidence.exactMigrationLedger = post
  ? ledgerBefore?.exact_count === 1 && ledgerBefore?.hash_count === 1 && ledgerBefore?.timestamp_count === 1
  : ledgerBefore?.exact_count === 0 && ledgerBefore?.hash_count === 0 && ledgerBefore?.timestamp_count === 0;
try {
  await database.transaction(async (transaction) => {
    if (!post) await transaction.execute(sql.raw(migrationSql));
    evidence.migrationInstalled = true;
    const constraints = rows(await transaction.execute(sql`
      select conname, convalidated, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'public.action_approval_decision_events'::regclass
        and conname in ('action_approval_decision_events_identity', 'action_approval_decision_events_approval_shape')
      order by conname
    `));
    const identity = String(constraints.find((row) => row.conname === "action_approval_decision_events_identity")?.definition)
      .replaceAll(/\s+/g, " ");
    const approvalShape = String(constraints.find((row) => row.conname === "action_approval_decision_events_approval_shape")?.definition)
      .replaceAll(/\s+/g, " ");
    evidence.exactConstraints = constraints.length === 2 && constraints.every((row) => row.convalidated === true) &&
      identity.includes("actor_role = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text])") &&
      identity.includes("command_kind = ANY (ARRAY['approve'::text, 'reject'::text, 'defer'::text, 'request_changes'::text])") &&
      approvalShape.includes("command_kind = 'approve'::text") && approvalShape.includes("{authorization,humanPresence}") &&
      approvalShape.includes("{authorization,canExecute}") && approvalShape.includes("command_payload ? 'grantRef'::text") &&
      approvalShape.includes("command_kind = ANY (ARRAY['reject'::text, 'defer'::text, 'request_changes'::text])") &&
      approvalShape.includes("NOT (command_payload ? 'authorization'::text)") &&
      approvalShape.includes("NOT (command_payload ? 'grantRef'::text)");

    await transaction.insert(schema.workspaces).values({ id: workspaceId, name: "P06 defer PRE verifier" });
    await transaction.insert(schema.metaConnections).values({ id: connectionId, workspaceId,
      externalConnectionKey: "p06-defer-verifier", displayName: "Verifier", graphApiVersion: "v23.0",
      fieldCatalogVersion: "verifier-v1" });
    await transaction.insert(schema.dataSources).values({ id: sourceId, workspaceId, metaConnectionId: connectionId,
      platform: "meta_ads", externalAccountId: "act_defer", displayName: "Verifier" });
    await transaction.insert(schema.adAccounts).values({ id: accountId, workspaceId, dataSourceId: sourceId,
      externalAccountId: "act_defer", name: "Verifier", currency: "TRY", timezone: "Europe/Istanbul" });
    await transaction.insert(schema.adCampaigns).values({ id: campaignId, workspaceId, adAccountId: accountId,
      externalCampaignId: "campaign_defer", name: "Verifier" });
    const capturedAt = "2026-08-18T12:00:00.000Z";
    await transaction.insert(schema.effectiveCampaignContexts).values({ id: contextId, workspaceId,
      identityHash: "b".repeat(64), contextHash, schemaVersion: "effective-campaign-context/1.0.0",
      metaConnectionId: connectionId, adAccountId: accountId, campaignId, connectionRef: "p06-defer-verifier",
      accountRef: "act_defer", campaignRef: "campaign_defer", entityType: "campaign", entityRef: "campaign_defer",
      capturedAt: new Date(capturedAt), snapshotRefs: ["snapshot_aaaaaaaaaaaaaaaaaaaa"], contextPayload: {
        workspaceId, schemaVersion: "effective-campaign-context/1.0.0", contextHash, capturedAt,
        identity: { connectionRef: "p06-defer-verifier", accountRef: "act_defer", campaignRef: "campaign_defer",
          entityType: "campaign", entityRef: "campaign_defer" },
        data: { snapshotRefs: ["snapshot_aaaaaaaaaaaaaaaaaaaa"] },
        capabilities: { containsRawL0: false, canAuthorizeAction: false, canExecuteWrite: false },
      } });
    await transaction.insert(schema.effectiveCampaignContextComponents).values({ workspaceId, contextId,
      componentType: "policy_authority", componentRef: "policy_authority_workspace", componentVersion: "a".repeat(64) });

    const queue = new DrizzleActionProposalQueueRepository(transaction as never, workspaceId);
    if ((await queue.appendInitial(proposal)).outcome !== "inserted") throw new Error("defer proposal not inserted");
    const repository = new DrizzleActionApprovalDecisionRepository(transaction as never, workspaceId);
    const snapshot = await repository.loadForDecision({ workspaceId, unitRef: proposal.bundle.units[0]!.unitRef });
    if (!snapshot) throw new Error("defer decision snapshot missing");
    const command = { kind: "defer" as const, commandRef: "decision_defer_verifier",
      unitRef: proposal.bundle.units[0]!.unitRef, actor: { actorRef: "actor_owner", role: "owner" as const },
      decidedAt: "2026-08-18T12:01:00.000Z", reasonCode: "human.deferred", freshness: snapshot.freshness };
    const decided = await repository.decideAtomically({ workspaceId, unitRef: command.unitRef,
      expectedTraceHash: snapshot.lifecycle.traceHash, buildCommand: async () => command });
    evidence.realDeferInserted = decided.outcome === "inserted" &&
      decided.lifecycle.units[0]?.state === "deferred" && decided.executionAuthority === "none" && !decided.executionPerformed;
    const replay = await repository.decideAtomically({ workspaceId, unitRef: command.unitRef,
      expectedTraceHash: decided.traceHash, buildCommand: async () => command });
    evidence.exactReplay = replay.outcome === "unchanged";
    const stored = rows(await transaction.execute(sql`
      select command_payload, execution_authority, execution_performed,
        (select count(*)::int from action_approval_evidence_grants where workspace_id=${workspaceId}::uuid) as grants
      from action_approval_decision_events where workspace_id=${workspaceId}::uuid
    `))[0];
    evidence.noGrantOrAuthority = stored?.execution_authority === "none" && stored?.execution_performed === false &&
      stored?.grants === 0 && !(stored?.command_payload as Record<string, unknown> | undefined)?.authorization &&
      !(stored?.command_payload as Record<string, unknown> | undefined)?.grantRef;
    const read = await new ApprovalQueueReadService(new DrizzleApprovalQueueReadRepository(transaction as never, workspaceId))
      .list({ workspaceId, limit: 10 });
    evidence.queueProjectionDeferred = read.items.length === 1 && read.items[0]?.status === "deferred";

    const storedRow = rows(await transaction.execute(sql`select * from action_approval_decision_events
      where workspace_id=${workspaceId}::uuid`))[0];
    if (!storedRow) throw new Error("stored defer row missing");
    const invalidSameRow = async (extra: Record<string, unknown>) => {
      try {
        await transaction.transaction(async (savepoint) => {
          const payload = { ...(storedRow.command_payload as Record<string, unknown>), ...extra };
          await savepoint.execute(sql`delete from action_approval_decision_events where workspace_id=${workspaceId}::uuid`);
          await savepoint.execute(sql`
            insert into action_approval_decision_events (
              id,workspace_id,bundle_id,unit_id,ordinal,command_ref,command_kind,unit_ref,unit_hash,actor_ref,actor_role,
              decided_at,reason_code,command_hash,freshness_hash,lifecycle_before_hash,lifecycle_after_hash,
              trace_after_hash,command_payload,event_payloads,execution_authority,execution_performed,created_at
            ) values (${storedRow.id}::uuid,${storedRow.workspace_id}::uuid,${storedRow.bundle_id}::uuid,
              ${storedRow.unit_id}::uuid,${storedRow.ordinal as number},${storedRow.command_ref as string},'defer',
              ${storedRow.unit_ref as string},${storedRow.unit_hash as string},${storedRow.actor_ref as string},
              ${storedRow.actor_role as string},${new Date(storedRow.decided_at as string).toISOString()}::timestamptz,
              ${storedRow.reason_code as string},${digest(payload)},${storedRow.freshness_hash as string},
              ${storedRow.lifecycle_before_hash as string},${storedRow.lifecycle_after_hash as string},
              ${storedRow.trace_after_hash as string},${JSON.stringify(payload)}::jsonb,
              ${JSON.stringify(storedRow.event_payloads)}::jsonb,'none',false,${new Date(storedRow.created_at as string).toISOString()}::timestamptz)
          `);
        });
        return false;
      } catch { return true; }
    };
    evidence.authorizationRejected = await invalidSameRow({ authorization: { humanPresence: true, canExecute: false } });
    evidence.grantRejected = await invalidSameRow({ grantRef: "grant_forbidden" });
    try {
      decideActionUnit(snapshot.lifecycle, { ...command, commandRef: "decision_agent_defer",
        actor: { actorRef: "actor_agent", role: "agent" } } as never);
    } catch { evidence.agentRejected = true; }
    evidence.createRawRejected = ["campaign_create", "raw_graph"].every((kind) => {
      try {
        decideActionUnit(snapshot.lifecycle, { ...command, commandRef: `decision_${kind}`, kind } as never);
        return false;
      } catch { return true; }
    });
    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.execute(sql`update action_approval_decision_events set reason_code='tampered'
          where workspace_id=${workspaceId}::uuid`);
      });
    } catch { evidence.appendOnly = true; }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
}

const journalAfter = rows(await database.execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations`))[0]?.count;
evidence.journalUnchanged = journalBefore === journalAfter;
evidence.zeroResidue = rows(await database.execute(sql`
  select count(*)::int as count from workspaces where id=${workspaceId}::uuid
`))[0]?.count === 0 && String(rows(await database.execute(sql`
  select pg_get_constraintdef(oid) as definition from pg_constraint
  where conrelid='public.action_approval_decision_events'::regclass
    and conname='action_approval_decision_events_identity'
`))[0]?.definition).includes("defer") === post;
await pool.end();
if (Object.entries(evidence).some(([key, value]) => key !== "mode" && value !== true)) {
  throw new Error(`p06 defer PRE failed:${JSON.stringify(evidence)}`);
}
console.log(JSON.stringify(evidence));
