import { describe, expect, it } from "vitest";
import {
  AutonomyValveError,
  buildActionPlan,
  type ActionValveContext,
  type AutonomyRule,
  type TypedActionIntent,
} from "@/domain/actions/autonomy-valve";

const NOW = "2026-08-07T16:00:00.000Z";

function rule(overrides: Partial<AutonomyRule> = {}): AutonomyRule {
  return {
    ruleRef: "autonomy_workspace",
    workspaceRef: "workspace_alpha",
    scope: { level: "workspace", ref: "workspace_alpha" },
    mode: "approval_only",
    state: "published",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    expiresAt: null,
    killSwitch: false,
    maximumActionsPerRun: null,
    ...overrides,
  };
}

function context(overrides: Partial<ActionValveContext> = {}): ActionValveContext {
  return {
    workspaceRef: "workspace_alpha",
    accountGroupRef: "account_group_health",
    accountRef: "account_main",
    internalCategoryRefs: ["category_leads"],
    campaignRef: "campaign_leads_tr",
    entity: { level: "campaign", ref: "campaign_leads_tr" },
    evaluatedAt: NOW,
    rules: [rule()],
    budgetLimits: null,
    protection: {
      protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [],
      changeDisposition: "allowed", policyRefs: [],
    },
    ...overrides,
  };
}

function status(toStatus: "ACTIVE" | "PAUSED" = "PAUSED"): TypedActionIntent {
  return {
    kind: "status_change", entity: { level: "campaign", ref: "campaign_leads_tr" },
    fromStatus: toStatus === "PAUSED" ? "ACTIVE" : "PAUSED", toStatus,
  };
}

function budget(afterDecimal = "90"): TypedActionIntent {
  return {
    kind: "budget_change", entity: { level: "campaign", ref: "campaign_leads_tr" },
    currency: "TRY", beforeDecimal: "100", afterDecimal, budgetOwnerRef: "campaign_leads_tr",
  };
}

const budgetLimits = {
  currency: "TRY", maximumAbsoluteDeltaDecimal: "20", maximumRelativeDeltaBasisPoints: 2_000,
  limitRefs: ["policy_budget_cap"],
} as const;

describe("typed action risk classification", () => {
  it.each([
    [{ kind: "no_change", entity: { level: "campaign", ref: "campaign_leads_tr" }, reasonRef: "reason_observe" }, "K0", "no_write"],
    [{ kind: "internal_annotation", entity: { level: "campaign", ref: "campaign_leads_tr" }, annotationRef: "annotation_review" }, "K1", "approval_required"],
    [status("PAUSED"), "K2", "approval_required"],
    [status("ACTIVE"), "K3", "approval_required"],
  ])("action'ı deterministik risk sınıfına ayırır", (intent, risk, disposition) => {
    expect(buildActionPlan(intent as TypedActionIntent, context())).toMatchObject({ risk, disposition });
  });

  it("campaign/adset budget decrease K2, increase K3 olur ve exact delta taşır", () => {
    expect(buildActionPlan(budget("90.000"), context({ budgetLimits }))).toMatchObject({
      actionType: "budget_decrease", risk: "K2",
      budgetDelta: { currency: "TRY", direction: "decrease", absoluteDecimal: "10" },
    });
    expect(buildActionPlan(budget("110.25"), context({ budgetLimits: { ...budgetLimits, maximumAbsoluteDeltaDecimal: "20.25" } }))).toMatchObject({
      actionType: "budget_increase", risk: "K3",
      budgetDelta: { direction: "increase", absoluteDecimal: "10.25" },
      disposition: "approval_required",
    });
  });

  it("existing-post promotion'ı frozen typed placeholder olarak K4 ve daima approval yapar", () => {
    const action: TypedActionIntent = {
      kind: "existing_post_promotion", entity: { level: "adset", ref: "adset_promotion" }, placeholderOnly: true,
      postRef: "post_existing", postContentHash: "a".repeat(64), actorRef: "actor_page",
      promotionTemplateVersionRef: "template_version_one", audiencePresetVersionRef: "audience_version_one",
      destinationRef: "destination_site", budgetPlanVersionRef: "budget_plan_one",
    };
    const plan = buildActionPlan(action, context({
      entity: { level: "adset", ref: "adset_promotion" },
      rules: [rule({ mode: "policy_limited", maximumActionsPerRun: 1 })],
    }));
    expect(plan).toMatchObject({ risk: "K4", disposition: "approval_required" });
    expect(plan.reasonCodes).toContain("human_approval_mandatory_for_risk");
  });

  it("ad-level budget ve raw Graph action biçimini şema sınırında reddeder", () => {
    expect(() => buildActionPlan({ ...budget(), entity: { level: "ad", ref: "ad_one" } } as never, context({ entity: { level: "ad", ref: "ad_one" } })))
      .toThrowError(expect.objectContaining({ code: "invalid_action" }));
    expect(() => buildActionPlan({ kind: "raw_graph", path: "/act_x/campaigns", field: "daily_budget" } as never, context()))
      .toThrowError(expect.objectContaining({ code: "invalid_action" }));
    expect(() => buildActionPlan({ ...budget(), budgetOwnerRef: "campaign_other" } as never, context({ budgetLimits })))
      .toThrowError(expect.objectContaining({ code: "invalid_action" }));
  });
});

