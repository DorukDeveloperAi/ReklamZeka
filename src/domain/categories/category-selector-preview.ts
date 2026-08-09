import {
  META_OBJECTIVE_MAPPING_VERSION,
  normalizeMetaCampaignObjective,
  type CanonicalMetaObjective,
  type MetaObjectiveMappingResult,
} from "@/domain/meta/objective-mapping";

export const CATEGORY_SELECTOR_PREVIEW_VERSION = "category-selector-preview/1.0.0" as const;

export type CategorySelectorStatus = "matched" | "not_matched" | "uncertain";
export type CategorySelectorObserved<T> =
  | Readonly<{ status: "known"; value: T }>
  | Readonly<{ status: "unknown"; reason: string }>;

export type CategorySelectorDefinition = Readonly<{
  version: typeof CATEGORY_SELECTOR_PREVIEW_VERSION;
  selectorRef: string;
  proposedCategoryRef: string;
  evidence: Readonly<{
    kind: "reviewed_selector_mapping";
    ref: string;
    reviewedAt: string;
    reviewedByRef: string;
  }>;
  confidenceBasisPoints: number;
  accountRefs: readonly string[];
  platforms: readonly string[];
  namePattern: Readonly<{
    operator: "exact" | "prefix" | "suffix" | "contains";
    value: string;
    caseSensitive: boolean;
  }> | null;
  objectives: readonly CanonicalMetaObjective[];
  optimizationGoals: readonly string[];
  geoRefs: readonly string[];
  languages: readonly string[];
  budgetModels: readonly ("campaign" | "ad_set" | "none")[];
  statuses: readonly string[];
  creativeAttributes: readonly Readonly<{ attribute: string; values: readonly string[] }>[];
  entityIds: readonly Readonly<{ level: "campaign" | "ad_set" | "ad" | "creative"; ids: readonly string[] }>[];
}>;

export type CategorySelectorFacts = Readonly<{
  accountRef: CategorySelectorObserved<string>;
  platform: CategorySelectorObserved<string>;
  name: CategorySelectorObserved<string>;
  objective: MetaObjectiveMappingResult;
  optimizationGoal: CategorySelectorObserved<string>;
  geoRefs: CategorySelectorObserved<readonly string[]>;
  languages: CategorySelectorObserved<readonly string[]>;
  budgetModel: CategorySelectorObserved<"campaign" | "ad_set" | "none">;
  status: CategorySelectorObserved<string>;
  creativeAttributes: CategorySelectorObserved<Readonly<Record<string, readonly string[]>>>;
  entityIds: CategorySelectorObserved<readonly Readonly<{ level: "campaign" | "ad_set" | "ad" | "creative"; id: string }>[] >;
}>;

export type CategorySelectorReason = Readonly<{
  criterion: "account" | "platform" | "name_pattern" | "objective" | "optimization" | "geo" | "language" | "budget_model" | "status" | "creative_attribute" | "entity_id";
  criterionRef: string;
  outcome: CategorySelectorStatus;
  code: string;
}>;

export type CategorySelectorPreview = Readonly<{
  version: typeof CATEGORY_SELECTOR_PREVIEW_VERSION;
  selectorRef: string;
  status: CategorySelectorStatus;
  proposedCategoryRef: string;
  evidence: CategorySelectorDefinition["evidence"];
  confidence: number;
  reasonTrace: readonly CategorySelectorReason[];
  authority: Readonly<{
    categoryMutation: false;
    categoryAssignment: false;
    policyMutation: false;
    actionExecution: false;
  }>;
}>;

export class CategorySelectorContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CategorySelectorContractError";
  }
}

const REF = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const STATUS = /^[A-Z][A-Z0-9_]{0,63}$/;
const ATTRIBUTE = /^[a-z][a-z0-9_.-]{0,63}$/;
const OBJECTIVES = new Set<CanonicalMetaObjective>([
  "awareness", "traffic", "engagement", "lead_generation", "app_growth", "sales",
]);
const SELECTOR_KEYS = [
  "version", "selectorRef", "proposedCategoryRef", "evidence", "confidenceBasisPoints",
  "accountRefs", "platforms", "namePattern", "objectives", "optimizationGoals", "geoRefs",
  "languages", "budgetModels", "statuses", "creativeAttributes", "entityIds",
] as const;
const FACT_KEYS = [
  "accountRef", "platform", "name", "objective", "optimizationGoal", "geoRefs", "languages",
  "budgetModel", "status", "creativeAttributes", "entityIds",
] as const;

