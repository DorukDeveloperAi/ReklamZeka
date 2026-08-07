import { createHash, randomUUID } from "node:crypto";

export const DECISION_ROOM_EXECUTOR_VERSION = "decision-room-executor/1.0.0" as const;

export type DecisionRoomRequest = Readonly<{
  version: typeof DECISION_ROOM_EXECUTOR_VERSION;
  trigger:
    | Readonly<{ kind: "manual"; requestRef: string; requestedByRef: string }>
    | Readonly<{ kind: "scheduled"; scheduleRef: string; scheduleDefinitionHash: string; scheduledFor: string }>;
  requestedAt: string;
  workspaceRef: string;
  accountRef: string;
  campaignRef: string;
  timeframeRef: string;
  templateRef: string;
  notificationChannel: "in_app_inbox";
}>;

export type DecisionRoomExecutionResult = Readonly<{
  version: typeof DECISION_ROOM_EXECUTOR_VERSION;
  status: "completed" | "failed" | "duplicate_completed" | "duplicate_in_progress" | "overlap_suppressed";
  runRef: string;
  idempotencyKey: string;
  attempt: number;
  retryable: boolean;
  actionAuthority: "none";
  notificationChannel: "in_app_inbox";
}>;

export class DecisionRoomExecutorError extends Error {
  constructor(readonly code: "invalid_request" | "invalid_runner_result" | "lease_lost" | "notification_failed") {
    super("Decision Room çalıştırması güvenli biçimde işlenemedi");
    this.name = "DecisionRoomExecutorError";
  }
}

type AnalysisResult = Readonly<{
  analysisRef: string;
  evidenceRefs: readonly string[];
  summaryCode: string;
}>;

export type DecisionRoomAnalysisPort = Readonly<{
  execute(input: Readonly<{
    runRef: string;
    workspaceRef: string;
    accountRef: string;
    campaignRef: string;
    timeframeRef: string;
    templateRef: string;
    triggerKind: "manual" | "scheduled";
    actionAuthority: "none";
  }>): Promise<AnalysisResult>;
}>;

export type DecisionRoomInboxPort = Readonly<{
  publish(notification: Readonly<{
    notificationRef: string;
    channel: "in_app_inbox";
    runRef: string;
    analysisRef: string;
    summaryCode: string;
    actionAuthority: "none";
  }>): Promise<void>;
}>;

type StoredCompletion = Readonly<{ analysisRef: string; summaryCode: string }>;

type ClaimResult =
  | Readonly<{ status: "claimed"; runRef: string; leaseToken: string; attempt: number }>
  | Readonly<{ status: "duplicate_completed"; runRef: string; attempt: number; completion: StoredCompletion }>
  | Readonly<{ status: "duplicate_in_progress" | "overlap_suppressed"; runRef: string; attempt: number }>;

export type DecisionRoomRunStore = Readonly<{
  claim(input: Readonly<{
    idempotencyKey: string;
    scopeKey: string;
    triggerKind: "manual" | "scheduled";
    scheduleRef: string | null;
    scheduleDefinitionHash: string | null;
    accountRef: string;
    campaignRef: string;
    now: string;
    leaseUntil: string;
  }>): Promise<ClaimResult>;
  complete(input: Readonly<{
    idempotencyKey: string;
    leaseToken: string;
    completion: StoredCompletion;
  }>): Promise<boolean>;
  fail(input: Readonly<{ idempotencyKey: string; leaseToken: string }>): Promise<boolean>;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: unknown, allowed: readonly string[], code: "invalid_request" | "invalid_runner_result"): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) throw new DecisionRoomExecutorError(code);
}

function required(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new DecisionRoomExecutorError("invalid_request");
  return value.trim();
}

const OPAQUE_REF_PATTERN = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;
const MACHINE_CODE_PATTERN = /^[a-z0-9][a-z0-9_:-]{0,127}$/;

function opaqueRunnerRef(value: unknown): string {
  if (typeof value !== "string" || !OPAQUE_REF_PATTERN.test(value)) {
    throw new DecisionRoomExecutorError("invalid_runner_result");
  }
  return value;
}

function machineCode(value: unknown): string {
  if (typeof value !== "string" || !MACHINE_CODE_PATTERN.test(value)) {
    throw new DecisionRoomExecutorError("invalid_runner_result");
  }
  return value;
}

function time(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new DecisionRoomExecutorError("invalid_request");
  return new Date(value).toISOString();
}

function uniqueRefs(values: unknown): readonly string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !OPAQUE_REF_PATTERN.test(value))) {
    throw new DecisionRoomExecutorError("invalid_runner_result");
  }
  return Object.freeze([...new Set(values)].sort(codePointCompare));
}

