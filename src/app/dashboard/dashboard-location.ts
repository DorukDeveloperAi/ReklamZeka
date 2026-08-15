export type DashboardViewId =
  | "monitor" | "manage" | "agent"
  | "today" | "campaigns" | "analysis" | "decision-room" | "practice-lab" | "budgets"
  | "rules" | "strict-policies" | "categories" | "autonomy" | "approvals" | "promotions"
  | "alerts" | "timeline" | "meta" | "settings";

/** Internal IDs remain stable; the UI labels them İzle, Yönet and Agent. */
export type ViewId = "monitor" | "manage" | "agent";
export type ManageArea = "portfolio" | "decisions" | "rules" | "settings";
export type DecisionArea = "analysis" | "budgets" | "approvals";
export type BudgetArea = "proposals" | "pools";
export type CampaignArea = "portfolio" | "classification" | "promotion" | "timeline";
/** Keep user-authored Slice Rules distinct from guidance, policy and authority tooling. */
export type RulesArea = "guidance" | "slices" | "policies" | "authority" | "learning";
export type SettingsArea = "meta" | "categories" | "promotion-templates";

export type DashboardLocation = Readonly<{
  view: ViewId;
  manageArea: ManageArea;
  decisionArea: DecisionArea;
  budgetArea: BudgetArea;
  campaignArea: CampaignArea;
  rulesArea: RulesArea;
  settingsArea: SettingsArea;
  /** Public mirror alias only; it is revalidated against frozen context client-side. */
  campaignRef: string | null;
  /** Public ActionUnit alias. It can only open the human approval detail surface. */
  approvalUnitRef: string | null;
}>;

type SearchRecord = Readonly<Record<string, string | readonly string[] | undefined>>;
type SearchReader = Readonly<{ get(name: string): string | null }>;

const defaultLocation = Object.freeze({
  view: "monitor",
  manageArea: "portfolio",
  decisionArea: "analysis",
  budgetArea: "proposals",
  campaignArea: "portfolio",
  rulesArea: "guidance",
  settingsArea: "meta",
  campaignRef: null,
  approvalUnitRef: null,
} satisfies DashboardLocation);

const dashboardViews = new Set<DashboardViewId>([
  "monitor", "manage", "agent", "today", "campaigns", "analysis", "decision-room", "practice-lab", "budgets",
  "rules", "strict-policies", "categories", "autonomy", "approvals", "promotions", "alerts", "timeline", "meta", "settings",
]);
const manageAreas = new Set<ManageArea>(["portfolio", "decisions", "rules", "settings"]);
const decisionAreas = new Set<DecisionArea>(["analysis", "budgets", "approvals"]);
const budgetAreas = new Set<BudgetArea>(["proposals", "pools"]);
const campaignAreas = new Set<CampaignArea>(["portfolio", "classification", "promotion", "timeline"]);
const rulesAreas = new Set<RulesArea>(["guidance", "slices", "policies", "authority", "learning"]);
const settingsAreas = new Set<SettingsArea>(["meta", "categories", "promotion-templates"]);

