import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { DrizzleMetaChangeSnapshotStore, MetaChangeSnapshotDrizzleAdapter } from "./change-snapshot-drizzle-adapter";
import {
  DrizzleMetaChangeTimelinePersistenceStore,
  MetaChangeTimelinePersistenceService,
} from "./change-timeline-persistence";
import { diffMetaChangeSnapshots, normalizeMetaChangeSnapshot, type CanonicalMetaChangeSnapshot } from "@/domain/meta/snapshot-diff";
import type { MetaSyncResult } from "./runtime";
import type { MetaSyncSlice } from "./types";

type Database = NodePgDatabase<typeof schema>;
const rows = (result: unknown): readonly Record<string, unknown>[] => result && typeof result === "object" && "rows" in result && Array.isArray(result.rows) ? result.rows as readonly Record<string, unknown>[] : [];

export type CompletedNormalInventoryEvidence = Readonly<{
  workspaceId: string;
  connectionId: string;
  parentRunRef: string;
  accounts: readonly Readonly<{ externalAccountId: string; capturedAt: string }>[];
}>;

export type CanonicalBudgetHistoryMaterializationResult = Readonly<{
  accountCount: number;
  baselineCount: number;
  replayCount: number;
  externalChangeCount: number;
  staleSkipCount: number;
}>;

export class CanonicalBudgetHistoryMaterializationError extends Error {
  constructor(readonly code: "invalid_evidence" | "scope_mismatch" | "replay_conflict" | "persistence_failed") {
    super("Kanonik bütçe geçmişi güvenli biçimde güncellenemedi");
    this.name = "CanonicalBudgetHistoryMaterializationError";
  }
}

const INVENTORY_LEVELS = ["account", "campaign", "ad_set", "ad"] as const;
const MAX_ACCOUNTS = 1_000;
const MAX_PLAN_SLICES = 20_000;

