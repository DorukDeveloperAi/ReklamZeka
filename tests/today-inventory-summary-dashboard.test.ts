import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OperatingDashboard,
  resolveMetaAccountFocus,
  todayInventorySummary,
} from "@/app/dashboard/operating-dashboard";
import type { MetaInventorySnapshot } from "@/connectors/meta/types";

const model = {
  periodDays: 7, spend: "₺0", conversions: 0, cpa: "₺0", roas: "0",
  freshnessHours: 0, freshnessLabel: "şimdi", currency: "TRY", timezone: "Europe/Istanbul",
  attribution: "7d_click_1d_view",
};

function inventory(): MetaInventorySnapshot {
  return {
    connection: { status: "valid", graphApiVersion: "v24.0", accessMode: "read_only", expiresAt: null, dataAccessExpiresAt: null, grantedScopes: [], securityStatus: "standard" },
    summary: { adAccounts: 4, pages: 1, linkedInstagramAccounts: 1, campaigns: 32, adSets: 0, ads: 0, accountsWithCampaigns: 4 },
    capabilities: [], accounts: [], pages: [], errors: [], refreshedAt: "2026-08-11T09:30:00.000Z", nextAutomaticRefreshAt: "2026-08-11T09:45:00.000Z",
    audit: { eventId: "audit_inventory", action: "connection.inventory_refreshed", occurredAt: "2026-08-11T09:30:00.000Z", writeOperations: 0 },
  };
}

describe("Today inventory summary", () => {
  it("uses only a structurally valid read-only inventory snapshot for verified counts and freshness", () => {
    expect(todayInventorySummary(inventory())).toEqual({
      state: "verified", adAccounts: 4, campaigns: 32, refreshedAt: "2026-08-11T09:30:00.000Z",
    });
  });

  it("fails closed instead of turning absent or malformed inventory into live counts", () => {
    expect(todayInventorySummary(null)).toEqual({ state: "unavailable", adAccounts: null, campaigns: null, refreshedAt: null });
    expect(todayInventorySummary({ ...inventory(), summary: { ...inventory().summary, campaigns: -1 } })).toEqual({
      state: "unavailable", adAccounts: null, campaigns: null, refreshedAt: null,
    });
  });

  it("keeps account focus within the current read-only inventory snapshot", () => {
    const accounts = [
      { id: "act_a", name: "A", currency: "TRY", timezone: "Europe/Istanbul", status: "ACTIVE", campaignCount: 1, adSetCount: 1, adCount: 1, campaignExamples: [], adCopyExamples: [], insightAccess: { verified: true, timeframe: "7d", dateStart: null, dateStop: null }, businessName: null },
      { id: "act_b", name: "B", currency: "USD", timezone: "UTC", status: "ACTIVE", campaignCount: 2, adSetCount: 2, adCount: 2, campaignExamples: [], adCopyExamples: [], insightAccess: { verified: false, timeframe: "7d", dateStart: null, dateStop: null }, businessName: null },
    ] as const;
    expect(resolveMetaAccountFocus(accounts, "act_b")).toBe("act_b");
    expect(resolveMetaAccountFocus(accounts, "act_missing")).toBe("act_a");
    expect(resolveMetaAccountFocus([], "act_a")).toBe("");
  });

  it("labels the initial Today surface as demo/unavailable and does not claim hardcoded account or campaign totals", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { model }));
    expect(html).toContain("Meta inventory yükleniyor · demo");
    expect(html).toContain("Kampanya sayısı doğrulanmadı");
    expect(html).toContain("demo sayıları canlı veri değildir");
    expect(html).toContain("Canlı outcome metriği olmadan CPA gösterilmez.");
    expect(html).toContain("Örnek karar biçimleri");
    expect(html).toContain("3 senaryoyu aç");
    expect(html).not.toContain("₺128.000");
    expect(html).not.toContain("32 aktif kampanya");
  });
});
