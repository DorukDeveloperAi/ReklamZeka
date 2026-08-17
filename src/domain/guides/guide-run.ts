import { createHash } from "node:crypto";

import {
  GUIDE_ACTIONS, GUIDE_MODES, guideAuthority, type GuideAction, type GuideMode,
} from "@/domain/guides/guide-revision";

export const GUIDE_RUN_VERSION = "guide-run/1.1.0" as const;
export const GUIDE_RUN_EVENT_VERSION = "guide-run-event/1.1.0" as const;
export const GUIDE_RUN_V1_LEGACY_VERSION = "guide-run/1.0.0" as const;
export const GUIDE_RUN_EVENT_V1_LEGACY_VERSION = "guide-run-event/1.0.0" as const;
/** Recovery-capable evidence.  v1.1 remains immutable/read-only; never upcast it. */
export const GUIDE_RUN_V12_VERSION = "guide-run/1.2.0" as const;
export const GUIDE_RUN_EVENT_V12_VERSION = "guide-run-event/1.2.0" as const;

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
  runRef: string;
  sequence: number;
  previousEventHash: string;
  fromState: GuideRunState | null;
  toState: GuideRunState;
  occurredAt: string;
  leaseToken: string | null;
  leaseUntil: string | null;
  leaseEpoch: number | null;
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
  lease: Readonly<{ token: string; expiresAt: string; epoch: number }> | null;
  events: readonly GuideRunEvent[];
  authority: Readonly<{ canApprove: false; canExecute: false; canWriteMeta: false }>;
}>;

export type GuideRunEventV12 = Readonly<Omit<GuideRunEvent, "version"> & {
  version: typeof GUIDE_RUN_EVENT_V12_VERSION;
}>;
export type GuideRunV12 = Readonly<Omit<GuideRun, "version" | "events"> & {
  version: typeof GUIDE_RUN_V12_VERSION;
  events: readonly GuideRunEventV12[];
}>;
export type AnyGuideRun = GuideRun | GuideRunV12;

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
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) fail("invalid_input");
  const normalized = new Date(value).toISOString();
  // Date.UTC maps years 0–99 into 1900–1999. Keep persisted evidence inside the safe calendar range.
  if (!/^\d{4}-/.test(normalized) || Number(normalized.slice(0, 4)) < 100 || Number(normalized.slice(0, 4)) > 9998) fail("invalid_input");
  return normalized;
}
function leaseToken(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value) || value !== value.toLowerCase()) fail("lease_required");
  return value;
}
function epoch(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > Number.MAX_SAFE_INTEGER) fail("lease_required");
  return Number(value);
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

function initialEvent(runRef: string, occurredAt: string): GuideRunEvent {
  return identifyEvent({ version: GUIDE_RUN_EVENT_VERSION, sequence: 1, previousEventHash: "GENESIS",
    runRef, fromState: null, toState: "due", occurredAt, leaseToken: null, leaseUntil: null, leaseEpoch: null, reasonCode: null });
}

function identifyEventV12(value: Omit<GuideRunEventV12, "eventRef" | "eventHash">): GuideRunEventV12 {
  const eventHash = digest(value);
  return Object.freeze({ ...value, eventRef: `guide_run_event_${eventHash.slice(0, 24)}`, eventHash });
}
function initialEventV12(runRef: string, occurredAt: string): GuideRunEventV12 {
  return identifyEventV12({ version: GUIDE_RUN_EVENT_V12_VERSION, sequence: 1, previousEventHash: "GENESIS",
    runRef, fromState: null, toState: "due", occurredAt, leaseToken: null, leaseUntil: null, leaseEpoch: null, reasonCode: null });
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
  const runIdentity = digest({ workspaceRef, guideRef, guideRevisionHash: input.guideRevisionHash, trigger, idempotencyKey });
  const runRef = `guide_run_${runIdentity.slice(0, 24)}`;
  const event = initialEvent(runRef, occurredAt);
  return Object.freeze({ version: GUIDE_RUN_VERSION, runRef,
    workspaceRef, guideRef, guideRevisionHash: input.guideRevisionHash, trigger, idempotencyKey,
    state: "due", sequence: 1, headEventHash: event.eventHash, lease: null,
    events: Object.freeze([event]), authority: AUTHORITY });
}

