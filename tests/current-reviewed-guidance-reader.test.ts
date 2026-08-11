import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  CurrentReviewedGuidanceReader,
  CurrentReviewedGuidanceReaderError,
} from "@/connectors/guidance/current-reviewed-guidance-reader";
import { buildEffectiveGuidancePack } from "@/domain/guidance/registry";

const workspaceId = "61b10d7d-132c-4c6d-b49f-cddc9b10d025";
const capturedAt = "2026-08-10T12:00:00.000Z";
const earlier = "2026-08-09T12:00:00.000Z";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function source(overrides: Record<string, unknown> = {}) {
  const value = { id: "source_primary", workspaceId, sourceType: "owner_statement", title: "Source", sourceRef: "source-ref-primary",
    sourceUrl: null, content: "A durable reviewed owner statement.", author: null, capturedAt: null, reviewedAt: null, reviewBy: null,
    status: "published", version: 1 };
  return { workspace_id: workspaceId, source_key: value.id, version: value.version, source_type: value.sourceType, title: value.title,
    source_ref: value.sourceRef, source_url: value.sourceUrl, content: value.content, author: value.author, captured_at: value.capturedAt,
    reviewed_at: value.reviewedAt, review_by: value.reviewBy, status: value.status, published_at: earlier, archived_at: null,
    record_hash: hash(value), created_at: earlier, ...overrides };
}

function card(overrides: Record<string, unknown> = {}) {
  const value = { id: "card_primary", workspaceId, sourceType: "owner_statement", sourceIds: ["source_primary"], title: "Card",
    body: "Use a scoped and reviewed approach.", rationale: null, strength: "should", topic: "quality", decisionKey: null,
    positionKey: null, authority: "guidance_only", status: "published", effectiveFrom: null, effectiveTo: null, ownerRef: "owner_primary", version: 1 };
  return { workspace_id: workspaceId, card_key: value.id, version: value.version, source_type: value.sourceType, source_ids: value.sourceIds,
    title: value.title, body: value.body, rationale: value.rationale, strength: value.strength, topic: value.topic,
    decision_key: value.decisionKey, position_key: value.positionKey, authority: value.authority, status: value.status,
    effective_from: value.effectiveFrom, effective_to: value.effectiveTo, owner_ref: value.ownerRef, published_at: earlier, archived_at: null,
    record_hash: hash(value), created_at: earlier, ...overrides };
}

function binding(overrides: Record<string, unknown> = {}) {
  const value = { id: "binding_primary", workspaceId, cardId: "card_primary", facet: "global", value: null, entityType: null,
    mode: "default", priority: 10, version: 1 };
  return { workspace_id: workspaceId, binding_key: value.id, version: value.version, card_key: value.cardId, facet: value.facet,
    value: value.value, entity_type: value.entityType, mode: value.mode, priority: value.priority, record_hash: hash(value), created_at: earlier,
    ...overrides };
}

function set(overrides: Record<string, unknown> = {}) {
  const value = { id: "set_primary", workspaceId, name: "Primary", orderedCardIds: ["card_primary"], reviewStatus: "reviewed", version: 1 };
  return { workspace_id: workspaceId, set_key: value.id, version: value.version, name: value.name, ordered_card_ids: value.orderedCardIds,
    review_status: value.reviewStatus, reviewed_at: earlier, archived_at: null, record_hash: hash(value), created_at: earlier, ...overrides };
}

function reader(input: Readonly<{
  sourceRows?: readonly Record<string, unknown>[];
  cardRows?: readonly Record<string, unknown>[];
  bindingRows?: readonly Record<string, unknown>[];
  setRows?: readonly Record<string, unknown>[];
  scopeRows?: readonly Record<string, unknown>[];
}> = {}) {
  const resultRows = [input.scopeRows ?? [{ workspace_id: workspaceId, database_now: capturedAt }], input.sourceRows ?? [source()],
    input.cardRows ?? [card()], input.bindingRows ?? [binding()], input.setRows ?? [set()]];
  const execute = vi.fn(async () => ({ rows: resultRows.shift() ?? [] }));
  return { execute, reader: new CurrentReviewedGuidanceReader() };
}

