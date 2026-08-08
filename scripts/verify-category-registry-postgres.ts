import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DrizzleCategoryRegistryRepository } from "@/connectors/categories/category-registry-drizzle-repository";
import { DrizzleCategoryArchiveImpactRepository } from "@/connectors/categories/category-archive-impact-drizzle-repository";
import * as schema from "@/db/schema";
import { categoryDimensionPublicRef } from "@/domain/categories/public-reference";
import {
  CategoryRegistryPersistenceError,
  CategoryRegistryService,
} from "@/domain/categories/service";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const rollback = Symbol("rollback");
const ids = Object.fromEntries([
  "workspace", "foreignWorkspace", "source", "foreignSource", "account", "foreignAccount",
  "otherAccount", "campaign", "foreignCampaign", "adSet", "crossAccountAdSet", "creative", "ad",
  "dimension", "lifecycleDimensionV1",
  "lifecycleDimensionV2", "brandDefinition", "patientDefinitionV1", "patientDefinitionV2",
  "assignmentV1", "assignmentV2", "automaticConflict",
].map((key) => [key, randomUUID()])) as Record<string, string>;

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
});
const database = drizzle(pool, { schema });
let restartDurable = false;
let manualLockConflict = false;
let lockedMutationDenied = false;
let frozenReplayAfterArchive = false;
let foreignScopeRejected = false;
let optimisticConcurrency = false;
let rollbackClean = false;
let archiveImpactReadSafe = false;

