import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DrizzleGuideRunActionBindingRepository } from "@/connectors/guides/guide-run-action-binding-drizzle-repository";
import { DrizzleGuideRunRepository } from "@/connectors/guides/guide-run-drizzle-repository";
import { DrizzleGuideRunStatusActionStager } from "@/connectors/guides/guide-run-status-action-stager";
import { DrizzleGuideRunCandidateStagingContextRepository } from "@/connectors/guides/guide-run-candidate-staging-context-drizzle-repository";
import { DrizzleGuideRunEffectiveOverlapRepository } from "@/connectors/guides/guide-run-effective-overlap-drizzle";
import { DrizzleGuideRunStageableStatusCandidateRepository } from "@/connectors/guides/guide-run-stageable-status-candidate-drizzle-repository";
import { DrizzleOperationReadRepository } from "@/connectors/operations/operation-read-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { DrizzleActionApprovalDecisionRepository } from "@/connectors/actions/action-approval-decision-drizzle-repository";
import { DrizzleP06ExecutionRepository } from "@/connectors/actions/p06-execution-drizzle-repository";
import { DrizzleP06StatusExecutionDispatchAuthorityRepository } from "@/connectors/actions/p06-status-execution-dispatch-authority-drizzle-repository";
import { DrizzleP06LimitedAutonomyAdmissionRepository } from "@/connectors/actions/p06-limited-autonomy-admission-drizzle-repository";
import { DrizzleAutonomyRuleRegistryRepository } from "@/connectors/actions/autonomy-rule-registry-drizzle-repository";
import * as schema from "@/db/schema";
import { appendGuideRunTransitionV12, createGuideRunV12, type GuideRunV12 } from "@/domain/guides/guide-run";
import { canonicalGuideWorkspaceRef, createGuideRevision } from "@/domain/guides/guide-revision";
import { guideRunMembershipEvidenceHash } from "@/domain/guides/guide-run-membership-evidence";
import { metaPublicReference } from "@/domain/meta/public-reference";
import { createApprovalPolicyDraft, publishApprovalPolicy } from "@/domain/actions/approval-policy-registry";
import { createAutonomyRuleDraft, disableAutonomyRule, publishAutonomyRule } from "@/domain/actions/autonomy-rule-registry";
import { createSliceRevision } from "@/domain/slices/slice-definition";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";
import type { P06ExecutionV2Step } from "@/domain/actions/p06-execution-v2";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");
const postMode = process.env.P06_ACTION_BINDINGS_POST_APPROVED === "true";
const executionPreMode = process.env.P06_EXECUTION_CHAIN_PRE === "true";
const executionPostMode = process.env.P06_EXECUTION_CHAIN_POST_APPROVED === "true";
const executionMode = executionPreMode || executionPostMode;
const limitedAutonomyPreMode = process.env.P06_LIMITED_AUTONOMY_PRE === "true";
const limitedAutonomyExecutionPreMode = process.env.P06_LIMITED_AUTONOMY_EXECUTION_PRE === "true";
const pool = new Pool({
  connectionString: databaseUrl,
  max: postMode ? 4 : 1,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
});
const rollback = Symbol("rollback");
const digest = (value: unknown) => {
  const stable = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(stable)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.entries(x as Record<string, unknown>)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => [k, stable(v)]),
          )
        : x;
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
};
const rows = (value: unknown) => (value && typeof value === "object" && "rows" in value && Array.isArray(value.rows) ? (value.rows as readonly Record<string, unknown>[]) : []);
const closed = {
  canMutateGuide: false,
  canApprove: false,
  canExecute: false,
  canWriteMeta: false,
} as const;
const evidence = {
  mode: postMode ? "post_applied_two_client" : executionPreMode ? "execution_pre_outer_rollback" : executionPostMode ? "execution_post_applied_outer_rollback" : limitedAutonomyExecutionPreMode ? "limited_autonomy_execution_pre_outer_rollback" : limitedAutonomyPreMode ? "limited_autonomy_pre_outer_rollback" : "pre_outer_rollback",
  exactMigrationLedger: !postMode,
  preApplyConcurrencySkipped: !postMode,
  separateClients: false,
  concurrentMaterializeAndReplay: false,
  p05Prerequisite: false,
  p06AppliedOuterRollback: false,
  rlsForced: false,
  publicRevoked: false,
  actionQueuePersisted: false,
  completedRun: false,
  serverOwnedStatusCandidate: false,
  materialized: false,
  replay: false,
  staleGuideHeadRejected: false,
  candidateTamperRejected: false,
  refHashAuthorityTamperRejected: false,
  wrongScopeRejected: false,
  crossTenantRejected: false,
  appendDeleteGuard: false,
  tombstonePurge: false,
  zeroResidue: false,
};
const limitedAutonomyEvidence = {
  migrationInstalled: !(limitedAutonomyPreMode || limitedAutonomyExecutionPreMode),
  canonicalSource: !(limitedAutonomyPreMode || limitedAutonomyExecutionPreMode),
  contextAndPolicy: !(limitedAutonomyPreMode || limitedAutonomyExecutionPreMode),
  firstReservation: !(limitedAutonomyPreMode || limitedAutonomyExecutionPreMode),
  exactReplay: !(limitedAutonomyPreMode || limitedAutonomyExecutionPreMode),
  actionPlanBound: !(limitedAutonomyPreMode || limitedAutonomyExecutionPreMode),
  noExecutionAuthority: !(limitedAutonomyPreMode || limitedAutonomyExecutionPreMode),
  nullForgeryRejected: !(limitedAutonomyPreMode || limitedAutonomyExecutionPreMode),
  backdatedAdmissionRejected: !(limitedAutonomyPreMode || limitedAutonomyExecutionPreMode),
  disabledRuleHeld: !(limitedAutonomyPreMode || limitedAutonomyExecutionPreMode),
  tombstonePurge: !(limitedAutonomyPreMode || limitedAutonomyExecutionPreMode),
  zeroResidue: !(limitedAutonomyPreMode || limitedAutonomyExecutionPreMode),
};
const limitedExecutionEvidence = {
  migrationInstalled: !limitedAutonomyExecutionPreMode,
  identityCreated: !limitedAutonomyExecutionPreMode,
  exactReplay: !limitedAutonomyExecutionPreMode,
  noHumanAuthority: !limitedAutonomyExecutionPreMode,
  initialGatesBound: !limitedAutonomyExecutionPreMode,
  runnable: !limitedAutonomyExecutionPreMode,
  currentAuthority: !limitedAutonomyExecutionPreMode,
  backdatedExecutionRejected: !limitedAutonomyExecutionPreMode,
  disabledRuleStopsDispatch: !limitedAutonomyExecutionPreMode,
  tombstonePurge: !limitedAutonomyExecutionPreMode,
  zeroResidue: !limitedAutonomyExecutionPreMode,
};
const executionEvidence = {
  migrationInstalled: !executionMode,
  approvedGrantBound: !executionMode,
  identityCreated: !executionMode,
  pendingScheduled: !executionMode,
  claimed: !executionMode,
  phasedGates: !executionMode,
  tenStepTrace: !executionMode,
  observations: !executionMode,
  terminalSucceeded: !executionMode,
  verificationFailed: !executionMode,
  rollbackPersisted: !executionMode,
  rollbackReplay: !executionMode,
  forgedRollbackRejected: !executionMode,
  immutableRunRejected: !executionMode,
  crossTenantHeadRejected: !executionMode,
  staleFenceRejected: !executionMode,
  callerTimeCannotReclaim: !executionMode,
  forgedEventRejected: !executionMode,
  forgedReceiptCoreRejected: !executionMode,
  leaseEpochRecheck: !executionMode,
  currentDispatchAuthority: !executionMode,
  expiredGrantHeld: !executionMode,
  expiredGrantMaterializationRejected: !executionMode,
  supersededGuideHeld: !executionMode,
};
const mark = (stage: string) => console.log(JSON.stringify({ p06PreStage: stage }));
function transition(run: GuideRunV12, toState: Parameters<typeof appendGuideRunTransitionV12>[1]["toState"], occurredAt: string, token: string): GuideRunV12 {
  return appendGuideRunTransitionV12(run, {
    expectedHeadHash: run.headEventHash,
    toState,
    occurredAt,
    leaseToken: token,
    leaseUntil: "2026-08-17T00:10:00.000Z",
  });
}
async function rejected(
  client: {
    query: (text: string, values?: readonly unknown[]) => Promise<unknown>;
  },
  work: () => Promise<unknown>,
): Promise<boolean> {
  await client.query("savepoint p06_expected_failure");
  try {
    await work();
    await client.query("release savepoint p06_expected_failure");
    return false;
  } catch {
    await client.query("rollback to savepoint p06_expected_failure");
    return true;
  }
}
try {
  const client = await pool.connect();
  try {
    await client.query("begin");
    try {
      const prerequisite = await client.query<{ exists: boolean }>("select to_regclass('public.guide_runs') is not null as exists");
      evidence.p05Prerequisite = prerequisite.rows[0]?.exists === true;
      if (!evidence.p05Prerequisite) throw new Error("P05 prerequisite is not applied");
      const bindingMigration = readFileSync("drizzle/20260817210000_p06_action_bindings.sql", "utf8");
      const requesterMigration = readFileSync("drizzle/20260818000100_p06_agent_action_requester.sql", "utf8");
      const bindingHash = createHash("sha256").update(bindingMigration).digest("hex");
      const requesterHash = createHash("sha256").update(requesterMigration).digest("hex");
      if (postMode || executionMode || limitedAutonomyPreMode || limitedAutonomyExecutionPreMode) {
        const ledger = await client.query<{
          binding_count: number;
          requester_count: number;
          execution_count: number;
        }>("select count(*) filter(where hash=$1 and created_at=1787000400000)::int binding_count,count(*) filter(where hash=$2 and created_at=1787011260000)::int requester_count,count(*) filter(where hash=$3 and created_at=1787011380000)::int execution_count from drizzle.__drizzle_migrations", [bindingHash, requesterHash, createHash("sha256").update(readFileSync("drizzle/20260818000300_p06_execution_persistence.sql", "utf8")).digest("hex")]);
        evidence.exactMigrationLedger = ledger.rows[0]?.binding_count === 1 && ledger.rows[0]?.requester_count === 1 && (!executionPostMode || ledger.rows[0]?.execution_count === 1);
      } else {
        await client.query(bindingMigration);
        await client.query(requesterMigration);
      }
      if (executionPreMode) {
        await client.query(readFileSync("drizzle/20260818000300_p06_execution_persistence.sql", "utf8"));
        executionEvidence.migrationInstalled = true;
      }
      if (executionPostMode) executionEvidence.migrationInstalled = true;
      if (limitedAutonomyPreMode) {
        await client.query(readFileSync("drizzle/20260818000600_p06_limited_autonomy_admissions.sql", "utf8"));
        limitedAutonomyEvidence.migrationInstalled = true;
      }
      if (limitedAutonomyExecutionPreMode) {
        await client.query(readFileSync("drizzle/20260818000700_p06_limited_autonomy_execution.sql", "utf8"));
        limitedAutonomyEvidence.migrationInstalled = true;
        limitedExecutionEvidence.migrationInstalled = true;
      }
      mark(postMode ? "applied_migrations_verified" : "migration_installed_outer_rollback");
      const shape = await client.query<{ force: boolean }>("select relforcerowsecurity force from pg_class where oid='public.guide_run_action_bindings'::regclass");
      evidence.p06AppliedOuterRollback = shape.rows.length === 1;
      evidence.rlsForced = shape.rows[0]?.force === true;
      const grants = await client.query<{ n: string }>("select count(*)::text n from information_schema.role_table_grants where table_schema='public' and table_name='guide_run_action_bindings' and grantee in ('PUBLIC','anon','authenticated','service_role')");
      evidence.publicRevoked = grants.rows[0]?.n === "0";
      const workspaceId = randomUUID(),
        foreignWorkspaceId = randomUUID(),
        actorId = randomUUID();
      const guideId = randomUUID(),
        revisionId = randomUUID(),
        dimensionId = randomUUID(),
        marketId = randomUUID();
      const sliceId = randomUUID(),
        sliceRevisionId = randomUUID(),
        organizationCampaignId = randomUUID();
      const connectionId = randomUUID(),
        sourceId = randomUUID(),
        accountId = randomUUID(),
        campaignId = randomUUID(),
        adSetId = randomUUID(),
        contextId = randomUUID();
      const creativeId = randomUUID(),
        adId = randomUUID();
      const workspaceRef = canonicalGuideWorkspaceRef(workspaceId);
      const sliceRevision = createSliceRevision({
        sliceRef: "slice_p06_fixture",
        revisionRef: "slice_revision_p06",
        revisionNumber: 1,
        market: {
          dimensionId: categoryDimensionPublicRef("market"),
          valueId: categoryDefinitionPublicRef("market", "yerli"),
          key: "yerli",
        },
        predicates: [],
      });
      const guide = createGuideRevision({
        workspaceRef,
        guideRef: "guide_p06_binding_fixture",
        revision: 1,
        previousRevisionHash: null,
        sliceRef: sliceRevision.sliceRef,
        market: "yerli",
        freeText: "P06 status adset fixture",
        strict: {
          budgetRefs: [],
          rollbackConditions: [],
          budgetInterpretation: null,
        },
        schedule: {
          frequency: "daily",
          timezone: "Europe/Istanbul",
          localTime: "09:00",
        },
        mode: limitedAutonomyPreMode || limitedAutonomyExecutionPreMode ? "limited_autonomy" : "prepare_human_approval",
        actionAllowlist: ["status_pause"],
      });
      const guideRef = guide.guideRef,
        revisionHash = guide.revisionHash;
      await client.query("set local session_replication_role=replica");
      await client.query("insert into workspaces(id,name) values($1,'P06 binding'),($2,'P06 foreign')", [workspaceId, foreignWorkspaceId]);
      await client.query("insert into users(id,email) values($1,$2)", [actorId, `p06-${actorId}@invalid.local`]);
      await client.query("insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')", [workspaceId, actorId]);
      await client.query("insert into category_dimensions(id,workspace_id,key,name,cardinality,allowed_entity_levels) values($1,$2,'market','Market','single',array['campaign','ad_set']::category_entity_level[])", [dimensionId, workspaceId]);
      await client.query("insert into category_definitions(id,workspace_id,dimension_id,key,label) values($1,$2,$3,'yerli','Yerli')", [marketId, workspaceId, dimensionId]);
      await client.query("insert into slices(id,workspace_id,slice_ref,label,market_definition_id,created_by_actor_id) values($1,$2,$3,'P06 scope',$4,$5)", [sliceId, workspaceId, sliceRevision.sliceRef, marketId, actorId]);
      await client.query("insert into slice_revisions(id,workspace_id,slice_id,slice_ref,revision_number,revision_ref,definition_hash,market_definition_id,lifecycle,created_by_actor_id) values($1,$2,$3,$4,1,$5,$6,$7,'published',$8)", [sliceRevisionId, workspaceId, sliceId, sliceRevision.sliceRef, sliceRevision.revisionRef, sliceRevision.definitionHash, marketId, actorId]);
      await client.query("update slices set current_published_revision_id=$1 where id=$2", [sliceRevisionId, sliceId]);
      await client.query("insert into guides(id,workspace_id,guide_ref,label,slice_id,market_definition_id,created_by_actor_id) values($1,$2,$3,'P06',$4,$5,$6)", [guideId, workspaceId, guideRef, sliceId, marketId, actorId]);
      await client.query("insert into guide_revisions(id,workspace_id,guide_id,guide_ref,revision_number,revision_hash,previous_revision_hash,slice_revision_id,slice_ref,market_definition_id,market_key,free_text,strict_payload,schedule_payload,mode,interpretation_hash,created_by_actor_id) values($1,$2,$3,$4,1,$5,null,$6,$7,$8,'yerli',$9,$10::jsonb,$11::jsonb,$12,$13,$14)", [revisionId, workspaceId, guideId, guideRef, revisionHash, sliceRevisionId, guide.sliceRef, marketId, guide.freeText, JSON.stringify(guide.strict), JSON.stringify(guide.schedule), guide.mode, guide.interpretationHash, actorId]);
      await client.query("insert into guide_revision_actions(workspace_id,guide_revision_id,action,authority) values($1,$2,'status_pause',$3)", [workspaceId, revisionId, limitedAutonomyPreMode || limitedAutonomyExecutionPreMode ? "limited_autonomy" : "human_approval"]);
      await client.query("insert into guide_heads(workspace_id,guide_id,latest_revision_id,current_active_revision_id,version,updated_at) values($1,$2,$3,$3,1,now())", [workspaceId, guideId, revisionId]);
      await client.query("set local session_replication_role=origin");
      const db = drizzle(client, { schema });
      // All repositories below are deliberately given a transaction facade.
      // Their normal nested transaction callbacks therefore stay inside this
      // verifier's one outer BEGIN and can never commit its PRE-only DDL.
      const outerDb: any = {
        execute: db.execute.bind(db),
        select: db.select.bind(db),
        insert: db.insert.bind(db),
        transaction: async (work: (tx: unknown) => Promise<unknown>) => await work(outerDb),
      };
      const statusCandidates = new DrizzleGuideRunStageableStatusCandidateRepository(outerDb);
      await db.insert(schema.metaConnections).values({
        id: connectionId,
        workspaceId,
        externalConnectionKey: "p06-binding",
        displayName: "P06",
        graphApiVersion: "v23.0",
        fieldCatalogVersion: "p06",
      });
      await db.insert(schema.dataSources).values({
        id: sourceId,
        workspaceId,
        metaConnectionId: connectionId,
        platform: "meta_ads",
        externalAccountId: "act_12345",
        displayName: "P06",
      });
      await db.insert(schema.adAccounts).values({
        id: accountId,
        workspaceId,
        dataSourceId: sourceId,
        externalAccountId: "act_12345",
        name: "P06",
        currency: "TRY",
        timezone: "Europe/Istanbul",
      });
      await db.insert(schema.adCampaigns).values({
        id: campaignId,
        workspaceId,
        adAccountId: accountId,
        externalCampaignId: "campaign_12345",
        name: "P06",
      });
      await db.insert(schema.metaAdSets).values({
        id: adSetId,
        workspaceId,
        adAccountId: accountId,
        campaignId,
        externalAdSetId: "adset_12345",
        name: "P06",
        configuredStatus: "ACTIVE",
        effectiveStatus: "ACTIVE",
        targetingSummary: {},
        targetingSignature: "targeting_p06",
        rawPayloadHash: "d".repeat(64),
        sourceGraphVersion: "fixture",
        fieldCatalogVersion: "fixture",
        provenance: {},
      });
      await db.insert(schema.metaCreatives).values({
        id: creativeId,
        workspaceId,
        adAccountId: accountId,
        externalCreativeId: "creative_12345",
        name: "P06",
        sourceType: "image",
        primaryText: "P06",
        contentProvenance: {},
        rawPayloadHash: "e".repeat(64),
        sourceGraphVersion: "fixture",
        fieldCatalogVersion: "fixture",
        provenance: {},
      });
      await db.insert(schema.metaAds).values({
        id: adId,
        workspaceId,
        adAccountId: accountId,
        campaignId,
        adSetId,
        creativeId,
        externalAdId: "ad_12345",
        name: "P06",
        configuredStatus: "ACTIVE",
        effectiveStatus: "ACTIVE",
        rawPayloadHash: "f".repeat(64),
        sourceGraphVersion: "fixture",
        fieldCatalogVersion: "fixture",
        provenance: {},
      });
      const healthEnd = new Date();
      healthEnd.setUTCHours(0, 0, 0, 0);
      healthEnd.setUTCDate(healthEnd.getUTCDate() - 1);
      for (let offset = 6; offset >= 0; offset -= 1) {
        const day = new Date(healthEnd);
        day.setUTCDate(healthEnd.getUTCDate() - offset);
        const date = day.toISOString().slice(0, 10);
        const insightId = randomUUID();
        await db.insert(schema.metaDailyInsights).values({
          id: insightId,
          workspaceId,
          metaConnectionId: connectionId,
          adAccountId: accountId,
          entityLevel: "ad_set",
          externalEntityId: "adset_12345",
          dateStart: date,
          dateStop: date,
          attributionLabel: "7d_click",
          currency: "TRY",
          timezone: "Europe/Istanbul",
          sourceRevision: "fixture",
          sourcePayloadHash: digest({ date }),
        });
      }
      for (const streamType of ["inventory", "creative", "insights"] as const) {
        await db.insert(schema.metaSyncStreams).values({
          workspaceId,
          metaConnectionId: connectionId,
          adAccountId: accountId,
          streamType,
          status: "completed",
          checkpoint: {},
          sourceRevision: "fixture",
        });
      }
      await client.query("insert into category_assignments(workspace_id,dimension_id,definition_id,entity_level,campaign_id,operation,source,evidence,confidence) values($1,$2,$3,'campaign',$4,'add','manual',$5::jsonb,1)", [workspaceId, dimensionId, marketId, campaignId, JSON.stringify([{ kind: "fixture", ref: "p06-market" }])]);
      await client.query("insert into organization_campaigns(id,workspace_id,label,market_definition_id,created_by_actor_id) values($1,$2,'P06 org',$3,$4)", [organizationCampaignId, workspaceId, marketId, actorId]);
      await client.query("insert into organization_campaign_meta_memberships(workspace_id,organization_campaign_id,campaign_id,market_definition_id,effective_from,assigned_by_actor_id) values($1,$2,$3,$4,now(),$5)", [workspaceId, organizationCampaignId, campaignId, marketId, actorId]);
      const contextHash = "c".repeat(64);
      const capturedAt = new Date("2026-08-17T00:00:00.000Z"),
        snapshotRefs = ["snapshot_aaaaaaaaaaaaaaaaaaaa"];
      await db.insert(schema.effectiveCampaignContexts).values({
        id: contextId,
        workspaceId,
        identityHash: "d".repeat(64),
        contextHash,
        schemaVersion: "effective-campaign-context/1.0.0",
        metaConnectionId: connectionId,
        adAccountId: accountId,
        campaignId,
        connectionRef: "p06-binding",
        accountRef: "act_12345",
        campaignRef: "campaign_12345",
        entityType: "ad_set",
        entityRef: "adset_12345",
        capturedAt,
        snapshotRefs,
        contextPayload: {
          workspaceId,
          schemaVersion: "effective-campaign-context/1.0.0",
          contextHash,
          capturedAt: capturedAt.toISOString(),
          identity: {
            connectionRef: "p06-binding",
            accountRef: "act_12345",
            campaignRef: "campaign_12345",
            entityType: "ad_set",
            entityRef: "adset_12345",
          },
          data: { snapshotRefs },
          capabilities: {
            containsRawL0: false,
            canAuthorizeAction: false,
            canExecuteWrite: false,
          },
        },
      });
      await db.insert(schema.effectiveCampaignContextComponents).values({
        workspaceId,
        contextId,
        componentType: "policy_authority",
        componentRef: "policy_authority_p06",
        componentVersion: "e".repeat(64),
      });
      const memberRef = metaPublicReference("ad_set", workspaceId, adSetId);
      const scopeReader = new DrizzleOperationReadRepository(outerDb);
      const currentScope = await scopeReader.currentSliceEvidenceInTransaction(outerDb, workspaceId, sliceRevision.sliceRef);
      const membership = currentScope.resolution?.included.find((item) => item.entityRef === memberRef && item.entityLevel === "ad_set");
      if (!membership || !currentScope.revisionRef || !currentScope.definitionHash) throw new Error("canonical_scope_fixture_missing");
      const membershipHash = guideRunMembershipEvidenceHash({
        sliceRef: sliceRevision.sliceRef,
        revisionRef: currentScope.revisionRef,
        definitionHash: currentScope.definitionHash,
        membership,
      });
      const policyDraft = createApprovalPolicyDraft({
        workspaceRef,
        applicability: { actionType: "status_pause", risk: "K2" },
        policy: {
          version: "action-approval-policy/1.0.0",
          policyRef: "policy_p06",
          revision: 1,
          autonomyMode: "approval_only",
          requesterRoles: ["agent"],
          approverRoles: [{ risk: "K2", roles: ["owner"] }],
          grantConsumerRoles: ["owner"],
          separationOfDutiesRisks: [],
          maximumProtectionEvidenceAgeSeconds: 3600,
          maximumProposalLifetimeSeconds: 604800,
          maximumGrantLifetimeSeconds: 300,
        },
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        expiresAt: null,
        normalizedBy: { actorRef: "actor_policy_author", role: "admin" },
      });
      const publishedPolicy = publishApprovalPolicy({
        draft: policyDraft,
        actor: { actorRef: "actor_policy_publisher", role: "owner" },
        decisionRef: "decision_policy_p06",
        reasonRef: "reason_policy_p06",
        publishedAt: "2026-08-02T00:00:00.000Z",
      });
      for (const artifact of [policyDraft, publishedPolicy]) {
        await db.insert(schema.approvalPolicyDefinitionRevisions).values({
          workspaceId,
          workspaceRef,
          policyRef: artifact.policyRef,
          revision: artifact.revision,
          previousHash: artifact.previousHash,
          schemaVersion: artifact.version,
          actionType: artifact.applicability.actionType,
          risk: artifact.applicability.risk,
          state: artifact.state,
          effectiveFrom: new Date(artifact.effectiveFrom),
          expiresAt: null,
          normalizedByActorRef: artifact.provenance.normalizedByActorRef,
          normalizedByRole: artifact.provenance.normalizedByRole,
          publishedByActorRef: artifact.provenance.publishedByActorRef,
          publishedByRole: artifact.provenance.publishedByRole,
          publicationDecisionRef: artifact.provenance.publicationDecisionRef,
          publicationReasonRef: artifact.provenance.publicationReasonRef,
          publishedAt: artifact.provenance.publishedAt ? new Date(artifact.provenance.publishedAt) : null,
          disabledByActorRef: null,
          disabledByRole: null,
          disableDecisionRef: null,
          disableReasonRef: null,
          disabledAt: null,
          policyHash: artifact.policyHash,
          canonicalHash: artifact.canonicalHash,
          policyPayload: artifact.policy,
          artifactPayload: artifact,
        });
      }
      let limitedActionRulePublished: ReturnType<typeof publishAutonomyRule> | null = null;
      if (limitedAutonomyPreMode || limitedAutonomyExecutionPreMode) {
        const ruleEffectiveFrom = new Date(Date.now() - 3_600_000).toISOString();
        const rulePublishedAt = new Date(Date.parse(ruleEffectiveFrom) + 1_000).toISOString();
        const autonomyRegistry = new DrizzleAutonomyRuleRegistryRepository(outerDb, workspaceId, workspaceRef);
        const workspaceRuleDraft = createAutonomyRuleDraft({
          ruleRef: "autonomy_p06_limited_workspace",
          revision: 1,
          workspaceRef,
          scope: { level: "workspace", ref: workspaceRef },
          mode: "policy_limited",
          effectiveFrom: ruleEffectiveFrom,
          expiresAt: null,
          killSwitch: false,
          maximumActionsPerRun: 2,
          normalizedBy: { actorRef: "actor_p06_autonomy_author", role: "admin" },
          sourceGuidanceRefs: [],
        });
        const workspaceRulePublished = publishAutonomyRule({
          draft: workspaceRuleDraft,
          actor: { actorRef: "actor_p06_autonomy_owner", role: "owner" },
          decisionRef: "decision_p06_autonomy_workspace",
          reasonRef: "reason_p06_bounded_status_pause",
          publishedAt: rulePublishedAt,
        });
        const actionRuleDraft = createAutonomyRuleDraft({
          ruleRef: "autonomy_p06_limited_status_pause",
          revision: 1,
          workspaceRef,
          scope: { level: "action_type", actionType: "status_pause" },
          mode: "policy_limited",
          effectiveFrom: ruleEffectiveFrom,
          expiresAt: null,
          killSwitch: false,
          maximumActionsPerRun: 1,
          normalizedBy: { actorRef: "actor_p06_autonomy_author", role: "admin" },
          sourceGuidanceRefs: [],
        });
        limitedActionRulePublished = publishAutonomyRule({
          draft: actionRuleDraft,
          actor: { actorRef: "actor_p06_autonomy_owner", role: "owner" },
          decisionRef: "decision_p06_autonomy_status_pause",
          reasonRef: "reason_p06_bounded_status_pause",
          publishedAt: rulePublishedAt,
        });
        for (const artifact of [workspaceRuleDraft, workspaceRulePublished, actionRuleDraft, limitedActionRulePublished]) {
          await autonomyRegistry.append(artifact);
        }
      }
      const scopes = scopeReader;
      const contexts = new DrizzleGuideRunCandidateStagingContextRepository(outerDb, new DrizzleGuideRunEffectiveOverlapRepository(outerDb));
      const stager = new DrizzleGuideRunStatusActionStager(contexts, scopes);
      const runs = new DrizzleGuideRunRepository(outerDb);
      const makeCompleted = async (requestRef: string, token: string) => {
        let run = createGuideRunV12({
          workspaceRef,
          guideRef,
          guideRevisionHash: revisionHash,
          trigger: { kind: "manual", requestRef },
          occurredAt: "2026-08-17T00:00:00.000Z",
        });
        await runs.insertIfAbsent(run);
        run = transition(run, "claimed", "2026-08-17T00:00:01.000Z", token);
        if (
          !(await runs.compareAndSet({
            run,
            expectedHeadHash: run.events.at(-2)!.eventHash,
          }))
        )
          throw new Error("run_cas_failed");
        const members = [{ memberRef, membershipHash }];
        const scopePayload = {
          runRef: run.runRef,
          guideRevisionHash: revisionHash,
          sliceRef: sliceRevision.sliceRef,
          sliceDefinitionHash: currentScope.definitionHash!,
          sliceSnapshotHash: digest({
            guideRevisionHash: revisionHash,
            sliceRef: sliceRevision.sliceRef,
            sliceDefinitionHash: currentScope.definitionHash!,
            members,
          }),
          members,
        };
        await runs.append({
          artifactRef: `guide_run_artifact_${digest({ runRef: run.runRef, kind: "scope_snapshot", payload: scopePayload }).slice(0, 24)}`,
          runRef: run.runRef,
          kind: "scope_snapshot",
          payload: scopePayload,
          payloadHash: digest(scopePayload),
          occurredAt: "2026-08-17T00:00:01.500Z",
          authority: closed,
          immutable: true,
        });
        const statusCandidate = await statusCandidates.loadInTransaction(outerDb, {
          runRef: run.runRef,
          guideRevisionHash: revisionHash,
          sliceSnapshotHash: scopePayload.sliceSnapshotHash,
          member: members[0]!,
        });
        if (!statusCandidate) throw new Error("server_owned_status_candidate_missing");
        evidence.serverOwnedStatusCandidate =
          statusCandidate.action === "status_pause" &&
          statusCandidate.stageable.entityRef === memberRef &&
          statusCandidate.stageable.membershipHash === membershipHash &&
          statusCandidate.stageable.typedAction.kind === "status_change" &&
          statusCandidate.stageable.typedAction.fromStatus === "ACTIVE" &&
          statusCandidate.stageable.typedAction.toStatus === "PAUSED";
        for (const [state, at] of [
          ["scope_frozen", "2026-08-17T00:00:02.000Z"],
          ["analyzing", "2026-08-17T00:00:03.000Z"],
          ["recorded", "2026-08-17T00:00:04.000Z"],
          ["staged", "2026-08-17T00:00:05.000Z"],
        ] as const) {
          run = transition(run, state, at, token);
          if (
            !(await runs.compareAndSet({
              run,
              expectedHeadHash: run.events.at(-2)!.eventHash,
            }))
          )
            throw new Error("run_cas_failed");
        }
        const stageable = statusCandidate.stageable;
        const candidate = {
          candidateRef: "candidate_p06_fixture",
          candidateHash: digest({
            candidateRef: "candidate_p06_fixture",
            action: statusCandidate.action,
            ...stageable,
          }),
          action: statusCandidate.action,
          routing: limitedAutonomyPreMode || limitedAutonomyExecutionPreMode ? "limited_autonomy_review" as const : "human_approval" as const,
          stageable,
        };
        const payload = {
          disposition: {
            state: "staged",
            reason: "candidate_ready",
            recommendationRef: "recommendation_p06_fixture",
            candidate,
            authority: {
              canApprove: false,
              canExecute: false,
              canWriteMeta: false,
              canEnableAutomation: false,
            },
          },
          trusted: { dataQuality: "ready", evidenceHash: "1".repeat(64) },
          analysisOutcome: "finding",
          guideRevisionHash: revisionHash,
          mode: guide.mode,
          actionAllowlist: [candidate.action],
        } as const;
        await runs.append({
          artifactRef: `guide_run_artifact_${digest({ runRef: run.runRef, kind: "disposition", payload }).slice(0, 24)}`,
          runRef: run.runRef,
          kind: "disposition",
          payload,
          payloadHash: digest(payload),
          occurredAt: "2026-08-17T00:00:05.500Z",
          authority: closed,
          immutable: true,
        });
        run = transition(run, "completed", "2026-08-17T00:00:06.000Z", token);
        if (
          !(await runs.compareAndSet({
            run,
            expectedHeadHash: run.events.at(-2)!.eventHash,
          }))
        )
          throw new Error("run_cas_failed");
        return run;
      };
      const first = await makeCompleted("request_p06_first", "11111111-1111-4111-8111-111111111111");
      mark("completed_run_and_disposition_artifact_persisted");
      evidence.completedRun = first.state === "completed";
      if (limitedAutonomyPreMode || limitedAutonomyExecutionPreMode) {
        let limitedExecutionForKill: Awaited<ReturnType<DrizzleP06ExecutionRepository["createLimitedAutonomyStatus"]>> | null = null;
        limitedAutonomyEvidence.canonicalSource = first.state === "completed" && guide.mode === "limited_autonomy";
        const authorityBefore = rows(await db.execute(sql`select
          (select count(*)::int from action_proposal_units where workspace_id=${workspaceId}::uuid) units,
          (select count(*)::int from guide_run_action_bindings where workspace_id=${workspaceId}::uuid) bindings,
          (select count(*)::int from action_approval_decision_events where workspace_id=${workspaceId}::uuid) decisions,
          (select count(*)::int from action_approval_evidence_grants where workspace_id=${workspaceId}::uuid) grants`))[0];
        const limitedRepository = new DrizzleP06LimitedAutonomyAdmissionRepository(outerDb, contexts, scopes);
        const saved = await limitedRepository.reserve({ workspaceId, runRef: first.runRef });
        const replay = await limitedRepository.reserve({ workspaceId, runRef: first.runRef });
        const admission = rows(await db.execute(sql`select admission_hash,quota_ordinal,maximum_actions_per_run,context_hash,
          approval_policy_hash,autonomy_evidence_hash,action_plan_hash,admission_payload
          from p06_limited_autonomy_admissions where workspace_id=${workspaceId}::uuid and id=${saved.admissionId}::uuid`))[0];
        limitedAutonomyEvidence.firstReservation = saved.replay === false && saved.quotaOrdinal === 1;
        limitedAutonomyEvidence.exactReplay = replay.replay === true && replay.admissionId === saved.admissionId
          && replay.admissionHash === saved.admissionHash && replay.quotaOrdinal === 1;
        limitedAutonomyEvidence.contextAndPolicy = typeof admission?.context_hash === "string"
          && typeof admission?.approval_policy_hash === "string"
          && admission.approval_policy_hash === publishedPolicy.policyHash
          && typeof admission?.autonomy_evidence_hash === "string" && admission.maximum_actions_per_run === 1;
        const admissionPayload = admission?.admission_payload as Record<string, unknown> | undefined;
        const embeddedPlan = admissionPayload?.actionPlan as Record<string, unknown> | undefined;
        limitedAutonomyEvidence.actionPlanBound = admission?.action_plan_hash === embeddedPlan?.planHash
          && embeddedPlan?.disposition === "policy_limited_candidate"
          && (embeddedPlan?.capabilities as Record<string, unknown> | undefined)?.canExecute === false;
        const authorityAfter = rows(await db.execute(sql`select
          (select count(*)::int from action_proposal_units where workspace_id=${workspaceId}::uuid) units,
          (select count(*)::int from guide_run_action_bindings where workspace_id=${workspaceId}::uuid) bindings,
          (select count(*)::int from action_approval_decision_events where workspace_id=${workspaceId}::uuid) decisions,
          (select count(*)::int from action_approval_evidence_grants where workspace_id=${workspaceId}::uuid) grants`))[0];
        limitedAutonomyEvidence.noExecutionAuthority = JSON.stringify(authorityBefore) === JSON.stringify(authorityAfter)
          && (admissionPayload?.authority as Record<string, unknown> | undefined)?.canExecute === false
          && (admissionPayload?.authority as Record<string, unknown> | undefined)?.canWriteMeta === false;
        if (limitedAutonomyExecutionPreMode) {
          const executionRepository = new DrizzleP06ExecutionRepository(outerDb);
          const evaluatedAtRow = rows(await db.execute(sql`select to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') evaluated_at`))[0];
          const evaluatedAt = String(evaluatedAtRow?.evaluated_at);
          const base = Date.parse(evaluatedAt);
          const gates = ["staging", "admission"].map((phase, index) => ({
            phase: phase as "staging" | "admission", enabled: true, allowlistHash: digest({ phase, workspaceRef, accountRef: "act_p06_fixture" }),
            capturedAt: new Date(base - 2 + index).toISOString(), expiresAt: new Date(base + 60_000).toISOString(),
          }));
          const execution = await executionRepository.createLimitedAutonomyStatus({ workspaceId, admissionId: saved.admissionId, evaluatedAt, gates });
          limitedExecutionForKill = execution;
          const executionReplay = await executionRepository.createLimitedAutonomyStatus({ workspaceId, admissionId: saved.admissionId, evaluatedAt, gates });
          const executionRow = rows(await db.execute(sql`select route,limited_autonomy_admission_id::text admission_id,
            proposal_bundle_id,action_unit_id,decision_event_id,approval_grant_id,request_hash,request_payload
            from p06_execution_runs where workspace_id=${workspaceId}::uuid and id=${execution.executionRunId}::uuid`))[0];
          limitedExecutionEvidence.identityCreated = execution.request.action === "status_pause"
            && executionRow?.route === "limited_autonomy_status" && executionRow?.admission_id === saved.admissionId;
          limitedExecutionEvidence.exactReplay = executionReplay.executionRunId === execution.executionRunId
            && executionReplay.requestHash === execution.requestHash;
          limitedExecutionEvidence.noHumanAuthority = executionRow?.proposal_bundle_id === null && executionRow?.action_unit_id === null
            && executionRow?.decision_event_id === null && executionRow?.approval_grant_id === null;
          const gateRows = rows(await db.execute(sql`select phase,enabled from p06_execution_gate_snapshots
            where workspace_id=${workspaceId}::uuid and execution_run_id=${execution.executionRunId}::uuid order by sequence`));
          limitedExecutionEvidence.initialGatesBound = gateRows.length === 2 && gateRows.every((gate) => gate.enabled === true)
            && gateRows.map((gate) => gate.phase).join(",") === "staging,admission";
          const runnable = await executionRepository.listRunnableByRoute("limited_autonomy_status", 10);
          limitedExecutionEvidence.runnable = runnable.includes(execution.executionRef);
          const authority = await new DrizzleP06StatusExecutionDispatchAuthorityRepository(outerDb, contexts).revalidate({
            phase: "pre_dispatch", executionRef: execution.executionRef, request: execution.request,
          });
          limitedExecutionEvidence.currentAuthority = authority.allowed;
        }

        const second = await makeCompleted("request_p06_limited_kill", "22222222-2222-4222-8222-222222222222");
        const secondSource = rows(await db.execute(sql`select r.id::text run_id,a.id::text artifact_id
          from guide_runs r join guide_run_artifacts a on a.workspace_id=r.workspace_id and a.run_id=r.id and a.kind='disposition'
          where r.workspace_id=${workspaceId}::uuid and r.run_ref=${second.runRef}`))[0];
        limitedAutonomyEvidence.nullForgeryRejected = Boolean(secondSource)
          && await rejected(client, async () => {
            await client.query("set local session_replication_role=replica");
            await client.query(`insert into p06_limited_autonomy_admissions(id,workspace_id,run_id,guide_revision_id,disposition_artifact_id,
              member_ref,membership_hash,entity_ref,account_ref,campaign_ref,action_type,expected_status,desired_status,context_hash,effective_guide_set_hash,resolution_hash,
              data_health_report_hash,approval_policy_hash,protection_hash,autonomy_evidence_hash,action_plan_hash,maximum_actions_per_run,quota_ordinal,admitted_at,expires_at,admission_hash,admission_payload,version,created_at)
              select gen_random_uuid(),workspace_id,$1::uuid,guide_revision_id,$2::uuid,
              member_ref,membership_hash,entity_ref,account_ref,campaign_ref,action_type,expected_status,desired_status,context_hash,effective_guide_set_hash,resolution_hash,
              data_health_report_hash,approval_policy_hash,protection_hash,autonomy_evidence_hash,action_plan_hash,maximum_actions_per_run,1,admitted_at,expires_at,admission_hash,
              jsonb_set(admission_payload,'{entityRef}','null'::jsonb),version,created_at
              from p06_limited_autonomy_admissions where id=$3::uuid`, [secondSource!.run_id, secondSource!.artifact_id, saved.admissionId]);
          });
        limitedAutonomyEvidence.backdatedAdmissionRejected = Boolean(secondSource)
          && await rejected(client, () => client.query(`with source as (
              select admission.*, $1::uuid target_run_id, $2::uuid target_artifact_id,
                date_trunc('milliseconds',transaction_timestamp()-interval '1 second') stale_at,
                date_trunc('milliseconds',transaction_timestamp()+interval '4 minutes') stale_expires
              from p06_limited_autonomy_admissions admission where admission.id=$3::uuid
            ), payload as (
              select source.*,
                jsonb_set(jsonb_set(jsonb_set(admission_payload-'admissionHash','{admittedAt}',
                  to_jsonb(to_char(stale_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'{expiresAt}',
                  to_jsonb(to_char(stale_expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'{quotaOrdinal}','1'::jsonb) core
              from source
            ), canonical as (
              select payload.*,public.guide_run_sha256(core) canonical_hash from payload
            ) insert into p06_limited_autonomy_admissions(workspace_id,run_id,guide_revision_id,disposition_artifact_id,
              member_ref,membership_hash,entity_ref,account_ref,campaign_ref,action_type,expected_status,desired_status,context_hash,effective_guide_set_hash,resolution_hash,
              data_health_report_hash,approval_policy_hash,protection_hash,autonomy_evidence_hash,action_plan_hash,maximum_actions_per_run,quota_ordinal,admitted_at,expires_at,admission_hash,admission_payload)
            select workspace_id,target_run_id,guide_revision_id,target_artifact_id,
              member_ref,membership_hash,entity_ref,account_ref,campaign_ref,action_type,expected_status,desired_status,context_hash,effective_guide_set_hash,resolution_hash,
              data_health_report_hash,approval_policy_hash,protection_hash,autonomy_evidence_hash,action_plan_hash,maximum_actions_per_run,1,stale_at,stale_expires,canonical_hash,
              core||jsonb_build_object('admissionHash',canonical_hash) from canonical`, [secondSource!.run_id, secondSource!.artifact_id, saved.admissionId]));
        if (limitedAutonomyExecutionPreMode) {
          const secondAdmission = await limitedRepository.reserve({ workspaceId, runRef: second.runRef });
          const secondTime = rows(await db.execute(sql`select to_char(admitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') admitted_at
            from p06_limited_autonomy_admissions where workspace_id=${workspaceId}::uuid and id=${secondAdmission.admissionId}::uuid`))[0];
          const backdatedAt = String(secondTime?.admitted_at);
          const backdatedBase = Date.parse(backdatedAt);
          limitedExecutionEvidence.backdatedExecutionRejected = await rejected(client, () =>
            new DrizzleP06ExecutionRepository(outerDb).createLimitedAutonomyStatus({
              workspaceId, admissionId: secondAdmission.admissionId, evaluatedAt: backdatedAt,
              gates: ["staging", "admission"].map((phase, index) => ({
                phase: phase as "staging" | "admission", enabled: true,
                allowlistHash: digest({ phase, workspaceRef, accountRef: "act_p06_fixture" }),
                capturedAt: new Date(backdatedBase - 2 + index).toISOString(),
                expiresAt: new Date(backdatedBase + 60_000).toISOString(),
              })),
            }));
        }
        const currentActionRule = limitedActionRulePublished;
        if (!currentActionRule) throw new Error("limited autonomy action rule missing");
        const disabledRule = disableAutonomyRule({
          current: currentActionRule,
          actor: { actorRef: "actor_p06_autonomy_owner", role: "owner" },
          decisionRef: "decision_p06_disable_status_pause",
          reasonRef: "reason_p06_kill_switch_drill",
          disabledAt: new Date().toISOString(),
        });
        await new DrizzleAutonomyRuleRegistryRepository(outerDb, workspaceId, workspaceRef).append(disabledRule);
        if (limitedAutonomyExecutionPreMode && limitedExecutionForKill) {
          const authorityAfterKill = await new DrizzleP06StatusExecutionDispatchAuthorityRepository(outerDb, contexts).revalidate({
            phase: "pre_dispatch", executionRef: limitedExecutionForKill.executionRef, request: limitedExecutionForKill.request,
          });
          limitedExecutionEvidence.disabledRuleStopsDispatch = !authorityAfterKill.allowed;
        }
        const disabledRun = await makeCompleted("request_p06_limited_disabled", "33333333-3333-4333-8333-333333333333");
        try {
          await limitedRepository.reserve({ workspaceId, runRef: disabledRun.runRef });
        } catch {
          limitedAutonomyEvidence.disabledRuleHeld = true;
        }

        const purge = new DrizzleWorkspaceTombstonePurgePort();
        await client.query("update workspaces set lifecycle_state='tombstoning' where id=$1::uuid", [workspaceId]);
        const inspection = await purge.inspect(outerDb, workspaceId);
        await purge.purge(outerDb, { workspaceId, expectedRevision: inspection.revision });
        const remaining = await client.query<{ n: string }>("select ((select count(*) from p06_limited_autonomy_admissions where workspace_id=$1::uuid)+(select count(*) from p06_execution_runs where workspace_id=$1::uuid)+(select count(*) from p06_execution_heads where workspace_id=$1::uuid)+(select count(*) from p06_execution_gate_snapshots where workspace_id=$1::uuid)+(select count(*) from p06_execution_events where workspace_id=$1::uuid)+(select count(*) from p06_execution_observations where workspace_id=$1::uuid)+(select count(*) from p06_rollback_proposals where workspace_id=$1::uuid)+(select count(*) from guide_runs where workspace_id=$1::uuid)+(select count(*) from guide_run_artifacts where workspace_id=$1::uuid))::text n", [workspaceId]);
        limitedAutonomyEvidence.tombstonePurge = remaining.rows[0]?.n === "0";
        limitedExecutionEvidence.tombstonePurge = remaining.rows[0]?.n === "0";
        throw rollback;
      }
      const binding = new DrizzleGuideRunActionBindingRepository(outerDb, stager);
      const saved = await binding.bind({ workspaceId, runRef: first.runRef });
      const replay = await binding.bind({ workspaceId, runRef: first.runRef });
      evidence.materialized = saved.replay === false;
      evidence.replay = replay.replay === true && replay.bindingId === saved.bindingId;
      evidence.actionQueuePersisted = rows(await db.execute(sql`select count(*)::int count from action_proposal_units where workspace_id=${workspaceId}::uuid`))[0]?.count === 1;
      const second = await makeCompleted("request_p06_second", "22222222-2222-4222-8222-222222222222");
      if (executionMode) {
        const unit = rows(await db.execute(sql`select b.action_unit_ref,u.id::text unit_id from guide_run_action_bindings b join action_proposal_units u on u.workspace_id=b.workspace_id and u.id=b.action_unit_id where b.workspace_id=${workspaceId}::uuid and b.id=${saved.bindingId}::uuid`))[0];
        if (!unit || typeof unit.action_unit_ref !== "string") throw new Error("execution unit missing");
        const decisions = new DrizzleActionApprovalDecisionRepository(outerDb, workspaceId);
        const decisionSnapshot = await decisions.loadForDecision({
          workspaceId,
          unitRef: unit.action_unit_ref,
        });
        if (!decisionSnapshot) throw new Error("execution decision snapshot missing");
        const baseTime = new Date();
        const iso = (seconds: number) => new Date(baseTime.getTime() + seconds * 1000).toISOString();
        const decided = await decisions.decideAtomically({
          workspaceId,
          unitRef: unit.action_unit_ref,
          expectedTraceHash: decisionSnapshot.lifecycle.traceHash,
          buildCommand: async (snapshot) => {
            const approvedUnit = snapshot.lifecycle.bundle.units.find((candidate) => candidate.unitRef === unit.action_unit_ref)!;
            return {
              kind: "approve",
              commandRef: `decision_execution_${digest({ workspaceId })}`,
              unitRef: unit.action_unit_ref as string,
              actor: {
                actorRef: "actor_execution_owner",
                role: "owner" as const,
              },
              decidedAt: iso(0),
              reasonCode: "human.execution_approved",
              freshness: snapshot.freshness,
              authorization: {
                authorizationRef: `presence_${digest({ workspaceId }).slice(0, 24)}`,
                unitRef: unit.action_unit_ref as string,
                unitHash: approvedUnit.unitHash,
                scopeHash: approvedUnit.scopeHash,
                actor: {
                  actorRef: "actor_execution_owner",
                  role: "owner" as const,
                },
                issuedAt: iso(-1),
                expiresAt: iso(120),
                humanPresence: true as const,
                canExecute: false as const,
              },
              grantRef: `grant_execution_${digest({ workspaceId }).slice(0, 24)}`,
            };
          },
        });
        const approval = rows(await db.execute(sql`select d.id::text decision_id,g.id::text grant_id from action_approval_decision_events d join action_approval_evidence_grants g on g.workspace_id=d.workspace_id and g.decision_event_id=d.id where d.workspace_id=${workspaceId}::uuid and d.unit_id=${unit.unit_id}::uuid and d.command_kind='approve'`))[0];
        if (!approval || typeof approval.decision_id !== "string" || typeof approval.grant_id !== "string") throw new Error("execution approval missing");
        executionEvidence.approvedGrantBound = decided.lifecycle.units[0]?.state === "approved";
        const execution = new DrizzleP06ExecutionRepository(outerDb);
        const dispatchAuthority = new DrizzleP06StatusExecutionDispatchAuthorityRepository(outerDb, contexts);
        const gate = (phase: "staging" | "admission" | "post_claim" | "pre_dispatch" | "read_after_write", seconds: number) => ({
          phase,
          enabled: true,
          allowlistHash: digest({ workspaceId, phase }),
          capturedAt: iso(seconds),
          expiresAt: iso(600),
        });
        const identity = await execution.materializeHumanApprovedUnit({
          workspaceId,
          unitRef: unit.action_unit_ref,
          evaluatedAt: iso(2),
          gates: [gate("staging", 0), gate("admission", 1)],
        });
        executionEvidence.identityCreated = /^p06_execution_/.test(identity.executionRef);
        executionEvidence.pendingScheduled = (await execution.listRunnable(10)).includes(identity.executionRef);
        executionEvidence.currentDispatchAuthority = (await dispatchAuthority.revalidate({
          phase: "pre_dispatch",
          executionRef: identity.executionRef,
          request: identity.request,
        })).allowed;
        await client.query("savepoint p06_expired_grant_authority");
        await client.query("set local session_replication_role=replica");
        await client.query("update action_approval_evidence_grants set approved_at=date_trunc('milliseconds',statement_timestamp()-interval '2 seconds'),expires_at=date_trunc('milliseconds',statement_timestamp()-interval '1 second'),grant_payload=jsonb_set(jsonb_set(grant_payload,'{approvedAt}',to_jsonb(to_char((statement_timestamp()-interval '2 seconds') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))),'{expiresAt}',to_jsonb(to_char((statement_timestamp()-interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))) where id=$1::uuid", [approval.grant_id]);
        await client.query("set local session_replication_role=origin");
        executionEvidence.expiredGrantHeld = !(await dispatchAuthority.revalidate({
          phase: "pre_dispatch",
          executionRef: identity.executionRef,
          request: identity.request,
        })).allowed;
        await client.query("rollback to savepoint p06_expired_grant_authority");
        executionEvidence.immutableRunRejected = await rejected(client, () => client.query("update p06_execution_runs set request_hash=$1 where id=$2::uuid", ["0".repeat(64), identity.executionRunId]));
        executionEvidence.crossTenantHeadRejected = await rejected(client, () => client.query("insert into p06_execution_heads(workspace_id,execution_run_id,state,sequence,trace_sequence) values($1::uuid,$2::uuid,'pending',0,0)", [foreignWorkspaceId, identity.executionRunId]));
        const claim = await execution.claimLease({
          executionRef: identity.executionRef,
          leaseTokenHash: "3".repeat(64),
          fenceHash: "4".repeat(64),
          now: iso(3),
          leaseUntil: iso(600),
        });
        executionEvidence.claimed = claim.core.owned;
        const trace = async (step: P06ExecutionV2Step, outcome: "ok" | "skipped" | "held" | "ambiguous" | "already_applied", receiptCore: Record<string, unknown>, seconds: number) =>
          await execution.appendTrace({
            executionRef: identity.executionRef,
            leaseTokenHash: "3".repeat(64),
            fenceHash: "4".repeat(64),
            step,
            outcome,
            receiptCore,
            occurredAt: iso(seconds),
          });
        try {
          await execution.appendTrace({
            executionRef: identity.executionRef,
            leaseTokenHash: "3".repeat(64),
            fenceHash: "9".repeat(64),
            step: "lease",
            outcome: "ok",
            receiptCore: claim.core,
            occurredAt: iso(4),
          });
        } catch {
          executionEvidence.staleFenceRejected = true;
        }
        executionEvidence.forgedEventRejected = await rejected(client, () => client.query("insert into p06_execution_events(workspace_id,execution_run_id,event_ref,event_hash,sequence,event_kind,outcome,previous_hash,receipt_hash,payload,occurred_at) values($1::uuid,$2::uuid,$3,$4,2,'trace','ok',$5,$6,'{}'::jsonb,$7::timestamptz)", [workspaceId, identity.executionRunId, `p06_exec_event_${"8".repeat(24)}`, "8".repeat(64), "7".repeat(64), "6".repeat(64), iso(4)]));
        executionEvidence.forgedReceiptCoreRejected = await rejected(client, () => execution.appendTrace({
          executionRef: identity.executionRef, leaseTokenHash: "3".repeat(64), fenceHash: "4".repeat(64), step: "lease", outcome: "ok",
          receiptCore: { executionRef: identity.executionRef, leaseTokenHash: "9".repeat(64), fenceHash: "4".repeat(64), owned: true }, occurredAt: iso(4),
        }));
        await trace("lease", "ok", claim.core, 4);
        const idemCore = {
          kind: "fresh",
          executionRef: identity.executionRef,
          idempotencyKey: identity.idempotencyKey,
          fenceHash: "4".repeat(64),
        };
        await trace("idempotency", "ok", idemCore, 5);
        await execution.appendGate({
          executionRef: identity.executionRef,
          gate: gate("post_claim", 6),
        });
        const beforeCore = {
          workspaceRef,
          accountRef: "act_12345",
          entityRef: "adset_12345",
          value: { status: "ACTIVE", budgetMinor: null },
          observedAt: iso(7),
          rawHash: "5".repeat(64),
        };
        const beforeEvent = await trace("current_meta_read", "ok", beforeCore, 7);
        const before = await execution.appendObservation({
          executionRef: identity.executionRef,
          eventHash: beforeEvent.eventHash,
          kind: "read_before",
          metadataHash: digest(beforeCore),
          rawHash: "5".repeat(64),
          observedValue: beforeCore.value,
          observedAt: iso(7),
        });
        await trace("expected_before", "ok", beforeCore, 8);
        await execution.appendGate({
          executionRef: identity.executionRef,
          gate: gate("pre_dispatch", 9),
        });
        const writeCore = {
          executionRef: identity.executionRef,
          idempotencyKey: identity.idempotencyKey,
          entityRef: "adset_12345",
          action: "status_pause",
          kind: "written",
          rawHash: "6".repeat(64),
        };
        const writeEvent = await trace("typed_mutation", "ok", writeCore, 10);
        const write = await execution.appendObservation({
          executionRef: identity.executionRef,
          eventHash: writeEvent.eventHash,
          kind: "write_receipt",
          metadataHash: digest(writeCore),
          rawHash: "6".repeat(64),
          observedValue: { status: "PAUSED", budgetMinor: null },
          observedAt: iso(10),
        });
        const afterCore = {
          workspaceRef,
          accountRef: "act_12345",
          entityRef: "adset_12345",
          value: { status: "PAUSED", budgetMinor: null },
          observedAt: iso(11),
          rawHash: "7".repeat(64),
        };
        const rawCore = {
          beforeRawHash: "5".repeat(64),
          writeRawHash: "6".repeat(64),
          afterRawHash: "7".repeat(64),
          writeReceiptHash: digest(writeCore),
          afterRead: afterCore,
        };
        const rawEvent = await trace("raw", "ok", rawCore, 11);
        const after = await execution.appendObservation({
          executionRef: identity.executionRef,
          eventHash: rawEvent.eventHash,
          kind: "read_after",
          metadataHash: digest(afterCore),
          rawHash: "7".repeat(64),
          observedValue: afterCore.value,
          observedAt: iso(11),
        });
        await execution.appendGate({
          executionRef: identity.executionRef,
          gate: gate("read_after_write", 12),
        });
        await trace(
          "already_applied_no_second_write",
          "skipped",
          {
            executionRef: identity.executionRef,
            step: "already_applied_no_second_write",
            skipped: true,
          },
          13,
        );
        await trace(
          "ambiguous_read_before_retry",
          "skipped",
          {
            executionRef: identity.executionRef,
            step: "ambiguous_read_before_retry",
            skipped: true,
          },
          14,
        );
        const terminalCore = {
          executionRef: identity.executionRef,
          outcome: "written_verified",
          writeReceiptHash: digest(writeCore),
          fenceHash: "4".repeat(64),
        };
        await trace("immutable_terminal", "ok", terminalCore, 15);
        await trace(
          "release",
          "ok",
          {
            executionRef: identity.executionRef,
            leaseTokenHash: "3".repeat(64),
            fenceHash: "4".repeat(64),
            released: true,
          },
          16,
        );
        const persisted = rows(await db.execute(sql`select h.state,h.trace_sequence,(select count(*)::int from p06_execution_events e where e.workspace_id=h.workspace_id and e.execution_run_id=h.execution_run_id and e.event_kind='trace') traces,(select count(*)::int from p06_execution_gate_snapshots g where g.workspace_id=h.workspace_id and g.execution_run_id=h.execution_run_id) gates,(select count(*)::int from p06_execution_observations o where o.workspace_id=h.workspace_id and o.execution_run_id=h.execution_run_id) observations from p06_execution_heads h join p06_execution_runs r on r.workspace_id=h.workspace_id and r.id=h.execution_run_id where r.execution_ref=${identity.executionRef}`))[0];
        executionEvidence.phasedGates = persisted?.gates === 5;
        executionEvidence.tenStepTrace = persisted?.traces === 10 && persisted?.trace_sequence === 10;
        executionEvidence.observations = persisted?.observations === 3 && Boolean(before.observationId && write.observationId && after.observationId);
        executionEvidence.terminalSucceeded = persisted?.state === "succeeded";

        const failedBinding = await binding.bind({
          workspaceId,
          runRef: second.runRef,
        });
        const failedUnit = rows(await db.execute(sql`select b.action_unit_ref,u.id::text unit_id from guide_run_action_bindings b join action_proposal_units u on u.workspace_id=b.workspace_id and u.id=b.action_unit_id where b.workspace_id=${workspaceId}::uuid and b.id=${failedBinding.bindingId}::uuid`))[0];
        if (!failedUnit || typeof failedUnit.action_unit_ref !== "string" || typeof failedUnit.unit_id !== "string") throw new Error("failed execution unit missing");
        const failedDecisionSnapshot = await decisions.loadForDecision({
          workspaceId,
          unitRef: failedUnit.action_unit_ref,
        });
        if (!failedDecisionSnapshot) throw new Error("failed execution decision snapshot missing");
        await decisions.decideAtomically({
          workspaceId,
          unitRef: failedUnit.action_unit_ref,
          expectedTraceHash: failedDecisionSnapshot.lifecycle.traceHash,
          buildCommand: async (snapshot) => {
            const approvedUnit = snapshot.lifecycle.bundle.units.find((candidate) => candidate.unitRef === failedUnit.action_unit_ref)!;
            return {
              kind: "approve",
              commandRef: `decision_execution_failure_${digest({ workspaceId })}`,
              unitRef: failedUnit.action_unit_ref as string,
              actor: {
                actorRef: "actor_execution_failure_owner",
                role: "owner" as const,
              },
              decidedAt: iso(18),
              reasonCode: "human.execution_failure_fixture_approved",
              freshness: snapshot.freshness,
              authorization: {
                authorizationRef: `presence_failure_${digest({ workspaceId }).slice(0, 24)}`,
                unitRef: failedUnit.action_unit_ref as string,
                unitHash: approvedUnit.unitHash,
                scopeHash: approvedUnit.scopeHash,
                actor: {
                  actorRef: "actor_execution_failure_owner",
                  role: "owner" as const,
                },
                issuedAt: iso(17),
                expiresAt: iso(180),
                humanPresence: true as const,
                canExecute: false as const,
              },
              grantRef: `grant_execution_failure_${digest({ workspaceId }).slice(0, 24)}`,
            };
          },
        });
        const failedApproval = rows(await db.execute(sql`select d.id::text decision_id,g.id::text grant_id from action_approval_decision_events d join action_approval_evidence_grants g on g.workspace_id=d.workspace_id and g.decision_event_id=d.id where d.workspace_id=${workspaceId}::uuid and d.unit_id=${failedUnit.unit_id}::uuid and d.command_kind='approve'`))[0];
        if (!failedApproval || typeof failedApproval.decision_id !== "string" || typeof failedApproval.grant_id !== "string") throw new Error("failed execution approval missing");
        await client.query("savepoint p06_expired_grant_materialization");
        await client.query("set local session_replication_role=replica");
        await client.query("update action_approval_evidence_grants set approved_at=date_trunc('milliseconds',statement_timestamp()-interval '2 seconds'),expires_at=date_trunc('milliseconds',statement_timestamp()-interval '1 second'),grant_payload=jsonb_set(jsonb_set(grant_payload,'{approvedAt}',to_jsonb(to_char((statement_timestamp()-interval '2 seconds') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))),'{expiresAt}',to_jsonb(to_char((statement_timestamp()-interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))) where id=$1::uuid", [failedApproval.grant_id]);
        await client.query("set local session_replication_role=origin");
        try {
          await execution.materializeHumanApprovedUnit({
            workspaceId,
            unitRef: failedUnit.action_unit_ref,
            evaluatedAt: iso(-10),
            gates: [gate("staging", -12), gate("admission", -11)],
          });
        } catch {
          executionEvidence.expiredGrantMaterializationRejected = true;
        }
        await client.query("rollback to savepoint p06_expired_grant_materialization");
        const failedIdentity = await execution.materializeHumanApprovedUnit({
          workspaceId,
          unitRef: failedUnit.action_unit_ref,
          evaluatedAt: iso(20),
          gates: [gate("staging", 18), gate("admission", 19)],
        });
        let failedLeaseTokenHash = "a".repeat(64);
        let failedFenceHash = "b".repeat(64);
        const failedLeaseClock = rows(await db.execute(sql`select to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') now`))[0];
        const failedLeaseNow = String(failedLeaseClock?.now);
        const failedLeaseUntil = new Date(Date.parse(failedLeaseNow) + 15_000).toISOString();
        const failedClaim = await execution.claimLease({
          executionRef: failedIdentity.executionRef,
          leaseTokenHash: failedLeaseTokenHash,
          fenceHash: failedFenceHash,
          now: failedLeaseNow,
          leaseUntil: failedLeaseUntil,
        });
        const failedTrace = async (step: P06ExecutionV2Step, outcome: "ok" | "skipped" | "held" | "ambiguous" | "already_applied", receiptCore: Record<string, unknown>, seconds: number) =>
          await execution.appendTrace({
            executionRef: failedIdentity.executionRef,
            leaseTokenHash: failedLeaseTokenHash,
            fenceHash: failedFenceHash,
            step,
            outcome,
            receiptCore,
            occurredAt: iso(seconds),
          });
        await failedTrace("lease", "ok", failedClaim.core, 22);
        const failedIdemCore = {
          kind: "fresh",
          executionRef: failedIdentity.executionRef,
          idempotencyKey: failedIdentity.idempotencyKey,
          fenceHash: "b".repeat(64),
        };
        await failedTrace("idempotency", "ok", failedIdemCore, 23);
        await execution.appendGate({
          executionRef: failedIdentity.executionRef,
          gate: gate("post_claim", 24),
        });
        const failedBeforeCore = {
          workspaceRef,
          accountRef: "act_12345",
          entityRef: "adset_12345",
          value: { status: "ACTIVE" as const, budgetMinor: null },
          observedAt: iso(25),
          rawHash: "c".repeat(64),
        };
        const failedBeforeEvent = await failedTrace("current_meta_read", "ok", failedBeforeCore, 25);
        const failedBefore = await execution.appendObservation({
          executionRef: failedIdentity.executionRef,
          eventHash: failedBeforeEvent.eventHash,
          kind: "read_before",
          metadataHash: digest(failedBeforeCore),
          rawHash: "c".repeat(64),
          observedValue: failedBeforeCore.value,
          observedAt: iso(25),
        });
        await failedTrace("expected_before", "ok", failedBeforeCore, 26);
        try {
          await execution.claimLease({
            executionRef: failedIdentity.executionRef,
            leaseTokenHash: "1".repeat(64),
            fenceHash: "2".repeat(64),
            now: iso(28),
            leaseUntil: iso(600),
          });
        } catch {
          executionEvidence.callerTimeCannotReclaim = true;
        }
        await db.execute(sql`select pg_sleep(15.1)`);
        const reclaimClock = rows(await db.execute(sql`select to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') now`))[0];
        const reclaimNow = String(reclaimClock?.now);
        failedLeaseTokenHash = "1".repeat(64);
        failedFenceHash = "2".repeat(64);
        await execution.claimLease({
          executionRef: failedIdentity.executionRef,
          leaseTokenHash: failedLeaseTokenHash,
          fenceHash: failedFenceHash,
          now: reclaimNow,
          leaseUntil: new Date(Date.parse(reclaimNow) + 600_000).toISOString(),
        });
        await execution.appendGate({
          executionRef: failedIdentity.executionRef,
          gate: gate("post_claim", 29),
        });
        await execution.appendGate({
          executionRef: failedIdentity.executionRef,
          gate: gate("pre_dispatch", 30),
        });
        const failedWriteCore = {
          executionRef: failedIdentity.executionRef,
          idempotencyKey: failedIdentity.idempotencyKey,
          entityRef: "adset_12345",
          action: "status_pause",
          kind: "written",
          rawHash: "d".repeat(64),
        };
        const failedWriteEvent = await failedTrace("typed_mutation", "ok", failedWriteCore, 31);
        const failedWrite = await execution.appendObservation({
          executionRef: failedIdentity.executionRef,
          eventHash: failedWriteEvent.eventHash,
          kind: "write_receipt",
          metadataHash: digest(failedWriteCore),
          rawHash: "d".repeat(64),
          observedValue: { status: "PAUSED", budgetMinor: null },
          observedAt: iso(31),
        });
        const failedAfterCore = {
          workspaceRef,
          accountRef: "act_12345",
          entityRef: "adset_12345",
          value: { status: "ACTIVE" as const, budgetMinor: null },
          observedAt: iso(32),
          rawHash: "e".repeat(64),
        };
        const failedRawCore = {
          beforeRawHash: "c".repeat(64),
          writeRawHash: "d".repeat(64),
          afterRawHash: "e".repeat(64),
          writeReceiptHash: digest(failedWriteCore),
          afterRead: failedAfterCore,
        };
        const failedRawEvent = await failedTrace("raw", "ok", failedRawCore, 32);
        const failedAfter = await execution.appendObservation({
          executionRef: failedIdentity.executionRef,
          eventHash: failedRawEvent.eventHash,
          kind: "read_after",
          metadataHash: digest(failedAfterCore),
          rawHash: "e".repeat(64),
          observedValue: failedAfterCore.value,
          observedAt: iso(32),
        });
        await execution.appendGate({
          executionRef: failedIdentity.executionRef,
          gate: gate("read_after_write", 33),
        });
        await failedTrace(
          "already_applied_no_second_write",
          "skipped",
          {
            executionRef: failedIdentity.executionRef,
            step: "already_applied_no_second_write",
            skipped: true,
          },
          34,
        );
        await failedTrace(
          "ambiguous_read_before_retry",
          "skipped",
          {
            executionRef: failedIdentity.executionRef,
            step: "ambiguous_read_before_retry",
            skipped: true,
          },
          35,
        );
        const failedTerminalCore = {
          executionRef: failedIdentity.executionRef,
          outcome: "verification_failed",
          writeReceiptHash: digest(failedWriteCore),
          fenceHash: failedFenceHash,
        };
        const failedTerminal = await failedTrace("immutable_terminal", "ok", failedTerminalCore, 36);
        await failedTrace(
          "release",
          "ok",
          {
            executionRef: failedIdentity.executionRef,
            leaseTokenHash: failedLeaseTokenHash,
            fenceHash: failedFenceHash,
            released: true,
          },
          37,
        );
        const rollbackCore = {
          version: "p06-rollback-proposal/1.0.0" as const,
          executionRef: failedIdentity.executionRef,
          terminalHash: failedTerminal.receiptHash,
          writeReceiptHash: digest(failedWriteCore),
          beforeReadReceiptHash: digest(failedBeforeCore),
          afterReadReceiptHash: digest(failedAfterCore),
          previousObserved: failedBeforeCore.value,
          postWriteObserved: failedAfterCore.value,
          restoreTo: failedBeforeCore.value,
          failedDesired: { status: "PAUSED" as const, budgetMinor: null },
          budgetKind: null,
          currency: null,
          requiresNewHumanApproval: true as const,
        };
        const rollbackProposal = {
          ...rollbackCore,
          proposalHash: digest(rollbackCore),
        };
        executionEvidence.forgedRollbackRejected = await rejected(client, () =>
          execution.appendRollbackProposal({
            proposal: rollbackProposal,
            beforeObservationId: failedBefore.observationId,
            afterObservationId: failedBefore.observationId,
            writeObservationId: failedWrite.observationId,
          }),
        );
        const rollbackSaved = await execution.appendRollbackProposal({
          proposal: rollbackProposal,
          beforeObservationId: failedBefore.observationId,
          afterObservationId: failedAfter.observationId,
          writeObservationId: failedWrite.observationId,
        });
        const rollbackReplay = await execution.appendRollbackProposal({
          proposal: rollbackProposal,
          beforeObservationId: failedBefore.observationId,
          afterObservationId: failedAfter.observationId,
          writeObservationId: failedWrite.observationId,
        });
        const failedPersisted = rows(await db.execute(sql`select h.state,h.lease_epoch,(select count(*)::int from p06_rollback_proposals p where p.workspace_id=h.workspace_id and p.execution_run_id=h.execution_run_id) rollbacks,(select count(*)::int from p06_execution_gate_snapshots g where g.workspace_id=h.workspace_id and g.execution_run_id=h.execution_run_id and g.lease_epoch=2) epoch_two_gates from p06_execution_heads h join p06_execution_runs r on r.workspace_id=h.workspace_id and r.id=h.execution_run_id where r.execution_ref=${failedIdentity.executionRef}`))[0];
        executionEvidence.verificationFailed = failedPersisted?.state === "verification_failed";
        executionEvidence.rollbackPersisted = failedPersisted?.rollbacks === 1 && /^p06_rollback_/.test(rollbackSaved.proposalRef);
        executionEvidence.rollbackReplay = rollbackSaved.rollbackProposalId === rollbackReplay.rollbackProposalId;
        executionEvidence.leaseEpochRecheck = failedPersisted?.lease_epoch === 2 && failedPersisted?.epoch_two_gates === 3;
        await client.query("savepoint p06_superseded_execution_authority");
        await client.query("set local session_replication_role=replica");
        await client.query("update guide_heads set current_active_revision_id=null where workspace_id=$1::uuid and guide_id=$2::uuid", [workspaceId, guideId]);
        await client.query("set local session_replication_role=origin");
        executionEvidence.supersededGuideHeld = !(await dispatchAuthority.revalidate({
          phase: "post_claim",
          executionRef: failedIdentity.executionRef,
          request: failedIdentity.request,
        })).allowed;
        await client.query("rollback to savepoint p06_superseded_execution_authority");
      }
      mark("materializer_and_replay_verified");
      const negativeRun = executionMode ? await makeCompleted("request_p06_negative", "33333333-3333-4333-8333-333333333333") : second;
      mark("second_completed_run_for_negative_matrix_persisted");
      const base = rows(await db.execute(sql`select b.id::text binding_id,a.id::text artifact_id from guide_run_action_bindings b join guide_run_artifacts a on a.workspace_id=b.workspace_id and a.id=b.disposition_artifact_id where b.workspace_id=${workspaceId}::uuid and b.run_id=(select id from guide_runs where workspace_id=${workspaceId}::uuid and run_ref=${first.runRef})`))[0]!;
      const secondIds = rows(await db.execute(sql`select r.id::text run_id,r.guide_revision_id::text revision_id,a.id::text artifact_id,b.action_unit_id::text unit_id,b.proposal_bundle_id::text proposal_id,b.action_unit_ref,b.action_unit_hash,b.proposal_ref,b.proposal_hash,b.entity_ref,b.member_ref,b.membership_hash,b.effective_guide_set_hash,b.resolution_hash from guide_runs r join guide_run_artifacts a on a.workspace_id=r.workspace_id and a.run_id=r.id and a.kind='disposition' cross join lateral (select * from guide_run_action_bindings where workspace_id=${workspaceId}::uuid limit 1) b where r.workspace_id=${workspaceId}::uuid and r.run_ref=${negativeRun.runRef}`))[0]!;
      const insert = (o: Record<string, string> = {}, tenant = workspaceId) => client.query("insert into guide_run_action_bindings(workspace_id,run_id,guide_revision_id,disposition_artifact_id,action_unit_id,proposal_bundle_id,action_unit_ref,action_unit_hash,proposal_ref,proposal_hash,entity_ref,member_ref,membership_hash,slice_ref,market_key,effective_guide_set_hash,resolution_hash) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)", [tenant, secondIds.run_id, secondIds.revision_id, secondIds.artifact_id, secondIds.unit_id, secondIds.proposal_id, o.unitRef ?? secondIds.action_unit_ref, o.unitHash ?? secondIds.action_unit_hash, o.proposalRef ?? secondIds.proposal_ref, o.proposalHash ?? secondIds.proposal_hash, o.entityRef ?? secondIds.entity_ref, o.memberRef ?? secondIds.member_ref, o.membershipHash ?? secondIds.membership_hash, o.sliceRef ?? "slice_p06_fixture", o.marketKey ?? "yerli", o.guideHash ?? secondIds.effective_guide_set_hash, o.resolutionHash ?? secondIds.resolution_hash]);
      evidence.candidateTamperRejected = await rejected(client, async () => {
        await client.query("set local session_replication_role=replica");
        await client.query(
          `with forged as (
             select id,run_ref,kind,jsonb_set(payload,'{disposition,candidate,candidateHash}',to_jsonb(repeat('0',64))) forged_payload
             from guide_run_artifacts where id=$1::uuid
           ) update guide_run_artifacts a set payload=forged.forged_payload,
             payload_hash=public.guide_run_sha256(forged.forged_payload),
             artifact_ref='guide_run_artifact_'||substr(public.guide_run_sha256(jsonb_build_object('runRef',forged.run_ref,'kind',forged.kind,'payload',forged.forged_payload)),1,24)
             from forged where a.id=forged.id`,
          [secondIds.artifact_id],
        );
        await client.query("set local session_replication_role=origin");
        await insert();
      });
      evidence.refHashAuthorityTamperRejected = await rejected(client, async () => {
        await client.query("set local session_replication_role=replica");
        await client.query("update guide_run_artifacts set authority='{}'::jsonb where id=$1::uuid", [secondIds.artifact_id]);
        await client.query("set local session_replication_role=origin");
        await insert();
      });
      mark("artifact_candidate_ref_hash_authority_tamper_rejected");
      evidence.wrongScopeRejected = (await rejected(client, () => insert({ entityRef: "campaign_wrong" }))) && (await rejected(client, () => insert({ sliceRef: "slice_wrong" }))) && (await rejected(client, () => insert({ marketKey: "yabanci" })));
      evidence.crossTenantRejected = await rejected(client, () => insert({}, foreignWorkspaceId));
      mark("scope_and_cross_tenant_rejected");
      evidence.appendDeleteGuard = (await rejected(client, () => client.query("update guide_run_action_bindings set decision='approved' where id=$1::uuid", [base.binding_id]))) && (await rejected(client, () => client.query("delete from guide_run_action_bindings where id=$1::uuid", [base.binding_id])));
      await client.query("savepoint p06_stale_guide_head");
      await client.query("set local session_replication_role=replica");
      await client.query("update guide_heads set current_active_revision_id=null where workspace_id=$1::uuid and guide_id=$2::uuid", [workspaceId, guideId]);
      await client.query("set local session_replication_role=origin");
      try {
        await binding.bind({ workspaceId, runRef: first.runRef });
      } catch {
        evidence.staleGuideHeadRejected = true;
      }
      await client.query("rollback to savepoint p06_stale_guide_head");
      if (postMode) {
        await client.query("commit");
        const left = await pool.connect();
        const right = await pool.connect();
        evidence.separateClients = left !== right;
        const bindingFor = (connection: typeof left) => {
          const database = drizzle(connection, { schema });
          const overlap = new DrizzleGuideRunEffectiveOverlapRepository(database);
          const context = new DrizzleGuideRunCandidateStagingContextRepository(database, overlap);
          const statusStager = new DrizzleGuideRunStatusActionStager(context, new DrizzleOperationReadRepository(database));
          return new DrizzleGuideRunActionBindingRepository(database, statusStager);
        };
        try {
          const [leftResult, rightResult] = await Promise.all([bindingFor(left).bind({ workspaceId, runRef: second.runRef }), bindingFor(right).bind({ workspaceId, runRef: second.runRef })]);
          evidence.concurrentMaterializeAndReplay = leftResult.bindingId === rightResult.bindingId && [leftResult.replay, rightResult.replay].filter(Boolean).length === 1;
        } finally {
          left.release();
          right.release();
        }
        await client.query("begin");
      }
      const purge = new DrizzleWorkspaceTombstonePurgePort();
      await client.query("update workspaces set lifecycle_state='tombstoning' where id=$1::uuid", [workspaceId]);
      const inspection = await purge.inspect(outerDb, workspaceId);
      await purge.purge(outerDb, {
        workspaceId,
        expectedRevision: inspection.revision,
      });
      const remaining = await client.query<{ n: string }>("select ((select count(*) from guide_run_action_bindings where workspace_id=$1::uuid)+(select count(*) from guide_runs where workspace_id=$1::uuid)+(select count(*) from guide_run_artifacts where workspace_id=$1::uuid))::text n", [workspaceId]);
      evidence.tombstonePurge = remaining.rows[0]?.n === "0";
      mark("tombstone_purge_verified");
      if (postMode) await client.query("commit");
      else throw rollback;
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await client.query("rollback").catch(() => undefined);
    }
  } finally {
    client.release();
  }
  const residue = await pool.query<{ n: string }>("select count(*)::text n from pg_class where oid=to_regclass('public.guide_run_action_bindings')");
  evidence.zeroResidue = residue.rows[0]?.n === (postMode || executionMode || limitedAutonomyPreMode || limitedAutonomyExecutionPreMode ? "1" : "0");
  if (limitedAutonomyPreMode || limitedAutonomyExecutionPreMode) {
    const limitedResidue = await pool.query<{ objects: number; rows: number; ledger: number }>(`select
      (select count(*)::int from pg_class where oid=to_regclass('public.p06_limited_autonomy_admissions')) objects,
      0::int rows,
      (select count(*)::int from drizzle.__drizzle_migrations where hash=$1) ledger`, [
      createHash("sha256").update(readFileSync("drizzle/20260818000600_p06_limited_autonomy_admissions.sql", "utf8")).digest("hex"),
    ]);
    limitedAutonomyEvidence.zeroResidue = limitedResidue.rows[0]?.objects === 0 && limitedResidue.rows[0]?.ledger === 0;
    if (limitedAutonomyExecutionPreMode) {
      const executionResidue = await pool.query<{ objects: number; ledger: number }>(`select
        (select count(*)::int from information_schema.columns where table_schema='public' and table_name='p06_execution_runs' and column_name='limited_autonomy_admission_id') objects,
        (select count(*)::int from drizzle.__drizzle_migrations where hash=$1) ledger`, [
        createHash("sha256").update(readFileSync("drizzle/20260818000700_p06_limited_autonomy_execution.sql", "utf8")).digest("hex"),
      ]);
      limitedExecutionEvidence.zeroResidue = executionResidue.rows[0]?.objects === 0 && executionResidue.rows[0]?.ledger === 0;
    }
    if (!Object.values(limitedAutonomyEvidence).every(Boolean) || !Object.values(limitedExecutionEvidence).every(Boolean) || !evidence.exactMigrationLedger || !evidence.zeroResidue) {
      throw new Error(JSON.stringify({ ...evidence, limitedAutonomy: limitedAutonomyEvidence, limitedExecution: limitedExecutionEvidence }));
    }
    console.log(JSON.stringify({ ...evidence, limitedAutonomy: limitedAutonomyEvidence, limitedExecution: limitedExecutionEvidence }));
  } else {
    const required = Object.entries(evidence).filter(([key, value]) => typeof value === "boolean" && key !== "preApplyConcurrencySkipped" && (postMode || (key !== "separateClients" && key !== "concurrentMaterializeAndReplay")));
    if (!required.every(([, value]) => value === true) || evidence.preApplyConcurrencySkipped !== !postMode || !Object.values(executionEvidence).every(Boolean)) throw new Error(JSON.stringify({ ...evidence, execution: executionEvidence }));
    console.log(JSON.stringify({ ...evidence, execution: executionEvidence }));
  }
} finally {
  await pool.end();
}
