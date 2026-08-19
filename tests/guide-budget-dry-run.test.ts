import { describe, expect, it } from "vitest";

import { dryRunGuideBudget, type BudgetScopeEvidence, type GuideBudgetDryRunInput } from "@/domain/guides/guide-budget-dry-run";

const hash = "a".repeat(64);
const evidence = (overrides: Record<string, unknown> = {}) => ({
  scopeLayer: "organization_campaign" as const, scopeRef: "organization_campaign_core", market: "yerli" as const, currency: "TRY",
  budgetOwnerRef: "campaign_core", budgetOwnerKind: "campaign" as const, budgetKind: "daily" as const, currentBudgetDecimal: "1000", freshness: "fresh" as const,
  observedAt: "2026-08-17T00:00:00.000Z", evidenceHash: hash, ...overrides,
});
const input = (overrides: Partial<GuideBudgetDryRunInput> = {}): GuideBudgetDryRunInput => ({
  targetScopeRef: "organization_campaign_core", market: "yerli" as const, currency: "TRY", targetCurrentBudgetDecimal: "1000",
  expression: { kind: "max" as const, operands: [
    { kind: "multiply" as const, operands: [{ kind: "scope_budget" as const, scopeRef: "organization_campaign_core" }, { kind: "decimal" as const, value: "0.1" }] },
    { kind: "money" as const, amountDecimal: "100", currency: "TRY" },
  ] as const }, scopeEvidence: [evidence()], constraints: [], ...overrides,
} as GuideBudgetDryRunInput);