function exactObject(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CategorySelectorContractError(`${label} nesne olmalıdır`);
  }
  const actual = Object.keys(value as object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new CategorySelectorContractError(`${label} yalnız tanımlı alanları içermelidir`);
  }
}

function boundedText(value: unknown, label: string, pattern: RegExp = TOKEN): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new CategorySelectorContractError(`${label} geçersiz`);
  }
}

function uniqueList<T>(
  value: unknown,
  label: string,
  validate: (entry: unknown, entryLabel: string) => asserts entry is T,
): asserts value is readonly T[] {
  if (!Array.isArray(value) || value.length > 100) throw new CategorySelectorContractError(`${label} geçersiz`);
  value.forEach((entry, index) => validate(entry, `${label}[${index}]`));
  if (new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) {
    throw new CategorySelectorContractError(`${label} tekrar içeremez`);
  }
}

function token(value: unknown, label: string): asserts value is string { boundedText(value, label); }
function statusToken(value: unknown, label: string): asserts value is string { boundedText(value, label, STATUS); }
function objectiveToken(value: unknown, label: string): asserts value is CanonicalMetaObjective {
  if (typeof value !== "string" || !OBJECTIVES.has(value as CanonicalMetaObjective)) {
    throw new CategorySelectorContractError(`${label} canonical objective değil`);
  }
}

function validateObserved<T>(
  observed: unknown,
  label: string,
  validateKnown: (value: unknown, valueLabel: string) => asserts value is T,
): asserts observed is CategorySelectorObserved<T> {
  if (!observed || typeof observed !== "object" || Array.isArray(observed)) {
    throw new CategorySelectorContractError(`${label} observation olmalıdır`);
  }
  const candidate = observed as Record<string, unknown>;
  if (candidate.status === "known") {
    exactObject(candidate, ["status", "value"], label);
    validateKnown(candidate.value, `${label}.value`);
    return;
  }
  if (candidate.status === "unknown") {
    exactObject(candidate, ["status", "reason"], label);
    boundedText(candidate.reason, `${label}.reason`);
    return;
  }
  throw new CategorySelectorContractError(`${label}.status geçersiz`);
}

