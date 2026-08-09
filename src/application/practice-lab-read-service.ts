import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";
import {
  replayAdvisedPractice,
  type AdvisedPracticeDefinition,
  type AdvisedPracticeEvent,
  type AdvisedPracticeState,
} from "@/domain/guidance/advised-practice";
import { advisedPracticeRevisionRef,
  type PersistedAdvisedPractice } from "@/connectors/guidance/advised-practice-drizzle-repository";

export const PRACTICE_LAB_READ_MODEL_VERSION = "practice-lab-read-model/1.0.0" as const;

const PRACTICE_REF = /^practice_[a-z0-9][a-z0-9_-]{0,86}$/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const HASH = /\b[a-f0-9]{64}\b/i;
const CREDENTIAL = /\b(?:rzs1\.|EA[A-Za-z0-9]{30,}|Bearer\s+)[A-Za-z0-9._-]*/i;

export class PracticeLabReadError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "scope_mismatch" | "unsafe_source" | "source_unavailable") {
    super("Practice Lab kaynağı güvenli biçimde okunamadı");
    this.name = "PracticeLabReadError";
  }
}

export type PracticeLabRepository = Readonly<{
  listRefs(input: Readonly<{ after: string | null; limit: number }>): Promise<readonly string[]>;
  load(practiceRef: string, version?: number): Promise<PersistedAdvisedPractice | null>;
}>;

export type PracticeLabAuthority = Readonly<{
  advisoryOnly: true;
  canPersistDraft: false;
  canCreateGuidance: false;
  canPromotePolicy: false;
  canEnableAutomation: false;
  canAuthorizeAction: false;
  canExecuteWrite: false;
}>;

export type PracticeLabSummary = Readonly<{
  practiceRef: string;
  version: number;
  problem: string;
  confidence: number;
  state: AdvisedPracticeState | null;
  outcomeStatus: "validated" | "conditional" | "rejected" | null;
  standardizationReviewStatus: "not_reviewed" | "reviewed";
  standardizationStatus: "not_candidate" | "candidate" | "standardized";
  revision: Readonly<{ definitionVersion: number; lastSequence: number; revisionRef: string }>;
  updatedAt: string;
  scope: Readonly<{
    kind: "global" | "bounded";
    objectives: readonly string[];
    internalCategories: readonly string[];
    topics: readonly string[];
    accountCount: number;
    entityCount: number;
  }>;
  sources: Readonly<{
    ownerStatementPresent: true;
    officialMetaSourceCount: number;
    evidenceCount: number;
    alignment: "aligned" | "conflicted" | "uncertain";
  }>;
  authority: PracticeLabAuthority;
}>;

export type PracticeLabTimelineItem = Readonly<{
  sequence: number;
  eventType: AdvisedPracticeEvent["eventType"];
  occurredAt: string;
  stateAfter: AdvisedPracticeState;
  note: string;
  evidenceCount: number;
}>;

export type PracticeLabDetail = PracticeLabSummary & Readonly<{
  requiredInputs: readonly string[];
  steps: readonly string[];
  rationale: string;
  cadence: string;
  exceptions: readonly string[];
  sourceReview: Readonly<{
    ownerCapturedAt: string;
    officialMetaSources: readonly Readonly<{ host: string; capturedAt: string; reviewedAt: string; reviewBy: string }>[];
    deliberation: Readonly<{ alignment: "aligned" | "conflicted" | "uncertain"; rationale: string; conflictCount: number }>;
  }>;
  timeline: readonly PracticeLabTimelineItem[];
}>;

export type PracticeLabListResult = Readonly<{
  contractVersion: typeof PRACTICE_LAB_READ_MODEL_VERSION;
  view: "list";
  items: readonly PracticeLabSummary[];
  nextCursor: string | null;
  authority: PracticeLabAuthority;
}>;

export type PracticeLabDetailResult = Readonly<{
  contractVersion: typeof PRACTICE_LAB_READ_MODEL_VERSION;
  view: "detail";
  item: PracticeLabDetail;
  authority: PracticeLabAuthority;
}>;

export type PracticeLabDraftResult = Readonly<{
  contractVersion: typeof PRACTICE_LAB_READ_MODEL_VERSION;
  view: "draft";
  draft: Readonly<{
    status: "ephemeral_unpersisted";
    practice: PracticeLabDetail;
    collaborationQuestions: readonly string[];
    requiredReview: "human";
    allowedOutcome: "conversation_draft_only";
  }>;
  authority: PracticeLabAuthority;
}>;

const AUTHORITY: PracticeLabAuthority = Object.freeze({
  advisoryOnly: true,
  canPersistDraft: false,
  canCreateGuidance: false,
  canPromotePolicy: false,
  canEnableAutomation: false,
  canAuthorizeAction: false,
  canExecuteWrite: false,
});

