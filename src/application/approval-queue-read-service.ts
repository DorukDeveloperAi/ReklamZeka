export const APPROVAL_QUEUE_READ_MODEL_VERSION = "approval-queue-read-model/1.3.0" as const;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const FULL_HASH = /\b[a-f0-9]{64}\b/i;
const META_ID = /\b(?:act_|campaign_|adset_|ad_)\d{5,}\b/i;
const CREDENTIAL = /\b(?:rzs1\.|EA[A-Za-z0-9]{30,}|Bearer\s+)[A-Za-z0-9._-]*/i;
const UNIT_REF = /^action_unit_[a-f0-9]{20}$/;
const BUNDLE_REF = /^action_bundle_[a-f0-9]{20}$/;
const PUBLIC_REF = /^(?:account|entity|autonomy)_[a-f0-9]{16}$/;
const CODE = /^[a-z][a-z0-9_.:-]{0,127}$/;

export type ApprovalQueueStatus = "proposed" | "awaiting_approval" | "approved" | "rejected" | "changes_requested"
  | "expired" | "stale" | "suppressed" | "parked" | "executing" | "verified" | "failed" | "dependency_failed"
  | "rollback_proposed" | "rolled_back" | "superseded";
export type ApprovalRisk = "K0" | "K1" | "K2" | "K3" | "K4";
export type ApprovalActionType = "status_pause" | "status_activate" | "budget_decrease" | "budget_increase";

export type ApprovalBeforeAfter =
  | Readonly<{ field: "configured_status"; before: "ACTIVE" | "PAUSED"; after: "ACTIVE" | "PAUSED" }>
  | Readonly<{ field: "daily_budget_minor" | "lifetime_budget_minor"; beforeMinor: number; afterMinor: number; currency: string }>;

export type ApprovalQueueRecord = Readonly<{
  unitRef: string;
  bundleRef: string | null;
  status: ApprovalQueueStatus;
  risk: ApprovalRisk;
  actionType: ApprovalActionType;
  accountRef: string;
  campaignRef: string;
  entity: Readonly<{ type: "campaign" | "ad_set" | "ad"; ref: string; label: string | null }>;
  beforeAfter: ApprovalBeforeAfter;
  autonomy: Readonly<{
    profileRef: string;
    decision: "manual" | "approval_required" | "policy_limited";
    trace: readonly Readonly<{ scope: "workspace" | "account" | "category" | "entity" | "risk"; decision: "manual" | "approval_required" | "policy_limited"; reasonCode: string }>[];
  }>;
  expiresAt: string;
  createdAt: string;
  dependencies: readonly Readonly<{ unitRef: string; status: ApprovalQueueStatus }>[];
  summaryCode: string;
}>;

/** Detail-only public projection. Refs and hashes remain server-private. */
export type ApprovalQueueDetailRecord = ApprovalQueueRecord & Readonly<{
  evidence: readonly Readonly<{ kind: "budget_proposal" | "slice_rule" | "delivery_alert" | "other"; label: string }>[];
  decisionTimeline: readonly Readonly<{
    kind: "proposed" | "approved" | "rejected" | "changes_requested";
    occurredAt: string;
    reasonCode: string | null;
  }>[];
}>;

export type ApprovalQueueRepository = Readonly<{
  list(input: Readonly<{ workspaceId: string; entityRef: string | null; campaignRef: string | null; before: Readonly<{ createdAt: string; unitRef: string }> | null; limit: number }>): Promise<readonly ApprovalQueueRecord[]>;
  get(input: Readonly<{ workspaceId: string; unitRef: string }>): Promise<ApprovalQueueDetailRecord | null>;
}>;

export class ApprovalQueueReadError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "unsafe_source" | "source_unavailable") {
    super("Approval Queue kaynağı güvenli biçimde okunamadı");
    this.name = "ApprovalQueueReadError";
  }
}

const AUTHORITY = Object.freeze({ readOnly: true as const, canApprove: false as const, canReject: false as const,
  canRequestChanges: false as const, canGrant: false as const, canExecute: false as const, canWriteMeta: false as const });

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new ApprovalQueueReadError("unsafe_source");
  }
}

