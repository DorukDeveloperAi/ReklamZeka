import { createHash } from "node:crypto";

import {
  OBJECTIVE_PLAYBOOKS,
  OBJECTIVE_PLAYBOOK_VERSION,
} from "@/analyses/objective-playbooks";
import { CAMPAIGN_OBJECTIVES, type CampaignObjective } from "@/analyses/schema";
import {
  CATEGORY_PROFILE_VERSION,
  type CategoryProfileBindings,
} from "@/domain/categories/category-profile";
import {
  categoryDefinitionPublicRef,
  categoryDimensionPublicRef,
} from "@/domain/categories/public-reference";

export const STARTER_CATEGORY_PLAYBOOK_CATALOG_VERSION =
  "starter-category-playbooks/1.1.0" as const;

const CAMPAIGN_LEVEL = Object.freeze(["campaign"] as const);
const CAMPAIGN_AD_SET_LEVELS = Object.freeze(["campaign", "ad_set"] as const);
const DELIVERY_LEVELS = Object.freeze(["campaign", "ad_set", "ad"] as const);
const ALL_CATEGORY_LEVELS = Object.freeze(["campaign", "ad_set", "ad", "creative"] as const);
const NO_AUTHORITY = Object.freeze({
  canPersist: false as const,
  canPublish: false as const,
  canAuthorizeAction: false as const,
  canExecuteWrite: false as const,
  canWriteMeta: false as const,
  canGrantApproval: false as const,
  canCreatePolicy: false as const,
  canCallTool: false as const,
  canAccessNetwork: false as const,
  canQuerySql: false as const,
});

export type StarterCategoryDimensionKey =
  | "audience_strategy"
  | "brand_clinic"
  | "budget_pool"
  | "campaign_role"
  | "custom"
  | "experiment"
  | "geo_market"
  | "language"
  | "destination"
  | "funnel_intent"
  | "lifecycle"
  | "operating_mode"
  | "service_line"
  | "protection_class";

export type StarterObjectivePlaybookRef = Readonly<{
  objective: CampaignObjective;
  playbookRef: string;
  playbookVersion: typeof OBJECTIVE_PLAYBOOK_VERSION;
  playbookHash: string;
}>;

export type StarterCategoryDimensionTemplate = Readonly<{
  dimensionRef: string;
  dimensionKey: StarterCategoryDimensionKey;
  label: string;
  suggestedCardinality: "single" | "multi";
  suggestedEntityLevels: readonly (typeof ALL_CATEGORY_LEVELS)[number][];
}>;

export type StarterCategoryTemplate = Readonly<{
  templateRef: string;
  dimensionKey: StarterCategoryDimensionKey;
  categoryKey: string | null;
  categoryRef: string | null;
  label: string;
  description: string;
  color: string;
  kind: "concrete_example" | "owner_defined_value";
  ownerConfigurationFields: readonly (
    | "category_key"
    | "label"
    | "description"
    | "budget_policy_refs"
    | "transfer_policy_refs"
    | "approval_policy_refs"
  )[];
}>;

export type StarterCategoryProfileProposal = Readonly<{
  schemaVersion: typeof STARTER_CATEGORY_PLAYBOOK_CATALOG_VERSION;
  catalogHash: string;
  status: "review_required";
  objectivePlaybook: StarterObjectivePlaybookRef;
  categoryTemplate: StarterCategoryTemplate;
  profileTemplate: Readonly<{
    schemaVersion: typeof CATEGORY_PROFILE_VERSION;
    categoryRef: string;
    parentCategoryRef: null;
    label: string;
    description: string;
    color: string;
    status: "draft";
    bindings: CategoryProfileBindings;
  }>;
  ownerConfirmationRequired: true;
  persistenceAdapterRequired: true;
  authority: typeof NO_AUTHORITY;
  proposalHash: string;
}>;

export type StarterCategoryProfileResolution =
  | StarterCategoryProfileProposal
  | Readonly<{
    schemaVersion: typeof STARTER_CATEGORY_PLAYBOOK_CATALOG_VERSION;
    catalogHash: string;
    status: "blocked";
    reasonCode: "unknown_objective" | "unknown_category" | "owner_configuration_required";
    ownerConfirmationRequired: true;
    authority: typeof NO_AUTHORITY;
  }>;

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodepoints(left, right))
      .map(([key, child]) => [key, stable(child)]));
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

