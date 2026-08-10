import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { DrizzleProgressiveFormalizationRepository } from
  "@/connectors/guidance/progressive-formalization-drizzle-repository";
import { advanceProgressiveFormalization, createNormalizedPolicyDraft, NORMALIZED_POLICY_DRAFT_VERSION,
  PROGRESSIVE_FORMALIZATION_VERSION } from
  "@/domain/guidance/progressive-formalization";
import { parseStrictInstructionPolicy } from "@/domain/policies/instruction-policy-dsl";

const workspaceId = "11111111-1111-4111-8111-111111111111"; const actorId = "22222222-2222-4222-8222-222222222222";
const h = (value: string) => createHash("sha256").update(value).digest("hex");
const emptyRegistryHash = h("[]"); const dialect = new PgDialect();

function database(input: Readonly<{ revisions?: readonly unknown[]; sourceRows?: readonly Record<string, unknown>[];
  setRows?: readonly Record<string, unknown>[]; cardRows?: readonly Record<string, unknown>[] | (() => readonly Record<string, unknown>[]);
  policyRows?: readonly Record<string, unknown>[]; role?: string }>) {
  const revisions = [...(input.revisions ?? [])]; const statements: string[] = [];
  const execute = vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    const rendered = dialect.sqlToQuery(query); statements.push(rendered.sql);
    if (rendered.sql.includes("from progressive_formalization_revisions")) return { rows: revisions.map((revision) => ({
      formalization_ref: (revision as { formalizationRef: string }).formalizationRef,
      sequence: (revision as { sequence: number }).sequence, revision_payload: revision })) };
    if (rendered.sql.includes("select id from workspaces")) return { rows: [{ id: workspaceId }] };
    if (rendered.sql.includes("select role::text from memberships")) return { rows: input.role ? [{ role: input.role }] : [] };
    if (rendered.sql.includes("from guidance_sources")) return { rows: input.sourceRows ?? [] };
    if (rendered.sql.includes("from guidance_sets")) return { rows: input.setRows ?? [] };
    if (rendered.sql.includes("from guidance_cards")) return { rows: typeof input.cardRows === "function" ? input.cardRows() : input.cardRows ?? [] };
    if (rendered.sql.includes("from strict_instruction_policy_revisions")) return { rows: input.policyRows ?? [] };
    if (rendered.sql.includes("insert into progressive_formalization_revisions")) {
      const payload = rendered.params.find((value) => typeof value === "string" && value.startsWith('{"schemaVersion":"progressive-formalization'));
      revisions.push(JSON.parse(String(payload))); return { rows: [] };
    }
    if (rendered.sql.includes("select event_hash from audit_events")) return { rows: [] };
    return { rows: [] };
  });
  const db = { execute, transaction: vi.fn(async (callback: (transaction: { execute: typeof execute }) => unknown) => callback({ execute })) };
  return { db, revisions, statements };
}