describe("CurrentReviewedGuidanceReader", () => {
  it("returns every exact reviewed-set/card/source manifest in the caller snapshot", async () => {
    const harness = reader();
    const result = await harness.reader.readCurrentInTransaction({ execute: harness.execute } as never, workspaceId, capturedAt);
    expect(result).toMatchObject({ capturedAt, reviewedSets: [{ setRef: "set_primary", setVersion: 1,
      cards: [{ cardRef: "card_primary", cardVersion: 1, sources: [{ sourceKey: "source_primary", sourceRef: "source-ref-primary", sourceVersion: 1 }] }] }] });
    expect(result.reviewedSets[0]!.setHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.registry.sets[0]).not.toHaveProperty("recordHash");
    expect(buildEffectiveGuidancePack(result.registry, { workspaceId, accountId: "account_primary", objective: null,
      optimization: null, internalCategoryIds: ["category_primary"], entity: { type: "campaign", id: "campaign_primary" },
      topics: ["quality"], requiredTopics: [], guidanceSetIds: ["set_primary"], evaluatedAt: capturedAt,
      budget: { maxCards: 10, maxSources: 10, maxCharacters: 1_000 } }).selectedSets[0]!.setHash).toBe(result.reviewedSets[0]!.setHash);
    expect(result.reviewedSets[0]!.cards[0]!.cardHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.reviewedSets[0]!.cards[0]!.sources[0]!.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect((harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n"))
      .toContain("distinct on (source_key)");
  });

  it.each([
    ["expired reviewed source", { sourceRows: [source({ review_by: earlier, record_hash: hash({
      id: "source_primary", workspaceId, sourceType: "owner_statement", title: "Source", sourceRef: "source-ref-primary", sourceUrl: null,
      content: "A durable reviewed owner statement.", author: null, capturedAt: null, reviewedAt: null, reviewBy: earlier, status: "published", version: 1,
    }) })] }, "stale"],
    ["unpublished current card", { cardRows: [card({ status: "draft", published_at: null, record_hash: hash({
      id: "card_primary", workspaceId, sourceType: "owner_statement", sourceIds: ["source_primary"], title: "Card", body: "Use a scoped and reviewed approach.",
      rationale: null, strength: "should", topic: "quality", decisionKey: null, positionKey: null, authority: "guidance_only", status: "draft",
      effectiveFrom: null, effectiveTo: null, ownerRef: "owner_primary", version: 1,
    }) })] }, "stale"],
    ["archived current card", { cardRows: [card({ status: "archived", archived_at: earlier, record_hash: hash({
      id: "card_primary", workspaceId, sourceType: "owner_statement", sourceIds: ["source_primary"], title: "Card", body: "Use a scoped and reviewed approach.",
      rationale: null, strength: "should", topic: "quality", decisionKey: null, positionKey: null, authority: "guidance_only", status: "archived",
      effectiveFrom: null, effectiveTo: null, ownerRef: "owner_primary", version: 1,
    }) })] }, "stale"],
    ["future source revision", { sourceRows: [source({ created_at: "2026-08-11T12:00:00.000Z" })] }, "future"],
    ["cross tenant source row", { sourceRows: [source({ workspace_id: "a3a32eea-4d33-4111-9552-a3c3a1234567" })] }, "corrupt_store"],
    ["tampered binding hash", { bindingRows: [binding({ record_hash: "a".repeat(64) })] }, "corrupt_store"],
    ["tampered set hash", { setRows: [set({ record_hash: "a".repeat(64) })] }, "corrupt_store"],
  ] as const)("fails closed on %s", async (_name, input, code) => {
    const harness = reader(input);
    await expect(harness.reader.readCurrentInTransaction({ execute: harness.execute } as never, workspaceId, capturedAt))
      .rejects.toEqual(expect.objectContaining<Partial<CurrentReviewedGuidanceReaderError>>({ code }));
  });

  it("rejects caller scope and snapshot drift before registry use", async () => {
    const harness = reader({ scopeRows: [{ workspace_id: workspaceId, database_now: "2026-08-10T12:00:00.001Z" }] });
    await expect(harness.reader.readCurrentInTransaction({ execute: harness.execute } as never, workspaceId, capturedAt))
      .rejects.toEqual(expect.objectContaining<Partial<CurrentReviewedGuidanceReaderError>>({ code: "ambiguous" }));
    await expect(harness.reader.readCurrentInTransaction({ execute: harness.execute } as never, "not-a-uuid", capturedAt))
      .rejects.toEqual(expect.objectContaining<Partial<CurrentReviewedGuidanceReaderError>>({ code: "invalid_input" }));
  });
});
