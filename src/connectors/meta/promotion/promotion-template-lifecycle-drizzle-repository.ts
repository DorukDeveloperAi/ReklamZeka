import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { nextAudiencePresetDraft, nextPromotionTemplateDraft,
  type PromotionTemplateLifecycleCommand, type PromotionTemplateLifecycleRepository,
  type PromotionTemplateLifecycleState } from "@/application/promotion-template-lifecycle-service";
import { DrizzlePromotionRegistryRepository } from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";
import { EFFECTIVE_CONTEXT_PROMOTION_REGISTRY_COMPONENT_REF } from "@/analyses/effective-campaign-context";
import * as schema from "@/db/schema";
import { createAudiencePresetRevision, type AudiencePresetRevision } from "@/domain/meta/promotion/promotion-template";
import { publishAudiencePresetDraftMaterial, publishPromotionTemplateBindingDraftMaterial,
  publishPromotionTemplateDraftMaterial } from "@/domain/meta/promotion/promotion-template-draft";
import { PromotionTemplateLifecycleError, createAudiencePresetLifecycleRevision,
  createPromotionTemplateLifecycleRevision, promotionTemplateLifecycleHash,
  type AudiencePresetLifecycleRevision, type PromotionTemplateLifecycleRevision } from
  "@/domain/meta/promotion/promotion-template-lifecycle";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type PresetRow = Readonly<{ workspace_ref: string; preset_ref: string; lifecycle_version: number;
  previous_record_hash: string | null; status: "draft" | "published" | "archived"; preset_payload: unknown;
  published_preset_payload: unknown | null; actor_ref: string; actor_role: "owner" | "admin" | "analyst";
  reason_code: string; record_hash: string; recorded_at: string | Date }>;
type TemplateRow = Readonly<{ workspace_ref: string; template_ref: string; lifecycle_version: number;
  previous_record_hash: string | null; status: "draft" | "published" | "archived"; preset_payload: unknown;
  template_payload: unknown; binding_payload: unknown; published_template_payload: unknown | null;
  published_binding_payload: unknown | null; actor_ref: string; actor_role: "owner" | "admin" | "analyst";
  reason_code: string; record_hash: string; recorded_at: string | Date }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
function fail(code: PromotionTemplateLifecycleError["code"]): never { throw new PromotionTemplateLifecycleError(code); }
function rows<T>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("integrity_rejected");
  return value.rows as readonly T[];
}
export function promotionRegistryInvalidationVersions(
  currentAuthoringRegistryHash: string,
  persistedContextVersions: readonly string[],
): readonly string[] {
  if (!HASH.test(currentAuthoringRegistryHash) || persistedContextVersions.length > 1000
    || persistedContextVersions.some((value) => !HASH.test(value))) fail("integrity_rejected");
  return Object.freeze([...new Set([currentAuthoringRegistryHash, ...persistedContextVersions])].sort());
}
function at(value: string | Date) { const date = new Date(value); if (!Number.isFinite(date.valueOf())) fail("integrity_rejected");
  return date.toISOString(); }
