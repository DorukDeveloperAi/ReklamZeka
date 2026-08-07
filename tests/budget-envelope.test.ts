import { describe, expect, it } from "vitest";
import {
  BudgetEnvelopeError,
  createBudgetEnvelope,
  quantizeBudgetAmount,
  reconcileCampaignBudget,
  type BudgetEnvelope,
  type CampaignBudgetReconciliationInput,
} from "@/domain/budget/budget-envelope";

const rounding = { scale: 2, mode: "half_even" as const };

function envelope(overrides: Record<string, unknown> = {}): BudgetEnvelope {
  return createBudgetEnvelope({
    envelopeRef: "budget_campaign_august",
    scope: { level: "campaign", ref: "campaign_leads_tr" },
    period: { kind: "calendar", startDate: "2026-08-01", endDate: "2026-08-31", timezone: "Europe/Istanbul" },
    currency: "TRY",
    rounding,
    totalDecimal: "1000",
    minimumDecimal: "500",
    maximumDecimal: "1500",
    fixedDecimal: "300",
    reserveDecimal: "100",
    ...overrides,
  } as never);
}

function reconciliation(overrides: Partial<CampaignBudgetReconciliationInput> = {}): CampaignBudgetReconciliationInput {
  return {
    envelope: envelope(),
    ownership: { mode: "CBO", campaignRef: "campaign_leads_tr" },
    totals: {
      plannedDecimal: "900", committedDecimal: "850", actualDecimal: "410.10", forecastDecimal: "925.20",
    },
    children: [
      {
        child: { level: "adset", ref: "adset_istanbul" }, currency: "TRY",
        budgetOwner: { level: "campaign", ref: "campaign_leads_tr" }, fixedDecimal: "300",
        state: { plannedDecimal: "500", committedDecimal: "450", actualDecimal: "210.05", forecastDecimal: "525.10" },
      },
      {
        child: { level: "adset", ref: "adset_bursa" }, currency: "TRY",
        budgetOwner: { level: "campaign", ref: "campaign_leads_tr" }, fixedDecimal: "0",
        state: { plannedDecimal: "400", committedDecimal: "400", actualDecimal: "200.05", forecastDecimal: "400.10" },
      },
    ],
    ...overrides,
  };
}

describe("budget envelope", () => {
  it("currency ve period sınırını, reserve ve allocatable ayrımını canonical decimal ile kurar", () => {
    expect(envelope()).toMatchObject({
      schemaVersion: "budget-envelope/1.0.0",
      currency: "TRY",
      totalDecimal: "1000.00",
      reserveDecimal: "100.00",
      allocatableDecimal: "900.00",
      fixedDecimal: "300.00",
      period: { startDate: "2026-08-01", endDate: "2026-08-31", timezone: "Europe/Istanbul" },
    });
  });

  it("binary floating point kullanmadan configurable rounding uygular", () => {
    expect(quantizeBudgetAmount("10.005", { scale: 2, mode: "half_even" })).toBe("10.00");
    expect(quantizeBudgetAmount("10.005", { scale: 2, mode: "half_up" })).toBe("10.01");
    expect(quantizeBudgetAmount("10.001", { scale: 2, mode: "up" })).toBe("10.01");
    expect(quantizeBudgetAmount("10.009", { scale: 2, mode: "down" })).toBe("10.00");
    expect(quantizeBudgetAmount("900719925474099312345.125", { scale: 2, mode: "half_even" }))
      .toBe("900719925474099312345.12");
  });

  it.each([
    ["currency", { currency: "try" }, "invalid_currency"],
    ["calendar date", { period: { kind: "custom", startDate: "2026-02-30", endDate: "2026-03-01", timezone: "UTC" } }, "invalid_period"],
    ["timezone", { period: { kind: "custom", startDate: "2026-02-01", endDate: "2026-03-01", timezone: "Mars/Olympus" } }, "invalid_period"],
    ["bounds", { totalDecimal: "1600" }, "invalid_envelope"],
    ["reserve", { reserveDecimal: "1100" }, "invalid_envelope"],
    ["fixed", { fixedDecimal: "950" }, "invalid_envelope"],
    ["negative", { reserveDecimal: "-1" }, "invalid_amount"],
  ])("geçersiz %s değerinde fail-closed davranır", (_label, patch, code) => {
    expect(() => envelope(patch)).toThrowError(expect.objectContaining({ code }));
  });

  it("rounding konfigürasyonu eksikse business default uydurmaz", () => {
    expect(() => createBudgetEnvelope({ ...envelope(), rounding: undefined } as never))
      .toThrowError(expect.objectContaining({ code: "invalid_contract" }));
  });
});

