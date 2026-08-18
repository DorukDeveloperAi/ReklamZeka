import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { ActionProposalStagingService } from "@/application/action-proposal-staging-service";
import { DrizzleActionApprovalDecisionRepository } from "@/connectors/actions/action-approval-decision-drizzle-repository";
import { DrizzleActionProposalQueueRepository } from "@/connectors/actions/action-proposal-queue-drizzle-repository";
import { DrizzleP06ExecutionRepository } from "@/connectors/actions/p06-execution-drizzle-repository";
import { DrizzleP06StatusExecutionDispatchAuthorityRepository } from "@/connectors/actions/p06-status-execution-dispatch-authority-drizzle-repository";
import * as schema from "@/db/schema";
import { admitActionExecution } from "@/domain/actions/action-execution-admission";
import { createApprovalPolicyDraft, publishApprovalPolicy } from "@/domain/actions/approval-policy-registry";
import { buildActionPlan } from "@/domain/actions/autonomy-valve";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
const post = process.env.P06_HUMAN_RENAME_EXECUTION_POST_APPROVED === "true";
const migrationPath = "drizzle/20260818001100_p06_human_rename_execution.sql";
const migrationSql = readFileSync(migrationPath, "utf8");
const migrationHash = createHash("sha256").update(migrationSql).digest("hex");
const migrationTimestamp = 1_787_011_860_000;
const rollback = Symbol("rollback");
const workspaceId = randomUUID(), connectionId = randomUUID(), sourceId = randomUUID(), accountId = randomUUID(), campaignId = randomUUID(), contextId = randomUUID();
const workspaceRef = "workspace_rename_execution_pre", accountRef = "act_rename_execution_pre", campaignRef = "campaign_rename_execution_pre";
const now = new Date(), at = now.toISOString(), proposedAt = new Date(now.getTime() - 5_000).toISOString(), expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const evidence = { mode: post ? "post_applied_outer_rollback" : "pre_outer_rollback", exactMigrationLedger: false, migrationInstalled: false, exactContract: false,
  canonicalQueue: false, humanApproval: false, canonicalAdmissionAttempt: false, renameRunCreated: false, exactReplay: false,
  staleNameHeld: false, immutableRunRejected: false, dispatchFailClosed: false, zeroResidue: false };

const ledger = (await database.execute(sql`select count(*)::int exact_count,count(*) filter(where hash=${migrationHash})::int hash_count,
  count(*) filter(where created_at=${migrationTimestamp})::int timestamp_count from drizzle.__drizzle_migrations
  where hash=${migrationHash} or created_at=${migrationTimestamp}`)).rows[0] as Record<string, unknown> | undefined;
evidence.exactMigrationLedger = post
  ? ledger?.exact_count === 1 && ledger?.hash_count === 1 && ledger?.timestamp_count === 1
  : ledger?.exact_count === 0 && ledger?.hash_count === 0 && ledger?.timestamp_count === 0;
