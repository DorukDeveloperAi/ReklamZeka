import { createHash } from "node:crypto";
import { buildAnalysisAgenda, type AnalysisPassKey } from "@/analyses/agenda";
import type { DeterministicAnalysisRun } from "@/analyses/deterministic-analysis";
import type { EffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import {
  buildDeterministicFindings,
  type DeterministicFindingRun,
  type FindingHierarchyNode,
  type FindingMetricBundle,
  type FindingPassAssignment,
} from "@/analyses/finding-engine";
import type { ResolvedAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import {
  evaluateDecisionCadence,
  evaluateExperiment,
  type DecisionCadenceResult,
  type ExperimentOutcome,
} from "@/domain/decisions/cadence";
import {
  appendAnalysisRecord,
  appendDecisionRecord,
  verifyDecisionLedger,
  type AnalysisLedgerRecord,
  type DecisionLedger,
  type DecisionLedgerRecord,
} from "@/domain/decisions/ledger";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";

export const DECISION_ROOM_VERSION = "decision-room/1.0.0" as const;

type CadenceInput = Parameters<typeof evaluateDecisionCadence>[0];
type ExperimentInput = Parameters<typeof evaluateExperiment>[0];

export type DecisionRoomStatus = "draft" | "advisory" | "observe" | "no_change";

export type DecisionRoomInput = Readonly<{
  workspaceRef: string;
  occurredAt: string;
  context: EffectiveCampaignContext;
  resolvedTimeframe: ResolvedAnalysisTimeframe;
  agenda?: Readonly<{
    requestedPasses?: readonly AnalysisPassKey[];
    selection?: Readonly<{
      categoryDimensionKeys?: readonly string[];
      categoryDefinitions?: readonly Readonly<{ dimensionKey: string; definitionKey: string }>[];
      guidanceTopics?: readonly string[];
    }>;
  }>;
  analysis: DeterministicAnalysisRun;
  findingInput: Readonly<{
    hierarchy: readonly FindingHierarchyNode[];
    metricBundles: readonly FindingMetricBundle[];
    passAssignments?: readonly FindingPassAssignment[];
  }>;
  cadence: Omit<CadenceInput, "evidence"> & Readonly<{ evidenceScore: number }>;
  experiment?: ExperimentInput;
}>;

export type DecisionRoomDraftPort = Readonly<{
  readLedger(input: Readonly<{ workspaceRef: string }>): Promise<DecisionLedger>;
  stageDraft(input: Readonly<{
    workspaceRef: string;
    requestRef: string;
    draftRef: string;
    expectedHeadHash: string;
    ledger: DecisionLedger;
  }>): Promise<void>;
}>;

export type DecisionRoomResult = Readonly<{
  contractVersion: typeof DECISION_ROOM_VERSION;
  roomRunRef: string;
  requestRef: string;
  draftRef: string;
  status: DecisionRoomStatus;
  agendaRef: string;
  findingRunRef: string;
  cadence: Readonly<{
    resultRef: string;
    outcome: DecisionRoomStatus;
    reason: DecisionCadenceResult["reason"];
    evaluatedAt: string;
    nextEligibleAt: string | null;
    evidenceHash: string;
    recommendationCapability: DecisionCadenceResult["recommendationCapability"];
    actionAuthority: "none";
  }>;
  experiment: ExperimentOutcome | null;
  findingSummary: Readonly<{
    total: number;
    eligible: number;
    suppressed: number;
    insufficientData: number;
  }>;
  analysisRecordRef: string;
  decisionRecordRef: string | null;
  capabilities: Readonly<{
    mode: "read_draft";
    modelAgnostic: true;
    canAuthorizeAction: false;
    canExecuteWrite: false;
    canCallWriteTool: false;
  }>;
}>;

export class DecisionRoomError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "forbidden_material"
    | "inauthentic_component"
    | "invalid_ledger"
    | "port_failure") {
    super(`Decision Room güvenli biçimde çalıştırılamadı: ${code}`);
    this.name = "DecisionRoomError";
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

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function exactKeys(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new DecisionRoomError("forbidden_material");
  }
}

function required(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 256) {
    throw new DecisionRoomError("invalid_input");
  }
  return value.trim();
}

