import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { ActionProposalStagingService } from "@/application/action-proposal-staging-service";
import { ApprovalQueueReadService } from "@/application/approval-queue-read-service";
import { DrizzleActionProposalQueueRepository } from "@/connectors/actions/action-proposal-queue-drizzle-repository";
import { DrizzleApprovalQueueReadRepository } from "@/connectors/actions/approval-queue-drizzle-read-repository";
import * as schema from "@/db/schema";
import { createApprovalPolicyDraft, publishApprovalPolicy } from "@/domain/actions/approval-policy-registry";
import { buildActionPlan, type AutonomyRule } from "@/domain/actions/autonomy-valve";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
const migrationPath = "drizzle/20260818001000_p06_human_rename_foundation.sql";
const migrationSql = readFileSync(migrationPath, "utf8");
const migrationHash = createHash("sha256").update(migrationSql).digest("hex");
const migrationTimestamp = 1_787_011_800_000;
const post = process.env.P06_HUMAN_RENAME_POST_APPROVED === "true";
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
  canonicalRenameQueued: false,
  exactReplay: false,
  publicRenameProjection: false,
  humanOnly: false,
  noAutonomyWidening: false,
  createRawAbsent: false,
  journalUnchanged: false,
  zeroResidue: false,
};

const rows = (result: unknown): readonly Record<string, unknown>[] => result && typeof result === "object"
  && "rows" in result && Array.isArray(result.rows) ? result.rows as readonly Record<string, unknown>[] : [];
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => [key, stable(child)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const definition = (constraintRows: readonly Record<string, unknown>[], name: string) =>
  String(constraintRows.find((row) => row.conname === name)?.definition ?? "").replaceAll(/\s+/g, " ");

const workspaceRef = "workspace_rename_verifier";
const accountRef = "act_rename_verifier";
const campaignRef = "campaign_rename_verifier";
const proposedAt = "2026-08-18T12:00:00.000Z";
const expiresAt = "2026-08-19T12:00:00.000Z";
const contextHash = "d".repeat(64);
const autonomyRule: AutonomyRule = {
  ruleRef: "autonomy_rename_manual", workspaceRef, scope: { level: "workspace", ref: workspaceRef },
  mode: "approval_only", state: "published", effectiveFrom: "2026-08-01T00:00:00.000Z", expiresAt: null,
  killSwitch: false, maximumActionsPerRun: null,
};
const actionPlan = buildActionPlan({
  kind: "rename", entity: { level: "campaign", ref: campaignRef }, beforeName: "Prospecting | Eski",
  afterName: "Prospecting | Yeni", namingEvidenceRef: "naming_evidence_verifier",
}, {
  workspaceRef, accountGroupRef: null, accountRef, internalCategoryRefs: [], campaignRef,
  entity: { level: "campaign", ref: campaignRef }, evaluatedAt: proposedAt, rules: [autonomyRule], budgetLimits: null,
  protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [],
    changeDisposition: "allowed", policyRefs: [] }, frozenContextHash: contextHash,
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
      where (conrelid='public.action_proposal_units'::regclass and conname='action_proposal_units_identity')
         or (conrelid='public.approval_policy_definition_revisions'::regclass and conname='approval_policy_definition_revisions_applicability')
         or (conrelid='public.action_guardrail_policy_revisions'::regclass and conname='action_guardrail_policy_revisions_selector_clauses')
      order by conname
    `));
    const unitIdentity = definition(constraints, "action_proposal_units_identity");
    const applicability = definition(constraints, "approval_policy_definition_revisions_applicability");
    const guardrails = definition(constraints, "action_guardrail_policy_revisions_selector_clauses");
    evidence.exactConstraints = constraints.length === 3 && constraints.every((row) => row.convalidated === true)
      && ["campaign_rename", "adset_rename", "ad_rename"].every((value) => unitIdentity.includes(value)
        && applicability.includes(value) && guardrails.includes(value))
      && ["internal_annotation", "status_pause", "status_activate", "budget_decrease", "budget_increase", "existing_post_promotion"]
        .every((value) => unitIdentity.includes(value))
      && ["campaign_rename", "adset_rename", "ad_rename"]
        .every((value) => new RegExp(`${value}.{0,80}risk = 'K3'`, "u").test(applicability))
      && guardrails.includes("jsonb_array_length(action_types) >= 1")
      && guardrails.includes("jsonb_array_length(action_types) <= 8");
    evidence.createRawAbsent = !unitIdentity.includes("campaign_create") && !unitIdentity.includes("raw_graph")
      && !applicability.includes("campaign_create") && !applicability.includes("raw_graph");

    await transaction.insert(schema.workspaces).values({ id: workspaceId, name: "P06 human rename verifier" });
    await transaction.insert(schema.metaConnections).values({ id: connectionId, workspaceId,
      externalConnectionKey: "p06-human-rename", displayName: "Verifier", graphApiVersion: "v23.0",
      fieldCatalogVersion: "verifier-v1" });
    await transaction.insert(schema.dataSources).values({ id: sourceId, workspaceId, metaConnectionId: connectionId,
      platform: "meta_ads", externalAccountId: accountRef, displayName: "Verifier" });
    await transaction.insert(schema.adAccounts).values({ id: accountId, workspaceId, dataSourceId: sourceId,
      externalAccountId: accountRef, name: "Verifier", currency: "TRY", timezone: "Europe/Istanbul" });
    await transaction.insert(schema.adCampaigns).values({ id: campaignId, workspaceId, adAccountId: accountId,
      externalCampaignId: campaignRef, name: "Prospecting | Eski", configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE" });
    await transaction.insert(schema.effectiveCampaignContexts).values({ id: contextId, workspaceId,
      identityHash: "b".repeat(64), contextHash, schemaVersion: "effective-campaign-context/1.0.0",
      metaConnectionId: connectionId, adAccountId: accountId, campaignId, connectionRef: "connection_rename_verifier",
      accountRef, campaignRef, entityType: "campaign", entityRef: campaignRef, capturedAt: new Date(proposedAt),
      snapshotRefs: ["snapshot_rename_verifier"], contextPayload: { workspaceId,
        schemaVersion: "effective-campaign-context/1.0.0", contextHash, capturedAt: proposedAt,
        identity: { connectionRef: "connection_rename_verifier", accountRef, campaignRef, entityType: "campaign", entityRef: campaignRef },
        data: { snapshotRefs: ["snapshot_rename_verifier"] },
        capabilities: { containsRawL0: false, canAuthorizeAction: false, canExecuteWrite: false } } });
    await transaction.insert(schema.effectiveCampaignContextComponents).values({ workspaceId, contextId,
      componentType: "policy_authority", componentRef: "policy_authority_rename", componentVersion: "e".repeat(64) });

    const policyDraft = createApprovalPolicyDraft({ workspaceRef,
      applicability: { actionType: "campaign_rename", risk: "K3" },
      policy: { version: "action-approval-policy/1.0.0", policyRef: "policy_rename_verifier", revision: 1,
        autonomyMode: "approval_only", requesterRoles: ["operator"], approverRoles: [{ risk: "K3", roles: ["owner"] }],
        grantConsumerRoles: ["owner"], separationOfDutiesRisks: [], maximumProtectionEvidenceAgeSeconds: 3_600,
        maximumProposalLifetimeSeconds: 86_400, maximumGrantLifetimeSeconds: 600 },
      effectiveFrom: "2026-08-01T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_policy_author", role: "admin" } });
    const publishedPolicy = publishApprovalPolicy({ draft: policyDraft,
      actor: { actorRef: "actor_policy_publisher", role: "owner" }, decisionRef: "decision_policy_rename",
      reasonRef: "reason_policy_rename", publishedAt: "2026-08-02T00:00:00.000Z" });
    for (const artifact of [policyDraft, publishedPolicy]) {
      await transaction.insert(schema.approvalPolicyDefinitionRevisions).values({ workspaceId, workspaceRef,
        policyRef: artifact.policyRef, revision: artifact.revision, previousHash: artifact.previousHash,
        schemaVersion: artifact.version, actionType: artifact.applicability.actionType, risk: artifact.applicability.risk,
        state: artifact.state, effectiveFrom: new Date(artifact.effectiveFrom), expiresAt: null,
        normalizedByActorRef: artifact.provenance.normalizedByActorRef, normalizedByRole: artifact.provenance.normalizedByRole,
        publishedByActorRef: artifact.provenance.publishedByActorRef, publishedByRole: artifact.provenance.publishedByRole,
        publicationDecisionRef: artifact.provenance.publicationDecisionRef,
        publicationReasonRef: artifact.provenance.publicationReasonRef,
        publishedAt: artifact.provenance.publishedAt ? new Date(artifact.provenance.publishedAt) : null,
        disabledByActorRef: null, disabledByRole: null, disableDecisionRef: null, disableReasonRef: null, disabledAt: null,
        policyHash: artifact.policyHash, canonicalHash: artifact.canonicalHash,
        policyPayload: artifact.policy, artifactPayload: artifact });
    }

    const proposal = new ActionProposalStagingService(publishedPolicy.policy).stage({
      plan: { planRef: "plan_rename_verifier", revision: 1, planHash: "a".repeat(64) },
      workspaceRef, accountRef, requester: { actorRef: "actor_operator", role: "operator" }, proposedAt, expiresAt,
      units: [{ unitKey: "unit_campaign_rename", plan: { planRef: "plan_rename_verifier", revision: 1, planHash: "a".repeat(64) },
        actionPlan, workspaceRef, accountRef, entityRef: campaignRef, actionType: actionPlan.actionType,
        risk: actionPlan.risk, actionHash: digest(actionPlan.action), dependencies: [],
        summary: { safety: "public_safe", before: { label: "Ad", value: "Prospecting | Eski" },
          after: { label: "Ad", value: "Prospecting | Yeni" },
          evidence: [{ evidenceRef: "naming_evidence_verifier", label: "İsimlendirme kanıtı" }] } }],
    });
    const queue = new DrizzleActionProposalQueueRepository(transaction as never, workspaceId);
    evidence.canonicalRenameQueued = (await queue.appendInitial(proposal)).outcome === "inserted";
    evidence.exactReplay = (await queue.appendInitial(proposal)).outcome === "unchanged";
    const read = await new ApprovalQueueReadService(new DrizzleApprovalQueueReadRepository(transaction as never, workspaceId))
      .list({ workspaceId, limit: 10 });
    evidence.publicRenameProjection = read.items.length === 1 && read.items[0]?.actionType === "campaign_rename"
      && read.items[0]?.beforeAfter.field === "entity_name" && read.items[0].beforeAfter.before === "Prospecting | Eski"
      && read.items[0].beforeAfter.after === "Prospecting | Yeni"
      && !JSON.stringify(read).includes("naming_evidence_verifier");
    evidence.humanOnly = actionPlan.risk === "K3" && actionPlan.disposition === "approval_required"
      && actionPlan.effectiveAutonomy === "approval_only" && !actionPlan.capabilities.canExecute
      && !actionPlan.capabilities.canWriteMeta && !actionPlan.capabilities.canGrantApproval;
    const autonomyDefinition = definition(rows(await transaction.execute(sql`
      select conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where conrelid='public.autonomy_rule_revisions'::regclass
    `)), "autonomy_rule_revisions_scope");
    evidence.noAutonomyWidening = !autonomyDefinition.includes("campaign_rename")
      && !autonomyDefinition.includes("adset_rename") && !autonomyDefinition.includes("ad_rename");
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
}

const journalAfter = rows(await database.execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations`))[0]?.count;
evidence.journalUnchanged = journalBefore === journalAfter;
const liveConstraint = rows(await database.execute(sql`
  select pg_get_constraintdef(oid) as definition from pg_constraint
  where conrelid='public.action_proposal_units'::regclass and conname='action_proposal_units_identity'
`))[0]?.definition;
evidence.zeroResidue = rows(await database.execute(sql`select count(*)::int as count from workspaces where id=${workspaceId}::uuid`))[0]?.count === 0
  && String(liveConstraint).includes("campaign_rename") === post;
await pool.end();
if (Object.entries(evidence).some(([key, value]) => key !== "mode" && value !== true)) {
  throw new Error(`p06 human rename verification failed:${JSON.stringify(evidence)}`);
}
console.log(JSON.stringify(evidence));