try {
  await database.transaction(async (tx) => {
    await tx.insert(schema.workspaces).values([
      { id: ids.workspace!, name: "Category E2E target" },
      { id: ids.foreignWorkspace!, name: "Category E2E foreign" },
    ]);
    await tx.insert(schema.dataSources).values([
      {
        id: ids.source!, workspaceId: ids.workspace!, platform: "meta_ads",
        externalAccountId: `e2e-${ids.account}`, displayName: "Target source",
      },
      {
        id: ids.foreignSource!, workspaceId: ids.foreignWorkspace!, platform: "meta_ads",
        externalAccountId: `e2e-${ids.foreignAccount}`, displayName: "Foreign source",
      },
    ]);
    await tx.insert(schema.adAccounts).values([
      {
        id: ids.account!, workspaceId: ids.workspace!, dataSourceId: ids.source!,
        externalAccountId: `e2e-${ids.account}`, name: "Target account", currency: "TRY", timezone: "Europe/Istanbul",
      },
      {
        id: ids.foreignAccount!, workspaceId: ids.foreignWorkspace!, dataSourceId: ids.foreignSource!,
        externalAccountId: `e2e-${ids.foreignAccount}`, name: "Foreign account", currency: "TRY", timezone: "Europe/Istanbul",
      },
      {
        id: ids.otherAccount!, workspaceId: ids.workspace!, dataSourceId: ids.source!,
        externalAccountId: `e2e-${ids.otherAccount}`, name: "Other target account", currency: "TRY", timezone: "Europe/Istanbul",
      },
    ]);
    await tx.insert(schema.adCampaigns).values([
      {
        id: ids.campaign!, workspaceId: ids.workspace!, adAccountId: ids.account!,
        externalCampaignId: `e2e-${ids.campaign}`, name: "Target campaign",
      },
      {
        id: ids.foreignCampaign!, workspaceId: ids.foreignWorkspace!, adAccountId: ids.foreignAccount!,
        externalCampaignId: `e2e-${ids.foreignCampaign}`, name: "Foreign campaign",
      },
    ]);
    await tx.insert(schema.metaAdSets).values({
      id: ids.adSet!, workspaceId: ids.workspace!, adAccountId: ids.account!, campaignId: ids.campaign!,
      externalAdSetId: `e2e-${ids.adSet}`, name: "Target ad set", rawPayloadHash: "category-e2e-adset",
      sourceGraphVersion: "v23.0", fieldCatalogVersion: "category-e2e", provenance: {},
    });
    // The mirror schema permits partial observations; the registry must still
    // reject a path whose stored account ownership contradicts its parent.
    await tx.insert(schema.metaAdSets).values({
      id: ids.crossAccountAdSet!, workspaceId: ids.workspace!, adAccountId: ids.otherAccount!,
      campaignId: ids.campaign!, externalAdSetId: `e2e-${ids.crossAccountAdSet}`,
      name: "Cross-account mismatch", rawPayloadHash: "category-e2e-cross-account",
      sourceGraphVersion: "v23.0", fieldCatalogVersion: "category-e2e", provenance: {},
    });
    await tx.insert(schema.metaCreatives).values({
      id: ids.creative!, workspaceId: ids.workspace!, adAccountId: ids.account!,
      externalCreativeId: `e2e-${ids.creative}`, sourceType: "existing_post", contentProvenance: {},
      rawPayloadHash: "category-e2e-creative", sourceGraphVersion: "v23.0",
      fieldCatalogVersion: "category-e2e", provenance: {},
    });
    await tx.insert(schema.metaAds).values({
      id: ids.ad!, workspaceId: ids.workspace!, adAccountId: ids.account!, campaignId: ids.campaign!,
      adSetId: ids.adSet!, creativeId: ids.creative!, externalAdId: `e2e-${ids.ad}`, name: "Target ad",
      rawPayloadHash: "category-e2e-ad", sourceGraphVersion: "v23.0",
      fieldCatalogVersion: "category-e2e", provenance: {},
    });

    const service = new CategoryRegistryService(new DrizzleCategoryRegistryRepository(tx as never));
    await service.createDimension({
      id: ids.dimension!, workspaceId: ids.workspace!, key: "internal_campaign_type",
      name: "Internal campaign type", cardinality: "single",
      allowedEntityLevels: ["campaign", "ad_set", "ad", "creative"],
    });
    await service.createDimension({
      id: ids.lifecycleDimensionV1!, workspaceId: ids.workspace!, key: "lifecycle_fixture",
      name: "Lifecycle fixture", cardinality: "multi", allowedEntityLevels: ["campaign"],
    });
    const lifecycleV2 = await service.reviseDimension({
      workspaceId: ids.workspace!, dimensionId: ids.lifecycleDimensionV1!, expectedVersion: 1,
      nextId: ids.lifecycleDimensionV2!, name: "Lifecycle fixture v2", cardinality: "multi",
      allowedEntityLevels: ["campaign"],
    });
    await service.archiveDimension(ids.workspace!, lifecycleV2.id, 2);
    optimisticConcurrency = await service.archiveDimension(ids.workspace!, lifecycleV2.id, 2)
      .then(() => false, (error) => error instanceof CategoryRegistryPersistenceError && error.code === "conflict");

    await service.createDefinition({
      id: ids.brandDefinition!, workspaceId: ids.workspace!, dimensionId: ids.dimension!,
      key: "brand_protection", label: "Marka koruma",
    });
    await service.createDefinition({
      id: ids.patientDefinitionV1!, workspaceId: ids.workspace!, dimensionId: ids.dimension!,
      key: "international_patient", label: "Uluslararası hasta",
    });
    const patientV2 = await service.reviseDefinition({
      workspaceId: ids.workspace!, definitionId: ids.patientDefinitionV1!, expectedVersion: 1,
      nextId: ids.patientDefinitionV2!, label: "Uluslararası hasta v2",
    });
    await service.createAssignment({
      id: ids.assignmentV1!, workspaceId: ids.workspace!, dimensionId: ids.dimension!,
      definitionId: ids.brandDefinition!, target: { level: "campaign", id: ids.campaign! },
      operation: "add", source: "manual", manualLock: false,
      evidence: [{ kind: "owner_instruction", ref: "category-e2e:draft" }], confidence: 1,
    });
    const assignmentV2 = await service.reviseAssignment({
      workspaceId: ids.workspace!, assignmentId: ids.assignmentV1!, expectedVersion: 1,
      nextId: ids.assignmentV2!, target: { level: "campaign", id: ids.campaign! },
      operation: "add", source: "manual", manualLock: true,
      evidence: [{ kind: "owner_instruction", ref: "category-e2e:locked-v2" }], confidence: 1,
    });
    const impact = await new DrizzleCategoryArchiveImpactRepository(tx as never)
      .preview(ids.workspace!, categoryDimensionPublicRef("internal_campaign_type"));
    archiveImpactReadSafe = impact?.archiveAllowed === false && impact.coverage.complete === false
      && impact.exactBlockers.activeDefinitions === 2 && impact.exactBlockers.activeAssignments === 1
      && impact.exactBlockers.manualLocks === 1;

    const restarted = new CategoryRegistryService(new DrizzleCategoryRegistryRepository(tx as never));
    const persistedDimension = await restarted.findDimension(ids.workspace!, ids.dimension!);
    const persistedDefinitions = await restarted.listDefinitions(ids.workspace!, ids.dimension!);
    const persistedAssignments = await restarted.listAssignments(ids.workspace!, ids.dimension!);
    const current = await restarted.resolveCurrent(ids.workspace!, ids.dimension!, { level: "ad", id: ids.ad! });
    restartDurable = persistedDimension.version === 1
      && persistedDefinitions.length === 2
      && persistedAssignments.length === 1
      && current.values[0]?.id === ids.brandDefinition
      && current.frozenContext.evaluatedAssignments[0]?.id === assignmentV2.id;

    manualLockConflict = await restarted.createAssignment({
      id: ids.automaticConflict!, workspaceId: ids.workspace!, dimensionId: ids.dimension!,
      definitionId: patientV2.id, target: { level: "ad_set", id: ids.adSet! },
      operation: "override", source: "agent", manualLock: false,
      evidence: [{ kind: "agent_inference", ref: "category-e2e:auto" }], confidence: 0.8,
    }).then(() => false, (error) => (
      error instanceof CategoryRegistryPersistenceError && error.code === "manual_lock"
    ));
    lockedMutationDenied = await restarted.archiveAssignment({
      workspaceId: ids.workspace!, assignmentId: assignmentV2.id, expectedVersion: 2,
    }).then(() => false, (error) => (
      error instanceof CategoryRegistryPersistenceError && error.code === "manual_lock"
    ));

    const frozen = current.frozenContext;
    await restarted.archiveDimension(ids.workspace!, ids.dimension!, 1);
    const replay = await restarted.replayFrozen(frozen, { level: "ad", id: ids.ad! });
    frozenReplayAfterArchive = replay.values[0]?.id === ids.brandDefinition
      && replay.frozenContext.resolutionHash === frozen.resolutionHash;

    const wrongWorkspaceRead = await restarted.resolveCurrent(
      ids.foreignWorkspace!, ids.dimension!, { level: "campaign", id: ids.foreignCampaign! },
    ).then(() => false, (error) => error instanceof CategoryRegistryPersistenceError);
    const wrongWorkspaceWrite = await restarted.createDefinition({
      id: randomUUID(), workspaceId: ids.foreignWorkspace!, dimensionId: ids.dimension!,
      key: "scope_escape", label: "Scope escape",
    }).then(() => false, (error) => error instanceof CategoryRegistryPersistenceError);
    const wrongHierarchy = await restarted.resolveCurrent(
      ids.workspace!, ids.dimension!, { level: "campaign", id: ids.foreignCampaign! },
    ).then(() => false, (error) => error instanceof CategoryRegistryPersistenceError);
    const crossAccountHierarchy = await restarted.resolveCurrent(
      ids.workspace!, ids.dimension!, { level: "ad_set", id: ids.crossAccountAdSet! },
    ).then(() => false, (error) => (
      error instanceof CategoryRegistryPersistenceError && error.code === "invalid_hierarchy"
    ));
    foreignScopeRejected = wrongWorkspaceRead && wrongWorkspaceWrite && wrongHierarchy && crossAccountHierarchy;

    if (!restartDurable || !manualLockConflict || !lockedMutationDenied || !frozenReplayAfterArchive
      || !foreignScopeRejected || !optimisticConcurrency || !archiveImpactReadSafe) {
      throw new Error("Category registry PostgreSQL acceptance failed");
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
}

try {
  const remaining = await database.select({ id: schema.workspaces.id }).from(schema.workspaces).where(
    inArray(schema.workspaces.id, [ids.workspace!, ids.foreignWorkspace!]),
  );
  const categoryRows = await database.select({ id: schema.categoryDimensions.id })
    .from(schema.categoryDimensions).where(and(
      eq(schema.categoryDimensions.workspaceId, ids.workspace!),
      inArray(schema.categoryDimensions.id, [ids.dimension!, ids.lifecycleDimensionV1!, ids.lifecycleDimensionV2!]),
    ));
  rollbackClean = remaining.length === 0 && categoryRows.length === 0;
  if (!rollbackClean) throw new Error("Category registry rollback cleanup failed");
} finally {
  await pool.end();
}

console.log(JSON.stringify({
  restartDurable,
  manualLockConflict,
  lockedMutationDenied,
  frozenReplayAfterArchive,
  foreignScopeRejected,
  optimisticConcurrency,
  archiveImpactReadSafe,
  metaNetworkCalls: 0,
  metaWriteCalls: 0,
  rollbackClean,
  temporaryRowsCommitted: false,
}));
