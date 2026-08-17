import { createHash } from "node:crypto";

import {
  GUIDE_ACTIONS, GUIDE_MODES, guideAuthority, type GuideAction, type GuideMode,
} from "@/domain/guides/guide-revision";

export const GUIDE_RUN_VERSION = "guide-run/1.0.0" as const;
export const GUIDE_RUN_EVENT_VERSION = "guide-run-event/1.0.0" as const;

export const GUIDE_RUN_STATES = Object.freeze([
  "due", "claimed", "scope_frozen", "analyzing", "recorded",
  "held", "staged", "no_action", "completed", "failed", "missed",
] as const);

export type GuideRunState = typeof GUIDE_RUN_STATES[number];
export type GuideRunTrigger =
  | Readonly<{ kind: "scheduled"; scheduledFor: string }>
  | Readonly<{ kind: "manual"; requestRef: string }>;

export type GuideRunEvent = Readonly<{
  version: typeof GUIDE_RUN_EVENT_VERSION;
  eventRef: string;
  sequence: number;
  previousEventHash: string;
  fromState: GuideRunState | null;
  toState: GuideRunState;
  occurredAt: string;
  leaseToken: string | null;
  leaseUntil: string | null;
  reasonCode: string | null;
  eventHash: string;
}>;

export type GuideRun = Readonly<{
  version: typeof GUIDE_RUN_VERSION;
  runRef: string;
  workspaceRef: string;
  guideRef: string;
  guideRevisionHash: string;
  trigger: GuideRunTrigger;
  idempotencyKey: string;
  state: GuideRunState;
  sequence: number;
  headEventHash: string;
  lease: Readonly<{ token: string; expiresAt: string }> | null;
  events: readonly GuideRunEvent[];
  authority: Readonly<{ canApprove: false; canExecute: false; canWriteMeta: false }>;
}>;

export type GuideRunDisposition = Readonly<{
  state: "held" | "staged" | "no_action";
  reason: "data_missing" | "data_stale" | "mode_observe" | "recommendation_only" | "candidate_ready" | "nothing_to_do";
  recommendationRef: string | null;
  candidate: Readonly<{
    candidateRef: string;
    candidateHash: string;
    action: GuideAction;
    routing: "human_approval" | "limited_autonomy_review";
  }> | null;
  authority: Readonly<{
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canEnableAutomation: false;
  }>;
}>;

export class GuideRunError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "invalid_transition"
    | "head_conflict"
    | "lease_required"
    | "lease_expired"
    | "invalid_chain"
    | "mode_violation") {
    super(`Guide run rejected: ${code}`);
    this.name = "GuideRunError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[a-z0-9][a-z0-9_:-]{0,127}$/;
const AUTHORITY = Object.freeze({ canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });
const DISPOSITION_AUTHORITY = Object.freeze({ canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canEnableAutomation: false as const });

function fail(code: GuideRunError["code"]): never { throw new GuideRunError(code); }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compare(left, right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function exact(value: unknown, keys: readonly string[], code: GuideRunError["code"] = "invalid_input"): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
}
function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).length === keys.length
    && Object.keys(value as Record<string, unknown>).every((key) => keys.includes(key));
}
function ref(value: unknown, prefix?: string): string {
  if (typeof value !== "string" || !REF.test(value) || prefix && !value.startsWith(prefix)) fail("invalid_input");
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("invalid_input");
  return new Date(value).toISOString();
}
function reason(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !CODE.test(value)) fail("invalid_input");
  return value;
}

export function scheduledGuideRunIdempotencyKey(guideRevisionHash: string, scheduledFor: string): string {
  if (!HASH.test(guideRevisionHash)) fail("invalid_input");
  return `guide_slot_${digest({ guideRevisionHash, scheduledFor: instant(scheduledFor) })}`;
}

export function manualGuideRunIdempotencyKey(guideRevisionHash: string, requestRef: string): string {
  if (!HASH.test(guideRevisionHash)) fail("invalid_input");
  return `guide_manual_${digest({ guideRevisionHash, requestRef: ref(requestRef, "request_") })}`;
}

function normalizedTrigger(trigger: GuideRunTrigger): GuideRunTrigger {
  if (trigger?.kind === "scheduled") {
    exact(trigger, ["kind", "scheduledFor"]);
    return Object.freeze({ kind: "scheduled", scheduledFor: instant(trigger.scheduledFor) });
  }
  if (trigger?.kind === "manual") {
    exact(trigger, ["kind", "requestRef"]);
    return Object.freeze({ kind: "manual", requestRef: ref(trigger.requestRef, "request_") });
  }
  return fail("invalid_input");
}