describe("effective autonomy resolver", () => {
  it("workspace rule yokken mandated approval_only defaultunu uygular", () => {
    const plan = buildActionPlan(status(), context({ rules: [] }));
    expect(plan).toMatchObject({ effectiveAutonomy: "approval_only", disposition: "approval_required" });
    expect(plan.trace).toContainEqual(expect.objectContaining({ outcome: "workspace_default" }));
  });

  it("child scope workspace üst sınırını genişletmeye çalışırsa deny eder", () => {
    const child = rule({
      ruleRef: "autonomy_campaign_widen", scope: { level: "campaign", ref: "campaign_leads_tr" },
      mode: "policy_limited", maximumActionsPerRun: 1,
    });
    const plan = buildActionPlan(status(), context({ rules: [rule(), child] }));
    expect(plan).toMatchObject({ effectiveAutonomy: "denied", disposition: "denied" });
    expect(plan.trace).toContainEqual(expect.objectContaining({ ruleRef: "autonomy_campaign_widen", outcome: "widening_conflict" }));
  });

  it("expired policy-limited override ile otomatik genişlemez", () => {
    const expired = rule({
      ruleRef: "autonomy_action_expired", scope: { level: "action_type", actionType: "status_pause" },
      mode: "policy_limited", maximumActionsPerRun: 1, expiresAt: "2026-08-07T15:00:00.000Z",
    });
    const plan = buildActionPlan(status(), context({
      rules: [rule({ mode: "policy_limited", maximumActionsPerRun: 5 }), expired],
    }));
    expect(plan).toMatchObject({ effectiveAutonomy: "approval_only", disposition: "approval_required" });
    expect(plan.trace).toContainEqual(expect.objectContaining({ ruleRef: "autonomy_action_expired", outcome: "expired_fail_closed" }));
  });

  it("explicit kill switch'i tüm child kurallarından öncelikli tutar", () => {
    const kill = rule({
      ruleRef: "autonomy_account_kill", scope: { level: "account", ref: "account_main" },
      mode: "denied", killSwitch: true,
    });
    const plan = buildActionPlan(status(), context({
      rules: [rule({ mode: "policy_limited", maximumActionsPerRun: 5 }), kill],
    }));
    expect(plan).toMatchObject({ effectiveAutonomy: "denied", disposition: "denied" });
    expect(plan.trace).toContainEqual(expect.objectContaining({ outcome: "kill_switch" }));
  });

  it("aynı exact scope'taki çelişkili yayınları ambiguity olarak deny eder", () => {
    const first = rule({ ruleRef: "autonomy_account_one", scope: { level: "account", ref: "account_main" } });
    const second = rule({
      ruleRef: "autonomy_account_two", scope: { level: "account", ref: "account_main" },
      mode: "policy_limited", maximumActionsPerRun: 1,
    });
    const plan = buildActionPlan(status(), context({ rules: [rule(), first, second] }));
    expect(plan).toMatchObject({ effectiveAutonomy: "denied", disposition: "denied" });
    expect(plan.reasonCodes).toContain("autonomy_conflict_denied");
  });

  it("workspace rule scope ref'i context workspace ile birebir bağlı değilse reddeder", () => {
    const foreignScope = rule({ scope: { level: "workspace", ref: "workspace_other" } });
    expect(() => buildActionPlan(status(), context({ rules: [foreignScope] })))
      .toThrowError(expect.objectContaining({ code: "invalid_rule" }));
  });

  it("bounded K2 yalnız explicit policy/action cap ile candidate olabilir; execute yetkisi yine yoktur", () => {
    const actionPolicy = rule({
      ruleRef: "autonomy_pause_bounded", scope: { level: "action_type", actionType: "status_pause" },
      mode: "policy_limited", maximumActionsPerRun: 1,
    });
    const plan = buildActionPlan(status(), context({
      rules: [rule({ mode: "policy_limited", maximumActionsPerRun: 2 }), actionPolicy],
    }));
    expect(plan).toMatchObject({
      risk: "K2", effectiveAutonomy: "policy_limited", disposition: "policy_limited_candidate",
      capabilities: { canExecute: false, canWriteMeta: false, canGrantApproval: false, canAccessRawGraph: false },
    });
  });

  it("policy-limited action cap eksikse fail-closed deny eder", () => {
    const actionPolicy = rule({
      ruleRef: "autonomy_pause_uncapped", scope: { level: "action_type", actionType: "status_pause" },
      mode: "policy_limited", maximumActionsPerRun: null,
    });
    const plan = buildActionPlan(status(), context({ rules: [rule({ mode: "policy_limited", maximumActionsPerRun: 5 }), actionPolicy] }));
    expect(plan).toMatchObject({ disposition: "denied" });
    expect(plan.reasonCodes).toContain("action_type_policy_cap_missing");
  });

  it("tüm scope katmanlarını sıralı çözer ve en dar sonucu uygular", () => {
    const scoped = [
      rule({ mode: "policy_limited", maximumActionsPerRun: 10 }),
      rule({ ruleRef: "autonomy_group", scope: { level: "account_group", ref: "account_group_health" }, mode: "policy_limited", maximumActionsPerRun: 8 }),
      rule({ ruleRef: "autonomy_account", scope: { level: "account", ref: "account_main" }, mode: "policy_limited", maximumActionsPerRun: 6 }),
      rule({ ruleRef: "autonomy_category", scope: { level: "internal_category", ref: "category_leads" }, mode: "policy_limited", maximumActionsPerRun: 4 }),
      rule({ ruleRef: "autonomy_campaign", scope: { level: "campaign", ref: "campaign_leads_tr" }, mode: "policy_limited", maximumActionsPerRun: 3 }),
      rule({ ruleRef: "autonomy_entity", scope: { level: "entity", entityLevel: "campaign", ref: "campaign_leads_tr" }, mode: "policy_limited", maximumActionsPerRun: 2 }),
      rule({ ruleRef: "autonomy_action", scope: { level: "action_type", actionType: "status_pause" }, mode: "approval_only" }),
    ];
    const plan = buildActionPlan(status(), context({ rules: scoped }));
    expect(plan).toMatchObject({ effectiveAutonomy: "approval_only", disposition: "approval_required" });
    expect(plan.trace.map((item) => item.scopeKey)).toEqual([
      "workspace:workspace_alpha", "account_group:account_group_health", "account:account_main",
      "internal_category:category_leads", "campaign:campaign_leads_tr", "entity:campaign:campaign_leads_tr",
      "action_type:status_pause",
    ]);
  });
});