function safePublicValue(value: unknown): void {
  const visit = (item: unknown, seen = new Set<object>()): void => {
    if (typeof item === "string") {
      if (UUID.test(item) || HASH.test(item) || CREDENTIAL.test(item)) throw new PracticeLabReadError("unsafe_source");
      return;
    }
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    if (Array.isArray(item)) item.forEach((child) => visit(child, seen));
    else Object.entries(item as Record<string, unknown>).forEach(([key, child]) => {
      if (/(workspaceId|userId|definitionHash|eventId|eventHash|sourceRef|ownerRef|conversationRef|evidenceRefs|findingRefs|analysisRef|effectiveContextRef|trialRef|outcomeRef)/i.test(key)) {
        throw new PracticeLabReadError("unsafe_source");
      }
      visit(child, seen);
    });
  };
  visit(value);
  if (!inspectMetaPersistenceWrite(value).compliant) throw new PracticeLabReadError("unsafe_source");
}

function stateAfter(event: AdvisedPracticeEvent): AdvisedPracticeState {
  if (event.eventType === "candidate_created") return "candidate";
  if (event.eventType === "reviewed") return "reviewed";
  if (event.eventType === "trial_started") return "trial";
  if (event.eventType === "outcome_recorded") return event.result;
  if (event.eventType === "standardization_reviewed") return "standardization_reviewed";
  if (event.eventType === "standardization_candidate") return "standardization_candidate";
  if (event.eventType === "standardized") return "standardized";
  return "retired";
}

function note(event: AdvisedPracticeEvent): string {
  if (event.eventType === "candidate_created") return event.origin === "human_draft" ? "İnsan taslağından aday oluşturuldu" : "Agentic görüşmeden aday oluşturuldu";
  if (event.eventType === "reviewed") return event.reviewNote;
  if (event.eventType === "trial_started") return event.hypothesis;
  if (event.eventType === "outcome_recorded") return event.outcomeNote;
  if (event.eventType === "standardization_reviewed") return event.reviewNote;
  if (event.eventType === "standardization_candidate") return event.candidateNote;
  if (event.eventType === "standardized") return event.confirmationNote;
  return event.reason;
}

function eventEvidenceCount(event: AdvisedPracticeEvent): number {
  if (event.eventType === "trial_started" || event.eventType === "outcome_recorded") return event.evidenceRefs.length;
  if (event.eventType === "standardization_reviewed") return event.decomposition.reduce((sum, item) => sum + item.sourceRefs.length, 0);
  return 0;
}

function updatedAt(definition: AdvisedPracticeDefinition, history: readonly AdvisedPracticeEvent[]): string {
  return history.at(-1)?.occurredAt ?? definition.provenance.ownerSource.capturedAt;
}

function summary(record: PersistedAdvisedPractice, workspaceRef: string): PracticeLabSummary {
  const { definition, history } = record;
  if (definition.workspaceRef !== workspaceRef) throw new PracticeLabReadError("scope_mismatch");
  const replay = replayAdvisedPractice(definition, history);
  const result: PracticeLabSummary = Object.freeze({
    practiceRef: definition.practiceRef,
    version: definition.version,
    problem: definition.problem,
    confidence: definition.confidence,
    state: replay.state,
    outcomeStatus: replay.outcomeStatus,
    standardizationReviewStatus: replay.standardizationReviewStatus,
    standardizationStatus: replay.standardizationStatus,
    revision: Object.freeze({ definitionVersion: definition.version, lastSequence: history.length,
      revisionRef: advisedPracticeRevisionRef(record) }),
    updatedAt: updatedAt(definition, history),
    scope: Object.freeze({
      kind: definition.scope.kind,
      objectives: Object.freeze([...definition.scope.objectives]),
      internalCategories: Object.freeze([...definition.scope.internalCategoryRefs]),
      topics: Object.freeze([...definition.scope.topics]),
      accountCount: definition.scope.accountRefs.length,
      entityCount: definition.scope.entities.length,
    }),
    sources: Object.freeze({
      ownerStatementPresent: true,
      officialMetaSourceCount: definition.provenance.metaSources.length,
      evidenceCount: definition.provenance.evidenceRefs.length,
      alignment: definition.provenance.deliberation.alignment,
    }),
    authority: AUTHORITY,
  });
  safePublicValue(result);
  return result;
}

