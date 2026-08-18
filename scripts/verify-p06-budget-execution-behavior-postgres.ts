import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { ActionProposalStagingService } from "@/application/action-proposal-staging-service";
import { DrizzleActionApprovalDecisionRepository } from "@/connectors/actions/action-approval-decision-drizzle-repository";
import { DrizzleActionProposalQueueRepository } from "@/connectors/actions/action-proposal-queue-drizzle-repository";
import { DrizzleP06ExecutionRepository } from "@/connectors/actions/p06-execution-drizzle-repository";
import { DrizzleP06GuideBudgetExecutionDispatchAuthorityRepository } from "@/connectors/actions/p06-guide-budget-execution-dispatch-authority-drizzle-repository";
import * as schema from "@/db/schema";
import { admitActionExecution } from "@/domain/actions/action-execution-admission";
import { createApprovalPolicyDraft, publishApprovalPolicy } from "@/domain/actions/approval-policy-registry";
import { buildActionPlan } from "@/domain/actions/autonomy-valve";
import { createLocalGuideBudgetAdmissionGate } from "@/server/local-guide-budget-action-runtime";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
const postMode = process.env.P06_BUDGET_EXECUTION_POST_APPROVED === "true";
const rollback = Symbol("rollback");
const workspaceId = randomUUID(), connectionId = randomUUID(), sourceId = randomUUID(), accountId = randomUUID(),
  campaignId = randomUUID(), adSetId = randomUUID(), contextId = randomUUID(), guideRevisionId = randomUUID();
const workspaceRef = "workspace_budget_execution_pre", accountRef = "act_budget_execution_pre",
  campaignRef = "campaign_budget_execution_pre", entityRef = "adset_budget_execution_pre";
const now = new Date(), at = now.toISOString(), proposedAt = new Date(now.getTime() - 5_000).toISOString(),
  expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stable(child)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const evidence = { mode: postMode ? "post_applied_outer_rollback" : "pre_outer_rollback", canonicalQueue: false, humanApproval: false, canonicalAdmissionAttempt: false,
  budgetRunCreated: false, exactReplay: false, sourceXor: false, forgedDryRunRejected: false, forgedMirrorStatusRejected: false, authorityNone: false,
  dispatchFailClosed: false, zeroResidue: false };

