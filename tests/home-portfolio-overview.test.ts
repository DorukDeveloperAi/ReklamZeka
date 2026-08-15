import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { portfolioSourceGuidance } from "@/app/dashboard/canonical-campaign-portfolio-panel";

const surface = readFileSync("src/app/dashboard/home-portfolio-overview.tsx", "utf8");

describe("home portfolio overview", () => {
  it("uses canonical read contracts and keeps unknown states free of invented metrics", () => {
    expect(surface).toContain('fetch("/api/meta/canonical-performance"');
    expect(surface).toContain('fetch("/api/delivery-health-alerts"');
    expect(surface).toContain("canonicalPerformancePanelProjection");
    expect(surface).toContain("parseDeliveryHealthAlertList");
    expect(surface).toContain("portföy toplamı hesaplanmaz");
    expect(surface).toContain("metrik gösterilmiyor");
    expect(surface).toContain("risksiz olduğu çıkarımı yapılmaz");
  });

  it("only hands off to the portfolio workspace and offers no write or authoring controls", () => {
    expect(surface).toContain("Portföyü aç");
    expect(surface).not.toContain("Meta’da yaz");
    expect(surface).not.toContain("Kural oluştur");
    expect(surface).not.toContain("Policy oluştur");
  });

  it("states the impact and next step for a partial or empty portfolio source", () => {
    expect(portfolioSourceGuidance("partial")).toContain("kesin sonuç çıkarmayın");
    expect(portfolioSourceGuidance("empty")).toContain("başka bir portföyü tahmin etmemektir");
    expect(portfolioSourceGuidance("ready")).toBeNull();
  });
});