function validateSelector(selector: CategorySelectorDefinition): void {
  exactObject(selector, SELECTOR_KEYS, "selector");
  if (selector.version !== CATEGORY_SELECTOR_PREVIEW_VERSION) throw new CategorySelectorContractError("selector.version desteklenmiyor");
  boundedText(selector.selectorRef, "selectorRef", REF);
  boundedText(selector.proposedCategoryRef, "proposedCategoryRef", REF);
  exactObject(selector.evidence, ["kind", "ref", "reviewedAt", "reviewedByRef"], "evidence");
  if (selector.evidence.kind !== "reviewed_selector_mapping") throw new CategorySelectorContractError("evidence.kind geçersiz");
  boundedText(selector.evidence.ref, "evidence.ref", REF);
  boundedText(selector.evidence.reviewedByRef, "evidence.reviewedByRef", REF);
  if (!Number.isFinite(Date.parse(selector.evidence.reviewedAt))
    || new Date(selector.evidence.reviewedAt).toISOString() !== selector.evidence.reviewedAt) {
    throw new CategorySelectorContractError("evidence.reviewedAt geçersiz");
  }
  if (!Number.isSafeInteger(selector.confidenceBasisPoints) || selector.confidenceBasisPoints < 0 || selector.confidenceBasisPoints > 10_000) {
    throw new CategorySelectorContractError("confidenceBasisPoints geçersiz");
  }
  uniqueList(selector.accountRefs, "accountRefs", token);
  uniqueList(selector.platforms, "platforms", token);
  uniqueList(selector.objectives, "objectives", objectiveToken);
  uniqueList(selector.optimizationGoals, "optimizationGoals", statusToken);
  uniqueList(selector.geoRefs, "geoRefs", token);
  uniqueList(selector.languages, "languages", token);
  uniqueList(selector.budgetModels, "budgetModels", (value, label): asserts value is "campaign" | "ad_set" | "none" => {
    if (!(["campaign", "ad_set", "none"] as const).includes(value as never)) throw new CategorySelectorContractError(`${label} geçersiz`);
  });
  uniqueList(selector.statuses, "statuses", statusToken);
  if (selector.namePattern !== null) {
    exactObject(selector.namePattern, ["operator", "value", "caseSensitive"], "namePattern");
    if (!(["exact", "prefix", "suffix", "contains"] as const).includes(selector.namePattern.operator)) throw new CategorySelectorContractError("namePattern.operator geçersiz");
    if (typeof selector.namePattern.value !== "string" || selector.namePattern.value.length === 0 || selector.namePattern.value.length > 128) throw new CategorySelectorContractError("namePattern.value geçersiz");
    if (typeof selector.namePattern.caseSensitive !== "boolean") throw new CategorySelectorContractError("namePattern.caseSensitive geçersiz");
  }
  if (!Array.isArray(selector.creativeAttributes) || selector.creativeAttributes.length > 50) throw new CategorySelectorContractError("creativeAttributes geçersiz");
  const attributes = new Set<string>();
  selector.creativeAttributes.forEach((entry, index) => {
    exactObject(entry, ["attribute", "values"], `creativeAttributes[${index}]`);
    boundedText(entry.attribute, `creativeAttributes[${index}].attribute`, ATTRIBUTE);
    if (attributes.has(entry.attribute)) throw new CategorySelectorContractError("creativeAttributes tekrar içeremez");
    attributes.add(entry.attribute);
    uniqueList(entry.values, `creativeAttributes[${index}].values`, token);
    if (entry.values.length === 0) throw new CategorySelectorContractError("creative attribute values boş olamaz");
  });
  if (!Array.isArray(selector.entityIds) || selector.entityIds.length > 20) throw new CategorySelectorContractError("entityIds geçersiz");
  const levels = new Set<string>();
  selector.entityIds.forEach((entry, index) => {
    exactObject(entry, ["level", "ids"], `entityIds[${index}]`);
    if (typeof entry.level !== "string" || !new Set(["campaign", "ad_set", "ad", "creative"]).has(entry.level)) throw new CategorySelectorContractError("entityIds.level geçersiz");
    if (levels.has(entry.level)) throw new CategorySelectorContractError("entityIds level tekrar içeremez");
    levels.add(entry.level);
    uniqueList(entry.ids, `entityIds[${index}].ids`, token);
    if (entry.ids.length === 0) throw new CategorySelectorContractError("entity IDs boş olamaz");
  });
  const activeCount = selector.accountRefs.length + selector.platforms.length + (selector.namePattern ? 1 : 0)
    + selector.objectives.length + selector.optimizationGoals.length + selector.geoRefs.length
    + selector.languages.length + selector.budgetModels.length + selector.statuses.length
    + selector.creativeAttributes.length + selector.entityIds.length;
  if (activeCount === 0) throw new CategorySelectorContractError("selector en az bir kriter içermelidir");
}

function validateFacts(facts: CategorySelectorFacts): void {
  exactObject(facts, FACT_KEYS, "facts");
  validateObserved(facts.accountRef, "accountRef", token);
  validateObserved(facts.platform, "platform", token);
  validateObserved(facts.name, "name", (value, label): asserts value is string => {
    if (typeof value !== "string" || value.length === 0 || value.length > 512) throw new CategorySelectorContractError(`${label} geçersiz`);
  });
  exactObject(facts.objective, ["version", "status", "sourceObjective", "sourceKind", "canonicalObjective", "reason"], "objective");
  if (facts.objective.sourceObjective !== null && typeof facts.objective.sourceObjective !== "string") {
    throw new CategorySelectorContractError("objective mapping geçersiz");
  }
  const reviewedObjective = normalizeMetaCampaignObjective(facts.objective.sourceObjective);
  if (Object.keys(reviewedObjective).some((key) => reviewedObjective[key as keyof MetaObjectiveMappingResult]
    !== facts.objective[key as keyof MetaObjectiveMappingResult])) throw new CategorySelectorContractError("objective mapping geçersiz");
  validateObserved(facts.optimizationGoal, "optimizationGoal", statusToken);
  validateObserved(facts.geoRefs, "geoRefs", (value, label): asserts value is readonly string[] => uniqueList(value, label, token));
  validateObserved(facts.languages, "languages", (value, label): asserts value is readonly string[] => uniqueList(value, label, token));
  validateObserved(facts.budgetModel, "budgetModel", (value, label): asserts value is "campaign" | "ad_set" | "none" => {
    if (!(["campaign", "ad_set", "none"] as const).includes(value as never)) throw new CategorySelectorContractError(`${label} geçersiz`);
  });
  validateObserved(facts.status, "status", statusToken);
  validateObserved(facts.creativeAttributes, "creativeAttributes", (value, label): asserts value is Readonly<Record<string, readonly string[]>> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CategorySelectorContractError(`${label} geçersiz`);
    for (const [attribute, values] of Object.entries(value as Record<string, unknown>)) {
      boundedText(attribute, `${label}.attribute`, ATTRIBUTE);
      uniqueList(values, `${label}.${attribute}`, token);
    }
  });
  validateObserved(facts.entityIds, "entityIds", (value, label): asserts value is readonly Readonly<{ level: "campaign" | "ad_set" | "ad" | "creative"; id: string }>[] => {
    if (!Array.isArray(value) || value.length > 100) throw new CategorySelectorContractError(`${label} geçersiz`);
    value.forEach((entry, index) => {
      exactObject(entry, ["level", "id"], `${label}[${index}]`);
      if (typeof entry.level !== "string" || !new Set(["campaign", "ad_set", "ad", "creative"]).has(entry.level)) throw new CategorySelectorContractError(`${label}[${index}].level geçersiz`);
      token(entry.id, `${label}[${index}].id`);
    });
  });
}