export function validateDecisionRoomRequest(request: DecisionRoomRequest): DecisionRoomRequest {
  exactKeys(request, [
    "version", "trigger", "requestedAt", "workspaceRef", "accountRef", "campaignRef",
    "timeframeRef", "templateRef", "notificationChannel",
  ], "invalid_request");
  if (request.version !== DECISION_ROOM_EXECUTOR_VERSION || request.notificationChannel !== "in_app_inbox") {
    throw new DecisionRoomExecutorError("invalid_request");
  }
  exactKeys(
    request.trigger,
    request.trigger?.kind === "manual"
      ? ["kind", "requestRef", "requestedByRef"]
      : ["kind", "scheduleRef", "scheduleDefinitionHash", "scheduledFor"],
    "invalid_request",
  );
  if (!(["manual", "scheduled"] as const).includes(request.trigger.kind)) {
    throw new DecisionRoomExecutorError("invalid_request");
  }
  const trigger = request.trigger.kind === "manual"
    ? Object.freeze({ kind: "manual" as const, requestRef: required(request.trigger.requestRef), requestedByRef: required(request.trigger.requestedByRef) })
    : Object.freeze({
      kind: "scheduled" as const,
      scheduleRef: required(request.trigger.scheduleRef),
      scheduleDefinitionHash: /^[a-f0-9]{64}$/.test(request.trigger.scheduleDefinitionHash)
        ? request.trigger.scheduleDefinitionHash
        : (() => { throw new DecisionRoomExecutorError("invalid_request"); })(),
      scheduledFor: time(request.trigger.scheduledFor),
    });
  return Object.freeze({
    version: DECISION_ROOM_EXECUTOR_VERSION,
    trigger,
    requestedAt: time(request.requestedAt),
    workspaceRef: required(request.workspaceRef),
    accountRef: required(request.accountRef),
    campaignRef: required(request.campaignRef),
    timeframeRef: required(request.timeframeRef),
    templateRef: required(request.templateRef),
    notificationChannel: "in_app_inbox",
  });
}

export function decisionRoomIdempotencyKey(request: DecisionRoomRequest): string {
  const valid = validateDecisionRoomRequest(request);
  const triggerIdentity = valid.trigger.kind === "manual"
    ? `manual:${valid.trigger.requestRef}`
    : `scheduled:${valid.trigger.scheduleRef}:${valid.trigger.scheduleDefinitionHash}:${valid.trigger.scheduledFor}`;
  return `idempotency_${sha256(JSON.stringify({
    version: valid.version,
    triggerIdentity,
    workspaceRef: valid.workspaceRef,
    accountRef: valid.accountRef,
    campaignRef: valid.campaignRef,
    timeframeRef: valid.timeframeRef,
    templateRef: valid.templateRef,
  })).slice(0, 32)}`;
}

function scopeKey(request: DecisionRoomRequest): string {
  return sha256(JSON.stringify([
    request.workspaceRef, request.accountRef, request.campaignRef,
  ]));
}

async function publishCompletion(
  inbox: DecisionRoomInboxPort,
  idempotencyKey: string,
  runRef: string,
  completion: StoredCompletion,
): Promise<void> {
  try {
    await inbox.publish({
      notificationRef: `inbox_${sha256(`${idempotencyKey}:${completion.analysisRef}`).slice(0, 20)}`,
      channel: "in_app_inbox",
      runRef,
      analysisRef: completion.analysisRef,
      summaryCode: completion.summaryCode,
      actionAuthority: "none",
    });
  } catch {
    throw new DecisionRoomExecutorError("notification_failed");
  }
}

function publicResult(
  status: DecisionRoomExecutionResult["status"],
  idempotencyKey: string,
  runRef: string,
  attempt: number,
): DecisionRoomExecutionResult {
  return Object.freeze({
    version: DECISION_ROOM_EXECUTOR_VERSION,
    status,
    runRef,
    idempotencyKey,
    attempt,
    retryable: status === "failed" || status === "duplicate_in_progress" || status === "overlap_suppressed",
    actionAuthority: "none",
    notificationChannel: "in_app_inbox",
  });
}

