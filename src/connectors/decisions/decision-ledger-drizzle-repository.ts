import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  DECISION_LEDGER_VERSION,
  verifyDecisionLedger,
  type AnalysisLedgerRecord,
  type DecisionLedger,
  type DecisionLedgerRecord,
} from "@/domain/decisions/ledger";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";

type Database = NodePgDatabase<typeof schema>;
type LedgerDatabase = Pick<Database, "select" | "insert" | "execute" | "transaction">;
type LedgerRecord = AnalysisLedgerRecord | DecisionLedgerRecord;
type LedgerRow = typeof schema.decisionLedgerRecords.$inferSelect;

export class DecisionLedgerRepositoryError extends Error {
  constructor(readonly code:
    | "invalid_record"
    | "workspace_scope_mismatch"
    | "stale_head"
    | "prefix_rewrite"
    | "chain_conflict"
    | "record_conflict"
    | "temporal_conflict"
    | "context_missing"
    | "analysis_missing"
    | "corrupt_store") {
    super(`Decision ledger persistence reddedildi: ${code}`);
    this.name = "DecisionLedgerRepositoryError";
  }
}

function required(value: string): string {
  if (typeof value !== "string") throw new DecisionLedgerRepositoryError("invalid_record");
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new DecisionLedgerRepositoryError("invalid_record");
  return normalized;
}

function exactKeys(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new DecisionLedgerRepositoryError("invalid_record");
  }
}

function hasForbiddenControl(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value as object)) return true;
  seen.add(value as object);
  if (Array.isArray(value)) {
    const forbidden = value.some((entry) => hasForbiddenControl(entry, seen));
    seen.delete(value);
    return forbidden;
  }
  const forbidden = Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return normalized.includes("prompt") || normalized.endsWith("tool") || normalized.endsWith("tools")
      || hasForbiddenControl(child, seen);
  });
  seen.delete(value);
  return forbidden;
}

function resultRows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new DecisionLedgerRepositoryError("corrupt_store");
  }
  return result.rows as readonly T[];
}

async function assertWorkspace(database: LedgerDatabase, workspaceId: string, lock: boolean): Promise<void> {
  const suffix = lock ? sql` for update` : sql``;
  const result = await database.execute(sql`
    select id from workspaces
    where id = ${workspaceId}::uuid and lifecycle_state = 'active'
    limit 1${suffix}
  `);
  if (resultRows(result).length !== 1) {
    throw new DecisionLedgerRepositoryError("workspace_scope_mismatch");
  }
}

function restoreRecord(row: LedgerRow): LedgerRecord {
  let record: LedgerRecord;
  try {
    record = JSON.parse(row.payload) as LedgerRecord;
  } catch {
    throw new DecisionLedgerRepositoryError("corrupt_store");
  }
  const exact = record.version === row.version
    && record.recordType === row.recordType
    && record.sequence === row.sequence
    && record.previousHash === row.previousHash
    && record.workspaceRef === row.workspaceRef
    && record.occurredAt === row.occurredAt.toISOString()
    && record.recordId === row.recordId
    && record.recordHash === row.recordHash;
  if (!exact || record.version !== DECISION_LEDGER_VERSION) {
    throw new DecisionLedgerRepositoryError("corrupt_store");
  }
  if (record.recordType === "analysis") {
    if (row.effectiveContextRef !== record.effectiveContextRef
      || row.analysisDefinitionRef !== record.analysisDefinitionRef
      || row.analysisRecordRowId !== null || row.analysisRecordRef !== null
      || row.cadenceResultRef !== null || row.disposition !== null) {
      throw new DecisionLedgerRepositoryError("corrupt_store");
    }
  } else if (record.recordType === "decision") {
    if (row.effectiveContextId !== null || row.effectiveContextRef !== null
      || row.analysisDefinitionRef !== null
      || row.analysisRecordRowId === null || row.analysisRecordRef !== record.analysisRecordRef
      || row.cadenceResultRef !== record.cadenceResultRef || row.disposition !== record.disposition) {
      throw new DecisionLedgerRepositoryError("corrupt_store");
    }
  } else {
    throw new DecisionLedgerRepositoryError("corrupt_store");
  }
  return Object.freeze(record);
}