function identifyEvent(value: Omit<GuideRunEvent, "eventRef" | "eventHash">): GuideRunEvent {
  const eventHash = digest(value);
  return Object.freeze({ ...value, eventRef: `guide_run_event_${eventHash.slice(0, 24)}`, eventHash });
}

function initialEvent(occurredAt: string): GuideRunEvent {
  return identifyEvent({ version: GUIDE_RUN_EVENT_VERSION, sequence: 1, previousEventHash: "GENESIS",
    fromState: null, toState: "due", occurredAt, leaseToken: null, leaseUntil: null, reasonCode: null });
}

export function createGuideRun(input: Readonly<{
  workspaceRef: string;
  guideRef: string;
  guideRevisionHash: string;
  trigger: GuideRunTrigger;
  occurredAt: string;
}>): GuideRun {
  exact(input, ["workspaceRef", "guideRef", "guideRevisionHash", "trigger", "occurredAt"]);
  const workspaceRef = ref(input.workspaceRef, "workspace_");
  const guideRef = ref(input.guideRef, "guide_");
  if (!HASH.test(input.guideRevisionHash)) fail("invalid_input");
  const trigger = normalizedTrigger(input.trigger);
  const occurredAt = instant(input.occurredAt);
  if (trigger.kind === "scheduled" && Date.parse(occurredAt) < Date.parse(trigger.scheduledFor)) fail("invalid_input");
  const idempotencyKey = trigger.kind === "scheduled"
    ? scheduledGuideRunIdempotencyKey(input.guideRevisionHash, trigger.scheduledFor)
    : manualGuideRunIdempotencyKey(input.guideRevisionHash, trigger.requestRef);
  const event = initialEvent(occurredAt);
  const runIdentity = digest({ workspaceRef, guideRef, guideRevisionHash: input.guideRevisionHash, trigger, idempotencyKey });
  return Object.freeze({ version: GUIDE_RUN_VERSION, runRef: `guide_run_${runIdentity.slice(0, 24)}`,
    workspaceRef, guideRef, guideRevisionHash: input.guideRevisionHash, trigger, idempotencyKey,
    state: "due", sequence: 1, headEventHash: event.eventHash, lease: null,
    events: Object.freeze([event]), authority: AUTHORITY });
}

const NEXT = Object.freeze({
  due: Object.freeze(["claimed", "missed", "failed"] as const),
  claimed: Object.freeze(["scope_frozen", "failed"] as const),
  scope_frozen: Object.freeze(["analyzing", "failed"] as const),
  analyzing: Object.freeze(["recorded", "failed"] as const),
  recorded: Object.freeze(["held", "staged", "no_action", "failed"] as const),
  held: Object.freeze(["completed", "failed"] as const),
  staged: Object.freeze(["completed", "failed"] as const),
  no_action: Object.freeze(["completed", "failed"] as const),
  completed: Object.freeze([] as const), failed: Object.freeze([] as const), missed: Object.freeze([] as const),
}) satisfies Readonly<Record<GuideRunState, readonly GuideRunState[]>>;

export function appendGuideRunTransition(run: GuideRun, input: Readonly<{
  expectedHeadHash: string;
  toState: Exclude<GuideRunState, "due">;
  occurredAt: string;
  leaseToken?: string;
  leaseUntil?: string;
  reasonCode?: string | null;
}>): GuideRun {
  if (!verifyGuideRun(run)) fail("invalid_chain");
  const transitionKeys = ["expectedHeadHash", "toState", "occurredAt", "leaseToken", "leaseUntil", "reasonCode"] as const;
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !Object.hasOwn(input, "expectedHeadHash") || !Object.hasOwn(input, "toState") || !Object.hasOwn(input, "occurredAt")
    || Object.keys(input).some((key) => !transitionKeys.includes(key as typeof transitionKeys[number]))) fail("invalid_input");
  if (input.expectedHeadHash !== run.headEventHash) fail("head_conflict");
  if (!GUIDE_RUN_STATES.includes(input.toState) || !(NEXT[run.state] as readonly GuideRunState[]).includes(input.toState)) {
    fail("invalid_transition");
  }
  const occurredAt = instant(input.occurredAt);
  const previous = run.events.at(-1)!;
  if (Date.parse(occurredAt) < Date.parse(previous.occurredAt)) fail("invalid_transition");
  let eventLeaseToken: string | null = null;
  let eventLeaseUntil: string | null = null;
  let nextLease = run.lease;
  if (input.toState === "claimed") {
    if (typeof input.leaseToken !== "string" || !UUID.test(input.leaseToken) || input.leaseUntil === undefined) fail("lease_required");
    eventLeaseToken = input.leaseToken.toLowerCase();
    eventLeaseUntil = instant(input.leaseUntil);
    if (Date.parse(eventLeaseUntil) <= Date.parse(occurredAt)) fail("lease_expired");
    nextLease = Object.freeze({ token: eventLeaseToken, expiresAt: eventLeaseUntil });
  } else if (run.state !== "due") {
    if (!run.lease || input.leaseToken?.toLowerCase() !== run.lease.token) fail("lease_required");
    if (Date.parse(occurredAt) >= Date.parse(run.lease.expiresAt)) fail("lease_expired");
    if (input.leaseUntil !== undefined && instant(input.leaseUntil) !== run.lease.expiresAt) fail("lease_required");
    eventLeaseToken = run.lease.token;
    eventLeaseUntil = run.lease.expiresAt;
  } else if (input.leaseToken !== undefined || input.leaseUntil !== undefined) fail("lease_required");
  if (["completed", "failed", "missed"].includes(input.toState)) nextLease = null;
  const event = identifyEvent({ version: GUIDE_RUN_EVENT_VERSION, sequence: run.sequence + 1,
    previousEventHash: run.headEventHash, fromState: run.state, toState: input.toState, occurredAt,
    leaseToken: eventLeaseToken, leaseUntil: eventLeaseUntil, reasonCode: reason(input.reasonCode ?? null) });
  return Object.freeze({ ...run, state: input.toState, sequence: event.sequence, headEventHash: event.eventHash,
    lease: nextLease, events: Object.freeze([...run.events, event]) });
}