function presetFromRow(row: PresetRow) {
  const revision = createAudiencePresetLifecycleRevision({ workspaceRef: row.workspace_ref,
    lifecycleVersion: Number(row.lifecycle_version), previousRecordHash: row.previous_record_hash, status: row.status,
    material: row.preset_payload as never, published: row.published_preset_payload as never,
    actorRef: row.actor_ref, actorRole: row.actor_role, reasonCode: row.reason_code, recordedAt: at(row.recorded_at) });
  if (revision.presetRef !== row.preset_ref || revision.recordHash !== row.record_hash) fail("integrity_rejected");
  return revision;
}
function templateFromRow(row: TemplateRow) {
  const published = row.published_template_payload === null && row.published_binding_payload === null ? null
    : row.published_template_payload !== null && row.published_binding_payload !== null
      ? { template: row.published_template_payload as never, binding: row.published_binding_payload as never }
      : fail("integrity_rejected");
  const revision = createPromotionTemplateLifecycleRevision({ workspaceRef: row.workspace_ref,
    lifecycleVersion: Number(row.lifecycle_version), previousRecordHash: row.previous_record_hash, status: row.status,
    preset: row.preset_payload as never, templateMaterial: row.template_payload as never,
    bindingMaterial: row.binding_payload as never, published,
    actorRef: row.actor_ref, actorRole: row.actor_role, reasonCode: row.reason_code, recordedAt: at(row.recorded_at) });
  if (revision.templateRef !== row.template_ref || revision.recordHash !== row.record_hash) fail("integrity_rejected");
  return revision;
}
function current<T extends { lifecycleVersion: number }>(items: readonly T[], ref: (item: T) => string) {
  return Object.freeze(items.filter((item) => !items.some((other) => ref(other) === ref(item)
    && other.lifecycleVersion > item.lifecycleVersion)));
}
async function load(database: Executor, workspaceId: string): Promise<PromotionTemplateLifecycleState> {
  const presetHistory = rows<PresetRow>(await database.execute(sql`select workspace_ref, preset_ref, lifecycle_version,
    previous_record_hash, status, preset_payload, published_preset_payload, actor_ref, actor_role, reason_code,
    record_hash, recorded_at from audience_preset_authoring_revisions where workspace_id = ${workspaceId}::uuid
    order by preset_ref, lifecycle_version`)).map(presetFromRow);
  const templateHistory = rows<TemplateRow>(await database.execute(sql`select workspace_ref, template_ref, lifecycle_version,
    previous_record_hash, status, preset_payload, template_payload, binding_payload, published_template_payload,
    published_binding_payload, actor_ref, actor_role, reason_code, record_hash, recorded_at
    from promotion_template_authoring_revisions where workspace_id = ${workspaceId}::uuid
    order by template_ref, lifecycle_version`)).map(templateFromRow);
  if (presetHistory.length > 10_000 || templateHistory.length > 10_000) fail("integrity_rejected");
  const presetCurrent = current(presetHistory, (item) => item.presetRef);
  const templateCurrent = current(templateHistory, (item) => item.templateRef);
  const registryHash = promotionTemplateLifecycleHash({ presets: presetCurrent.map((item) =>
    [item.presetRef, item.lifecycleVersion, item.recordHash, item.status]), templates: templateCurrent.map((item) =>
    [item.templateRef, item.lifecycleVersion, item.recordHash, item.status]) });
  return Object.freeze({ registryHash, presetCurrent, presetHistory: Object.freeze(presetHistory),
    templateCurrent, templateHistory: Object.freeze(templateHistory) });
}
function presetHead(state: PromotionTemplateLifecycleState, ref: string) { return state.presetCurrent.find((item) => item.presetRef === ref); }
function templateHead(state: PromotionTemplateLifecycleState, ref: string) { return state.templateCurrent.find((item) => item.templateRef === ref); }
function presetOcc(found: AudiencePresetLifecycleRevision | undefined,
  command: Extract<PromotionTemplateLifecycleCommand, { presetRef: string }>) {
  if (!found) fail("not_found");
  if (found.lifecycleVersion !== command.expectedLifecycleVersion || found.recordHash !== command.expectedRecordHash
    || found.material.revision !== command.expectedPresetRevision || found.material.materialHash !== command.expectedPresetHash) {
    fail("conflict");
  }
  return found;
}
function templateOcc(found: PromotionTemplateLifecycleRevision | undefined,
  command: Extract<PromotionTemplateLifecycleCommand, { templateRef: string }>) {
  if (!found) fail("not_found");
  if (found.lifecycleVersion !== command.expectedLifecycleVersion || found.recordHash !== command.expectedRecordHash
    || found.preset.revision !== command.expectedPresetRevision || found.preset.presetHash !== command.expectedPresetHash
    || found.templateMaterial.revision !== command.expectedTemplateRevision
    || found.templateMaterial.materialHash !== command.expectedTemplateHash) fail("conflict");
  return found;
}
async function insertPreset(database: Executor, workspaceId: string, value: AudiencePresetLifecycleRevision) {
  await database.execute(sql`insert into audience_preset_authoring_revisions (id, workspace_id, workspace_ref,
    preset_ref, lifecycle_version, previous_record_hash, status, preset_revision, preset_hash, preset_payload,
    published_preset_hash, published_preset_payload, actor_ref, actor_role, reason_code, record_hash, recorded_at)
    values (${randomUUID()}::uuid, ${workspaceId}::uuid, ${value.workspaceRef}, ${value.presetRef},
      ${value.lifecycleVersion}, ${value.previousRecordHash}, ${value.status}, ${value.material.revision},
      ${value.material.materialHash}, ${JSON.stringify(value.material)}::jsonb, ${value.published?.presetHash ?? null},
      ${value.published ? JSON.stringify(value.published) : null}::jsonb, ${value.actorRef}, ${value.actorRole},
      ${value.reasonCode}, ${value.recordHash}, ${value.recordedAt}::timestamptz)`);
}
async function insertTemplate(database: Executor, workspaceId: string, value: PromotionTemplateLifecycleRevision) {
  await database.execute(sql`insert into promotion_template_authoring_revisions (id, workspace_id, workspace_ref,
    template_ref, lifecycle_version, previous_record_hash, status, preset_ref, preset_revision, preset_hash,
    preset_payload, template_revision, template_hash, template_payload, binding_ref, binding_hash, binding_payload,
    published_template_hash, published_template_payload, published_binding_hash, published_binding_payload,
    actor_ref, actor_role, reason_code, record_hash, recorded_at)
    values (${randomUUID()}::uuid, ${workspaceId}::uuid, ${value.workspaceRef}, ${value.templateRef},
      ${value.lifecycleVersion}, ${value.previousRecordHash}, ${value.status}, ${value.preset.presetRef},
      ${value.preset.revision}, ${value.preset.presetHash}, ${JSON.stringify(value.preset)}::jsonb,
      ${value.templateMaterial.revision}, ${value.templateMaterial.materialHash}, ${JSON.stringify(value.templateMaterial)}::jsonb,
      ${value.bindingMaterial.bindingRef}, ${value.bindingMaterial.materialHash}, ${JSON.stringify(value.bindingMaterial)}::jsonb,
      ${value.published?.template.templateHash ?? null}, ${value.published ? JSON.stringify(value.published.template) : null}::jsonb,
      ${value.published?.binding.bindingHash ?? null}, ${value.published ? JSON.stringify(value.published.binding) : null}::jsonb,
      ${value.actorRef}, ${value.actorRole}, ${value.reasonCode}, ${value.recordHash}, ${value.recordedAt}::timestamptz)`);
}
async function materializePreset(database: Database, workspaceId: string, preset: AudiencePresetRevision) {
  const found = await database.select().from(schema.audiencePresetRevisions).where(and(
    eq(schema.audiencePresetRevisions.workspaceId, workspaceId), eq(schema.audiencePresetRevisions.presetRef, preset.presetRef),
    eq(schema.audiencePresetRevisions.revision, preset.revision))).limit(2);
  if (found.length > 1) fail("integrity_rejected");
  if (found[0]) {
    if (found[0].presetHash !== preset.presetHash || JSON.stringify(found[0].payload) !== JSON.stringify(preset)) fail("conflict");
    return;
  }
  await database.insert(schema.audiencePresetRevisions).values({ workspaceId, presetRef: preset.presetRef,
    revision: preset.revision, schemaVersion: preset.version, state: preset.state, audienceKind: preset.source.kind,
    sourceRef: preset.source.sourceRef, targetingHash: preset.source.targetingHash,
    provenanceHash: preset.source.provenanceHash, presetHash: preset.presetHash,
    payload: preset as unknown as Record<string, unknown>, publishedAt: new Date(preset.publishedAt) });
}
async function exactPublishedPreset(database: Database, workspaceId: string, state: PromotionTemplateLifecycleState,
  exact: Readonly<{ presetRef: string; revision: number; presetHash: string }>) {
  const managed = presetHead(state, exact.presetRef);
  if (managed?.status === "archived") fail("invalid_transition");
  const found = await database.select().from(schema.audiencePresetRevisions).where(and(
    eq(schema.audiencePresetRevisions.workspaceId, workspaceId), eq(schema.audiencePresetRevisions.presetRef, exact.presetRef),
    eq(schema.audiencePresetRevisions.revision, exact.revision), eq(schema.audiencePresetRevisions.presetHash, exact.presetHash))).limit(2);
  if (found.length !== 1) fail("not_found");
  try {
    const value = found[0]!.payload as unknown as AudiencePresetRevision; const { presetHash, ...input } = value;
    const rebuilt = createAudiencePresetRevision(input); if (rebuilt.presetHash !== presetHash) throw new Error("hash"); return rebuilt;
  } catch { return fail("integrity_rejected"); }
}