export class DecisionRoomExecutor {
  constructor(
    private readonly store: DecisionRoomRunStore,
    private readonly analysis: DecisionRoomAnalysisPort,
    private readonly inbox: DecisionRoomInboxPort,
    private readonly now: () => Date,
    private readonly leaseMs = 5 * 60_000,
  ) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) throw new DecisionRoomExecutorError("invalid_request");
  }

  async execute(input: DecisionRoomRequest): Promise<DecisionRoomExecutionResult> {
    const request = validateDecisionRoomRequest(input);
    const idempotencyKey = decisionRoomIdempotencyKey(request);
    const current = this.now();
    if (!Number.isFinite(current.getTime())) throw new DecisionRoomExecutorError("invalid_request");
    const claim = await this.store.claim({
      idempotencyKey,
      scopeKey: scopeKey(request),
      triggerKind: request.trigger.kind,
      scheduleRef: request.trigger.kind === "scheduled" ? request.trigger.scheduleRef : null,
      scheduleDefinitionHash: request.trigger.kind === "scheduled" ? request.trigger.scheduleDefinitionHash : null,
      accountRef: request.accountRef,
      campaignRef: request.campaignRef,
      now: current.toISOString(),
      leaseUntil: new Date(current.getTime() + this.leaseMs).toISOString(),
    });
    if (claim.status === "duplicate_completed") {
      await publishCompletion(this.inbox, idempotencyKey, claim.runRef, claim.completion);
      return publicResult(claim.status, idempotencyKey, claim.runRef, claim.attempt);
    }
    if (claim.status !== "claimed") {
      return publicResult(claim.status, idempotencyKey, claim.runRef, claim.attempt);
    }
    let completion: StoredCompletion;
    try {
      const result = await this.analysis.execute({
        runRef: claim.runRef,
        workspaceRef: request.workspaceRef,
        accountRef: request.accountRef,
        campaignRef: request.campaignRef,
        timeframeRef: request.timeframeRef,
        templateRef: request.templateRef,
        triggerKind: request.trigger.kind,
        actionAuthority: "none",
      });
      exactKeys(result, ["analysisRef", "evidenceRefs", "summaryCode"], "invalid_runner_result");
      completion = {
        analysisRef: opaqueRunnerRef(result.analysisRef),
        summaryCode: machineCode(result.summaryCode),
      };
      uniqueRefs(result.evidenceRefs);
      if (!await this.store.complete({ idempotencyKey, leaseToken: claim.leaseToken, completion })) {
        throw new DecisionRoomExecutorError("lease_lost");
      }
    } catch (error) {
      if (error instanceof DecisionRoomExecutorError && error.code === "lease_lost") throw error;
      if (!await this.store.fail({ idempotencyKey, leaseToken: claim.leaseToken })) {
        throw new DecisionRoomExecutorError("lease_lost");
      }
      return publicResult("failed", idempotencyKey, claim.runRef, claim.attempt);
    }
    await publishCompletion(this.inbox, idempotencyKey, claim.runRef, completion);
    return publicResult("completed", idempotencyKey, claim.runRef, claim.attempt);
  }
}

type MutableRun = {
  idempotencyKey: string;
  scopeKey: string;
  runRef: string;
  state: "running" | "completed" | "failed";
  leaseToken: string;
  leaseUntil: string;
  attempt: number;
  completion?: StoredCompletion;
};

export class InMemoryDecisionRoomRunStore implements DecisionRoomRunStore {
  private readonly runs = new Map<string, MutableRun>();

  async claim(input: Readonly<{
    idempotencyKey: string;
    scopeKey: string;
    triggerKind: "manual" | "scheduled";
    scheduleRef: string | null;
    scheduleDefinitionHash: string | null;
    accountRef: string;
    campaignRef: string;
    now: string;
    leaseUntil: string;
  }>): Promise<ClaimResult> {
    const existing = this.runs.get(input.idempotencyKey);
    if (existing?.state === "completed") return Object.freeze({
      status: "duplicate_completed", runRef: existing.runRef, attempt: existing.attempt, completion: existing.completion!,
    });
    if (existing?.state === "running" && existing.leaseUntil > input.now) {
      return Object.freeze({ status: "duplicate_in_progress", runRef: existing.runRef, attempt: existing.attempt });
    }
    const overlap = [...this.runs.values()].find((run) => (
      run.idempotencyKey !== input.idempotencyKey && run.scopeKey === input.scopeKey
      && run.state === "running" && run.leaseUntil > input.now
    ));
    if (overlap) return Object.freeze({ status: "overlap_suppressed", runRef: overlap.runRef, attempt: overlap.attempt });
    const run: MutableRun = existing ?? {
      idempotencyKey: input.idempotencyKey,
      scopeKey: input.scopeKey,
      runRef: `run_${sha256(input.idempotencyKey).slice(0, 20)}`,
      state: "failed",
      leaseToken: "",
      leaseUntil: input.now,
      attempt: 0,
    };
    run.state = "running";
    run.leaseToken = randomUUID();
    run.leaseUntil = input.leaseUntil;
    run.attempt += 1;
    run.completion = undefined;
    this.runs.set(input.idempotencyKey, run);
    return Object.freeze({ status: "claimed", runRef: run.runRef, leaseToken: run.leaseToken, attempt: run.attempt });
  }

  async complete(input: Readonly<{ idempotencyKey: string; leaseToken: string; completion: StoredCompletion }>): Promise<boolean> {
    const run = this.runs.get(input.idempotencyKey);
    if (!run || run.state !== "running" || run.leaseToken !== input.leaseToken) return false;
    run.state = "completed";
    run.completion = Object.freeze({ ...input.completion });
    return true;
  }

  async fail(input: Readonly<{ idempotencyKey: string; leaseToken: string }>): Promise<boolean> {
    const run = this.runs.get(input.idempotencyKey);
    if (!run || run.state !== "running" || run.leaseToken !== input.leaseToken) return false;
    run.state = "failed";
    return true;
  }
}

export class InMemoryDecisionRoomInbox implements DecisionRoomInboxPort {
  private readonly items = new Map<string, Parameters<DecisionRoomInboxPort["publish"]>[0]>();

  async publish(notification: Parameters<DecisionRoomInboxPort["publish"]>[0]): Promise<void> {
    this.items.set(notification.notificationRef, Object.freeze({ ...notification }));
  }

  list(): readonly Parameters<DecisionRoomInboxPort["publish"]>[0][] {
    return Object.freeze([...this.items.values()]);
  }
}
