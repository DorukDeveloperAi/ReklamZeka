import { describe, expect, it } from "vitest";
import { DrizzleAdvisedPracticeRepository } from "@/connectors/guidance/advised-practice-drizzle-repository";
import {
  AdvisedPracticeError,
  appendAdvisedPracticeEvent,
  createAdvisedPracticeDefinition,
  replayAdvisedPractice,
  reviseAdvisedPracticeDefinition,
  verifyAdvisedPracticeDefinition,
  verifyAdvisedPracticeHistory,
  type AdvisedPracticeDefinition,
  type AdvisedPracticeEvent,
} from "@/domain/guidance/advised-practice";

function input(overrides: Record<string, unknown> = {}) {
  return {
    workspaceRef: "workspace_alpha",
    practiceRef: "practice_geo_stability",
    problem: "Korunan bölgede pahalılaşma olduğunda erken bütçe transferini önle",
    requiredInputs: ["metric_cost", "metric_volume"],
    steps: ["Önce veri yeterliliğini kontrol et", "Sonra koruma istisnasını değerlendir"],
    rationale: "Kısa dönem maliyet artışı stratejik bölge taahhüdünü tek başına bozmamalı",
    cadence: "Minimum yedi gün gözlem ve değişiklik sonrası cooldown",
    exceptions: ["Acil guardrail ihlali"],
    confidence: 0.72,
    scope: {
      kind: "bounded" as const,
      accountRefs: ["account_main"], objectives: ["OUTCOME_LEADS"],
      internalCategoryRefs: ["category_protected_geo"], entities: [], topics: ["budget", "geo"],
    },
    provenance: {
      conversationRef: "conversation_august",
      ownerSource: {
        sourceRef: "source_owner_geo", ownerRef: "operator_owner",
        capturedAt: "2026-08-07T10:00:00.000Z", statementHash: "a".repeat(64),
      },
      metaSources: [{
        sourceRef: "source_meta_learning", sourceUrl: "https://www.facebook.com/business/help/learning",
        capturedAt: "2026-08-01T10:00:00.000Z", reviewedAt: "2026-08-02T10:00:00.000Z",
        reviewBy: "2026-11-02T10:00:00.000Z",
      }],
      evidenceRefs: ["evidence_cost_trend"],
      deliberation: { alignment: "conflicted" as const, conflictRefs: ["conflict_efficiency_protection"], rationale: "Owner koruması generic verimlilik yönüyle çatışıyor" },
    },
    ...overrides,
  };
}

function candidate(definition: AdvisedPracticeDefinition) {
  return appendAdvisedPracticeEvent(definition, [], {
    eventType: "candidate_created", occurredAt: "2026-08-07T11:00:00.000Z",
    payload: { origin: "agentic_conversation", createdByRef: "agent_local" },
  });
}

function reviewed(definition: AdvisedPracticeDefinition) {
  const first = candidate(definition);
  return appendAdvisedPracticeEvent(definition, first.history, {
    eventType: "reviewed", occurredAt: "2026-08-07T12:00:00.000Z",
    payload: { reviewerRef: "operator_owner", reviewNote: "Dar kapsamla deneme uygun" },
  });
}

function trial(definition: AdvisedPracticeDefinition) {
  const second = reviewed(definition);
  return appendAdvisedPracticeEvent(definition, second.history, {
    eventType: "trial_started", occurredAt: "2026-08-08T12:00:00.000Z",
    payload: {
      trialRef: "trial_geo_august", effectiveContextRef: "context_geo_august",
      analysisRef: "analysis_geo_august", findingRefs: ["finding_cost_rise"],
      evidenceRefs: ["evidence_cost_trend"], hypothesis: "Sabit bütçe gözlem penceresinde hacmi korur",
    },
  });
}

function outcome(definition: AdvisedPracticeDefinition, result: "validated" | "conditional" | "rejected") {
  const third = trial(definition);
  return appendAdvisedPracticeEvent(definition, third.history, {
    eventType: "outcome_recorded", occurredAt: "2026-08-20T12:00:00.000Z",
    payload: {
      trialRef: "trial_geo_august", outcomeRef: `outcome_${result}`,
      result, evidenceRefs: ["evidence_post_window"], observedAt: "2026-08-20T11:00:00.000Z",
      outcomeNote: `${result} sonuç kaydı`,
    },
  });
}