async function loadRows(database: LedgerDatabase, workspaceId: string): Promise<Readonly<{
  rows: readonly LedgerRow[];
  ledger: DecisionLedger;
}>> {
  const rows = await database.select().from(schema.decisionLedgerRecords)
    .where(eq(schema.decisionLedgerRecords.workspaceId, workspaceId))
    .orderBy(asc(schema.decisionLedgerRecords.sequence));
  const ledger = Object.freeze(rows.map(restoreRecord));
  if (!verifyDecisionLedger(ledger)) throw new DecisionLedgerRepositoryError("corrupt_store");
  if (new Set(ledger.map((record) => record.workspaceRef)).size > 1) {
    throw new DecisionLedgerRepositoryError("corrupt_store");
  }
  return Object.freeze({ rows, ledger });
}

function sameRecord(left: LedgerRecord, right: LedgerRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function appendCandidate(
  transaction: LedgerDatabase,
  workspaceId: string,
  current: Readonly<{ rows: readonly LedgerRow[]; ledger: DecisionLedger }>,
  candidate: LedgerRecord,
): Promise<Readonly<{ rows: readonly LedgerRow[]; ledger: DecisionLedger }>> {
  const workspaceRef = current.ledger[0]?.workspaceRef ?? candidate.workspaceRef;
  if (!workspaceRef || candidate.workspaceRef !== workspaceRef) {
    throw new DecisionLedgerRepositoryError("workspace_scope_mismatch");
  }
  if (candidate.sequence !== current.ledger.length + 1
    || candidate.previousHash !== (current.ledger.at(-1)?.recordHash ?? "GENESIS")
    || !verifyDecisionLedger(Object.freeze([...current.ledger, candidate]))) {
    throw new DecisionLedgerRepositoryError("chain_conflict");
  }

  let effectiveContextId: string | null = null;
  let analysisRecordRowId: string | null = null;
  if (candidate.recordType === "analysis") {
    const contexts = await transaction.select({
      id: schema.effectiveCampaignContexts.id,
      capturedAt: schema.effectiveCampaignContexts.capturedAt,
    }).from(schema.effectiveCampaignContexts).where(and(
      eq(schema.effectiveCampaignContexts.workspaceId, workspaceId),
      eq(schema.effectiveCampaignContexts.contextHash, candidate.effectiveContextRef),
    )).limit(1);
    if (!contexts[0] || contexts[0].capturedAt.getTime() > Date.parse(candidate.occurredAt)) {
      throw new DecisionLedgerRepositoryError("context_missing");
    }
    effectiveContextId = contexts[0].id;
  } else {
    const analysisIndex = current.ledger.findIndex((record) => (
      record.recordType === "analysis" && record.recordId === candidate.analysisRecordRef
    ));
    if (analysisIndex < 0 || !current.rows[analysisIndex]) {
      throw new DecisionLedgerRepositoryError("analysis_missing");
    }
    const analysisRecord = current.ledger[analysisIndex];
    if (!analysisRecord || analysisRecord.recordType !== "analysis"
      || Date.parse(candidate.occurredAt) < Date.parse(analysisRecord.occurredAt)) {
      throw new DecisionLedgerRepositoryError("temporal_conflict");
    }
    analysisRecordRowId = current.rows[analysisIndex]!.id;
  }

  const inserted = await transaction.insert(schema.decisionLedgerRecords).values({
    workspaceId,
    workspaceRef: candidate.workspaceRef,
    version: candidate.version,
    recordType: candidate.recordType,
    sequence: candidate.sequence,
    previousHash: candidate.previousHash,
    recordId: candidate.recordId,
    recordHash: candidate.recordHash,
    occurredAt: new Date(candidate.occurredAt),
    effectiveContextId,
    effectiveContextRef: candidate.recordType === "analysis" ? candidate.effectiveContextRef : null,
    analysisRecordRowId,
    analysisRecordRef: candidate.recordType === "decision" ? candidate.analysisRecordRef : null,
    analysisDefinitionRef: candidate.recordType === "analysis" ? candidate.analysisDefinitionRef : null,
    cadenceResultRef: candidate.recordType === "decision" ? candidate.cadenceResultRef : null,
    disposition: candidate.recordType === "decision" ? candidate.disposition : null,
    payload: JSON.stringify(candidate),
  }).returning();
  if (!inserted[0]) throw new DecisionLedgerRepositoryError("record_conflict");
  const next = await loadRows(transaction, workspaceId);
  const restored = next.ledger.at(-1);
  if (!restored || !sameRecord(restored, candidate)) {
    throw new DecisionLedgerRepositoryError("corrupt_store");
  }
  return next;
}

/** Server-private append-only persistence for the verified analysis/decision chain. */
export class DrizzleDecisionLedgerRepository {
  constructor(private readonly database: LedgerDatabase) {}

  async load(workspaceId: string): Promise<DecisionLedger> {
    required(workspaceId);
    await assertWorkspace(this.database, workspaceId, false);
    return (await loadRows(this.database, workspaceId)).ledger;
  }

  async append(workspaceId: string, candidate: LedgerRecord): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    record: LedgerRecord;
    ledger: DecisionLedger;
  }>> {
    required(workspaceId);
    if (!candidate || typeof candidate !== "object") throw new DecisionLedgerRepositoryError("invalid_record");
    return this.database.transaction(async (transaction) => {
      await assertWorkspace(transaction, workspaceId, true);
      const current = await loadRows(transaction, workspaceId);
      const existingIndex = current.ledger.findIndex((record) => record.recordId === candidate.recordId);
      if (existingIndex >= 0) {
        const existing = current.ledger[existingIndex]!;
        if (!sameRecord(existing, candidate)) throw new DecisionLedgerRepositoryError("record_conflict");
        return Object.freeze({
          outcome: "unchanged" as const,
          record: existing,
          ledger: current.ledger,
        });
      }
      const next = await appendCandidate(transaction, workspaceId, current, candidate);
      const restored = next.ledger.at(-1);
      if (!restored) throw new DecisionLedgerRepositoryError("corrupt_store");
      return Object.freeze({ outcome: "inserted" as const, record: restored, ledger: next.ledger });
    });
  }

  /** Atomically appends only the immutable suffix after an optimistic head/prefix check. */
  async appendSuffix(input: Readonly<{
    workspaceId: string;
    workspaceRef: string;
    expectedHeadHash: string;
    ledger: DecisionLedger;
  }>): Promise<DecisionLedger> {
    exactKeys(input, ["workspaceId", "workspaceRef", "expectedHeadHash", "ledger"]);
    const workspaceId = required(input.workspaceId);
    const workspaceRef = required(input.workspaceRef);
    if (!/^(?:GENESIS|[a-f0-9]{64})$/.test(input.expectedHeadHash)
      || !Array.isArray(input.ledger)
      || !verifyDecisionLedger(input.ledger)
      || !inspectMetaPersistenceWrite(input.ledger).compliant
      || hasForbiddenControl(input.ledger)) {
      throw new DecisionLedgerRepositoryError("invalid_record");
    }
    if (input.ledger.some((record) => record.workspaceRef !== workspaceRef)) {
      throw new DecisionLedgerRepositoryError("workspace_scope_mismatch");
    }
    return this.database.transaction(async (transaction) => {
      await assertWorkspace(transaction, workspaceId, true);
      let current = await loadRows(transaction, workspaceId);
      const currentHead = current.ledger.at(-1)?.recordHash ?? "GENESIS";
      if (currentHead !== input.expectedHeadHash) throw new DecisionLedgerRepositoryError("stale_head");
      if (input.ledger.length < current.ledger.length
        || current.ledger.some((record, index) => !sameRecord(record, input.ledger[index]!))) {
        throw new DecisionLedgerRepositoryError("prefix_rewrite");
      }
      const suffix = input.ledger.slice(current.ledger.length);
      const firstSuffixRecord = suffix[0];
      const allowedSingleDecision = suffix.length === 1 && firstSuffixRecord?.recordType === "decision"
        && current.ledger.some((record) => (
          record.recordType === "analysis" && record.recordId === firstSuffixRecord.analysisRecordRef
        ));
      const allowedSingleAnalysis = suffix.length === 1 && firstSuffixRecord?.recordType === "analysis";
      const allowedPair = suffix.length === 2
        && suffix[0]?.recordType === "analysis"
        && suffix[1]?.recordType === "decision"
        && suffix[1].analysisRecordRef === suffix[0].recordId;
      if (suffix.length > 0 && !allowedSingleDecision && !allowedSingleAnalysis && !allowedPair) {
        throw new DecisionLedgerRepositoryError("invalid_record");
      }
      for (const candidate of suffix) {
        current = await appendCandidate(transaction, workspaceId, current, candidate);
      }
      return current.ledger;
    });
  }
}
