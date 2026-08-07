import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { ActionProposalStagingService } from "@/application/action-proposal-staging-service";
import { DrizzleActionApprovalDecisionRepository } from "@/connectors/actions/action-approval-decision-drizzle-repository";
import { DrizzleActionProposalQueueRepository } from "@/connectors/actions/action-proposal-queue-drizzle-repository";
import * as schema from "@/db/schema";
import { ACTION_APPROVAL_POLICY_VERSION } from "@/domain/actions/approval-lifecycle";
import { buildActionPlan, type AutonomyRule } from "@/domain/actions/autonomy-valve";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const migrationPath = "drizzle/20260807173537_action_proposal_queue.sql";
const decisionMigrationPath = "drizzle/20260807180433_fixed_tarantula.sql";
const rollback = Symbol("rollback");
const workspaceId = randomUUID();
const connectionId = randomUUID();
const sourceId = randomUUID();
const accountId = randomUUID();
const campaignId = randomUUID();
const evidence = { tablesApplied: false, inserted: false, exactReplay: false, immutable: false,
  decisionTablesApplied: false, decisionInserted: false, decisionExactReplay: false,
  decisionImmutable: false, rlsAndGrants: false, exactRows: false, rollbackClean: false,
  metaCalls: 0, executionCalls: 0 };

const rows = (result: unknown): readonly Record<string, unknown>[] => result && typeof result === "object"
  && "rows" in result && Array.isArray(result.rows) ? result.rows as readonly Record<string, unknown>[] : [];
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stable(child)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

async function applyEphemeralMigration(
  transaction: Parameters<Parameters<typeof database.transaction>[0]>[0],
  path: string,
) {
  const source = readFileSync(path, "utf8");
  for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    await transaction.execute(sql.raw(statement));
  }
}

const autonomyRule: AutonomyRule = {
  ruleRef: "autonomy_workspace", workspaceRef: "workspace_verifier",
  scope: { level: "workspace", ref: "workspace_verifier" }, mode: "approval_only", state: "published",
  effectiveFrom: "2026-08-01T00:00:00.000Z", expiresAt: null, killSwitch: false, maximumActionsPerRun: null,
};
const action = { kind: "status_change" as const, entity: { level: "campaign" as const, ref: "campaign_12345" },
  fromStatus: "ACTIVE" as const, toStatus: "PAUSED" as const };
const actionPlan = buildActionPlan(action, {
  workspaceRef: "workspace_verifier", accountGroupRef: null, accountRef: "act_12345",
  internalCategoryRefs: [], campaignRef: "campaign_12345", entity: action.entity,
  evaluatedAt: "2026-08-07T17:00:00.000Z", rules: [autonomyRule], budgetLimits: null,
  protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] },
});
const proposal = new ActionProposalStagingService({
  version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "policy_verifier", revision: 1, autonomyMode: "approval_only",
  requesterRoles: ["operator"], approverRoles: [{ risk: "K2", roles: ["owner"] }],
  grantConsumerRoles: ["owner"], separationOfDutiesRisks: [], maximumProtectionEvidenceAgeSeconds: 3_600,
  maximumProposalLifetimeSeconds: 86_400,
  maximumGrantLifetimeSeconds: 300,
}).stage({
  plan: { planRef: "plan_verifier", revision: 1, planHash: "a".repeat(64) },
  workspaceRef: "workspace_verifier", accountRef: "act_12345",
  requester: { actorRef: "actor_operator", role: "operator" },
  proposedAt: "2026-08-07T18:00:00.000Z", expiresAt: "2026-08-08T18:00:00.000Z",
  units: [{ unitKey: "unit_campaign_pause", plan: { planRef: "plan_verifier", revision: 1, planHash: "a".repeat(64) },
    actionPlan, workspaceRef: "workspace_verifier", accountRef: "act_12345", entityRef: "campaign_12345",
    actionType: actionPlan.actionType, risk: actionPlan.risk, actionHash: digest(actionPlan.action), dependencies: [],
    summary: { safety: "public_safe", before: { label: "Önce", value: "Aktif" },
      after: { label: "Sonra", value: "Duraklatılmış" }, evidence: [{ evidenceRef: "evidence_verified", label: "Doğrulandı" }] } }],
});

