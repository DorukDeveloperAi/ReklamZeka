import { createHash } from "node:crypto";

import {
  assertPromotionRegistryLink,
  audiencePresetVersionRef,
  createAudiencePresetRevision,
  createPromotionTemplateBinding,
  createPromotionTemplateRevision,
  promotionTemplateVersionRef,
  type AudiencePresetRevision,
  type PromotionTemplateBinding,
  type PromotionTemplateRevision,
} from "@/domain/meta/promotion/promotion-template";

export const PROMOTION_TEMPLATE_SELECTOR_VERSION = "promotion-template-selector/1.0.0" as const;

type ActorType = "page" | "instagram";
type PostType = "image" | "video" | "carousel" | "reel";

export type PromotionTemplateSelectorCandidate = Readonly<{
  preset: AudiencePresetRevision;
  template: PromotionTemplateRevision;
  binding: PromotionTemplateBinding;
}>;

export type PromotionTemplateSelectorInput = Readonly<{
  version: typeof PROMOTION_TEMPLATE_SELECTOR_VERSION;
  workspaceRef: string;
  evaluatedAt: string;
  accountRef: string | null;
  actor: Readonly<{ type: ActorType; actorRef: string }> | null;
  internalCategoryRefs: readonly string[] | null;
  postType: PostType | null;
  instruction: string | null;
}>;

export type PromotionTemplateSelectionQuestion = Readonly<{
  code:
    | "account_required"
    | "actor_required"
    | "category_required"
    | "post_type_required"
    | "instruction_required"
    | "scope_not_covered"
    | "alias_not_recognized"
    | "selector_ambiguous"
    | "unsupported_targeting_change"
    | "unsupported_creative_change";
  field: "account" | "actor" | "internal_category" | "post_type" | "instruction" | "published_template";
  prompt: string;
}>;

export type PromotionTemplateSelectionReason = Readonly<{
  code:
    | "published_registry_integrity_verified"
    | "required_selector_fact_missing"
    | "unsupported_instruction"
    | "no_published_scope_match"
    | "no_published_alias_match"
    | "unique_deterministic_match"
    | "equal_ranked_match";
  outcome: "verified" | "blocked";
  candidateCount: number;
}>;

export type PromotionTemplateSelectionDryRun = Readonly<{
  version: typeof PROMOTION_TEMPLATE_SELECTOR_VERSION;
  status: "recommended" | "ambiguous" | "unresolved";
  dryRunOnly: true;
  publishReady: boolean;
  recommendation: Readonly<{
    promotionTemplate: Readonly<{
      templateRef: string;
      revision: number;
      versionRef: string;
    }>;
    audiencePreset: Readonly<{
      presetRef: string;
      revision: number;
      versionRef: string;
    }>;
  }> | null;
  reasons: readonly PromotionTemplateSelectionReason[];
  questions: readonly PromotionTemplateSelectionQuestion[];
  capabilities: Readonly<{
    canPublish: false;
    canPersist: false;
    canWriteMeta: false;
    canChangeTargeting: false;
    canGenerateCreative: false;
    canProposeAction: false;
    canGrantApproval: false;
  }>;
  selectionHash: string;
}>;

export class PromotionTemplateSelectorError extends Error {
  constructor(readonly code: "invalid_input" | "catalog_integrity_rejected" | "catalog_conflict") {
    super(`PromotionTemplate selector reddedildi: ${code}`);
    this.name = "PromotionTemplateSelectorError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const INSTRUCTION = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]{1,500}$/u;
const TARGETING_CHANGE = /(?:hedeflem|targeting|kitle).{0,40}(?:değiştir|ekle|çıkar|oluştur|yarat)|(?:değiştir|ekle|çıkar|oluştur|yarat).{0,40}(?:hedeflem|targeting|kitle)/iu;
const CREATIVE_CHANGE = /(?:creative|görsel|video|metin|içerik).{0,40}(?:üret|oluştur|yarat|değiştir)|(?:üret|oluştur|yarat|değiştir).{0,40}(?:creative|görsel|video|metin|içerik)/iu;

function fail(code: PromotionTemplateSelectorError["code"]): never {
  throw new PromotionTemplateSelectorError(code);
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}

function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) fail("invalid_input");
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail("invalid_input");
  }
  return value;
}

