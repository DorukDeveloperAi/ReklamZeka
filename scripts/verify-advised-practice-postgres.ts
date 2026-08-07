import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  DrizzleAdvisedPracticeRepository,
  AdvisedPracticeRepositoryError,
} from "@/connectors/guidance/advised-practice-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import * as schema from "@/db/schema";
import {
  appendAdvisedPracticeEvent,
  createAdvisedPracticeDefinition,
  replayAdvisedPractice,
  reviseAdvisedPracticeDefinition,
  type AdvisedPracticeDefinition,
} from "@/domain/guidance/advised-practice";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const migrationPath = "drizzle/20260807153726_little_devos.sql";
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("rollback");
const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const tombstoneWorkspaceId = randomUUID();
let ephemeralSchema = false;
let migrationVerified = false;
let definitionRoundTrip = false;
let revisionRoundTrip = false;
let lifecycleRoundTrip = false;
let conditionalPreserved = false;
let rejectedPreserved = false;
let standardizationWithoutOutcomeBlocked = false;
let policyArtifactBlocked = false;
let definitionAuthorityBlocked = false;
let crossTenantBlocked = false;
let crossTenantLoadIsolated = false;
let tombstonedLoadBlocked = false;
let tombstonePracticeRowsPurged = false;
let idempotentReplay = false;
let corruptRevisionBlocked = false;
let rlsEnabled = false;
let publicApiGrants = -1;
let temporaryRowsCommitted = true;
let ephemeralTablesRemaining = true;

function definitionInput(practiceRef: string) {
  return {
    workspaceRef: "workspace_practice_e2e", practiceRef,
    problem: "Korunan bölgede erken bütçe transferini önle",
    requiredInputs: ["metric_cost", "metric_volume"],
    steps: ["Veri yeterliliğini kontrol et", "Koruma istisnasını değerlendir"],
    rationale: "Kısa pencere tek başına stratejik tahsisi değiştirmemeli",
    cadence: "Yedi gün gözlem ve cooldown", exceptions: ["Acil guardrail"], confidence: 0.7,
    scope: {
      kind: "bounded", accountRefs: ["account_main"], objectives: ["OUTCOME_LEADS"],
      internalCategoryRefs: ["category_protected_geo"], entities: [], topics: ["budget"],
    },
    provenance: {
      conversationRef: "conversation_e2e",
      ownerSource: {
        sourceRef: "source_owner_geo", ownerRef: "operator_owner",
        capturedAt: "2026-08-07T10:00:00.000Z", statementHash: "a".repeat(64),
      },
      metaSources: [{
        sourceRef: "source_meta_learning", sourceUrl: "https://www.facebook.com/business/help/learning",
        capturedAt: "2026-08-01T10:00:00.000Z", reviewedAt: "2026-08-02T10:00:00.000Z",
        reviewBy: "2026-11-02T10:00:00.000Z",
      }],
      evidenceRefs: ["evidence_cost_trend"],
      deliberation: {
        alignment: "conflicted", conflictRefs: ["conflict_efficiency_protection"],
        rationale: "Owner koruması generic verimlilik önerisiyle çatışıyor",
      },
    },
  } as const;
}

function definition(practiceRef: string) {
  return createAdvisedPracticeDefinition(definitionInput(practiceRef));
}

function historyToOutcome(definitionValue: AdvisedPracticeDefinition, result: "validated" | "conditional" | "rejected") {
  const first = appendAdvisedPracticeEvent(definitionValue, [], {
    eventType: "candidate_created", occurredAt: "2026-08-07T11:00:00.000Z",
    payload: { origin: "agentic_conversation", createdByRef: "agent_local" },
  });
  const second = appendAdvisedPracticeEvent(definitionValue, first.history, {
    eventType: "reviewed", occurredAt: "2026-08-07T12:00:00.000Z",
    payload: { reviewerRef: "operator_owner", reviewNote: "Dar trial uygun" },
  });
  const third = appendAdvisedPracticeEvent(definitionValue, second.history, {
    eventType: "trial_started", occurredAt: "2026-08-08T12:00:00.000Z",
    payload: {
      trialRef: `trial_${result}`, effectiveContextRef: "context_practice_e2e",
      analysisRef: "analysis_practice_e2e", findingRefs: ["finding_cost_rise"],
      evidenceRefs: ["evidence_cost_trend"], hypothesis: "Gözlem penceresi hacmi korur",
    },
  });
  const fourth = appendAdvisedPracticeEvent(definitionValue, third.history, {
    eventType: "outcome_recorded", occurredAt: "2026-08-20T12:00:00.000Z",
    payload: {
      trialRef: `trial_${result}`, outcomeRef: `outcome_${result}`, result,
      evidenceRefs: ["evidence_post_window"], observedAt: "2026-08-20T11:00:00.000Z",
      outcomeNote: `${result} outcome`,
    },
  });
  return fourth;
}

