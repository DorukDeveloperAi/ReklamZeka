import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_PORTFOLIO_PAGE_SIZE,
  canonicalAccountSourceState,
  canonicalCampaignPortfolio,
  filterCanonicalCampaignPortfolio,
} from "@/app/dashboard/canonical-campaign-portfolio-panel";
import type { MetaReadMirrorProjection } from "@/domain/meta/read-mirror-projection";

const projection = { connections: [{ accounts: [{ accountRef: "account_tr", name: "TR", currency: "TRY", campaigns: [
  { campaignRef: "campaign_b", name: "Beta", objective: "OUTCOME_LEADS", status: "ACTIVE" },
  { campaignRef: "campaign_a", name: "Alfa", objective: null, status: null },
] }] }, { accounts: [{ accountRef: "account_gcc", name: "GCC", currency: "AED", campaigns: [{ campaignRef: "campaign_c", name: "Çam", objective: "OUTCOME_AWARENESS", status: "PAUSED" }] }] }] } as unknown as MetaReadMirrorProjection;

describe("canonical campaign portfolio", () => {
  it("uses only already-validated mirror entries and keeps account identity/currency provenance", () => {
    expect(canonicalCampaignPortfolio(projection).map(({ campaignRef, accountRef, accountName, currency }) => [campaignRef, accountRef, accountName, currency])).toEqual([
      ["campaign_a", "account_tr", "TR", "TRY"], ["campaign_b", "account_tr", "TR", "TRY"], ["campaign_c", "account_gcc", "GCC", "AED"],
    ]);
  });

  it("exposes the selected campaign and its detail heading to assistive technology", () => {
    const source = readFileSync("src/app/dashboard/canonical-campaign-portfolio-panel.tsx", "utf8");
    expect(source).toContain('data-active={selected.campaignRef === entry.campaignRef}');
    expect(source).toContain("focusDetailAfterSelectionRef.current = true");
    expect(source).toContain("ref={detailHeadingRef} tabIndex={-1}");
    expect(source).toContain("<CampaignPerformanceEvidencePanel campaignRef={selected.campaignRef} />");
    expect(source).toContain("Hiyerarşi gözlemi; performans freshness’i değildir");
    expect(source).toContain("Hesap kaynak durumu");
    expect(source).toContain("Operasyon tablosu");
    expect(source).toContain("Bağlı kural yok");
    expect(source).toContain("isimle slice'a bağlanmaz");
    for (const action of ["İncele", "Kuralı aç", "Asistanla aç", "Kararlarda incele"]) expect(source).toContain(action);
  });

  it("filters only canonical entries by an explicit account ref, status, or case-insensitive search", () => {
    const entries = canonicalCampaignPortfolio(projection);
    expect(filterCanonicalCampaignPortfolio(entries, { query: "", accountRef: "account_tr", status: "" }).map((entry) => entry.campaignRef)).toEqual(["campaign_a", "campaign_b"]);
    expect(filterCanonicalCampaignPortfolio(entries, { query: "", accountRef: "", status: "PAUSED" }).map((entry) => entry.campaignRef)).toEqual(["campaign_c"]);
    expect(filterCanonicalCampaignPortfolio(entries, { query: "ÇAM", accountRef: "", status: "" }).map((entry) => entry.campaignRef)).toEqual(["campaign_c"]);
    expect(CANONICAL_PORTFOLIO_PAGE_SIZE).toBe(24);
  });

  it("does not use duplicate account names as the filter identity and exposes empty account scope", () => {
    const duplicateNames = canonicalCampaignPortfolio({ connections: [{ accounts: [
      { ...projection.connections[0]!.accounts[0]!, accountRef: "account_same_a", name: "Aynı ad" },
      { ...projection.connections[1]!.accounts[0]!, accountRef: "account_same_b", name: "Aynı ad" },
    ] }] } as unknown as MetaReadMirrorProjection);
    expect(filterCanonicalCampaignPortfolio(duplicateNames, { query: "", accountRef: "account_same_a", status: "" }).map((entry) => entry.campaignRef)).toEqual(["campaign_a", "campaign_b"]);
    const emptyAccount = { ...projection.connections[0]!.accounts[0]!, freshness: { inventoryStatus: "completed", creativeStatus: "completed", insightStatus: "completed", insightObservedAt: null, insightCanonicalRowCount: 0, latestObservedAt: null } as const, campaigns: [] };
    expect(canonicalAccountSourceState(emptyAccount)).toBe("empty");
  });

  it("keeps the client list bounded and offers accessible page controls", () => {
    const source = readFileSync("src/app/dashboard/canonical-campaign-portfolio-panel.tsx", "utf8");
    expect(source).toContain("type=\"search\"");
    expect(source).toContain("Kampanya sayfaları");
    expect(source).toContain("visibleEntries.map");
    expect(source).not.toContain("entries.map((entry) => <button");
  });
});