/** Creates new recovery-capable evidence; callers must choose it explicitly. */
export function createGuideRunV12(input: Readonly<{
  workspaceRef: string; guideRef: string; guideRevisionHash: string; trigger: GuideRunTrigger; occurredAt: string;
}>): GuideRunV12 {
  exact(input, ["workspaceRef", "guideRef", "guideRevisionHash", "trigger", "occurredAt"]);
  const workspaceRef = ref(input.workspaceRef, "workspace_");
  const guideRef = ref(input.guideRef, "guide_");
  if (!HASH.test(input.guideRevisionHash)) fail("invalid_input");
  const trigger = normalizedTrigger(input.trigger); const occurredAt = instant(input.occurredAt);
  if (trigger.kind === "scheduled" && Date.parse(occurredAt) < Date.parse(trigger.scheduledFor)) fail("invalid_input");
  const idempotencyKey = trigger.kind === "scheduled"
    ? scheduledGuideRunIdempotencyKey(input.guideRevisionHash, trigger.scheduledFor)
    : manualGuideRunIdempotencyKey(input.guideRevisionHash, trigger.requestRef);
  const runRef = `guide_run_${digest({ workspaceRef, guideRef, guideRevisionHash: input.guideRevisionHash, trigger, idempotencyKey }).slice(0, 24)}`;
  const event = initialEventV12(runRef, occurredAt);
  return Object.freeze({ version: GUIDE_RUN_V12_VERSION, runRef, workspaceRef, guideRef,
    guideRevisionHash: input.guideRevisionHash, trigger, idempotencyKey, state: "due", sequence: 1,
    headEventHash: event.eventHash, lease: null, events: Object.freeze([event]), authority: AUTHORITY });
}

const NEXT = Object.freeze({
  due: Object.freeze(["claimed", "missed", "failed"] as const),
  claimed: Object.freeze(["claimed", "scope_frozen", "failed"] as const),
  scope_frozen: Object.freeze(["scope_frozen", "analyzing", "failed"] as const),
  analyzing: Object.freeze(["analyzing", "recorded", "failed"] as const),
  recorded: Object.freeze(["held", "staged", "no_action", "failed"] as const),
  held: Object.freeze(["completed", "failed"] as const),
  staged: Object.freeze(["completed", "failed"] as const),
  no_action: Object.freeze(["completed", "failed"] as const),
  completed: Object.freeze([] as const), failed: Object.freeze([] as const), missed: Object.freeze([] as const),
}) satisfies Readonly<Record<GuideRunState, readonly GuideRunState[]>>;
const LEGACY_NEXT = Object.freeze({
  ...NEXT, claimed: Object.freeze(["scope_frozen", "failed"] as const),
  scope_frozen: Object.freeze(["analyzing", "failed"] as const), analyzing: Object.freeze(["recorded", "failed"] as const),
}) satisfies Readonly<Record<GuideRunState, readonly GuideRunState[]>>;

