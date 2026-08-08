import { createHash } from "node:crypto";
import {
  validateResolvedAnalysisTimeframe,
  type ResolvedAnalysisTimeframe,
} from "./timeframe-resolver";

export const DETERMINISTIC_ANALYSIS_CONTRACT_VERSION = "deterministic-analysis/1.0.0" as const;

export type DeterministicAnalysisStatus = "finding" | "clear" | "insufficient_data";

export type DeterministicAnalysisCandidate = Readonly<{
  checkKey: string;
  entityRef: string;
  metricKey: string;
  status: DeterministicAnalysisStatus;
  missingDataReason?: string;
  sourceSnapshotRefs: readonly string[];
}>;

export type DeterministicAnalysisRecord = Readonly<DeterministicAnalysisCandidate & {
  recordId: string;
}>;

export type DeterministicAnalysisInput = Readonly<{
  definitionRef: string;
  contextRef: string;
  snapshotRefs: readonly string[];
  resolvedTimeframe: ResolvedAnalysisTimeframe;
  candidates: readonly DeterministicAnalysisCandidate[];
}>;

export type DeterministicAnalysisRun = Readonly<{
  contractVersion: typeof DETERMINISTIC_ANALYSIS_CONTRACT_VERSION;
  runId: string;
  definitionRef: string;
  contextRef: string;
  snapshotRefs: readonly string[];
  resolvedTimeframe: ResolvedAnalysisTimeframe;
  records: readonly DeterministicAnalysisRecord[];
}>;

export class DeterministicAnalysisContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeterministicAnalysisContractError";
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requireRef(value: string, label: string): void {
  if (!value.trim() || value.length > 256) throw new DeterministicAnalysisContractError(`${label} dolu ve en fazla 256 karakter olmalıdır`);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[], label: string): readonly string[] {
  values.forEach((value) => requireRef(value, label));
  const sorted = [...new Set(values)].sort(compareStrings);
  if (sorted.length !== values.length) throw new DeterministicAnalysisContractError(`${label} benzersiz olmalıdır`);
  return Object.freeze(sorted);
}

/**
 * Saf L3/L4 sınırı: hesaplama adaylarını kaynak snapshot/context bağlarıyla sabitler.
 * Metrik hesabı, ağ/DB erişimi, clock veya model çağrısı bu sözleşmenin dışındadır.
 */
export function analyze(input: DeterministicAnalysisInput): DeterministicAnalysisRun {
  requireRef(input.definitionRef, "definitionRef");
  requireRef(input.contextRef, "contextRef");
  const snapshotRefs = uniqueSorted(input.snapshotRefs, "snapshotRef");
  if (snapshotRefs.length === 0) throw new DeterministicAnalysisContractError("En az bir snapshotRef zorunludur");
  const allowedSnapshots = new Set(snapshotRefs);
  validateResolvedAnalysisTimeframe(input.resolvedTimeframe);

  const normalized = input.candidates.map((candidate) => {
    requireRef(candidate.checkKey, "checkKey");
    requireRef(candidate.entityRef, "entityRef");
    requireRef(candidate.metricKey, "metricKey");
    if (!["finding", "clear", "insufficient_data"].includes(candidate.status)) {
      throw new DeterministicAnalysisContractError("Analiz kayıt durumu geçersizdir");
    }
    const sourceSnapshotRefs = uniqueSorted(candidate.sourceSnapshotRefs, "sourceSnapshotRef");
    if (sourceSnapshotRefs.length === 0 || sourceSnapshotRefs.some((ref) => !allowedSnapshots.has(ref))) {
      throw new DeterministicAnalysisContractError("Her kayıt run snapshotRefs kümesine bağlı en az bir sourceSnapshotRef taşımalıdır");
    }
    if (candidate.status === "insufficient_data") {
      if (!candidate.missingDataReason?.trim()) throw new DeterministicAnalysisContractError("Eksik veri kaydı sebepsiz olamaz");
    } else if (candidate.missingDataReason !== undefined) {
      throw new DeterministicAnalysisContractError("missingDataReason yalnız insufficient_data durumunda kullanılabilir");
    }
    const canonical = {
      checkKey: candidate.checkKey,
      entityRef: candidate.entityRef,
      metricKey: candidate.metricKey,
      status: candidate.status,
      missingDataReason: candidate.missingDataReason,
      sourceSnapshotRefs,
    };
    return Object.freeze({ recordId: `finding_${hash(canonical).slice(0, 24)}`, ...canonical });
  }).sort((left, right) =>
    compareStrings(left.entityRef, right.entityRef) ||
    compareStrings(left.checkKey, right.checkKey) ||
    compareStrings(left.metricKey, right.metricKey) ||
    compareStrings(left.status, right.status));

  if (new Set(normalized.map((record) => record.recordId)).size !== normalized.length) {
    throw new DeterministicAnalysisContractError("Aynı deterministik analiz kaydı birden fazla kez verilemez");
  }

  const resolvedTimeframe = Object.freeze({
    resolverVersion: input.resolvedTimeframe.resolverVersion,
    kind: input.resolvedTimeframe.kind,
    timezone: input.resolvedTimeframe.timezone,
    asOfDate: input.resolvedTimeframe.asOfDate,
    startDate: input.resolvedTimeframe.startDate,
    endDate: input.resolvedTimeframe.endDate,
    inclusiveDayCount: input.resolvedTimeframe.inclusiveDayCount,
    comparisonPolicy: input.resolvedTimeframe.comparisonPolicy,
    comparisonStartDate: input.resolvedTimeframe.comparisonStartDate,
    comparisonEndDate: input.resolvedTimeframe.comparisonEndDate,
  });

  const canonicalRun = {
    contractVersion: DETERMINISTIC_ANALYSIS_CONTRACT_VERSION,
    definitionRef: input.definitionRef,
    contextRef: input.contextRef,
    snapshotRefs,
    resolvedTimeframe,
    records: normalized,
  };
  return Object.freeze({
    ...canonicalRun,
    runId: `analysis_${hash(canonicalRun).slice(0, 24)}`,
    records: Object.freeze(normalized),
  });
}
