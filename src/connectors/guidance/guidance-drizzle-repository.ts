import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  createGuidanceRegistry,
  type GuidanceBinding,
  type GuidanceCard,
  type GuidanceRegistry,
  type GuidanceSet,
  type GuidanceSource,
} from "@/domain/guidance/registry";

type ReklamZekaDatabase = NodePgDatabase<typeof schema>;
type GuidanceDatabase = Pick<ReklamZekaDatabase, "select" | "insert" | "execute" | "transaction">;

export class GuidanceRepositoryError extends Error {
  constructor(
    readonly code: "workspace_scope_mismatch" | "optimistic_conflict" | "invalid_evolution" | "corrupt_store",
    message: string,
  ) {
    super(message);
    this.name = "GuidanceRepositoryError";
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function recordHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function latest<T extends Readonly<{ version: number }>>(
  rows: readonly T[],
  identity: (row: T) => string,
): readonly T[] {
  const result = new Map<string, T>();
  for (const row of rows) {
    const key = identity(row);
    const current = result.get(key);
    if (!current || row.version > current.version) result.set(key, row);
  }
  return [...result.values()];
}

type Versioned = Readonly<{ id: string; version: number }>;

function assertCollectionEvolution<T extends Versioned>(
  label: string,
  current: readonly T[],
  next: readonly T[],
): void {
  const currentById = new Map(current.map((row) => [row.id, row] as const));
  const nextById = new Map(next.map((row) => [row.id, row] as const));
  if ([...currentById.keys()].some((id) => !nextById.has(id))) {
    throw new GuidanceRepositoryError("invalid_evolution", `${label} revision silinemez; archived version yazılmalıdır`);
  }
  for (const row of next) {
    const previous = currentById.get(row.id);
    if (!previous) {
      if (row.version !== 1) throw new GuidanceRepositoryError("invalid_evolution", `${label} ilk version 1 olmalıdır`);
      continue;
    }
    if (row.version === previous.version && recordHash(row) !== recordHash(previous)) {
      throw new GuidanceRepositoryError("invalid_evolution", `${label} aynı version içinde değiştirilemez`);
    }
    if (row.version < previous.version || row.version > previous.version + 1) {
      throw new GuidanceRepositoryError("invalid_evolution", `${label} version sırası kesintisiz artmalıdır`);
    }
  }
}

/** Pure guard used before append-only persistence. */
export function assertGuidanceRegistryEvolution(current: GuidanceRegistry, next: GuidanceRegistry): void {
  if (current.workspaceId !== next.workspaceId) {
    throw new GuidanceRepositoryError("workspace_scope_mismatch", "Guidance registry workspace kapsamı değiştirilemez");
  }
  assertCollectionEvolution("Source", current.sources, next.sources);
  assertCollectionEvolution("Card", current.cards, next.cards);
  assertCollectionEvolution("Binding", current.bindings, next.bindings);
  assertCollectionEvolution("Set", current.sets, next.sets);
}

function lifecycle(status: "draft" | "published" | "archived", now: Date) {
  return {
    publishedAt: status === "published" ? now : null,
    archivedAt: status === "archived" ? now : null,
  };
}

function setLifecycle(status: "draft" | "reviewed" | "archived", now: Date) {
  return {
    reviewedAt: status === "reviewed" ? now : null,
    archivedAt: status === "archived" ? now : null,
  };
}

function rowsOf(result: unknown): readonly Record<string, unknown>[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) return [];
  return result.rows as readonly Record<string, unknown>[];
}

async function assertWorkspace(database: GuidanceDatabase, workspaceId: string, lock: boolean): Promise<void> {
  const suffix = lock ? sql` for update` : sql``;
  const result = await database.execute(sql`
    select id from workspaces
    where id = ${workspaceId}::uuid and lifecycle_state = 'active'
    limit 1${suffix}
  `);
  if (rowsOf(result).length !== 1) {
    throw new GuidanceRepositoryError("workspace_scope_mismatch", "Guidance workspace aktif veya erişilebilir değil");
  }
}

async function loadRegistry(database: GuidanceDatabase, workspaceId: string): Promise<GuidanceRegistry> {
  // Sequential reads are intentional: this helper also runs on a single
  // transaction client, where concurrent client.query calls are unsafe.
  const sourceRows = await database.select().from(schema.guidanceSources)
    .where(eq(schema.guidanceSources.workspaceId, workspaceId));
  const cardRows = await database.select().from(schema.guidanceCards)
    .where(eq(schema.guidanceCards.workspaceId, workspaceId));
  const bindingRows = await database.select().from(schema.guidanceBindings)
    .where(eq(schema.guidanceBindings.workspaceId, workspaceId));
  const setRows = await database.select().from(schema.guidanceSets)
    .where(eq(schema.guidanceSets.workspaceId, workspaceId));
  const sources: GuidanceSource[] = latest(sourceRows, (row) => row.sourceKey).map((row) => ({
    id: row.sourceKey,
    workspaceId: row.workspaceId,
    sourceType: row.sourceType as GuidanceSource["sourceType"],
    title: row.title,
    sourceRef: row.sourceRef,
    sourceUrl: row.sourceUrl,
    content: row.content,
    author: row.author,
    capturedAt: row.capturedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewBy: row.reviewBy?.toISOString() ?? null,
    status: row.status as GuidanceSource["status"],
    version: row.version,
  }));
  const cards: GuidanceCard[] = latest(cardRows, (row) => row.cardKey).map((row) => ({
    id: row.cardKey,
    workspaceId: row.workspaceId,
    sourceType: row.sourceType as GuidanceCard["sourceType"],
    sourceIds: row.sourceIds,
    title: row.title,
    body: row.body,
    rationale: row.rationale,
    strength: row.strength as GuidanceCard["strength"],
    topic: row.topic,
    decisionKey: row.decisionKey,
    positionKey: row.positionKey,
    authority: row.authority as GuidanceCard["authority"],
    status: row.status as GuidanceCard["status"],
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    ownerRef: row.ownerRef,
    version: row.version,
  }));
  const bindings: GuidanceBinding[] = latest(bindingRows, (row) => row.bindingKey).map((row) => ({
    id: row.bindingKey,
    workspaceId: row.workspaceId,
    cardId: row.cardKey,
    facet: row.facet as GuidanceBinding["facet"],
    value: row.value,
    entityType: row.entityType as GuidanceBinding["entityType"],
    mode: row.mode as GuidanceBinding["mode"],
    priority: row.priority,
    version: row.version,
  }));
  const sets: GuidanceSet[] = latest(setRows, (row) => row.setKey).map((row) => ({
    id: row.setKey,
    workspaceId: row.workspaceId,
    name: row.name,
    orderedCardIds: row.orderedCardIds,
    reviewStatus: row.reviewStatus as GuidanceSet["reviewStatus"],
    version: row.version,
  }));

  for (const [row, value] of [
    ...sourceRows.map((row) => [row, sources.find((value) => value.id === row.sourceKey && value.version === row.version)] as const),
    ...cardRows.map((row) => [row, cards.find((value) => value.id === row.cardKey && value.version === row.version)] as const),
    ...bindingRows.map((row) => [row, bindings.find((value) => value.id === row.bindingKey && value.version === row.version)] as const),
    ...setRows.map((row) => [row, sets.find((value) => value.id === row.setKey && value.version === row.version)] as const),
  ]) {
    // Historical rows need not be reconstructed into the current registry, but
    // every latest row must match its immutable payload hash.
    if (value && row.recordHash !== recordHash(value)) {
      throw new GuidanceRepositoryError("corrupt_store", "Guidance immutable record hash doğrulanamadı");
    }
  }
  return createGuidanceRegistry({ workspaceId, sources, cards, bindings, sets });
}

async function insertRegistry(database: GuidanceDatabase, registry: GuidanceRegistry): Promise<void> {
  const now = new Date();
  if (registry.sources.length > 0) await database.insert(schema.guidanceSources).values(registry.sources.map((source) => ({
    workspaceId: source.workspaceId,
    sourceKey: source.id,
    version: source.version,
    sourceType: source.sourceType,
    title: source.title,
    sourceRef: source.sourceRef,
    sourceUrl: source.sourceUrl,
    content: source.content,
    author: source.author,
    capturedAt: source.capturedAt ? new Date(source.capturedAt) : null,
    reviewedAt: source.reviewedAt ? new Date(source.reviewedAt) : null,
    reviewBy: source.reviewBy ? new Date(source.reviewBy) : null,
    status: source.status,
    ...lifecycle(source.status, now),
    recordHash: recordHash(source),
  }))).onConflictDoNothing();
  if (registry.cards.length > 0) await database.insert(schema.guidanceCards).values(registry.cards.map((card) => ({
    workspaceId: card.workspaceId,
    cardKey: card.id,
    version: card.version,
    sourceType: card.sourceType,
    sourceIds: card.sourceIds,
    title: card.title,
    body: card.body,
    rationale: card.rationale,
    strength: card.strength,
    topic: card.topic,
    decisionKey: card.decisionKey,
    positionKey: card.positionKey,
    authority: card.authority,
    status: card.status,
    effectiveFrom: card.effectiveFrom ? new Date(card.effectiveFrom) : null,
    effectiveTo: card.effectiveTo ? new Date(card.effectiveTo) : null,
    ownerRef: card.ownerRef,
    ...lifecycle(card.status, now),
    recordHash: recordHash(card),
  }))).onConflictDoNothing();
  if (registry.bindings.length > 0) await database.insert(schema.guidanceBindings).values(registry.bindings.map((binding) => ({
    workspaceId: binding.workspaceId,
    bindingKey: binding.id,
    version: binding.version,
    cardKey: binding.cardId,
    facet: binding.facet,
    value: binding.value,
    entityType: binding.entityType,
    mode: binding.mode,
    priority: binding.priority,
    recordHash: recordHash(binding),
  }))).onConflictDoNothing();
  if (registry.sets.length > 0) await database.insert(schema.guidanceSets).values(registry.sets.map((set) => ({
    workspaceId: set.workspaceId,
    setKey: set.id,
    version: set.version,
    name: set.name,
    orderedCardIds: set.orderedCardIds,
    reviewStatus: set.reviewStatus,
    ...setLifecycle(set.reviewStatus, now),
    recordHash: recordHash(set),
  }))).onConflictDoNothing();
}

/** Append-only, workspace-scoped persistence for the pure guidance registry. */
export class DrizzleGuidanceRegistryRepository {
  constructor(private readonly database: GuidanceDatabase) {}