function appendGuideRunTransitionFor<T extends AnyGuideRun>(run: T, input: Readonly<{
  expectedHeadHash: string;
  toState: Exclude<GuideRunState, "due">;
  occurredAt: string;
  leaseToken?: string;
  leaseUntil?: string;
  leaseEpoch?: number;
  reasonCode?: string | null;
}>, profile: Readonly<{ eventVersion: typeof GUIDE_RUN_EVENT_VERSION | typeof GUIDE_RUN_EVENT_V12_VERSION; selfLeaseStates: readonly GuideRunState[]; verify: (value: T) => boolean }>): T {
  if (!profile.verify(run)) fail("invalid_chain");
  const transitionKeys = ["expectedHeadHash", "toState", "occurredAt", "leaseToken", "leaseUntil", "leaseEpoch", "reasonCode"] as const;
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !Object.hasOwn(input, "expectedHeadHash") || !Object.hasOwn(input, "toState") || !Object.hasOwn(input, "occurredAt")
    || Object.keys(input).some((key) => !transitionKeys.includes(key as typeof transitionKeys[number]))) fail("invalid_input");
  if (input.expectedHeadHash !== run.headEventHash) fail("head_conflict");
  if (!GUIDE_RUN_STATES.includes(input.toState) || (!(NEXT[run.state] as readonly GuideRunState[]).includes(input.toState)
    && !(input.toState === run.state && profile.selfLeaseStates.includes(run.state)))) {
    fail("invalid_transition");
  }
  const occurredAt = instant(input.occurredAt);
  const previous = run.events.at(-1)!;
  if (Date.parse(occurredAt) < Date.parse(previous.occurredAt)) fail("invalid_transition");
  let eventLeaseToken: string | null = null;
  let eventLeaseUntil: string | null = null;
  let eventLeaseEpoch: number | null = null;
  let nextLease = run.lease;
  if (input.toState === "claimed") {
    if (input.leaseUntil === undefined) fail("lease_required");
    eventLeaseToken = leaseToken(input.leaseToken);
    eventLeaseUntil = instant(input.leaseUntil);
    if (Date.parse(eventLeaseUntil) <= Date.parse(occurredAt)) fail("lease_expired");
    if (run.state === "due") {
      if (input.leaseEpoch !== undefined && input.leaseEpoch !== 1) fail("lease_required");
      eventLeaseEpoch = 1;
    } else {
      if (!run.lease) fail("lease_required");
      const expired = Date.parse(occurredAt) >= Date.parse(run.lease.expiresAt);
      if (expired ? eventLeaseToken === run.lease.token : eventLeaseToken !== run.lease.token) fail("lease_required");
      if (!expired && Date.parse(eventLeaseUntil) <= Date.parse(run.lease.expiresAt)) fail("lease_required");
      if (run.lease.epoch === Number.MAX_SAFE_INTEGER || input.leaseEpoch !== undefined && input.leaseEpoch !== run.lease.epoch + 1) fail("lease_required");
      eventLeaseEpoch = run.lease.epoch + 1;
    }
    nextLease = Object.freeze({ token: eventLeaseToken, expiresAt: eventLeaseUntil, epoch: eventLeaseEpoch });
  } else if (input.toState === run.state && profile.selfLeaseStates.includes(run.state)) {
    if (!run.lease || input.leaseUntil === undefined) fail("lease_required");
    eventLeaseToken = leaseToken(input.leaseToken);
    eventLeaseUntil = instant(input.leaseUntil);
    const expired = Date.parse(occurredAt) >= Date.parse(run.lease.expiresAt);
    if (expired ? eventLeaseToken === run.lease.token : eventLeaseToken !== run.lease.token) fail("lease_required");
    if (Date.parse(eventLeaseUntil) <= Date.parse(occurredAt) || !expired && Date.parse(eventLeaseUntil) <= Date.parse(run.lease.expiresAt)) fail("lease_expired");
    if (run.lease.epoch === Number.MAX_SAFE_INTEGER || input.leaseEpoch !== undefined && input.leaseEpoch !== run.lease.epoch + 1) fail("lease_required");
    eventLeaseEpoch = run.lease.epoch + 1;
    nextLease = Object.freeze({ token: eventLeaseToken, expiresAt: eventLeaseUntil, epoch: eventLeaseEpoch });
  } else if (run.state !== "due") {
    if (!run.lease || leaseToken(input.leaseToken) !== run.lease.token) fail("lease_required");
    if (Date.parse(occurredAt) >= Date.parse(run.lease.expiresAt)) fail("lease_expired");
    if (input.leaseUntil !== undefined && instant(input.leaseUntil) !== run.lease.expiresAt) fail("lease_required");
    if (input.leaseEpoch !== undefined && input.leaseEpoch !== run.lease.epoch) fail("lease_required");
    eventLeaseToken = run.lease.token;
    eventLeaseUntil = run.lease.expiresAt;
    eventLeaseEpoch = run.lease.epoch;
  } else if (input.leaseToken !== undefined || input.leaseUntil !== undefined || input.leaseEpoch !== undefined) fail("lease_required");
  if (["completed", "failed", "missed"].includes(input.toState)) nextLease = null;
  const eventBody = { version: profile.eventVersion, sequence: run.sequence + 1,
    previousEventHash: run.headEventHash, fromState: run.state, toState: input.toState, occurredAt,
    runRef: run.runRef, leaseToken: eventLeaseToken, leaseUntil: eventLeaseUntil, leaseEpoch: eventLeaseEpoch,
    reasonCode: reason(input.reasonCode ?? null) };
  const event = profile.eventVersion === GUIDE_RUN_EVENT_VERSION
    ? identifyEvent(eventBody as Omit<GuideRunEvent, "eventRef" | "eventHash">)
    : identifyEventV12(eventBody as Omit<GuideRunEventV12, "eventRef" | "eventHash">);
  return Object.freeze({ ...run, state: input.toState, sequence: event.sequence, headEventHash: event.eventHash,
    lease: nextLease, events: Object.freeze([...run.events, event]) }) as T;
}