function safeText(value: unknown, maximum = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && !UUID.test(value) && !FULL_HASH.test(value) && !META_ID.test(value) && !/^\d{8,}$/.test(value) && !CREDENTIAL.test(value);
}

function validate(record: ApprovalQueueRecord): ApprovalQueueRecord {
  const visit = (value: unknown, seen = new Set<object>()): void => {
    if (typeof value === "string") {
      if (!safeText(value, 2_000)) throw new ApprovalQueueReadError("unsafe_source");
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) value.forEach((item) => visit(item, seen));
    else Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      if (/(?:workspaceId|externalId|metaId|hash|token|secret|prompt|raw(?:Payload|Request|Response|Json)?|authority|approvalGranted|canApprove|canExecute|canWrite)/i.test(key)) {
        throw new ApprovalQueueReadError("unsafe_source");
      }
      visit(child, seen);
    });
  };
  visit(record);
  exact(record, ["unitRef", "bundleRef", "status", "risk", "actionType", "accountRef", "campaignRef", "entity", "beforeAfter", "autonomy", "expiresAt", "createdAt", "dependencies", "summaryCode"]);
  exact(record.entity, ["type", "ref", "label"]);
  exact(record.autonomy, ["profileRef", "decision", "trace"]);
  if (!UNIT_REF.test(record.unitRef) || record.bundleRef !== null && !BUNDLE_REF.test(record.bundleRef)
    || !PUBLIC_REF.test(record.accountRef) || !PUBLIC_REF.test(record.campaignRef) || !PUBLIC_REF.test(record.entity.ref) || !PUBLIC_REF.test(record.autonomy.profileRef)
    || !["campaign", "ad_set", "ad"].includes(record.entity.type)
    || record.entity.label !== null && !safeText(record.entity.label)
    || !["K0", "K1", "K2", "K3", "K4"].includes(record.risk)
    || !["status_pause", "status_activate", "budget_decrease", "budget_increase"].includes(record.actionType)
    || !CODE.test(record.summaryCode) || !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.expiresAt))
    || Date.parse(record.expiresAt) <= Date.parse(record.createdAt) || record.dependencies.length > 50 || record.autonomy.trace.length < 1 || record.autonomy.trace.length > 20) {
    throw new ApprovalQueueReadError("unsafe_source");
  }
  const statuses: readonly string[] = ["proposed", "awaiting_approval", "approved", "rejected", "changes_requested", "expired", "stale", "suppressed", "parked", "executing", "verified", "failed", "dependency_failed", "rollback_proposed", "rolled_back", "superseded"];
  if (!statuses.includes(record.status) || !["manual", "approval_required", "policy_limited"].includes(record.autonomy.decision)) throw new ApprovalQueueReadError("unsafe_source");
  exact(record.beforeAfter, record.beforeAfter.field === "configured_status" ? ["field", "before", "after"] : ["field", "beforeMinor", "afterMinor", "currency"]);
  if (record.beforeAfter.field === "configured_status") {
    if (!["ACTIVE", "PAUSED"].includes(record.beforeAfter.before) || !["ACTIVE", "PAUSED"].includes(record.beforeAfter.after)) throw new ApprovalQueueReadError("unsafe_source");
  } else if (!["daily_budget_minor", "lifetime_budget_minor"].includes(record.beforeAfter.field)
    || !Number.isSafeInteger(record.beforeAfter.beforeMinor) || record.beforeAfter.beforeMinor < 0
    || !Number.isSafeInteger(record.beforeAfter.afterMinor) || record.beforeAfter.afterMinor < 0
    || !/^[A-Z]{3}$/.test(record.beforeAfter.currency)) throw new ApprovalQueueReadError("unsafe_source");
  const dependencyRefs = new Set<string>();
  for (const dependency of record.dependencies) {
    exact(dependency, ["unitRef", "status"]);
    if (!UNIT_REF.test(dependency.unitRef) || dependencyRefs.has(dependency.unitRef) || !statuses.includes(dependency.status)) throw new ApprovalQueueReadError("unsafe_source");
    dependencyRefs.add(dependency.unitRef);
  }
  for (const step of record.autonomy.trace) {
    exact(step, ["scope", "decision", "reasonCode"]);
    if (!["workspace", "account", "category", "entity", "risk"].includes(step.scope)
      || !["manual", "approval_required", "policy_limited"].includes(step.decision) || !CODE.test(step.reasonCode)) throw new ApprovalQueueReadError("unsafe_source");
  }
  const beforeAfter: ApprovalBeforeAfter = record.beforeAfter.field === "configured_status"
    ? Object.freeze({ field: record.beforeAfter.field, before: record.beforeAfter.before, after: record.beforeAfter.after })
    : Object.freeze({ field: record.beforeAfter.field, beforeMinor: record.beforeAfter.beforeMinor,
      afterMinor: record.beforeAfter.afterMinor, currency: record.beforeAfter.currency });
  return Object.freeze({
    ...record,
    entity: Object.freeze({ ...record.entity }),
    beforeAfter,
    autonomy: Object.freeze({ ...record.autonomy,
      trace: Object.freeze(record.autonomy.trace.map((step) => Object.freeze({ ...step }))) }),
    dependencies: Object.freeze(record.dependencies.map((dependency) => Object.freeze({ ...dependency }))),
  });
}