function codePointCompare(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function canonicalInstant(value: string): string | null {
  const instant = new Date(value);
  return Number.isFinite(instant.valueOf()) && instant.toISOString() === value ? value : null;
}

/**
 * A budget/config snapshot is valid only after every normal inventory level for
 * an account has completed. It deliberately ignores insight windows, bootstrap
 * runs and recovery lanes: none prove a complete current hierarchy.
 */
export function completedNormalInventoryEvidence(input: Readonly<{
  result: MetaSyncResult;
  plan: readonly MetaSyncSlice[];
  mode: "normal" | "insight_bootstrap";
  recovery: boolean;
}>): CompletedNormalInventoryEvidence | null {
  if (input.mode !== "normal" || input.recovery || input.result.parentRun.status !== "completed") return null;
  if (input.plan.length === 0 || input.plan.length > MAX_PLAN_SLICES) return null;
  const expected = input.plan.filter((slice) => slice.stream === "inventory" && INVENTORY_LEVELS.includes(slice.entityLevel as typeof INVENTORY_LEVELS[number]));
  if (expected.length === 0 || new Set(expected.map((slice) => slice.id)).size !== expected.length) return null;
  const byAccount = new Map<string, MetaSyncSlice[]>();
  for (const slice of expected) {
    const rows = byAccount.get(slice.accountId) ?? [];
    rows.push(slice);
    byAccount.set(slice.accountId, rows);
  }
  const observedAccounts: Array<{ externalAccountId: string; capturedAt: string }> = [];
  if (byAccount.size === 0 || byAccount.size > MAX_ACCOUNTS || expected.length !== byAccount.size * INVENTORY_LEVELS.length) return null;
  const inventoryStreams = input.result.streamRuns.filter((stream) => stream.stream === "inventory");
  if (inventoryStreams.length !== byAccount.size || new Set(inventoryStreams.map((stream) => stream.accountId)).size !== inventoryStreams.length) return null;
  for (const [externalAccountId, slices] of [...byAccount.entries()].sort(([left], [right]) => codePointCompare(left, right))) {
    if (slices.length !== INVENTORY_LEVELS.length || new Set(slices.map((slice) => slice.entityLevel)).size !== INVENTORY_LEVELS.length) return null;
    const stream = inventoryStreams.find((candidate) => candidate.accountId === externalAccountId);
    if (!stream || stream.status !== "completed") return null;
    const expectedIds = slices.map((slice) => slice.id).sort(codePointCompare);
    const completedIds = [...stream.completedSliceIds].sort(codePointCompare);
    const cursorIds = Object.keys(stream.cursorBySlice).sort(codePointCompare);
    if (
      new Set(stream.completedSliceIds).size !== stream.completedSliceIds.length
      || expectedIds.join("\u0000") !== completedIds.join("\u0000")
      || expectedIds.join("\u0000") !== cursorIds.join("\u0000")
    ) return null;
    const cursorInstants = expectedIds.map((sliceId) => stream.cursorBySlice[sliceId]?.updatedAt ?? null)
      .map((value) => value === null ? null : canonicalInstant(value));
    if (cursorInstants.some((value) => value === null)) return null;
    // The terminal durable cursor is the only trustworthy completion instant;
    // do not substitute wall-clock, fetchedAt, sourceUpdatedAt or insight time.
    const capturedAt = cursorInstants.filter((value): value is string => value !== null).sort().at(-1)!;
    observedAccounts.push({ externalAccountId, capturedAt });
  }
  return Object.freeze({
    workspaceId: input.result.parentRun.workspaceId,
    connectionId: input.result.parentRun.connectionId,
    parentRunRef: input.result.parentRun.id,
    accounts: Object.freeze(observedAccounts),
  });
}

export type CanonicalBudgetHistoryTransition = "baseline" | "replay" | "append" | "stale_skip";

/** Equal capture instants are a single immutable observation slot. */
export function canonicalBudgetHistoryTransition(
  previous: CanonicalMetaChangeSnapshot | null,
  current: CanonicalMetaChangeSnapshot,
): CanonicalBudgetHistoryTransition {
  if (!previous) return "baseline";
  const compared = Date.parse(current.capturedAt) - Date.parse(previous.capturedAt);
  if (compared < 0) return "stale_skip";
  if (compared === 0) {
    if (current.snapshotHash !== previous.snapshotHash) {
      throw new CanonicalBudgetHistoryMaterializationError("replay_conflict");
    }
    return "replay";
  }
  return "append";
}

export interface CanonicalBudgetHistoryMaterializer {
  materialize(evidence: CompletedNormalInventoryEvidence): Promise<CanonicalBudgetHistoryMaterializationResult>;
}

/**
 * Post-run, server-private materializer. Each account uses a transaction-local
 * advisory lock so two normal syncs cannot independently choose the same
 * previous snapshot. The snapshot service itself remains idempotent.
 */
export class DrizzleCanonicalBudgetHistoryMaterializer implements CanonicalBudgetHistoryMaterializer {
  constructor(private readonly database: Database) {}

  async materialize(evidence: CompletedNormalInventoryEvidence): Promise<CanonicalBudgetHistoryMaterializationResult> {
    if (!evidence.workspaceId || !evidence.connectionId || !/^[a-zA-Z0-9_.:-]{1,190}$/.test(evidence.parentRunRef) || evidence.accounts.length === 0) {
      throw new CanonicalBudgetHistoryMaterializationError("invalid_evidence");
    }
    let baselineCount = 0;
    let replayCount = 0;
    let externalChangeCount = 0;
    let staleSkipCount = 0;
    try {
      for (const account of evidence.accounts) {
        await this.database.transaction(async (transaction) => {
          const lockKey = `meta-budget-history:${evidence.workspaceId}:${evidence.connectionId}:${account.externalAccountId}`;
          await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
          const accounts = await transaction.select({ id: schema.adAccounts.id })
            .from(schema.adAccounts)
            .innerJoin(schema.dataSources, and(
              eq(schema.adAccounts.dataSourceId, schema.dataSources.id),
              eq(schema.adAccounts.workspaceId, schema.dataSources.workspaceId),
            ))
            .where(and(
              eq(schema.adAccounts.workspaceId, evidence.workspaceId),
              eq(schema.adAccounts.externalAccountId, account.externalAccountId),
              eq(schema.dataSources.workspaceId, evidence.workspaceId),
              eq(schema.dataSources.metaConnectionId, evidence.connectionId),
              isNull(schema.adAccounts.disappearedAt),
            ));
          if (accounts.length !== 1) throw new CanonicalBudgetHistoryMaterializationError("scope_mismatch");
          const scope = {
            workspaceId: evidence.workspaceId,
            connectionId: evidence.connectionId,
            adAccountId: accounts[0]!.id,
          };
          const snapshotAdapter = new MetaChangeSnapshotDrizzleAdapter(
            new DrizzleMetaChangeSnapshotStore(transaction as never),
          );
          const current = normalizeMetaChangeSnapshot(await snapshotAdapter.buildInput({
            workspaceId: evidence.workspaceId,
            connectionId: evidence.connectionId,
            externalAccountId: account.externalAccountId,
            capturedAt: account.capturedAt,
          }));
          const timelineStore = new DrizzleMetaChangeTimelinePersistenceStore(transaction as never);
          const timelineService = new MetaChangeTimelinePersistenceService(timelineStore);
          const previous = await timelineService.loadLatestSnapshot(scope);
          const transition = canonicalBudgetHistoryTransition(previous, current);
          if (transition === "stale_skip") {
            staleSkipCount += 1;
            return;
          }
          const baseline = transition === "baseline";
          const compared = previous ?? current;
          const result = await timelineService.persist({
            scope,
            previous: compared,
            current,
            timeline: diffMetaChangeSnapshots({ previous: compared, current }),
            detectedAt: account.capturedAt,
          });
          const compositionEvidenceHash = createHash("sha256").update(JSON.stringify({
            parentRunRef: evidence.parentRunRef, workspaceId: evidence.workspaceId, connectionId: evidence.connectionId,
            account: account.externalAccountId, capturedAt: account.capturedAt, lane: "normal_inventory_complete",
          })).digest("hex");
          const snapshot = rows(await transaction.execute(sql`select id::text,snapshot_hash,captured_at::text from meta_change_snapshots where workspace_id=${evidence.workspaceId}::uuid and meta_connection_id=${scope.connectionId}::uuid and ad_account_id=${scope.adAccountId}::uuid and snapshot_hash=${current.snapshotHash} limit 2`));
          if (snapshot.length !== 1 || snapshot[0]!.snapshot_hash !== current.snapshotHash || new Date(String(snapshot[0]!.captured_at)).toISOString() !== current.capturedAt) throw new CanonicalBudgetHistoryMaterializationError("persistence_failed");
          await transaction.execute(sql`insert into meta_complete_snapshot_receipts(workspace_id,meta_connection_id,ad_account_id,snapshot_id,snapshot_hash,captured_at,parent_run_ref,composition_evidence_hash,lane) values(${evidence.workspaceId}::uuid,${scope.connectionId}::uuid,${scope.adAccountId}::uuid,${String(snapshot[0]!.id)}::uuid,${current.snapshotHash},${current.capturedAt}::timestamptz,${evidence.parentRunRef},${compositionEvidenceHash},'normal_inventory_complete') on conflict (workspace_id,snapshot_id) do nothing`);
          const receipt = rows(await transaction.execute(sql`select snapshot_hash,captured_at::text,parent_run_ref,composition_evidence_hash,lane from meta_complete_snapshot_receipts where workspace_id=${evidence.workspaceId}::uuid and snapshot_id=${String(snapshot[0]!.id)}::uuid limit 2`));
          if (receipt.length !== 1 || receipt[0]!.snapshot_hash !== current.snapshotHash || new Date(String(receipt[0]!.captured_at)).toISOString() !== current.capturedAt || receipt[0]!.parent_run_ref !== evidence.parentRunRef || receipt[0]!.composition_evidence_hash !== compositionEvidenceHash || receipt[0]!.lane !== "normal_inventory_complete") throw new CanonicalBudgetHistoryMaterializationError("replay_conflict");
          if (baseline) baselineCount += 1;
          if (transition === "replay" || result.replay) replayCount += 1;
          externalChangeCount += result.externalChangeCount;
        });
      }
    } catch (error) {
      if (error instanceof CanonicalBudgetHistoryMaterializationError) throw error;
      throw new CanonicalBudgetHistoryMaterializationError("persistence_failed");
    }
    return Object.freeze({ accountCount: evidence.accounts.length, baselineCount, replayCount, externalChangeCount, staleSkipCount });
  }
}
