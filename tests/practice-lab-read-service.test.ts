import { describe, expect, it } from "vitest";
import {
  PracticeLabReadError,
  PracticeLabReadService,
  type PracticeLabRepository,
} from "@/application/practice-lab-read-service";
import {
  appendAdvisedPracticeEvent,
  createAdvisedPracticeDefinition,
  type AdvisedPracticeDefinition,
  type AdvisedPracticeEvent,
} from "@/domain/guidance/advised-practice";

function practice(
  workspaceRef = "workspace_alpha",
  practiceRef = "practice_geo_stability",
  problem = "Korunan bölgede erken bütçe transferini önle",
) {
  const definition = createAdvisedPracticeDefinition({
    workspaceRef,
    practiceRef,
    problem,
    requiredInputs: ["metric_cost", "metric_volume"],
    steps: ["Veri yeterliliğini kontrol et", "Koruma istisnasını değerlendir"],
    rationale: "Kısa dönem maliyet artışı stratejik taahhüdü tek başına bozmamalı",
    cadence: "Yedi gün gözlem ve değişiklik sonrası cooldown",
    exceptions: ["Acil guardrail ihlali"],
    confidence: 0.72,
    scope: {
      kind: "bounded", accountRefs: ["account_main"], objectives: ["OUTCOME_LEADS"],
      internalCategoryRefs: ["category_protected_geo"], entities: [], topics: ["budget", "geo"],
    },
    provenance: {
      conversationRef: "conversation_august",
      ownerSource: {
        sourceRef: "source_owner_geo", ownerRef: "operator_owner", capturedAt: "2026-08-07T10:00:00.000Z",
        statementHash: "a".repeat(64),
      },
      metaSources: [{
        sourceRef: "source_meta_learning", sourceUrl: "https://www.facebook.com/business/help/learning",
        capturedAt: "2026-08-01T10:00:00.000Z", reviewedAt: "2026-08-02T10:00:00.000Z",
        reviewBy: "2026-11-02T10:00:00.000Z",
      }],
      evidenceRefs: ["evidence_cost_trend"],
      deliberation: { alignment: "conflicted", conflictRefs: ["conflict_efficiency"], rationale: "Owner koruması genel verimlilik yönüyle çatışıyor" },
    },
  });
  const candidate = appendAdvisedPracticeEvent(definition, [], {
    eventType: "candidate_created", occurredAt: "2026-08-07T11:00:00.000Z",
    payload: { origin: "agentic_conversation", createdByRef: "agent_local" },
  });
  const reviewed = appendAdvisedPracticeEvent(definition, candidate.history, {
    eventType: "reviewed", occurredAt: "2026-08-07T12:00:00.000Z",
    payload: { reviewerRef: "operator_owner", reviewNote: "Dar kapsamla deneme uygun" },
  });
  return { definition, history: reviewed.history };
}

function repository(record = practice()): PracticeLabRepository {
  return {
    listRefs: async () => [record.definition.practiceRef],
    load: async (ref) => ref === record.definition.practiceRef ? record : null,
  };
}

describe("Practice Lab public read service", () => {
  it("projects list/detail without private ids, hashes, or raw provenance refs", async () => {
    const service = new PracticeLabReadService(repository());
    const list = await service.list({ workspaceRef: "workspace_alpha" });
    const detail = await service.get({ workspaceRef: "workspace_alpha", practiceRef: "practice_geo_stability" });
    expect(list.items[0]).toMatchObject({
      state: "reviewed", outcomeStatus: null,
      scope: { internalCategories: ["category_protected_geo"], accountCount: 1, entityCount: 0 },
      sources: { ownerStatementPresent: true, officialMetaSourceCount: 1, evidenceCount: 1, alignment: "conflicted" },
      authority: { canPersistDraft: false, canPromotePolicy: false, canEnableAutomation: false, canExecuteWrite: false },
    });
    expect(detail.item.steps).toEqual(["Veri yeterliliğini kontrol et", "Koruma istisnasını değerlendir"]);
    expect(detail.item.sourceReview.officialMetaSources).toEqual([expect.objectContaining({ host: "www.facebook.com" })]);
    expect(detail.item.timeline.map((event) => event.stateAfter)).toEqual(["candidate", "reviewed"]);
    const serialized = JSON.stringify({ list, detail });
    expect(serialized).not.toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(serialized).not.toContain("source_owner_geo");
    expect(serialized).not.toContain("operator_owner");
    expect(serialized).not.toContain("conversation_august");
    expect(serialized).not.toContain("definitionHash");
    expect(serialized).not.toContain("eventId");
  });

  it("creates only an ephemeral conversation draft with all authority disabled", async () => {
    const result = await new PracticeLabReadService(repository()).prepareDraft({
      workspaceRef: "workspace_alpha", practiceRef: "practice_geo_stability",
    });
    expect(result.draft).toMatchObject({
      status: "ephemeral_unpersisted", requiredReview: "human", allowedOutcome: "conversation_draft_only",
    });
    expect(result.draft.collaborationQuestions).toHaveLength(3);
    expect(result.authority).toMatchObject({ canPersistDraft: false, canPromotePolicy: false, canAuthorizeAction: false });
  });

  it("keeps tenant scope fail-closed and rejects private material in public text", async () => {
    const service = new PracticeLabReadService(repository());
    await expect(service.get({ workspaceRef: "workspace_foreign", practiceRef: "practice_geo_stability" }))
      .rejects.toEqual(expect.objectContaining({ code: "scope_mismatch" }));

    const unsafe = practice("workspace_alpha", "practice_geo_stability", "internal 11111111-1111-4111-a111-111111111111");
    const definition = unsafe.definition as AdvisedPracticeDefinition;
    const unsafeRepository: PracticeLabRepository = {
      listRefs: async () => [definition.practiceRef],
      load: async () => ({ definition, history: unsafe.history as readonly AdvisedPracticeEvent[] }),
    };
    await expect(new PracticeLabReadService(unsafeRepository).get({
      workspaceRef: "workspace_alpha", practiceRef: definition.practiceRef,
    })).rejects.toBeInstanceOf(PracticeLabReadError);
  });

  it("uses bounded stable cursors and rejects malformed repository ordering", async () => {
    const first = practice();
    const second = practice("workspace_alpha", "practice_second");
    const records = new Map([
      [first.definition.practiceRef, first], [second.definition.practiceRef, second],
    ]);
    const service = new PracticeLabReadService({
      listRefs: async ({ after }) => after ? ["practice_second"] : ["practice_geo_stability", "practice_second"],
      load: async (ref) => records.get(ref) ?? null,
    });
    const page = await service.list({ workspaceRef: "workspace_alpha", limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    await expect(new PracticeLabReadService({
      listRefs: async () => ["practice_second", "practice_geo_stability"], load: async () => first,
    }).list({ workspaceRef: "workspace_alpha" })).rejects.toEqual(expect.objectContaining({ code: "unsafe_source" }));
  });
});
