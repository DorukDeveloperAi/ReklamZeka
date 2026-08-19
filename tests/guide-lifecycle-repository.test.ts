import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalGuideWorkspaceRef, createGuideRevision } from "@/domain/guides/guide-revision";
import { canonicalGuideLifecycleJson, DrizzleGuideLifecycleRepository, GuideLifecycleRepositoryError } from "@/connectors/guides/guide-lifecycle-drizzle-repository";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const guideId = "22222222-2222-4222-a222-222222222222";
const revisionId = "33333333-3333-4333-a333-333333333333";
const revision = createGuideRevision({
  workspaceRef: canonicalGuideWorkspaceRef(workspaceId), guideRef: "guide_main", revision: 1, previousRevisionHash: null,
  sliceRef: "slice_main", market: "yerli", freeText: "Kanıtla değerlendir.",
  strict: { budgetRefs: [{ limitRef: "limit_budget", scopeKind: "organization_campaign" }], rollbackConditions: ["Sınırı aşma"], budgetInterpretation: null },
  schedule: { frequency: "daily", timezone: "Europe/Istanbul", localTime: "09:00" }, mode: "prepare_human_approval", actionAllowlist: ["budget_increase", "campaign_rename"],
});
const revisionRow = (overrides: Record<string, unknown> = {}) => ({
  guide_ref: revision.guideRef, revision_number: revision.revision, previous_revision_hash: revision.previousRevisionHash,
  slice_ref: revision.sliceRef, market_key: revision.market, free_text: revision.freeText, strict_payload: revision.strict,
  schedule_payload: revision.schedule, mode: revision.mode, revision_hash: revision.revisionHash,
  interpretation_hash: revision.interpretationHash, ...overrides,
});
const actionRows = () => revision.actionAllowlist.map((action) => ({ action, authority: revision.authority.autonomousActions.includes(action) ? "limited_autonomy" : "human_approval" }));
const budgetRows = () => revision.strict.budgetRefs.map((budget, index) => ({ budget_ref: budget.limitRef, scope_kind: budget.scopeKind, ordinal: index + 1 }));
const repository = (responses: readonly unknown[]) => {
  let index = 0;
  const database = { transaction: async <T>(callback: (tx: { execute: () => Promise<unknown> }) => Promise<T>) => callback({ execute: async () => responses[index++] }) };
  return new DrizzleGuideLifecycleRepository(database as never);
};
const load = (responses: readonly unknown[]) => repository(responses).loadCanonicalRevision({ workspaceId, guideId, revisionId });
const activationKey = (headVersion: number) => `guide_activation_${createHash("sha256").update([workspaceId, guideId, revision.revisionHash, String(headVersion)].join(":")).digest("hex")}`;

