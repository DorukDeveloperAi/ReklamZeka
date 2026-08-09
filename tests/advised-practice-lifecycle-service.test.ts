import { describe, expect, it, vi } from "vitest";
import { AdvisedPracticeLifecycleService } from "@/application/advised-practice-lifecycle-service";
import { advisedPracticeRevisionRef } from "@/connectors/guidance/advised-practice-drizzle-repository";
import { appendAdvisedPracticeEvent, createAdvisedPracticeDefinition } from "@/domain/guidance/advised-practice";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const principal = { actor: { userId }, workspaceId, workspaceRef: "workspace_alpha", readerRef: "operator_actor" } as const;

function reviewedRecord() {
  const definition = createAdvisedPracticeDefinition({ workspaceRef: "workspace_alpha", practiceRef: "practice_safe",
    problem: "Güvenli yaklaşımı doğrula", requiredInputs: ["metric_cost"], steps: ["Kontrol et"], rationale: "Kanıt gerekir",
    cadence: "Yedi gün", exceptions: [], confidence: 0.8,
    scope: { kind: "bounded", accountRefs: ["account_main"], objectives: [], internalCategoryRefs: [], entities: [], topics: [] },
    provenance: { conversationRef: "conversation_safe", ownerSource: { sourceRef: "source_owner", ownerRef: "operator_owner",
      capturedAt: "2026-08-01T00:00:00.000Z", statementHash: "a".repeat(64) }, metaSources: [{ sourceRef: "source_meta",
      sourceUrl: "https://www.facebook.com/business/help/learning", capturedAt: "2026-08-01T00:00:00.000Z",
      reviewedAt: "2026-08-02T00:00:00.000Z", reviewBy: "2026-12-01T00:00:00.000Z" }], evidenceRefs: ["evidence_one"],
      deliberation: { alignment: "aligned", conflictRefs: [], rationale: "Uyumlu" } } });
  let history = appendAdvisedPracticeEvent(definition, [], { eventType: "candidate_created", occurredAt: "2026-08-01T01:00:00.000Z",
    payload: { origin: "human_draft", createdByRef: "operator_owner" } }).history;
  history = appendAdvisedPracticeEvent(definition, history, { eventType: "reviewed", occurredAt: "2026-08-01T02:00:00.000Z",
    payload: { reviewerRef: "operator_owner", reviewNote: "Trial uygun" } }).history;
  history = appendAdvisedPracticeEvent(definition, history, { eventType: "trial_started", occurredAt: "2026-08-02T00:00:00.000Z",
    payload: { trialRef: "trial_one", effectiveContextRef: "context_one", analysisRef: "analysis_one",
      findingRefs: ["finding_one"], evidenceRefs: ["evidence_one"], hypothesis: "İyileşme bekleniyor" } }).history;
  history = appendAdvisedPracticeEvent(definition, history, { eventType: "outcome_recorded", occurredAt: "2026-08-10T00:00:00.000Z",
    payload: { trialRef: "trial_one", outcomeRef: "outcome_one", result: "validated", evidenceRefs: ["evidence_two"],
      observedAt: "2026-08-09T00:00:00.000Z", outcomeNote: "Doğrulandı" } }).history;
  history = appendAdvisedPracticeEvent(definition, history, { eventType: "standardization_reviewed", occurredAt: "2026-08-11T00:00:00.000Z",
    payload: { reviewerRef: "operator_owner", outcomeEventRef: history.at(-1)!.eventId,
      decomposition: [{ target: "feature", summary: "Veri kontrolü", sourceRefs: ["evidence_two"], artifactRef: null,
        promotionCapability: "disabled" }], reviewNote: "Decomposition tamam" } }).history;
  return { definition, history };
}

describe("AdvisedPractice lifecycle application boundary", () => {
  it("analyst complete review ardından yalnız candidate önerebilir", async () => {
    const before = reviewedRecord();
    const candidate = appendAdvisedPracticeEvent(before.definition, before.history, { eventType: "standardization_candidate",
      occurredAt: "2026-08-12T00:00:00.000Z", payload: { proposedByRef: principal.readerRef, proposedByRole: "analyst",
        reviewEventRef: before.history.at(-1)!.eventId, candidateNote: "İnsan teyidine hazır" } });
    const record = { definition: before.definition, history: candidate.history };
    const mutateLifecycle = vi.fn(async () => ({ record, revisionRef: advisedPracticeRevisionRef(record), auditAppended: true as const }));
    const service = new AdvisedPracticeLifecycleService({ mutateLifecycle }, [{ userId, workspaceId, role: "analyst" }]);
    const result = await service.mutate(principal, { operation: "propose_standardization", practiceRef: before.definition.practiceRef,
      expectedDefinitionVersion: 1, expectedRevisionRef: advisedPracticeRevisionRef(before), candidateNote: "İnsan teyidine hazır" });
    expect(result).toMatchObject({ state: "standardization_candidate", standardizationStatus: "candidate",
      auditAppended: true, authority: { canProposeStandardization: true, canStandardize: false,
        canPromotePolicy: false, canEnableAutomation: false, canAuthorizeAction: false, canWriteMeta: false } });
    expect(mutateLifecycle).toHaveBeenCalledWith(expect.objectContaining({ actorId: userId, actorRef: "operator_actor", role: "analyst" }));
  });

  it("analyst explicit payload gönderse bile standardize edemez", async () => {
    const mutateLifecycle = vi.fn();
    const service = new AdvisedPracticeLifecycleService({ mutateLifecycle }, [{ userId, workspaceId, role: "analyst" }]);
    await expect(service.mutate(principal, { operation: "standardize", practiceRef: "practice_safe", expectedDefinitionVersion: 1,
      expectedRevisionRef: `practice_revision_${"a".repeat(64)}`, decisionRef: "decision_one",
      confirmationNote: "Yetkisiz", humanConfirmation: "explicit" })).rejects.toMatchObject({ name: "AuthorizationError" });
    expect(mutateLifecycle).not.toHaveBeenCalled();
  });

  it("unknown operation'ı standardize dalına düşürmeden reddeder", async () => {
    const mutateLifecycle = vi.fn();
    const service = new AdvisedPracticeLifecycleService({ mutateLifecycle }, [{ userId, workspaceId, role: "owner" }]);
    await expect(service.mutate(principal, { operation: "auto_standardize", practiceRef: "practice_safe",
      expectedDefinitionVersion: 1, expectedRevisionRef: `practice_revision_${"a".repeat(64)}` } as never))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(mutateLifecycle).not.toHaveBeenCalled();
  });
});