function objectivePlaybookRef(objective: CampaignObjective): StarterObjectivePlaybookRef {
  const playbookHash = digest(OBJECTIVE_PLAYBOOKS[objective]);
  return Object.freeze({
    objective,
    playbookRef: `analysis_playbook_objective_${objective}_${playbookHash.slice(0, 16)}`,
    playbookVersion: OBJECTIVE_PLAYBOOK_VERSION,
    playbookHash,
  });
}

const OBJECTIVE_REFS = Object.freeze(CAMPAIGN_OBJECTIVES.map(objectivePlaybookRef));

const DIMENSIONS: readonly StarterCategoryDimensionTemplate[] = deepFreeze([
  { dimensionRef: categoryDimensionPublicRef("service_line"), dimensionKey: "service_line",
    label: "Hizmet hattı", suggestedCardinality: "multi", suggestedEntityLevels: CAMPAIGN_LEVEL },
  { dimensionRef: categoryDimensionPublicRef("brand_clinic"), dimensionKey: "brand_clinic",
    label: "Marka / klinik", suggestedCardinality: "multi", suggestedEntityLevels: CAMPAIGN_LEVEL },
  { dimensionRef: categoryDimensionPublicRef("geo_market"), dimensionKey: "geo_market",
    label: "Bölge pazarı", suggestedCardinality: "multi", suggestedEntityLevels: CAMPAIGN_LEVEL },
  { dimensionRef: categoryDimensionPublicRef("language"), dimensionKey: "language",
    label: "Dil", suggestedCardinality: "multi", suggestedEntityLevels: CAMPAIGN_LEVEL },
  { dimensionRef: categoryDimensionPublicRef("campaign_role"), dimensionKey: "campaign_role",
    label: "Kampanya rolü", suggestedCardinality: "single", suggestedEntityLevels: CAMPAIGN_LEVEL },
  { dimensionRef: categoryDimensionPublicRef("funnel_intent"), dimensionKey: "funnel_intent",
    label: "Huni niyeti", suggestedCardinality: "single", suggestedEntityLevels: CAMPAIGN_LEVEL },
  { dimensionRef: categoryDimensionPublicRef("audience_strategy"), dimensionKey: "audience_strategy",
    label: "Kitle stratejisi", suggestedCardinality: "single", suggestedEntityLevels: CAMPAIGN_AD_SET_LEVELS },
  { dimensionRef: categoryDimensionPublicRef("destination"), dimensionKey: "destination",
    label: "Hedef deneyim", suggestedCardinality: "single", suggestedEntityLevels: DELIVERY_LEVELS },
  { dimensionRef: categoryDimensionPublicRef("budget_pool"), dimensionKey: "budget_pool",
    label: "Bütçe havuzu", suggestedCardinality: "single", suggestedEntityLevels: CAMPAIGN_LEVEL },
  { dimensionRef: categoryDimensionPublicRef("operating_mode"), dimensionKey: "operating_mode",
    label: "Çalışma modu", suggestedCardinality: "single", suggestedEntityLevels: CAMPAIGN_LEVEL },
  { dimensionRef: categoryDimensionPublicRef("lifecycle"), dimensionKey: "lifecycle",
    label: "Yaşam döngüsü", suggestedCardinality: "single", suggestedEntityLevels: CAMPAIGN_LEVEL },
  { dimensionRef: categoryDimensionPublicRef("experiment"), dimensionKey: "experiment",
    label: "Deney", suggestedCardinality: "multi", suggestedEntityLevels: CAMPAIGN_AD_SET_LEVELS },
  { dimensionRef: categoryDimensionPublicRef("protection_class"), dimensionKey: "protection_class",
    label: "Koruma sınıfı", suggestedCardinality: "multi", suggestedEntityLevels: CAMPAIGN_LEVEL },
  { dimensionRef: categoryDimensionPublicRef("custom"), dimensionKey: "custom",
    label: "Özel boyut", suggestedCardinality: "multi", suggestedEntityLevels: ALL_CATEGORY_LEVELS },
]);

function categoryTemplate(input: Readonly<{
  dimensionKey: StarterCategoryDimensionKey;
  categoryKey: string;
  label: string;
  description: string;
  color: string;
  ownerConfigurationFields?: StarterCategoryTemplate["ownerConfigurationFields"];
}>): StarterCategoryTemplate {
  return Object.freeze({
    templateRef: `starter_category_template_${input.dimensionKey}_${input.categoryKey}`,
    dimensionKey: input.dimensionKey,
    categoryKey: input.categoryKey,
    categoryRef: categoryDefinitionPublicRef(input.dimensionKey, input.categoryKey),
    label: input.label,
    description: input.description,
    color: input.color,
    kind: "concrete_example" as const,
    ownerConfigurationFields: Object.freeze([...(input.ownerConfigurationFields ?? [])]),
  });
}