describe("guide lifecycle repository canonical persistence", () => {
  it("reconstructs the complete canonical revision from bounded children", async () => {
    await expect(load([{ rows: [revisionRow()] }, { rows: actionRows() }, { rows: budgetRows() }])).resolves.toEqual(revision);
  });

  it("fails closed on action tamper, budget missing/duplicate/order/cap, or hash mismatch", async () => {
    const corrupt = async (rows: readonly unknown[]) => await expect(load(rows)).rejects.toMatchObject({ code: "corrupt_store" });
    await corrupt([{ rows: [revisionRow()] }, { rows: [{ action: "budget_increase", authority: "human_approval" }] }, { rows: budgetRows() }]);
    await corrupt([{ rows: [revisionRow()] }, { rows: actionRows() }, { rows: [] }]);
    await corrupt([{ rows: [revisionRow()] }, { rows: actionRows() }, { rows: [{ ...budgetRows()[0], ordinal: 1 }, { ...budgetRows()[0], ordinal: 2 }] }]);
    await corrupt([{ rows: [revisionRow()] }, { rows: actionRows() }, { rows: [{ ...budgetRows()[0], ordinal: 2 }] }]);
    await corrupt([{ rows: [revisionRow()] }, { rows: actionRows() }, { rows: Array.from({ length: 65 }, (_, index) => ({ budget_ref: `limit_${index}`, scope_kind: "market", ordinal: index + 1 })) }]);
    await corrupt([{ rows: [revisionRow({ revision_hash: "a".repeat(64) })] }, { rows: actionRows() }, { rows: budgetRows() }]);
  });

  it("binds workspaceRef to a server-derived UUID reference and canonicalizes JSONB key order", () => {
    expect(canonicalGuideWorkspaceRef(workspaceId)).toBe(canonicalGuideWorkspaceRef(workspaceId));
    expect(() => canonicalGuideWorkspaceRef("workspace_client_claim")).toThrow();
    expect(canonicalGuideLifecycleJson({ b: [2, { z: true, a: null }], a: 1 })).toBe(canonicalGuideLifecycleJson({ a: 1, b: [2, { a: null, z: true }] }));
    expect(canonicalGuideLifecycleJson({ a: 1 })).not.toBe(canonicalGuideLifecycleJson({ a: 2 }));
  });

  it("keeps malformed caller and storage failure classes distinct", async () => {
    await expect(load([{ rows: [revisionRow({ market_key: "other" })] }, { rows: actionRows() }, { rows: budgetRows() }])).rejects.toBeInstanceOf(GuideLifecycleRepositoryError);
    const foreign = createGuideRevision({ workspaceRef: canonicalGuideWorkspaceRef("44444444-4444-4444-a444-444444444444"), guideRef: revision.guideRef, revision: 1, previousRevisionHash: null, sliceRef: revision.sliceRef, market: revision.market, freeText: revision.freeText, strict: revision.strict, schedule: revision.schedule, mode: revision.mode, actionAllowlist: revision.actionAllowlist });
    await expect(repository([]).createDraft({ workspaceId, actorId: "55555555-5555-4555-a555-555555555555", role: "owner", label: "Kılavuz", guide: foreign, sliceId: "66666666-6666-4666-a666-666666666666", sliceRevisionId: "77777777-7777-4777-a777-777777777777", marketDefinitionId: "88888888-8888-4888-a888-888888888888", occurredAt: "2026-08-17T12:00:00.000Z" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("accepts an exact interpretation retry but rejects an idempotency-key tamper", async () => {
    const actorId = "55555555-5555-4555-a555-555555555555";
    const base = [{ rows: [{ role: "owner" }] }, { rows: [{ interpretation_hash: revision.interpretationHash }] }, { rows: [] }];
    await expect(repository([...base, { rows: [{ accepted_by_actor_id: actorId, accepted_at: "2026-08-17T12:00:00.000Z" }] }]).acceptInterpretation({ workspaceId, actorId, role: "owner", guideId, revisionId, interpretationHash: revision.interpretationHash, occurredAt: "2026-08-17T12:00:00.000Z" })).resolves.toEqual({ accepted: true, created: false });
    await expect(repository([...base, { rows: [{ accepted_by_actor_id: actorId, accepted_at: "2026-08-17T12:01:00.000Z" }] }]).acceptInterpretation({ workspaceId, actorId, role: "owner", guideId, revisionId, interpretationHash: revision.interpretationHash, occurredAt: "2026-08-17T12:00:00.000Z" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("treats reordered jsonb event payloads as the same event but rejects changed payloads", async () => {
    const invoke = (existing: unknown) => {
      let call = 0;
      const eventTx = { execute: async () => ({ rows: call++ === 0 ? [] : [existing] }) };
      return (repository([]) as unknown as { event: (...args: unknown[]) => Promise<void> }).event(eventTx, workspaceId, guideId, revisionId, "paused", "55555555-5555-4555-a555-555555555555", "2026-08-17T12:00:00.000Z", { occurrence: "4", nested: { a: 1, b: 2 } });
    };
    await expect(invoke({ guide_id: guideId, guide_revision_id: revisionId, event_type: "paused", actor_id: "55555555-5555-4555-a555-555555555555", occurred_at: "2026-08-17T12:00:00.000Z", payload: { nested: { b: 2, a: 1 }, occurrence: "4" } })).resolves.toBeUndefined();
    await expect(invoke({ guide_id: guideId, guide_revision_id: revisionId, event_type: "paused", actor_id: "55555555-5555-4555-a555-555555555555", occurred_at: "2026-08-17T12:00:00.000Z", payload: { occurrence: "5", nested: { a: 1, b: 2 } } })).rejects.toMatchObject({ code: "conflict" });
  });

  it("verifies an existing activation outbox row exactly rather than accepting a tampered idempotency key", async () => {
    const actorId = "55555555-5555-4555-a555-555555555555";
    const common = [
      { rows: [{ role: "owner" }] },
      { rows: [{ latest_revision_id: revisionId, current_active_revision_id: null, version: 0 }] },
      { rows: [{ revision_hash: revision.revisionHash, interpretation_hash: revision.interpretationHash }] },
      { rows: [{ id: "99999999-9999-4999-a999-999999999999" }] },
      { rows: [{ version: 1 }] },
      { rows: [] },
    ];
    const activate = (existing: Record<string, unknown>) => repository([...common, { rows: [existing] }, { rows: [{ id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" }] }]).activate({ workspaceId, actorId, role: "owner", guideId, revisionId, expectedHeadVersion: 0, expectedCurrentRevisionId: null, occurredAt: "2026-08-17T12:00:00.000Z" });
    await expect(activate({ guide_id: guideId, guide_revision_id: revisionId, created_at: "2026-08-17T12:00:00.000Z" })).resolves.toMatchObject({ activated: true, idempotent: false });
    await expect(activate({ guide_id: guideId, guide_revision_id: revisionId, created_at: "2026-08-17T12:00:01.000Z" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("accepts only the exact activation retry and keeps reactivation occurrences distinct", async () => {
    const actorId = "55555555-5555-4555-a555-555555555555";
    const exact = (expectedHeadVersion: number, occurredAt: string, previousRevisionId: string | null = null) => {
      const key = activationKey(expectedHeadVersion);
      return [
        { rows: [{ role: "owner" }] },
        { rows: [{ latest_revision_id: revisionId, current_active_revision_id: revisionId, version: expectedHeadVersion + 1 }] },
        { rows: [{ revision_hash: revision.revisionHash }] },
        { rows: [{ guide_id: guideId, guide_revision_id: revisionId, created_at: occurredAt }] },
        { rows: [{ guide_id: guideId, guide_revision_id: revisionId, event_type: "activated", actor_id: actorId, occurred_at: occurredAt, payload: { activationKey: key, previousRevisionId } }] },
      ];
    };
    const input = (expectedHeadVersion: number, occurredAt: string, expectedCurrentRevisionId: string | null = null) => ({ workspaceId, actorId, role: "owner" as const, guideId, revisionId, expectedHeadVersion, expectedCurrentRevisionId, occurredAt });
    await expect(repository(exact(0, "2026-08-17T12:00:00.000Z")).activate(input(0, "2026-08-17T12:00:00.000Z"))).resolves.toMatchObject({ idempotent: true, activationKey: activationKey(0) });
    await expect(repository(exact(4, "2026-08-17T12:04:00.000Z")).activate(input(4, "2026-08-17T12:04:00.000Z"))).resolves.toMatchObject({ idempotent: true, activationKey: activationKey(4) });
    await expect(repository([{ rows: [{ role: "owner" }] }, { rows: [{ latest_revision_id: revisionId, current_active_revision_id: revisionId, version: 1 }] }]).activate(input(999, "2026-08-17T12:00:00.000Z"))).rejects.toMatchObject({ code: "conflict" });
    await expect(repository(exact(0, "2026-08-17T12:00:00.000Z")).activate(input(0, "2026-08-17T12:00:00.000Z", "44444444-4444-4444-a444-444444444444"))).rejects.toMatchObject({ code: "conflict" });
    await expect(repository(exact(0, "2026-08-17T12:00:00.000Z")).activate(input(0, "2026-08-17T12:00:01.000Z"))).rejects.toMatchObject({ code: "conflict" });
  });
});
