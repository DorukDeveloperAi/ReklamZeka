import { createHash } from "node:crypto";

import {
  AUDIENCE_PRESET_VERSION,
  PROMOTION_TEMPLATE_BINDING_VERSION,
  PROMOTION_TEMPLATE_VERSION,
  createAudiencePresetRevision,
  createPromotionTemplateBinding,
  createPromotionTemplateRevision,
  type AudiencePresetRevision,
  type AudiencePresetRevisionInput,
  type PromotionTemplateBinding,
  type PromotionTemplateRevision,
  type PromotionTemplateRevisionInput,
} from "@/domain/meta/promotion/promotion-template";

export const AUDIENCE_PRESET_DRAFT_VERSION = "audience-preset-draft-material/1.0.0" as const;
export const PROMOTION_TEMPLATE_DRAFT_VERSION = "promotion-template-draft-material/1.0.0" as const;
export const PROMOTION_TEMPLATE_BINDING_DRAFT_VERSION = "promotion-template-binding-draft-material/1.0.0" as const;
const VALIDATION_INSTANT = "2000-01-01T00:00:00.000Z";

type Authority = Readonly<{ canAuthorizeAction: false; canExecuteWrite: false; canWriteMeta: false; canGrantApproval: false }>;
const AUTHORITY: Authority = Object.freeze({ canAuthorizeAction: false, canExecuteWrite: false,
  canWriteMeta: false, canGrantApproval: false });

export type AudiencePresetDraftMaterial = Readonly<{
  version: typeof AUDIENCE_PRESET_DRAFT_VERSION;
  workspaceRef: string;
  presetRef: string;
  revision: number;
  aliases: readonly string[];
  source: AudiencePresetRevisionInput["source"];
  targeting: AudiencePresetRevisionInput["targeting"];
  authority: Authority;
  materialHash: string;
}>;

export type PromotionTemplateDraftMaterial = Readonly<{
  version: typeof PROMOTION_TEMPLATE_DRAFT_VERSION;
  workspaceRef: string;
  templateRef: string;
  revision: number;
  aliases: readonly string[];
  accountRefs: readonly string[];
  actorTypes: PromotionTemplateRevisionInput["actorTypes"];
  internalCategoryRefs: readonly string[];
  postTypes: PromotionTemplateRevisionInput["postTypes"];
  objectiveRef: string;
  optimizationGoalRef: string;
  destinationRef: string;
  placementRefs: readonly string[];
  namingRuleRef: string;
  trackingRuleRef: string;
  adSetPolicy: PromotionTemplateRevisionInput["adSetPolicy"];
  audiencePreset: PromotionTemplateRevisionInput["audiencePreset"];
  budget: PromotionTemplateRevisionInput["budget"];
  timeframe: PromotionTemplateRevisionInput["timeframe"];
  authority: Authority;
  materialHash: string;
}>;

export type PromotionTemplateBindingDraftMaterial = Readonly<{
  version: typeof PROMOTION_TEMPLATE_BINDING_DRAFT_VERSION;
  workspaceRef: string;
  bindingRef: string;
  template: Readonly<{ templateRef: string; revision: number; materialHash: string }>;
  accountRef: string;
  actor: Readonly<{ type: "page" | "instagram"; actorRef: string }>;
  internalCategoryRefs: readonly string[];
  campaignRef: string | null;
  authority: Authority;
  materialHash: string;
}>;

export class PromotionTemplateDraftError extends Error {
  constructor() { super("PromotionTemplate draft material reddedildi"); this.name = "PromotionTemplateDraftError"; }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
  }
  return value;
}
function fail(): never { throw new PromotionTemplateDraftError(); }

export function createAudiencePresetDraftMaterial(input: Readonly<Omit<AudiencePresetRevisionInput,
  "version" | "state" | "publishedAt">>): AudiencePresetDraftMaterial {
  let canonical: AudiencePresetRevision;
  try { canonical = createAudiencePresetRevision({ ...input, version: AUDIENCE_PRESET_VERSION,
    state: "published", publishedAt: VALIDATION_INSTANT }); } catch { return fail(); }
  const core = { version: AUDIENCE_PRESET_DRAFT_VERSION, workspaceRef: canonical.workspaceRef,
    presetRef: canonical.presetRef, revision: canonical.revision, aliases: canonical.aliases,
    source: canonical.source, targeting: canonical.targeting, authority: AUTHORITY } as const;
  return frozen({ ...core, materialHash: digest(core) });
}

