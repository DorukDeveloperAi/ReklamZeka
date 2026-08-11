import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { DrizzleCategoryAuthoringRepository } from "@/connectors/categories/category-authoring-drizzle-repository";
import { DrizzleCategoryProfileLifecycleRepository } from "@/connectors/categories/category-profile-lifecycle-drizzle-repository";
import { DrizzleDecisionCadenceProfileRepository } from "@/connectors/decisions/decision-cadence-profile-drizzle-repository";
import { DrizzleGuidanceCampaignSelectionRepository } from "@/connectors/guidance/guidance-campaign-selection-drizzle-repository";
import { DrizzleGuidanceRegistryRepository } from "@/connectors/guidance/guidance-drizzle-repository";
import { CurrentReviewedGuidanceReader } from "@/connectors/guidance/current-reviewed-guidance-reader";
import { DrizzlePolicyAuthorityCatalogMaterializerRepository } from "@/connectors/policies/policy-authority-catalog-materializer-drizzle-repository";
import { createPolicyScopeSnapshot, createTrustedPolicyCatalog } from "@/application/trusted-policy-composition";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef, categoryEntityPublicRef } from "@/domain/categories/public-reference";
import { DECISION_CADENCE_VERSION, type DecisionCadenceProfile } from "@/domain/decisions/cadence";
import { createGuidanceRegistry } from "@/domain/guidance/registry";
import { normalizeMetaChangeSnapshot } from "@/domain/meta/snapshot-diff";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

function rows(value: unknown): readonly Record<string, unknown>[] {
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as readonly Record<string, unknown>[] : [];
}

/**
 * Test-only fixture. It intentionally uses the same lifecycle writers as the
 * current-source CLI and accepts a caller transaction, so callers can prove a
 * true outer rollback without manufacturing authority or guidance facts.
 */