function searchValue(search: SearchRecord | SearchReader, name: string): string | null {
  if ("get" in search && typeof search.get === "function") return search.get(name);
  const record = search as SearchRecord;
  const value = record[name];
  return typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

/** Preserve old entry points while exposing only the three approved product areas. */
export function normalizeDashboardLocation(initialView: DashboardViewId): DashboardLocation {
  const base = { ...defaultLocation };
  if (initialView === "monitor" || initialView === "today" || initialView === "alerts") return base;
  if (initialView === "agent") return { ...base, view: "agent" };
  if (initialView === "manage") return { ...base, view: "manage" };
  if (initialView === "campaigns") return { ...base, view: "manage", manageArea: "portfolio" };
  if (initialView === "promotions") return { ...base, view: "manage", manageArea: "portfolio", campaignArea: "promotion" };
  if (initialView === "timeline") return { ...base, view: "manage", manageArea: "portfolio", campaignArea: "timeline" };
  if (initialView === "analysis" || initialView === "decision-room") return { ...base, view: "manage", manageArea: "decisions" };
  if (initialView === "budgets") return { ...base, view: "manage", manageArea: "decisions", decisionArea: "budgets" };
  if (initialView === "approvals") return { ...base, view: "manage", manageArea: "decisions", decisionArea: "approvals" };
  if (initialView === "rules") return { ...base, view: "manage", manageArea: "rules" };
  if (initialView === "strict-policies") return { ...base, view: "manage", manageArea: "rules", rulesArea: "policies" };
  if (initialView === "autonomy") return { ...base, view: "manage", manageArea: "rules", rulesArea: "authority" };
  if (initialView === "practice-lab") return { ...base, view: "manage", manageArea: "rules", rulesArea: "learning" };
  if (initialView === "categories") return { ...base, view: "manage", manageArea: "settings", settingsArea: "categories" };
  if (initialView === "meta" || initialView === "settings") return { ...base, view: "manage", manageArea: "settings" };
  return base;
}

/** Parse only allowlisted view/area values; malformed or repeated input fails closed. */
export function dashboardLocationFromSearch(search: SearchRecord | SearchReader): DashboardLocation {
  const requestedView = searchValue(search, "view");
  const legacyView = requestedView && dashboardViews.has(requestedView as DashboardViewId)
    ? requestedView as DashboardViewId : "monitor";
  const normalized = normalizeDashboardLocation(legacyView);
  const area = searchValue(search, "area");
  const tab = searchValue(search, "tab");
  const requestedCampaignRef = searchValue(search, "campaign");
  const requestedApprovalUnitRef = searchValue(search, "unit");
  const isDecisionContext = normalized.manageArea === "decisions" || (legacyView === "manage" && area === "decisions");
  const campaignRef = normalized.view === "manage" && isDecisionContext
    && requestedCampaignRef !== null && /^ref_[a-f0-9]{12}$/.test(requestedCampaignRef) ? requestedCampaignRef : null;
  const location = { ...normalized, campaignRef };
  if (normalized.view !== "manage") return location;
  // Legacy links used `area` for the leaf tab. Canonical Manage URLs reserve it
  // for the approved parent area and use `tab` below.
  if (legacyView === "campaigns") return { ...location, manageArea: "portfolio",
    campaignArea: area && campaignAreas.has(area as CampaignArea) ? area as CampaignArea : normalized.campaignArea };
  if (legacyView === "rules" || legacyView === "strict-policies" || legacyView === "autonomy" || legacyView === "practice-lab") {
    return { ...location, manageArea: "rules",
      rulesArea: area && rulesAreas.has(area as RulesArea) ? area as RulesArea : normalized.rulesArea };
  }
  if (legacyView === "budgets") return { ...location, manageArea: "decisions", decisionArea: "budgets",
    budgetArea: area && budgetAreas.has(area as BudgetArea) ? area as BudgetArea : normalized.budgetArea };
  if (legacyView === "categories" || legacyView === "meta" || legacyView === "settings") return { ...location, manageArea: "settings",
    settingsArea: area && settingsAreas.has(area as SettingsArea) ? area as SettingsArea : normalized.settingsArea };
  const manageArea = area && manageAreas.has(area as ManageArea) ? area as ManageArea : normalized.manageArea;
  if (manageArea === "portfolio") return { ...location, manageArea,
    campaignArea: tab && campaignAreas.has(tab as CampaignArea) ? tab as CampaignArea : normalized.campaignArea };
  if (manageArea === "decisions") {
    const decisionArea = tab && decisionAreas.has(tab as DecisionArea) ? tab as DecisionArea : normalized.decisionArea;
    const approvalUnitRef = decisionArea === "approvals" && requestedApprovalUnitRef !== null
      && /^action_unit_[a-f0-9]{20}$/.test(requestedApprovalUnitRef) ? requestedApprovalUnitRef : null;
    return { ...location, manageArea, decisionArea, approvalUnitRef,
    budgetArea: tab === "budgets" && searchValue(search, "detail") && budgetAreas.has(searchValue(search, "detail") as BudgetArea)
      ? searchValue(search, "detail") as BudgetArea : normalized.budgetArea };
  }
  if (manageArea === "rules") return { ...location, manageArea,
    rulesArea: tab && rulesAreas.has(tab as RulesArea) ? tab as RulesArea : normalized.rulesArea };
  return { ...location, manageArea: "settings",
    settingsArea: tab && settingsAreas.has(tab as SettingsArea) ? tab as SettingsArea : normalized.settingsArea };
}

/** Emit the smallest shareable URL while preserving the approved subarea. */
export function dashboardLocationHref(location: DashboardLocation): string {
  const search = new URLSearchParams();
  if (location.view !== "monitor") search.set("view", location.view);
  if (location.view === "manage") {
    if (location.manageArea !== "portfolio") search.set("area", location.manageArea);
    if (location.manageArea === "portfolio" && location.campaignArea !== "portfolio") search.set("tab", location.campaignArea);
    if (location.manageArea === "decisions" && location.decisionArea !== "analysis") search.set("tab", location.decisionArea);
    if (location.manageArea === "decisions" && location.decisionArea === "budgets" && location.budgetArea !== "proposals") search.set("detail", location.budgetArea);
    if (location.manageArea === "rules" && location.rulesArea !== "guidance") search.set("tab", location.rulesArea);
    if (location.manageArea === "settings" && location.settingsArea !== "meta") search.set("tab", location.settingsArea);
    if (location.manageArea === "decisions" && location.campaignRef) search.set("campaign", location.campaignRef);
    if (location.manageArea === "decisions" && location.decisionArea === "approvals" && location.approvalUnitRef) search.set("unit", location.approvalUnitRef);
  }
  const query = search.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
}