export function createPromotionTemplateDraftMaterial(input: Readonly<Omit<PromotionTemplateRevisionInput,
  "version" | "state" | "publishedAt">>): PromotionTemplateDraftMaterial {
  let canonical: PromotionTemplateRevision;
  try { canonical = createPromotionTemplateRevision({ ...input, version: PROMOTION_TEMPLATE_VERSION,
    state: "published", publishedAt: VALIDATION_INSTANT }); } catch { return fail(); }
  const core = { version: PROMOTION_TEMPLATE_DRAFT_VERSION, workspaceRef: canonical.workspaceRef,
    templateRef: canonical.templateRef, revision: canonical.revision, aliases: canonical.aliases,
    accountRefs: canonical.accountRefs, actorTypes: canonical.actorTypes,
    internalCategoryRefs: canonical.internalCategoryRefs, postTypes: canonical.postTypes,
    objectiveRef: canonical.objectiveRef, optimizationGoalRef: canonical.optimizationGoalRef,
    destinationRef: canonical.destinationRef, placementRefs: canonical.placementRefs,
    namingRuleRef: canonical.namingRuleRef, trackingRuleRef: canonical.trackingRuleRef,
    adSetPolicy: canonical.adSetPolicy, audiencePreset: canonical.audiencePreset,
    budget: canonical.budget, timeframe: canonical.timeframe, authority: AUTHORITY } as const;
  return frozen({ ...core, materialHash: digest(core) });
}

export function createPromotionTemplateBindingDraftMaterial(input: Readonly<{
  workspaceRef: string; bindingRef: string;
  template: Readonly<{ templateRef: string; revision: number; materialHash: string }>;
  accountRef: string; actor: Readonly<{ type: "page" | "instagram"; actorRef: string }>;
  internalCategoryRefs: readonly string[]; campaignRef: string | null;
}>, template: PromotionTemplateDraftMaterial): PromotionTemplateBindingDraftMaterial {
  if (input.template.templateRef !== template.templateRef || input.template.revision !== template.revision
    || input.template.materialHash !== template.materialHash) fail();
  try {
    const published = publishPromotionTemplateDraftMaterial(template, VALIDATION_INSTANT);
    createPromotionTemplateBinding({ version: PROMOTION_TEMPLATE_BINDING_VERSION, workspaceRef: input.workspaceRef,
      bindingRef: input.bindingRef, template: { templateRef: published.templateRef, revision: published.revision,
        templateHash: published.templateHash }, accountRef: input.accountRef, actor: input.actor,
      internalCategoryRefs: input.internalCategoryRefs, campaignRef: input.campaignRef,
      effectiveFrom: VALIDATION_INSTANT, expiresAt: null }, published);
  } catch { return fail(); }
  const core = { version: PROMOTION_TEMPLATE_BINDING_DRAFT_VERSION, workspaceRef: input.workspaceRef,
    bindingRef: input.bindingRef, template: input.template, accountRef: input.accountRef, actor: input.actor,
    internalCategoryRefs: Object.freeze([...input.internalCategoryRefs]), campaignRef: input.campaignRef,
    authority: AUTHORITY } as const;
  return frozen({ ...core, materialHash: digest(core) });
}

export function publishAudiencePresetDraftMaterial(material: AudiencePresetDraftMaterial,
  publishedAt: string): AudiencePresetRevision {
  const { version: _version, authority: _authority, materialHash, ...input } = material;
  const rebuilt = createAudiencePresetDraftMaterial(input);
  if (rebuilt.materialHash !== materialHash) fail();
  return createAudiencePresetRevision({ ...input, version: AUDIENCE_PRESET_VERSION, state: "published", publishedAt });
}

export function publishPromotionTemplateDraftMaterial(material: PromotionTemplateDraftMaterial,
  publishedAt: string): PromotionTemplateRevision {
  const { version: _version, authority: _authority, materialHash, ...input } = material;
  const rebuilt = createPromotionTemplateDraftMaterial(input);
  if (rebuilt.materialHash !== materialHash) fail();
  return createPromotionTemplateRevision({ ...input, version: PROMOTION_TEMPLATE_VERSION, state: "published", publishedAt });
}

export function publishPromotionTemplateBindingDraftMaterial(material: PromotionTemplateBindingDraftMaterial,
  template: PromotionTemplateRevision, effectiveFrom: string): PromotionTemplateBinding {
  const { version: _version, authority: _authority, materialHash, template: templateRef, ...input } = material;
  if (templateRef.templateRef !== template.templateRef || templateRef.revision !== template.revision) fail();
  const { version: _publishedVersion, state: _state, publishedAt: _publishedAt,
    templateHash: _templateHash, ...draftInput } = template;
  const expectedDraft = createPromotionTemplateDraftMaterial(draftInput);
  if (templateRef.materialHash !== expectedDraft.materialHash) fail();
  return createPromotionTemplateBinding({ ...input, version: PROMOTION_TEMPLATE_BINDING_VERSION,
    template: { templateRef: template.templateRef, revision: template.revision, templateHash: template.templateHash },
    effectiveFrom, expiresAt: null }, template);
}