function expectedEventIdentity(event: GuideRunEvent): Readonly<{ eventRef: string; eventHash: string }> {
  const { eventRef: _eventRef, eventHash: _eventHash, ...body } = event;
  const rebuilt = identifyEvent(body);
  return Object.freeze({ eventRef: rebuilt.eventRef, eventHash: rebuilt.eventHash });
}

export function verifyGuideRun(run: GuideRun): boolean {
  try {
    if (!hasExactKeys(run, ["version", "runRef", "workspaceRef", "guideRef", "guideRevisionHash", "trigger", "idempotencyKey",
      "state", "sequence", "headEventHash", "lease", "events", "authority"])
      || !hasExactKeys(run.authority, ["canApprove", "canExecute", "canWriteMeta"])
      || run.version !== GUIDE_RUN_VERSION || !REF.test(run.runRef) || !REF.test(run.workspaceRef)
      || !REF.test(run.guideRef) || !HASH.test(run.guideRevisionHash) || !Array.isArray(run.events)
      || !GUIDE_RUN_STATES.includes(run.state) || run.events.length !== run.sequence
      || run.authority.canApprove !== false || run.authority.canExecute !== false || run.authority.canWriteMeta !== false) return false;
    const trigger = normalizedTrigger(run.trigger);
    const expectedKey = trigger.kind === "scheduled" ? scheduledGuideRunIdempotencyKey(run.guideRevisionHash, trigger.scheduledFor)
      : manualGuideRunIdempotencyKey(run.guideRevisionHash, trigger.requestRef);
    const expectedRunRef = `guide_run_${digest({ workspaceRef: run.workspaceRef, guideRef: run.guideRef,
      guideRevisionHash: run.guideRevisionHash, trigger, idempotencyKey: expectedKey }).slice(0, 24)}`;
    if (run.idempotencyKey !== expectedKey || run.runRef !== expectedRunRef) return false;
    let state: GuideRunState | null = null;
    let previousHash = "GENESIS";
    let lease: Readonly<{ token: string; expiresAt: string }> | null = null;
    let previousOccurredAt: string | null = null;
    for (const [index, event] of run.events.entries()) {
      if (!hasExactKeys(event, ["version", "eventRef", "sequence", "previousEventHash", "fromState", "toState", "occurredAt",
        "leaseToken", "leaseUntil", "reasonCode", "eventHash"])) return false;
      const occurredAt = instant(event.occurredAt);
      if (occurredAt !== event.occurredAt || previousOccurredAt !== null && Date.parse(occurredAt) < Date.parse(previousOccurredAt)
        || event.reasonCode !== null && !CODE.test(event.reasonCode)
        || !GUIDE_RUN_STATES.includes(event.toState)
        || event.fromState !== null && !GUIDE_RUN_STATES.includes(event.fromState)
        || event.version !== GUIDE_RUN_EVENT_VERSION || event.sequence !== index + 1 || event.previousEventHash !== previousHash
        || event.fromState !== state || expectedEventIdentity(event).eventRef !== event.eventRef
        || expectedEventIdentity(event).eventHash !== event.eventHash) return false;
      if (state === null) {
        if (event.toState !== "due" || event.leaseToken !== null || event.leaseUntil !== null) return false;
      } else {
        if (!(NEXT[state] as readonly GuideRunState[]).includes(event.toState)) return false;
        if (event.toState === "claimed") {
          if (!event.leaseToken || !UUID.test(event.leaseToken) || !event.leaseUntil
            || Date.parse(event.leaseUntil) <= Date.parse(event.occurredAt)) return false;
          lease = Object.freeze({ token: event.leaseToken, expiresAt: event.leaseUntil });
        } else if (state !== "due") {
          if (!lease || event.leaseToken !== lease.token || event.leaseUntil !== lease.expiresAt
            || Date.parse(event.occurredAt) >= Date.parse(lease.expiresAt)) return false;
        } else if (event.leaseToken !== null || event.leaseUntil !== null) return false;
      }
      state = event.toState;
      previousHash = event.eventHash;
      previousOccurredAt = occurredAt;
      if (state === "completed" || state === "failed" || state === "missed") lease = null;
    }
    return state === run.state && previousHash === run.headEventHash
      && (lease === null ? run.lease === null : run.lease?.token === lease.token && run.lease.expiresAt === lease.expiresAt);
  } catch { return false; }
}