function inspectBoundary(value: unknown, seen = new Set<object>()): void {
  if (value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value)) return;
  if (typeof value !== "object" || seen.has(value as object)
    || value instanceof Uint8Array || value instanceof ArrayBuffer) {
    throw new DecisionRoomError("forbidden_material");
  }
  seen.add(value as object);
  if (Array.isArray(value)) {
    value.forEach((entry) => inspectBoundary(entry, seen));
    seen.delete(value);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new DecisionRoomError("forbidden_material");
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const forbiddenControl = normalized.includes("prompt") || normalized.endsWith("tool") || normalized.endsWith("tools");
    const authorityField = [
      "actionauthority", "executionauthority", "writeauthority", "approvalgranted",
      "canwrite", "writeenabled", "canexecutewrite", "cancallwritetool", "canauthorizeaction",
    ].includes(normalized);
    const benignAuthority = child === false || child === "none" || child === "guidance_only";
    if (forbiddenControl || (authorityField && !benignAuthority)) {
      throw new DecisionRoomError("forbidden_material");
    }
    inspectBoundary(child, seen);
  }
  seen.delete(value);
}

function validateShape(input: DecisionRoomInput): void {
  exactKeys(input, [
    "workspaceRef", "occurredAt", "context", "resolvedTimeframe", "agenda", "analysis",
    "findingInput", "cadence", "experiment",
  ]);
  if (input.agenda) exactKeys(input.agenda, ["requestedPasses", "selection"]);
  exactKeys(input.findingInput, ["hierarchy", "metricBundles", "passAssignments"]);
  exactKeys(input.analysis, [
    "contractVersion", "runId", "definitionRef", "contextRef", "snapshotRefs", "resolvedTimeframe", "records",
  ]);
  if (!Array.isArray(input.analysis.records) || !Array.isArray(input.analysis.snapshotRefs)
    || !Array.isArray(input.findingInput.hierarchy) || !Array.isArray(input.findingInput.metricBundles)
    || (input.findingInput.passAssignments !== undefined && !Array.isArray(input.findingInput.passAssignments))) {
    throw new DecisionRoomError("invalid_input");
  }
  for (const record of input.analysis.records) {
    exactKeys(record, [
      "recordId", "checkKey", "entityRef", "metricKey", "status", "missingDataReason", "sourceSnapshotRefs",
    ]);
  }
  exactKeys(input.cadence, [
    "profile", "now", "observationStartedAt", "lastMaterialChangeAt", "learning", "lastDecision",
    "recentDecisions", "evidenceScore", "requestedDisposition", "recommendationSource", "emergencyGuardrail",
  ]);
  if (input.cadence.recommendationSource === "prompt") throw new DecisionRoomError("forbidden_material");
  required(input.workspaceRef);
  if (!Number.isFinite(Date.parse(input.occurredAt)) || !Number.isFinite(Date.parse(input.cadence.now))
    || Date.parse(input.occurredAt) !== Date.parse(input.cadence.now)
    || !Number.isFinite(input.cadence.evidenceScore)
    || input.cadence.evidenceScore < 0 || input.cadence.evidenceScore > 1) {
    throw new DecisionRoomError("invalid_input");
  }
  if (!inspectMetaPersistenceWrite(input).compliant) throw new DecisionRoomError("forbidden_material");
  inspectBoundary(input);
}

function roomStatus(
  findings: DeterministicFindingRun,
  cadence: DecisionCadenceResult,
  experiment: ExperimentOutcome | null,
): DecisionRoomStatus {
  const visibleFindings = findings.findings.filter((finding) => finding.state === "finding");
  const eligible = visibleFindings.filter((finding) => finding.suppression.proposalEligibility === "eligible");
  if (visibleFindings.length === 0) return "no_change";
  if (eligible.length === 0) return "advisory";
  if (cadence.disposition === "observe") return "observe";
  if (cadence.disposition === "no_change" || cadence.disposition === "blocked") return "no_change";
  if (experiment?.status === "inconclusive") return "observe";
  if (experiment?.status === "loser" || experiment?.status === "guardrail_stopped") return "advisory";
  return "draft";
}

