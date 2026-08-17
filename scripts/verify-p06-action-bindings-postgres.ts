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
import { DrizzleOperationReadRepository } from "@/connectors/operations/operation-read-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import * as schema from "@/db/schema";
import {
  appendGuideRunTransitionV12,
  createGuideRunV12,
  type GuideRunV12,
} from "@/domain/guides/guide-run";
import {
  canonicalGuideWorkspaceRef,
  createGuideRevision,
} from "@/domain/guides/guide-revision";
import { guideRunMembershipEvidenceHash } from "@/domain/guides/guide-run-membership-evidence";
import { metaPublicReference } from "@/domain/meta/public-reference";
import {
  createApprovalPolicyDraft,
  publishApprovalPolicy,
} from "@/domain/actions/approval-policy-registry";
import { createSliceRevision } from "@/domain/slices/slice-definition";
import {
  categoryDefinitionPublicRef,
  categoryDimensionPublicRef,
} from "@/domain/categories/public-reference";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");
const postMode = process.env.P06_ACTION_BINDINGS_POST_APPROVED === "true";
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
const rows = (value: unknown) =>
  value &&
  typeof value === "object" &&
  "rows" in value &&
  Array.isArray(value.rows)
    ? (value.rows as readonly Record<string, unknown>[])
    : [];
