import { describe, expect, it } from "vitest";
import {
  dashboardLocationFromSearch,
  dashboardLocationHref,
  normalizeDashboardLocation,
  type DashboardLocation,
} from "@/app/dashboard/dashboard-location";

describe("dashboard URL and history location contract", () => {
  it("parses canonical primary views and only their allowlisted subarea", () => {
    expect(dashboardLocationFromSearch(new URLSearchParams("view=campaigns&area=promotion")))
      .toMatchObject({ view: "campaigns", campaignArea: "promotion" });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=rules&area=authority&assistant=1")))
      .toMatchObject({ view: "rules", rulesArea: "authority", assistantOpen: true });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=budgets&area=authority")))
      .toMatchObject({ view: "budgets", budgetArea: "proposals" });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=decision-room&campaign=ref_abcdef012345")))
      .toMatchObject({ view: "decision-room", campaignRef: "ref_abcdef012345" });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=campaigns&campaign=ref_abcdef012345")))
      .toMatchObject({ view: "campaigns", campaignRef: null });
  });

  it("retains only a public campaign alias for the contextual decision surfaces", () => {
    const location: DashboardLocation = { ...normalizeDashboardLocation("decision-room"), campaignRef: "ref_abcdef012345" };
    expect(dashboardLocationHref(location)).toBe("/dashboard?view=decision-room&campaign=ref_abcdef012345");
    expect(dashboardLocationFromSearch(new URLSearchParams("view=approvals&campaign=campaign_private"))).toMatchObject({ campaignRef: null });
  });

  it("normalizes legacy entry points into the approved parent context", () => {
    expect(dashboardLocationFromSearch(new URLSearchParams("view=strict-policies")))
      .toMatchObject({ view: "rules", rulesArea: "policies" });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=promotions")))
      .toMatchObject({ view: "campaigns", campaignArea: "promotion" });
    expect(dashboardLocationFromSearch(new URLSearchParams("view=agent")))
      .toMatchObject({ view: "today", assistantOpen: true });
    expect(normalizeDashboardLocation("categories"))
      .toMatchObject({ view: "settings", settingsArea: "categories" });
  });

  it("fails closed for unknown values and emits minimal shareable URLs", () => {
    expect(dashboardLocationFromSearch(new URLSearchParams("view=secrets&area=raw")))
      .toEqual(normalizeDashboardLocation("today"));
    const location: DashboardLocation = {
      ...normalizeDashboardLocation("settings"), settingsArea: "promotion-templates", assistantOpen: true,
    };
    expect(dashboardLocationHref(location)).toBe("/dashboard?view=settings&area=promotion-templates&assistant=1");
    expect(dashboardLocationFromSearch(new URLSearchParams(dashboardLocationHref(location).split("?")[1])))
      .toEqual(location);
    expect(dashboardLocationHref(normalizeDashboardLocation("today"))).toBe("/dashboard");
  });
});