function categoryRefs(value: unknown): readonly string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) fail("invalid_input");
  const normalized = value.map(ref);
  if (new Set(normalized).size !== normalized.length) fail("invalid_input");
  return Object.freeze([...normalized].sort());
}

type NormalizedSelectorInput = Readonly<{
  workspaceRef: string;
  evaluatedAt: string;
  accountRef: string | null;
  categories: readonly string[] | null;
}>;

function normalizeSelectorInput(input: PromotionTemplateSelectorInput): NormalizedSelectorInput {
  exact(input, ["version", "workspaceRef", "evaluatedAt", "accountRef", "actor", "internalCategoryRefs", "postType", "instruction"]);
  if (input.version !== PROMOTION_TEMPLATE_SELECTOR_VERSION) fail("invalid_input");
  const workspaceRef = ref(input.workspaceRef);
  const evaluatedAt = instant(input.evaluatedAt);
  const accountRef = input.accountRef === null ? null : ref(input.accountRef);
  if (input.actor !== null) {
    exact(input.actor, ["type", "actorRef"]);
    if (!["page", "instagram"].includes(input.actor.type)) fail("invalid_input");
    ref(input.actor.actorRef);
  }
  if (input.postType !== null && !["image", "video", "carousel", "reel"].includes(input.postType)) fail("invalid_input");
  const categories = categoryRefs(input.internalCategoryRefs);
  if (input.instruction !== null && (typeof input.instruction !== "string" || !INSTRUCTION.test(input.instruction)
    || input.instruction.trim() !== input.instruction)) fail("invalid_input");
  return Object.freeze({ workspaceRef, evaluatedAt, accountRef, categories });
}

export function assertPromotionTemplateSelectorInput(input: PromotionTemplateSelectorInput): void {
  normalizeSelectorInput(input);
}