function reason(criterion: CategorySelectorReason["criterion"], criterionRef: string, outcome: CategorySelectorStatus, detail: string): CategorySelectorReason {
  return Object.freeze({ criterion, criterionRef, outcome, code: `${criterion}.${detail}` });
}

function scalarReason<T extends string>(criterion: CategorySelectorReason["criterion"], observed: CategorySelectorObserved<T>, allowed: readonly T[]): CategorySelectorReason {
  if (observed.status === "unknown") return reason(criterion, criterion, "uncertain", `unknown.${observed.reason}`);
  return reason(criterion, criterion, allowed.includes(observed.value) ? "matched" : "not_matched", allowed.includes(observed.value) ? "matched" : "not_matched");
}

function listReason(criterion: "geo" | "language", observed: CategorySelectorObserved<readonly string[]>, allowed: readonly string[]): CategorySelectorReason {
  if (observed.status === "unknown") return reason(criterion, criterion, "uncertain", `unknown.${observed.reason}`);
  const matched = observed.value.some((entry) => allowed.includes(entry));
  return reason(criterion, criterion, matched ? "matched" : "not_matched", matched ? "matched" : "not_matched");
}

/** Pure preview: every active selector is ANDed; values inside one selector are ORed. */
export function previewCategorySelector(selector: CategorySelectorDefinition, facts: CategorySelectorFacts): CategorySelectorPreview {
  validateSelector(selector);
  validateFacts(facts);
  const trace: CategorySelectorReason[] = [];
  if (selector.accountRefs.length > 0) trace.push(scalarReason("account", facts.accountRef, selector.accountRefs));
  if (selector.platforms.length > 0) trace.push(scalarReason("platform", facts.platform, selector.platforms));
  if (selector.namePattern) {
    if (facts.name.status === "unknown") trace.push(reason("name_pattern", "name_pattern", "uncertain", `unknown.${facts.name.reason}`));
    else {
      const actual = selector.namePattern.caseSensitive ? facts.name.value : facts.name.value.toLowerCase();
      const expected = selector.namePattern.caseSensitive ? selector.namePattern.value : selector.namePattern.value.toLowerCase();
      const matched = selector.namePattern.operator === "exact" ? actual === expected
        : selector.namePattern.operator === "prefix" ? actual.startsWith(expected)
          : selector.namePattern.operator === "suffix" ? actual.endsWith(expected) : actual.includes(expected);
      trace.push(reason("name_pattern", "name_pattern", matched ? "matched" : "not_matched", matched ? "matched" : "not_matched"));
    }
  }
  if (selector.objectives.length > 0) {
    if (facts.objective.status === "uncertain") trace.push(reason("objective", "objective", "uncertain", `unknown.${facts.objective.reason}`));
    else {
      const matched = selector.objectives.includes(facts.objective.canonicalObjective!);
      trace.push(reason("objective", "objective", matched ? "matched" : "not_matched", matched ? "matched" : "not_matched"));
    }
  }
  if (selector.optimizationGoals.length > 0) trace.push(scalarReason("optimization", facts.optimizationGoal, selector.optimizationGoals));
  if (selector.geoRefs.length > 0) trace.push(listReason("geo", facts.geoRefs, selector.geoRefs));
  if (selector.languages.length > 0) trace.push(listReason("language", facts.languages, selector.languages));
  if (selector.budgetModels.length > 0) trace.push(scalarReason("budget_model", facts.budgetModel, selector.budgetModels));
  if (selector.statuses.length > 0) trace.push(scalarReason("status", facts.status, selector.statuses));
  for (const constraint of [...selector.creativeAttributes].sort((left, right) => left.attribute.localeCompare(right.attribute))) {
    if (facts.creativeAttributes.status === "unknown") trace.push(reason("creative_attribute", constraint.attribute, "uncertain", `unknown.${facts.creativeAttributes.reason}`));
    else {
      const actual = facts.creativeAttributes.value[constraint.attribute];
      const matched = Array.isArray(actual) && actual.some((entry) => constraint.values.includes(entry));
      trace.push(reason("creative_attribute", constraint.attribute, matched ? "matched" : "not_matched", matched ? "matched" : "not_matched"));
    }
  }
  if (selector.entityIds.length > 0) {
    if (facts.entityIds.status === "unknown") trace.push(reason("entity_id", "entity_id", "uncertain", `unknown.${facts.entityIds.reason}`));
    else {
      const matched = selector.entityIds.some((constraint) => facts.entityIds.status === "known"
        && facts.entityIds.value.some((entry) => entry.level === constraint.level && constraint.ids.includes(entry.id)));
      trace.push(reason("entity_id", "entity_id", matched ? "matched" : "not_matched", matched ? "matched" : "not_matched"));
    }
  }

  const status: CategorySelectorStatus = trace.some((entry) => entry.outcome === "not_matched")
    ? "not_matched" : trace.some((entry) => entry.outcome === "uncertain") ? "uncertain" : "matched";
  return Object.freeze({
    version: CATEGORY_SELECTOR_PREVIEW_VERSION,
    selectorRef: selector.selectorRef,
    status,
    proposedCategoryRef: selector.proposedCategoryRef,
    evidence: Object.freeze({ ...selector.evidence }),
    confidence: selector.confidenceBasisPoints / 10_000,
    reasonTrace: Object.freeze(trace),
    authority: Object.freeze({
      categoryMutation: false,
      categoryAssignment: false,
      policyMutation: false,
      actionExecution: false,
    }),
  });
}

