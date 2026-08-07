import { createHash } from "node:crypto";

export const AUDIENCE_PRESET_VERSION = "audience-preset/1.0.0" as const;
export const PROMOTION_TEMPLATE_VERSION = "promotion-template/1.0.0" as const;
export const PROMOTION_TEMPLATE_BINDING_VERSION = "promotion-template-binding/1.0.0" as const;

type ActorType = "page" | "instagram";
type PostType = "image" | "video" | "carousel" | "reel";

export type AudiencePresetRevisionInput = Readonly<{
  version: typeof AUDIENCE_PRESET_VERSION;
  workspaceRef: string;
  presetRef: string;
  revision: number;
  aliases: readonly string[];
  state: "published";
  source: Readonly<{
    kind: "meta_saved_audience" | "meta_custom_audience" | "frozen_targeting_spec";
    sourceRef: string;
    targetingHash: string;
    provenanceHash: string;
  }>;
  targeting: Readonly<{
    geoRefs: readonly string[];
    languages: readonly string[];
    ageMin: number | null;
    ageMax: number | null;
    inclusionRefs: readonly string[];
    exclusionRefs: readonly string[];
  }>;
  publishedAt: string;
}>;

export type AudiencePresetRevision = Readonly<AudiencePresetRevisionInput & { presetHash: string }>;

export type PromotionTemplateRevisionInput = Readonly<{
  version: typeof PROMOTION_TEMPLATE_VERSION;
  workspaceRef: string;
  templateRef: string;
  revision: number;
  aliases: readonly string[];
  state: "published";
  accountRefs: readonly string[];
  actorTypes: readonly ActorType[];
  internalCategoryRefs: readonly string[];
  postTypes: readonly PostType[];
  objectiveRef: string;
  optimizationGoalRef: string;
  destinationRef: string;
  placementRefs: readonly string[];
  namingRuleRef: string;
  trackingRuleRef: string;
  adSetPolicy: "existing_only" | "existing_or_new_draft";
  audiencePreset: Readonly<{ presetRef: string; revision: number; presetHash: string }>;
  budget: Readonly<{
    ownerLevel: "campaign" | "adset";
    currency: string;
    kind: "daily" | "lifetime";
    defaultDecimal: string;
    minimumDecimal: string | null;
    maximumDecimal: string | null;
    budgetPlanVersionRef: string;
  }>;
  timeframe: Readonly<{
    timeframeRef: string;
    scheduleMode: "continuous" | "fixed_duration";
    durationDays: number | null;
  }>;
  publishedAt: string;
}>;

export type PromotionTemplateRevision = Readonly<PromotionTemplateRevisionInput & { templateHash: string }>;

export type PromotionTemplateBindingInput = Readonly<{
  version: typeof PROMOTION_TEMPLATE_BINDING_VERSION;
  workspaceRef: string;
  bindingRef: string;
  template: Readonly<{ templateRef: string; revision: number; templateHash: string }>;
  accountRef: string;
  actor: Readonly<{ type: ActorType; actorRef: string }>;
  internalCategoryRefs: readonly string[];
  campaignRef: string | null;
  effectiveFrom: string;
  expiresAt: string | null;
}>;

export type PromotionTemplateBinding = Readonly<PromotionTemplateBindingInput & { bindingHash: string }>;

export class PromotionTemplateError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_revision" | "invalid_binding" | "unsafe_material") {
    super(`Promotion template reddedildi: ${code}`);
    this.name = "PromotionTemplateError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DECIMAL = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const ALIAS = /^[\p{L}\p{N}][\p{L}\p{N} ._+:/()-]{0,79}$/u;
const FORBIDDEN = /(token|secret|prompt|raw[_-]?(payload|request|response|json)|creative.?generation|generate.?creative)/i;