function detail(record: PersistedAdvisedPractice, workspaceRef: string): PracticeLabDetail {
  const base = summary(record, workspaceRef);
  const { definition, history } = record;
  const result: PracticeLabDetail = Object.freeze({
    ...base,
    requiredInputs: Object.freeze([...definition.requiredInputs]),
    steps: Object.freeze([...definition.steps]),
    rationale: definition.rationale,
    cadence: definition.cadence,
    exceptions: Object.freeze([...definition.exceptions]),
    sourceReview: Object.freeze({
      ownerCapturedAt: definition.provenance.ownerSource.capturedAt,
      officialMetaSources: Object.freeze(definition.provenance.metaSources.map((source) => Object.freeze({
        host: new URL(source.sourceUrl).hostname.toLowerCase(),
        capturedAt: source.capturedAt,
        reviewedAt: source.reviewedAt,
        reviewBy: source.reviewBy,
      }))),
      deliberation: Object.freeze({
        alignment: definition.provenance.deliberation.alignment,
        rationale: definition.provenance.deliberation.rationale,
        conflictCount: definition.provenance.deliberation.conflictRefs.length,
      }),
    }),
    timeline: Object.freeze(history.map((event) => Object.freeze({
      sequence: event.sequence,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      stateAfter: stateAfter(event),
      note: note(event),
      evidenceCount: eventEvidenceCount(event),
    }))),
  });
  safePublicValue(result);
  return result;
}

function cursor(after: string): string {
  return Buffer.from(JSON.stringify({ v: 1, after }), "utf8").toString("base64url");
}

function parseCursor(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 256) throw new PracticeLabReadError("invalid_input");
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)
      || Object.keys(decoded).length !== 2 || (decoded as { v?: unknown }).v !== 1
      || typeof (decoded as { after?: unknown }).after !== "string"
      || !PRACTICE_REF.test((decoded as { after: string }).after)) throw new Error("invalid");
    return (decoded as { after: string }).after;
  } catch {
    throw new PracticeLabReadError("invalid_input");
  }
}

function practiceRef(value: unknown): string {
  if (typeof value !== "string" || !PRACTICE_REF.test(value)) throw new PracticeLabReadError("invalid_input");
  return value;
}

export class PracticeLabReadService {
  constructor(private readonly repository: PracticeLabRepository) {}

  async list(input: Readonly<{ workspaceRef: string; limit?: number; cursor?: string | null }>): Promise<PracticeLabListResult> {
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new PracticeLabReadError("invalid_input");
    const after = parseCursor(input.cursor);
    let refs: readonly string[];
    try {
      refs = await this.repository.listRefs({ after, limit: limit + 1 });
    } catch {
      throw new PracticeLabReadError("source_unavailable");
    }
    if (!Array.isArray(refs) || refs.length > limit + 1 || new Set(refs).size !== refs.length
      || refs.some((ref) => !PRACTICE_REF.test(ref))
      || refs.some((ref, index) => index > 0 && refs[index - 1]! >= ref)) {
      throw new PracticeLabReadError("unsafe_source");
    }
    const pageRefs = refs.slice(0, limit);
    const records = await Promise.all(pageRefs.map(async (ref) => {
      try { return await this.repository.load(ref); } catch { throw new PracticeLabReadError("source_unavailable"); }
    }));
    if (records.some((record) => record === null)) throw new PracticeLabReadError("unsafe_source");
    const items = Object.freeze(records.map((record) => summary(record!, input.workspaceRef)));
    return Object.freeze({
      contractVersion: PRACTICE_LAB_READ_MODEL_VERSION,
      view: "list",
      items,
      nextCursor: refs.length > limit ? cursor(pageRefs.at(-1)!) : null,
      authority: AUTHORITY,
    });
  }

  async get(input: Readonly<{ workspaceRef: string; practiceRef: string }>): Promise<PracticeLabDetailResult> {
    const ref = practiceRef(input.practiceRef);
    let record: PersistedAdvisedPractice | null;
    try { record = await this.repository.load(ref); } catch { throw new PracticeLabReadError("source_unavailable"); }
    if (!record) throw new PracticeLabReadError("not_found");
    return Object.freeze({
      contractVersion: PRACTICE_LAB_READ_MODEL_VERSION,
      view: "detail",
      item: detail(record, input.workspaceRef),
      authority: AUTHORITY,
    });
  }

  async prepareDraft(input: Readonly<{ workspaceRef: string; practiceRef: string }>): Promise<PracticeLabDraftResult> {
    const current = await this.get(input);
    const result: PracticeLabDraftResult = Object.freeze({
      contractVersion: PRACTICE_LAB_READ_MODEL_VERSION,
      view: "draft",
      draft: Object.freeze({
        status: "ephemeral_unpersisted",
        practice: current.item,
        collaborationQuestions: Object.freeze([
          "Bu yaklaşım hangi koşullarda geçersiz sayılmalı?",
          "Mevcut kanıt ve Meta kaynağı bu kapsam için yeterli mi?",
          "Deneme sonucu hangi timeframe ve guardrail ile değerlendirilmeli?",
        ]),
        requiredReview: "human",
        allowedOutcome: "conversation_draft_only",
      }),
      authority: AUTHORITY,
    });
    safePublicValue(result);
    return result;
  }
}