try {
  await database.transaction(async (transaction) => {
    let applied = rows(await transaction.execute(sql`
      select to_regclass('public.action_proposal_bundles')::text as bundles,
        to_regclass('public.action_proposal_units')::text as units,
        to_regclass('public.action_proposal_dependencies')::text as dependencies,
        to_regclass('public.action_approval_policy_snapshots')::text as policies,
        to_regclass('public.action_proposal_initial_events')::text as events
    `))[0];
    const present = [applied?.bundles, applied?.units, applied?.dependencies, applied?.policies, applied?.events]
      .filter(Boolean).length;
    if (present === 0) {
      await applyEphemeralMigration(transaction, migrationPath);
      applied = rows(await transaction.execute(sql`
        select to_regclass('public.action_proposal_bundles')::text as bundles,
          to_regclass('public.action_proposal_units')::text as units,
          to_regclass('public.action_proposal_dependencies')::text as dependencies,
          to_regclass('public.action_approval_policy_snapshots')::text as policies,
          to_regclass('public.action_proposal_initial_events')::text as events
      `))[0];
    } else if (present !== 5) {
      throw new Error("Action proposal queue şeması kısmi uygulanmış");
    }
    evidence.tablesApplied = Boolean(applied?.bundles && applied?.units && applied?.dependencies
      && applied?.policies && applied?.events);
    if (!evidence.tablesApplied) throw new Error("Action proposal queue migration doğrulanamadı");
    let decisionTables = rows(await transaction.execute(sql`
      select to_regclass('public.action_approval_decision_events')::text as decisions,
        to_regclass('public.action_approval_evidence_grants')::text as grants
    `))[0];
    const decisionPresent = [decisionTables?.decisions, decisionTables?.grants].filter(Boolean).length;
    if (decisionPresent === 0) {
      await applyEphemeralMigration(transaction, decisionMigrationPath);
      decisionTables = rows(await transaction.execute(sql`
        select to_regclass('public.action_approval_decision_events')::text as decisions,
          to_regclass('public.action_approval_evidence_grants')::text as grants
      `))[0];
    } else if (decisionPresent !== 2) {
      throw new Error("Action approval decision şeması kısmi uygulanmış");
    }
    evidence.decisionTablesApplied = Boolean(decisionTables?.decisions && decisionTables?.grants);
    if (!evidence.decisionTablesApplied) throw new Error("Action approval decision migration doğrulanamadı");
    await transaction.insert(schema.workspaces).values({ id: workspaceId, name: "Action queue verifier" });
    await transaction.insert(schema.metaConnections).values({
      id: connectionId, workspaceId, externalConnectionKey: "action-queue-verifier", displayName: "Verifier",
      graphApiVersion: "v23.0", fieldCatalogVersion: "verifier-v1",
    });
    await transaction.insert(schema.dataSources).values({
      id: sourceId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads",
      externalAccountId: "act_12345", displayName: "Verifier",
    });
    await transaction.insert(schema.adAccounts).values({
      id: accountId, workspaceId, dataSourceId: sourceId, externalAccountId: "act_12345",
      name: "Verifier", currency: "TRY", timezone: "Europe/Istanbul",
    });
    await transaction.insert(schema.adCampaigns).values({
      id: campaignId, workspaceId, adAccountId: accountId, externalCampaignId: "campaign_12345", name: "Verifier",
    });
    const repository = new DrizzleActionProposalQueueRepository(transaction as never, workspaceId);
    evidence.inserted = (await repository.appendInitial(proposal)).outcome === "inserted";
    evidence.exactReplay = (await repository.appendInitial(proposal)).outcome === "unchanged";
    const decisionRepository = new DrizzleActionApprovalDecisionRepository(transaction as never, workspaceId);
    const snapshot = await decisionRepository.loadForDecision({ workspaceId, unitRef: proposal.bundle.units[0]!.unitRef });
    if (!snapshot) throw new Error("Decision snapshot bulunamadı");
    const command = {
      kind: "approve" as const,
      commandRef: "decision_verifier",
      unitRef: proposal.bundle.units[0]!.unitRef,
      actor: { actorRef: "actor_owner", role: "owner" as const },
      decidedAt: "2026-08-07T18:01:00.000Z",
      reasonCode: "approved_after_review",
      freshness: snapshot.freshness,
      authorization: {
        authorizationRef: "presence_verifier", unitRef: proposal.bundle.units[0]!.unitRef,
        unitHash: proposal.bundle.units[0]!.unitHash, scopeHash: proposal.bundle.units[0]!.scopeHash,
        actor: { actorRef: "actor_owner", role: "owner" as const },
        issuedAt: "2026-08-07T18:00:30.000Z", expiresAt: "2026-08-07T18:02:00.000Z",
        humanPresence: true as const, canExecute: false as const,
      },
      grantRef: "grant_verifier",
    };
    const decided = await decisionRepository.decideAtomically({
      workspaceId, unitRef: command.unitRef, expectedTraceHash: snapshot.lifecycle.traceHash,
      buildCommand: async () => command,
    });
    evidence.decisionInserted = decided.outcome === "inserted"
      && decided.executionAuthority === "none" && decided.executionPerformed === false
      && decided.lifecycle.units[0]?.grant?.canExecute === false;
    const replayed = await new DrizzleActionApprovalDecisionRepository(transaction as never, workspaceId).decideAtomically({
      workspaceId, unitRef: command.unitRef, expectedTraceHash: decided.traceHash,
      buildCommand: async () => command,
    });
    evidence.decisionExactReplay = replayed.outcome === "unchanged";
    const counts = rows(await transaction.execute(sql`
      select (select count(*)::int from action_proposal_bundles where workspace_id = ${workspaceId}::uuid) as bundles,
        (select count(*)::int from action_proposal_units where workspace_id = ${workspaceId}::uuid) as units,
        (select count(*)::int from action_proposal_initial_events where workspace_id = ${workspaceId}::uuid) as events,
        (select count(*)::int from action_approval_decision_events where workspace_id = ${workspaceId}::uuid) as decisions,
        (select count(*)::int from action_approval_evidence_grants where workspace_id = ${workspaceId}::uuid) as grants
    `))[0];
    evidence.exactRows = counts?.bundles === 1 && counts?.units === 1 && counts?.events === 1
      && counts?.decisions === 1 && counts?.grants === 1;
    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.execute(sql`update action_proposal_units set initial_state = 'approved' where workspace_id = ${workspaceId}::uuid`);
      });
    }
    catch { evidence.immutable = true; }
    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.execute(sql`update action_approval_evidence_grants set can_execute = true where workspace_id = ${workspaceId}::uuid`);
      });
    }
    catch { evidence.decisionImmutable = true; }
    const security = rows(await transaction.execute(sql`
      select count(*) filter (where c.relrowsecurity)::int as rls_count,
        (select count(*)::int from information_schema.role_table_grants where table_schema = 'public'
          and (table_name like 'action_proposal_%' or table_name like 'action_approval_%')
          and grantee in ('anon', 'authenticated')) as api_grants
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('action_approval_policy_snapshots', 'action_proposal_bundles',
        'action_proposal_units', 'action_proposal_dependencies', 'action_proposal_initial_events',
        'action_approval_decision_events', 'action_approval_evidence_grants')
    `))[0];
    evidence.rlsAndGrants = security?.rls_count === 7 && security?.api_grants === 0;
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }

evidence.rollbackClean = rows(await database.execute(sql`
  select count(*)::int as count from workspaces where id = ${workspaceId}::uuid
`))[0]?.count === 0;
await pool.end();
if (Object.values(evidence).some((value) => value === false) || evidence.metaCalls !== 0 || evidence.executionCalls !== 0) {
  throw new Error(`Action proposal queue doğrulaması başarısız: ${JSON.stringify(evidence)}`);
}
console.log(JSON.stringify(evidence));