describe("campaign budget reconciliation", () => {
  it("planned/committed/actual/forecast ve reserve/fixed child toplamlarını ayrı uzlaştırır", () => {
    const result = reconcileCampaignBudget(reconciliation());
    expect(result.status).toBe("reconciled");
    expect(result.totals).toEqual({
      plannedDecimal: "900.00", committedDecimal: "850.00", actualDecimal: "410.10", forecastDecimal: "925.20",
    });
    expect(result.variance).toEqual({
      committedFromPlannedDecimal: "-50.00",
      actualFromPlannedDecimal: "-489.90",
      forecastFromPlannedDecimal: "25.20",
    });
    expect(result.children.map((item) => item.child.ref)).toEqual(["adset_bursa", "adset_istanbul"]);
  });

  it.each([
    ["under allocation", { totals: { plannedDecimal: "899", committedDecimal: "850", actualDecimal: "410.10", forecastDecimal: "925.20" } }, "allocation_mismatch"],
    ["over allocation", { totals: { plannedDecimal: "901", committedDecimal: "850", actualDecimal: "410.10", forecastDecimal: "925.20" } }, "allocation_mismatch"],
    ["over child allocation", { children: [
      reconciliation().children[0]!,
      { ...reconciliation().children[1]!, state: { ...reconciliation().children[1]!.state, plannedDecimal: "401" } },
    ] }, "allocation_mismatch"],
    ["fixed mismatch", { children: [
      { ...reconciliation().children[0]!, fixedDecimal: "299" }, reconciliation().children[1]!,
    ] }, "allocation_mismatch"],
    ["mixed currency", { children: [
      reconciliation().children[0]!, { ...reconciliation().children[1]!, currency: "USD" },
    ] }, "currency_mismatch"],
    ["duplicate", { children: [reconciliation().children[0]!, reconciliation().children[0]!] }, "duplicate_child"],
  ])("%s durumunu sonuç üretmeden reddeder", (_label, patch, code) => {
    expect(() => reconcileCampaignBudget(reconciliation(patch as Partial<CampaignBudgetReconciliationInput>)))
      .toThrowError(expect.objectContaining({ code }));
  });

  it("CBO campaign owner çözümünü zorunlu tutar", () => {
    const invalid = reconciliation({
      children: [{ ...reconciliation().children[0]!, budgetOwner: { level: "adset", ref: "adset_istanbul" } }, reconciliation().children[1]!],
    });
    expect(() => reconcileCampaignBudget(invalid))
      .toThrowError(expect.objectContaining({ code: "budget_owner_unresolved" }));
  });

  it("ABO'da her child ad seti kendi bütçe sahibi olmadan ve set tam çözülmeden ilerlemez", () => {
    const abo = reconciliation({
      ownership: { mode: "ABO", campaignRef: "campaign_leads_tr", adsetRefs: ["adset_istanbul", "adset_bursa"] },
      children: reconciliation().children.map((child) => ({
        ...child, budgetOwner: { level: "adset" as const, ref: child.child.ref },
      })),
    });
    expect(reconcileCampaignBudget(abo).ownership.mode).toBe("ABO");

    const missing = reconciliation({
      ownership: { mode: "ABO", campaignRef: "campaign_leads_tr", adsetRefs: ["adset_istanbul", "adset_bursa", "adset_ankara"] },
      children: abo.children,
    });
    expect(() => reconcileCampaignBudget(missing))
      .toThrowError(expect.objectContaining({ code: "budget_owner_unresolved" }));
  });

  it("rounding sonrası oluşan remainder'ı sessizce dağıtmaz", () => {
    const roundedEnvelope = envelope({ totalDecimal: "1", minimumDecimal: "0", maximumDecimal: "2", fixedDecimal: "0", reserveDecimal: "0" });
    const input = reconciliation({
      envelope: roundedEnvelope,
      totals: { plannedDecimal: "1", committedDecimal: "1", actualDecimal: "0", forecastDecimal: "1" },
      children: [
        {
          child: { level: "adset", ref: "adset_a" }, currency: "TRY", budgetOwner: { level: "campaign", ref: "campaign_leads_tr" }, fixedDecimal: "0",
          state: { plannedDecimal: "0.335", committedDecimal: "0.335", actualDecimal: "0", forecastDecimal: "0.335" },
        },
        {
          child: { level: "adset", ref: "adset_b" }, currency: "TRY", budgetOwner: { level: "campaign", ref: "campaign_leads_tr" }, fixedDecimal: "0",
          state: { plannedDecimal: "0.335", committedDecimal: "0.335", actualDecimal: "0", forecastDecimal: "0.335" },
        },
        {
          child: { level: "adset", ref: "adset_c" }, currency: "TRY", budgetOwner: { level: "campaign", ref: "campaign_leads_tr" }, fixedDecimal: "0",
          state: { plannedDecimal: "0.33", committedDecimal: "0.33", actualDecimal: "0", forecastDecimal: "0.33" },
        },
      ],
    });
    expect(() => reconcileCampaignBudget(input))
      .toThrowError(expect.objectContaining({ code: "allocation_mismatch" }));
  });

  it("0.10 + 0.20 toplamını exact units ile 0.30 olarak uzlaştırır", () => {
    const exactEnvelope = envelope({ totalDecimal: "0.30", minimumDecimal: "0", maximumDecimal: "1", fixedDecimal: "0", reserveDecimal: "0" });
    const input = reconciliation({
      envelope: exactEnvelope,
      totals: { plannedDecimal: "0.30", committedDecimal: "0.30", actualDecimal: "0.30", forecastDecimal: "0.30" },
      children: [
        {
          child: { level: "adset", ref: "adset_a" }, currency: "TRY", budgetOwner: { level: "campaign", ref: "campaign_leads_tr" }, fixedDecimal: "0",
          state: { plannedDecimal: "0.10", committedDecimal: "0.10", actualDecimal: "0.10", forecastDecimal: "0.10" },
        },
        {
          child: { level: "adset", ref: "adset_b" }, currency: "TRY", budgetOwner: { level: "campaign", ref: "campaign_leads_tr" }, fixedDecimal: "0",
          state: { plannedDecimal: "0.20", committedDecimal: "0.20", actualDecimal: "0.20", forecastDecimal: "0.20" },
        },
      ],
    });
    expect(reconcileCampaignBudget(input).totals.plannedDecimal).toBe("0.30");
  });

  it("hata mesajında tutar veya entity ayrıntısı sızdırmaz", () => {
    try {
      reconcileCampaignBudget(reconciliation({ totals: { ...reconciliation().totals, plannedDecimal: "1" } }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetEnvelopeError);
      expect((error as Error).message).toBe("Bütçe zarfı güvenli biçimde uzlaştırılamadı");
    }
  });
});
