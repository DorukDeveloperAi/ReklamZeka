import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OperationPaginationGate, OperationTableSurface, operationAppendRows, operationHierarchy, operationProjectionReadState, parseOperationTableProjection } from "@/app/dashboard/operation-table-panel";

const row = Object.freeze({ market: "yerli", accountRef: "account_1", organizationCampaignRef: null, organizationCampaignName: "Kurum Kampanyası atanmadı", campaignRef: "campaign_1", adSetRef: null, accountName: "Ana hesap", campaignName: "Kampanya A", adSetName: null, currentBudgetMinor: 12000, budgetOwner: "campaign", budgetOwnerRef: "campaign_1", spendMinor: 3400, primaryResultState: "unbound", primaryResult: null, primaryResultCostMinor: null, sourceState: "partial", missingDays: ["2026-08-17"], reasonCodes: ["insight_missing"] });
const projection = Object.freeze({ version: "operation-read/1.0.0", period: { startDate: "2026-08-11", endDate: "2026-08-17" }, state: "partial", rows: [row, { ...row, adSetRef: "ad_set_1", adSetName: "Set A", budgetOwner: "ad_set", budgetOwnerRef: "ad_set_1" }], budgetOwners: [{ ref: "campaign_1", currentBudgetMinor: 12000 }], authority: { canWriteMeta: false, canExecute: false, canApprove: false }, nextCursor: "operation_cursor_next" });

describe("operation table panel", () => {
  it("accepts only the closed canonical read contract", () => {
    const parsed = parseOperationTableProjection(projection);
    expect(parsed).toMatchObject({ state: "partial" });
    expect(parsed?.rows[0]).toMatchObject({ campaignName: "Kampanya A" });
    expect(parseOperationTableProjection({ ...projection, authority: { canWriteMeta: true, canExecute: false, canApprove: false } })).toBeNull();
    expect(parseOperationTableProjection({ ...projection, rows: [{ ...row, primaryResult: 3 }] })).toBeNull();
    expect(parseOperationTableProjection({ ...projection, period: { startDate: "2026-02-31", endDate: "2026-03-01" } })).toBeNull();
    expect(parseOperationTableProjection({ ...projection, period: { startDate: "2026-08-18", endDate: "2026-08-17" } })).toBeNull();
  });

  it("keeps the canonical campaign summary above its ad-set child", () => {
    const hierarchy = operationHierarchy(parseOperationTableProjection(projection)!.rows);
    expect(hierarchy).toHaveLength(1);
    expect([...hierarchy[0]!.campaigns.values()][0]).toMatchObject({ summary: { campaignName: "Kampanya A" }, adSets: [{ adSetName: "Set A" }] });
  });

  it("renders source gaps, unbound primary result and responsive card fallback without demo data", () => {
    const html = renderToStaticMarkup(createElement(OperationTableSurface, { state: { status: "ready", projection: parseOperationTableProjection(projection)! }, period: "7d", onPeriod: vi.fn(), onLoadMore: vi.fn(), onConnect: vi.fn(async () => true) }));
    expect(html).toContain("Ana sonuç seçilmedi");
    expect(html).toContain("Eksik gün: 2026-08-17");
    expect(html).toContain("Daha fazlasını yükle");
    expect(html).toContain("Meta yazma yetkisi yok");
    expect(html).toContain("Bütçe sahibi");
    expect(html).toContain("Para birimi doğrulanmadı");
    expect(html).not.toContain("Kılavuz / son karar");
    expect(html).not.toContain("TRY");
    expect(html).not.toContain("demo");
    const source = require("node:fs").readFileSync("src/app/dashboard/operation-table-panel.module.css", "utf8");
    expect(source).toContain("@media (max-width: 480px)");
    expect(source).toContain(".mobileCards { display: grid");
  });

  it("keeps ad-set-only scopes as ad-set facts and uses stable canonical hierarchy keys", () => {
    const adSetOnly = parseOperationTableProjection({ ...projection, rows: [{ ...row, adSetRef: "ad_set_only", adSetName: "Tek Set", budgetOwner: "ad_set", budgetOwnerRef: "ad_set_only" }] })!;
    const campaign = [...operationHierarchy(adSetOnly.rows)[0]!.campaigns.values()][0]!;
    expect(campaign.summary).toBeNull();
    expect(campaign.adSets[0]).toMatchObject({ adSetName: "Tek Set", campaignName: "Kampanya A" });
    const html = renderToStaticMarkup(createElement(OperationTableSurface, { state: { status: "ready", projection: adSetOnly }, period: "7d", onPeriod: vi.fn(), onLoadMore: vi.fn(), onConnect: vi.fn(async () => true) }));
    expect(html).toContain("Yalnız reklam seti kapsamı");
    expect(html).toContain("Reklam seti · Tek Set");
    const duplicateLabels = operationHierarchy([{ ...adSetOnly.rows[0]!, accountRef: "account_2", campaignRef: "campaign_2" }, { ...adSetOnly.rows[0]!, accountRef: "account_3", campaignRef: "campaign_3" }]);
    expect(duplicateLabels.map((group) => group.key)).toHaveLength(2);
  });

  it("prevents concurrent cursor replay and deduplicates a retried page", () => {
    const gate = new OperationPaginationGate();
    expect(gate.claim("operation_cursor_next")).toBe(true);
    expect(gate.claim("operation_cursor_next")).toBe(false);
    gate.complete();
    expect(gate.claim("operation_cursor_next")).toBe(false);
    expect(gate.claim("operation_cursor_other")).toBe(true);
    expect(operationAppendRows([row] as never, [row, { ...row, adSetRef: "ad_set_2", adSetName: "Set 2", budgetOwner: "ad_set", budgetOwnerRef: "ad_set_2" }] as never)).toHaveLength(2);
  });

  it("renders a canonical unavailable projection as an unavailable source, never a ready table", () => {
    const unavailable = parseOperationTableProjection({ ...projection, state: "unavailable", rows: [], budgetOwners: [], nextCursor: null })!;
    const state = operationProjectionReadState(unavailable);
    expect(state).toMatchObject({ status: "unavailable" });
    const html = renderToStaticMarkup(createElement(OperationTableSurface, { state, period: "7d", onPeriod: vi.fn(), onLoadMore: vi.fn(), onConnect: vi.fn(async () => true) }));
    expect(html).toContain("Operasyon kaynağı kullanılamıyor");
    expect(html).not.toContain("Hiyerarşik operasyon tablosu");
  });
});
