import { createHash } from "node:crypto";

import type { SliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";
import { verifySliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";
import type { DeliveryHealthAlertLedgerRecord } from "@/domain/meta/delivery-health-alert-ledger";
import { appendAnalysisRecord, appendDecisionRecord, verifyDecisionLedger, type AnalysisLedgerRecord, type DecisionLedger, type DecisionLedgerRecord } from "@/domain/decisions/ledger";

/**
 * A small, deliberately advisory temporal evaluation over artifacts that are
 * already frozen and persisted elsewhere.  It does not read Meta, publish a
 * rule, or create an executable action.
 */
export const TEMPORAL_RECOMMENDATION_VERSION = "temporal-recommendation/1.0.0" as const;

export type TemporalRecommendationWindow = Readonly<{
  windowRef: string;
  accountRef: string;
  startedAt: string;
  endedAt: string;
  settled: boolean;
  evidenceRefs: readonly string[];
}>;

export type TemporalRecommendationInput = Readonly<{
  workspaceRef: string;
  occurredAt: string;
  frozenContextRef: string;
  ruleDraft: SliceRuleWorkspaceDraft;
  window: TemporalRecommendationWindow;
  openDeliveryAlerts: readonly DeliveryHealthAlertLedgerRecord[];
}>;

export type TemporalRecommendationPort = Readonly<{
  readLedger(input: Readonly<{ workspaceRef: string }>): Promise<DecisionLedger>;
  appendSuffix(input: Readonly<{ workspaceRef: string; expectedHeadHash: string; ledger: DecisionLedger }>): Promise<void>;
}>;

export type TemporalRecommendationResult = Readonly<{
  contractVersion: typeof TEMPORAL_RECOMMENDATION_VERSION;
  evaluationRef: string;
  outcome: "recommendation" | "no_change";
  reason: "window_ready" | "window_unsettled" | "window_too_short" | "open_delivery_alert";
  heldByAlertRefs: readonly string[];
  analysisRecordRef: string;
  decisionRecordRef: string;
  persistence: "inserted" | "unchanged";
  authority: Readonly<{ canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false; canEnableAutomation: false }>;
}>;

export class TemporalRecommendationError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_ledger" | "port_failure") {
    super(`Temporal recommendation rejected: ${code}`);
    this.name = "TemporalRecommendationError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const AUTHORITY = Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canEnableAutomation: false as const });

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TemporalRecommendationError("invalid_input");
  return value;
}
function refs(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !REF.test(entry))) throw new TemporalRecommendationError("invalid_input");
  return Object.freeze([...new Set(value)].sort());
}
function required(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) throw new TemporalRecommendationError("invalid_input");
  return value;
}
function expectedWindowMs(reviewCadence: SliceRuleWorkspaceDraft["operatingRule"]["verification"]["reviewCadence"]): number {
  return (reviewCadence === "daily" ? 1 : reviewCadence === "weekly" ? 7 : 30) * 86_400_000;
}

function validate(input: TemporalRecommendationInput): Readonly<{ occurredAt: string; window: TemporalRecommendationWindow }> {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["workspaceRef", "occurredAt", "frozenContextRef", "ruleDraft", "window", "openDeliveryAlerts"].includes(key))
    || !HASH.test(input.frozenContextRef) || !verifySliceRuleWorkspaceDraft(input.ruleDraft)
    || !Array.isArray(input.openDeliveryAlerts) || !input.openDeliveryAlerts.every((alert) => alert && typeof alert === "object")) throw new TemporalRecommendationError("invalid_input");
  required(input.workspaceRef);
  const occurredAt = instant(input.occurredAt);
  const window = input.window;
  if (!window || typeof window !== "object" || Array.isArray(window)
    || Object.keys(window).some((key) => !["windowRef", "accountRef", "startedAt", "endedAt", "settled", "evidenceRefs"].includes(key))
    || typeof window.settled !== "boolean") throw new TemporalRecommendationError("invalid_input");
  required(window.windowRef); required(window.accountRef); refs(window.evidenceRefs);
  const startedAt = instant(window.startedAt); const endedAt = instant(window.endedAt);
  if (Date.parse(startedAt) >= Date.parse(endedAt) || Date.parse(endedAt) > Date.parse(occurredAt)) throw new TemporalRecommendationError("invalid_input");
  return Object.freeze({ occurredAt, window: Object.freeze({ ...window, startedAt, endedAt, evidenceRefs: refs(window.evidenceRefs) }) });
}

function evaluationRef(input: TemporalRecommendationInput, window: TemporalRecommendationWindow, heldByAlerts: readonly DeliveryHealthAlertLedgerRecord[]): string {
  return `temporal_evaluation_${digest({ context: input.frozenContextRef, draft: input.ruleDraft.draftHash, window: {
    ref: window.windowRef, account: window.accountRef, startedAt: window.startedAt, endedAt: window.endedAt,
    settled: window.settled, evidenceRefs: window.evidenceRefs },
  heldByAlerts: heldByAlerts.map((alert) => ({ alertRef: alert.alert.alertRef, recordHash: alert.recordHash })).sort((left, right) => left.alertRef.localeCompare(right.alertRef)) }).slice(0, 24)}`;
}