describe("guide budget dry run v2", () => {
  it("BigInt ile max(scope budget * ratio, money) ifadesini ve sıfır write authority'yi hesaplar", () => {
    const result = dryRunGuideBudget(input());
    expect(result).toMatchObject({ status: "ready", evaluatedBudgetDecimal: "100", requestedDeltaDecimal: "-900", authority: { writeOperations: 0, canWriteMeta: false, canPersist: false } });
    expect(result.ownerEvidence).toHaveLength(1);
  });

  it("v1 expression uyumluluğunu korur", () => {
    const result = dryRunGuideBudget(input({ expression: { kind: "multiply", operands: [{ kind: "current_budget", scope: "related_organization_campaign" }, { kind: "decimal", value: "0.1" }] } }));
    expect(result.evaluatedBudgetDecimal).toBe("100");
  });

  it("v1 TRY amountMinor değerini major para değil kuruş/minor-unit olarak yorumlar", () => {
    const result = dryRunGuideBudget(input({ expression: { kind: "money", amountMinor: 101, currency: "TRY" } }));
    expect(result.evaluatedBudgetDecimal).toBe("1.01");
    expect(result.moneyRounding).toBe("half_even/1");
  });

  it("TRY minor-unit sonucunu explicit half-even ile canonical olarak yuvarlar", () => {
    const even = dryRunGuideBudget(input({ expression: { kind: "multiply", operands: [{ kind: "money", amountDecimal: "1.01", currency: "TRY" }, { kind: "decimal", value: "0.5" }] } }));
    const odd = dryRunGuideBudget(input({ expression: { kind: "multiply", operands: [{ kind: "money", amountDecimal: "1.03", currency: "TRY" }, { kind: "decimal", value: "0.5" }] } }));
    expect(even.evaluatedBudgetDecimal).toBe("0.5");
    expect(odd.evaluatedBudgetDecimal).toBe("0.52");
    expect(even.requestedDeltaDecimal).toBe("-999.5");
  });

  it("CBO owner'ını farklı scope satırlarında bir kez kanıtlar ve çelişkiyi hold eder", () => {
    const result = dryRunGuideBudget(input({ scopeEvidence: [evidence(), evidence({ scopeLayer: "campaign_ad_set", scopeRef: "campaign_adset_core", currentBudgetDecimal: "999", evidenceHash: "b".repeat(64) })] }));
    expect(result.ownerEvidence).toHaveLength(1);
    expect(result.holdReasons).toContain("conflicting_owner_budget:campaign_core");
  });

  it("stale, ceiling ve overlap kısıtlarında en kısıtlı sonucu hold eder", () => {
    const result = dryRunGuideBudget(input({
      expression: { kind: "money", amountDecimal: "1200", currency: "TRY" },
      scopeEvidence: [evidence({ freshness: "stale" })],
      constraints: [
        { guideRef: "guide_a", action: "budget_increase", allowed: true, requiresHumanApproval: false, maximumAbsoluteDeltaDecimal: "500", maximumRelativeDeltaBasisPoints: 3000, parentCeilingDecimal: "1100", guideMode: "prepare_human_approval", actionDisposition: "human_approval" },
        { guideRef: "guide_b", action: "budget_increase", allowed: false, requiresHumanApproval: true, maximumAbsoluteDeltaDecimal: "100", maximumRelativeDeltaBasisPoints: 1000, parentCeilingDecimal: "1050", guideMode: "prepare_human_approval", actionDisposition: "human_approval" },
      ],
    }));
    expect(result.status).toBe("held");
    expect(result.effectiveMaximumAbsoluteDeltaDecimal).toBe("100");
    expect(result.effectiveMaximumRelativeDeltaBasisPoints).toBe(1000);
    expect(result.effectiveParentCeilingDecimal).toBe("1050");
    expect(result.effectiveRequiresHumanApproval).toBe(true);
    expect(result.holdReasons).toEqual(expect.arrayContaining(["data_stale:organization_campaign_core", "maximum_absolute_delta_exceeded", "parent_ceiling_exceeded", "overlap_action_denied:guide_b"]));
  });

  it("para birimi veya Yerli/Yabancı sınırı taşan kanıtı değerlendirmeye katmaz", () => {
    const result = dryRunGuideBudget(input({ scopeEvidence: [evidence({ market: "yabanci", currency: "USD" })] }));
    expect(result.status).toBe("held");
    expect(result.holdReasons).toEqual(expect.arrayContaining([
      "market_boundary:organization_campaign_core",
      "currency_mismatch:organization_campaign_core",
      "expression_reference_unresolved_or_currency_mismatch",
    ]));
  });

  it("delta yönüne uymayan overlap kısıtını uygulamaz; sıfır baseline relative cap'i hold eder", () => {
    const decrease = dryRunGuideBudget(input({
      expression: { kind: "money", amountDecimal: "900", currency: "TRY" },
      constraints: [{ guideRef: "guide_increase_only", action: "budget_increase", allowed: false, requiresHumanApproval: true, maximumAbsoluteDeltaDecimal: "1", maximumRelativeDeltaBasisPoints: 1, parentCeilingDecimal: "1", guideMode: "prepare_human_approval", actionDisposition: "human_approval" }],
    }));
    expect(decrease.status).toBe("ready");
    expect(decrease.effectiveMaximumAbsoluteDeltaDecimal).toBeNull();
    const zero = dryRunGuideBudget(input({ targetCurrentBudgetDecimal: "0", expression: { kind: "money", amountDecimal: "1", currency: "TRY" }, constraints: [{ guideRef: "guide_limit", action: "budget_increase", allowed: true, requiresHumanApproval: false, maximumAbsoluteDeltaDecimal: null, maximumRelativeDeltaBasisPoints: 1, parentCeilingDecimal: null, guideMode: "prepare_human_approval", actionDisposition: "human_approval" }] }));
    expect(zero.holdReasons).toContain("maximum_relative_delta_zero_baseline");
  });

  it("minor-unit altındaki current budget'i bütün cap ve owner kanıtlarında aynı canonical sıfıra yuvarlar", () => {
    const result = dryRunGuideBudget(input({
      targetCurrentBudgetDecimal: "0.004",
      expression: { kind: "money", amountDecimal: "0.4", currency: "TRY" },
      scopeEvidence: [evidence({ currentBudgetDecimal: "0.004" })],
      constraints: [{
        guideRef: "guide_relative",
        action: "budget_increase",
        allowed: true,
        requiresHumanApproval: false,
        maximumAbsoluteDeltaDecimal: null,
        maximumRelativeDeltaBasisPoints: 1_000_000,
        parentCeilingDecimal: null,
        guideMode: "prepare_human_approval",
        actionDisposition: "human_approval",
      }],
    }));
    expect(result.currentBudgetDecimal).toBe("0");
    expect(result.ownerEvidence[0]?.currentBudgetDecimal).toBe("0");
    expect(result.requestedDeltaDecimal).toBe("0.4");
    expect(result.holdReasons).toContain("maximum_relative_delta_zero_baseline");
  });

  it("scope order ve sonradan input mutasyonu immutable sonucu değiştirmez", () => {
    const campaign = evidence({ scopeLayer: "campaign_ad_set", scopeRef: "campaign_core", budgetOwnerRef: "campaign_second", evidenceHash: "c".repeat(64) });
    const mutable = input({ scopeEvidence: [evidence(), campaign] });
    const first = dryRunGuideBudget(mutable);
    (mutable.scopeEvidence as BudgetScopeEvidence[]).reverse();
    const second = dryRunGuideBudget(mutable);
    expect(first.evidenceHash).toBe(second.evidenceHash);
    expect(first.dryRunHash).toBe(second.dryRunHash);
    expect(() => { (first.ownerEvidence as unknown as { push: () => void }).push(); }).toThrow();
    expect(Object.isFrozen(first.ownerEvidence[0]!.scopeRefs)).toBe(true);
  });

  it("target owner kanıtı, coherent freshness ve bounded expression olmadan fail-closed davranır", () => {
    const missingOwner = dryRunGuideBudget(input({ expression: { kind: "money", amountDecimal: "100", currency: "TRY" }, scopeEvidence: [evidence({ scopeRef: "organization_campaign_other" })] }));
    expect(missingOwner.holdReasons).toContain("target_owner_evidence_missing");
    expect(() => dryRunGuideBudget(input({ scopeEvidence: [evidence({ freshness: "missing", currentBudgetDecimal: "100" })] }))).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    let expression: unknown = { kind: "money", amountDecimal: "1", currency: "TRY" };
    for (let index = 0; index < 22; index += 1) expression = { kind: "max", operands: [expression, { kind: "money", amountDecimal: "1", currency: "TRY" }] };
    expect(() => dryRunGuideBudget(input({ expression: expression as never }))).toThrowError(expect.objectContaining({ code: "invalid_expression" }));
  });

  it("scope/owner prefixleri ile duplicate organization scope'u sessizce normalize etmez", () => {
    expect(() => dryRunGuideBudget(input({ scopeEvidence: [evidence({ budgetOwnerKind: "adset", budgetOwnerRef: "campaign_wrong" })] }))).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => dryRunGuideBudget(input({ scopeEvidence: [evidence({ scopeLayer: "market", scopeRef: "organization_campaign_wrong" })] }))).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    const duplicated = dryRunGuideBudget(input({ scopeEvidence: [evidence(), evidence({ evidenceHash: "d".repeat(64) })] }));
    expect(duplicated.holdReasons).toEqual(expect.arrayContaining(["ambiguous_scope_evidence:organization_campaign_core", "ambiguous_organization_campaign_scope"]));
  });

  it("taşan ara sonuç ve aşırı ratio digits için değerlendirme üretmez", () => {
    expect(() => dryRunGuideBudget(input({ expression: { kind: "multiply", operands: [{ kind: "money", amountDecimal: "999999999999999999999999999999", currency: "TRY" }, { kind: "decimal", value: "10" }] } }))).toThrowError(expect.objectContaining({ code: "invalid_expression" }));
    expect(() => dryRunGuideBudget(input({ expression: { kind: "multiply", operands: [{ kind: "money", amountDecimal: "1", currency: "TRY" }, { kind: "decimal", value: "1234567890123456789012345678901" }] } }))).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("CBO adset hedefini campaign owner'a çözer; ABO adset owner olarak kalır", () => {
    const common = {
      targetScopeRef: "adset_istanbul", targetCurrentBudgetDecimal: "1000", expression: { kind: "money" as const, amountDecimal: "900", currency: "TRY" },
      scopeEvidence: [evidence(), evidence({ scopeLayer: "campaign_ad_set", scopeRef: "adset_istanbul", budgetOwnerRef: "campaign_core", evidenceHash: "e".repeat(64) })],
    };
    const cbo = dryRunGuideBudget(input(common));
    expect(cbo.effectiveBudgetOwner).toEqual({ budgetOwnerRef: "campaign_core", budgetOwnerKind: "campaign" });
    const abo = dryRunGuideBudget(input({ ...common, scopeEvidence: [evidence(), evidence({ scopeLayer: "campaign_ad_set", scopeRef: "adset_istanbul", budgetOwnerRef: "adset_istanbul", budgetOwnerKind: "adset", evidenceHash: "f".repeat(64) })] }));
    expect(abo.effectiveBudgetOwner).toEqual({ budgetOwnerRef: "adset_istanbul", budgetOwnerKind: "adset" });
  });

  it("market enum ve observedAt canonical ISO sözleşmesini runtime'da da zorlar", () => {
    expect(() => dryRunGuideBudget(input({ scopeEvidence: [evidence({ market: "invalid" })] } as never))).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => dryRunGuideBudget(input({ scopeEvidence: [evidence({ observedAt: "2026-08-17T03:00:00+03:00" })] }))).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => dryRunGuideBudget(input({ scopeEvidence: [evidence({ observedAt: 123 as never })] }))).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("aynı input için deterministic immutable evidence hash üretir", () => {
    const one = dryRunGuideBudget(input()); const two = dryRunGuideBudget(input());
    expect(one.evidenceHash).toBe(two.evidenceHash);
    expect(one.dryRunHash).toBe(two.dryRunHash);
    expect(Object.isFrozen(one)).toBe(true);
  });
});