function frozenRequestRef(record: AnalysisLedgerRecord): string | null {
  const frozen = record.frozenContext;
  if (!frozen || typeof frozen !== "object" || Array.isArray(frozen)) return null;
  const value = (frozen as Readonly<Record<string, unknown>>).requestRef;
  return typeof value === "string" ? value : null;
}

function existingRecords(ledger: DecisionLedger, requestRef: string): Readonly<{
  analysis: AnalysisLedgerRecord;
  decision: DecisionLedgerRecord | null;
}> | null {
  const rationaleCode = `decision_room:${requestRef}`;
  const decision = ledger.find((record): record is DecisionLedgerRecord => (
    record.recordType === "decision" && record.rationaleCode === rationaleCode
  ));
  const analysis = ledger.find((record): record is AnalysisLedgerRecord => (
    record.recordType === "analysis"
    && (frozenRequestRef(record) === requestRef || record.recordId === decision?.analysisRecordRef)
  ));
  if (!analysis && !decision) return null;
  if (!analysis) throw new DecisionRoomError("invalid_ledger");
  if (decision && decision.analysisRecordRef !== analysis.recordId) throw new DecisionRoomError("invalid_ledger");
  return Object.freeze({ analysis, decision: decision ?? null });
}

/** One model-agnostic entrypoint shared by dashboard and local CLI adapters. */
export async function runDecisionRoom(
  input: DecisionRoomInput,
  port: DecisionRoomDraftPort,
): Promise<DecisionRoomResult> {
  validateShape(input);
  exactKeys(port, ["readLedger", "stageDraft"]);
  if (typeof port.readLedger !== "function" || typeof port.stageDraft !== "function") {
    throw new DecisionRoomError("invalid_input");
  }

  let agenda;
  let findings;
  let cadence;
  let experiment: ExperimentOutcome | null;
  try {
    agenda = buildAnalysisAgenda({
      context: input.context,
      resolvedTimeframe: input.resolvedTimeframe,
      ...(input.agenda?.requestedPasses ? { requestedPasses: input.agenda.requestedPasses } : {}),
      ...(input.agenda?.selection ? { selection: input.agenda.selection } : {}),
    });
    findings = buildDeterministicFindings({
      agenda,
      context: input.context,
      analysis: input.analysis,
      hierarchy: input.findingInput.hierarchy,
      metricBundles: input.findingInput.metricBundles,
      ...(input.findingInput.passAssignments ? { passAssignments: input.findingInput.passAssignments } : {}),
    });
    const evidenceRefs = findings.findings.map((finding) => finding.findingId).sort(compareText);
    cadence = evaluateDecisionCadence({
      profile: input.cadence.profile,
      now: input.cadence.now,
      observationStartedAt: input.cadence.observationStartedAt,
      lastMaterialChangeAt: input.cadence.lastMaterialChangeAt,
      learning: input.cadence.learning,
      lastDecision: input.cadence.lastDecision,
      recentDecisions: input.cadence.recentDecisions,
      evidence: { refs: evidenceRefs, score: input.cadence.evidenceScore },
      requestedDisposition: input.cadence.requestedDisposition,
      recommendationSource: input.cadence.recommendationSource,
      emergencyGuardrail: input.cadence.emergencyGuardrail,
    });
    experiment = input.experiment ? evaluateExperiment(input.experiment) : null;
  } catch (error) {
    if (error instanceof DecisionRoomError) throw error;
    throw new DecisionRoomError("inauthentic_component");
  }

  const status = roomStatus(findings, cadence, experiment);
  const requestCore = {
    workspaceRef: required(input.workspaceRef),
    occurredAt: new Date(input.occurredAt).toISOString(),
    contextRef: input.context.contextHash,
    agendaRef: agenda.agendaId,
    analysisRef: input.analysis.runId,
    findingRunRef: findings.findingRunId,
    cadenceRef: cadence.resultRef,
    experimentRef: experiment?.experimentRef ?? null,
    status,
  };
  const requestRef = `room_request_${digest(requestCore).slice(0, 24)}`;
  const draftRef = `room_draft_${digest({ requestRef }).slice(0, 24)}`;

  let initialLedger: DecisionLedger;
  try {
    initialLedger = await port.readLedger({ workspaceRef: requestCore.workspaceRef });
  } catch {
    throw new DecisionRoomError("port_failure");
  }
  if (!verifyDecisionLedger(initialLedger)
    || initialLedger.some((record) => record.workspaceRef !== requestCore.workspaceRef)) {
    throw new DecisionRoomError("invalid_ledger");
  }
  const existing = existingRecords(initialLedger, requestRef);
  let ledgerDraft = initialLedger;
  let analysisRecord = existing?.analysis;
  let decisionRecord = existing?.decision ?? null;
  let changed = false;
  if (!analysisRecord) {
    const evidenceRefs = findings.findings.map((finding) => finding.findingId);
    const analysisAppend = appendAnalysisRecord(ledgerDraft, {
      workspaceRef: requestCore.workspaceRef,
      occurredAt: requestCore.occurredAt,
      analysisDefinitionRef: input.analysis.definitionRef,
      effectiveContextRef: input.context.contextHash,
      timelineRefs: input.context.history.changeRefs,
      evidenceRefs,
      frozenContext: {
        requestRef,
        agendaRef: agenda.agendaId,
        analysisRef: input.analysis.runId,
        findingRunRef: findings.findingRunId,
        selectionRefs: agenda.selectionRefs,
        status,
      },
    });
    analysisRecord = analysisAppend.record;
    ledgerDraft = analysisAppend.ledger;
    changed = true;
  }
  if (!decisionRecord && (status === "observe" || status === "no_change")) {
    const evidenceRefs = findings.findings.map((finding) => finding.findingId);
    const guidanceRefs = input.context.guidance.applied
      .filter((card) => agenda.selectionRefs.guidanceTopics.includes(card.topic))
      .map((card) => card.cardId);
    const decisionAppend = appendDecisionRecord(ledgerDraft, {
      workspaceRef: requestCore.workspaceRef,
      occurredAt: requestCore.occurredAt,
      analysisRecordRef: analysisRecord!.recordId,
      cadenceResultRef: cadence.resultRef,
      disposition: status,
      evidenceRefs,
      timelineRefs: input.context.history.changeRefs,
      guidanceRefs,
      experimentRef: experiment?.experimentRef ?? null,
      rationaleCode: `decision_room:${requestRef}`,
    });
    ledgerDraft = decisionAppend.ledger;
    decisionRecord = decisionAppend.record;
    changed = true;
  }
  if (changed) {
    try {
      await port.stageDraft({
        workspaceRef: requestCore.workspaceRef,
        requestRef,
        draftRef,
        expectedHeadHash: initialLedger.at(-1)?.recordHash ?? "GENESIS",
        ledger: ledgerDraft,
      });
    } catch {
      throw new DecisionRoomError("port_failure");
    }
  }

  const findingSummary = Object.freeze({
    total: findings.findings.length,
    eligible: findings.findings.filter((finding) => finding.suppression.proposalEligibility === "eligible").length,
    suppressed: findings.findings.filter((finding) => finding.suppression.proposalEligibility === "suppressed").length,
    insufficientData: findings.findings.filter((finding) => finding.state === "insufficient_data").length,
  });
  const roomRunRef = `decision_room_${digest({ requestRef, analysisRecordRef: analysisRecord!.recordId,
    decisionRecordRef: decisionRecord?.recordId ?? null }).slice(0, 24)}`;
  return Object.freeze({
    contractVersion: DECISION_ROOM_VERSION,
    roomRunRef,
    requestRef,
    draftRef,
    status,
    agendaRef: agenda.agendaId,
    findingRunRef: findings.findingRunId,
    cadence: Object.freeze({
      resultRef: cadence.resultRef,
      outcome: status,
      reason: cadence.reason,
      evaluatedAt: cadence.evaluatedAt,
      nextEligibleAt: cadence.nextEligibleAt,
      evidenceHash: cadence.evidenceHash,
      recommendationCapability: cadence.recommendationCapability,
      actionAuthority: "none" as const,
    }),
    experiment,
    findingSummary,
    analysisRecordRef: analysisRecord!.recordId,
    decisionRecordRef: decisionRecord?.recordId ?? null,
    capabilities: Object.freeze({
      mode: "read_draft" as const,
      modelAgnostic: true as const,
      canAuthorizeAction: false as const,
      canExecuteWrite: false as const,
      canCallWriteTool: false as const,
    }),
  });
}
