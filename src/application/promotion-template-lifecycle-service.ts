import { createHash } from "node:crypto";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { resolvePromotionTemplateAuthoringCandidate,
  type PromotionTemplateAuthoringSelection } from "@/application/promotion-template-authoring";
import type { PublishedPromotionTemplateCatalog } from "@/application/promotion-template-selector-service";
import type { PromotionTemplateSelectorCandidate } from "@/domain/meta/promotion/promotion-template-selector";
import { type AudiencePresetRevision } from "@/domain/meta/promotion/promotion-template";
import { createAudiencePresetDraftMaterial, createPromotionTemplateBindingDraftMaterial,
  createPromotionTemplateDraftMaterial } from "@/domain/meta/promotion/promotion-template-draft";
import { PromotionTemplateLifecycleError, createAudiencePresetLifecycleRevision,
  createPromotionTemplateLifecycleRevision, type AudiencePresetLifecycleRevision,
  type PromotionTemplateLifecycleRevision } from "@/domain/meta/promotion/promotion-template-lifecycle";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const PROMOTION_TEMPLATE_LIFECYCLE_SERVICE_VERSION = "promotion-template-lifecycle-service/1.0.0" as const;

export type PromotionTemplateLifecycleState = Readonly<{
  registryHash: string;
  presetCurrent: readonly AudiencePresetLifecycleRevision[];
  presetHistory: readonly AudiencePresetLifecycleRevision[];
  templateCurrent: readonly PromotionTemplateLifecycleRevision[];
  templateHistory: readonly PromotionTemplateLifecycleRevision[];
}>;

export type AudiencePresetLifecycleSummary = Readonly<{
  presetRef: string; lifecycleVersion: number; recordHash: string; status: "draft" | "published" | "archived";
  presetRevision: number; presetMaterialHash: string; publishedPresetHash: string | null;
  actorRole: "owner" | "admin" | "analyst"; reasonCode: string; recordedAt: string;
}>;
export type PromotionTemplateLifecycleSummary = Readonly<{
  templateRef: string; lifecycleVersion: number; recordHash: string; status: "draft" | "published" | "archived";
  presetRef: string; presetRevision: number; presetHash: string; templateRevision: number;
  templateMaterialHash: string; publishedTemplateHash: string | null; publishedBindingHash: string | null;
  actorRole: "owner" | "admin" | "analyst"; reasonCode: string; recordedAt: string;
}>;
export type PromotionTemplateLifecyclePublicState = Readonly<{
  registryHash: string;
  presetCurrent: readonly AudiencePresetLifecycleSummary[];
  presetHistory: readonly AudiencePresetLifecycleSummary[];
  templateCurrent: readonly PromotionTemplateLifecycleSummary[];
  templateHistory: readonly PromotionTemplateLifecycleSummary[];
}>;

type RegistryExpected = Readonly<{ expectedRegistryHash: string }>;
type PresetExpected = Readonly<RegistryExpected & { presetRef: string; expectedLifecycleVersion: number;
  expectedRecordHash: string; expectedPresetRevision: number; expectedPresetHash: string }>;
type TemplateExpected = Readonly<RegistryExpected & { templateRef: string; expectedLifecycleVersion: number;
  expectedRecordHash: string; expectedPresetRevision: number; expectedPresetHash: string;
  expectedTemplateRevision: number; expectedTemplateHash: string }>;
type ExactPresetRef = Readonly<{ presetRef: string; revision: number; presetHash: string }>;

export type PromotionTemplateLifecycleCommand =
  | Readonly<RegistryExpected & { operation: "create_preset_draft"; selection: PromotionTemplateAuthoringSelection; alias: string }>
  | Readonly<PresetExpected & { operation: "revise_preset_draft"; alias: string }>
  | Readonly<PresetExpected & { operation: "publish_preset" | "archive_preset"; reasonCode: string }>
  | Readonly<RegistryExpected & { operation: "create_template_draft"; selection: PromotionTemplateAuthoringSelection;
      audiencePreset: ExactPresetRef; alias: string }>
  | Readonly<TemplateExpected & { operation: "revise_template_draft"; audiencePreset: ExactPresetRef; alias: string }>
  | Readonly<TemplateExpected & { operation: "publish_template" | "archive_template"; reasonCode: string }>;