export class DrizzlePromotionTemplateLifecycleRepository implements PromotionTemplateLifecycleRepository {
  constructor(private readonly database: Database) {}
  async inspect(workspaceId: string) { if (!UUID.test(workspaceId)) fail("invalid_input"); return load(this.database, workspaceId); }
  async mutate(input: Parameters<PromotionTemplateLifecycleRepository["mutate"]>[0]) {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !Number.isFinite(Date.parse(input.occurredAt))) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid
        and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const membership = rows<{ role: string }>(await tx.execute(sql`select role from memberships
        where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid limit 2 for update`));
      if (membership.length !== 1 || membership[0]!.role !== input.role || input.role === "analyst"
        && (input.command.operation.startsWith("publish_") || input.command.operation.startsWith("archive_"))) fail("forbidden");
      const before = await load(tx, input.workspaceId); if (before.registryHash !== input.command.expectedRegistryHash) fail("conflict");
      const command = input.command; let preset: AudiencePresetLifecycleRevision | null = null;
      let template: PromotionTemplateLifecycleRevision | null = null; let publishedMaterial = false;
      if (command.operation === "create_preset_draft") {
        if (!input.sourceCandidate || presetHead(before, input.sourceCandidate.preset.presetRef)) fail("conflict");
        preset = nextAudiencePresetDraft({ source: input.sourceCandidate.preset, current: null, alias: command.alias,
          actorRef: input.actorRef, actorRole: input.role, recordedAt: input.occurredAt });
      } else if (command.operation === "revise_preset_draft") {
        const head = presetOcc(presetHead(before, command.presetRef), command); if (head.status === "archived") fail("invalid_transition");
        preset = nextAudiencePresetDraft({ source: null,
          current: head, alias: command.alias, actorRef: input.actorRef, actorRole: input.role, recordedAt: input.occurredAt });
      } else if (command.operation === "publish_preset" || command.operation === "archive_preset") {
        const head = presetOcc(presetHead(before, command.presetRef), command);
        if (command.operation === "publish_preset") {
          if (head.status !== "draft") fail("invalid_transition");
          const published = publishAudiencePresetDraftMaterial(head.material, input.occurredAt);
          await materializePreset(tx, input.workspaceId, published);
          preset = createAudiencePresetLifecycleRevision({ workspaceRef: head.workspaceRef,
            lifecycleVersion: head.lifecycleVersion + 1, previousRecordHash: head.recordHash, status: "published",
            material: head.material, published, actorRef: input.actorRef, actorRole: input.role,
            reasonCode: command.reasonCode, recordedAt: input.occurredAt }); publishedMaterial = true;
        } else {
          if (head.status === "archived" || before.templateCurrent.some((item) => item.status !== "archived"
            && item.preset.presetRef === head.presetRef)) fail("invalid_transition");
          preset = createAudiencePresetLifecycleRevision({ workspaceRef: head.workspaceRef,
            lifecycleVersion: head.lifecycleVersion + 1, previousRecordHash: head.recordHash, status: "archived",
            material: head.material, published: head.published, actorRef: input.actorRef, actorRole: input.role,
            reasonCode: command.reasonCode, recordedAt: input.occurredAt });
        }
      } else if (command.operation === "create_template_draft") {
        if (!input.sourceCandidate || templateHead(before, input.sourceCandidate.template.templateRef)) fail("conflict");
        const exact = await exactPublishedPreset(tx, input.workspaceId, before, command.audiencePreset);
        template = nextPromotionTemplateDraft({ source: input.sourceCandidate, current: null, preset: exact,
          alias: command.alias, actorRef: input.actorRef, actorRole: input.role, recordedAt: input.occurredAt });
      } else if (command.operation === "revise_template_draft") {
        const head = templateOcc(templateHead(before, command.templateRef), command); if (head.status === "archived") fail("invalid_transition");
        const exact = await exactPublishedPreset(tx, input.workspaceId, before, command.audiencePreset);
        template = nextPromotionTemplateDraft({ source: null, current: head, preset: exact,
          alias: command.alias, actorRef: input.actorRef, actorRole: input.role, recordedAt: input.occurredAt });
      } else if (command.operation === "publish_template" || command.operation === "archive_template") {
        const head = templateOcc(templateHead(before, command.templateRef), command);
        if (command.operation === "publish_template") {
          if (head.status !== "draft") fail("invalid_transition");
          await exactPublishedPreset(tx, input.workspaceId, before, { presetRef: head.preset.presetRef,
            revision: head.preset.revision, presetHash: head.preset.presetHash });
          const publishedTemplate = publishPromotionTemplateDraftMaterial(head.templateMaterial, input.occurredAt);
          const publishedBinding = publishPromotionTemplateBindingDraftMaterial(head.bindingMaterial, publishedTemplate, input.occurredAt);
          await new DrizzlePromotionRegistryRepository(tx, input.workspaceId, input.workspaceRef).publish({ preset: head.preset,
            template: publishedTemplate, binding: publishedBinding });
          template = createPromotionTemplateLifecycleRevision({ workspaceRef: head.workspaceRef,
            lifecycleVersion: head.lifecycleVersion + 1, previousRecordHash: head.recordHash, status: "published",
            preset: head.preset, templateMaterial: head.templateMaterial, bindingMaterial: head.bindingMaterial,
            published: { template: publishedTemplate, binding: publishedBinding }, actorRef: input.actorRef,
            actorRole: input.role, reasonCode: command.reasonCode, recordedAt: input.occurredAt }); publishedMaterial = true;
        } else {
          if (head.status === "archived") fail("invalid_transition");
          template = createPromotionTemplateLifecycleRevision({ workspaceRef: head.workspaceRef,
            lifecycleVersion: head.lifecycleVersion + 1, previousRecordHash: head.recordHash, status: "archived",
            preset: head.preset, templateMaterial: head.templateMaterial, bindingMaterial: head.bindingMaterial,
            published: head.published, actorRef: input.actorRef, actorRole: input.role,
            reasonCode: command.reasonCode, recordedAt: input.occurredAt });
        }
      } else fail("invalid_input");
      if (preset) await insertPreset(tx, input.workspaceId, preset); if (template) await insertTemplate(tx, input.workspaceId, template);
      const lifecycle = preset ?? template!; let contextInvalidationAppended = false;
      let contextInvalidationPlannedCount = 0; let contextInvalidationAppendedCount = 0;
      let contextInvalidationReason: "source_changed" | "source_removed" | null = null;
      if (command.operation.startsWith("publish_") || command.operation.startsWith("archive_")) {
        const persisted = rows<{ component_version: string }>(await tx.execute(sql`
          select distinct component.component_version
          from effective_campaign_context_components component
          where component.workspace_id = ${input.workspaceId}::uuid
            and component.component_type = 'promotion_registry'
            and component.component_ref = ${EFFECTIVE_CONTEXT_PROMOTION_REGISTRY_COMPONENT_REF}
          order by component.component_version
          limit 1001
        `));
        const versions = promotionRegistryInvalidationVersions(before.registryHash,
          persisted.map((item) => item.component_version));
        contextInvalidationReason = command.operation.startsWith("archive_") ? "source_removed" : "source_changed";
        contextInvalidationPlannedCount = versions.length;
        for (const componentVersion of versions) {
          const invalidation = { workspaceId: input.workspaceId, componentType: "promotion_registry",
            componentRef: EFFECTIVE_CONTEXT_PROMOTION_REGISTRY_COMPONENT_REF, componentVersion,
            scopeKind: "workspace_component", entityType: null, entityRef: null,
            reasonCode: contextInvalidationReason, observedAt: input.occurredAt } as const;
          contextInvalidationAppendedCount += rows(await tx.execute(sql`insert into effective_campaign_context_invalidations
            (workspace_id, event_hash, component_type, component_ref, component_version, scope_kind, entity_type, entity_ref,
              reason_code, observed_at) values (${input.workspaceId}::uuid, ${promotionTemplateLifecycleHash(invalidation)},
              'promotion_registry', ${EFFECTIVE_CONTEXT_PROMOTION_REGISTRY_COMPONENT_REF}, ${componentVersion},
              'workspace_component', null, null, ${invalidation.reasonCode}, ${input.occurredAt}::timestamptz)
            on conflict (workspace_id, event_hash) do nothing returning id`)).length;
        }
        contextInvalidationAppended = contextInvalidationAppendedCount > 0;
      }
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousHash = String(rows<{ event_hash: string }>(await tx.execute(sql`select event_hash from audit_events
        where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`
      ))[0]?.event_hash ?? "GENESIS");
      const event = { id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId,
        action: `promotion_template.${command.operation}`, resourceType: preset ? "audience_preset_version" : "promotion_template",
        resourceId: preset?.presetRef ?? template!.templateRef, occurredAt: input.occurredAt, previousHash,
        metadata: { role: input.role, lifecycleVersion: lifecycle.lifecycleVersion,
          expectedRegistryHash: command.expectedRegistryHash, previousAuthoringRegistryHash: before.registryHash,
          reasonCode: lifecycle.reasonCode, newRecordHash: lifecycle.recordHash,
          contextInvalidationReason, contextInvalidationPlannedCount, contextInvalidationAppendedCount,
          contextInvalidationAppended, publishedMaterial } } as const;
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
        metadata, previous_hash, event_hash, occurred_at) values (${event.id}::uuid, ${event.workspaceId}::uuid,
        ${event.actorId}::uuid, ${event.action}, ${event.resourceType}, ${event.resourceId}, ${JSON.stringify(event.metadata)}::jsonb,
        ${event.previousHash}, ${createHash("sha256").update(JSON.stringify(event)).digest("hex")}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ state: await load(tx, input.workspaceId), auditAppended: true as const,
        contextInvalidationAppended, publishedMaterial });
    });
  }
}
