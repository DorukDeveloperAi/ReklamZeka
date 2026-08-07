export type MetaBudgetFields = Readonly<{
  dailyBudgetMinor?: number | null;
  lifetimeBudgetMinor?: number | null;
}>;

export type CampaignBudgetInput = MetaBudgetFields & Readonly<{
  externalCampaignId: string;
  campaignBudgetOptimization: boolean | null;
}>;

export type AdSetBudgetInput = MetaBudgetFields & Readonly<{
  externalAdSetId: string;
}>;

export type AdBudgetInput = MetaBudgetFields & Readonly<{
  externalAdId: string;
}>;

export type BudgetOwner = Readonly<{
  level: "campaign" | "ad_set";
  externalId: string;
  budgetType: "daily" | "lifetime";
  amountMinor: number;
}>;

export type BudgetOwnerUnknownReason =
  | "ambiguous_budget_period"
  | "campaign_budget_missing"
  | "conflicting_budget_levels"
  | "ad_set_budget_missing"
  | "no_ad_sets";

export type BudgetOwnerResolution =
  | Readonly<{
    status: "resolved";
    model: "CBO" | "ABO";
    owners: readonly BudgetOwner[];
  }>
  | Readonly<{
    status: "unknown";
    reason: BudgetOwnerUnknownReason;
    affectedExternalIds: readonly string[];
  }>;

export class BudgetOwnerResolutionError extends Error {
  constructor(
    readonly code: "invalid_identity" | "invalid_budget" | "ad_level_budget_not_supported",
    readonly entityExternalId: string,
    message: string,
  ) {
    super(message);
    this.name = "BudgetOwnerResolutionError";
  }
}

type PresentBudget = Readonly<{
  budgetType: "daily" | "lifetime";
  amountMinor: number;
}>;

function assertIdentity(externalId: string, entity: string): void {
  if (!externalId.trim()) {
    throw new BudgetOwnerResolutionError("invalid_identity", externalId, `${entity} external ID zorunludur`);
  }
}

function validateBudgetValue(value: number | null | undefined, externalId: string, field: string): void {
  if (value === null || value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BudgetOwnerResolutionError(
      "invalid_budget",
      externalId,
      `${field} negatif olmayan güvenli bir tam sayı olmalıdır`,
    );
  }
}

function presentBudget(
  entity: MetaBudgetFields,
  externalId: string,
): PresentBudget | "ambiguous" | null {
  validateBudgetValue(entity.dailyBudgetMinor, externalId, "dailyBudgetMinor");
  validateBudgetValue(entity.lifetimeBudgetMinor, externalId, "lifetimeBudgetMinor");

  const hasDaily = entity.dailyBudgetMinor !== null && entity.dailyBudgetMinor !== undefined;
  const hasLifetime = entity.lifetimeBudgetMinor !== null && entity.lifetimeBudgetMinor !== undefined;
  if (hasDaily && hasLifetime) return "ambiguous";
  if (hasDaily) return { budgetType: "daily", amountMinor: entity.dailyBudgetMinor! };
  if (hasLifetime) return { budgetType: "lifetime", amountMinor: entity.lifetimeBudgetMinor! };
  return null;
}

/**
 * Resolves the actual Meta budget owner without inventing an ad-level budget.
 * Unknown or contradictory platform state is returned as a reasoned result so
 * downstream planning can fail closed.
 */
export function resolveBudgetOwners(input: Readonly<{
  campaign: CampaignBudgetInput;
  adSets: readonly AdSetBudgetInput[];
  ads?: readonly AdBudgetInput[];
}>): BudgetOwnerResolution {
  assertIdentity(input.campaign.externalCampaignId, "Campaign");

  for (const ad of input.ads ?? []) {
    assertIdentity(ad.externalAdId, "Ad");
    const budget = presentBudget(ad, ad.externalAdId);
    if (budget !== null) {
      throw new BudgetOwnerResolutionError(
        "ad_level_budget_not_supported",
        ad.externalAdId,
        "Meta reklam seviyesinde bütçe desteklenmez",
      );
    }
  }

  const campaignBudget = presentBudget(input.campaign, input.campaign.externalCampaignId);
  if (campaignBudget === "ambiguous") {
    return {
      status: "unknown",
      reason: "ambiguous_budget_period",
      affectedExternalIds: [input.campaign.externalCampaignId],
    };
  }

  const orderedAdSets = [...input.adSets].sort((left, right) =>
    left.externalAdSetId.localeCompare(right.externalAdSetId),
  );
  const adSetBudgets = orderedAdSets.map((adSet) => {
    assertIdentity(adSet.externalAdSetId, "Ad set");
    return { adSet, budget: presentBudget(adSet, adSet.externalAdSetId) };
  });

  const ambiguousAdSets = adSetBudgets
    .filter(({ budget }) => budget === "ambiguous")
    .map(({ adSet }) => adSet.externalAdSetId);
  if (ambiguousAdSets.length > 0) {
    return { status: "unknown", reason: "ambiguous_budget_period", affectedExternalIds: ambiguousAdSets };
  }

  const adSetsWithBudget = adSetBudgets.filter(
    (entry): entry is { adSet: AdSetBudgetInput; budget: PresentBudget } =>
      entry.budget !== null && entry.budget !== "ambiguous",
  );

  if (campaignBudget && adSetsWithBudget.length > 0) {
    return {
      status: "unknown",
      reason: "conflicting_budget_levels",
      affectedExternalIds: [
        input.campaign.externalCampaignId,
        ...adSetsWithBudget.map(({ adSet }) => adSet.externalAdSetId),
      ],
    };
  }

  if (campaignBudget) {
    return {
      status: "resolved",
      model: "CBO",
      owners: [{
        level: "campaign",
        externalId: input.campaign.externalCampaignId,
        ...campaignBudget,
      }],
    };
  }

  if (input.campaign.campaignBudgetOptimization === true) {
    return {
      status: "unknown",
      reason: "campaign_budget_missing",
      affectedExternalIds: [input.campaign.externalCampaignId],
    };
  }

  if (orderedAdSets.length === 0) {
    return {
      status: "unknown",
      reason: "no_ad_sets",
      affectedExternalIds: [input.campaign.externalCampaignId],
    };
  }

  const adSetsMissingBudget = adSetBudgets
    .filter(({ budget }) => budget === null)
    .map(({ adSet }) => adSet.externalAdSetId);
  if (adSetsMissingBudget.length > 0) {
    return {
      status: "unknown",
      reason: "ad_set_budget_missing",
      affectedExternalIds: adSetsMissingBudget,
    };
  }

  return {
    status: "resolved",
    model: "ABO",
    owners: adSetsWithBudget.map(({ adSet, budget }) => ({
      level: "ad_set",
      externalId: adSet.externalAdSetId,
      ...budget,
    })),
  };
}