function fail(code: PromotionTemplateError["code"]): never { throw new PromotionTemplateError(code); }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}
function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value) || FORBIDDEN.test(value)) fail("invalid_input");
  return value;
}
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input"); return value; }
function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail("invalid_revision");
  return value as number;
}
function refs(value: unknown, maximum = 100): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) fail("invalid_input");
  const normalized = value.map(ref);
  if (new Set(normalized).size !== normalized.length) fail("invalid_input");
  return freeze([...normalized].sort());
}
function aliases(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20
    || value.some((alias) => typeof alias !== "string" || !ALIAS.test(alias) || FORBIDDEN.test(alias))) fail("unsafe_material");
  const normalized = value.map((alias) => (alias as string).trim());
  if (new Set(normalized.map((alias) => alias.toLocaleLowerCase("tr-TR"))).size !== normalized.length) fail("invalid_input");
  return freeze([...normalized].sort((a, b) => a.localeCompare(b, "tr-TR")));
}
function decimal(value: unknown): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) fail("invalid_input");
  const [integer, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${integer}.${trimmed}` : integer!;
}
function decimalParts(value: string): readonly [bigint, number] {
  const [integer, fraction = ""] = value.split(".");
  return [BigInt(`${integer}${fraction}`), fraction.length];
}
function compareDecimal(left: string, right: string): number {
  const [leftValue, leftScale] = decimalParts(left);
  const [rightValue, rightScale] = decimalParts(right);
  const scale = Math.max(leftScale, rightScale);
  const normalizedLeft = leftValue * 10n ** BigInt(scale - leftScale);
  const normalizedRight = rightValue * 10n ** BigInt(scale - rightScale);
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

export function audiencePresetVersionRef(preset: AudiencePresetRevision): string {
  return `audience_preset_version_${hash(preset.presetHash).slice(0, 24)}`;
}

export function promotionTemplateVersionRef(template: PromotionTemplateRevision): string {
  return `promotion_template_version_${hash(template.templateHash).slice(0, 24)}`;
}

export function createAudiencePresetRevision(input: AudiencePresetRevisionInput): AudiencePresetRevision {
  exact(input, ["version", "workspaceRef", "presetRef", "revision", "aliases", "state", "source", "targeting", "publishedAt"]);
  exact(input.source, ["kind", "sourceRef", "targetingHash", "provenanceHash"]);
  exact(input.targeting, ["geoRefs", "languages", "ageMin", "ageMax", "inclusionRefs", "exclusionRefs"]);
  if (input.version !== AUDIENCE_PRESET_VERSION || input.state !== "published"
    || !["meta_saved_audience", "meta_custom_audience", "frozen_targeting_spec"].includes(input.source.kind)) fail("invalid_input");
  const ageMin = input.targeting.ageMin;
  const ageMax = input.targeting.ageMax;
  if ((ageMin !== null && (!Number.isSafeInteger(ageMin) || ageMin < 13 || ageMin > 65))
    || (ageMax !== null && (!Number.isSafeInteger(ageMax) || ageMax < 13 || ageMax > 65))
    || (ageMin !== null && ageMax !== null && ageMax < ageMin)) fail("invalid_input");
  const inclusions = refs(input.targeting.inclusionRefs);
  const exclusions = refs(input.targeting.exclusionRefs);
  if (inclusions.some((candidate) => exclusions.includes(candidate))) fail("invalid_input");
  const core: AudiencePresetRevisionInput = {
    version: AUDIENCE_PRESET_VERSION, workspaceRef: ref(input.workspaceRef), presetRef: ref(input.presetRef),
    revision: revision(input.revision), aliases: aliases(input.aliases), state: "published",
    source: freeze({ kind: input.source.kind, sourceRef: ref(input.source.sourceRef),
      targetingHash: hash(input.source.targetingHash), provenanceHash: hash(input.source.provenanceHash) }),
    targeting: freeze({ geoRefs: refs(input.targeting.geoRefs), languages: refs(input.targeting.languages), ageMin, ageMax,
      inclusionRefs: inclusions, exclusionRefs: exclusions }),
    publishedAt: instant(input.publishedAt),
  };
  return freeze({ ...core, presetHash: digest(core) });
}

export function createPromotionTemplateRevision(input: PromotionTemplateRevisionInput): PromotionTemplateRevision {
  exact(input, ["version", "workspaceRef", "templateRef", "revision", "aliases", "state", "accountRefs", "actorTypes",
    "internalCategoryRefs", "postTypes", "objectiveRef", "optimizationGoalRef", "destinationRef", "placementRefs",
    "namingRuleRef", "trackingRuleRef", "adSetPolicy", "audiencePreset", "budget", "timeframe", "publishedAt"]);
  exact(input.audiencePreset, ["presetRef", "revision", "presetHash"]);
  exact(input.budget, ["ownerLevel", "currency", "kind", "defaultDecimal", "minimumDecimal", "maximumDecimal", "budgetPlanVersionRef"]);
  exact(input.timeframe, ["timeframeRef", "scheduleMode", "durationDays"]);
  if (input.version !== PROMOTION_TEMPLATE_VERSION || input.state !== "published" || input.accountRefs.length < 1
    || input.actorTypes.length < 1 || input.postTypes.length < 1
    || input.actorTypes.some((type) => !["page", "instagram"].includes(type))
    || input.postTypes.some((type) => !["image", "video", "carousel", "reel"].includes(type))
    || new Set(input.actorTypes).size !== input.actorTypes.length || new Set(input.postTypes).size !== input.postTypes.length
    || !["existing_only", "existing_or_new_draft"].includes(input.adSetPolicy)
    || !["campaign", "adset"].includes(input.budget.ownerLevel) || !["daily", "lifetime"].includes(input.budget.kind)
    || !CURRENCY.test(input.budget.currency) || !["continuous", "fixed_duration"].includes(input.timeframe.scheduleMode)) fail("invalid_input");
  const defaultDecimal = decimal(input.budget.defaultDecimal);
  const minimumDecimal = input.budget.minimumDecimal === null ? null : decimal(input.budget.minimumDecimal);
  const maximumDecimal = input.budget.maximumDecimal === null ? null : decimal(input.budget.maximumDecimal);
  if ((minimumDecimal !== null && compareDecimal(defaultDecimal, minimumDecimal) < 0)
    || (maximumDecimal !== null && compareDecimal(defaultDecimal, maximumDecimal) > 0)
    || (minimumDecimal !== null && maximumDecimal !== null && compareDecimal(minimumDecimal, maximumDecimal) > 0)) {
    fail("invalid_input");
  }
  const durationDays = input.timeframe.durationDays;
  if ((input.timeframe.scheduleMode === "continuous" && durationDays !== null)
    || (input.timeframe.scheduleMode === "fixed_duration"
      && (!Number.isSafeInteger(durationDays) || (durationDays as number) < 1 || (durationDays as number) > 365))) fail("invalid_input");
  const core: PromotionTemplateRevisionInput = {
    version: PROMOTION_TEMPLATE_VERSION, workspaceRef: ref(input.workspaceRef), templateRef: ref(input.templateRef),
    revision: revision(input.revision), aliases: aliases(input.aliases), state: "published",
    accountRefs: refs(input.accountRefs), actorTypes: freeze([...input.actorTypes].sort()),
    internalCategoryRefs: refs(input.internalCategoryRefs), postTypes: freeze([...input.postTypes].sort()),
    objectiveRef: ref(input.objectiveRef), optimizationGoalRef: ref(input.optimizationGoalRef), destinationRef: ref(input.destinationRef),
    placementRefs: refs(input.placementRefs), namingRuleRef: ref(input.namingRuleRef), trackingRuleRef: ref(input.trackingRuleRef),
    adSetPolicy: input.adSetPolicy,
    audiencePreset: freeze({ presetRef: ref(input.audiencePreset.presetRef), revision: revision(input.audiencePreset.revision),
      presetHash: hash(input.audiencePreset.presetHash) }),
    budget: freeze({ ownerLevel: input.budget.ownerLevel, currency: input.budget.currency, kind: input.budget.kind,
      defaultDecimal, minimumDecimal, maximumDecimal, budgetPlanVersionRef: ref(input.budget.budgetPlanVersionRef) }),
    timeframe: freeze({ timeframeRef: ref(input.timeframe.timeframeRef), scheduleMode: input.timeframe.scheduleMode, durationDays }),
    publishedAt: instant(input.publishedAt),
  };
  return freeze({ ...core, templateHash: digest(core) });
}

export function createPromotionTemplateBinding(
  input: PromotionTemplateBindingInput,
  template: PromotionTemplateRevision,
): PromotionTemplateBinding {
  exact(input, ["version", "workspaceRef", "bindingRef", "template", "accountRef", "actor", "internalCategoryRefs",
    "campaignRef", "effectiveFrom", "expiresAt"]);
  exact(input.template, ["templateRef", "revision", "templateHash"]);
  exact(input.actor, ["type", "actorRef"]);
  if (input.version !== PROMOTION_TEMPLATE_BINDING_VERSION || input.workspaceRef !== template.workspaceRef
    || input.template.templateRef !== template.templateRef || input.template.revision !== template.revision
    || input.template.templateHash !== template.templateHash || !template.accountRefs.includes(input.accountRef)
    || !template.actorTypes.includes(input.actor.type) || !["page", "instagram"].includes(input.actor.type)) fail("invalid_binding");
  const categoryRefs = refs(input.internalCategoryRefs);
  if (template.internalCategoryRefs.length > 0 && categoryRefs.some((category) => !template.internalCategoryRefs.includes(category))) {
    fail("invalid_binding");
  }
  const effectiveFrom = instant(input.effectiveFrom);
  const expiresAt = input.expiresAt === null ? null : instant(input.expiresAt);
  if (expiresAt !== null && expiresAt <= effectiveFrom) fail("invalid_binding");
  const core: PromotionTemplateBindingInput = {
    version: PROMOTION_TEMPLATE_BINDING_VERSION, workspaceRef: ref(input.workspaceRef), bindingRef: ref(input.bindingRef),
    template: freeze({ templateRef: ref(input.template.templateRef), revision: revision(input.template.revision),
      templateHash: hash(input.template.templateHash) }), accountRef: ref(input.accountRef),
    actor: freeze({ type: input.actor.type, actorRef: ref(input.actor.actorRef) }), internalCategoryRefs: categoryRefs,
    campaignRef: input.campaignRef === null ? null : ref(input.campaignRef), effectiveFrom, expiresAt,
  };
  return freeze({ ...core, bindingHash: digest(core) });
}

export function assertPromotionRegistryLink(
  preset: AudiencePresetRevision,
  template: PromotionTemplateRevision,
  binding: PromotionTemplateBinding,
  evaluatedAt: string,
): void {
  const { presetHash: _presetHash, ...presetInput } = preset;
  const { templateHash: _templateHash, ...templateInput } = template;
  const { bindingHash: _bindingHash, ...bindingInput } = binding;
  const rebuiltPreset = createAudiencePresetRevision(presetInput);
  const rebuiltTemplate = createPromotionTemplateRevision(templateInput);
  const rebuiltBinding = createPromotionTemplateBinding(bindingInput, rebuiltTemplate);
  const at = instant(evaluatedAt);
  if (rebuiltPreset.presetHash !== preset.presetHash || rebuiltTemplate.templateHash !== template.templateHash
    || rebuiltBinding.bindingHash !== binding.bindingHash || preset.workspaceRef !== template.workspaceRef
    || template.workspaceRef !== binding.workspaceRef
    || template.audiencePreset.presetRef !== preset.presetRef || template.audiencePreset.revision !== preset.revision
    || template.audiencePreset.presetHash !== preset.presetHash || at < binding.effectiveFrom
    || (binding.expiresAt !== null && at >= binding.expiresAt)) fail("invalid_binding");
}