export type PromotionTemplateLifecycleRepository = Readonly<{
  inspect(workspaceId: string): Promise<PromotionTemplateLifecycleState>;
  mutate(input: Readonly<{ workspaceId: string; workspaceRef: string; actorId: string; actorRef: string;
    role: "owner" | "admin" | "analyst"; occurredAt: string; command: PromotionTemplateLifecycleCommand;
    sourceCandidate: PromotionTemplateSelectorCandidate | null }>): Promise<Readonly<{
      state: PromotionTemplateLifecycleState; auditAppended: true; contextInvalidationAppended: boolean;
      publishedMaterial: boolean }>>;
}>;

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const ALIAS = /^[\p{L}\p{N}][\p{L}\p{N} ._+:/()-]{0,79}$/u;
const REASON = /^[a-z][a-z0-9_]{1,63}$/;
function invalid(): never { throw new PromotionTemplateLifecycleError("invalid_input"); }
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) invalid(); return value; }
function ref(value: unknown): string { if (typeof value !== "string" || !REF.test(value)) invalid(); return value; }
function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000) invalid();
  return value as number;
}
function alias(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || !ALIAS.test(value)) invalid(); return value;
}
function presetRef(value: ExactPresetRef): ExactPresetRef {
  return Object.freeze({ presetRef: ref(value.presetRef), revision: positive(value.revision), presetHash: hash(value.presetHash) });
}
function registry(value: RegistryExpected) { return hash(value.expectedRegistryHash); }
function presetExpected(value: PresetExpected): PresetExpected {
  return Object.freeze({ expectedRegistryHash: registry(value), presetRef: ref(value.presetRef),
    expectedLifecycleVersion: positive(value.expectedLifecycleVersion), expectedRecordHash: hash(value.expectedRecordHash),
    expectedPresetRevision: positive(value.expectedPresetRevision), expectedPresetHash: hash(value.expectedPresetHash) });
}
function templateExpected(value: TemplateExpected): TemplateExpected {
  return Object.freeze({ expectedRegistryHash: registry(value), templateRef: ref(value.templateRef),
    expectedLifecycleVersion: positive(value.expectedLifecycleVersion), expectedRecordHash: hash(value.expectedRecordHash),
    expectedPresetRevision: positive(value.expectedPresetRevision), expectedPresetHash: hash(value.expectedPresetHash),
    expectedTemplateRevision: positive(value.expectedTemplateRevision), expectedTemplateHash: hash(value.expectedTemplateHash) });
}
function normalize(command: PromotionTemplateLifecycleCommand): PromotionTemplateLifecycleCommand {
  if (command.operation === "create_preset_draft") return Object.freeze({ ...command,
    expectedRegistryHash: registry(command), alias: alias(command.alias) });
  if (command.operation === "create_template_draft") return Object.freeze({ ...command,
    expectedRegistryHash: registry(command), audiencePreset: presetRef(command.audiencePreset), alias: alias(command.alias) });
  if (command.operation === "revise_preset_draft") return Object.freeze({ operation: command.operation,
    ...presetExpected(command), alias: alias(command.alias) });
  if (command.operation === "revise_template_draft") return Object.freeze({ operation: command.operation,
    ...templateExpected(command), audiencePreset: presetRef(command.audiencePreset), alias: alias(command.alias) });
  if (!REASON.test(command.reasonCode)) invalid();
  if (command.operation === "publish_preset" || command.operation === "archive_preset") {
    return Object.freeze({ operation: command.operation, ...presetExpected(command), reasonCode: command.reasonCode });
  }
  return Object.freeze({ operation: command.operation,
    ...templateExpected(command as Extract<PromotionTemplateLifecycleCommand,
      { operation: "publish_template" | "archive_template" }>), reasonCode: command.reasonCode });
}

