import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateBudgetPoolDraft } from "@/app/dashboard/budget-pool-hierarchy-panel";

const source = readFileSync("src/app/dashboard/budget-pool-hierarchy-panel.tsx", "utf8");
const css = readFileSync("src/app/dashboard/budget-pool-hierarchy-panel.module.css", "utf8");
const at = "2026-08-14T00:00:00.000Z";
const until = "2026-09-14T00:00:00.000Z";
const roots = [
  { poolRef: "budget_pool_domestic", parentPoolRef: null, layer: "market" as const, market: "domestic" as const, currency: "TRY", hardCapDecimal: "500", effectiveFrom: at, effectiveTo: until },
  { poolRef: "budget_pool_international", parentPoolRef: null, layer: "market" as const, market: "international" as const, currency: "TRY", hardCapDecimal: "500", effectiveFrom: at, effectiveTo: until },
] as const;

describe("budget pool hierarchy guided dashboard", () => {
  it("keeps domestic and international roots separate while guiding the four primary levels", () => {
    expect(validateBudgetPoolDraft([...roots, {
      poolRef: "budget_pool_domestic_health", parentPoolRef: "budget_pool_domestic", layer: "service_family", market: "domestic", currency: "TRY", hardCapDecimal: "400", effectiveFrom: at, effectiveTo: until,
    }, {
      poolRef: "budget_pool_domestic_health_ist", parentPoolRef: "budget_pool_domestic_health", layer: "targeting", market: "domestic", currency: "TRY", hardCapDecimal: "300", effectiveFrom: at, effectiveTo: until,
    }, {
      poolRef: "budget_pool_domestic_health_ist_ads", parentPoolRef: "budget_pool_domestic_health_ist", layer: "entity", market: "domestic", currency: "TRY", hardCapDecimal: "200", effectiveFrom: at, effectiveTo: until,
    }])).toBeNull();
    expect(source).toContain('service_family: "Hizmet / aile"');
    expect(source).toContain("Özel alt havuz ekle");
  });

  it("guides market, cap and parent-scope failures before the immutable server check", () => {
    const child = { poolRef: "budget_pool_invalid_child", parentPoolRef: "budget_pool_domestic", layer: "service_family" as const, market: "international" as const, currency: "TRY", hardCapDecimal: "600", effectiveFrom: at, effectiveTo: until };
    expect(validateBudgetPoolDraft([...roots, child])).toMatch(/pazar ve para biriminde/);
    expect(validateBudgetPoolDraft([...roots, { ...child, market: "domestic", hardCapDecimal: "600" }])).toMatch(/tavanı üst havuzun tavanını aşamaz/);
    expect(validateBudgetPoolDraft([...roots, { ...child, market: "domestic", hardCapDecimal: "100", parentPoolRef: "budget_pool_missing" }])).toMatch(/üst havuzu bulunamadı/);
  });

  it("removes the raw JSON editor and preserves a readable mobile, recommendation-only surface", () => {
    expect(source).not.toContain("<textarea");
    expect(source).not.toContain("JSON.parse");
    expect(source).toContain("Yerli ve yabancı kökler ayrıdır");
    expect(source).toContain("canExecute: false");
    expect(source).toContain("canWriteMeta: false");
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain("grid-template-columns: 1fr");
  });
});
