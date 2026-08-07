import { createHash } from "node:crypto";
import type { DecisionDisposition } from "@/domain/decisions/cadence";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";

export const DECISION_LEDGER_VERSION = "decision-ledger/1.0.0" as const;

type JsonPrimitive = string | number | boolean | null;
export type FrozenJson = JsonPrimitive | readonly FrozenJson[] | Readonly<{ [key: string]: FrozenJson }>;

type LedgerBase = Readonly<{
  version: typeof DECISION_LEDGER_VERSION;
  sequence: number;
  previousHash: string;
  workspaceRef: string;
  occurredAt: string;
  recordId: string;
  recordHash: string;
}>;

export type AnalysisLedgerRecord = LedgerBase & Readonly<{
  recordType: "analysis";
  analysisDefinitionRef: string;
  effectiveContextRef: string;
  timelineRefs: readonly string[];
  evidenceRefs: readonly string[];
  frozenContext: FrozenJson;
  actionAuthority: "none";
}>;

export type DecisionLedgerRecord = LedgerBase & Readonly<{
  recordType: "decision";
  analysisRecordRef: string;
  cadenceResultRef: string;
  disposition: DecisionDisposition;
  evidenceRefs: readonly string[];
  timelineRefs: readonly string[];
  guidanceRefs: readonly string[];
  experimentRef: string | null;
  rationaleCode: string;
  /** A ledger observation is never an approval or execute grant. */
  executionAuthority: "none";
}>;

export type DecisionLedger = readonly (AnalysisLedgerRecord | DecisionLedgerRecord)[];

export class DecisionLedgerError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_chain" | "analysis_missing" | "scope_mismatch") {
    super("Karar defteri kaydı güvenli biçimde oluşturulamadı");
    this.name = "DecisionLedgerError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new DecisionLedgerError("invalid_input");
}

function required(value: string): string {
  if (!value.trim()) throw new DecisionLedgerError("invalid_input");
  return value.trim();
}

function timestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new DecisionLedgerError("invalid_input");
  return new Date(parsed).toISOString();
}

function uniqueRefs(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new DecisionLedgerError("invalid_input");
  }
  return Object.freeze([...new Set(values.map((value) => value.trim()))].sort(codePointCompare));
}

function canonicalJson(value: unknown, seen = new Set<object>()): FrozenJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DecisionLedgerError("invalid_input");
    return value;
  }
  if (!value || typeof value !== "object" || seen.has(value)) throw new DecisionLedgerError("invalid_input");
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => canonicalJson(item, seen));
    seen.delete(value);
    return Object.freeze(result);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new DecisionLedgerError("invalid_input");
  const result = Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => codePointCompare(left, right))
    .map(([key, item]) => [key, canonicalJson(item, seen)]));
  seen.delete(value);
  return Object.freeze(result);
}

function hasAuthorityEscalation(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasAuthorityEscalation(item, seen));
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const authorityKey = normalized === "canwrite" || normalized === "writeenabled"
      || normalized === "actionauthority" || normalized === "writeauthority"
      || normalized === "executionauthority" || normalized === "approvalgranted";
    const benign = child === false || child === "none" || child === "disabled" || child === "guidance_only";
    return (authorityKey && !benign) || hasAuthorityEscalation(child, seen);
  });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

type RecordWithoutIdentity = Omit<AnalysisLedgerRecord, "recordId" | "recordHash">
  | Omit<DecisionLedgerRecord, "recordId" | "recordHash">;

function identify<T extends RecordWithoutIdentity>(record: T): T & Readonly<{ recordId: string; recordHash: string }> {
  const prefix = record.recordType === "analysis" ? "analysis" : "decision";
  const recordId = `${prefix}_${sha256(stableStringify(record)).slice(0, 20)}`;
  const recordHash = sha256(stableStringify({ ...record, recordId }));
  return Object.freeze({ ...record, recordId, recordHash }) as unknown as T & Readonly<{
    recordId: string;
    recordHash: string;
  }>;
}