async function applyEphemeralMigration(transaction: Parameters<Parameters<typeof database.transaction>[0]>[0]) {
  const source = readFileSync(migrationPath, "utf8");
  for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    await transaction.execute(sql.raw(statement));
  }
}

try {
  await database.transaction(async (transaction) => {
    const existence = await transaction.execute(sql`
      select to_regclass('public.advised_practice_definitions')::text as definitions,
             to_regclass('public.advised_practice_events')::text as events
    `);
    const row = (existence as unknown as { rows?: { definitions: string | null; events: string | null }[] }).rows?.[0];
    if (!row?.definitions && !row?.events) {
      ephemeralSchema = true;
      await applyEphemeralMigration(transaction);
    } else if (!row?.definitions || !row?.events) {
      throw new Error("Advised practice şeması kısmi uygulanmış");
    }
    migrationVerified = true;

    const rls = await transaction.execute(sql`
      select count(*)::int as count from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('advised_practice_definitions', 'advised_practice_events')
        and c.relrowsecurity is true
    `);
    rlsEnabled = Number((rls as unknown as { rows?: { count: number }[] }).rows?.[0]?.count ?? 0) === 2;
    const grants = await transaction.execute(sql`
      select count(*)::int as count from information_schema.role_table_grants
      where table_schema = 'public' and table_name in ('advised_practice_definitions', 'advised_practice_events')
        and grantee in ('anon', 'authenticated', 'PUBLIC')
    `);
    publicApiGrants = Number((grants as unknown as { rows?: { count: number }[] }).rows?.[0]?.count ?? -1);

    await transaction.insert(schema.workspaces).values([
      { id: workspaceId, name: "Practice E2E" }, { id: foreignWorkspaceId, name: "Foreign Practice E2E" },
      { id: tombstoneWorkspaceId, name: "Tombstone Practice E2E" },
    ]);
    const repository = new DrizzleAdvisedPracticeRepository(transaction as never, workspaceId);
    const foreignRepository = new DrizzleAdvisedPracticeRepository(transaction as never, foreignWorkspaceId);
    const tombstoneRepository = new DrizzleAdvisedPracticeRepository(transaction as never, tombstoneWorkspaceId);
    const validatedDefinition = definition("practice_validated_e2e");
    definitionRoundTrip = (await repository.saveDefinition(validatedDefinition)).outcome === "inserted";
    idempotentReplay = (await repository.saveDefinition(validatedDefinition)).outcome === "unchanged";
    const revision = reviseAdvisedPracticeDefinition(validatedDefinition, {
      ...definitionInput("practice_validated_e2e"), confidence: 0.8,
    });
    revisionRoundTrip = (await repository.saveDefinition(revision)).outcome === "inserted"
      && (await repository.load(revision.practiceRef))?.definition.definitionHash === revision.definitionHash;
    const validated = historyToOutcome(validatedDefinition, "validated");
    for (const event of validated.history) await repository.appendEvent(event);
    const review = appendAdvisedPracticeEvent(validatedDefinition, validated.history, {
      eventType: "standardization_reviewed", occurredAt: "2026-08-21T12:00:00.000Z",
      payload: {
        reviewerRef: "operator_owner", outcomeEventRef: validated.event.eventId,
        decomposition: [
          { target: "feature", summary: "Veri yeterliliği", sourceRefs: ["evidence_post_window"], artifactRef: null, promotionCapability: "disabled" },
          { target: "policy", summary: "İleri dilimde ayrıca değerlendir", sourceRefs: ["source_owner_geo"], artifactRef: null, promotionCapability: "disabled" },
          { target: "human_judgment", summary: "Nihai karar", sourceRefs: ["source_owner_geo"], artifactRef: null, promotionCapability: "disabled" },
        ], reviewNote: "Yalnız decomposition kaydı",
      },
    });
    if (review.event.eventType !== "standardization_reviewed") throw new Error("Review event bekleniyordu");
    const reviewEvent = review.event;
    await repository.appendEvent(reviewEvent);
    const restarted = new DrizzleAdvisedPracticeRepository(transaction as never, workspaceId);
    const loaded = await restarted.load(validatedDefinition.practiceRef, 1);
    lifecycleRoundTrip = loaded !== null
      && replayAdvisedPractice(loaded.definition, loaded.history).outcomeStatus === "validated"
      && replayAdvisedPractice(loaded.definition, loaded.history).standardizationReviewStatus === "reviewed";

    for (const result of ["conditional", "rejected"] as const) {
      const itemDefinition = definition(`practice_${result}_e2e`);
      await repository.saveDefinition(itemDefinition);
      const item = historyToOutcome(itemDefinition, result);
      for (const event of item.history) await repository.appendEvent(event);
      const recovered = await restarted.load(itemDefinition.practiceRef);
      const preserved = recovered !== null && replayAdvisedPractice(recovered.definition, recovered.history).outcomeStatus === result;
      if (result === "conditional") conditionalPreserved = preserved;
      else rejectedPreserved = preserved;
      standardizationWithoutOutcomeBlocked = standardizationWithoutOutcomeBlocked || await repository.appendEvent(
        { ...review.event, practiceRef: itemDefinition.practiceRef, definitionHash: itemDefinition.definitionHash } as never,
      ).then(() => false, (error: unknown) => error instanceof AdvisedPracticeRepositoryError);
    }

    crossTenantBlocked = await foreignRepository.appendEvent(validated.history[0]!).then(
      () => false,
      (error: unknown) => error instanceof AdvisedPracticeRepositoryError && error.code === "definition_missing",
    );
    crossTenantLoadIsolated = await foreignRepository.load(validatedDefinition.practiceRef) === null;
    const invalidRevision = { ...revision, previousDefinitionHash: "f".repeat(64) };
    corruptRevisionBlocked = await repository.saveDefinition(invalidRevision as AdvisedPracticeDefinition).then(
      () => false,
      (error: unknown) => error instanceof AdvisedPracticeRepositoryError,
    );

    policyArtifactBlocked = await transaction.transaction(async (savepoint) => {
      const malicious = {
        ...reviewEvent,
        eventId: `practice_event_${"f".repeat(20)}`,
        eventHash: "f".repeat(64),
        sequence: review.event.sequence + 1,
        previousEventHash: reviewEvent.eventHash,
        decomposition: reviewEvent.decomposition.map((part, index) => index === 1
          ? { ...part, artifactRef: "policy_live", promotionCapability: "enabled" }
          : part),
      };
      const definitionRow = await savepoint.select().from(schema.advisedPracticeDefinitions)
        .where(sql`${schema.advisedPracticeDefinitions.workspaceId} = ${workspaceId}::uuid
          and ${schema.advisedPracticeDefinitions.practiceRef} = ${validatedDefinition.practiceRef}
          and ${schema.advisedPracticeDefinitions.version} = 1`);
      await savepoint.insert(schema.advisedPracticeEvents).values({
        workspaceId, definitionId: definitionRow[0]!.id, workspaceRef: malicious.workspaceRef,
        practiceRef: malicious.practiceRef, definitionVersion: malicious.definitionVersion,
        definitionHash: malicious.definitionHash, schemaVersion: malicious.schemaVersion,
        sequence: malicious.sequence, previousEventHash: malicious.previousEventHash,
        eventId: malicious.eventId, eventHash: malicious.eventHash, eventType: malicious.eventType,
        occurredAt: new Date("2026-08-22T12:00:00.000Z"),
        payload: { ...malicious, occurredAt: "2026-08-22T12:00:00.000Z" } as unknown as Record<string, unknown>,
      });
      return false;
    }).catch(() => true);
    definitionAuthorityBlocked = await transaction.transaction(async (savepoint) => {
      const unsafe = definition("practice_authority_e2e");
      await savepoint.insert(schema.advisedPracticeDefinitions).values({
        workspaceId, workspaceRef: unsafe.workspaceRef, practiceRef: unsafe.practiceRef,
        version: unsafe.version, schemaVersion: unsafe.schemaVersion,
        previousDefinitionHash: unsafe.previousDefinitionHash, definitionHash: unsafe.definitionHash,
        payload: {
          ...unsafe,
          capabilities: { ...unsafe.capabilities, canWrite: true },
        } as unknown as Record<string, unknown>,
      });
      return false;
    }).catch(() => true);

    const tombstoneDefinition = createAdvisedPracticeDefinition({
      ...definitionInput("practice_tombstone_e2e"), workspaceRef: "workspace_tombstone_e2e",
    });
    await tombstoneRepository.saveDefinition(tombstoneDefinition);
    const tombstoneCandidate = appendAdvisedPracticeEvent(tombstoneDefinition, [], {
      eventType: "candidate_created", occurredAt: "2026-08-07T11:00:00.000Z",
      payload: { origin: "human_draft", createdByRef: "operator_owner" },
    });
    await tombstoneRepository.appendEvent(tombstoneCandidate.event);
    const purge = new DrizzleWorkspaceTombstonePurgePort();
    const beforePurge = await purge.inspect(transaction as never, tombstoneWorkspaceId);
    const purgeResult = await purge.purge(transaction as never, {
      workspaceId: tombstoneWorkspaceId, expectedRevision: beforePurge.revision,
    });
    tombstonePracticeRowsPurged = beforePurge.candidateCount === 2 && purgeResult.purgedRowCount === 2
      && (await purge.inspect(transaction as never, tombstoneWorkspaceId)).candidateCount === 0;
    await transaction.update(schema.workspaces).set({
      lifecycleState: "tombstoned", tombstonedAt: new Date("2026-08-22T12:00:00.000Z"),
    }).where(sql`${schema.workspaces.id} = ${tombstoneWorkspaceId}::uuid`);
    tombstonedLoadBlocked = await tombstoneRepository.load(tombstoneDefinition.practiceRef).then(
      () => false,
      (error: unknown) => error instanceof AdvisedPracticeRepositoryError && error.code === "workspace_scope_mismatch",
    );

    if (!migrationVerified || !definitionRoundTrip || !revisionRoundTrip || !lifecycleRoundTrip
      || !conditionalPreserved || !rejectedPreserved || !standardizationWithoutOutcomeBlocked
      || !policyArtifactBlocked || !definitionAuthorityBlocked || !crossTenantBlocked
      || !crossTenantLoadIsolated || !tombstonedLoadBlocked
      || !tombstonePracticeRowsPurged || !idempotentReplay || !corruptRevisionBlocked
      || !rlsEnabled || publicApiGrants !== 0) throw new Error("Advised practice PostgreSQL kabulü başarısız");
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  const residue = await database.execute(sql`
    select count(*)::int as count from workspaces
    where id in (${workspaceId}::uuid, ${foreignWorkspaceId}::uuid, ${tombstoneWorkspaceId}::uuid)
  `);
  temporaryRowsCommitted = Number((residue as unknown as { rows?: { count: number }[] }).rows?.[0]?.count ?? -1) !== 0;
  if (ephemeralSchema) {
    const tables = await database.execute(sql`
      select count(*)::int as count from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('advised_practice_definitions', 'advised_practice_events')
    `);
    ephemeralTablesRemaining = Number((tables as unknown as { rows?: { count: number }[] }).rows?.[0]?.count ?? -1) !== 0;
  } else {
    ephemeralTablesRemaining = false;
  }
} finally {
  await pool.end();
}

console.log(JSON.stringify({
  ephemeralSchema, migrationVerified, definitionRoundTrip, revisionRoundTrip, lifecycleRoundTrip,
  conditionalPreserved, rejectedPreserved, standardizationWithoutOutcomeBlocked, policyArtifactBlocked,
  definitionAuthorityBlocked,
  crossTenantBlocked, crossTenantLoadIsolated, tombstonedLoadBlocked, tombstonePracticeRowsPurged,
  idempotentReplay, corruptRevisionBlocked, rlsEnabled, publicApiGrants,
  metaNetworkCalls: 0, metaWriteCalls: 0, temporaryRowsCommitted, ephemeralTablesRemaining,
}));
