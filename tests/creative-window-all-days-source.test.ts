import { describe, expect, it, vi } from "vitest";
import { MetaGraphCreativeWindowAllDaysSource } from "@/connectors/meta/creative-window-all-days-source";

const input = Object.freeze({ accountRef: "act_123", adRef: "123456", startDate: "2026-08-01", endDate: "2026-08-07" });
describe("MetaGraphCreativeWindowAllDaysSource", () => {
  it("requests one exact ad-level all-days source grain and rejects pagination/ambiguous data", async () => {
    const get = vi.fn(async () => ({ records: [{ account_id: input.accountRef, ad_id: input.adRef, date_start: input.startDate, date_stop: input.endDate, frequency: "2.2", clicks: "20", impressions: "200" }], nextCursor: null, usageHeadroom: 0.8, sourceGraphVersion: "v23.0", fieldCatalogVersion: "meta-insights/1" }));
    const source = new MetaGraphCreativeWindowAllDaysSource({ get });
    await expect(source.read(input)).resolves.toMatchObject({ startDate: input.startDate, endDate: input.endDate, frequency: "2.2", sourceRef: expect.stringMatching(/^creative_window_[a-f0-9]{24}$/) });
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", stream: "insights", entityLevel: "ad", insightTimeIncrement: "all_days", insightSubjectId: input.adRef }));
    const ambiguous = new MetaGraphCreativeWindowAllDaysSource({ get: vi.fn(async () => ({ records: [], nextCursor: "next", usageHeadroom: 1 })) });
    await expect(ambiguous.read(input)).rejects.toMatchObject({ code: "ambiguous" });
  });
});