function previous(ledger: DecisionLedger): Readonly<{ sequence: number; hash: string }> {
  if (!verifyDecisionLedger(ledger)) throw new DecisionLedgerError("invalid_chain");
  const last = ledger.at(-1);
  return { sequence: ledger.length + 1, hash: last?.recordHash ?? "GENESIS" };
}

function expectedIdentity(record: AnalysisLedgerRecord | DecisionLedgerRecord): Readonly<{ id: string; hash: string }> {
  const { recordId: _recordId, recordHash: _recordHash, ...body } = record;
  const rebuilt = identify(body);
  return { id: rebuilt.recordId, hash: rebuilt.recordHash };
}

export function verifyDecisionLedger(ledger: DecisionLedger): boolean {
  try {
    if (!Array.isArray(ledger)) return false;
    let previousHash = "GENESIS";
    for (const [index, record] of ledger.entries()) {
      if (!record || typeof record !== "object" || Array.isArray(record)
        || !["analysis", "decision"].includes(record.recordType)
        || record.version !== DECISION_LEDGER_VERSION || record.sequence !== index + 1
        || record.previousHash !== previousHash || timestamp(record.occurredAt) !== record.occurredAt
        || !record.workspaceRef.trim() || !/^(?:GENESIS|[a-f0-9]{64})$/.test(record.previousHash)
        || !/^(?:analysis|decision)_[a-f0-9]{20}$/.test(record.recordId)
        || !/^[a-f0-9]{64}$/.test(record.recordHash)) return false;

      const allowed = record.recordType === "analysis"
        ? [
          "version", "recordType", "sequence", "previousHash", "workspaceRef", "occurredAt", "recordId", "recordHash",
          "analysisDefinitionRef", "effectiveContextRef", "timelineRefs", "evidenceRefs", "frozenContext", "actionAuthority",
        ]
        : [
          "version", "recordType", "sequence", "previousHash", "workspaceRef", "occurredAt", "recordId", "recordHash",
          "analysisRecordRef", "cadenceResultRef", "disposition", "evidenceRefs", "timelineRefs", "guidanceRefs",
          "experimentRef", "rationaleCode", "executionAuthority",
        ];
      if (Object.keys(record).some((key) => !allowed.includes(key))) return false;

      if (record.recordType === "analysis") {
        if (record.actionAuthority !== "none" || !record.analysisDefinitionRef.trim() || !record.effectiveContextRef.trim()
          || JSON.stringify(record.timelineRefs) !== JSON.stringify(uniqueRefs(record.timelineRefs))
          || JSON.stringify(record.evidenceRefs) !== JSON.stringify(uniqueRefs(record.evidenceRefs))
          || !inspectMetaPersistenceWrite(record.frozenContext).compliant || hasAuthorityEscalation(record.frozenContext)
          || stableStringify(record.frozenContext) !== JSON.stringify(record.frozenContext)) return false;
      } else if (record.executionAuthority !== "none"
        || !["act", "test", "observe", "no_change", "blocked"].includes(record.disposition)
        || !record.analysisRecordRef.trim() || !record.cadenceResultRef.trim() || !record.rationaleCode.trim()
        || (record.experimentRef !== null && !record.experimentRef.trim())
        || JSON.stringify(record.timelineRefs) !== JSON.stringify(uniqueRefs(record.timelineRefs))
        || JSON.stringify(record.evidenceRefs) !== JSON.stringify(uniqueRefs(record.evidenceRefs))
        || JSON.stringify(record.guidanceRefs) !== JSON.stringify(uniqueRefs(record.guidanceRefs))) return false;

      const expected = expectedIdentity(record);
      if (record.recordId !== expected.id || record.recordHash !== expected.hash) return false;
      previousHash = record.recordHash;
    }
    return true;
  } catch {
    return false;
  }
}