try {
  await database.transaction(async (tx) => {
    if (!postMode) await tx.execute(sql.raw(readFileSync("drizzle/20260818000500_p06_budget_execution_binding.sql", "utf8")));
    await tx.insert(schema.workspaces).values({ id: workspaceId, name: "P06 budget execution PRE" });
    await tx.insert(schema.metaConnections).values({ id: connectionId, workspaceId, externalConnectionKey: "p06-budget-pre",
      displayName: "P06 budget PRE", graphApiVersion: "v23.0", fieldCatalogVersion: "p06-budget-pre" });
    await tx.insert(schema.dataSources).values({ id: sourceId, workspaceId, metaConnectionId: connectionId,
      platform: "meta_ads", externalAccountId: accountRef, displayName: "P06 budget PRE" });
    await tx.insert(schema.adAccounts).values({ id: accountId, workspaceId, dataSourceId: sourceId, externalAccountId: accountRef,
      name: "P06 budget PRE", currency: "TRY", timezone: "Europe/Istanbul" });
    await tx.insert(schema.adCampaigns).values({ id: campaignId, workspaceId, adAccountId: accountId,
      externalCampaignId: campaignRef, name: "P06 budget PRE", configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE",
      campaignBudgetOptimization: false, rawPayloadHash: "1".repeat(64), sourceGraphVersion: "v23.0",
      fieldCatalogVersion: "p06-budget-pre", fetchedAt: now, firstSeenAt: now, lastSeenAt: now });
    await tx.insert(schema.metaAdSets).values({ id: adSetId, workspaceId, adAccountId: accountId, campaignId,
      externalAdSetId: entityRef, name: "P06 budget PRE", configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE",
      dailyBudgetMinor: 10_050, rawPayloadHash: "2".repeat(64), sourceGraphVersion: "v23.0",
      fieldCatalogVersion: "p06-budget-pre", provenance: { verifier: "p06_budget_execution" },
      fetchedAt: now, firstSeenAt: now, lastSeenAt: now });
    const actionPlan = buildActionPlan({ kind: "budget_change", entity: { level: "adset", ref: entityRef }, budgetKind: "daily",
      currency: "TRY", beforeDecimal: "100.50", afterDecimal: "90.25", budgetOwnerRef: entityRef }, {
      workspaceRef, accountGroupRef: null, accountRef, internalCategoryRefs: [], campaignRef,
      entity: { level: "adset", ref: entityRef }, evaluatedAt: proposedAt,
      rules: [{ ruleRef: "autonomy_budget_pre", workspaceRef, scope: { level: "workspace", ref: workspaceRef },
        mode: "approval_only", state: "published", effectiveFrom: new Date(now.getTime() - 86_400_000).toISOString(),
        expiresAt: null, killSwitch: false, maximumActionsPerRun: null }],
      budgetLimits: { currency: "TRY", maximumAbsoluteDeltaDecimal: "20.25", maximumRelativeDeltaBasisPoints: 2_000,
        limitRefs: ["limit_budget_pre"] }, protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [],
        protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: ["policy_budget_pre"] }, frozenContextHash: "3".repeat(64),
    });
    await tx.insert(schema.effectiveCampaignContexts).values({ id: contextId, workspaceId, identityHash: "4".repeat(64),
      contextHash: actionPlan.contextHash, schemaVersion: "effective-campaign-context/1.0.0", metaConnectionId: connectionId,
      adAccountId: accountId, campaignId, connectionRef: "connection_budget_pre", accountRef, campaignRef,
      entityType: "ad_set", entityRef, capturedAt: new Date(proposedAt), snapshotRefs: ["snapshot_budget_pre"],
      contextPayload: { workspaceId, schemaVersion: "effective-campaign-context/1.0.0", contextHash: actionPlan.contextHash,
        capturedAt: proposedAt, identity: { connectionRef: "connection_budget_pre", accountRef, campaignRef, entityType: "ad_set", entityRef },
        data: { snapshotRefs: ["snapshot_budget_pre"] }, capabilities: { containsRawL0: false, canAuthorizeAction: false, canExecuteWrite: false } } });
    await tx.insert(schema.effectiveCampaignContextComponents).values({ workspaceId, contextId,
      componentType: "policy_authority", componentRef: "policy_authority_budget_pre", componentVersion: "5".repeat(64) });
    const policyDraft = createApprovalPolicyDraft({ workspaceRef, applicability: { actionType: "budget_decrease", risk: "K2" },
      policy: { version: "action-approval-policy/1.0.0", policyRef: "policy_budget_pre", revision: 1,
        autonomyMode: "approval_only", requesterRoles: ["operator"], approverRoles: [{ risk: "K2", roles: ["owner"] }],
        grantConsumerRoles: ["owner"], separationOfDutiesRisks: [], maximumProtectionEvidenceAgeSeconds: 3_600,
        maximumProposalLifetimeSeconds: 86_400, maximumGrantLifetimeSeconds: 600 },
      effectiveFrom: new Date(now.getTime() - 86_400_000).toISOString(), expiresAt: null,
      normalizedBy: { actorRef: "actor_policy_author", role: "admin" } });
    const publishedPolicy = publishApprovalPolicy({ draft: policyDraft, actor: { actorRef: "actor_policy_publisher", role: "owner" },
      decisionRef: "decision_policy_budget_pre", reasonRef: "reason_policy_budget_pre", publishedAt: new Date(now.getTime() - 43_200_000).toISOString() });
    for (const artifact of [policyDraft, publishedPolicy]) await tx.insert(schema.approvalPolicyDefinitionRevisions).values({
      workspaceId, workspaceRef, policyRef: artifact.policyRef, revision: artifact.revision, previousHash: artifact.previousHash,
      schemaVersion: artifact.version, actionType: artifact.applicability.actionType, risk: artifact.applicability.risk,
      state: artifact.state, effectiveFrom: new Date(artifact.effectiveFrom), expiresAt: null,
      normalizedByActorRef: artifact.provenance.normalizedByActorRef, normalizedByRole: artifact.provenance.normalizedByRole,
      publishedByActorRef: artifact.provenance.publishedByActorRef, publishedByRole: artifact.provenance.publishedByRole,
      publicationDecisionRef: artifact.provenance.publicationDecisionRef, publicationReasonRef: artifact.provenance.publicationReasonRef,
      publishedAt: artifact.provenance.publishedAt ? new Date(artifact.provenance.publishedAt) : null,
      disabledByActorRef: null, disabledByRole: null, disableDecisionRef: null, disableReasonRef: null, disabledAt: null,
      policyHash: artifact.policyHash, canonicalHash: artifact.canonicalHash, policyPayload: artifact.policy, artifactPayload: artifact });
    const dryRunHash = "6".repeat(64), planHash = digest({ guideRevisionId, dryRunHash, actionPlanHash: actionPlan.planHash });
    const proposal = new ActionProposalStagingService(publishedPolicy.policy).stage({
      plan: { planRef: `guide_budget_${guideRevisionId.replaceAll("-", "")}_${dryRunHash}`, revision: 1, planHash },
      workspaceRef, accountRef, requester: { actorRef: "actor_budget_operator", role: "operator" }, proposedAt, expiresAt,
      units: [{ unitKey: "guide_budget_pre", plan: { planRef: `guide_budget_${guideRevisionId.replaceAll("-", "")}_${dryRunHash}`, revision: 1, planHash },
        actionPlan, workspaceRef, accountRef, entityRef, actionType: actionPlan.actionType, risk: actionPlan.risk,
        actionHash: digest(actionPlan.action), dependencies: [], summary: { safety: "public_safe", before: { label: "Günlük bütçe", value: "100.50" },
          after: { label: "Günlük bütçe", value: "90.25" }, evidence: [{ evidenceRef: "guide_budget_dry_run", label: "Kanonik dry-run" }] } }] });
    const queue = new DrizzleActionProposalQueueRepository(tx as never, workspaceId);
    evidence.canonicalQueue = (await queue.appendInitial(proposal)).outcome === "inserted";
    const decisions = new DrizzleActionApprovalDecisionRepository(tx as never, workspaceId);
    const snapshot = await decisions.loadForDecision({ workspaceId, unitRef: proposal.bundle.units[0]!.unitRef });
    if (!snapshot) throw new Error("budget decision source missing");
    const command = { kind: "approve" as const, commandRef: "decision_budget_pre", unitRef: proposal.bundle.units[0]!.unitRef,
      actor: { actorRef: "actor_budget_owner", role: "owner" as const }, decidedAt: at, reasonCode: "budget_reviewed",
      freshness: snapshot.freshness, authorization: { authorizationRef: "presence_budget_approve", unitRef: proposal.bundle.units[0]!.unitRef,
        unitHash: proposal.bundle.units[0]!.unitHash, scopeHash: proposal.bundle.units[0]!.scopeHash,
        actor: { actorRef: "actor_budget_owner", role: "owner" as const }, issuedAt: proposedAt, expiresAt,
        humanPresence: true as const, canExecute: false as const }, grantRef: "grant_budget_pre" };
    const decided = await decisions.decideAtomically({ workspaceId, unitRef: command.unitRef, expectedTraceHash: snapshot.lifecycle.traceHash,
      buildCommand: async () => command });
    evidence.humanApproval = decided.outcome === "inserted" && decided.executionAuthority === "none";
    const unit = decided.lifecycle.bundle.units[0]!, state = decided.lifecycle.units[0]!;
    if (!state.decisionRef || !state.grant) throw new Error("budget approval evidence missing");
    const admission = admitActionExecution({ lifecycle: decided.lifecycle, unitRef: unit.unitRef, actionPlan,
      eligibilitySnapshot: { workspaceRef, accountRef, capturedAt: at, target: { entityLevel: "adset", entityRef,
        configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE", budgetOwnerRef: entityRef },
        ancestors: [{ entityLevel: "campaign", entityRef: campaignRef, configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE" }],
        sourceSnapshotHash: "7".repeat(64) },
      currentFreshness: [{ unitRef: unit.unitRef, planRevision: unit.plan.revision, planHash: unit.plan.planHash,
        sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }],
      executionPresence: { authorizationRef: "presence_budget_execute", unitRef: unit.unitRef, unitHash: unit.unitHash,
        scopeHash: unit.scopeHash, actor: { actorRef: "actor_budget_owner", role: "owner" }, issuedAt: proposedAt,
        expiresAt, humanPresence: true }, evaluatedAt: at });
    const stored = await tx.execute(sql`insert into action_execution_attempts(workspace_id,bundle_id,unit_id,decision_event_id,
      approval_grant_id,execution_ref,unit_ref,approval_decision_ref,idempotency_key,admission_hash,write_spec_hash,admission_payload)
      select ${workspaceId}::uuid,u.bundle_id,u.id,d.id,g.id,${`action_execution_${admission.admissionHash.slice(0,20)}`},u.unit_ref,d.command_ref,
        ${digest({ workspaceId, admissionHash: admission.admissionHash })},${admission.admissionHash},${admission.writeSpec.specHash},${JSON.stringify(admission)}::jsonb
      from action_proposal_units u join action_approval_decision_events d on d.workspace_id=u.workspace_id and d.bundle_id=u.bundle_id and d.unit_id=u.id
      join action_approval_evidence_grants g on g.workspace_id=d.workspace_id and g.decision_event_id=d.id
      where u.workspace_id=${workspaceId}::uuid and u.unit_ref=${unit.unitRef} returning id::text`);
    const attemptId = stored.rows[0]?.id as string | undefined;
    if (!attemptId) throw new Error("budget admission attempt missing");
    evidence.canonicalAdmissionAttempt = true;
    const repository = new DrizzleP06ExecutionRepository(tx as never);
    const gates = (["staging", "admission"] as const).map((phase, index) => ({ phase, enabled: false,
      allowlistHash: digest({ workspaceRef, accountRef, phase }), capturedAt: new Date(now.getTime() - (2-index)).toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString() }));
    const created = await repository.createGuideBudgetHumanApproved({ workspaceId, actionExecutionAttemptId: attemptId, evaluatedAt: at, gates });
    evidence.budgetRunCreated = created.request.action === "budget_decrease" && created.request.expectedBefore.budgetMinor === 10_050
      && created.request.desired.budgetMinor === 9_025;
    const replay = await repository.createGuideBudgetHumanApproved({ workspaceId, actionExecutionAttemptId: attemptId, evaluatedAt: at, gates });
    evidence.exactReplay = replay.executionRunId === created.executionRunId && replay.requestHash === created.requestHash;
    const persisted = (await tx.execute(sql`select route,guide_run_action_binding_id,action_execution_attempt_id::text,
      effective_guide_set_hash,resolution_hash,admission_hash,write_spec_hash,dry_run_hash,request_payload
      from p06_execution_runs where id=${created.executionRunId}::uuid`)).rows[0] as Record<string, unknown>;
    evidence.sourceXor = persisted.route === "guide_budget_human_approved" && persisted.guide_run_action_binding_id === null
      && persisted.action_execution_attempt_id === attemptId && persisted.effective_guide_set_hash === null && persisted.resolution_hash === null;
    evidence.authorityNone = admission.capabilities.canExecute === false && admission.capabilities.canWriteMeta === false
      && admission.capabilities.canDispatchNetwork === false;
    const dispatch = await new DrizzleP06GuideBudgetExecutionDispatchAuthorityRepository(tx as never,
      createLocalGuideBudgetAdmissionGate(tx as never)).revalidate({ phase: "pre_dispatch", executionRef: created.executionRef,
        request: created.request });
    evidence.dispatchFailClosed = dispatch.allowed === false
      && /^[a-f0-9]{64}$/.test(dispatch.authorityHash);
    await tx.execute(sql`savepoint forged_budget_run`);
    try {
      await tx.execute(sql`insert into p06_execution_runs(workspace_id,guide_run_action_binding_id,action_execution_attempt_id,
        proposal_bundle_id,action_unit_id,decision_event_id,approval_grant_id,execution_ref,idempotency_key,request_hash,
        action_unit_hash,proposal_hash,context_hash,effective_guide_set_hash,resolution_hash,policy_hash,gate_set_hash,
        admission_hash,write_spec_hash,dry_run_hash,action_plan_hash,budget_kind,currency,request_payload,route,created_at)
        select workspace_id,null,action_execution_attempt_id,proposal_bundle_id,action_unit_id,decision_event_id,approval_grant_id,
          'p06_execution_${"f".repeat(24)}','p06_exec_idem_${"e".repeat(64)}',request_hash,action_unit_hash,proposal_hash,context_hash,
          null,null,policy_hash,gate_set_hash,admission_hash,write_spec_hash,${"0".repeat(64)},action_plan_hash,budget_kind,currency,
          request_payload,'guide_budget_human_approved',created_at from p06_execution_runs where id=${created.executionRunId}::uuid`);
      await tx.execute(sql`release savepoint forged_budget_run`);
    } catch {
      await tx.execute(sql`rollback to savepoint forged_budget_run`);
      evidence.forgedDryRunRejected = true;
    }
    const originalPayload = persisted.request_payload as Record<string, unknown>;
    const changedPayload: Record<string, unknown> = { ...originalPayload,
      expectedBefore: { ...(originalPayload.expectedBefore as Record<string, unknown>), status: "PAUSED" },
      desired: { ...(originalPayload.desired as Record<string, unknown>), status: "PAUSED" } };
    const { requestHash: _oldRequestHash, executionRef: _oldExecutionRef, idempotencyKey: _oldIdempotency, ...changedCore } = changedPayload;
    const changedRequestHash = digest(changedCore), changedExecutionRef = `p06_execution_${changedRequestHash.slice(0,24)}`;
    const changedIdempotency = `p06_exec_idem_${digest({ attemptId, grantHash: state.grant.grantHash, requestHash: changedRequestHash })}`;
    const changedFinal = { ...changedCore, executionRef: changedExecutionRef, idempotencyKey: changedIdempotency, requestHash: changedRequestHash };
    await tx.execute(sql`savepoint forged_budget_status`);
    try {
      await tx.execute(sql`insert into p06_execution_runs(workspace_id,guide_run_action_binding_id,action_execution_attempt_id,
        proposal_bundle_id,action_unit_id,decision_event_id,approval_grant_id,execution_ref,idempotency_key,request_hash,
        action_unit_hash,proposal_hash,context_hash,effective_guide_set_hash,resolution_hash,policy_hash,gate_set_hash,
        admission_hash,write_spec_hash,dry_run_hash,action_plan_hash,budget_kind,currency,request_payload,route,created_at)
        select workspace_id,null,action_execution_attempt_id,proposal_bundle_id,action_unit_id,decision_event_id,approval_grant_id,
          ${changedExecutionRef},${changedIdempotency},${changedRequestHash},action_unit_hash,proposal_hash,context_hash,null,null,
          policy_hash,gate_set_hash,admission_hash,write_spec_hash,dry_run_hash,action_plan_hash,budget_kind,currency,
          ${JSON.stringify(changedFinal)}::jsonb,'guide_budget_human_approved',created_at
        from p06_execution_runs where id=${created.executionRunId}::uuid`);
      await tx.execute(sql`release savepoint forged_budget_status`);
    } catch (error) {
      await tx.execute(sql`rollback to savepoint forged_budget_status`);
      const cause = error && typeof error === "object" && "cause" in error ? String(error.cause) : String(error);
      evidence.forgedMirrorStatusRejected = cause.includes("budget execution values invalid");
    }
    if (Object.entries(evidence).filter(([key]) => !["mode","zeroResidue"].includes(key)).some(([, value]) => value !== true))
      throw new Error(`P06 budget behavior PRE başarısız: ${JSON.stringify(evidence)}`);
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
evidence.zeroResidue = (await database.execute(sql`select (select count(*)::int from workspaces where id=${workspaceId}::uuid)
  +(select count(*)::int from p06_execution_runs where workspace_id=${workspaceId}::uuid) count`)).rows[0]?.count === 0;
await pool.end();
if (!evidence.zeroResidue) throw new Error("P06 budget behavior PRE residue bıraktı");
console.log(JSON.stringify(evidence));