export function appendGuideRunTransition(run: GuideRun, input: Readonly<{
  expectedHeadHash: string; toState: Exclude<GuideRunState, "due">; occurredAt: string;
  leaseToken?: string; leaseUntil?: string; leaseEpoch?: number; reasonCode?: string | null;
}>): GuideRun {
  return appendGuideRunTransitionFor(run, input, { eventVersion: GUIDE_RUN_EVENT_VERSION,
    selfLeaseStates: ["scope_frozen", "analyzing"], verify: verifyGuideRun });
}

/** v1.2 permits renewal/reclaim after analysis, never a changed main state. */
export function appendGuideRunTransitionV12(run: GuideRunV12, input: Readonly<{
  expectedHeadHash: string; toState: Exclude<GuideRunState, "due">; occurredAt: string;
  leaseToken?: string; leaseUntil?: string; leaseEpoch?: number; reasonCode?: string | null;
}>): GuideRunV12 {
  return appendGuideRunTransitionFor(run, input, { eventVersion: GUIDE_RUN_EVENT_V12_VERSION,
    selfLeaseStates: ["scope_frozen", "analyzing", "recorded", "held", "staged", "no_action"], verify: verifyGuideRunV12 });
}

function expectedEventIdentity(event: GuideRunEvent | GuideRunEventV12): Readonly<{ eventRef: string; eventHash: string }> {
  const { eventRef: _eventRef, eventHash: _eventHash, ...body } = event;
  const rebuilt = event.version === GUIDE_RUN_EVENT_VERSION
    ? identifyEvent(body as Omit<GuideRunEvent, "eventRef" | "eventHash">)
    : identifyEventV12(body as Omit<GuideRunEventV12, "eventRef" | "eventHash">);
  return Object.freeze({ eventRef: rebuilt.eventRef, eventHash: rebuilt.eventHash });
}