export function appendAnalysisRecord(
  ledger: DecisionLedger,
  input: Readonly<{
    workspaceRef: string;
    occurredAt: string;
    analysisDefinitionRef: string;
    effectiveContextRef: string;
    timelineRefs: readonly string[];
    evidenceRefs: readonly string[];
    frozenContext: unknown;
  }>,
): Readonly<{ ledger: DecisionLedger; record: AnalysisLedgerRecord }> {
  exactKeys(input, [
    "workspaceRef", "occurredAt", "analysisDefinitionRef", "effectiveContextRef",
    "timelineRefs", "evidenceRefs", "frozenContext",
  ]);
  if (!inspectMetaPersistenceWrite(input.frozenContext).compliant || hasAuthorityEscalation(input.frozenContext)) {
    throw new DecisionLedgerError("invalid_input");
  }
  const head = previous(ledger);
  const record = identify({
    version: DECISION_LEDGER_VERSION,
    recordType: "analysis" as const,
    sequence: head.sequence,
    previousHash: head.hash,
    workspaceRef: required(input.workspaceRef),
    occurredAt: timestamp(input.occurredAt),
    analysisDefinitionRef: required(input.analysisDefinitionRef),
    effectiveContextRef: required(input.effectiveContextRef),
    timelineRefs: uniqueRefs(input.timelineRefs),
    evidenceRefs: uniqueRefs(input.evidenceRefs),
    frozenContext: canonicalJson(input.frozenContext),
    actionAuthority: "none" as const,
  }) as AnalysisLedgerRecord;
  return Object.freeze({ ledger: Object.freeze([...ledger, record]), record });
}

export function appendDecisionRecord(
  ledger: DecisionLedger,
  input: Readonly<{
    workspaceRef: string;
    occurredAt: string;
    analysisRecordRef: string;
    cadenceResultRef: string;
    disposition: DecisionDisposition;
    evidenceRefs: readonly string[];
    timelineRefs: readonly string[];
    guidanceRefs: readonly string[];
    experimentRef: string | null;
    rationaleCode: string;
  }>,
): Readonly<{ ledger: DecisionLedger; record: DecisionLedgerRecord }> {
  exactKeys(input, [
    "workspaceRef", "occurredAt", "analysisRecordRef", "cadenceResultRef", "disposition",
    "evidenceRefs", "timelineRefs", "guidanceRefs", "experimentRef", "rationaleCode",
  ]);
  if (!["act", "test", "observe", "no_change", "blocked"].includes(input.disposition)) {
    throw new DecisionLedgerError("invalid_input");
  }
  const analysis = ledger.find((record): record is AnalysisLedgerRecord => (
    record.recordType === "analysis" && record.recordId === input.analysisRecordRef
  ));
  if (!analysis) throw new DecisionLedgerError("analysis_missing");
  if (analysis.workspaceRef !== input.workspaceRef) throw new DecisionLedgerError("scope_mismatch");
  const occurredAt = timestamp(input.occurredAt);
  if (occurredAt < analysis.occurredAt) throw new DecisionLedgerError("invalid_input");
  const head = previous(ledger);
  const record = identify({
    version: DECISION_LEDGER_VERSION,
    recordType: "decision" as const,
    sequence: head.sequence,
    previousHash: head.hash,
    workspaceRef: required(input.workspaceRef),
    occurredAt,
    analysisRecordRef: analysis.recordId,
    cadenceResultRef: required(input.cadenceResultRef),
    disposition: input.disposition,
    evidenceRefs: uniqueRefs(input.evidenceRefs),
    timelineRefs: uniqueRefs(input.timelineRefs),
    guidanceRefs: uniqueRefs(input.guidanceRefs),
    experimentRef: input.experimentRef === null ? null : required(input.experimentRef),
    rationaleCode: required(input.rationaleCode),
    executionAuthority: "none" as const,
  }) as DecisionLedgerRecord;
  return Object.freeze({ ledger: Object.freeze([...ledger, record]), record });
}
