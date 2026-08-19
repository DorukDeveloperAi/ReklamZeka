import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { assertHashOnlyMetaPersistence } from "@/domain/meta/data-lifecycle";
import {
  diffMetaChangeSnapshots,
  type CanonicalMetaChangeSnapshot,
  type MetaActionLedgerRecord,
  type MetaChangeEvent,
  type MetaChangeField,
  type MetaChangeTimeline,
  type MetaComparableValue,
} from "@/domain/meta/snapshot-diff";

type ReklamZekaDatabase = NodePgDatabase<typeof schema>;

export type MetaChangePersistenceScope = Readonly<{
  workspaceId: string;
  connectionId: string;
  adAccountId: string;
}>;

type SafeSnapshotAggregate = Readonly<{
  entityCounts: Readonly<{ campaign: number; adSet: number; ad: number }>;
  knownFieldCount: number;
  unknownFieldCount: number;
}>;

export type MetaChangeSnapshotPersistenceRow = Readonly<{
  workspaceId: string;
  connectionId: string;
  adAccountId: string;
  publicRef: string;
  snapshotHash: string;
  schemaVersion: number;
  fieldCatalogVersion: string;
  capturedAt: string;
  canonicalPayload: CanonicalMetaChangeSnapshot;
  safeAggregate: SafeSnapshotAggregate;
}>;

export type MetaChangeEventPersistenceRow = Readonly<{
  workspaceId: string;
  connectionId: string;
  adAccountId: string;
  previousSnapshotId: string;
  currentSnapshotId: string;
  changeRef: string;
  entityRef: string;
  entityType: MetaChangeEvent["entityType"];
  field: MetaChangeField;
  beforeValue: MetaComparableValue;
  afterValue: MetaComparableValue;
  classification: MetaChangeEvent["classification"];
  correlatedActionRef: string | null;
  timelineHash: string;
  fieldCatalogVersion: string;
  occurredAt: string;
  detectedAt: string;
}>;

export type PersistedSnapshotIdentity = Readonly<{ id: string; publicRef: string; inserted: boolean }>;

export interface MetaChangeTimelinePersistenceTransaction {
  resolveExternalAccountId(scope: MetaChangePersistenceScope): Promise<string | null>;
  upsertSnapshot(row: MetaChangeSnapshotPersistenceRow): Promise<PersistedSnapshotIdentity>;
  appendEvents(rows: readonly MetaChangeEventPersistenceRow[]): Promise<number>;
}

export interface MetaChangeTimelinePersistenceStore {
  transaction<T>(work: (transaction: MetaChangeTimelinePersistenceTransaction) => Promise<T>): Promise<T>;
  loadLatestSnapshot(scope: MetaChangePersistenceScope): Promise<Readonly<{
    workspaceId: string;
    connectionId: string;
    adAccountId: string;
    externalAccountId: string;
    canonicalPayload: unknown;
  }> | null>;
}

export type MetaChangeTimelinePersistenceResult = Readonly<{
  previousSnapshotRef: string;
  currentSnapshotRef: string;
  timelineRef: string;
  insertedSnapshots: number;
  insertedEvents: number;
  eventCount: number;
  externalChangeCount: number;
  internalExpectedCount: number;
  replay: boolean;
}>;

