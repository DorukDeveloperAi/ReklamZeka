import { createHash } from "node:crypto";

import { createAudiencePresetRevision, createPromotionTemplateBinding, createPromotionTemplateRevision,
  type AudiencePresetRevision, type PromotionTemplateBinding, type PromotionTemplateRevision } from
  "@/domain/meta/promotion/promotion-template";
import { createAudiencePresetDraftMaterial, createPromotionTemplateBindingDraftMaterial,
  createPromotionTemplateDraftMaterial, type AudiencePresetDraftMaterial,
  type PromotionTemplateBindingDraftMaterial, type PromotionTemplateDraftMaterial } from
  "@/domain/meta/promotion/promotion-template-draft";

export const PROMOTION_TEMPLATE_LIFECYCLE_VERSION = "promotion-template-lifecycle/1.0.0" as const;
export type PromotionTemplateLifecycleStatus = "draft" | "published" | "archived";
type Role = "owner" | "admin" | "analyst";
type Authority = Readonly<{ canAuthorizeAction: false; canExecuteWrite: false; canWriteMeta: false; canGrantApproval: false }>;
const AUTHORITY: Authority = Object.freeze({ canAuthorizeAction: false, canExecuteWrite: false,
  canWriteMeta: false, canGrantApproval: false });

type LifecycleBase = Readonly<{ schemaVersion: typeof PROMOTION_TEMPLATE_LIFECYCLE_VERSION;
  workspaceRef: string; lifecycleVersion: number; previousRecordHash: string | null;
  status: PromotionTemplateLifecycleStatus; actorRef: string; actorRole: Role; reasonCode: string;
  recordedAt: string; authority: Authority; recordHash: string }>;

export type AudiencePresetLifecycleRevision = Readonly<LifecycleBase & {
  presetRef: string;
  material: AudiencePresetDraftMaterial;
  published: AudiencePresetRevision | null;
}>;

export type PromotionTemplateLifecycleRevision = Readonly<LifecycleBase & {
  templateRef: string;
  preset: AudiencePresetRevision;
  templateMaterial: PromotionTemplateDraftMaterial;
  bindingMaterial: PromotionTemplateBindingDraftMaterial;
  published: Readonly<{ template: PromotionTemplateRevision; binding: PromotionTemplateBinding }> | null;
}>;

export class PromotionTemplateLifecycleError extends Error {
  constructor(readonly code: "invalid_input" | "forbidden" | "conflict" | "not_found" | "invalid_transition" | "integrity_rejected") {
    super(`PromotionTemplate lifecycle reddedildi: ${code}`); this.name = "PromotionTemplateLifecycleError";
  }
}
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const REASON = /^[a-z][a-z0-9_]{1,63}$/;
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)])) : value; }
export function promotionTemplateLifecycleHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function fail(code: PromotionTemplateLifecycleError["code"] = "invalid_input"): never {
  throw new PromotionTemplateLifecycleError(code);
}
function ref(value: unknown) { if (typeof value !== "string" || !REF.test(value)) fail(); return value; }
function hash(value: unknown) { if (typeof value !== "string" || !HASH.test(value)) fail(); return value; }
function positive(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000) fail();
  return value as number;
}
function instant(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
  return value;
}
function lifecycle(input: Readonly<{ workspaceRef: string; lifecycleVersion: number; previousRecordHash: string | null;
  status: PromotionTemplateLifecycleStatus; actorRef: string; actorRole: Role; reasonCode: string; recordedAt: string }>) {
  const lifecycleVersion = positive(input.lifecycleVersion);
  const previousRecordHash = input.previousRecordHash === null ? null : hash(input.previousRecordHash);
  if ((lifecycleVersion === 1) !== (previousRecordHash === null)
    || !["draft", "published", "archived"].includes(input.status)
    || !["owner", "admin", "analyst"].includes(input.actorRole) || !REASON.test(input.reasonCode)) fail();
  return Object.freeze({ schemaVersion: PROMOTION_TEMPLATE_LIFECYCLE_VERSION, workspaceRef: ref(input.workspaceRef),
    lifecycleVersion, previousRecordHash, status: input.status, actorRef: ref(input.actorRef),
    actorRole: input.actorRole, reasonCode: input.reasonCode, recordedAt: instant(input.recordedAt), authority: AUTHORITY });
}
function canonicalPreset(value: AudiencePresetRevision) {
  try {
    const { presetHash, ...input } = value; const rebuilt = createAudiencePresetRevision(input);
    if (presetHash !== rebuilt.presetHash) throw new Error("hash"); return rebuilt;
  } catch { return fail("integrity_rejected"); }
}
function canonicalPublished(value: Readonly<{ template: PromotionTemplateRevision; binding: PromotionTemplateBinding }>) {
  try {
    const { templateHash, ...templateInput } = value.template;
    const template = createPromotionTemplateRevision(templateInput);
    const { bindingHash, ...bindingInput } = value.binding;
    const binding = createPromotionTemplateBinding(bindingInput, template);
    if (template.templateHash !== templateHash || binding.bindingHash !== bindingHash) throw new Error("hash");
    return Object.freeze({ template, binding });
  } catch { return fail("integrity_rejected"); }
}
function canonicalAudienceMaterial(value: AudiencePresetDraftMaterial) {
  try {
    const { version: _version, authority: _authority, materialHash, ...input } = value;
    const rebuilt = createAudiencePresetDraftMaterial(input);
    if (materialHash !== rebuilt.materialHash) throw new Error("hash"); return rebuilt;
  } catch { return fail("integrity_rejected"); }
}
function canonicalTemplateMaterial(value: PromotionTemplateDraftMaterial) {
  try {
    const { version: _version, authority: _authority, materialHash, ...input } = value;
    const rebuilt = createPromotionTemplateDraftMaterial(input);
    if (materialHash !== rebuilt.materialHash) throw new Error("hash"); return rebuilt;
  } catch { return fail("integrity_rejected"); }
}
function canonicalBindingMaterial(value: PromotionTemplateBindingDraftMaterial, template: PromotionTemplateDraftMaterial) {
  try {
    const { version: _version, authority: _authority, materialHash, ...input } = value;
    const rebuilt = createPromotionTemplateBindingDraftMaterial(input, template);
    if (materialHash !== rebuilt.materialHash) throw new Error("hash"); return rebuilt;
  } catch { return fail("integrity_rejected"); }
}