function verifyGuideRunFor<T extends AnyGuideRun>(run: T, profile: Readonly<{ runVersion: T["version"]; eventVersion: T["events"][number]["version"]; selfLeaseStates: readonly GuideRunState[] }>): boolean {
  try {
    if (!hasExactKeys(run, ["version", "runRef", "workspaceRef", "guideRef", "guideRevisionHash", "trigger", "idempotencyKey",
      "state", "sequence", "headEventHash", "lease", "events", "authority"])
      || !hasExactKeys(run.authority, ["canApprove", "canExecute", "canWriteMeta"])
      || run.version !== profile.runVersion || !REF.test(run.runRef) || !REF.test(run.workspaceRef)
      || !REF.test(run.guideRef) || !HASH.test(run.guideRevisionHash) || !Array.isArray(run.events)
      || !GUIDE_RUN_STATES.includes(run.state) || run.events.length !== run.sequence
      || run.authority.canApprove !== false || run.authority.canExecute !== false || run.authority.canWriteMeta !== false) return false;
    if (run.lease !== null) {
      if (!hasExactKeys(run.lease, ["token", "expiresAt", "epoch"]) || leaseToken(run.lease.token) !== run.lease.token
        || instant(run.lease.expiresAt) !== run.lease.expiresAt || epoch(run.lease.epoch) !== run.lease.epoch) return false;
    }
    const trigger = normalizedTrigger(run.trigger);
    const expectedKey = trigger.kind === "scheduled" ? scheduledGuideRunIdempotencyKey(run.guideRevisionHash, trigger.scheduledFor)
      : manualGuideRunIdempotencyKey(run.guideRevisionHash, trigger.requestRef);
    const expectedRunRef = `guide_run_${digest({ workspaceRef: run.workspaceRef, guideRef: run.guideRef,
      guideRevisionHash: run.guideRevisionHash, trigger, idempotencyKey: expectedKey }).slice(0, 24)}`;
    if (run.idempotencyKey !== expectedKey || run.runRef !== expectedRunRef) return false;
    let state: GuideRunState | null = null;
    let previousHash = "GENESIS";
    let lease: Readonly<{ token: string; expiresAt: string; epoch: number }> | null = null;
    let previousOccurredAt: string | null = null;
    for (const [index, event] of run.events.entries()) {
      if (!hasExactKeys(event, ["version", "eventRef", "runRef", "sequence", "previousEventHash", "fromState", "toState", "occurredAt",
        "leaseToken", "leaseUntil", "leaseEpoch", "reasonCode", "eventHash"])) return false;
      const occurredAt = instant(event.occurredAt);
      if (occurredAt !== event.occurredAt || previousOccurredAt !== null && Date.parse(occurredAt) < Date.parse(previousOccurredAt)
        || event.reasonCode !== null && !CODE.test(event.reasonCode)
        || !GUIDE_RUN_STATES.includes(event.toState)
        || event.fromState !== null && !GUIDE_RUN_STATES.includes(event.fromState) || event.runRef !== run.runRef
        || event.version !== profile.eventVersion || event.sequence !== index + 1 || event.previousEventHash !== previousHash
        || event.fromState !== state || expectedEventIdentity(event).eventRef !== event.eventRef
        || expectedEventIdentity(event).eventHash !== event.eventHash) return false;
      if (state === null) {
        if (event.toState !== "due" || event.leaseToken !== null || event.leaseUntil !== null || event.leaseEpoch !== null) return false;
      } else {
        if (!(NEXT[state] as readonly GuideRunState[]).includes(event.toState)
          && !(event.toState === state && profile.selfLeaseStates.includes(state))) return false;
        if (event.toState === "claimed") {
          if (!event.leaseToken || leaseToken(event.leaseToken) !== event.leaseToken || !event.leaseUntil
            || instant(event.leaseUntil) !== event.leaseUntil || epoch(event.leaseEpoch) !== event.leaseEpoch
            || Date.parse(event.leaseUntil) <= Date.parse(event.occurredAt)) return false;
          if (state === "due") {
            if (event.leaseEpoch !== 1) return false;
          } else {
            if (!lease || event.leaseEpoch !== lease.epoch + 1
              || Date.parse(event.occurredAt) >= Date.parse(lease.expiresAt) && event.leaseToken === lease.token
              || Date.parse(event.occurredAt) < Date.parse(lease.expiresAt) && event.leaseToken !== lease.token
              || Date.parse(event.occurredAt) < Date.parse(lease.expiresAt) && Date.parse(event.leaseUntil) <= Date.parse(lease.expiresAt)) return false;
          }
          lease = Object.freeze({ token: event.leaseToken, expiresAt: event.leaseUntil, epoch: event.leaseEpoch });
        } else if (event.toState === state && profile.selfLeaseStates.includes(state)) {
          if (!lease || !event.leaseToken || leaseToken(event.leaseToken) !== event.leaseToken || !event.leaseUntil
            || instant(event.leaseUntil) !== event.leaseUntil || epoch(event.leaseEpoch) !== event.leaseEpoch
            || event.leaseEpoch !== lease.epoch + 1 || Date.parse(event.leaseUntil) <= Date.parse(event.occurredAt)
            || Date.parse(event.occurredAt) >= Date.parse(lease.expiresAt) && event.leaseToken === lease.token
            || Date.parse(event.occurredAt) < Date.parse(lease.expiresAt) && event.leaseToken !== lease.token
            || Date.parse(event.occurredAt) < Date.parse(lease.expiresAt) && Date.parse(event.leaseUntil) <= Date.parse(lease.expiresAt)) return false;
          lease = Object.freeze({ token: event.leaseToken, expiresAt: event.leaseUntil, epoch: event.leaseEpoch });
        } else if (state !== "due") {
          if (!lease || event.leaseToken !== lease.token || event.leaseUntil !== lease.expiresAt
            || event.leaseEpoch !== lease.epoch || Date.parse(event.occurredAt) >= Date.parse(lease.expiresAt)) return false;
        } else if (event.leaseToken !== null || event.leaseUntil !== null || event.leaseEpoch !== null) return false;
      }
      state = event.toState;
      previousHash = event.eventHash;
      previousOccurredAt = occurredAt;
      if (state === "completed" || state === "failed" || state === "missed") lease = null;
    }
    return state === run.state && previousHash === run.headEventHash
      && (lease === null ? run.lease === null : run.lease?.token === lease.token && run.lease.expiresAt === lease.expiresAt && run.lease.epoch === lease.epoch);
  } catch { return false; }
}