export async function materializeCurrentEffectiveAnalysisContextSourceFixture(database: Database, now = new Date()): Promise<Readonly<{
  workspaceId: string; foreignWorkspaceId: string; actorId: string; workspaceRef: string; actorRef: string;
  accountRef: string; campaignRef: string; request: Readonly<{ workspaceId: string; accountRef: string; entityType: "campaign"; entityRef: string }>;
  occurredAt: string; snapshotRef: string;
}>> {
  const workspaceId = randomUUID(); const foreignWorkspaceId = randomUUID(); const actorId = randomUUID();
  const connectionId = randomUUID(); const sourceId = randomUUID(); const accountId = randomUUID(); const campaignId = randomUUID();
  const suffix = workspaceId.replaceAll("-", "").slice(0, 12);
  const workspaceRef = `workspace_current_${suffix}`; const actorRef = `actor_current_${suffix}`;
  const accountRef = `account_current_${suffix}`; const campaignRef = `campaign_current_${suffix}`;
  const occurredAt = new Date(now.getTime() - 120_000).toISOString();
  const snapshotAt = new Date(Date.parse(occurredAt) - 60_000).toISOString();
  const expiresAt = new Date(Date.parse(occurredAt) + 86_400_000).toISOString();
  const snapshotRef = `snapshot_${suffix}00000000`;
  const cadence: DecisionCadenceProfile = Object.freeze({ version: DECISION_CADENCE_VERSION, settleHours: 0,
    minimumObservationHours: 0, minimumLearningHours: 0, cooldownHours: 0, repeatSuppressionHours: 0,
    frequencyWindowHours: 24, maxDecisionsPerWindow: 3, maxActionsPerWindow: 1, maximumHistoryEntries: 20,
    minimumEvidenceCount: 1, minimumEvidenceScore: 0.5 });

  await database.insert(schema.workspaces).values([{ id: workspaceId, name: "Current source verifier" }, { id: foreignWorkspaceId, name: "Current source foreign" }]);
  await database.insert(schema.users).values({ id: actorId, email: `current-source-${actorId}@example.invalid` });
  await database.insert(schema.memberships).values({ workspaceId, userId: actorId, role: "owner" });
  await database.insert(schema.metaConnections).values({ id: connectionId, workspaceId, externalConnectionKey: `connection_${suffix}`, displayName: "Current source", graphApiVersion: "v23.0", fieldCatalogVersion: "meta-change-fields-v1", accessMode: "read_only", status: "active" });
  await database.insert(schema.dataSources).values({ id: sourceId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads", externalAccountId: accountRef, displayName: "Current source account" });
  await database.insert(schema.adAccounts).values({ id: accountId, workspaceId, dataSourceId: sourceId, externalAccountId: accountRef, name: "Current source account", currency: "TRY", timezone: "Europe/Istanbul" });
  await database.insert(schema.adCampaigns).values({ id: campaignId, workspaceId, adAccountId: accountId, externalCampaignId: campaignRef, name: "Current source campaign", objectiveSource: "OUTCOME_LEADS", configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE", firstSeenAt: new Date(snapshotAt), sourceUpdatedAt: new Date(snapshotAt) });
  const sourceSnapshot = normalizeMetaChangeSnapshot({ schemaVersion: 1, workspaceId, externalAccountId: accountRef, capturedAt: snapshotAt, campaigns: [{ externalCampaignId: campaignRef, configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" }, campaignBudgetOptimization: { state: "known", value: false }, dailyBudgetMinor: { state: "known", value: null }, lifetimeBudgetMinor: { state: "known", value: null } }], adSets: [], ads: [] });
  await database.insert(schema.metaChangeSnapshots).values({ id: randomUUID(), workspaceId, metaConnectionId: connectionId, adAccountId: accountId, publicRef: snapshotRef, snapshotHash: sourceSnapshot.snapshotHash, schemaVersion: sourceSnapshot.schemaVersion, fieldCatalogVersion: sourceSnapshot.fieldCatalogVersion, capturedAt: new Date(snapshotAt), canonicalPayload: sourceSnapshot, safeAggregate: { entityCounts: { campaign: 1, adSet: 0, ad: 0 }, knownFieldCount: 1, unknownFieldCount: 0 } });

  const authoring = new DrizzleCategoryAuthoringRepository(database as never); let authored = await authoring.inspect(workspaceId);
  authored = (await authoring.mutate({ workspaceId, actorId, actorRef, role: "owner", occurredAt, command: { operation: "create_dimension", key: "service", name: "Service", description: null, cardinality: "single", allowedEntityLevels: ["campaign"], expectedRegistryHash: authored.registryHash } })).state;
  const dimensionRef = categoryDimensionPublicRef("service");
  authored = (await authoring.mutate({ workspaceId, actorId, actorRef, role: "owner", occurredAt, command: { operation: "create_definition", dimensionRef, key: "lead", label: "Lead", description: null, expectedRegistryHash: authored.registryHash } })).state;
  const definitionRef = categoryDefinitionPublicRef("service", "lead");
  await authoring.mutate({ workspaceId, actorId, actorRef, role: "owner", occurredAt, command: { operation: "create_assignment", dimensionRef, definitionRef, entityLevel: "campaign", entityRef: categoryEntityPublicRef(workspaceId, "campaign", campaignId), viaAdRef: null, assignmentOperation: "override", manualLock: false, confidenceBasisPoints: 10_000, expectedRegistryHash: authored.registryHash } });
  const profiles = new DrizzleCategoryProfileLifecycleRepository(database as never); let profileState = await profiles.inspect(workspaceId, workspaceRef);
  const draft = await profiles.mutate({ workspaceId, workspaceRef, actorId, actorRef, role: "owner", occurredAt, command: { operation: "create_draft", definitionRef, expectedRegistryHash: profileState.registryHash, parentDefinitionRef: null, label: "Lead", description: "Current-source fixture", color: "#A31F34", bindings: { analysisPlaybookRefs: ["analysis_playbook_current"], ruleInstructionBundleRefs: [], budgetPolicyRefs: [], transferPolicyRefs: [], schedulePolicyRefs: [], actionPolicyRefs: [], creativePolicyRefs: [] } } });
  profileState = draft.state;
  await profiles.mutate({ workspaceId, workspaceRef, actorId, actorRef, role: "owner", occurredAt, command: { operation: "publish", profileRef: draft.profile.profileRef, expectedVersion: draft.profile.version, expectedProfileHash: draft.profile.profileHash, expectedRegistryHash: profileState.registryHash, reasonCode: "fixture_publish" } });

  const guidanceRegistry = createGuidanceRegistry({ workspaceId, sources: [{ id: "source_current", workspaceId, sourceType: "owner_statement", title: "Current source", sourceRef: "owner:current", sourceUrl: null, content: "Protect quality", author: "owner", capturedAt: snapshotAt, reviewedAt: snapshotAt, reviewBy: null, status: "published", version: 1 }], cards: [{ id: "card_current", workspaceId, sourceType: "owner_statement", sourceIds: ["source_current"], title: "Quality", body: "Protect lead quality", rationale: null, strength: "must", topic: "quality", decisionKey: null, positionKey: null, authority: "guidance_only", status: "published", effectiveFrom: snapshotAt, effectiveTo: null, ownerRef: actorRef, version: 1 }], bindings: [{ id: "binding_current", workspaceId, cardId: "card_current", facet: "entity", value: campaignRef, entityType: "campaign", mode: "default", priority: 1, version: 1 }], sets: [{ id: "guidance_set_current", workspaceId, name: "Current set", orderedCardIds: ["card_current"], reviewStatus: "reviewed", version: 1 }] });
  const guidanceWrite = await new DrizzleGuidanceRegistryRepository(database as never).save(guidanceRegistry, { expectedRegistryHash: null });
  const manifest = await database.transaction(async (transaction) => {
    const clock = rows(await transaction.execute(sql`select to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as captured_at`));
    return new CurrentReviewedGuidanceReader().readCurrentInTransaction(transaction as never, workspaceId, String(clock[0]?.captured_at));
  });
  const selected = manifest.reviewedSets[0]; if (!selected || guidanceWrite.outcome !== "inserted") throw new Error("reviewed_guidance_fixture_not_found");
  await new DrizzleGuidanceCampaignSelectionRepository(database as never).publish({ workspaceId, workspaceRef, actorId, actorRef, role: "owner", accountRef, campaignRef, selectionRef: `guidance_selection_${suffix}`, revision: 1, expectedCurrentHash: "GENESIS", selectedSetRef: selected.setRef, selectedSetVersion: selected.setVersion, selectedSetHash: selected.setHash, topics: ["quality"], requiredTopics: ["quality"], budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 }, effectiveAt: occurredAt, occurredAt });
  await new DrizzleDecisionCadenceProfileRepository(database as never).publish({ workspaceId, workspaceRef, actorId, actorRef, role: "owner", accountRef, campaignRef, profileRef: `cadence_${suffix}`, revision: 1, expectedCurrentHash: "GENESIS", profile: cadence, occurredAt });
  const emptyRegistryHash = createHash("sha256").update(JSON.stringify([])).digest("hex");
  const authorityScope = createPolicyScopeSnapshot({ workspaceRef, evaluatedAt: occurredAt, accountGroupRefs: [], objectiveRefs: [], topicRefs: [], canonicalObjective: "lead_generation" });
  const authorityCatalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: `authority_catalog_${suffix}`, catalogVersion: 1, instructionPolicyRegistryHash: emptyRegistryHash, bindings: [] });
  await new DrizzlePolicyAuthorityCatalogMaterializerRepository(database as never).materialize({ workspaceId, workspaceRef, actorId, actorRef, role: "owner", occurredAt, expiresAt, repositoryRef: `repository_${suffix}`, repositoryRevision: "current-source-fixture", expectedCatalogHeadHash: "GENESIS", expectedSnapshotHeadHash: "GENESIS", expectedPolicyRegistryHash: emptyRegistryHash, catalog: authorityCatalog, scope: authorityScope, manualLocks: [] });
  return Object.freeze({ workspaceId, foreignWorkspaceId, actorId, workspaceRef, actorRef, accountRef, campaignRef, request: Object.freeze({ workspaceId, accountRef, entityType: "campaign" as const, entityRef: campaignRef }), occurredAt, snapshotRef });
}