export function buildMetaCampaignSelectorFacts(input: Readonly<{
  externalAccountId: string;
  campaign: Readonly<{
    externalId: string;
    name: string;
    objectiveSource: string | null;
    canonicalObjective: CanonicalMetaObjective | null;
    objectiveMappingVersion: string | null;
    configuredStatus: string | null;
    effectiveStatus: string | null;
    campaignBudgetOptimization: true | null;
  }>;
}>): CategorySelectorFacts {
  const reviewedObjective = normalizeMetaCampaignObjective(input.campaign.objectiveSource);
  const objective: MetaObjectiveMappingResult = input.campaign.objectiveMappingVersion === META_OBJECTIVE_MAPPING_VERSION
    && input.campaign.canonicalObjective === reviewedObjective.canonicalObjective
    ? reviewedObjective : Object.freeze({
      version: META_OBJECTIVE_MAPPING_VERSION,
      status: "uncertain",
      sourceObjective: input.campaign.objectiveSource,
      sourceKind: null,
      canonicalObjective: null,
      reason: input.campaign.objectiveSource === null ? "source_missing" : "source_unknown",
  });
  const unknown = <T>(reasonValue: string): CategorySelectorObserved<T> => Object.freeze({ status: "unknown", reason: reasonValue });
  const known = <T>(value: T): CategorySelectorObserved<T> => Object.freeze({ status: "known", value });
  return Object.freeze({
    accountRef: known(input.externalAccountId),
    platform: known("meta_ads"),
    name: known(input.campaign.name),
    objective,
    optimizationGoal: unknown<string>("campaign_projection_unavailable"),
    geoRefs: unknown<readonly string[]>("campaign_projection_unavailable"),
    languages: unknown<readonly string[]>("campaign_projection_unavailable"),
    budgetModel: input.campaign.campaignBudgetOptimization === true
      ? known<"campaign" | "ad_set" | "none">("campaign") : unknown<"campaign" | "ad_set" | "none">("budget_model_unresolved"),
    status: input.campaign.effectiveStatus !== null || input.campaign.configuredStatus !== null
      ? known(input.campaign.effectiveStatus ?? input.campaign.configuredStatus!)
      : unknown<string>("status_unavailable"),
    creativeAttributes: unknown<Readonly<Record<string, readonly string[]>>>("campaign_projection_unavailable"),
    entityIds: known<readonly Readonly<{ level: "campaign" | "ad_set" | "ad" | "creative"; id: string }>[] >(
      Object.freeze([Object.freeze({ level: "campaign", id: input.campaign.externalId })]),
    ),
  });
}