export function verifyGuideRun(run: GuideRun): boolean {
  return verifyGuideRunFor(run, { runVersion: GUIDE_RUN_VERSION, eventVersion: GUIDE_RUN_EVENT_VERSION,
    selfLeaseStates: ["scope_frozen", "analyzing"] });
}

export function verifyGuideRunV12(run: GuideRunV12): boolean {
  return verifyGuideRunFor(run, { runVersion: GUIDE_RUN_V12_VERSION, eventVersion: GUIDE_RUN_EVENT_V12_VERSION,
    selfLeaseStates: ["scope_frozen", "analyzing", "recorded", "held", "staged", "no_action"] });
}

/** Version dispatch for storage/orchestration boundaries. */
export function verifyAnyGuideRun(run: AnyGuideRun): boolean {
  return run.version === GUIDE_RUN_VERSION ? verifyGuideRun(run) : run.version === GUIDE_RUN_V12_VERSION && verifyGuideRunV12(run);
}

/** Read-only verifier for evidence created before run-bound event hashes were introduced. */
export function verifyGuideRunV1Legacy(run: unknown): boolean {
  try {
    if (!hasExactKeys(run, ["version", "runRef", "workspaceRef", "guideRef", "guideRevisionHash", "trigger", "idempotencyKey",
      "state", "sequence", "headEventHash", "lease", "events", "authority"])) return false;
    const candidate = run as Record<string, unknown>;
    if (candidate.version !== GUIDE_RUN_V1_LEGACY_VERSION || !REF.test(String(candidate.runRef)) || !REF.test(String(candidate.workspaceRef))
      || !REF.test(String(candidate.guideRef)) || !HASH.test(String(candidate.guideRevisionHash)) || !Array.isArray(candidate.events)
      || !Number.isSafeInteger(candidate.sequence) || candidate.events.length !== candidate.sequence || !GUIDE_RUN_STATES.includes(candidate.state as GuideRunState)
      || !hasExactKeys(candidate.authority, ["canApprove", "canExecute", "canWriteMeta"])) return false;
    const authority = candidate.authority as Record<string, unknown>;
    if (authority.canApprove !== false || authority.canExecute !== false || authority.canWriteMeta !== false) return false;
    const trigger = normalizedTrigger(candidate.trigger as GuideRunTrigger);
    const key = trigger.kind === "scheduled" ? scheduledGuideRunIdempotencyKey(String(candidate.guideRevisionHash), trigger.scheduledFor)
      : manualGuideRunIdempotencyKey(String(candidate.guideRevisionHash), trigger.requestRef);
    const expectedRunRef = `guide_run_${digest({ workspaceRef: candidate.workspaceRef, guideRef: candidate.guideRef,
      guideRevisionHash: candidate.guideRevisionHash, trigger, idempotencyKey: key }).slice(0, 24)}`;
    if (candidate.idempotencyKey !== key || candidate.runRef !== expectedRunRef) return false;
    let state: GuideRunState | null = null; let previousHash = "GENESIS"; let previousAt: string | null = null;
    let lease: Readonly<{ token: string; expiresAt: string }> | null = null;
    for (const [index, raw] of candidate.events.entries()) {
      if (!hasExactKeys(raw, ["version", "eventRef", "sequence", "previousEventHash", "fromState", "toState", "occurredAt",
        "leaseToken", "leaseUntil", "reasonCode", "eventHash"])) return false;
      const event = raw as Record<string, unknown>;
      const at = instant(event.occurredAt);
      if (event.version !== GUIDE_RUN_EVENT_V1_LEGACY_VERSION || event.sequence !== index + 1 || event.previousEventHash !== previousHash
        || event.fromState !== state || at !== event.occurredAt || previousAt !== null && Date.parse(at) < Date.parse(previousAt)
        || !GUIDE_RUN_STATES.includes(event.toState as GuideRunState) || event.fromState !== null && !GUIDE_RUN_STATES.includes(event.fromState as GuideRunState)
        || event.reasonCode !== null && !CODE.test(String(event.reasonCode))) return false;
      const { eventRef: storedRef, eventHash: storedHash, ...body } = event;
      const hash = digest(body);
      if (storedHash !== hash || storedRef !== `guide_run_event_${hash.slice(0, 24)}`) return false;
      if (state === null) {
        if (event.toState !== "due" || event.leaseToken !== null || event.leaseUntil !== null) return false;
      } else if (!(LEGACY_NEXT[state] as readonly GuideRunState[]).includes(event.toState as GuideRunState)) return false;
      else if (event.toState === "claimed") {
        if (typeof event.leaseToken !== "string" || leaseToken(event.leaseToken) !== event.leaseToken || typeof event.leaseUntil !== "string"
          || instant(event.leaseUntil) !== event.leaseUntil || Date.parse(event.leaseUntil) <= Date.parse(at)) return false;
        lease = Object.freeze({ token: event.leaseToken, expiresAt: event.leaseUntil });
      } else if (state !== "due") {
        if (!lease || event.leaseToken !== lease.token || event.leaseUntil !== lease.expiresAt || Date.parse(at) >= Date.parse(lease.expiresAt)) return false;
      } else if (event.leaseToken !== null || event.leaseUntil !== null) return false;
      state = event.toState as GuideRunState; previousHash = hash; previousAt = at;
      if (["completed", "failed", "missed"].includes(state)) lease = null;
    }
    const actualLease = candidate.lease;
    if (actualLease !== null && (!hasExactKeys(actualLease, ["token", "expiresAt"])
      || leaseToken((actualLease as Record<string, unknown>).token) !== (actualLease as Record<string, unknown>).token
      || instant((actualLease as Record<string, unknown>).expiresAt) !== (actualLease as Record<string, unknown>).expiresAt)) return false;
    return state === candidate.state && previousHash === candidate.headEventHash
      && (lease === null ? actualLease === null : Boolean(actualLease) && typeof actualLease === "object"
        && (actualLease as { token?: unknown }).token === lease.token && (actualLease as { expiresAt?: unknown }).expiresAt === lease.expiresAt);
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
