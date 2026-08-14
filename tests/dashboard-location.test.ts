import { describe, expect, it } from "vitest";
import {
  dashboardLocationFromSearch,
  dashboardLocationHref,
  normalizeDashboardLocation,
  type DashboardLocation,
} from "@/app/dashboard/dashboard-location";

describe("dashboard URL and history location contract", () => {
  it("parses canonical primary views and only their allowlisted subareas", () => {
    expect(dashboardLocationFromSearch(new URLSearchParams("view=manage&area=portfolio&tab=promotion")))
      .toMatchObject({ view: "manage", manageArea: "portfolio", campaignArea: "promotion" });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=manage&area=rules&tab=authority")))
      .toMatchObject({ view: "manage", manageArea: "rules", rulesArea: "authority" });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=manage&area=decisions&tab=budgets&detail=pools")))
      .toMatchObject({ view: "manage", manageArea: "decisions", decisionArea: "budgets", budgetArea: "pools" });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=manage&area=decisions&campaign=ref_abcdef012345")))
      .toMatchObject({ view: "manage", manageArea: "decisions", campaignRef: "ref_abcdef012345" });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=decision-room&campaign=ref_abcdef012345")))
      .toMatchObject({ view: "manage", manageArea: "decisions", campaignRef: "ref_abcdef012345" });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=campaigns&campaign=ref_abcdef012345")))
      .toMatchObject({ view: "manage", manageArea: "portfolio", campaignRef: null });
  });

  it("retains only a public campaign alias for the contextual decision surfaces", () => {
    const location: DashboardLocation = { ...normalizeDashboardLocation("decision-room"), campaignRef: "ref_abcdef012345" };
    expect(dashboardLocationHref(location)).toBe("/dashboard?view=manage&area=decisions&campaign=ref_abcdef012345");
    expect(dashboardLocationFromSearch(new URLSearchParams("view=approvals&campaign=campaign_private"))).toMatchObject({ campaignRef: null });
  });

  it("normalizes legacy entry points into the approved parent context", () => {
    expect(dashboardLocationFromSearch(new URLSearchParams("view=strict-policies")))
      .toMatchObject({ view: "manage", manageArea: "rules", rulesArea: "policies" });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=campaigns&area=promotion")))
      .toMatchObject({ view: "manage", manageArea: "portfolio", campaignArea: "promotion" });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=agent")))
      .toMatchObject({ view: "agent" });
    expect(normalizeDashboardLocation("categories"))
      .toMatchObject({ view: "manage", manageArea: "settings", settingsArea: "categories" });
  });

  it("fails closed for unknown values and emits minimal shareable URLs", () => {
    expect(dashboardLocationFromSearch(new URLSearchParams("view=secrets&area=raw")))
      .toEqual(normalizeDashboardLocation("monitor"));
    const location: DashboardLocation = {
      ...normalizeDashboardLocation("settings"), settingsArea: "promotion-templates",
    };
    expect(dashboardLocationHref(location)).toBe("/dashboard?view=manage&area=settings&tab=promotion-templates");
    expect(dashboardLocationFromSearch(new URLSearchParams(dashboardLocationHref(location).split("?")[1])))
      .toEqual(location);
    expect(dashboardLocationHref(normalizeDashboardLocation("monitor"))).toBe("/dashboard");
  });
});