export class MetaChangeTimelinePersistenceError extends Error {
  constructor(readonly code: "invalid_input" | "scope_mismatch" | "hash_mismatch" | "replay_conflict") {
    super("Meta değişim zaman çizelgesi güvenli biçimde kalıcılaştırılamadı");
    this.name = "MetaChangeTimelinePersistenceError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableJson(child)]));
  }
  return value;
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

function snapshotRef(snapshotHash: string): string {
  return `snapshot_${sha256(`snapshot:${snapshotHash}`).slice(0, 20)}`;
}

function timelineRef(timelineHash: string): string {
  return `timeline_${sha256(`timeline:${timelineHash}`).slice(0, 20)}`;
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function safeAggregate(snapshot: CanonicalMetaChangeSnapshot): SafeSnapshotAggregate {
  const entityCounts = { campaign: 0, adSet: 0, ad: 0 };
  let knownFieldCount = 0;
  let unknownFieldCount = 0;
  for (const entity of snapshot.entities) {
    if (entity.entityType === "campaign") entityCounts.campaign += 1;
    else if (entity.entityType === "ad_set") entityCounts.adSet += 1;
    else entityCounts.ad += 1;
    for (const observation of Object.values(entity.fields)) {
      if (!observation || observation.state === "unknown") unknownFieldCount += 1;
      else knownFieldCount += 1;
    }
  }
  return { entityCounts, knownFieldCount, unknownFieldCount };
}

function comparableValueAllowed(field: MetaChangeField, value: MetaComparableValue): boolean {
  if (value === null) return true;
  if (field === "configured_status" || field === "effective_status") {
    return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
  }
  if (field === "campaign_budget_optimization") return typeof value === "boolean";
  if (field === "daily_budget_minor" || field === "lifetime_budget_minor") {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  }
  if (field === "targeting_signature" || field === "creative_binding_signature") {
    return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
  }
  if (field !== "budget_owner" || typeof value !== "object" || Array.isArray(value)) return false;
  const owner = value as Record<string, unknown>;
  return Object.keys(owner).sort().join(",") === "amountMinor,budgetType,level,model"
    && (owner.model === "CBO" || owner.model === "ABO")
    && (owner.level === "campaign" || owner.level === "ad_set")
    && (owner.budgetType === "daily" || owner.budgetType === "lifetime")
    && typeof owner.amountMinor === "number"
    && Number.isSafeInteger(owner.amountMinor)
    && owner.amountMinor >= 0;
}

function canonicalTimelineHash(timeline: MetaChangeTimeline): string {
  const core = {
    schemaVersion: timeline.schemaVersion,
    fieldCatalogVersion: timeline.fieldCatalogVersion,
    previousSnapshotHash: timeline.previousSnapshotHash,
    currentSnapshotHash: timeline.currentSnapshotHash,
    period: { from: timeline.period.from, to: timeline.period.to },
    changes: timeline.changes.map((change) => ({
      changeRef: change.changeRef,
      entityRef: change.entityRef,
      entityType: change.entityType,
      field: change.field,
      before: change.before,
      after: change.after,
      classification: change.classification,
      correlatedActionRef: change.correlatedActionRef,
    })),
    diagnostics: {
      unknownComparisons: timeline.diagnostics.unknownComparisons,
      unmatchedPreviousEntities: timeline.diagnostics.unmatchedPreviousEntities,
      unmatchedCurrentEntities: timeline.diagnostics.unmatchedCurrentEntities,
    },
  };
  return sha256(JSON.stringify(core));
}

function validateTimeline(
  previous: CanonicalMetaChangeSnapshot,
  current: CanonicalMetaChangeSnapshot,
  timeline: MetaChangeTimeline,
  actionLedger: readonly MetaActionLedgerRecord[],
): void {
  let baseline: MetaChangeTimeline;
  try {
    // This is also the canonical authenticity/scope/hash check for both snapshots.
    baseline = diffMetaChangeSnapshots({ previous, current, actionLedger });
  } catch {
    throw new MetaChangeTimelinePersistenceError("hash_mismatch");
  }
  if (
    timeline.previousSnapshotHash !== previous.snapshotHash
    || timeline.currentSnapshotHash !== current.snapshotHash
    || timeline.schemaVersion !== current.schemaVersion
    || timeline.fieldCatalogVersion !== current.fieldCatalogVersion
    || timeline.period.from !== previous.capturedAt
    || timeline.period.to !== current.capturedAt
    || !/^[a-f0-9]{64}$/.test(timeline.timelineHash)
    || canonicalTimelineHash(timeline) !== timeline.timelineHash
    || timeline.changes.length !== baseline.changes.length
  ) throw new MetaChangeTimelinePersistenceError("hash_mismatch");

  const baselineByRef = new Map(baseline.changes.map((change) => [change.changeRef, change] as const));
  const observedRefs = new Set<string>();
  for (const change of timeline.changes) {
    const expected = baselineByRef.get(change.changeRef);
    if (
      !expected
      || observedRefs.has(change.changeRef)
      || change.entityRef !== expected.entityRef
      || change.entityType !== expected.entityType
      || change.field !== expected.field
      || !equalJson(change.before, expected.before)
      || !equalJson(change.after, expected.after)
      || change.classification !== expected.classification
      || change.correlatedActionRef !== expected.correlatedActionRef
      || !/^ref_[a-f0-9]{20}$/.test(change.changeRef)
      || !/^ref_[a-f0-9]{20}$/.test(change.entityRef)
      || !comparableValueAllowed(change.field, change.before)
      || !comparableValueAllowed(change.field, change.after)
      || (change.classification === "external_change" && change.correlatedActionRef !== null)
      || (change.classification === "internal_expected" && !/^ref_[a-f0-9]{20}$/.test(change.correlatedActionRef ?? ""))
    ) throw new MetaChangeTimelinePersistenceError("invalid_input");
    observedRefs.add(change.changeRef);
  }
}

/**
 * Persists only hash-only snapshot evidence and privacy-safe diff events. The
 * canonical snapshots are validation inputs and never become database rows.
 */
export class MetaChangeTimelinePersistenceService {
  constructor(private readonly store: MetaChangeTimelinePersistenceStore) {}

  async persist(input: Readonly<{
    scope: MetaChangePersistenceScope;
    previous: CanonicalMetaChangeSnapshot;
    current: CanonicalMetaChangeSnapshot;
    timeline: MetaChangeTimeline;
    actionLedger?: readonly MetaActionLedgerRecord[];
    detectedAt: string;
  }>): Promise<MetaChangeTimelinePersistenceResult> {
    const { scope, previous, current, timeline } = input;
    if (!scope.workspaceId || !scope.connectionId || !scope.adAccountId || !validTimestamp(input.detectedAt)) {
      throw new MetaChangeTimelinePersistenceError("invalid_input");
    }
    validateTimeline(previous, current, timeline, input.actionLedger ?? []);
    if (Date.parse(input.detectedAt) < Date.parse(current.capturedAt)) {
      throw new MetaChangeTimelinePersistenceError("invalid_input");
    }

    return this.store.transaction(async (transaction) => {
      const externalAccountId = await transaction.resolveExternalAccountId(scope);
      if (
        !externalAccountId
        || previous.workspaceId !== scope.workspaceId
        || current.workspaceId !== scope.workspaceId
        || previous.externalAccountId !== externalAccountId
        || current.externalAccountId !== externalAccountId
      ) throw new MetaChangeTimelinePersistenceError("scope_mismatch");

      const snapshotRows = [previous, current].map((snapshot): MetaChangeSnapshotPersistenceRow => ({
        workspaceId: scope.workspaceId,
        connectionId: scope.connectionId,
        adAccountId: scope.adAccountId,
        publicRef: snapshotRef(snapshot.snapshotHash),
        snapshotHash: snapshot.snapshotHash,
        schemaVersion: snapshot.schemaVersion,
        fieldCatalogVersion: snapshot.fieldCatalogVersion,
        capturedAt: snapshot.capturedAt,
        canonicalPayload: snapshot,
        safeAggregate: safeAggregate(snapshot),
      }));
      for (const row of snapshotRows) assertHashOnlyMetaPersistence(row);

      const previousStored = await transaction.upsertSnapshot(snapshotRows[0]!);
      const currentStored = await transaction.upsertSnapshot(snapshotRows[1]!);
      const eventRows = timeline.changes.map((change): MetaChangeEventPersistenceRow => ({
        workspaceId: scope.workspaceId,
        connectionId: scope.connectionId,
        adAccountId: scope.adAccountId,
        previousSnapshotId: previousStored.id,
        currentSnapshotId: currentStored.id,
        changeRef: change.changeRef,
        entityRef: change.entityRef,
        entityType: change.entityType,
        field: change.field,
        beforeValue: change.before,
        afterValue: change.after,
        classification: change.classification,
        correlatedActionRef: change.correlatedActionRef,
        timelineHash: timeline.timelineHash,
        fieldCatalogVersion: timeline.fieldCatalogVersion,
        occurredAt: current.capturedAt,
        detectedAt: new Date(input.detectedAt).toISOString(),
      }));
      for (const row of eventRows) assertHashOnlyMetaPersistence(row);
      const insertedEvents = await transaction.appendEvents(eventRows);
      const insertedSnapshots = Number(previousStored.inserted) + Number(currentStored.inserted);
      return Object.freeze({
        previousSnapshotRef: previousStored.publicRef,
        currentSnapshotRef: currentStored.publicRef,
        timelineRef: timelineRef(timeline.timelineHash),
        insertedSnapshots,
        insertedEvents,
        eventCount: eventRows.length,
        externalChangeCount: eventRows.filter((row) => row.classification === "external_change").length,
        internalExpectedCount: eventRows.filter((row) => row.classification === "internal_expected").length,
        replay: insertedSnapshots === 0 && insertedEvents === 0,
      });
    });
  }

  /** Server-private restart boundary. Never expose this canonical payload to UI/agent/logs. */
  async loadLatestSnapshot(scope: MetaChangePersistenceScope): Promise<CanonicalMetaChangeSnapshot | null> {
    if (!scope.workspaceId || !scope.connectionId || !scope.adAccountId) {
      throw new MetaChangeTimelinePersistenceError("invalid_input");
    }
    const stored = await this.store.loadLatestSnapshot(scope);
    if (!stored) return null;
    if (
      stored.workspaceId !== scope.workspaceId
      || stored.connectionId !== scope.connectionId
      || stored.adAccountId !== scope.adAccountId
      || !stored.canonicalPayload
      || typeof stored.canonicalPayload !== "object"
    ) throw new MetaChangeTimelinePersistenceError("scope_mismatch");
    const persisted = stored.canonicalPayload as CanonicalMetaChangeSnapshot;
    const { snapshotHash, ...persistedCore } = persisted;
    const snapshot = {
      ...(stableJson(persistedCore) as Omit<CanonicalMetaChangeSnapshot, "snapshotHash">),
      snapshotHash,
    } as CanonicalMetaChangeSnapshot;
    try {
      // A self-diff is a side-effect-free authenticity and canonical hash check.
      diffMetaChangeSnapshots({ previous: snapshot, current: snapshot });
    } catch {
      throw new MetaChangeTimelinePersistenceError("hash_mismatch");
    }
    if (snapshot.workspaceId !== scope.workspaceId || snapshot.externalAccountId !== stored.externalAccountId) {
      throw new MetaChangeTimelinePersistenceError("scope_mismatch");
    }
    return snapshot;
  }
}

function sameEvent(
  stored: typeof schema.metaChangeEvents.$inferSelect,
  expected: MetaChangeEventPersistenceRow,
): boolean {
  return stored.workspaceId === expected.workspaceId
    && stored.metaConnectionId === expected.connectionId
    && stored.adAccountId === expected.adAccountId
    && stored.previousSnapshotId === expected.previousSnapshotId
    && stored.currentSnapshotId === expected.currentSnapshotId
    && stored.entityRef === expected.entityRef
    && stored.entityType === expected.entityType
    && stored.field === expected.field
    && equalJson(stored.beforeValue, expected.beforeValue)
    && equalJson(stored.afterValue, expected.afterValue)
    && stored.classification === expected.classification
    && stored.correlatedActionRef === expected.correlatedActionRef
    && stored.timelineHash === expected.timelineHash
    && stored.fieldCatalogVersion === expected.fieldCatalogVersion
    && stored.occurredAt.toISOString() === expected.occurredAt
    && stored.detectedAt.toISOString() === expected.detectedAt;
}

/** Concrete short-transaction Drizzle/Postgres implementation. */
export class DrizzleMetaChangeTimelinePersistenceStore implements MetaChangeTimelinePersistenceStore {
  constructor(private readonly database: ReklamZekaDatabase) {}

  transaction<T>(work: (transaction: MetaChangeTimelinePersistenceTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction(async (databaseTransaction) => work({
      resolveExternalAccountId: async (scope) => {
        const rows = await databaseTransaction.select({ externalAccountId: schema.adAccounts.externalAccountId })
          .from(schema.adAccounts)
          .innerJoin(schema.dataSources, eq(schema.adAccounts.dataSourceId, schema.dataSources.id))
          .innerJoin(schema.metaConnections, eq(schema.dataSources.metaConnectionId, schema.metaConnections.id))
          .where(and(
            eq(schema.adAccounts.id, scope.adAccountId),
            eq(schema.adAccounts.workspaceId, scope.workspaceId),
            eq(schema.dataSources.workspaceId, scope.workspaceId),
            eq(schema.metaConnections.workspaceId, scope.workspaceId),
            eq(schema.metaConnections.id, scope.connectionId),
            isNull(schema.adAccounts.disappearedAt),
          ));
        return rows.length === 1 ? rows[0]!.externalAccountId : null;
      },
      upsertSnapshot: async (row) => {
        const inserted = await databaseTransaction.insert(schema.metaChangeSnapshots).values({
          workspaceId: row.workspaceId,
          metaConnectionId: row.connectionId,
          adAccountId: row.adAccountId,
          publicRef: row.publicRef,
          snapshotHash: row.snapshotHash,
          schemaVersion: row.schemaVersion,
          fieldCatalogVersion: row.fieldCatalogVersion,
          capturedAt: new Date(row.capturedAt),
          canonicalPayload: row.canonicalPayload,
          safeAggregate: row.safeAggregate,
        }).onConflictDoNothing({ target: [
          schema.metaChangeSnapshots.workspaceId,
          schema.metaChangeSnapshots.metaConnectionId,
          schema.metaChangeSnapshots.adAccountId,
          schema.metaChangeSnapshots.snapshotHash,
        ] })
          .returning({ id: schema.metaChangeSnapshots.id, publicRef: schema.metaChangeSnapshots.publicRef });
        if (inserted[0]) return { ...inserted[0], inserted: true };
        const existing = await databaseTransaction.select().from(schema.metaChangeSnapshots)
          .where(and(
            eq(schema.metaChangeSnapshots.workspaceId, row.workspaceId),
            eq(schema.metaChangeSnapshots.metaConnectionId, row.connectionId),
            eq(schema.metaChangeSnapshots.adAccountId, row.adAccountId),
            eq(schema.metaChangeSnapshots.snapshotHash, row.snapshotHash),
          ));
        const candidate = existing[0];
        if (
          existing.length !== 1
          || !candidate
          || candidate.workspaceId !== row.workspaceId
          || candidate.metaConnectionId !== row.connectionId
          || candidate.adAccountId !== row.adAccountId
          || candidate.publicRef !== row.publicRef
          || candidate.schemaVersion !== row.schemaVersion
          || candidate.fieldCatalogVersion !== row.fieldCatalogVersion
          || candidate.capturedAt.toISOString() !== row.capturedAt
          || !equalJson(candidate.canonicalPayload, row.canonicalPayload)
          || !equalJson(candidate.safeAggregate, row.safeAggregate)
        ) throw new MetaChangeTimelinePersistenceError("replay_conflict");
        return { id: candidate.id, publicRef: candidate.publicRef, inserted: false };
      },
      appendEvents: async (rows) => {
        if (rows.length === 0) return 0;
        const inserted = await databaseTransaction.insert(schema.metaChangeEvents).values(rows.map((row) => ({
          workspaceId: row.workspaceId,
          metaConnectionId: row.connectionId,
          adAccountId: row.adAccountId,
          previousSnapshotId: row.previousSnapshotId,
          currentSnapshotId: row.currentSnapshotId,
          changeRef: row.changeRef,
          entityRef: row.entityRef,
          entityType: row.entityType,
          field: row.field,
          beforeValue: row.beforeValue,
          afterValue: row.afterValue,
          classification: row.classification,
          correlatedActionRef: row.correlatedActionRef,
          timelineHash: row.timelineHash,
          fieldCatalogVersion: row.fieldCatalogVersion,
          occurredAt: new Date(row.occurredAt),
          detectedAt: new Date(row.detectedAt),
        }))).onConflictDoNothing({ target: [
          schema.metaChangeEvents.workspaceId,
          schema.metaChangeEvents.metaConnectionId,
          schema.metaChangeEvents.adAccountId,
          schema.metaChangeEvents.changeRef,
        ] })
          .returning({ changeRef: schema.metaChangeEvents.changeRef });
        const stored = await databaseTransaction.select().from(schema.metaChangeEvents)
          .where(and(
            eq(schema.metaChangeEvents.workspaceId, rows[0]!.workspaceId),
            eq(schema.metaChangeEvents.metaConnectionId, rows[0]!.connectionId),
            eq(schema.metaChangeEvents.adAccountId, rows[0]!.adAccountId),
            inArray(schema.metaChangeEvents.changeRef, rows.map((row) => row.changeRef)),
          ));
        const expectedByRef = new Map(rows.map((row) => [row.changeRef, row] as const));
        if (stored.length !== rows.length || stored.some((row) => {
          const expected = expectedByRef.get(row.changeRef);
          return !expected || !sameEvent(row, expected);
        })) throw new MetaChangeTimelinePersistenceError("replay_conflict");
        return inserted.length;
      },
    }));
  }

  async loadLatestSnapshot(scope: MetaChangePersistenceScope) {
    const rows = await this.database.select({
      workspaceId: schema.metaChangeSnapshots.workspaceId,
      connectionId: schema.metaChangeSnapshots.metaConnectionId,
      adAccountId: schema.metaChangeSnapshots.adAccountId,
      externalAccountId: schema.adAccounts.externalAccountId,
      canonicalPayload: schema.metaChangeSnapshots.canonicalPayload,
    }).from(schema.metaChangeSnapshots)
      .innerJoin(schema.adAccounts, and(
        eq(schema.metaChangeSnapshots.adAccountId, schema.adAccounts.id),
        eq(schema.metaChangeSnapshots.workspaceId, schema.adAccounts.workspaceId),
      ))
      .innerJoin(schema.dataSources, and(
        eq(schema.adAccounts.dataSourceId, schema.dataSources.id),
        eq(schema.dataSources.workspaceId, scope.workspaceId),
        eq(schema.dataSources.metaConnectionId, scope.connectionId),
      ))
      .where(and(
        eq(schema.metaChangeSnapshots.workspaceId, scope.workspaceId),
        eq(schema.metaChangeSnapshots.metaConnectionId, scope.connectionId),
        eq(schema.metaChangeSnapshots.adAccountId, scope.adAccountId),
        isNull(schema.adAccounts.disappearedAt),
      ))
      .orderBy(
        desc(schema.metaChangeSnapshots.capturedAt),
        desc(schema.metaChangeSnapshots.persistedAt),
        desc(schema.metaChangeSnapshots.id),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