export function resolveGuideRunDisposition(input: Readonly<{
  mode: GuideMode;
  actionAllowlist: readonly GuideAction[];
  dataQuality: "ready" | "missing" | "stale";
  analysisOutcome: "finding" | "no_change";
  recommendationRef: string | null;
  candidate: Readonly<{ candidateRef: string; candidateHash: string; action: GuideAction }> | null;
}>): GuideRunDisposition {
  exact(input, ["mode", "actionAllowlist", "dataQuality", "analysisOutcome", "recommendationRef", "candidate"]);
  if (!GUIDE_MODES.includes(input.mode) || !["ready", "missing", "stale"].includes(input.dataQuality)
    || !["finding", "no_change"].includes(input.analysisOutcome) || !Array.isArray(input.actionAllowlist)
    || input.actionAllowlist.some((action) => !GUIDE_ACTIONS.includes(action))
    || new Set(input.actionAllowlist).size !== input.actionAllowlist.length) fail("invalid_input");
  const recommendationRef = input.recommendationRef === null ? null : ref(input.recommendationRef, "recommendation_");
  let candidate: GuideRunDisposition["candidate"] = null;
  if (input.candidate !== null) {
    exact(input.candidate, ["candidateRef", "candidateHash", "action"]);
    if (!GUIDE_ACTIONS.includes(input.candidate.action) || !input.actionAllowlist.includes(input.candidate.action)
      || !HASH.test(input.candidate.candidateHash)) fail("mode_violation");
    const authority = guideAuthority(input.mode, input.actionAllowlist);
    candidate = Object.freeze({ candidateRef: ref(input.candidate.candidateRef, "candidate_"),
      candidateHash: input.candidate.candidateHash, action: input.candidate.action,
      routing: authority.humanApprovalActions.includes(input.candidate.action)
        ? "human_approval" : "limited_autonomy_review" });
  }
  if (input.mode === "observe_analyze" && (recommendationRef !== null || candidate !== null)) fail("mode_violation");
  if (input.mode === "recommend" && candidate !== null) fail("mode_violation");
  if (candidate !== null && input.mode !== "prepare_human_approval" && input.mode !== "limited_autonomy") fail("mode_violation");
  if (input.dataQuality !== "ready") {
    const blockedWork = input.analysisOutcome === "finding" || recommendationRef !== null || candidate !== null;
    return Object.freeze({ state: blockedWork ? "held" : "no_action",
      reason: input.dataQuality === "missing" ? "data_missing" : "data_stale",
      recommendationRef: null, candidate: null, authority: DISPOSITION_AUTHORITY });
  }
  if (input.mode === "observe_analyze") return Object.freeze({ state: "no_action", reason: "mode_observe",
    recommendationRef: null, candidate: null, authority: DISPOSITION_AUTHORITY });
  if (input.mode === "recommend") return Object.freeze({ state: "no_action",
    reason: recommendationRef ? "recommendation_only" : "nothing_to_do", recommendationRef,
    candidate: null, authority: DISPOSITION_AUTHORITY });
  if (candidate !== null) return Object.freeze({ state: "staged", reason: "candidate_ready", recommendationRef,
    candidate, authority: DISPOSITION_AUTHORITY });
  return Object.freeze({ state: "no_action", reason: "nothing_to_do", recommendationRef,
    candidate: null, authority: DISPOSITION_AUTHORITY });
}
