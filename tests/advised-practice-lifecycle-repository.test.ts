import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { advisedPracticeRevisionRef, DrizzleAdvisedPracticeRepository } from
  "@/connectors/guidance/advised-practice-drizzle-repository";
import { appendAdvisedPracticeEvent, createAdvisedPracticeDefinition } from "@/domain/guidance/advised-practice";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const actorId = "22222222-2222-4222-a222-222222222222";
const definitionId = "33333333-3333-4333-a333-333333333333";

function reviewedRecord() {
  const definition = createAdvisedPracticeDefinition({ workspaceRef: "workspace_alpha", practiceRef: "practice_repo",
    problem: "Yöntemi standardize et", requiredInputs: ["metric_cost"], steps: ["Kontrol et"], rationale: "Kanıt gerekli",
    cadence: "Yedi gün", exceptions: [], confidence: 0.8,
    scope: { kind: "bounded", accountRefs: ["account_main"], objectives: [], internalCategoryRefs: [], entities: [], topics: [] },
    provenance: { conversationRef: "conversation_repo", ownerSource: { sourceRef: "source_owner", ownerRef: "operator_owner",
      capturedAt: "2026-08-01T00:00:00.000Z", statementHash: "a".repeat(64) }, metaSources: [{ sourceRef: "source_meta",
      sourceUrl: "https://www.facebook.com/business/help/learning", capturedAt: "2026-08-01T00:00:00.000Z",
      reviewedAt: "2026-08-02T00:00:00.000Z", reviewBy: "2026-12-01T00:00:00.000Z" }], evidenceRefs: ["evidence_one"],
      deliberation: { alignment: "aligned", conflictRefs: [], rationale: "Uyumlu" } } });
  let history = appendAdvisedPracticeEvent(definition, [], { eventType: "candidate_created", occurredAt: "2026-08-01T01:00:00.000Z",
    payload: { origin: "human_draft", createdByRef: "operator_owner" } }).history;
  history = appendAdvisedPracticeEvent(definition, history, { eventType: "reviewed", occurredAt: "2026-08-01T02:00:00.000Z",
    payload: { reviewerRef: "operator_owner", reviewNote: "Trial uygun" } }).history;
  history = appendAdvisedPracticeEvent(definition, history, { eventType: "trial_started", occurredAt: "2026-08-02T00:00:00.000Z",
    payload: { trialRef: "trial_repo", effectiveContextRef: "context_repo", analysisRef: "analysis_repo",
      findingRefs: ["finding_one"], evidenceRefs: ["evidence_one"], hypothesis: "İyileşme" } }).history;
  history = appendAdvisedPracticeEvent(definition, history, { eventType: "outcome_recorded", occurredAt: "2026-08-10T00:00:00.000Z",
    payload: { trialRef: "trial_repo", outcomeRef: "outcome_repo", result: "validated", evidenceRefs: ["evidence_two"],
      observedAt: "2026-08-09T00:00:00.000Z", outcomeNote: "Doğrulandı" } }).history;
  history = appendAdvisedPracticeEvent(definition, history, { eventType: "standardization_reviewed", occurredAt: "2026-08-11T00:00:00.000Z",
    payload: { reviewerRef: "operator_owner", outcomeEventRef: history.at(-1)!.eventId,
      decomposition: [{ target: "feature", summary: "Kontrol", sourceRefs: ["evidence_two"], artifactRef: null,
        promotionCapability: "disabled" }], reviewNote: "Review tamam" } }).history;
  return { definition, history };
}

function definitionRow(definition: ReturnType<typeof reviewedRecord>["definition"]) {
  return { id: definitionId, workspaceId, workspaceRef: definition.workspaceRef, practiceRef: definition.practiceRef,
    version: definition.version, schemaVersion: definition.schemaVersion, previousDefinitionHash: definition.previousDefinitionHash,
    definitionHash: definition.definitionHash, payload: definition, createdAt: new Date("2026-08-01T00:00:00.000Z") };
}