function normalizeAlias(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function aliasScore(instruction: string, aliases: readonly string[], exactScore: number, containsScore: number): number {
  const paddedInstruction = ` ${instruction} `;
  return aliases.reduce((score, alias) => {
    const normalized = normalizeAlias(alias);
    const candidate = instruction === normalized ? exactScore
      : normalized.length > 0 && paddedInstruction.includes(` ${normalized} `) ? containsScore : 0;
    return Math.max(score, candidate);
  }, 0);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function canonicalCandidate(candidate: PromotionTemplateSelectorCandidate, evaluatedAt: string): PromotionTemplateSelectorCandidate {
  try {
    exact(candidate, ["preset", "template", "binding"]);
    const { presetHash, ...presetInput } = candidate.preset;
    const preset = createAudiencePresetRevision(presetInput);
    const { templateHash, ...templateInput } = candidate.template;
    const template = createPromotionTemplateRevision(templateInput);
    const { bindingHash, ...bindingInput } = candidate.binding;
    const binding = createPromotionTemplateBinding(bindingInput, template);
    if (preset.presetHash !== presetHash || template.templateHash !== templateHash || binding.bindingHash !== bindingHash) {
      throw new Error("hash_mismatch");
    }
    assertPromotionRegistryLink(preset, template, binding, evaluatedAt);
    if (preset.publishedAt > evaluatedAt || template.publishedAt > evaluatedAt) throw new Error("not_yet_published");
    return deepFreeze({ preset, template, binding });
  } catch {
    fail("catalog_integrity_rejected");
  }
}

const CAPABILITIES = deepFreeze({
  canPublish: false as const,
  canPersist: false as const,
  canWriteMeta: false as const,
  canChangeTargeting: false as const,
  canGenerateCreative: false as const,
  canProposeAction: false as const,
  canGrantApproval: false as const,
});

function question(
  code: PromotionTemplateSelectionQuestion["code"],
  field: PromotionTemplateSelectionQuestion["field"],
  prompt: string,
): PromotionTemplateSelectionQuestion {
  return Object.freeze({ code, field, prompt });
}

function reason(
  code: PromotionTemplateSelectionReason["code"],
  outcome: PromotionTemplateSelectionReason["outcome"],
  candidateCount: number,
): PromotionTemplateSelectionReason {
  return Object.freeze({ code, outcome, candidateCount });
}

function result(core: Omit<PromotionTemplateSelectionDryRun, "version" | "dryRunOnly" | "capabilities" | "selectionHash">): PromotionTemplateSelectionDryRun {
  const value = {
    version: PROMOTION_TEMPLATE_SELECTOR_VERSION,
    dryRunOnly: true as const,
    ...core,
    capabilities: CAPABILITIES,
  };
  return deepFreeze({ ...value, selectionHash: digest(value) });
}

/**
 * Pure, read-only resolution over already-published immutable registry documents.
 * It never returns targeting material and carries no publish, action or Meta authority.
 */
export function dryRunPromotionTemplateSelection(
  input: PromotionTemplateSelectorInput,
  catalog: readonly PromotionTemplateSelectorCandidate[],
): PromotionTemplateSelectionDryRun {
  const { workspaceRef, evaluatedAt, accountRef, categories } = normalizeSelectorInput(input);
  if (!Array.isArray(catalog) || catalog.length > 100) fail("invalid_input");

  const candidates = catalog.map((candidate) => canonicalCandidate(candidate, evaluatedAt));
  const bindingRefs = new Set<string>();
  const immutableVersionKeys = new Map<string, string>();
  for (const candidate of candidates) {
    if (bindingRefs.has(candidate.binding.bindingRef)) fail("catalog_conflict");
    bindingRefs.add(candidate.binding.bindingRef);
    const templateKey = `template:${candidate.template.templateRef}:${candidate.template.revision}`;
    const priorTemplateHash = immutableVersionKeys.get(templateKey);
    if (priorTemplateHash && priorTemplateHash !== candidate.template.templateHash) fail("catalog_conflict");
    immutableVersionKeys.set(templateKey, candidate.template.templateHash);
    const presetKey = `preset:${candidate.preset.presetRef}:${candidate.preset.revision}`;
    const priorPresetHash = immutableVersionKeys.get(presetKey);
    if (priorPresetHash && priorPresetHash !== candidate.preset.presetHash) fail("catalog_conflict");
    immutableVersionKeys.set(presetKey, candidate.preset.presetHash);
  }

  const reasons: PromotionTemplateSelectionReason[] = [
    reason("published_registry_integrity_verified", "verified", candidates.length),
  ];
  const questions: PromotionTemplateSelectionQuestion[] = [];
  if (accountRef === null) questions.push(question("account_required", "account", "Hangi reklam hesabı kullanılmalı?"));
  if (input.actor === null) questions.push(question("actor_required", "actor", "Hangi Page veya Instagram hesabı kullanılmalı?"));
  if (categories === null) questions.push(question("category_required", "internal_category", "Hangi iç kategori kullanılmalı?"));
  if (input.postType === null) questions.push(question("post_type_required", "post_type", "Gönderinin medya tipi nedir?"));
  if (input.instruction === null) questions.push(question("instruction_required", "instruction", "Hangi yayınlanmış şablon alias'ı veya talimatı kullanılmalı?"));
  if (questions.length > 0) {
    reasons.push(reason("required_selector_fact_missing", "blocked", candidates.length));
    return result({ status: "unresolved", publishReady: false, recommendation: null,
      reasons: Object.freeze(reasons), questions: Object.freeze(questions) });
  }

  if (TARGETING_CHANGE.test(input.instruction!) || CREATIVE_CHANGE.test(input.instruction!)) {
    const targeting = TARGETING_CHANGE.test(input.instruction!);
    reasons.push(reason("unsupported_instruction", "blocked", candidates.length));
    questions.push(targeting
      ? question("unsupported_targeting_change", "instruction", "Targeting değişikliği bu selector kapsamı dışındadır; yayınlanmış preset alias'ı seçin.")
      : question("unsupported_creative_change", "instruction", "Creative üretimi veya değişikliği desteklenmez; mevcut gönderi için şablon alias'ı seçin."));
    return result({ status: "unresolved", publishReady: false, recommendation: null,
      reasons: Object.freeze(reasons), questions: Object.freeze(questions) });
  }

  const scoped = candidates.filter(({ template, binding }) => template.workspaceRef === workspaceRef
    && binding.workspaceRef === workspaceRef
    && template.accountRefs.includes(accountRef!)
    && binding.accountRef === accountRef
    && template.actorTypes.includes(input.actor!.type)
    && binding.actor.type === input.actor!.type
    && binding.actor.actorRef === input.actor!.actorRef
    && template.postTypes.includes(input.postType!)
    && categories!.every((categoryRef) => template.internalCategoryRefs.includes(categoryRef)
      && binding.internalCategoryRefs.includes(categoryRef)));
  if (scoped.length === 0) {
    reasons.push(reason("no_published_scope_match", "blocked", 0));
    questions.push(question("scope_not_covered", "published_template",
      "Bu hesap, actor, iç kategori ve medya tipi için yayınlanmış bir şablon seçin veya authoring incelemesi başlatın."));
    return result({ status: "unresolved", publishReady: false, recommendation: null,
      reasons: Object.freeze(reasons), questions: Object.freeze(questions) });
  }

  const normalizedInstruction = normalizeAlias(input.instruction!);
  const ranked = new Map<string, Readonly<{ candidate: PromotionTemplateSelectorCandidate; score: number }>>();
  for (const candidate of scoped) {
    const score = aliasScore(normalizedInstruction, candidate.template.aliases, 400, 300)
      + aliasScore(normalizedInstruction, candidate.preset.aliases, 200, 100);
    if (score === 0) continue;
    const key = `${candidate.template.templateHash}:${candidate.preset.presetHash}`;
    const previous = ranked.get(key);
    if (!previous || score > previous.score) ranked.set(key, Object.freeze({ candidate, score }));
  }
  const ordered = [...ranked.values()].sort((left, right) => right.score - left.score
    || promotionTemplateVersionRef(left.candidate.template).localeCompare(promotionTemplateVersionRef(right.candidate.template))
    || audiencePresetVersionRef(left.candidate.preset).localeCompare(audiencePresetVersionRef(right.candidate.preset)));
  if (ordered.length === 0) {
    reasons.push(reason("no_published_alias_match", "blocked", 0));
    questions.push(question("alias_not_recognized", "instruction", "Yayınlanmış PromotionTemplate veya AudiencePreset alias'ını netleştirin."));
    return result({ status: "unresolved", publishReady: false, recommendation: null,
      reasons: Object.freeze(reasons), questions: Object.freeze(questions) });
  }
  const best = ordered[0]!;
  const tied = ordered.filter((entry) => entry.score === best.score);
  if (tied.length !== 1) {
    reasons.push(reason("equal_ranked_match", "blocked", tied.length));
    questions.push(question("selector_ambiguous", "instruction", "Birden fazla yayınlanmış şablon eşit eşleşti; şablon alias'ını netleştirin."));
    return result({ status: "ambiguous", publishReady: false, recommendation: null,
      reasons: Object.freeze(reasons), questions: Object.freeze(questions) });
  }

  reasons.push(reason("unique_deterministic_match", "verified", 1));
  const { template, preset } = best.candidate;
  return result({
    status: "recommended",
    publishReady: true,
    recommendation: deepFreeze({
      promotionTemplate: { templateRef: template.templateRef, revision: template.revision,
        versionRef: promotionTemplateVersionRef(template) },
      audiencePreset: { presetRef: preset.presetRef, revision: preset.revision,
        versionRef: audiencePresetVersionRef(preset) },
    }),
    reasons: Object.freeze(reasons),
    questions: Object.freeze([]),
  });
}