describe("budget and protection guardrails", () => {
  it.each([
    [null, "budget_cap_missing"],
    [{ ...budgetLimits, currency: "USD" }, "budget_cap_currency_mismatch"],
    [{ ...budgetLimits, maximumAbsoluteDeltaDecimal: "9" }, "maximum_absolute_budget_delta_exceeded"],
    [{ ...budgetLimits, maximumRelativeDeltaBasisPoints: 999 }, "maximum_relative_budget_delta_exceeded"],
  ])("missing/mismatched/exceeded cap ile planı deny eder", (limits, reason) => {
    const plan = buildActionPlan(budget(), context({ budgetLimits: limits as never }));
    expect(plan.disposition).toBe("denied");
    expect(plan.reasonCodes).toContain(reason);
  });

  it("protected category veya geo kararını input olarak ister ve deny/unresolved durumunu korur", () => {
    const plan = buildActionPlan(budget(), context({
      internalCategoryRefs: ["category_protected"], budgetLimits,
      protection: {
        protectedInternalCategoryRefs: ["category_protected"], affectedGeoRefs: ["geo_istanbul"],
        protectedGeoRefs: ["geo_istanbul"], changeDisposition: "denied", policyRefs: ["policy_geo_lock"],
      },
    }));
    expect(plan).toMatchObject({ disposition: "denied" });
    expect(plan.reasonCodes).toContain("protected_scope_denied");
  });

  it.each(["denied", "unresolved"] as const)(
    "K2+ protection disposition %s ise boş veya eşleşmeyen listelerle sessizce geçmez",
    (changeDisposition) => {
      const plan = buildActionPlan(status(), context({
        protection: {
          protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [],
          changeDisposition, policyRefs: ["policy_protection_check"],
        },
      }));
      expect(plan.disposition).toBe("denied");
      expect(plan.reasonCodes).toContain(changeDisposition === "denied" ? "protected_scope_denied" : "protected_scope_unresolved");
    },
  );

  it("zero baseline relative cap'i hesaplanabilir varsaymaz", () => {
    const plan = buildActionPlan(budget("90") as Extract<TypedActionIntent, { kind: "budget_change" }>, context({
      budgetLimits: { ...budgetLimits, maximumAbsoluteDeltaDecimal: "20" },
    }));
    expect(plan.disposition).toBe("approval_required");

    const zero = { ...budget("10"), beforeDecimal: "0" } as TypedActionIntent;
    const blocked = buildActionPlan(zero, context({ budgetLimits }));
    expect(blocked.reasonCodes).toContain("relative_budget_delta_undefined");
    expect(blocked.disposition).toBe("denied");
  });
});

describe("deterministic and non-executable output", () => {
  it("rule input orderinden bağımsız stable trace/hash üretir", () => {
    const account = rule({ ruleRef: "autonomy_account", scope: { level: "account", ref: "account_main" } });
    const action = status();
    const first = buildActionPlan(action, context({ rules: [account, rule()] }));
    const second = buildActionPlan(action, context({ rules: [rule(), account] }));
    expect(first).toEqual(second);
    expect(first.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.contextHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("output üzerinde execute/write/grant capability üretmez", () => {
    const plan = buildActionPlan(status("ACTIVE"), context());
    expect(plan.capabilities).toEqual({
      canExecute: false, canWriteMeta: false, canGrantApproval: false, canAccessRawGraph: false,
    });
    expect(JSON.stringify(plan)).not.toMatch(/access_token|graph\.facebook|executeKey|allowWrite/);
  });

  it("hatalarda raw action ayrıntısını yansıtmaz", () => {
    try {
      buildActionPlan({ kind: "raw_graph", secret: "do-not-reflect" } as never, context());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AutonomyValveError);
      expect((error as Error).message).toBe("Eylem planı güvenli biçimde değerlendirilemedi");
      expect((error as Error).message).not.toContain("do-not-reflect");
    }
  });
});