function ownerDefinedTemplate(input: Readonly<{
  dimensionKey: StarterCategoryDimensionKey;
  label: string;
  description: string;
  color: string;
  ownerConfigurationFields?: StarterCategoryTemplate["ownerConfigurationFields"];
}>): StarterCategoryTemplate {
  return Object.freeze({
    templateRef: `starter_category_template_${input.dimensionKey}_owner_defined`,
    dimensionKey: input.dimensionKey,
    categoryKey: null,
    categoryRef: null,
    label: input.label,
    description: input.description,
    color: input.color,
    kind: "owner_defined_value" as const,
    ownerConfigurationFields: Object.freeze(["category_key", "label", "description",
      ...(input.ownerConfigurationFields ?? [])] as const),
  });
}

const CATEGORIES: readonly StarterCategoryTemplate[] = deepFreeze([
  categoryTemplate({ dimensionKey: "audience_strategy", categoryKey: "prospecting", label: "Yeni kitle",
    description: "Kullanıcının yeni kitle çalışması olarak değerlendirebileceği örnek iç kategori.", color: "#2563EB" }),
  categoryTemplate({ dimensionKey: "audience_strategy", categoryKey: "retargeting", label: "Yeniden erişim",
    description: "Kullanıcının yeniden erişim çalışması olarak değerlendirebileceği örnek iç kategori.", color: "#7C3AED" }),
  categoryTemplate({ dimensionKey: "campaign_role", categoryKey: "promotion", label: "Promosyon",
    description: "Kullanıcının süreli promosyon çalışması olarak değerlendirebileceği örnek iç kategori.", color: "#EA580C" }),
  categoryTemplate({ dimensionKey: "campaign_role", categoryKey: "evergreen", label: "Sürekli",
    description: "Kullanıcının sürekli çalışma olarak değerlendirebileceği örnek iç kategori.", color: "#0F766E" }),
  ownerDefinedTemplate({ dimensionKey: "service_line", label: "Hizmet hattını tanımla",
    description: "Hizmet hattı değeri workspace sahibi tarafından tanımlanmalıdır.", color: "#0E7490" }),
  ownerDefinedTemplate({ dimensionKey: "brand_clinic", label: "Marka veya kliniği tanımla",
    description: "Marka/klinik değeri workspace sahibi tarafından tanımlanmalıdır.", color: "#4338CA" }),
  ownerDefinedTemplate({ dimensionKey: "geo_market", label: "Bölgeyi tanımla",
    description: "Bölge değeri ve anlamı workspace sahibi tarafından tanımlanmalıdır.", color: "#0369A1" }),
  ownerDefinedTemplate({ dimensionKey: "language", label: "Dili tanımla",
    description: "Dil değeri ve anlamı workspace sahibi tarafından tanımlanmalıdır.", color: "#4F46E5" }),
  ownerDefinedTemplate({ dimensionKey: "budget_pool", label: "Bütçe havuzunu tanımla",
    description: "Bütçe havuzu ve bağlı kurallar workspace sahibi tarafından tanımlanmalıdır.", color: "#B91C1C",
    ownerConfigurationFields: ["budget_policy_refs", "transfer_policy_refs", "approval_policy_refs"] }),
  ownerDefinedTemplate({ dimensionKey: "operating_mode", label: "Çalışma modunu tanımla",
    description: "Çalışma modu workspace sahibi tarafından tanımlanmalıdır.", color: "#475569" }),
  ownerDefinedTemplate({ dimensionKey: "lifecycle", label: "Yaşam döngüsünü tanımla",
    description: "Yaşam döngüsü değeri workspace sahibi tarafından tanımlanmalıdır.", color: "#0F766E" }),
  ownerDefinedTemplate({ dimensionKey: "experiment", label: "Deney değerini tanımla",
    description: "Deney kimliği ve anlamı workspace sahibi tarafından tanımlanmalıdır.", color: "#7E22CE" }),
  ownerDefinedTemplate({ dimensionKey: "custom", label: "Özel değeri tanımla",
    description: "Özel kategori değeri workspace sahibi tarafından tanımlanmalıdır.", color: "#334155" }),
  categoryTemplate({ dimensionKey: "destination", categoryKey: "lead_form", label: "Lead form",
    description: "Kullanıcının lead form hedef deneyimi olarak değerlendirebileceği örnek iç kategori.", color: "#0891B2" }),
  categoryTemplate({ dimensionKey: "destination", categoryKey: "whatsapp", label: "WhatsApp",
    description: "Kullanıcının WhatsApp hedef deneyimi olarak değerlendirebileceği örnek iç kategori.", color: "#15803D" }),
  categoryTemplate({ dimensionKey: "funnel_intent", categoryKey: "sales", label: "Satış",
    description: "Kullanıcının satış niyeti olarak değerlendirebileceği örnek iç kategori.", color: "#B45309" }),
  categoryTemplate({ dimensionKey: "protection_class", categoryKey: "protected_budget", label: "Korunan bütçe",
    description: "Bütçe koruması ancak kullanıcı tarafından ayrıca tanımlanmış policy referanslarıyla anlam kazanır.",
    color: "#BE123C", ownerConfigurationFields: ["budget_policy_refs", "transfer_policy_refs", "approval_policy_refs"] }),
]);