describe("progressive formalization Drizzle repository", () => {
  it("captures G0 from the current source_key stream and derives its persisted source_ref and hash", async () => {
    const newest = "En yeni owner statement"; const fake = database({ role: "analyst", sourceRows: [
      { source_key: "source_owner_note", source_ref: "source_persisted_owner_note", version: 2, status: "draft", content: newest, record_hash: "a".repeat(64) },
      { source_key: "source_owner_note", source_ref: "source_old_owner_note", version: 1, status: "published", content: "old", record_hash: "b".repeat(64) },
    ] });
    const repo = new DrizzleProgressiveFormalizationRepository(fake.db as never);
    const result = await repo.mutate({ workspaceId, workspaceRef: "workspace_test", actorId, actorRef: "actor_analyst",
      role: "analyst", occurredAt: "2026-08-10T00:00:00.000Z", command: { operation: "capture_g0",
        expectedRegistryHash: emptyRegistryHash, rawProvenanceRef: "source_owner_note" } });
    expect(result.state.flows[0]?.revisions[0]?.payload).toEqual({ rawProvenanceRef: "source_persisted_owner_note", rawTextHash: h(newest) });
    expect(fake.statements.find((statement) => statement.includes("from guidance_sources")))
      .toMatch(/select source_key, source_ref, version, status, content, record_hash[\s\S]*source_key[\s\S]*order by version desc limit 2/);
    expect(fake.statements).toContainEqual(expect.stringContaining("insert into audit_events"));
  });

  it("rejects archived latest source and revoked same-transaction membership", async () => {
    const archived = database({ role: "analyst", sourceRows: [{ source_key: "source_owner_note", source_ref: "source_persisted_owner_note", version: 2,
      status: "archived", content: "archived", record_hash: "a".repeat(64) }] });
    await expect(new DrizzleProgressiveFormalizationRepository(archived.db as never).mutate({ workspaceId,
      workspaceRef: "workspace_test", actorId, actorRef: "actor_analyst", role: "analyst",
      occurredAt: "2026-08-10T00:00:00.000Z", command: { operation: "capture_g0",
        expectedRegistryHash: emptyRegistryHash, rawProvenanceRef: "source_owner_note" } }))
      .rejects.toMatchObject({ code: "not_found" });
    const revoked = database({ sourceRows: [] });
    await expect(new DrizzleProgressiveFormalizationRepository(revoked.db as never).mutate({ workspaceId,
      workspaceRef: "workspace_test", actorId, actorRef: "actor_analyst", role: "analyst",
      occurredAt: "2026-08-10T00:00:00.000Z", command: { operation: "capture_g0",
        expectedRegistryHash: emptyRegistryHash, rawProvenanceRef: "source_owner_note" } }))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(revoked.statements.some((statement) => statement.includes("insert into progressive_formalization_revisions"))).toBe(false);
  });

  it("records G2 only from the newest reviewed set with exact G1 card identity and owner confirmation", async () => {
    const g0 = advanceProgressiveFormalization(null, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION,
      transition: "capture_g0", workspaceRef: "workspace_test", formalizationRef: "formalization_test",
      occurredAt: "2026-08-10T00:00:00.000Z", actor: { actorRef: "actor_analyst", role: "analyst" },
      payload: { rawProvenanceRef: "source_owner_note", rawTextHash: h("raw") } });
    const g1 = advanceProgressiveFormalization(g0, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION,
      transition: "scope_g1", workspaceRef: "workspace_test", formalizationRef: "formalization_test",
      occurredAt: "2026-08-10T01:00:00.000Z", actor: { actorRef: "actor_analyst", role: "analyst" },
      payload: { guidanceCardRefs: ["guidance_owner_note"], scope: { global: true, accountGroupRefs: [],
        accountRefs: [], objectiveRefs: [], internalCategoryRefs: [], entityRefs: [], promotionTemplateRefs: [], topicRefs: [] } } });
    const fake = database({ role: "owner", revisions: [g0, g1], setRows: [
      { set_key: "guidance_set_test", version: 2, ordered_card_ids: ["guidance_owner_note"],
        record_hash: "c".repeat(64), review_status: "reviewed" },
      { set_key: "guidance_set_test", version: 1, ordered_card_ids: ["guidance_old"],
        record_hash: "d".repeat(64), review_status: "archived" },
    ], cardRows: [{ card_key: "guidance_owner_note", version: 7, status: "published", record_hash: "e".repeat(64) }] });
    const repo = new DrizzleProgressiveFormalizationRepository(fake.db as never); const state = await repo.inspect(workspaceId);
    const result = await repo.mutate({ workspaceId, workspaceRef: "workspace_test", actorId, actorRef: "actor_owner",
      role: "owner", occurredAt: "2026-08-10T02:00:00.000Z", command: { operation: "review_g2",
        expectedRegistryHash: state.registryHash, formalizationRef: "formalization_test", expectedHeadHash: g1.revisionHash,
        guidanceSetRef: "guidance_set_test", ownerConfirmation: { confirmed: true,
          confirmationRef: "confirmation_owner_g2" } } });
    expect(result.state.flows[0]?.level).toBe("G2");
    expect(result.state.flows[0]?.revisions[2]?.payload).toMatchObject({ guidanceSetRef: "guidance_set_test",
      reviewedGuidanceHash: expect.stringMatching(/^[a-f0-9]{64}$/), confirmation: { confirmed: true,
        confirmationRef: "confirmation_owner_g2", confirmedAt: "2026-08-10T02:00:00.000Z" } });
    expect(result.state.flows[0]?.revisions[2]?.payload).not.toMatchObject({ reviewedGuidanceHash: "c".repeat(64) });
  });

  it("invalidates G3/G4 guidance evidence when a reviewed card receives a newer published revision", async () => {
    const g0 = advanceProgressiveFormalization(null, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION,
      transition: "capture_g0", workspaceRef: "workspace_test", formalizationRef: "formalization_stale_cards",
      occurredAt: "2026-08-10T00:00:00.000Z", actor: { actorRef: "actor_owner", role: "owner" },
      payload: { rawProvenanceRef: "source_owner_note", rawTextHash: h("raw") } });
    const g1 = advanceProgressiveFormalization(g0, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION,
      transition: "scope_g1", workspaceRef: "workspace_test", formalizationRef: "formalization_stale_cards",
      occurredAt: "2026-08-10T01:00:00.000Z", actor: { actorRef: "actor_owner", role: "owner" },
      payload: { guidanceCardRefs: ["guidance_owner_note"], scope: { global: true, accountGroupRefs: [], accountRefs: [],
        objectiveRefs: [], internalCategoryRefs: [], entityRefs: [], promotionTemplateRefs: [], topicRefs: [] } } });
    let cards = [{ card_key: "guidance_owner_note", version: 1, status: "published", record_hash: "e".repeat(64) }];
    const fake = database({ role: "owner", revisions: [g0, g1], cardRows: () => cards, setRows: [{
      set_key: "guidance_set_test", version: 1, ordered_card_ids: ["guidance_owner_note"], record_hash: "c".repeat(64), review_status: "reviewed" }] });
    const repo = new DrizzleProgressiveFormalizationRepository(fake.db as never); const initial = await repo.inspect(workspaceId);
    await repo.mutate({ workspaceId, workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
      occurredAt: "2026-08-10T02:00:00.000Z", command: { operation: "review_g2", expectedRegistryHash: initial.registryHash,
        formalizationRef: "formalization_stale_cards", expectedHeadHash: g1.revisionHash, guidanceSetRef: "guidance_set_test",
        ownerConfirmation: { confirmed: true, confirmationRef: "confirmation_owner_g2" } } });
    const g2 = fake.revisions[2] as ReturnType<typeof advanceProgressiveFormalization>;
    const policy = parseStrictInstructionPolicy({ dslVersion: "strict-instruction-policy/1.0.0", workspaceRef: "workspace_test",
      policyRef: "policy_test", policyVersion: 1, previousVersionHash: null, policyType: "prohibition", owner: { actorRef: "actor_owner", role: "owner" },
      status: "draft", reasonCode: "owner_verified", priority: 1, effectiveDates: { from: "2026-08-10T00:00:00.000Z", until: null },
      scope: { global: true, accountGroupRefs: [], accountRefs: [], objectiveRefs: [], internalCategoryRefs: [], entities: [], topicRefs: [] },
      source: { rawProvenanceRef: "source_owner_note", rawTextHash: h("raw"), promotedFromGuidanceRefs: ["guidance_owner_note"] },
      clause: { kind: "prohibition", operations: ["budget_transfer"] } });
    const draft = createNormalizedPolicyDraft({ schemaVersion: NORMALIZED_POLICY_DRAFT_VERSION, workspaceRef: "workspace_test",
      formalizationRef: "formalization_stale_cards", guidanceSetRef: "guidance_set_test", strictPolicy: policy, assumptions: [], questions: [],
      semanticDiff: { status: "resolved", items: [{ meaningRef: "meaning_test", sourceStatementHash: "e".repeat(64), normalizedClauseRef: "policy_clause_test", disposition: "preserved", reasonCode: "exact_mapping" }], diffHash: h("diff") },
      historicalReplay: { status: "no_history", evaluatedRevisionRefs: [], changedOutcomeRefs: [], unknownOutcomeRefs: [], replayHash: h("replay") },
      conflictPreview: { status: "clear", conflictRefs: [], previewHash: h("conflict") }, impactPreview: { status: "complete", affectedScopeRefs: ["scope_global"], affectedEntityCount: 0, affectedPolicyCount: 0, affectedBudgetCount: 0, affectedAutomationCount: 0, unresolvedDependencyRefs: [], previewHash: h("impact") } });
    cards = [{ card_key: "guidance_owner_note", version: 2, status: "published", record_hash: "f".repeat(64) }];
    const previewG3 = await new DrizzleProgressiveFormalizationRepository(database({ role: "owner", revisions: fake.revisions,
      cardRows: () => cards, setRows: [{ set_key: "guidance_set_test", version: 1, ordered_card_ids: ["guidance_owner_note"], record_hash: "c".repeat(64), review_status: "reviewed" }],
      policyRows: [{ policy_payload: policy }] }).db as never).preview({ workspaceId, workspaceRef: "workspace_test", formalizationRef: "formalization_stale_cards", target: "G3", policyRef: "policy_test" });
    expect(previewG3).toMatchObject({ disposition: "blocked", evidence: { persistedGuidance: false } });
    expect(previewG3.blockers).toContain("reviewed_guidance_set_not_found");
    const g3 = advanceProgressiveFormalization(g2, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, transition: "promote_g3", workspaceRef: "workspace_test",
      formalizationRef: "formalization_stale_cards", occurredAt: "2026-08-10T03:00:00.000Z", actor: { actorRef: "actor_owner", role: "owner" },
      payload: { normalizedDraft: draft, confirmation: { confirmed: true, confirmationRef: "confirmation_owner_g3", confirmedAt: "2026-08-10T03:00:00.000Z" } } });
    fake.revisions.push(g3);
    const preview = await repo.preview({ workspaceId, workspaceRef: "workspace_test", formalizationRef: "formalization_stale_cards", target: "G4", policyRef: null });
    expect(preview).toMatchObject({ disposition: "blocked", evidence: { persistedGuidance: false } });
    expect(preview.blockers).toContain("reviewed_guidance_set_not_found");
  });
});
