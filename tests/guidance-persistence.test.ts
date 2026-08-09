import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  assertGuidanceRegistryEvolution,
  DrizzleGuidanceRegistryRepository,
  GuidanceRepositoryError,
} from "@/connectors/guidance/guidance-drizzle-repository";
import {
  guidanceBindings,
  guidanceCards,
  guidanceSets,
  guidanceSources,
} from "@/db/schema";
import {
  createGuidanceRegistry,
  type GuidanceBinding,
  type GuidanceCard,
  type GuidanceSet,
  type GuidanceSource,
} from "@/domain/guidance/registry";

const workspaceId = "11111111-1111-4111-a111-111111111111";

function source(version = 1, status: GuidanceSource["status"] = "published"): GuidanceSource {
  return {
    id: "owner-source",
    workspaceId,
    sourceType: "owner_statement",
    title: "Owner principle",
    sourceRef: "owner:statement:1",
    sourceUrl: null,
    content: "Regional budget remains protected.",
    author: "owner",
    capturedAt: "2026-08-01T09:00:00.000Z",
    reviewedAt: "2026-08-02T09:00:00.000Z",
    reviewBy: null,
    status,
    version,
  };
}

function card(version = 1, status: GuidanceCard["status"] = "published"): GuidanceCard {
  return {
    id: "budget-card",
    workspaceId,
    sourceType: "owner_statement",
    sourceIds: ["owner-source"],
    title: "Protect regional budget",
    body: "Do not transfer solely because another region is cheaper.",
    rationale: null,
    strength: "must",
    topic: "budget",
    decisionKey: "regional-transfer",
    positionKey: "hold",
    authority: "guidance_only",
    status,
    effectiveFrom: null,
    effectiveTo: null,
    ownerRef: "owner-1",
    version,
  };
}

function binding(version = 1): GuidanceBinding {
  return {
    id: "budget-card-global",
    workspaceId,
    cardId: "budget-card",
    facet: "global",
    value: null,
    entityType: null,
    mode: "default",
    priority: 50,
    version,
  };
}

function set(version = 1, reviewStatus: GuidanceSet["reviewStatus"] = "reviewed"): GuidanceSet {
  return {
    id: "default-set",
    workspaceId,
    name: "Default guidance",
    orderedCardIds: ["budget-card"],
    reviewStatus,
    version,
  };
}

function registry(input: Readonly<{
  source?: GuidanceSource;
  card?: GuidanceCard;
  binding?: GuidanceBinding;
  set?: GuidanceSet;
}> = {}) {
  return createGuidanceRegistry({
    workspaceId,
    sources: [input.source ?? source()],
    cards: [input.card ?? card()],
    bindings: [input.binding ?? binding()],
    sets: [input.set ?? set()],
  });
}