const CATALOG_MATERIAL = deepFreeze({
  schemaVersion: STARTER_CATEGORY_PLAYBOOK_CATALOG_VERSION,
  catalogStatus: "reviewed_bootstrap_proposal" as const,
  seedPolicy: "never_auto_seed" as const,
  ownerConfirmationRequired: true as const,
  objectivePlaybooks: OBJECTIVE_REFS,
  dimensions: DIMENSIONS,
  categoryTemplates: CATEGORIES,
  authority: NO_AUTHORITY,
});

export const STARTER_CATEGORY_PLAYBOOK_CATALOG_HASH = digest(CATALOG_MATERIAL);

/**
 * Definition-only catalog. It never creates tenant records and cannot authorize policy,
 * approval, action, tool, network or Meta operations.
 */
export const STARTER_CATEGORY_PLAYBOOK_CATALOG = deepFreeze({
  ...CATALOG_MATERIAL,
  catalogHash: STARTER_CATEGORY_PLAYBOOK_CATALOG_HASH,
});

function blocked(reasonCode: Extract<StarterCategoryProfileResolution, { status: "blocked" }>["reasonCode"]):
StarterCategoryProfileResolution {
  return Object.freeze({
    schemaVersion: STARTER_CATEGORY_PLAYBOOK_CATALOG_VERSION,
    catalogHash: STARTER_CATEGORY_PLAYBOOK_CATALOG_HASH,
    status: "blocked" as const,
    reasonCode,
    ownerConfirmationRequired: true as const,
    authority: NO_AUTHORITY,
  });
}

/**
 * Resolves one reviewable draft shape. Callers still need explicit owner confirmation,
 * tenant identities and a separate persistence lifecycle before a CategoryProfile exists.
 */
export function resolveStarterCategoryProfile(input: Readonly<{
  objective: string;
  categoryTemplateRef: string;
}>): StarterCategoryProfileResolution {
  const objectivePlaybook = OBJECTIVE_REFS.find((entry) => entry.objective === input.objective);
  if (!objectivePlaybook) return blocked("unknown_objective");

  const categoryTemplate = CATEGORIES.find((entry) => entry.templateRef === input.categoryTemplateRef);
  if (!categoryTemplate) return blocked("unknown_category");
  if (categoryTemplate.kind === "owner_defined_value" || categoryTemplate.ownerConfigurationFields.length > 0
    || categoryTemplate.categoryRef === null) return blocked("owner_configuration_required");

  const bindings: CategoryProfileBindings = deepFreeze({
    analysisPlaybookRefs: [objectivePlaybook.playbookRef],
    ruleInstructionBundleRefs: [],
    budgetPolicyRefs: [],
    transferPolicyRefs: [],
    schedulePolicyRefs: [],
    actionPolicyRefs: [],
    creativePolicyRefs: [],
  });
  const core = deepFreeze({
    schemaVersion: STARTER_CATEGORY_PLAYBOOK_CATALOG_VERSION,
    catalogHash: STARTER_CATEGORY_PLAYBOOK_CATALOG_HASH,
    status: "review_required" as const,
    objectivePlaybook,
    categoryTemplate,
    profileTemplate: {
      schemaVersion: CATEGORY_PROFILE_VERSION,
      categoryRef: categoryTemplate.categoryRef,
      parentCategoryRef: null,
      label: categoryTemplate.label,
      description: categoryTemplate.description,
      color: categoryTemplate.color,
      status: "draft" as const,
      bindings,
    },
    ownerConfirmationRequired: true as const,
    persistenceAdapterRequired: true as const,
    authority: NO_AUTHORITY,
  });
  return deepFreeze({ ...core, proposalHash: digest(core) });
}