export function promotionTemplateLifecycleAuthority(role: WorkspaceMembership["role"]) {
  return Object.freeze({ canRead: true as const, canDraft: role !== "viewer", canRevise: role !== "viewer",
    canPublish: role === "owner" || role === "admin", canArchive: role === "owner" || role === "admin",
    canAuthorizeAction: false as const, canExecuteWrite: false as const, canWriteMeta: false as const,
    canGrantApproval: false as const });
}
function aliases(values: readonly string[], added: string) {
  return Object.freeze([...new Set([...values, added])].sort((left, right) => left.localeCompare(right, "tr-TR")));
}
function presetSummary(value: AudiencePresetLifecycleRevision): AudiencePresetLifecycleSummary {
  return Object.freeze({ presetRef: value.presetRef, lifecycleVersion: value.lifecycleVersion,
    recordHash: value.recordHash, status: value.status, presetRevision: value.material.revision,
    presetMaterialHash: value.material.materialHash, publishedPresetHash: value.published?.presetHash ?? null,
    actorRole: value.actorRole, reasonCode: value.reasonCode, recordedAt: value.recordedAt });
}
function templateSummary(value: PromotionTemplateLifecycleRevision): PromotionTemplateLifecycleSummary {
  return Object.freeze({ templateRef: value.templateRef, lifecycleVersion: value.lifecycleVersion,
    recordHash: value.recordHash, status: value.status, presetRef: value.preset.presetRef,
    presetRevision: value.preset.revision, presetHash: value.preset.presetHash,
    templateRevision: value.templateMaterial.revision, templateMaterialHash: value.templateMaterial.materialHash,
    publishedTemplateHash: value.published?.template.templateHash ?? null,
    publishedBindingHash: value.published?.binding.bindingHash ?? null, actorRole: value.actorRole,
    reasonCode: value.reasonCode, recordedAt: value.recordedAt });
}
function publicState(value: PromotionTemplateLifecycleState): PromotionTemplateLifecyclePublicState {
  return Object.freeze({ registryHash: value.registryHash,
    presetCurrent: Object.freeze(value.presetCurrent.map(presetSummary)),
    presetHistory: Object.freeze(value.presetHistory.map(presetSummary)),
    templateCurrent: Object.freeze(value.templateCurrent.map(templateSummary)),
    templateHistory: Object.freeze(value.templateHistory.map(templateSummary)) });
}
export function nextAudiencePresetDraft(input: Readonly<{ source: AudiencePresetRevision | null;
  current: AudiencePresetLifecycleRevision | null; alias: string; actorRef: string;
  actorRole: "owner" | "admin" | "analyst"; recordedAt: string }>): AudiencePresetLifecycleRevision {
  if (!input.current && !input.source) throw new PromotionTemplateLifecycleError("invalid_input");
  const base = input.current?.material ?? createAudiencePresetDraftMaterial((({ version: _version, state: _state,
    publishedAt: _publishedAt, presetHash: _presetHash, ...value }) => value)(input.source!));
  const { version: _draftVersion, authority: _authority, materialHash: _materialHash, ...baseInput } = base;
  const material = createAudiencePresetDraftMaterial({ ...baseInput,
    revision: input.current?.status === "draft" ? base.revision : base.revision + 1,
    aliases: aliases(base.aliases, input.alias) });
  return createAudiencePresetLifecycleRevision({ workspaceRef: material.workspaceRef,
    lifecycleVersion: (input.current?.lifecycleVersion ?? 0) + 1,
    previousRecordHash: input.current?.recordHash ?? null, status: "draft", material, published: null,
    actorRef: input.actorRef, actorRole: input.actorRole,
    reasonCode: input.current ? "preset_draft_revised" : "preset_draft_created", recordedAt: input.recordedAt });
}
export function nextPromotionTemplateDraft(input: Readonly<{ source: PromotionTemplateSelectorCandidate | null;
  current: PromotionTemplateLifecycleRevision | null; preset: AudiencePresetRevision; alias: string;
  actorRef: string; actorRole: "owner" | "admin" | "analyst"; recordedAt: string }>): PromotionTemplateLifecycleRevision {
  if (!input.current && !input.source) throw new PromotionTemplateLifecycleError("invalid_input");
  const sourceTemplate = input.current?.templateMaterial ?? createPromotionTemplateDraftMaterial((({ version: _version,
    state: _state, publishedAt: _publishedAt, templateHash: _templateHash, ...value }) => value)(input.source!.template));
  const sourceBinding = input.current?.bindingMaterial ?? input.source!.binding;
  const { version: _draftVersion, authority: _authority, materialHash: _materialHash, ...templateInput } = sourceTemplate;
  const templateMaterial = createPromotionTemplateDraftMaterial({ ...templateInput,
    revision: input.current?.status === "draft" ? sourceTemplate.revision : sourceTemplate.revision + 1,
    aliases: aliases(sourceTemplate.aliases, input.alias), audiencePreset: { presetRef: input.preset.presetRef,
      revision: input.preset.revision, presetHash: input.preset.presetHash } });
  const bindingRef = `promotion_binding_${createHash("sha256").update(`${sourceBinding.bindingRef}\0${templateMaterial.materialHash}`)
    .digest("hex").slice(0, 24)}`;
  const scope = (({ workspaceRef, accountRef, actor, internalCategoryRefs, campaignRef }) =>
    ({ workspaceRef, accountRef, actor, internalCategoryRefs, campaignRef }))(sourceBinding);
  const bindingMaterial = createPromotionTemplateBindingDraftMaterial({ ...scope, bindingRef,
    template: { templateRef: templateMaterial.templateRef, revision: templateMaterial.revision,
      materialHash: templateMaterial.materialHash } }, templateMaterial);
  return createPromotionTemplateLifecycleRevision({ workspaceRef: templateMaterial.workspaceRef,
    lifecycleVersion: (input.current?.lifecycleVersion ?? 0) + 1,
    previousRecordHash: input.current?.recordHash ?? null, status: "draft", preset: input.preset,
    templateMaterial, bindingMaterial, published: null,
    actorRef: input.actorRef, actorRole: input.actorRole,
    reasonCode: input.current ? "template_draft_revised" : "template_draft_created", recordedAt: input.recordedAt });
}