describe("guidance persistence schema", () => {
  it("uses four minimal workspace-owned version tables and a DB guidance-only guard", () => {
    expect([guidanceSources, guidanceCards, guidanceBindings, guidanceSets].map(getTableName)).toEqual([
      "guidance_sources", "guidance_cards", "guidance_bindings", "guidance_sets",
    ]);
    expect(getTableColumns(guidanceCards)).toMatchObject({
      workspaceId: expect.anything(),
      cardKey: expect.anything(),
      version: expect.anything(),
      authority: expect.anything(),
      sourceIds: expect.anything(),
      recordHash: expect.anything(),
    });
    const checks = getTableConfig(guidanceCards).checks.map((entry) => entry.name);
    expect(checks).toContain("guidance_cards_guidance_only_authority");
    expect(getTableConfig(guidanceSources).checks.map((entry) => entry.name))
      .toContain("guidance_sources_official_publish_evidence");
    const migration = readFileSync(
      new URL("../drizzle/20260807132400_robust_red_hulk.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain('"guidance_sources"."source_url" is not null');
    expect(migration).toContain('"guidance_bindings"."value" is not null');
  });

  it("keeps every guidance table fail-closed to Supabase Data API roles", () => {
    const migration = readFileSync(
      new URL("../drizzle/20260807132400_robust_red_hulk.sql", import.meta.url),
      "utf8",
    );
    for (const table of ["guidance_sources", "guidance_cards", "guidance_bindings", "guidance_sets"]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE "${table}" FROM PUBLIC, anon, authenticated`);
    }
  });
});

describe("append-only guidance evolution", () => {
  it("accepts a one-step version and rejects same-version mutation, gaps and omission", () => {
    const current = registry();
    const next = registry({
      source: source(2, "archived"),
      card: card(2, "archived"),
      binding: binding(2),
      set: set(2, "archived"),
    });
    expect(() => assertGuidanceRegistryEvolution(current, next)).not.toThrow();

    const mutated = registry({ card: { ...card(), body: "Changed without version." } });
    expect(() => assertGuidanceRegistryEvolution(current, mutated))
      .toThrowError(expect.objectContaining<Partial<GuidanceRepositoryError>>({ code: "invalid_evolution" }));

    const gap = registry({ binding: binding(3) });
    expect(() => assertGuidanceRegistryEvolution(current, gap))
      .toThrowError(expect.objectContaining<Partial<GuidanceRepositoryError>>({ code: "invalid_evolution" }));

    const omitted = createGuidanceRegistry({ workspaceId, sources: [source()], cards: [], bindings: [], sets: [] });
    expect(() => assertGuidanceRegistryEvolution(current, omitted))
      .toThrowError(expect.objectContaining<Partial<GuidanceRepositoryError>>({ code: "invalid_evolution" }));
  });

  it("commits a reviewed set revision, workspace invalidation and guidance-set audit in one transaction", async () => {
    const setRef = `guidance_set_${"a".repeat(24)}`;
    const sourceRef = `source_${"b".repeat(24)}`;
    const cardRef = `guidance_${"c".repeat(24)}`;
    const bindingRef = `binding_${"d".repeat(24)}`;
    const draftRegistry = createGuidanceRegistry({ workspaceId, sources: [{ ...source(), id: sourceRef,
      sourceRef: cardRef }], cards: [{ ...card(), id: cardRef, sourceIds: [sourceRef] }],
    bindings: [{ ...binding(), id: bindingRef, cardId: cardRef }], sets: [{ id: setRef, workspaceId,
      name: "Reviewed sequence", orderedCardIds: [cardRef], reviewStatus: "draft", version: 1 }] });
    const next = createGuidanceRegistry({ workspaceId, sources: draftRegistry.sources, cards: draftRegistry.cards,
      bindings: draftRegistry.bindings, sets: [{ ...draftRegistry.sets[0]!, reviewStatus: "reviewed", version: 2 }] });
    const stored = new Map<unknown, unknown[]>([[guidanceSources, []], [guidanceCards, []],
      [guidanceBindings, []], [guidanceSets, []]]);
    const dialect = new PgDialect();
    const statements: string[] = [];
    const tx = {
      select: () => ({ from: (table: unknown) => ({ where: async () => stored.get(table) ?? [] }) }),
      insert: (table: unknown) => ({ values: (values: unknown | unknown[]) => ({ onConflictDoNothing: async () => {
        stored.get(table)!.push(...(Array.isArray(values) ? values : [values]));
      } }) }),
      execute: vi.fn(async (query: never) => {
        const statement = dialect.sqlToQuery(query).sql;
        statements.push(statement);
        if (statement.includes("select id from workspaces")) return { rows: [{ id: workspaceId }] };
        if (statement.includes("insert into effective_campaign_context_invalidations")) {
          return { rows: [{ id: "22222222-2222-4222-8222-222222222222" }] };
        }
        return { rows: [] };
      }),
    };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    const repository = new DrizzleGuidanceRegistryRepository(database as never);
    const drafted = await repository.saveAudited(draftRegistry, {
      expectedRegistryHash: null, actorId: "33333333-3333-4333-8333-333333333333",
      action: "guidance_set.draft_created", resourceId: setRef, occurredAt: "2026-08-09T18:59:00.000Z",
      metadata: { version: 1, role: "owner", cardCount: 1 },
    });
    expect(drafted).toMatchObject({ outcome: "inserted", auditAppended: true,
      contextInvalidationAppended: false });
    const result = await repository.saveAudited(next, {
      expectedRegistryHash: draftRegistry.registryHash,
      actorId: "33333333-3333-4333-8333-333333333333",
      action: "guidance_set.reviewed", resourceId: setRef, occurredAt: "2026-08-09T19:00:00.000Z",
      metadata: { version: 2, role: "owner", cardCount: 1 },
    });
    expect(result).toMatchObject({ outcome: "inserted", auditAppended: true,
      contextInvalidationAppended: true });
    expect(database.transaction).toHaveBeenCalledTimes(2);
    expect(statements.join("\n")).toContain("insert into effective_campaign_context_invalidations");
    expect(statements.join("\n")).toContain("insert into audit_events");
    expect(stored.get(guidanceSets)).toEqual(expect.arrayContaining([
      expect.objectContaining({ setKey: setRef, version: 1, orderedCardIds: [cardRef], reviewStatus: "draft" }),
      expect.objectContaining({ setKey: setRef, version: 2, orderedCardIds: [cardRef], reviewStatus: "reviewed" }),
    ]));
  });
});