function eventRows(record: ReturnType<typeof reviewedRecord>) {
  return record.history.map((event, index) => ({ id: `44444444-4444-4444-a444-${String(index + 1).padStart(12, "0")}`,
    workspaceId, definitionId, workspaceRef: event.workspaceRef, practiceRef: event.practiceRef,
    definitionVersion: event.definitionVersion, definitionHash: event.definitionHash, schemaVersion: event.schemaVersion,
    sequence: event.sequence, previousEventHash: event.previousEventHash, eventId: event.eventId, eventHash: event.eventHash,
    eventType: event.eventType, occurredAt: new Date(event.occurredAt), payload: event, createdAt: new Date(event.occurredAt) }));
}

function database(record: ReturnType<typeof reviewedRecord>, role: "owner" | "analyst" = "owner") {
  const executeResults: { rows: Record<string, unknown>[] }[] = [
    { rows: [{ id: workspaceId }] }, { rows: [{ role }] }, { rows: [] }, { rows: [] }, { rows: [] },
  ];
  let selectCount = 0;
  const tx = { execute: vi.fn(async (_query: unknown) => executeResults.shift()),
    select: vi.fn(() => { const rows = selectCount++ === 0 ? [definitionRow(record.definition)] : eventRows(record);
      return { from: () => ({ where: () => ({ orderBy: async () => rows }) }) }; }),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })) };
  return { tx, database: { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) } };
}

describe("DrizzleAdvisedPracticeRepository lifecycle mutation", () => {
  it("locks workspace, verifies OCC, appends event and audit in one transaction", async () => {
    const before = reviewedRecord(); const fake = database(before);
    const result = await new DrizzleAdvisedPracticeRepository(fake.database as never, workspaceId).mutateLifecycle({
      workspaceId, actorId, actorRef: "operator_owner", role: "owner", practiceRef: before.definition.practiceRef,
      expectedDefinitionVersion: 1, expectedRevisionRef: advisedPracticeRevisionRef(before),
      occurredAt: "2026-08-12T00:00:00.000Z", command: { operation: "propose_standardization", candidateNote: "Hazır" },
    });
    expect(result).toMatchObject({ auditAppended: true, record: { history: [expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), expect.anything(), { eventType: "standardization_candidate",
        proposedByRole: "owner", humanConfirmationRequired: true,
        capabilities: { canPromotePolicy: false, canEnableAutomation: false, canAuthorizeAction: false, canWriteMeta: false } }] } });
    expect(fake.database.transaction).toHaveBeenCalledOnce();
    expect(fake.tx.insert).toHaveBeenCalledOnce();
    const sqlText = fake.tx.execute.mock.calls.map((call) => new PgDialect().sqlToQuery(call[0] as never).sql).join("\n");
    expect(sqlText).toContain("for update");
    expect(sqlText).toContain("from memberships");
    expect(sqlText).toContain("insert into audit_events");
  });

  it("rejects stale revision before event/audit insertion", async () => {
    const before = reviewedRecord(); const fake = database(before);
    await expect(new DrizzleAdvisedPracticeRepository(fake.database as never, workspaceId).mutateLifecycle({
      workspaceId, actorId, actorRef: "operator_owner", role: "owner", practiceRef: before.definition.practiceRef,
      expectedDefinitionVersion: 1, expectedRevisionRef: `practice_revision_${"f".repeat(64)}`,
      occurredAt: "2026-08-12T00:00:00.000Z", command: { operation: "propose_standardization", candidateNote: "Stale" },
    })).rejects.toMatchObject({ code: "record_conflict" });
    expect(fake.tx.insert).not.toHaveBeenCalled();
    expect(fake.tx.execute).toHaveBeenCalledTimes(2);
  });

  it("rechecks membership role and blocks analyst standardization before loading practice", async () => {
    const before = reviewedRecord(); const fake = database(before, "analyst");
    await expect(new DrizzleAdvisedPracticeRepository(fake.database as never, workspaceId).mutateLifecycle({
      workspaceId, actorId, actorRef: "operator_analyst", role: "analyst", practiceRef: before.definition.practiceRef,
      expectedDefinitionVersion: 1, expectedRevisionRef: advisedPracticeRevisionRef(before),
      occurredAt: "2026-08-12T00:00:00.000Z", command: { operation: "standardize", decisionRef: "decision_forbidden",
        confirmationNote: "Yetkisiz" },
    })).rejects.toMatchObject({ code: "forbidden" });
    expect(fake.tx.select).not.toHaveBeenCalled();
  });
});