describe("advised practice definition", () => {
  it("owner + official Meta source + evidence + conflict deliberation ile replay-stable tanım üretir", () => {
    const definition = createAdvisedPracticeDefinition(input());
    expect(verifyAdvisedPracticeDefinition(definition)).toBe(true);
    expect(definition.capabilities).toEqual({
      canCreateGuidance: false, canPromotePolicy: false, canEnableAutomation: false, canAuthorizeAction: false,
    });
    expect(createAdvisedPracticeDefinition(input()).definitionHash).toBe(definition.definitionHash);
  });

  it("steps sırasını prosedür semantiği olarak korur ve sıralama değişince hash değişir", () => {
    const first = createAdvisedPracticeDefinition(input());
    const second = createAdvisedPracticeDefinition(input({ steps: [...first.steps].reverse() }));
    expect(first.steps).toEqual(["Önce veri yeterliliğini kontrol et", "Sonra koruma istisnasını değerlendir"]);
    expect(second.definitionHash).not.toBe(first.definitionHash);
  });

  it("revision zincirini kesintisiz ve exact scope içinde tutar", () => {
    const first = createAdvisedPracticeDefinition(input());
    const second = reviseAdvisedPracticeDefinition(first, input({ confidence: 0.8 }));
    expect(second.version).toBe(2);
    expect(second.previousDefinitionHash).toBe(first.definitionHash);
    expect(verifyAdvisedPracticeDefinition(second)).toBe(true);
    expect(() => reviseAdvisedPracticeDefinition(first, input({ workspaceRef: "workspace_foreign" })))
      .toThrowError(expect.objectContaining({ code: "invalid_revision" }));
  });

  it.each([
    ["missing owner", { provenance: { ...input().provenance, ownerSource: { ...input().provenance.ownerSource, ownerRef: "" } } }, "invalid_input"],
    ["missing Meta", { provenance: { ...input().provenance, metaSources: [] } }, "invalid_provenance"],
    ["missing evidence", { provenance: { ...input().provenance, evidenceRefs: [] } }, "invalid_input"],
    ["bogus URL", { provenance: { ...input().provenance, metaSources: [{ ...input().provenance.metaSources[0], sourceUrl: "https://user:pass@/bad#fragment" }] } }, "invalid_provenance"],
    ["credential URL", { provenance: { ...input().provenance, metaSources: [{ ...input().provenance.metaSources[0], sourceUrl: "https://user:pass@example.com/help" }] } }, "invalid_provenance"],
    ["non-Meta URL", { provenance: { ...input().provenance, metaSources: [{ ...input().provenance.metaSources[0], sourceUrl: "https://example.com/best-practice" }] } }, "invalid_provenance"],
    ["global with selectors", { scope: { ...input().scope, kind: "global" } }, "invalid_scope"],
    ["bounded empty", { scope: { kind: "bounded", accountRefs: [], objectives: [], internalCategoryRefs: [], entities: [], topics: [] } }, "invalid_scope"],
    ["extra key", { unexpected: true }, "invalid_input"],
    ["raw material", { rationale: "safe", rawPayload: { id: "x" } }, "invalid_input"],
    ["authority", { capabilities: { canPromotePolicy: true } }, "authority_escalation"],
  ])("%s girdisini fail-closed reddeder", (_label, patch, code) => {
    expect(() => createAdvisedPracticeDefinition(input(patch as Record<string, unknown>)))
      .toThrowError(expect.objectContaining({ code }));
  });

  it("forged definition hash veya extra field replay doğrulamasını geçemez", () => {
    const definition = createAdvisedPracticeDefinition(input());
    expect(verifyAdvisedPracticeDefinition({ ...definition, definitionHash: "b".repeat(64) })).toBe(false);
    expect(verifyAdvisedPracticeDefinition({ ...definition, surprise: true } as unknown as AdvisedPracticeDefinition)).toBe(false);
  });
});