function validateDetail(record: ApprovalQueueDetailRecord): ApprovalQueueDetailRecord {
  exact(record, ["unitRef", "bundleRef", "status", "risk", "actionType", "accountRef", "campaignRef", "entity", "beforeAfter", "autonomy", "expiresAt", "createdAt", "dependencies", "summaryCode", "evidence", "decisionTimeline"]);
  const { evidence: rawEvidence, decisionTimeline: rawTimeline, ...baseRecord } = record;
  const base = validate(baseRecord);
  if (!Array.isArray(rawEvidence) || rawEvidence.length > 50 || !Array.isArray(rawTimeline)
    || rawTimeline.length < 1 || rawTimeline.length > 50) throw new ApprovalQueueReadError("unsafe_source");
  const evidence = rawEvidence.map((entry) => {
    exact(entry, ["kind", "label"]);
    const candidate = entry as Readonly<{ kind: unknown; label: unknown }>;
    if (typeof candidate.kind !== "string" || !["budget_proposal", "slice_rule", "delivery_alert", "other"].includes(candidate.kind) || !safeText(candidate.label)) throw new ApprovalQueueReadError("unsafe_source");
    return Object.freeze({ kind: candidate.kind as ApprovalQueueDetailRecord["evidence"][number]["kind"], label: candidate.label });
  });
  const timeline = rawTimeline.map((entry, index) => {
    exact(entry, ["kind", "occurredAt", "reasonCode"]);
    const candidate = entry as Readonly<{ kind: unknown; occurredAt: unknown; reasonCode: unknown }>;
    if (typeof candidate.kind !== "string" || !["proposed", "approved", "rejected", "changes_requested"].includes(candidate.kind)
      || typeof candidate.occurredAt !== "string" || !Number.isFinite(Date.parse(candidate.occurredAt)) || candidate.reasonCode !== null && (typeof candidate.reasonCode !== "string" || !CODE.test(candidate.reasonCode))
      || index === 0 && (candidate.kind !== "proposed" || candidate.reasonCode !== null)
      || index > 0 && candidate.kind === "proposed") throw new ApprovalQueueReadError("unsafe_source");
    const previous = index > 0 ? rawTimeline[index - 1]! as Readonly<{ occurredAt?: unknown }> : null;
    if (previous && (typeof previous.occurredAt !== "string" || Date.parse(candidate.occurredAt) < Date.parse(previous.occurredAt))) throw new ApprovalQueueReadError("unsafe_source");
    return Object.freeze({ kind: candidate.kind as ApprovalQueueDetailRecord["decisionTimeline"][number]["kind"], occurredAt: new Date(candidate.occurredAt).toISOString(), reasonCode: candidate.reasonCode as string | null });
  });
  return Object.freeze({ ...base, evidence: Object.freeze(evidence), decisionTimeline: Object.freeze(timeline) });
}