function existing(ledger: DecisionLedger, ref: string): Readonly<{ analysis: AnalysisLedgerRecord; decision: DecisionLedgerRecord }> | null {
  const analysis = ledger.find((record): record is AnalysisLedgerRecord => record.recordType === "analysis"
    && typeof (record.frozenContext as Record<string, unknown>).temporalEvaluationRef === "string"
    && (record.frozenContext as Record<string, unknown>).temporalEvaluationRef === ref);
  if (!analysis) return null;
  const decision = ledger.find((record): record is DecisionLedgerRecord => record.recordType === "decision" && record.analysisRecordRef === analysis.recordId);
  if (!decision) throw new TemporalRecommendationError("invalid_ledger");
  return Object.freeze({ analysis, decision });
}

/** Evaluates one immutable time window and persists its analysis/decision suffix exactly once. */
export async function evaluateTemporalRecommendation(input: TemporalRecommendationInput, port: TemporalRecommendationPort): Promise<TemporalRecommendationResult> {
  const normalized = validate(input);
  if (!port || typeof port.readLedger !== "function" || typeof port.appendSuffix !== "function") throw new TemporalRecommendationError("invalid_input");
  let ledger: DecisionLedger;
  try { ledger = await port.readLedger({ workspaceRef: input.workspaceRef }); }
  catch { throw new TemporalRecommendationError("port_failure"); }
  if (!verifyDecisionLedger(ledger) || ledger.some((record) => record.workspaceRef !== input.workspaceRef)) throw new TemporalRecommendationError("invalid_ledger");
  const heldAlerts = Object.freeze(input.openDeliveryAlerts.filter((alert) => alert.alert.workspaceRef === input.workspaceRef
    && alert.alert.accountRef === normalized.window.accountRef && alert.current.status !== "resolved")
    .sort((left, right) => left.alert.alertRef.localeCompare(right.alert.alertRef)));
  const heldByAlertRefs = Object.freeze(heldAlerts.map((alert) => alert.alert.alertRef));
  const ref = evaluationRef(input, normalized.window, heldAlerts);
  const already = existing(ledger, ref);
  const duration = Date.parse(normalized.window.endedAt) - Date.parse(normalized.window.startedAt);
  const reason = heldByAlertRefs.length ? "open_delivery_alert" as const : !normalized.window.settled ? "window_unsettled" as const
    : duration < expectedWindowMs(input.ruleDraft.operatingRule.verification.reviewCadence) ? "window_too_short" as const : "window_ready" as const;
  const outcome = reason === "window_ready" ? "recommendation" as const : "no_change" as const;
  if (already) return Object.freeze({ contractVersion: TEMPORAL_RECOMMENDATION_VERSION, evaluationRef: ref, outcome,
    reason, heldByAlertRefs, analysisRecordRef: already.analysis.recordId, decisionRecordRef: already.decision.recordId,
    persistence: "unchanged", authority: AUTHORITY });
  const analysis = appendAnalysisRecord(ledger, { workspaceRef: input.workspaceRef, occurredAt: normalized.occurredAt,
    analysisDefinitionRef: "temporal-recommendation", effectiveContextRef: input.frozenContextRef,
    timelineRefs: [normalized.window.windowRef], evidenceRefs: normalized.window.evidenceRefs,
    frozenContext: { temporalEvaluationRef: ref, frozenContextRef: input.frozenContextRef,
      ruleDraftRef: input.ruleDraft.draftRef, ruleDraftHash: input.ruleDraft.draftHash,
      window: { ref: normalized.window.windowRef, accountRef: normalized.window.accountRef, startedAt: normalized.window.startedAt,
        endedAt: normalized.window.endedAt, settled: normalized.window.settled }, heldByAlertRefs, authority: AUTHORITY } });
  const decision = appendDecisionRecord(analysis.ledger, { workspaceRef: input.workspaceRef, occurredAt: normalized.occurredAt,
    analysisRecordRef: analysis.record.recordId, cadenceResultRef: `temporal:${reason}`, disposition: outcome === "recommendation" ? "act" : "no_change",
    evidenceRefs: normalized.window.evidenceRefs, timelineRefs: [normalized.window.windowRef], guidanceRefs: [], experimentRef: null,
    rationaleCode: `temporal_recommendation:${ref}:${reason}` });
  try { await port.appendSuffix({ workspaceRef: input.workspaceRef, expectedHeadHash: ledger.at(-1)?.recordHash ?? "GENESIS", ledger: decision.ledger }); }
  catch { throw new TemporalRecommendationError("port_failure"); }
  return Object.freeze({ contractVersion: TEMPORAL_RECOMMENDATION_VERSION, evaluationRef: ref, outcome, reason, heldByAlertRefs,
    analysisRecordRef: analysis.record.recordId, decisionRecordRef: decision.record.recordId, persistence: "inserted", authority: AUTHORITY });
}
