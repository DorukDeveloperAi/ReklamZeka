import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { PromotionTemplateAuthoringService } from "@/application/promotion-template-authoring";
import { PromotionTemplateLifecycleService } from "@/application/promotion-template-lifecycle-service";
import { DrizzlePromotionTemplateLifecycleRepository } from
  "@/connectors/meta/promotion/promotion-template-lifecycle-drizzle-repository";
import { DrizzlePublishedPromotionTemplateCatalog } from
  "@/connectors/meta/promotion/published-promotion-template-catalog-drizzle";
import { DrizzlePromotionRegistryRepository, promotionRegistryPublicRef } from
  "@/connectors/meta/promotion/promotion-registry-drizzle-repository";
import * as schema from "@/db/schema";
import { createAudiencePresetRevision, createPromotionTemplateBinding, createPromotionTemplateRevision } from
  "@/domain/meta/promotion/promotion-template";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    continuation: "npm run verify:promotion-template-lifecycle-live" })}\n`);
  process.exitCode = 2;
} else {
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000, idleTimeoutMillis: 10_000, allowExitOnIdle: true });
  const database = drizzle(pool, { schema });
  const ids = { workspace: randomUUID(), user: randomUUID(), connection: randomUUID(), source: randomUUID(),
    account: randomUUID(), actor: randomUUID(), dimension: randomUUID(), category: randomUUID() };
  const suffix = ids.workspace.replaceAll("-", "").slice(0, 12);
  const workspaceRef = `workspace_verify_${suffix}`; const actorRef = `actor_verify_${suffix}`;
  const principal = { actor: { userId: ids.user }, workspaceId: ids.workspace, workspaceRef, readerRef: actorRef } as const;
  const membership = { userId: ids.user, workspaceId: ids.workspace, role: "owner" as const };
  const rollback = new Error("PROMOTION_LIFECYCLE_OUTER_ROLLBACK");
  let evidence: Record<string, boolean | number> | null = null; let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { networkCalls += 1; throw new Error("network_not_allowed"); }) as typeof fetch;
  try {
    const security = await pool.query<{ table_count: number; forced_count: number; privileged_count: number;
      trigger_count: number; function_privileged: boolean }>(`select
      (select count(*)::int from pg_class where oid in (to_regclass('public.audience_preset_authoring_revisions'),
        to_regclass('public.promotion_template_authoring_revisions'))) as table_count,
      (select count(*)::int from pg_class where oid in (to_regclass('public.audience_preset_authoring_revisions'),
        to_regclass('public.promotion_template_authoring_revisions')) and relrowsecurity and relforcerowsecurity) as forced_count,
      (select count(*)::int from (values ('audience_preset_authoring_revisions'), ('promotion_template_authoring_revisions')) v(name)
        where has_table_privilege('service_role', 'public.' || v.name, 'select,insert,update,delete')) as privileged_count,
      (select count(*)::int from pg_trigger where not tgisinternal and tgname in
        ('audience_preset_authoring_lineage_trigger','promotion_template_authoring_lineage_trigger',
         'audience_preset_authoring_append_only_trigger','promotion_template_authoring_append_only_trigger')) as trigger_count,
      (has_function_privilege('service_role', 'public.promotion_authoring_revision_guard()', 'execute')
        or has_function_privilege('service_role', 'public.promotion_authoring_revision_immutable()', 'execute')) as function_privileged`);
    const posture = security.rows[0];
    if (posture?.table_count !== 2 || posture.forced_count !== 2 || posture.privileged_count !== 0
      || posture.trigger_count !== 4 || posture.function_privileged) throw new Error("migration_security_failed");
    await database.transaction(async (outer) => {
      await outer.insert(schema.users).values({ id: ids.user, email: `promotion-${suffix}@invalid.local` });
      await outer.insert(schema.workspaces).values({ id: ids.workspace, name: "promotion lifecycle verify" });
      await outer.insert(schema.memberships).values({ workspaceId: ids.workspace, userId: ids.user, role: "owner" });
      await outer.insert(schema.metaConnections).values({ id: ids.connection, workspaceId: ids.workspace,
        externalConnectionKey: `verify_${suffix}`, displayName: "Verify", graphApiVersion: "v24.0",
        fieldCatalogVersion: "verify/1.0.0", status: "active" });
      await outer.insert(schema.dataSources).values({ id: ids.source, workspaceId: ids.workspace,
        metaConnectionId: ids.connection, platform: "meta_ads", externalAccountId: `verify_${suffix}`, displayName: "Verify" });
      await outer.insert(schema.adAccounts).values({ id: ids.account, workspaceId: ids.workspace,
        dataSourceId: ids.source, externalAccountId: `act_${suffix}`, name: "Verify", currency: "TRY", timezone: "Europe/Istanbul" });
      await outer.insert(schema.metaAssets).values({ id: ids.actor, workspaceId: ids.workspace,
        metaConnectionId: ids.connection, assetType: "instagram_account", externalAssetId: `ig_${suffix}`,
        displayName: "Verify", ownershipKind: "owned", rawPayloadHash: "a".repeat(64), sourceGraphVersion: "v24.0",
        fieldCatalogVersion: "verify/1.0.0", provenance: { source: "deterministic_verifier" } });
      await outer.insert(schema.categoryDimensions).values({ id: ids.dimension, workspaceId: ids.workspace,
        key: `verify_${suffix}`, name: "Verify", cardinality: "single", allowedEntityLevels: ["campaign"] });
      await outer.insert(schema.categoryDefinitions).values({ id: ids.category, workspaceId: ids.workspace,
        dimensionId: ids.dimension, key: "health", label: "Health" });
      const accountRef = promotionRegistryPublicRef("account", ids.workspace, ids.account);
      const publishedActorRef = promotionRegistryPublicRef("actor", ids.workspace, ids.actor);
      const categoryRef = promotionRegistryPublicRef("category", ids.workspace, ids.category);
      const at = "2026-08-10T00:00:00.000Z";
      const preset = createAudiencePresetRevision({ version: "audience-preset/1.0.0", workspaceRef,
        presetRef: `audience_verify_${suffix}`, revision: 1, aliases: ["Verify audience"], state: "published",
        source: { kind: "frozen_targeting_spec", sourceRef: `source_verify_${suffix}`,
          targetingHash: "b".repeat(64), provenanceHash: "c".repeat(64) }, targeting: { geoRefs: ["geo_tr"],
          languages: ["language_tr"], ageMin: 25, ageMax: 55, inclusionRefs: ["interest_health"], exclusionRefs: [] },
        publishedAt: at });
      const template = createPromotionTemplateRevision({ version: "promotion-template/1.0.0", workspaceRef,
        templateRef: `template_verify_${suffix}`, revision: 1, aliases: ["Verify promotion"], state: "published",
        accountRefs: [accountRef], actorTypes: ["instagram"], internalCategoryRefs: [categoryRef], postTypes: ["image"],
        objectiveRef: "objective_leads", optimizationGoalRef: "optimization_leads", destinationRef: "destination_form",
        placementRefs: ["placement_feed"], namingRuleRef: "naming_default", trackingRuleRef: "tracking_default",
        adSetPolicy: "existing_only", audiencePreset: { presetRef: preset.presetRef, revision: preset.revision,
          presetHash: preset.presetHash }, budget: { ownerLevel: "adset", currency: "TRY", kind: "daily",
          defaultDecimal: "100", minimumDecimal: "50", maximumDecimal: "500", budgetPlanVersionRef: "budget_plan_v1" },
        timeframe: { timeframeRef: "timeframe_7d", scheduleMode: "fixed_duration", durationDays: 7 }, publishedAt: at });
      const binding = createPromotionTemplateBinding({ version: "promotion-template-binding/1.0.0", workspaceRef,
        bindingRef: `binding_verify_${suffix}`, template: { templateRef: template.templateRef, revision: template.revision,
          templateHash: template.templateHash }, accountRef, actor: { type: "instagram", actorRef: publishedActorRef },
        internalCategoryRefs: [categoryRef], campaignRef: null, effectiveFrom: at, expiresAt: null }, template);
      await new DrizzlePromotionRegistryRepository(outer as never, ids.workspace, workspaceRef).publish({ preset, template, binding });
      const catalog = new DrizzlePublishedPromotionTemplateCatalog(outer as never, ids.workspace, workspaceRef);
      const authoring = new PromotionTemplateAuthoringService(catalog, workspaceRef, [membership]);
      const preview = await authoring.inspect(principal, "2026-08-10T00:01:00.000Z");
      const selection = { scopeRef: preview.catalog.scopes[0]!.scopeRef, postType: "image" as const,
        instruction: "Verify promotion" };
      const lifecycle = new PromotionTemplateLifecycleService(
        new DrizzlePromotionTemplateLifecycleRepository(outer as never), catalog, [membership]);
      const initial = await lifecycle.inspect(principal);
      const presetDraftResult = await lifecycle.mutate(principal, { operation: "create_preset_draft",
        expectedRegistryHash: initial.registryHash, selection, alias: "Verify audience revised" });
      const presetDraft = presetDraftResult.state.presetCurrent[0]!;
      const unexpectedMalformedAcceptance = new Error("MALFORMED_PUBLISHED_ACCEPTED");
      let malformedPublishedRejected = false;
      try {
        await outer.transaction(async (savepoint) => {
          await savepoint.execute(sql`insert into audience_preset_authoring_revisions (
            id, workspace_id, workspace_ref, preset_ref, lifecycle_version, previous_record_hash, status,
            preset_revision, preset_hash, preset_payload, published_preset_hash, published_preset_payload,
            actor_ref, actor_role, reason_code, record_hash, recorded_at)
          select ${randomUUID()}::uuid, workspace_id, workspace_ref, preset_ref, lifecycle_version + 1, record_hash,
            'published', preset_revision, preset_hash, preset_payload, ${"d".repeat(64)},
            jsonb_build_object('version', 'audience-preset/1.0.0', 'workspaceRef', 'workspace_forged',
              'presetRef', preset_ref, 'revision', preset_revision + 1, 'state', 'published',
              'publishedAt', ${"2026-08-10T00:01:30.000Z"}, 'presetHash', ${"d".repeat(64)},
              'authority', jsonb_build_object('canWriteMeta', true)),
            actor_ref, 'owner', 'owner_publish', ${"e".repeat(64)}, ${"2026-08-10T00:01:30.000Z"}::timestamptz
          from audience_preset_authoring_revisions where workspace_id = ${ids.workspace}::uuid
            and preset_ref = ${presetDraft.presetRef} order by lifecycle_version desc limit 1`);
          throw unexpectedMalformedAcceptance;
        });
      } catch (reason) { malformedPublishedRejected = reason !== unexpectedMalformedAcceptance; }
      const immutableBeforePublish = await outer.select().from(schema.audiencePresetRevisions)
        .where(eq(schema.audiencePresetRevisions.workspaceId, ids.workspace));
      const presetPublishResult = await lifecycle.mutate(principal, { operation: "publish_preset",
        expectedRegistryHash: presetDraftResult.state.registryHash, presetRef: presetDraft.presetRef,
        expectedLifecycleVersion: presetDraft.lifecycleVersion, expectedRecordHash: presetDraft.recordHash,
        expectedPresetRevision: presetDraft.presetRevision, expectedPresetHash: presetDraft.presetMaterialHash,
        reasonCode: "owner_publish" });
      const publishedPreset = presetPublishResult.state.presetCurrent[0]!;
      const templateDraftResult = await lifecycle.mutate(principal, { operation: "create_template_draft",
        expectedRegistryHash: presetPublishResult.state.registryHash, selection, alias: "Verify template revised",
        audiencePreset: { presetRef: publishedPreset.presetRef, revision: publishedPreset.presetRevision,
          presetHash: publishedPreset.publishedPresetHash! } });
      const templateDraft = templateDraftResult.state.templateCurrent[0]!;
      const templatePublishResult = await lifecycle.mutate(principal, { operation: "publish_template",
        expectedRegistryHash: templateDraftResult.state.registryHash, templateRef: templateDraft.templateRef,
        expectedLifecycleVersion: templateDraft.lifecycleVersion, expectedRecordHash: templateDraft.recordHash,
        expectedPresetRevision: templateDraft.presetRevision, expectedPresetHash: templateDraft.presetHash,
        expectedTemplateRevision: templateDraft.templateRevision, expectedTemplateHash: templateDraft.templateMaterialHash,
        reasonCode: "owner_publish" });
      let staleRejected = false;
      try { await lifecycle.mutate(principal, { operation: "publish_template",
        expectedRegistryHash: templateDraftResult.state.registryHash, templateRef: templateDraft.templateRef,
        expectedLifecycleVersion: templateDraft.lifecycleVersion, expectedRecordHash: templateDraft.recordHash,
        expectedPresetRevision: templateDraft.presetRevision, expectedPresetHash: templateDraft.presetHash,
        expectedTemplateRevision: templateDraft.templateRevision, expectedTemplateHash: templateDraft.templateMaterialHash,
        reasonCode: "owner_publish" }); } catch (reason) {
        staleRejected = reason instanceof Error && "code" in reason && reason.code === "conflict";
      }
      const currentTemplate = templatePublishResult.state.templateCurrent[0]!;
      const archive = await lifecycle.mutate(principal, { operation: "archive_template",
        expectedRegistryHash: templatePublishResult.state.registryHash, templateRef: currentTemplate.templateRef,
        expectedLifecycleVersion: currentTemplate.lifecycleVersion, expectedRecordHash: currentTemplate.recordHash,
        expectedPresetRevision: currentTemplate.presetRevision, expectedPresetHash: currentTemplate.presetHash,
        expectedTemplateRevision: currentTemplate.templateRevision, expectedTemplateHash: currentTemplate.templateMaterialHash,
        reasonCode: "owner_archive" });
      const unexpectedArchivedAcceptance = new Error("MALFORMED_ARCHIVED_ACCEPTED");
      let malformedArchivedRejected = false;
      try {
        await outer.transaction(async (savepoint) => {
          await savepoint.execute(sql`insert into promotion_template_authoring_revisions (
            id, workspace_id, workspace_ref, template_ref, lifecycle_version, previous_record_hash, status,
            preset_ref, preset_revision, preset_hash, preset_payload, template_revision, template_hash, template_payload,
            binding_ref, binding_hash, binding_payload, published_template_hash, published_template_payload,
            published_binding_hash, published_binding_payload, actor_ref, actor_role, reason_code, record_hash, recorded_at)
          select ${randomUUID()}::uuid, workspace_id, workspace_ref, template_ref, lifecycle_version + 1, record_hash, 'archived',
            preset_ref, preset_revision, preset_hash, preset_payload, template_revision, template_hash, template_payload,
            binding_ref, binding_hash, binding_payload, published_template_hash, published_template_payload,
            published_binding_hash, jsonb_set(published_binding_payload, '{version}', '"forged"'::jsonb),
            actor_ref, 'owner', 'owner_archive', ${"f".repeat(64)}, ${"2026-08-10T00:04:00.000Z"}::timestamptz
          from promotion_template_authoring_revisions where workspace_id = ${ids.workspace}::uuid
            and template_ref = ${currentTemplate.templateRef} order by lifecycle_version desc limit 1`);
          throw unexpectedArchivedAcceptance;
        });
      } catch (reason) { malformedArchivedRejected = reason !== unexpectedArchivedAcceptance; }
      const counts = (await outer.execute(sql`select
        (select count(*)::int from audience_preset_authoring_revisions where workspace_id = ${ids.workspace}::uuid) preset_lifecycle,
        (select count(*)::int from promotion_template_authoring_revisions where workspace_id = ${ids.workspace}::uuid) template_lifecycle,
        (select count(*)::int from audience_preset_revisions where workspace_id = ${ids.workspace}::uuid) immutable_presets,
        (select count(*)::int from promotion_template_revisions where workspace_id = ${ids.workspace}::uuid) immutable_templates,
        (select count(*)::int from audit_events where workspace_id = ${ids.workspace}::uuid and action like 'promotion_template.%') audits,
        (select count(*)::int from effective_campaign_context_invalidations where workspace_id = ${ids.workspace}::uuid
          and component_type = 'promotion_registry') invalidations`)).rows[0] as Record<string, unknown>;
      const appendOnly = await outer.execute(sql`update audience_preset_authoring_revisions set reason_code = 'tamper'
        where workspace_id = ${ids.workspace}::uuid`).then(() => false, () => true);
      const arbitraryDeleteRejected = await outer.execute(sql`delete from promotion_template_authoring_revisions
        where workspace_id = ${ids.workspace}::uuid`).then(() => false, () => true);
      await outer.execute(sql`update workspaces set lifecycle_state = 'tombstoning' where id = ${ids.workspace}::uuid`);
      const tombstoneDeleteAllowed = await outer.execute(sql`delete from promotion_template_authoring_revisions
        where workspace_id = ${ids.workspace}::uuid`).then(() => true, () => false);
      evidence = { migrationApplied: true, forcedRls: true, serviceRoleRevoked: true, draftDidNotMaterialize:
        immutableBeforePublish.length === 1, explicitPresetPublish: Number(counts.immutable_presets) === 2,
        explicitTemplatePublish: Number(counts.immutable_templates) === 2, presetLifecycleTwoRows:
        Number(counts.preset_lifecycle) === 2, templateLifecycleThreeRows: Number(counts.template_lifecycle) === 3,
        staleOccRejected: staleRejected, archiveInvalidated: archive.contextInvalidationAppended,
        malformedPublishedRejected, malformedArchivedRejected,
        auditAtomic: Number(counts.audits) === 5, invalidationsAtomic: Number(counts.invalidations) === 3,
        appendOnly, arbitraryDeleteRejected, tombstoneDeleteAllowed, noNetworkOrMeta: networkCalls === 0 };
      if (!Object.values(evidence).every(Boolean)) throw new Error("promotion_lifecycle_acceptance_failed");
      throw rollback;
    });
  } catch (reason) {
    if (reason !== rollback) throw reason;
  } finally { globalThis.fetch = originalFetch; }
  const survivors = await database.select({ id: schema.workspaces.id }).from(schema.workspaces)
    .where(eq(schema.workspaces.id, ids.workspace));
  await pool.end();
  if (survivors.length !== 0 || !evidence || networkCalls !== 0) throw new Error("outer_rollback_failed");
  const finalEvidence = evidence as Record<string, boolean | number>;
  process.stdout.write(`${JSON.stringify({ ok: true, outerRollback: true, temporaryRowsCommitted: false,
    metaWriteCalls: 0, actionAuthorityCalls: 0, ...finalEvidence })}\n`);
}