describe("advised practice lifecycle", () => {
  it("repository tenant scope'unu constructor'da geçerli UUID'ye bağlar", () => {
    expect(() => new DrizzleAdvisedPracticeRepository({} as never, "workspace_arbitrary"))
      .toThrowError(expect.objectContaining({ code: "workspace_scope_mismatch" }));
  });

  it("candidate→reviewed→trial→validated→standardization review zincirini authority üretmeden tamamlar", () => {
    const definition = createAdvisedPracticeDefinition(input());
    const fourth = outcome(definition, "validated");
    const fifth = appendAdvisedPracticeEvent(definition, fourth.history, {
      eventType: "standardization_reviewed", occurredAt: "2026-08-21T12:00:00.000Z",
      payload: {
        reviewerRef: "operator_owner", outcomeEventRef: fourth.event.eventId,
        decomposition: [
          { target: "feature", summary: "Veri yeterliliği kontrolü", sourceRefs: ["evidence_post_window"], artifactRef: null, promotionCapability: "disabled" },
          { target: "analysis_agenda", summary: "Koruma çatışması sorusu", sourceRefs: ["conflict_efficiency_protection"], artifactRef: null, promotionCapability: "disabled" },
          { target: "policy", summary: "İleri dilimde ayrıca değerlendirilir", sourceRefs: ["source_owner_geo"], artifactRef: null, promotionCapability: "disabled" },
          { target: "human_judgment", summary: "Nihai transfer kararı", sourceRefs: ["source_owner_geo"], artifactRef: null, promotionCapability: "disabled" },
        ], reviewNote: "Yalnız düşük riskli parçalara ayrıldı",
      },
    });
    expect(fifth.state).toBe("standardization_reviewed");
    expect(fifth.event).toMatchObject({ policyPromotionCapability: "disabled", automationCapability: "disabled" });
    expect(replayAdvisedPractice(definition, fifth.history)).toMatchObject({
      outcomeStatus: "validated", standardizationReviewStatus: "reviewed",
    });
    expect(verifyAdvisedPracticeHistory(definition, fifth.history)).toBe(true);
  });

  it.each(["conditional", "rejected"] as const)("%s outcome'u kayıpsız korur ve standardization review'u açmaz", (result) => {
    const definition = createAdvisedPracticeDefinition(input());
    const fourth = outcome(definition, result);
    expect(replayAdvisedPractice(definition, fourth.history)).toMatchObject({
      state: result, outcomeStatus: result, standardizationReviewStatus: "not_reviewed",
    });
    expect(() => appendAdvisedPracticeEvent(definition, fourth.history, {
      eventType: "standardization_reviewed", occurredAt: "2026-08-21T12:00:00.000Z",
      payload: {
        reviewerRef: "operator_owner", outcomeEventRef: fourth.event.eventId,
        decomposition: [{ target: "guidance", summary: "x", sourceRefs: ["source_owner_geo"], artifactRef: null, promotionCapability: "disabled" }],
        reviewNote: "uygun değil",
      },
    })).toThrowError(expect.objectContaining({ code: "outcome_required" }));
  });

  it("outcome olmadan review, başka trial ref'i ve başka outcome event ref'ini reddeder", () => {
    const definition = createAdvisedPracticeDefinition(input());
    const third = trial(definition);
    expect(() => appendAdvisedPracticeEvent(definition, third.history, {
      eventType: "standardization_reviewed", occurredAt: "2026-08-20T12:00:00.000Z",
      payload: { reviewerRef: "operator_owner", outcomeEventRef: "practice_event_aaaaaaaaaaaaaaaaaaaa", decomposition: [], reviewNote: "x" },
    })).toThrowError(expect.objectContaining({ code: "outcome_required" }));
    expect(() => appendAdvisedPracticeEvent(definition, third.history, {
      eventType: "outcome_recorded", occurredAt: "2026-08-20T12:00:00.000Z",
      payload: {
        trialRef: "trial_foreign", outcomeRef: "outcome_foreign", result: "validated",
        evidenceRefs: ["evidence_post_window"], observedAt: "2026-08-20T11:00:00.000Z", outcomeNote: "x",
      },
    })).toThrowError(expect.objectContaining({ code: "invalid_transition" }));
    const fourth = outcome(definition, "validated");
    expect(() => appendAdvisedPracticeEvent(definition, fourth.history, {
      eventType: "standardization_reviewed", occurredAt: "2026-08-21T12:00:00.000Z",
      payload: {
        reviewerRef: "operator_owner", outcomeEventRef: "practice_event_aaaaaaaaaaaaaaaaaaaa",
        decomposition: [{ target: "feature", summary: "x", sourceRefs: ["evidence_post_window"], artifactRef: null, promotionCapability: "disabled" }],
        reviewNote: "x",
      },
    })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("conversation candidate'ını sessizce guidance/policy/automation'a çeviremez", () => {
    const definition = createAdvisedPracticeDefinition(input());
    const first = candidate(definition);
    expect(first.state).toBe("candidate");
    expect(definition.capabilities.canCreateGuidance).toBe(false);
    expect(definition.capabilities.canPromotePolicy).toBe(false);
    expect(definition.capabilities.canEnableAutomation).toBe(false);
    expect(() => appendAdvisedPracticeEvent(definition, first.history, {
      eventType: "standardized" as never, occurredAt: "2026-08-08T12:00:00.000Z", payload: {} as never,
    })).toThrow(AdvisedPracticeError);
  });

  it("history tamper, reordered evidence, extra field ve rollback'i doğrulamada yakalar", () => {
    const definition = createAdvisedPracticeDefinition(input());
    const third = trial(definition);
    const forgedHash = third.history.map((event, index) => index === 1 ? { ...event, eventHash: "f".repeat(64) } : event);
    expect(verifyAdvisedPracticeHistory(definition, forgedHash as AdvisedPracticeEvent[])).toBe(false);
    const extra = third.history.map((event, index) => index === 2 ? { ...event, surprise: true } : event);
    expect(verifyAdvisedPracticeHistory(definition, extra as AdvisedPracticeEvent[])).toBe(false);
    const rolledBack = third.history.slice(0, -1);
    expect(replayAdvisedPractice(definition, rolledBack).state).toBe("reviewed");
    expect(replayAdvisedPractice(definition, third.history).state).toBe("trial");
  });
});