function cursor(record: ApprovalQueueRecord): string {
  return Buffer.from(JSON.stringify({ v: 1, createdAt: record.createdAt, unitRef: record.unitRef }), "utf8").toString("base64url");
}

function parseCursor(value: unknown): Readonly<{ createdAt: string; unitRef: string }> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 512) throw new ApprovalQueueReadError("invalid_input");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (!parsed || Object.keys(parsed).sort().join("|") !== "createdAt|unitRef|v" || parsed.v !== 1
      || typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt))
      || typeof parsed.unitRef !== "string" || !UNIT_REF.test(parsed.unitRef)) throw new Error();
    return Object.freeze({ createdAt: new Date(parsed.createdAt).toISOString(), unitRef: parsed.unitRef });
  } catch { throw new ApprovalQueueReadError("invalid_input"); }
}

export class ApprovalQueueReadService {
  constructor(private readonly repository: ApprovalQueueRepository) {}

  async list(input: Readonly<{ workspaceId: string; entityRef?: string | null; campaignRef?: string | null; limit?: number; cursor?: string | null }>) {
    const limit = input.limit ?? 25;
    const entityRef = input.entityRef ?? null;
    const campaignRef = input.campaignRef ?? null;
    if (typeof input.workspaceId !== "string" || !UUID.test(input.workspaceId) || !Number.isInteger(limit) || limit < 1 || limit > 100
      || entityRef !== null && (typeof entityRef !== "string" || !PUBLIC_REF.test(entityRef))
      || campaignRef !== null && (typeof campaignRef !== "string" || !PUBLIC_REF.test(campaignRef))
      || entityRef !== null && campaignRef !== null) throw new ApprovalQueueReadError("invalid_input");
    let records: readonly ApprovalQueueRecord[];
    try { records = await this.repository.list({ workspaceId: input.workspaceId, entityRef, campaignRef, before: parseCursor(input.cursor), limit: limit + 1 }); }
    catch (reason) { if (reason instanceof ApprovalQueueReadError) throw reason; throw new ApprovalQueueReadError("source_unavailable"); }
    if (!Array.isArray(records) || records.length > limit + 1) throw new ApprovalQueueReadError("unsafe_source");
    const safeRecords = records.map(validate);
    if (new Set(safeRecords.map((record) => record.unitRef)).size !== safeRecords.length || safeRecords.some((record, index) => index > 0
      && (safeRecords[index - 1]!.createdAt < record.createdAt || safeRecords[index - 1]!.createdAt === record.createdAt && safeRecords[index - 1]!.unitRef <= record.unitRef))) throw new ApprovalQueueReadError("unsafe_source");
    const page = Object.freeze(safeRecords.slice(0, limit));
    if (entityRef !== null && page.some((record) => record.entity.ref !== entityRef)) throw new ApprovalQueueReadError("unsafe_source");
    if (campaignRef !== null && page.some((record) => record.campaignRef !== campaignRef)) throw new ApprovalQueueReadError("unsafe_source");
    return Object.freeze({ contractVersion: APPROVAL_QUEUE_READ_MODEL_VERSION, view: "list" as const, entityRef, campaignRef, items: page,
      nextCursor: records.length > limit ? cursor(page.at(-1)!) : null, authority: AUTHORITY });
  }

  async get(input: Readonly<{ workspaceId: string; unitRef: string }>) {
    if (typeof input.workspaceId !== "string" || !UUID.test(input.workspaceId) || !UNIT_REF.test(input.unitRef)) throw new ApprovalQueueReadError("invalid_input");
    let record: ApprovalQueueDetailRecord | null;
    try { record = await this.repository.get(input); } catch { throw new ApprovalQueueReadError("source_unavailable"); }
    if (!record) throw new ApprovalQueueReadError("not_found");
    const safeRecord = validateDetail(record);
    if (safeRecord.unitRef !== input.unitRef) throw new ApprovalQueueReadError("unsafe_source");
    return Object.freeze({ contractVersion: APPROVAL_QUEUE_READ_MODEL_VERSION, view: "detail" as const, item: safeRecord, authority: AUTHORITY });
  }
}