const closed = {
  canMutateGuide: false,
  canApprove: false,
  canExecute: false,
  canWriteMeta: false,
} as const;
const evidence = {
  mode: postMode ? "post_applied_two_client" : "pre_outer_rollback",
  exactMigrationLedger: !postMode,
  preApplyConcurrencySkipped: !postMode,
  separateClients: !postMode,
  concurrentMaterializeAndReplay: !postMode,
  p05Prerequisite: false,
  p06AppliedOuterRollback: false,
  rlsForced: false,
  publicRevoked: false,
  actionQueuePersisted: false,
  completedRun: false,
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
const mark = (stage: string) =>
  console.log(JSON.stringify({ p06PreStage: stage }));
function transition(
  run: GuideRunV12,
  toState: Parameters<typeof appendGuideRunTransitionV12>[1]["toState"],
  occurredAt: string,
  token: string,
): GuideRunV12 {
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
      const prerequisite = await client.query<{ exists: boolean }>(
        "select to_regclass('public.guide_runs') is not null as exists",
      );
      evidence.p05Prerequisite = prerequisite.rows[0]?.exists === true;
      if (!evidence.p05Prerequisite)
        throw new Error("P05 prerequisite is not applied");
      const bindingMigration = readFileSync(
        "drizzle/20260817210000_p06_action_bindings.sql",
        "utf8",
      );
      const requesterMigration = readFileSync(
        "drizzle/20260818000100_p06_agent_action_requester.sql",
        "utf8",
      );
      const bindingHash = createHash("sha256").update(bindingMigration).digest("hex");
      const requesterHash = createHash("sha256").update(requesterMigration).digest("hex");
      if (postMode) {
        const ledger = await client.query<{ binding_count: number; requester_count: number }>(
          "select count(*) filter(where hash=$1 and created_at=1787000400000)::int binding_count,count(*) filter(where hash=$2 and created_at=1787011260000)::int requester_count from drizzle.__drizzle_migrations",
          [bindingHash, requesterHash],
        );
        evidence.exactMigrationLedger =
          ledger.rows[0]?.binding_count === 1 && ledger.rows[0]?.requester_count === 1;
      } else {
        await client.query(bindingMigration);
        await client.query(requesterMigration);
      }
      mark(postMode ? "applied_migrations_verified" : "migration_installed_outer_rollback");
      const shape = await client.query<{ force: boolean }>(
        "select relforcerowsecurity force from pg_class where oid='public.guide_run_action_bindings'::regclass",
      );
      evidence.p06AppliedOuterRollback = shape.rows.length === 1;
      evidence.rlsForced = shape.rows[0]?.force === true;
      const grants = await client.query<{ n: string }>(
        "select count(*)::text n from information_schema.role_table_grants where table_schema='public' and table_name='guide_run_action_bindings' and grantee in ('PUBLIC','anon','authenticated','service_role')",
      );
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
        mode: "prepare_human_approval",
        actionAllowlist: ["status_pause"],
      });
      const guideRef = guide.guideRef,
        revisionHash = guide.revisionHash;
      await client.query("set local session_replication_role=replica");
      await client.query(
        "insert into workspaces(id,name) values($1,'P06 binding'),($2,'P06 foreign')",
        [workspaceId, foreignWorkspaceId],
      );
      await client.query("insert into users(id,email) values($1,$2)", [
        actorId,
        `p06-${actorId}@invalid.local`,
      ]);
      await client.query(
        "insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')",
        [workspaceId, actorId],
      );
      await client.query(
        "insert into category_dimensions(id,workspace_id,key,name,cardinality,allowed_entity_levels) values($1,$2,'market','Market','single',array['campaign','ad_set']::category_entity_level[])",
        [dimensionId, workspaceId],
      );
      await client.query(
        "insert into category_definitions(id,workspace_id,dimension_id,key,label) values($1,$2,$3,'yerli','Yerli')",
        [marketId, workspaceId, dimensionId],
      );
      await client.query(
        "insert into slices(id,workspace_id,slice_ref,label,market_definition_id,created_by_actor_id) values($1,$2,$3,'P06 scope',$4,$5)",
        [sliceId, workspaceId, sliceRevision.sliceRef, marketId, actorId],
      );
      await client.query(
        "insert into slice_revisions(id,workspace_id,slice_id,slice_ref,revision_number,revision_ref,definition_hash,market_definition_id,lifecycle,created_by_actor_id) values($1,$2,$3,$4,1,$5,$6,$7,'published',$8)",
        [
          sliceRevisionId,
          workspaceId,
          sliceId,
          sliceRevision.sliceRef,
          sliceRevision.revisionRef,
          sliceRevision.definitionHash,
          marketId,
          actorId,
        ],
      );
      await client.query(
        "update slices set current_published_revision_id=$1 where id=$2",
        [sliceRevisionId, sliceId],
      );
      await client.query(
        "insert into guides(id,workspace_id,guide_ref,label,slice_id,market_definition_id,created_by_actor_id) values($1,$2,$3,'P06',$4,$5,$6)",
        [guideId, workspaceId, guideRef, sliceId, marketId, actorId],
      );
      await client.query(
        "insert into guide_revisions(id,workspace_id,guide_id,guide_ref,revision_number,revision_hash,previous_revision_hash,slice_revision_id,slice_ref,market_definition_id,market_key,free_text,strict_payload,schedule_payload,mode,interpretation_hash,created_by_actor_id) values($1,$2,$3,$4,1,$5,null,$6,$7,$8,'yerli',$9,$10::jsonb,$11::jsonb,$12,$13,$14)",
        [
          revisionId,
          workspaceId,
          guideId,
          guideRef,
          revisionHash,
          sliceRevisionId,
          guide.sliceRef,
          marketId,
          guide.freeText,
          JSON.stringify(guide.strict),
          JSON.stringify(guide.schedule),
          guide.mode,
          guide.interpretationHash,
          actorId,
        ],
      );
      await client.query(
        "insert into guide_revision_actions(workspace_id,guide_revision_id,action,authority) values($1,$2,'status_pause','human_approval')",
        [workspaceId, revisionId],
      );
      await client.query(
        "insert into guide_heads(workspace_id,guide_id,latest_revision_id,current_active_revision_id,version,updated_at) values($1,$2,$3,$3,1,now())",
        [workspaceId, guideId, revisionId],
      );
      await client.query("set local session_replication_role=origin");
      const db = drizzle(client, { schema });
      // All repositories below are deliberately given a transaction facade.
      // Their normal nested transaction callbacks therefore stay inside this
      // verifier's one outer BEGIN and can never commit its PRE-only DDL.
      const outerDb: any = {
        execute: db.execute.bind(db),
        select: db.select.bind(db),
        insert: db.insert.bind(db),
        transaction: async (work: (tx: unknown) => Promise<unknown>) =>
          await work(outerDb),
      };
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
      await client.query(
        "insert into category_assignments(workspace_id,dimension_id,definition_id,entity_level,campaign_id,operation,source,evidence,confidence) values($1,$2,$3,'campaign',$4,'add','manual',$5::jsonb,1)",
        [
          workspaceId,
          dimensionId,
          marketId,
          campaignId,
          JSON.stringify([{ kind: "fixture", ref: "p06-market" }]),
        ],
      );
      await client.query(
        "insert into organization_campaigns(id,workspace_id,label,market_definition_id,created_by_actor_id) values($1,$2,'P06 org',$3,$4)",
        [organizationCampaignId, workspaceId, marketId, actorId],
      );
      await client.query(
        "insert into organization_campaign_meta_memberships(workspace_id,organization_campaign_id,campaign_id,market_definition_id,effective_from,assigned_by_actor_id) values($1,$2,$3,$4,now(),$5)",
        [workspaceId, organizationCampaignId, campaignId, marketId, actorId],
      );
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
      const currentScope = await scopeReader.currentSliceEvidenceInTransaction(
        outerDb,
        workspaceId,
        sliceRevision.sliceRef,
      );
      const membership = currentScope.resolution?.included.find(
        (item) => item.entityRef === memberRef && item.entityLevel === "ad_set",
      );
      if (
        !membership ||
        !currentScope.revisionRef ||
        !currentScope.definitionHash
      )
        throw new Error("canonical_scope_fixture_missing");
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
          publishedAt: artifact.provenance.publishedAt
            ? new Date(artifact.provenance.publishedAt)
            : null,
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
      const scopes = scopeReader;
      const contexts = new DrizzleGuideRunCandidateStagingContextRepository(
        outerDb,
        new DrizzleGuideRunEffectiveOverlapRepository(outerDb),
      );
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
        const stageable = {
          version: "candidate/1.1" as const,
          entityRef: memberRef,
          entityLevel: "adset" as const,
          membershipHash,
          sliceRef: "slice_p06_fixture",
          market: "yerli" as const,
          typedAction: {
            kind: "status_change",
            entity: { level: "adset", ref: memberRef },
            fromStatus: "ACTIVE",
            toStatus: "PAUSED",
          },
        };
        const candidate = {
          candidateRef: "candidate_p06_fixture",
          candidateHash: digest({
            candidateRef: "candidate_p06_fixture",
            action: "status_pause",
            ...stageable,
          }),
          action: "status_pause" as const,
          routing: "human_approval" as const,
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
      const first = await makeCompleted(
        "request_p06_first",
        "11111111-1111-4111-8111-111111111111",
      );
      mark("completed_run_and_disposition_artifact_persisted");
      evidence.completedRun = first.state === "completed";
      const binding = new DrizzleGuideRunActionBindingRepository(
        outerDb,
        stager,
      );
      const saved = await binding.bind({ workspaceId, runRef: first.runRef });
      const replay = await binding.bind({ workspaceId, runRef: first.runRef });
      evidence.materialized = saved.replay === false;
      evidence.replay =
        replay.replay === true && replay.bindingId === saved.bindingId;
      evidence.actionQueuePersisted =
        rows(
          await db.execute(
            sql`select count(*)::int count from action_proposal_units where workspace_id=${workspaceId}::uuid`,
          ),
        )[0]?.count === 1;
      mark("materializer_and_replay_verified");
      const second = await makeCompleted(
        "request_p06_second",
        "22222222-2222-4222-8222-222222222222",
      );
      mark("second_completed_run_for_negative_matrix_persisted");
      const base = rows(
        await db.execute(
          sql`select b.id::text binding_id,a.id::text artifact_id from guide_run_action_bindings b join guide_run_artifacts a on a.workspace_id=b.workspace_id and a.id=b.disposition_artifact_id where b.workspace_id=${workspaceId}::uuid and b.run_id=(select id from guide_runs where workspace_id=${workspaceId}::uuid and run_ref=${first.runRef})`,
        ),
      )[0]!;
      const secondIds = rows(
        await db.execute(
          sql`select r.id::text run_id,r.guide_revision_id::text revision_id,a.id::text artifact_id,b.action_unit_id::text unit_id,b.proposal_bundle_id::text proposal_id,b.action_unit_ref,b.action_unit_hash,b.proposal_ref,b.proposal_hash,b.entity_ref,b.member_ref,b.membership_hash,b.effective_guide_set_hash,b.resolution_hash from guide_runs r join guide_run_artifacts a on a.workspace_id=r.workspace_id and a.run_id=r.id and a.kind='disposition' cross join lateral (select * from guide_run_action_bindings where workspace_id=${workspaceId}::uuid limit 1) b where r.workspace_id=${workspaceId}::uuid and r.run_ref=${second.runRef}`,
        ),
      )[0]!;
      const insert = (o: Record<string, string> = {}, tenant = workspaceId) =>
        client.query(
          "insert into guide_run_action_bindings(workspace_id,run_id,guide_revision_id,disposition_artifact_id,action_unit_id,proposal_bundle_id,action_unit_ref,action_unit_hash,proposal_ref,proposal_hash,entity_ref,member_ref,membership_hash,slice_ref,market_key,effective_guide_set_hash,resolution_hash) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
          [
            tenant,
            secondIds.run_id,
            secondIds.revision_id,
            secondIds.artifact_id,
            secondIds.unit_id,
            secondIds.proposal_id,
            o.unitRef ?? secondIds.action_unit_ref,
            o.unitHash ?? secondIds.action_unit_hash,
            o.proposalRef ?? secondIds.proposal_ref,
            o.proposalHash ?? secondIds.proposal_hash,
            o.entityRef ?? secondIds.entity_ref,
            o.memberRef ?? secondIds.member_ref,
            o.membershipHash ?? secondIds.membership_hash,
            o.sliceRef ?? "slice_p06_fixture",
            o.marketKey ?? "yerli",
            o.guideHash ?? secondIds.effective_guide_set_hash,
            o.resolutionHash ?? secondIds.resolution_hash,
          ],
        );
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
      evidence.refHashAuthorityTamperRejected = await rejected(
        client,
        async () => {
          await client.query("set local session_replication_role=replica");
          await client.query(
            "update guide_run_artifacts set authority='{}'::jsonb where id=$1::uuid",
            [secondIds.artifact_id],
          );
          await client.query("set local session_replication_role=origin");
          await insert();
        },
      );
      mark("artifact_candidate_ref_hash_authority_tamper_rejected");
      evidence.wrongScopeRejected =
        (await rejected(client, () =>
          insert({ entityRef: "campaign_wrong" }),
        )) &&
        (await rejected(client, () => insert({ sliceRef: "slice_wrong" }))) &&
        (await rejected(client, () => insert({ marketKey: "yabanci" })));
      evidence.crossTenantRejected = await rejected(client, () =>
        insert({}, foreignWorkspaceId),
      );
      mark("scope_and_cross_tenant_rejected");
      evidence.appendDeleteGuard =
        (await rejected(client, () =>
          client.query(
            "update guide_run_action_bindings set decision='approved' where id=$1::uuid",
            [base.binding_id],
          ),
        )) &&
        (await rejected(client, () =>
          client.query(
            "delete from guide_run_action_bindings where id=$1::uuid",
            [base.binding_id],
          ),
        ));
      await client.query("savepoint p06_stale_guide_head");
      await client.query("set local session_replication_role=replica");
      await client.query(
        "update guide_heads set current_active_revision_id=null where workspace_id=$1::uuid and guide_id=$2::uuid",
        [workspaceId, guideId],
      );
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
          const statusStager = new DrizzleGuideRunStatusActionStager(
            context,
            new DrizzleOperationReadRepository(database),
          );
          return new DrizzleGuideRunActionBindingRepository(database, statusStager);
        };
        try {
          const [leftResult, rightResult] = await Promise.all([
            bindingFor(left).bind({ workspaceId, runRef: second.runRef }),
            bindingFor(right).bind({ workspaceId, runRef: second.runRef }),
          ]);
          evidence.concurrentMaterializeAndReplay =
            leftResult.bindingId === rightResult.bindingId &&
            [leftResult.replay, rightResult.replay].filter(Boolean).length === 1;
        } finally {
          left.release();
          right.release();
        }
        await client.query("begin");
      }
      const purge = new DrizzleWorkspaceTombstonePurgePort();
      await client.query(
        "update workspaces set lifecycle_state='tombstoning' where id=$1::uuid",
        [workspaceId],
      );
      const inspection = await purge.inspect(outerDb, workspaceId);
      await purge.purge(outerDb, {
        workspaceId,
        expectedRevision: inspection.revision,
      });
      const remaining = await client.query<{ n: string }>(
        "select ((select count(*) from guide_run_action_bindings where workspace_id=$1::uuid)+(select count(*) from guide_runs where workspace_id=$1::uuid)+(select count(*) from guide_run_artifacts where workspace_id=$1::uuid))::text n",
        [workspaceId],
      );
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
  const residue = await pool.query<{ n: string }>(
    "select count(*)::text n from pg_class where oid=to_regclass('public.guide_run_action_bindings')",
  );
  evidence.zeroResidue = residue.rows[0]?.n === (postMode ? "1" : "0");
  const required = Object.entries(evidence).filter(
    ([key, value]) =>
      typeof value === "boolean" && key !== "preApplyConcurrencySkipped",
  );
  if (
    !required.every(([, value]) => value === true) ||
    evidence.preApplyConcurrencySkipped !== !postMode
  )
    throw new Error(JSON.stringify(evidence));
  console.log(JSON.stringify(evidence));
} finally {
  await pool.end();
}