export class PromotionTemplateLifecycleService {
  constructor(private readonly repository: PromotionTemplateLifecycleRepository,
    private readonly catalog: PublishedPromotionTemplateCatalog,
    private readonly memberships: readonly WorkspaceMembership[]) {}
  async inspect(principal: TrustedDecisionRoomPrincipal) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "data:read", this.memberships);
    return Object.freeze({ contractVersion: PROMOTION_TEMPLATE_LIFECYCLE_SERVICE_VERSION,
      ...publicState(await this.repository.inspect(principal.workspaceId)),
      authority: promotionTemplateLifecycleAuthority(membership.role) });
  }
  async mutate(principal: TrustedDecisionRoomPrincipal, commandValue: PromotionTemplateLifecycleCommand) {
    const command = normalize(commandValue);
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "promotion:draft", this.memberships);
    const publication = command.operation.startsWith("publish_") || command.operation.startsWith("archive_");
    if (membership.role === "viewer" || publication && membership.role === "analyst") invalid();
    const role = membership.role as "owner" | "admin" | "analyst";
    const occurredAt = new Date().toISOString();
    let sourceCandidate: PromotionTemplateSelectorCandidate | null = null;
    if (command.operation === "create_preset_draft" || command.operation === "create_template_draft") {
      const candidates = await this.catalog.listPublished({ workspaceRef: principal.workspaceRef, evaluatedAt: occurredAt });
      sourceCandidate = resolvePromotionTemplateAuthoringCandidate({ candidates, workspaceRef: principal.workspaceRef,
        selection: command.selection, evaluatedAt: occurredAt });
    }
    const result = await this.repository.mutate({ workspaceId: principal.workspaceId,
      workspaceRef: principal.workspaceRef, actorId: principal.actor.userId, actorRef: principal.readerRef,
      role, occurredAt, command, sourceCandidate });
    return Object.freeze({ contractVersion: PROMOTION_TEMPLATE_LIFECYCLE_SERVICE_VERSION, ...result,
      state: publicState(result.state),
      authority: promotionTemplateLifecycleAuthority(role) });
  }
}
