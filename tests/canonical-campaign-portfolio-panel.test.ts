import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalCampaignPortfolio } from "@/app/dashboard/canonical-campaign-portfolio-panel";
import type { MetaReadMirrorProjection } from "@/domain/meta/read-mirror-projection";

const projection = { connections: [{ accounts: [{ name: "TR", currency: "TRY", campaigns: [
  { campaignRef: "campaign_b", name: "Beta", objective: "OUTCOME_LEADS", status: "ACTIVE" },
  { campaignRef: "campaign_a", name: "Alfa", objective: null, status: null },
] }] }, { accounts: [{ name: "GCC", currency: "AED", campaigns: [{ campaignRef: "campaign_c", name: "Çam", objective: "OUTCOME_AWARENESS", status: "PAUSED" }] }] }] } as unknown as MetaReadMirrorProjection;

describe("canonical campaign portfolio", () => {
  it("uses only already-validated mirror entries and keeps account/currency provenance", () => {
    expect(canonicalCampaignPortfolio(projection).map(({ campaignRef, accountName, currency }) => [campaignRef, accountName, currency])).toEqual([
      ["campaign_a", "TR", "TRY"], ["campaign_b", "TR", "TRY"], ["campaign_c", "GCC", "AED"],
    ]);
  });

  it("exposes the selected campaign and its detail heading to assistive technology", () => {
    const source = readFileSync("src/app/dashboard/canonical-campaign-portfolio-panel.tsx", "utf8");
    expect(source).toContain("aria-pressed={selected.campaignRef === entry.campaignRef}");
    expect(source).toContain("focusDetailAfterSelectionRef.current = true");
    expect(source).toContain("ref={detailHeadingRef} tabIndex={-1}");
    expect(source).toContain("<CampaignPerformanceEvidencePanel campaignRef={selected.campaignRef} />");
  });
});
