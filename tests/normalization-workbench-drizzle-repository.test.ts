import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { DrizzleNormalizationWorkbenchRepository } from
  "@/connectors/guidance/normalization-workbench-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const cardId = "44444444-4444-4444-8444-444444444444";
const setId = "55555555-5555-4555-8555-555555555555";
const dialect = new PgDialect();
const hash = (letter: string) => letter.repeat(64);

function database(input: Readonly<{ role?: string; sourceStatus?: string; sourceKey?: string; cardSourceIds?: readonly string[];
  setCards?: readonly string[] }>) {
  const statements: string[] = [];
  const execute = vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    const rendered = dialect.sqlToQuery(query); statements.push(rendered.sql);
    if (rendered.sql.includes("select id from workspaces")) return { rows: [{ id: workspaceId }] };
    if (rendered.sql.includes("select role::text from memberships")) return { rows: input.role === undefined ? [] : [{ role: input.role }] };
    if (rendered.sql.includes("from guidance_sources")) return { rows: [{ id: sourceId, source_key: input.sourceKey ?? "source_owner", version: 2,
      record_hash: hash("a"), status: input.sourceStatus ?? "draft" }] };
    if (rendered.sql.includes("from guidance_cards")) return { rows: [{ id: cardId, card_key: "guidance_owner", version: 3,
      record_hash: hash("b"), status: "draft", source_ids: input.cardSourceIds ?? [sourceId] }] };
    if (rendered.sql.includes("from guidance_sets")) return { rows: [{ id: setId, set_key: "guidance_set_owner", version: 4,
      record_hash: hash("c"), review_status: "draft", ordered_card_ids: input.setCards ?? [cardId] }] };
    return { rows: [] };
  });
  const db = { execute, transaction: vi.fn(async (callback: (transaction: { execute: typeof execute }) => unknown) => callback({ execute })) };
  return { db, statements };
}

const selection = { sourceRef: "source_owner", cardRef: "guidance_owner", setRef: "guidance_set_owner" };

describe("normalization workbench Drizzle repository", () => {
  it("keeps unresolved selection as a non-persistent needs_input preview", async () => {
    const fake = database({ role: "analyst" });
    const result = await new DrizzleNormalizationWorkbenchRepository(fake.db as never)
      .preview({ workspaceId, selection: { sourceRef: "source_owner" } });
    expect(result).toMatchObject({ disposition: "needs_input", missing: ["cardRef", "setRef"], selection: null });
    expect(fake.statements).toEqual([]);
  });

  it("pins the latest immutable source/card/set and never selects or returns raw source text", async () => {
    const fake = database({ role: "analyst" });
    const result = await new DrizzleNormalizationWorkbenchRepository(fake.db as never).preview({ workspaceId, selection });
    expect(result).toMatchObject({ disposition: "ready", selection: { sourceRef: "source_owner", sourceVersion: 2,
      cardRef: "guidance_owner", cardVersion: 3, setRef: "guidance_set_owner", setVersion: 4 },
      capabilities: { canPublish: false, canPromotePolicy: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    const rendered = fake.statements.join("\n");
    expect(rendered).toContain("for update");
    expect(rendered).not.toMatch(/content|raw_text|strict_instruction_policy|action_proposal/i);
  });

  it("appends a draft-only revision from selected refs plus structured answers", async () => {
    const fake = database({ role: "analyst" }); const repository = new DrizzleNormalizationWorkbenchRepository(fake.db as never);
    const preview = await repository.preview({ workspaceId, selection });
    if (preview.disposition !== "ready" || preview.selectionHash === null) throw new Error("fixture preview should resolve");
    await expect(repository.create({ workspaceId, workspaceRef: "workspace_primary", actorId, actorRef: "actor_analyst",
      role: "analyst", occurredAt: "2026-08-11T19:40:00.000Z", normalizationRef: "normalization_owner_guidance",
      expectedHeadHash: "GENESIS", expectedSelectionHash: preview.selectionHash, selection,
      answers: { normalizedGuidance: { title: "Bütçeyi koru", body: "Önce bağlamı incele.", topic: "budget", strength: "should" },
        assumptions: [{ assumptionRef: "assumption_context", text: "Kapsam seçilen guidance setidir." }],
        questions: [{ questionRef: "question_scope", prompt: "Kampanya kapsamı doğru mu?", required: true }] } }))
      .resolves.toMatchObject({ normalizationRef: "normalization_owner_guidance", revision: 1,
        capabilities: { canPublish: false, canPromotePolicy: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    const rendered = fake.statements.join("\n");
    expect(rendered).toContain("pg_advisory_xact_lock");
    expect(rendered).toContain("insert into normalization_workbench_revisions");
    expect(rendered).not.toMatch(/audit_events|strict_instruction_policy|meta_write|http|mcp/i);
  });

  it("rejects stale selection, broken provenance and revoked membership before append", async () => {
    const stale = database({ role: "analyst" });
    await expect(new DrizzleNormalizationWorkbenchRepository(stale.db as never).create({ workspaceId, workspaceRef: "workspace_primary",
      actorId, actorRef: "actor_analyst", role: "analyst", occurredAt: "2026-08-11T19:40:00.000Z",
      normalizationRef: "normalization_owner_guidance", expectedHeadHash: "GENESIS", expectedSelectionHash: hash("d"), selection,
      answers: { normalizedGuidance: { title: "Bütçe", body: "Bağlamı incele.", topic: "budget", strength: "should" }, assumptions: [], questions: [] } }))
      .rejects.toMatchObject({ code: "conflict" });
    expect(stale.statements.some((statement) => statement.includes("insert into normalization_workbench_revisions"))).toBe(false);
    const broken = database({ role: "analyst", cardSourceIds: [] });
    await expect(new DrizzleNormalizationWorkbenchRepository(broken.db as never).preview({ workspaceId, selection }))
      .resolves.toMatchObject({ disposition: "needs_input" });
    const revoked = database({});
    await expect(new DrizzleNormalizationWorkbenchRepository(revoked.db as never).create({ workspaceId, workspaceRef: "workspace_primary",
      actorId, actorRef: "actor_analyst", role: "analyst", occurredAt: "2026-08-11T19:40:00.000Z",
      normalizationRef: "normalization_owner_guidance", expectedHeadHash: "GENESIS", expectedSelectionHash: hash("a"), selection,
      answers: { normalizedGuidance: { title: "Bütçe", body: "Bağlamı incele.", topic: "budget", strength: "should" }, assumptions: [], questions: [] } }))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(revoked.statements.some((statement) => statement.includes("insert into normalization_workbench_revisions"))).toBe(false);
  });
});