try {
  await database.transaction(async (tx) => {
    if (!post) await tx.execute(sql.raw(migrationSql));
    evidence.migrationInstalled = true;
    const contract = (await tx.execute(sql`select pg_get_constraintdef(oid) definition from pg_constraint
      where conrelid='public.p06_execution_runs'::regclass and conname='p06_execution_runs_contract'`)).rows[0] as Record<string, unknown> | undefined;
    evidence.exactContract = typeof contract?.definition === "string" && contract.definition.includes("human_rename_approved")
      && contract.definition.includes("action_execution_attempt_id") && contract.definition.includes("actionPlanHash");
    await tx.insert(schema.workspaces).values({ id: workspaceId, name: "P06 human rename execution PRE" });
    await tx.insert(schema.metaConnections).values({ id: connectionId, workspaceId, externalConnectionKey: "p06-rename-exec-pre", displayName: "P06 rename execution PRE", graphApiVersion: "v23.0", fieldCatalogVersion: "p06-rename-exec-pre" });
    await tx.insert(schema.dataSources).values({ id: sourceId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads", externalAccountId: accountRef, displayName: "P06 rename execution PRE" });
    await tx.insert(schema.adAccounts).values({ id: accountId, workspaceId, dataSourceId: sourceId, externalAccountId: accountRef, name: "P06 rename execution PRE", currency: "TRY", timezone: "Europe/Istanbul" });
    await tx.insert(schema.adCampaigns).values({ id: campaignId, workspaceId, adAccountId: accountId, externalCampaignId: campaignRef,
      name: "Prospecting | Eski", configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE", campaignBudgetOptimization: false,
      rawPayloadHash: "1".repeat(64), sourceGraphVersion: "v23.0", fieldCatalogVersion: "p06-rename-exec-pre", fetchedAt: now, firstSeenAt: now, lastSeenAt: now });
    const actionPlan = buildActionPlan({ kind: "rename", entity: { level: "campaign", ref: campaignRef }, beforeName: "Prospecting | Eski", afterName: "Prospecting | Yeni", namingEvidenceRef: "naming_evidence_rename_execution" }, {
      workspaceRef, accountGroupRef: null, accountRef, internalCategoryRefs: [], campaignRef, entity: { level: "campaign", ref: campaignRef }, evaluatedAt: proposedAt,
      rules: [{ ruleRef: "autonomy_rename_execution", workspaceRef, scope: { level: "workspace", ref: workspaceRef }, mode: "approval_only", state: "published", effectiveFrom: new Date(now.getTime() - 86_400_000).toISOString(), expiresAt: null, killSwitch: false, maximumActionsPerRun: null }],
      budgetLimits: null, protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: ["policy_rename_execution"] }, frozenContextHash: "2".repeat(64) });
    await tx.insert(schema.effectiveCampaignContexts).values({ id: contextId, workspaceId, identityHash: "3".repeat(64), contextHash: actionPlan.contextHash,
      schemaVersion: "effective-campaign-context/1.0.0", metaConnectionId: connectionId, adAccountId: accountId, campaignId, connectionRef: "connection_rename_execution", accountRef, campaignRef,
      entityType: "campaign", entityRef: campaignRef, capturedAt: new Date(proposedAt), snapshotRefs: ["snapshot_rename_execution"],
      contextPayload: { workspaceId, schemaVersion: "effective-campaign-context/1.0.0", contextHash: actionPlan.contextHash, capturedAt: proposedAt,
        identity: { connectionRef: "connection_rename_execution", accountRef, campaignRef, entityType: "campaign", entityRef: campaignRef }, data: { snapshotRefs: ["snapshot_rename_execution"] }, capabilities: { containsRawL0: false, canAuthorizeAction: false, canExecuteWrite: false } } });
    await tx.insert(schema.effectiveCampaignContextComponents).values({ workspaceId, contextId, componentType: "policy_authority", componentRef: "policy_authority_rename_execution", componentVersion: "4".repeat(64) });
    const policyDraft = createApprovalPolicyDraft({ workspaceRef, applicability: { actionType: "campaign_rename", risk: "K3" },
      policy: { version: "action-approval-policy/1.0.0", policyRef: "policy_rename_execution", revision: 1, autonomyMode: "approval_only", requesterRoles: ["operator"], approverRoles: [{ risk: "K3", roles: ["owner"] }], grantConsumerRoles: ["owner"], separationOfDutiesRisks: [], maximumProtectionEvidenceAgeSeconds: 3_600, maximumProposalLifetimeSeconds: 86_400, maximumGrantLifetimeSeconds: 600 },
      effectiveFrom: new Date(now.getTime() - 86_400_000).toISOString(), expiresAt: null, normalizedBy: { actorRef: "actor_policy_author", role: "admin" } });
    const publishedPolicy = publishApprovalPolicy({ draft: policyDraft, actor: { actorRef: "actor_policy_publisher", role: "owner" }, decisionRef: "decision_policy_rename_execution", reasonRef: "reason_policy_rename_execution", publishedAt: new Date(now.getTime() - 43_200_000).toISOString() });
    for (const artifact of [policyDraft, publishedPolicy]) await tx.insert(schema.approvalPolicyDefinitionRevisions).values({ workspaceId, workspaceRef, policyRef: artifact.policyRef, revision: artifact.revision, previousHash: artifact.previousHash, schemaVersion: artifact.version, actionType: artifact.applicability.actionType, risk: artifact.applicability.risk, state: artifact.state, effectiveFrom: new Date(artifact.effectiveFrom), expiresAt: null, normalizedByActorRef: artifact.provenance.normalizedByActorRef, normalizedByRole: artifact.provenance.normalizedByRole, publishedByActorRef: artifact.provenance.publishedByActorRef, publishedByRole: artifact.provenance.publishedByRole, publicationDecisionRef: artifact.provenance.publicationDecisionRef, publicationReasonRef: artifact.provenance.publicationReasonRef, publishedAt: artifact.provenance.publishedAt ? new Date(artifact.provenance.publishedAt) : null, disabledByActorRef: null, disabledByRole: null, disableDecisionRef: null, disableReasonRef: null, disabledAt: null, policyHash: artifact.policyHash, canonicalHash: artifact.canonicalHash, policyPayload: artifact.policy, artifactPayload: artifact });
    const proposal = new ActionProposalStagingService(publishedPolicy.policy).stage({ plan: { planRef: "plan_rename_execution", revision: 1, planHash: "5".repeat(64) }, workspaceRef, accountRef, requester: { actorRef: "actor_rename_operator", role: "operator" }, proposedAt, expiresAt,
      units: [{ unitKey: "rename_execution", plan: { planRef: "plan_rename_execution", revision: 1, planHash: "5".repeat(64) }, actionPlan, workspaceRef, accountRef, entityRef: campaignRef, actionType: "campaign_rename", risk: "K3", actionHash: digest(actionPlan.action), dependencies: [], summary: { safety: "public_safe", before: { label: "Ad", value: "Prospecting | Eski" }, after: { label: "Ad", value: "Prospecting | Yeni" }, evidence: [{ evidenceRef: "naming_evidence_rename_execution", label: "İsimlendirme kanıtı" }] } }] });
    const queue = new DrizzleActionProposalQueueRepository(tx as never, workspaceId);
    evidence.canonicalQueue = (await queue.appendInitial(proposal)).outcome === "inserted";
    const decisions = new DrizzleActionApprovalDecisionRepository(tx as never, workspaceId);
    const snapshot = await decisions.loadForDecision({ workspaceId, unitRef: proposal.bundle.units[0]!.unitRef });
    if (!snapshot) throw new Error("rename decision source missing");
    const unit = proposal.bundle.units[0]!;
    const decided = await decisions.decideAtomically({ workspaceId, unitRef: unit.unitRef, expectedTraceHash: snapshot.lifecycle.traceHash, buildCommand: async () => ({ kind: "approve" as const, commandRef: "decision_rename_execution", unitRef: unit.unitRef, actor: { actorRef: "actor_rename_owner", role: "owner" as const }, decidedAt: at, reasonCode: "rename_reviewed", freshness: snapshot.freshness, authorization: { authorizationRef: "presence_rename_approve", unitRef: unit.unitRef, unitHash: unit.unitHash, scopeHash: unit.scopeHash, actor: { actorRef: "actor_rename_owner", role: "owner" as const }, issuedAt: proposedAt, expiresAt, humanPresence: true as const, canExecute: false as const }, grantRef: "grant_rename_execution" }) });
    evidence.humanApproval = decided.outcome === "inserted" && decided.executionAuthority === "none";
    const state = decided.lifecycle.units[0]!;
    if (!state.decisionRef || !state.grant) throw new Error("rename approval evidence missing");
    const admission = admitActionExecution({ lifecycle: decided.lifecycle, unitRef: unit.unitRef, actionPlan,
      eligibilitySnapshot: { workspaceRef, accountRef, capturedAt: at, target: { entityLevel: "campaign", entityRef: campaignRef, configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE", budgetOwnerRef: null, currentName: "Prospecting | Eski" }, ancestors: [], sourceSnapshotHash: "6".repeat(64) },
      currentFreshness: [{ unitRef: unit.unitRef, planRevision: unit.plan.revision, planHash: unit.plan.planHash, sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }], executionPresence: { authorizationRef: "presence_rename_execute", unitRef: unit.unitRef, unitHash: unit.unitHash, scopeHash: unit.scopeHash, actor: { actorRef: "actor_rename_owner", role: "owner" }, issuedAt: proposedAt, expiresAt, humanPresence: true }, evaluatedAt: at });
    const stored = await tx.execute(sql`insert into action_execution_attempts(workspace_id,bundle_id,unit_id,decision_event_id,approval_grant_id,execution_ref,unit_ref,approval_decision_ref,idempotency_key,admission_hash,write_spec_hash,admission_payload)
      select ${workspaceId}::uuid,u.bundle_id,u.id,d.id,g.id,${`action_execution_${admission.admissionHash.slice(0,20)}`},u.unit_ref,d.command_ref,${digest({ workspaceId, admissionHash: admission.admissionHash })},${admission.admissionHash},${admission.writeSpec.specHash},${JSON.stringify(admission)}::jsonb
      from action_proposal_units u join action_approval_decision_events d on d.workspace_id=u.workspace_id and d.bundle_id=u.bundle_id and d.unit_id=u.id join action_approval_evidence_grants g on g.workspace_id=d.workspace_id and g.decision_event_id=d.id where u.workspace_id=${workspaceId}::uuid and u.unit_ref=${unit.unitRef} returning id::text`);
    const attemptId = stored.rows[0]?.id as string | undefined;
    if (!attemptId) throw new Error("rename admission attempt missing");
    evidence.canonicalAdmissionAttempt = admission.writeSpec.mutation.kind === "rename" && admission.capabilities.canExecute === false;
    const repository = new DrizzleP06ExecutionRepository(tx as never);
    const gates = (["staging", "admission"] as const).map((phase, index) => ({ phase, enabled: false, allowlistHash: digest({ workspaceRef, accountRef, phase }), capturedAt: new Date(now.getTime() - (2 - index)).toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() }));
    const created = await repository.createHumanRenameApproved({ workspaceId, actionExecutionAttemptId: attemptId, evaluatedAt: at, gates });
    evidence.renameRunCreated = created.request.action === "campaign_rename" && created.request.expectedBefore.name === "Prospecting | Eski" && created.request.desired.name === "Prospecting | Yeni";
    const replay = await repository.createHumanRenameApproved({ workspaceId, actionExecutionAttemptId: attemptId, evaluatedAt: at, gates });
    evidence.exactReplay = replay.executionRunId === created.executionRunId && replay.requestHash === created.requestHash;
    const dispatch = await new DrizzleP06StatusExecutionDispatchAuthorityRepository(tx as never, {} as never).revalidate({ phase: "pre_dispatch", executionRef: created.executionRef, request: created.request });
    evidence.dispatchFailClosed = dispatch.allowed === false && /^[a-f0-9]{64}$/.test(dispatch.authorityHash);
    await tx.execute(sql`update ad_campaigns set name='Prospecting | Başka' where workspace_id=${workspaceId}::uuid and id=${campaignId}::uuid`);
    try { await repository.createHumanRenameApproved({ workspaceId, actionExecutionAttemptId: attemptId, evaluatedAt: at, gates }); } catch (error) { evidence.staleNameHeld = error instanceof Error && error.message.includes("corrupt_store"); }
    try { await tx.execute(sql`update p06_execution_runs set request_hash=${"0".repeat(64)} where workspace_id=${workspaceId}::uuid and id=${created.executionRunId}::uuid`); } catch { evidence.immutableRunRejected = true; }
    if (Object.entries(evidence).filter(([key]) => !["mode", "zeroResidue"].includes(key)).some(([, value]) => value !== true)) throw new Error(`p06 human rename execution verification failed:${JSON.stringify(evidence)}`);
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
evidence.zeroResidue = (await database.execute(sql`select (select count(*)::int from workspaces where id=${workspaceId}::uuid)+(select count(*)::int from p06_execution_runs where workspace_id=${workspaceId}::uuid) count`)).rows[0]?.count === 0;
await pool.end();
if (!evidence.zeroResidue) throw new Error("P06 human rename execution PRE residue bıraktı");
console.log(JSON.stringify({ ...evidence, migrationHash }));
