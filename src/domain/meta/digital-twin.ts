export type BudgetAmount = Readonly<{ dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null }>;

export type BudgetOwnerResolution = Readonly<{
  level: "campaign" | "ad_set" | "unknown";
  ownerExternalId: string | null;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  reason: string | null;
}>;

export type BudgetOwnerInput = Readonly<{
  campaign: Readonly<{ externalId: string; budgetOptimizationEnabled: boolean | null }> & BudgetAmount;
  adSet: Readonly<{ externalId: string }> & BudgetAmount;
  ad?: Readonly<{ externalId: string; dailyBudgetMinor?: number | null; lifetimeBudgetMinor?: number | null }>;
}>;

function hasBudget(value: BudgetAmount): boolean {
  return value.dailyBudgetMinor !== null || value.lifetimeBudgetMinor !== null;
}

export function resolveMetaBudgetOwner(input: BudgetOwnerInput): BudgetOwnerResolution {
  if (input.ad?.dailyBudgetMinor != null || input.ad?.lifetimeBudgetMinor != null) {
    throw new Error(`Meta ad-level budget is invalid for ad ${input.ad.externalId}`);
  }
  const campaignHasBudget = hasBudget(input.campaign);
  const adSetHasBudget = hasBudget(input.adSet);
  if (input.campaign.budgetOptimizationEnabled === true) {
    if (!campaignHasBudget) return { level: "unknown", ownerExternalId: null, dailyBudgetMinor: null, lifetimeBudgetMinor: null, reason: "cbo_campaign_budget_missing" };
    if (adSetHasBudget) return { level: "unknown", ownerExternalId: null, dailyBudgetMinor: null, lifetimeBudgetMinor: null, reason: "cbo_with_ad_set_budget_conflict" };
    return { level: "campaign", ownerExternalId: input.campaign.externalId, dailyBudgetMinor: input.campaign.dailyBudgetMinor, lifetimeBudgetMinor: input.campaign.lifetimeBudgetMinor, reason: null };
  }
  if (campaignHasBudget && adSetHasBudget) return { level: "unknown", ownerExternalId: null, dailyBudgetMinor: null, lifetimeBudgetMinor: null, reason: "ambiguous_campaign_and_ad_set_budget" };
  if (adSetHasBudget) return { level: "ad_set", ownerExternalId: input.adSet.externalId, dailyBudgetMinor: input.adSet.dailyBudgetMinor, lifetimeBudgetMinor: input.adSet.lifetimeBudgetMinor, reason: null };
  if (campaignHasBudget) return { level: "campaign", ownerExternalId: input.campaign.externalId, dailyBudgetMinor: input.campaign.dailyBudgetMinor, lifetimeBudgetMinor: input.campaign.lifetimeBudgetMinor, reason: null };
  return { level: "unknown", ownerExternalId: null, dailyBudgetMinor: null, lifetimeBudgetMinor: null, reason: "budget_not_returned_by_source" };
}

export type MetaTwinNode = Readonly<{ externalId: string; parentExternalId: string | null }>;

export function validateMetaHierarchy(campaigns: readonly MetaTwinNode[], adSets: readonly MetaTwinNode[], ads: readonly MetaTwinNode[]): readonly string[] {
  const campaignIds = new Set(campaigns.map((item) => item.externalId));
  const adSetIds = new Set(adSets.map((item) => item.externalId));
  return [
    ...adSets.filter((item) => !item.parentExternalId || !campaignIds.has(item.parentExternalId)).map((item) => `orphan_ad_set:${item.externalId}`),
    ...ads.filter((item) => !item.parentExternalId || !adSetIds.has(item.parentExternalId)).map((item) => `orphan_ad:${item.externalId}`),
  ];
}

export function stableTwinSnapshotHash(value: unknown): string {
  const canonicalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(canonicalize);
    if (current && typeof current === "object") return Object.fromEntries(Object.entries(current as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]));
    return current;
  };
  return JSON.stringify(canonicalize(value));
}
