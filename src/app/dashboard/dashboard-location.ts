export type DashboardViewId = "today" | "campaigns" | "analysis" | "decision-room" | "practice-lab" | "budgets" | "rules" | "strict-policies" | "categories" | "autonomy" | "agent" | "approvals" | "promotions" | "alerts" | "timeline" | "meta" | "settings";
export type ViewId = "today" | "campaigns" | "decision-room" | "budgets" | "approvals" | "rules" | "settings";
export type BudgetArea = "proposals" | "pools";
export type CampaignArea = "portfolio" | "classification" | "promotion" | "timeline";
export type RulesArea = "guidance" | "policies" | "authority" | "learning";
export type SettingsArea = "meta" | "categories" | "promotion-templates";

export type DashboardLocation = Readonly<{
  view: ViewId;
  budgetArea: BudgetArea;
  campaignArea: CampaignArea;
  rulesArea: RulesArea;
  settingsArea: SettingsArea;
  assistantOpen: boolean;
  /** Public mirror alias only; it is revalidated against frozen context client-side. */
  campaignRef: string | null;
}>;

type SearchRecord = Readonly<Record<string, string | readonly string[] | undefined>>;
type SearchReader = Readonly<{ get(name: string): string | null }>;

const defaultLocation = Object.freeze({
  view: "today",
  budgetArea: "proposals",
  campaignArea: "portfolio",
  rulesArea: "guidance",
  settingsArea: "meta",
  assistantOpen: false,
  campaignRef: null,
} satisfies DashboardLocation);

const dashboardViews = new Set<DashboardViewId>([
  "today", "campaigns", "analysis", "decision-room", "practice-lab", "budgets", "rules",
  "strict-policies", "categories", "autonomy", "agent", "approvals", "promotions", "alerts",
  "timeline", "meta", "settings",
]);
const budgetAreas = new Set<BudgetArea>(["proposals", "pools"]);
const campaignAreas = new Set<CampaignArea>(["portfolio", "classification", "promotion", "timeline"]);
const rulesAreas = new Set<RulesArea>(["guidance", "policies", "authority", "learning"]);
const settingsAreas = new Set<SettingsArea>(["meta", "categories", "promotion-templates"]);

function searchValue(search: SearchRecord | SearchReader, name: string): string | null {
  if ("get" in search && typeof search.get === "function") return search.get(name);
  const record = search as SearchRecord;
  const value = record[name];
  return typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

/** Preserve old entry points while exposing only the approved, user-job-led IA. */
export function normalizeDashboardLocation(initialView: DashboardViewId): DashboardLocation {
  const base = { ...defaultLocation };
  if (initialView === "analysis") return { ...base, view: "decision-room" };
  if (initialView === "strict-policies") return { ...base, view: "rules", rulesArea: "policies" };
  if (initialView === "autonomy") return { ...base, view: "rules", rulesArea: "authority" };
  if (initialView === "practice-lab") return { ...base, view: "rules", rulesArea: "learning" };
  if (initialView === "categories") return { ...base, view: "settings", settingsArea: "categories" };
  if (initialView === "meta") return { ...base, view: "settings", settingsArea: "meta" };
  if (initialView === "promotions") return { ...base, view: "campaigns", campaignArea: "promotion" };
  if (initialView === "timeline") return { ...base, view: "campaigns", campaignArea: "timeline" };
  if (initialView === "alerts") return { ...base, view: "today" };
  if (initialView === "agent") return { ...base, view: "today", assistantOpen: true };
  if (initialView === "settings") return { ...base, view: "settings" };
  return { ...base, view: initialView };
}

/** Parse only allowlisted view/area values; malformed or repeated input fails closed to the relevant default. */
export function dashboardLocationFromSearch(search: SearchRecord | SearchReader): DashboardLocation {
  const requestedView = searchValue(search, "view");
  const view = requestedView && dashboardViews.has(requestedView as DashboardViewId)
    ? requestedView as DashboardViewId : "today";
  const normalized = normalizeDashboardLocation(view);
  const area = searchValue(search, "area");
  const assistantOpen = normalized.assistantOpen || searchValue(search, "assistant") === "1";
  const requestedCampaignRef = searchValue(search, "campaign");
  const campaignRef = (normalized.view === "decision-room" || normalized.view === "approvals")
    && requestedCampaignRef !== null && /^ref_[a-f0-9]{12}$/.test(requestedCampaignRef) ? requestedCampaignRef : null;
  if (normalized.view === "campaigns" && area && campaignAreas.has(area as CampaignArea)) {
    return { ...normalized, campaignArea: area as CampaignArea, assistantOpen, campaignRef };
  }
  if (normalized.view === "budgets" && area && budgetAreas.has(area as BudgetArea)) {
    return { ...normalized, budgetArea: area as BudgetArea, assistantOpen, campaignRef };
  }
  if (normalized.view === "rules" && area && rulesAreas.has(area as RulesArea)) {
    return { ...normalized, rulesArea: area as RulesArea, assistantOpen, campaignRef };
  }
  if (normalized.view === "settings" && area && settingsAreas.has(area as SettingsArea)) {
    return { ...normalized, settingsArea: area as SettingsArea, assistantOpen, campaignRef };
  }
  return { ...normalized, assistantOpen, campaignRef };
}

/** Emit the smallest shareable URL while preserving the active subarea and dialog state. */
export function dashboardLocationHref(location: DashboardLocation): string {
  const search = new URLSearchParams();
  if (location.view !== "today") search.set("view", location.view);
  if (location.view === "campaigns" && location.campaignArea !== "portfolio") search.set("area", location.campaignArea);
  if (location.view === "budgets" && location.budgetArea !== "proposals") search.set("area", location.budgetArea);
  if (location.view === "rules" && location.rulesArea !== "guidance") search.set("area", location.rulesArea);
  if (location.view === "settings" && location.settingsArea !== "meta") search.set("area", location.settingsArea);
  if (location.assistantOpen) search.set("assistant", "1");
  if ((location.view === "decision-room" || location.view === "approvals") && location.campaignRef) search.set("campaign", location.campaignRef);
  const query = search.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
}