export function createAudiencePresetLifecycleRevision(input: Readonly<{
  workspaceRef: string; lifecycleVersion: number; previousRecordHash: string | null; status: PromotionTemplateLifecycleStatus;
  material: AudiencePresetDraftMaterial; published: AudiencePresetRevision | null; actorRef: string; actorRole: Role;
  reasonCode: string; recordedAt: string }>): AudiencePresetLifecycleRevision {
  const base = lifecycle(input); const material = canonicalAudienceMaterial(input.material);
  const published = input.published === null ? null : canonicalPreset(input.published);
  if (base.workspaceRef !== material.workspaceRef || published && (published.workspaceRef !== material.workspaceRef
    || published.presetRef !== material.presetRef || published.revision !== material.revision)
    || base.status === "draft" && published !== null || base.status === "published" && published === null) fail("integrity_rejected");
  const core = Object.freeze({ ...base, presetRef: material.presetRef, material, published });
  return Object.freeze({ ...core, recordHash: promotionTemplateLifecycleHash(core) });
}

export function createPromotionTemplateLifecycleRevision(input: Readonly<{
  workspaceRef: string; lifecycleVersion: number; previousRecordHash: string | null; status: PromotionTemplateLifecycleStatus;
  preset: AudiencePresetRevision; templateMaterial: PromotionTemplateDraftMaterial;
  bindingMaterial: PromotionTemplateBindingDraftMaterial;
  published: Readonly<{ template: PromotionTemplateRevision; binding: PromotionTemplateBinding }> | null;
  actorRef: string; actorRole: Role; reasonCode: string; recordedAt: string }>): PromotionTemplateLifecycleRevision {
  const base = lifecycle(input); const preset = canonicalPreset(input.preset);
  const templateMaterial = canonicalTemplateMaterial(input.templateMaterial);
  const bindingMaterial = canonicalBindingMaterial(input.bindingMaterial, templateMaterial);
  const published = input.published === null ? null : canonicalPublished(input.published);
  if (base.workspaceRef !== preset.workspaceRef || preset.workspaceRef !== templateMaterial.workspaceRef
    || templateMaterial.audiencePreset.presetRef !== preset.presetRef
    || templateMaterial.audiencePreset.revision !== preset.revision
    || templateMaterial.audiencePreset.presetHash !== preset.presetHash
    || base.status === "draft" && published !== null || base.status === "published" && published === null) {
    fail("integrity_rejected");
  }
  if (published && (published.template.templateRef !== templateMaterial.templateRef
    || published.template.revision !== templateMaterial.revision
    || published.template.audiencePreset.presetHash !== preset.presetHash
    || published.binding.bindingRef !== bindingMaterial.bindingRef
    || published.binding.template.templateHash !== published.template.templateHash)) fail("integrity_rejected");
  const core = Object.freeze({ ...base, templateRef: templateMaterial.templateRef, preset, templateMaterial,
    bindingMaterial, published });
  return Object.freeze({ ...core, recordHash: promotionTemplateLifecycleHash(core) });
}
