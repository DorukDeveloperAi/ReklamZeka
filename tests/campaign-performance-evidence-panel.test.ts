import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { campaignPerformanceEvidenceFromResponse, selectedCampaignPerformanceEvidence } from "@/app/dashboard/campaign-performance-evidence-panel";

const campaignRef = "campaign_aaaaaaaaaaaaaaaaaaaaaaaa";
const secondCampaignRef = "campaign_bbbbbbbbbbbbbbbbbbbbbbbb";
const accountRef = "account_cccccccccccccccccccccccc";
function window(days: 7 | 30, state: "ready" | "partial" | "unavailable" = "ready") {
  return { days, state, startDate: "2026-08-01", endDate: "2026-08-07", observedDays: state === "ready" ? days : 1,
    missingDays: state === "ready" ? [] : ["2026-08-02"], freshnessAt: "2026-08-07T12:00:00.000Z", attribution: "7d_click",
    currency: "TRY", spend: state === "ready" ? { valueDecimal: "10000", currency: "TRY" } : null,
    outcome: state === "ready" ? { valueDecimal: "2" } : null, cpa: state === "ready" ? { valueDecimal: "5000", currency: "TRY" } : null,
    reasonCodes: state === "ready" ? [] : ["coverage_incomplete"] };
}
function payload(state: "ready" | "partial" | "unavailable" = "ready") {
  return { version: "canonical-performance-read/1.0.0", state, authority: { actionAuthority: "none", canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false },
    source: { contractVersion: "public-source/1.0.0", kind: "canonical_performance", state, observedAt: "2026-08-07T12:00:00.000Z", freshnessAt: "2026-08-07T12:00:00.000Z", freshnessThresholdMinutes: null, reasonCodes: state === "ready" ? [] : ["coverage_incomplete"] },
    accounts: [{ accountRef, name: "Hesap", currency: "TRY", windows: [window(7, state), window(30, state)], campaigns: [
      { campaignRef, name: "İsim yalnız gösterim dışı", windows: [window(7, state), window(30, state)] },
      { campaignRef: secondCampaignRef, name: "Başka isim", windows: [window(7, state), window(30, state)] },
    ] }] };
}

describe("campaign performance evidence panel contract", () => {
  it("selects only the exact mirror-compatible campaign ref and never falls back to a name", () => {
    const projection = campaignPerformanceEvidenceFromResponse(payload());
    expect(projection).not.toBeNull();
    expect(selectedCampaignPerformanceEvidence(projection, campaignRef)?.windows[0]).toMatchObject({ days: 7, state: "ready", observedDays: 7 });
    expect(selectedCampaignPerformanceEvidence(projection, "campaign_dddddddddddddddddddddddd")).toBeNull();
    expect(selectedCampaignPerformanceEvidence(projection, "İsim yalnız gösterim dışı")).toBeNull();
  });

  it("retains partial coverage evidence but exposes no monetary or outcome metric", () => {
    const projection = campaignPerformanceEvidenceFromResponse(payload("partial"));
    const evidence = selectedCampaignPerformanceEvidence(projection, campaignRef);
    expect(evidence?.windows.find((item) => item.days === 7)).toMatchObject({ state: "partial", missingDays: ["2026-08-02"], spend: null, outcome: null, cpa: null, reasonCodes: ["coverage_incomplete"] });
  });

  it("fails closed when the public source cannot prove the same coverage state", () => {
    const invalid = payload("ready");
    invalid.source.state = "partial";
    expect(campaignPerformanceEvidenceFromResponse(invalid)).toBeNull();
  });

  it("keeps the selected campaign's canonical evidence visible by default without upgrading partial windows", () => {
    const source = readFileSync("src/app/dashboard/campaign-performance-evidence-panel.tsx", "utf8");
    expect(source).toContain("<details className={styles.copyPreview} open>");
    expect(source).toContain("state === \"ready\" && selectedWindow?.state === \"ready\"");
    expect(source).toContain("Bu pencerenin metrikleri gösterilmez");
  });
});
