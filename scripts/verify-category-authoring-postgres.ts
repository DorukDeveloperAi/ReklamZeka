import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  CategoryAuthoringError,
  CategoryAuthoringService,
  type CategoryAuthoringCommand,
} from "@/application/category-authoring-service";
import { DrizzleCategoryArchiveImpactRepository } from
  "@/connectors/categories/category-archive-impact-drizzle-repository";
import { DrizzleCategoryAuthoringRepository } from
  "@/connectors/categories/category-authoring-drizzle-repository";
import * as schema from "@/db/schema";
import { AuthorizationError } from "@/security/authorization";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

const hash = (character: string) => character.repeat(64);
const ids = Object.freeze({
  workspace: randomUUID(), owner: randomUUID(), analyst: randomUUID(), missingActor: randomUUID(),
  connection: randomUUID(), source: randomUUID(), account: randomUUID(), campaign: randomUUID(), context: randomUUID(),
});
const rollback = Symbol("rollback");

async function verify(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
  const database = drizzle(pool, { schema });
  const evidence = {
    realRoleNegative: false,
    staleRegistryHashBlocked: false,
    atomicFailureRolledBack: false,
    auditAndInvalidationAtomic: false,
    staleImpactHashBlocked: false,
    dependencyBlockedArchive: false,
    rollbackClean: false,
  };

  try {
    try {
      await database.transaction(async (tx) => {
        await tx.insert(schema.users).values([
          { id: ids.owner, email: `category-owner-${ids.owner}@acceptance.invalid` },
          { id: ids.analyst, email: `category-analyst-${ids.analyst}@acceptance.invalid` },
        ]);
        await tx.insert(schema.workspaces).values({ id: ids.workspace, name: "Category authoring acceptance" });
        await tx.insert(schema.memberships).values([
          { workspaceId: ids.workspace, userId: ids.owner, role: "owner" },
          { workspaceId: ids.workspace, userId: ids.analyst, role: "analyst" },
        ]);
        await tx.insert(schema.metaConnections).values({
          id: ids.connection, workspaceId: ids.workspace, externalConnectionKey: `category-${ids.connection}`,
          displayName: "Category authoring acceptance", graphApiVersion: "v23.0", fieldCatalogVersion: "acceptance-v1",
        });
        await tx.insert(schema.dataSources).values({
          id: ids.source, workspaceId: ids.workspace, metaConnectionId: ids.connection, platform: "meta_ads",
          externalAccountId: `category-${ids.account}`, displayName: "Category authoring acceptance",
        });
        await tx.insert(schema.adAccounts).values({
          id: ids.account, workspaceId: ids.workspace, dataSourceId: ids.source,
          externalAccountId: `category-${ids.account}`, name: "Category authoring acceptance",
          currency: "TRY", timezone: "Europe/Istanbul",
        });
        await tx.insert(schema.adCampaigns).values({
          id: ids.campaign, workspaceId: ids.workspace, adAccountId: ids.account,
          externalCampaignId: `category-${ids.campaign}`, name: "Category authoring acceptance",
        });

        const memberships = await tx.select({ userId: schema.memberships.userId,
          workspaceId: schema.memberships.workspaceId, role: schema.memberships.role })
          .from(schema.memberships).where(eq(schema.memberships.workspaceId, ids.workspace));
        const repository = new DrizzleCategoryAuthoringRepository(tx as never);
        const service = new CategoryAuthoringService(repository, memberships);
        const principal = (userId: string, readerRef: string) => ({ actor: { userId }, workspaceId: ids.workspace,
          workspaceRef: "workspace_category_authoring_acceptance", readerRef });
        const owner = principal(ids.owner, "reader_category_owner");
        const analyst = principal(ids.analyst, "reader_category_analyst");
        const initial = await service.inspect(owner);
        const createDimension = Object.freeze({
          operation: "create_dimension", key: "acceptance_service_line", name: "Acceptance service line",
          description: "PostgreSQL acceptance fixture", cardinality: "single",
          allowedEntityLevels: ["campaign"] as const, expectedRegistryHash: initial.registryHash,
        }) satisfies CategoryAuthoringCommand;

        evidence.realRoleNegative = await service.mutate(analyst, createDimension)
          .then(() => false, (error) => error instanceof AuthorizationError);
        const roleNegativeRows = await tx.select({ id: schema.categoryDimensions.id }).from(schema.categoryDimensions)
          .where(eq(schema.categoryDimensions.workspaceId, ids.workspace));
        if (!evidence.realRoleNegative || roleNegativeRows.length !== 0) {
          throw new Error("Category authoring role acceptance failed");
        }

        const dimensionCreated = await service.mutate(owner, createDimension);
        const dimension = dimensionCreated.state.dimensions[0];
        const internalDimensions = await tx.select({ id: schema.categoryDimensions.id })
          .from(schema.categoryDimensions).where(and(eq(schema.categoryDimensions.workspaceId, ids.workspace),
            eq(schema.categoryDimensions.key, "acceptance_service_line")));
        if (!dimension || internalDimensions.length !== 1) throw new Error("Category dimension fixture missing");
        const dimensionId = internalDimensions[0]!.id;

        const capturedAt = new Date("2026-08-09T18:00:00.000Z");
        const contextHash = hash("b");
        const contextPayload = Object.freeze({
          workspaceId: ids.workspace, schemaVersion: "effective-campaign-context/1.0.0", contextHash,
          capturedAt: capturedAt.toISOString(),
          identity: Object.freeze({ connectionRef: "connection_category_acceptance",
            accountRef: "account_category_acceptance", campaignRef: "campaign_category_acceptance",
            entityType: "campaign", entityRef: "campaign_category_acceptance" }),
          data: Object.freeze({ snapshotRefs: ["snapshot_aaaaaaaaaaaaaaaaaaaa"] }),
          capabilities: Object.freeze({ containsRawL0: false, canAuthorizeAction: false, canExecuteWrite: false }),
        });
        await tx.insert(schema.effectiveCampaignContexts).values({
          id: ids.context, workspaceId: ids.workspace, identityHash: hash("a"), contextHash,
          schemaVersion: "effective-campaign-context/1.0.0", metaConnectionId: ids.connection,
          adAccountId: ids.account, campaignId: ids.campaign, connectionRef: "connection_category_acceptance",
          accountRef: "account_category_acceptance", campaignRef: "campaign_category_acceptance",
          entityType: "campaign", entityRef: "campaign_category_acceptance", capturedAt,
          snapshotRefs: ["snapshot_aaaaaaaaaaaaaaaaaaaa"], contextPayload,
        });
        await tx.insert(schema.effectiveCampaignContextComponents).values({
          workspaceId: ids.workspace, contextId: ids.context, componentType: "category_resolution",
          componentRef: dimensionId, componentVersion: "category-resolution-acceptance-v1",
        });

        const createDefinition = Object.freeze({
          operation: "create_definition", dimensionRef: dimension.ref, key: "acceptance_definition",
          label: "Acceptance definition", description: null,
          expectedRegistryHash: dimensionCreated.state.registryHash,
        }) satisfies CategoryAuthoringCommand;
        const staleRegistryCommand = Object.freeze({ ...createDefinition,
          expectedRegistryHash: initial.registryHash }) satisfies CategoryAuthoringCommand;
        evidence.staleRegistryHashBlocked = await service.mutate(owner, staleRegistryCommand)
          .then(() => false, (error) => error instanceof CategoryAuthoringError && error.code === "conflict");

        const beforeAtomicAudit = await tx.select({ id: schema.auditEvents.id }).from(schema.auditEvents)
          .where(eq(schema.auditEvents.workspaceId, ids.workspace));
        const beforeAtomicInvalidations = await tx.select({ id: schema.effectiveCampaignContextInvalidations.id })
          .from(schema.effectiveCampaignContextInvalidations)
          .where(eq(schema.effectiveCampaignContextInvalidations.workspaceId, ids.workspace));
        const atomicFailureRejected = await repository.mutate({ workspaceId: ids.workspace, actorId: ids.missingActor,
          actorRef: "reader_category_missing_actor", role: "owner", occurredAt: "2026-08-09T18:01:00.000Z",
          command: createDefinition }).then(() => false, () => true);
        const afterAtomicState = await repository.inspect(ids.workspace);
        const afterAtomicAudit = await tx.select({ id: schema.auditEvents.id }).from(schema.auditEvents)
          .where(eq(schema.auditEvents.workspaceId, ids.workspace));
        const afterAtomicInvalidations = await tx.select({ id: schema.effectiveCampaignContextInvalidations.id })
          .from(schema.effectiveCampaignContextInvalidations)
          .where(eq(schema.effectiveCampaignContextInvalidations.workspaceId, ids.workspace));
        evidence.atomicFailureRolledBack = atomicFailureRejected
          && afterAtomicState.registryHash === dimensionCreated.state.registryHash
          && afterAtomicState.dimensions[0]?.definitions.length === 0
          && afterAtomicAudit.length === beforeAtomicAudit.length
          && afterAtomicInvalidations.length === beforeAtomicInvalidations.length;

        const definitionCreated = await service.mutate(owner, createDefinition);
        const auditRows = await tx.select({ action: schema.auditEvents.action, metadata: schema.auditEvents.metadata })
          .from(schema.auditEvents).where(eq(schema.auditEvents.workspaceId, ids.workspace));
        const invalidationRows = await tx.select({ componentType: schema.effectiveCampaignContextInvalidations.componentType,
          componentRef: schema.effectiveCampaignContextInvalidations.componentRef,
          componentVersion: schema.effectiveCampaignContextInvalidations.componentVersion,
          reasonCode: schema.effectiveCampaignContextInvalidations.reasonCode })
          .from(schema.effectiveCampaignContextInvalidations)
          .where(eq(schema.effectiveCampaignContextInvalidations.workspaceId, ids.workspace));
        evidence.auditAndInvalidationAtomic = definitionCreated.auditAppended
          && definitionCreated.invalidationsAppended === 1
          && definitionCreated.state.dimensions[0]?.definitions.length === 1
          && auditRows.length === 2
          && auditRows.some((row) => row.action === "category.create_definition"
            && row.metadata?.invalidationsAppended === 1)
          && invalidationRows.length === 1
          && invalidationRows[0]?.componentType === "category_resolution"
          && invalidationRows[0]?.componentRef === dimensionId
          && invalidationRows[0]?.componentVersion === "category-resolution-acceptance-v1"
          && invalidationRows[0]?.reasonCode === "source_changed";

        const impact = await new DrizzleCategoryArchiveImpactRepository(tx as never)
          .preview(ids.workspace, dimension.ref);
        if (!impact) throw new Error("Category archive impact fixture missing");
        const staleImpactHash = `${impact.impactHash[0] === "0" ? "1" : "0"}${impact.impactHash.slice(1)}`;
        const archive = (expectedImpactHash: string): CategoryAuthoringCommand => Object.freeze({
          operation: "archive_dimension", dimensionRef: dimension.ref, expectedVersion: 1,
          expectedRegistryHash: definitionCreated.state.registryHash, expectedImpactHash,
        });
        evidence.staleImpactHashBlocked = await service.mutate(owner, archive(staleImpactHash))
          .then(() => false, (error) => error instanceof CategoryAuthoringError && error.code === "conflict");
        evidence.dependencyBlockedArchive = impact.coverage.complete && impact.exactBlockers.activeDefinitions === 1
          && await service.mutate(owner, archive(impact.impactHash))
            .then(() => false, (error) => error instanceof CategoryAuthoringError && error.code === "dependency_blocked");

        const finalState = await repository.inspect(ids.workspace);
        const finalAudit = await tx.select({ id: schema.auditEvents.id }).from(schema.auditEvents)
          .where(eq(schema.auditEvents.workspaceId, ids.workspace));
        const finalInvalidations = await tx.select({ id: schema.effectiveCampaignContextInvalidations.id })
          .from(schema.effectiveCampaignContextInvalidations)
          .where(eq(schema.effectiveCampaignContextInvalidations.workspaceId, ids.workspace));
        if (Object.values(evidence).slice(0, 6).some((value) => !value)
          || finalState.registryHash !== definitionCreated.state.registryHash
          || finalState.dimensions[0]?.version !== 1 || finalAudit.length !== 2 || finalInvalidations.length !== 1) {
          throw new Error("Category authoring PostgreSQL acceptance failed");
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    const remainingWorkspaces = await database.select({ id: schema.workspaces.id }).from(schema.workspaces)
      .where(eq(schema.workspaces.id, ids.workspace));
    const remainingUsers = await database.select({ id: schema.users.id }).from(schema.users)
      .where(inArray(schema.users.id, [ids.owner, ids.analyst]));
    const remainingDimensions = await database.select({ id: schema.categoryDimensions.id }).from(schema.categoryDimensions)
      .where(eq(schema.categoryDimensions.workspaceId, ids.workspace));
    const remainingAudit = await database.select({ id: schema.auditEvents.id }).from(schema.auditEvents)
      .where(eq(schema.auditEvents.workspaceId, ids.workspace));
    const remainingInvalidations = await database.select({ id: schema.effectiveCampaignContextInvalidations.id })
      .from(schema.effectiveCampaignContextInvalidations)
      .where(eq(schema.effectiveCampaignContextInvalidations.workspaceId, ids.workspace));
    evidence.rollbackClean = remainingWorkspaces.length === 0 && remainingUsers.length === 0
      && remainingDimensions.length === 0 && remainingAudit.length === 0 && remainingInvalidations.length === 0;
    if (!evidence.rollbackClean) throw new Error("Category authoring outer rollback acceptance failed");

    process.stdout.write(`${JSON.stringify({ ok: true, ...evidence, metaNetworkCalls: 0, metaWriteCalls: 0,
      temporaryRowsCommitted: false })}\n`);
  } finally {
    await pool.end();
  }
}

if (!databaseUrl) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured" })}\n`);
  process.exitCode = 2;
} else {
  await verify(databaseUrl).catch(() => {
    process.stderr.write(`${JSON.stringify({ ok: false, blocker: "category_authoring_postgres_acceptance_failed" })}\n`);
    process.exitCode = 1;
  });
}