  async load(workspaceId: string): Promise<GuidanceRegistry> {
    if (!workspaceId.trim()) throw new GuidanceRepositoryError("workspace_scope_mismatch", "Workspace ID zorunludur");
    await assertWorkspace(this.database, workspaceId, false);
    return loadRegistry(this.database, workspaceId);
  }

  async save(registry: GuidanceRegistry, guard: Readonly<{
    expectedRegistryHash: string | null;
  }>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; registryHash: string }>> {
    if (!registry.workspaceId.trim()) throw new GuidanceRepositoryError("workspace_scope_mismatch", "Workspace ID zorunludur");
    const validated = createGuidanceRegistry({
      workspaceId: registry.workspaceId,
      sources: registry.sources,
      cards: registry.cards,
      bindings: registry.bindings,
      sets: registry.sets,
    });
    if (validated.registryHash !== registry.registryHash) {
      throw new GuidanceRepositoryError("corrupt_store", "Guidance registry canonical hash doğrulanamadı");
    }
    return this.database.transaction(async (transaction) => {
      await assertWorkspace(transaction as GuidanceDatabase, validated.workspaceId, true);
      const current = await loadRegistry(transaction as GuidanceDatabase, validated.workspaceId);
      if (current.registryHash === validated.registryHash) {
        return { outcome: "unchanged", registryHash: current.registryHash } as const;
      }
      const expectedMatches = guard.expectedRegistryHash === null
        ? current.sources.length + current.cards.length + current.bindings.length + current.sets.length === 0
        : guard.expectedRegistryHash === current.registryHash;
      if (!expectedMatches) throw new GuidanceRepositoryError("optimistic_conflict", "Guidance registry revision değişti");
      assertGuidanceRegistryEvolution(current, validated);
      await insertRegistry(transaction as GuidanceDatabase, validated);
      const persisted = await loadRegistry(transaction as GuidanceDatabase, validated.workspaceId);
      if (persisted.registryHash !== validated.registryHash) {
        throw new GuidanceRepositoryError("optimistic_conflict", "Guidance registry atomik olarak doğrulanamadı");
      }
      return { outcome: "inserted", registryHash: persisted.registryHash } as const;
    });
  }
}
