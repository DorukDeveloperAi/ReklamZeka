import { createHash } from "node:crypto";
import {
  resolveEffectiveGuideOverlap,
  type EffectiveGuideBinding,
} from "@/domain/guides/effective-guide-overlap";
import {
  GUIDE_ACTIONS,
  type GuideAction,
  type GuideMarket,
} from "@/domain/guides/guide-revision";

export const P06_EXECUTION_CONTRACT_VERSION =
  "p06-execution-contract/1.3.0" as const;
export type P06Action = GuideAction | "create" | "raw_graph";
export type P06HumanDecision =
  "approve" | "reject" | "defer" | "request_changes";
export type P06KillStage =
  "admission" | "post_claim" | "pre_dispatch" | "read_after_write";
export type P06ExecutionPath =
  "normal_write" | "already_applied" | "ambiguous_transport";
export type P06ExecutionStep =
  | "lease"
  | "idempotency"
  | "current_read"
  | "expected_before"
  | "typed_mutation"
  | "read_after_write"
  | "already_applied_no_write"
  | "ambiguous_read_before_retry"
  | "immutable_terminal"
  | "release";
export type P06ExecutionObservation = Readonly<{
  step: P06ExecutionStep;
  outcome:
    | "ok"
    | "skipped"
    | "already_applied"
    | "ambiguous_transport"
    | "resolved_after_read"
    | "stale_fence"
    | "kill"
    | "terminal";
  receiptHash?: string;
}>;
export type P06KillGate = Readonly<{
  version: "p06-kill-gate/1.3.0";
  source: "trusted_receipt_port";
  sequence: number;
  previousReceiptHash: string | null;
  stage: P06KillStage;
  workspaceRef: string;
  executionRef: string;
  leaseTokenHash: string;
  fenceHash: string;
  enabled: boolean;
  capturedAt: string;
  expiresAt: string;
  snapshotHash: string;
}>;
/** Ports are intentionally unknown-valued: this module is the only evidence decoder. */
export type P06TrustedPort = Readonly<{
  admission(
    query: Readonly<{
      workspaceRef: string;
      accountRef: string;
      entityRef: string;
      sliceRef: string;
      market: unknown;
      action: P06Action;
      evaluatedAt: string;
    }>,
  ): unknown;
  human(
    query: Readonly<{
      decision: P06HumanDecision;
      actorRef: string;
      action: P06Action;
      actionUnitRef: string;
      actionUnitHash: string;
      proposalRef: string;
      proposalHash: string;
      evaluatedAt: string;
    }>,
  ): unknown;
  execution(
    query: Readonly<{
      workspaceRef: string;
      executionRef: string;
      leaseTokenHash: string;
      fenceHash: string;
      evaluatedAt: string;
    }>,
  ): unknown;
  rollback(
    query: Readonly<{
      workspaceRef: string;
      executionRef: string;
      targetRef: string;
      action: GuideAction;
      evaluatedAt: string;
    }>,
  ): unknown;
}>;
export class P06ExecutionContractError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_trace") {
    super(code);
    this.name = "P06ExecutionContractError";
  }
}

type Obj = Record<string, unknown>;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const CAPS = Object.freeze({
  canExecute: false as const,
  canWriteMeta: false as const,
  canDispatchNetwork: false as const,
});
const STEPS: readonly P06ExecutionStep[] = [
  "lease",
  "idempotency",
  "current_read",
  "expected_before",
  "typed_mutation",
  "read_after_write",
  "already_applied_no_write",
  "ambiguous_read_before_retry",
  "immutable_terminal",
  "release",
];
const OUTCOMES = new Set<P06ExecutionObservation["outcome"]>([
  "ok",
  "skipped",
  "already_applied",
  "ambiguous_transport",
  "resolved_after_read",
  "stale_fence",
  "kill",
  "terminal",
]);
function bad(code: P06ExecutionContractError["code"] = "invalid_input"): never {
  throw new P06ExecutionContractError(code);
}
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function obj(
  value: unknown,
  keys: readonly string[],
  code: P06ExecutionContractError["code"] = "invalid_input",
): Obj {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    bad(code);
  const o = value as Obj;
  const actual = Object.keys(o);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  )
    bad(code);
  return o;
}
function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) bad();
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) bad();
  return value;
}
function time(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    new Date(value).toISOString() !== value
  )
    bad();
  return value;
}
function natural(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > maximum
  )
    bad();
  return value as number;
}
function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    Object.values(value as Obj).forEach((item) => freeze(item, seen));
    Object.freeze(value);
  }
  return value;
}
function canonical(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (depth > 32) bad();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 16_878) bad();
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) bad();
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) bad();
    return value.map((item) => canonical(item, depth + 1, seen));
  }
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    seen.has(value)
  )
    bad();
  seen.add(value);
  const entries = Object.entries(value as Obj);
  if (
    entries.length > 128 ||
    entries.some(([key, item]) => key.length > 128 || item === undefined)
  )
    bad();
  const output = Object.fromEntries(
    entries
      .sort(([a], [b]) => cmp(a, b))
      .map(([key, item]) => [key, canonical(item, depth + 1, seen)]),
  );
  seen.delete(value);
  return output;
}
function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
function action(value: unknown): P06Action {
  if (value === "create" || value === "raw_graph") return value;
  if (
    typeof value === "string" &&
    (GUIDE_ACTIONS as readonly string[]).includes(value)
  )
    return value as GuideAction;
  return bad();
}
function market(value: unknown): GuideMarket {
  if (value === "yerli" || value === "yabanci") return value;
  return bad();
}
function stage(value: unknown): P06KillStage {
  if (
    value === "admission" ||
    value === "post_claim" ||
    value === "pre_dispatch" ||
    value === "read_after_write"
  )
    return value;
  return bad();
}
function nullableNatural(value: unknown): number | null {
  return value === null ? null : natural(value);
}

function gate(value: unknown): P06KillGate {
  const o = obj(value, [
    "version",
    "source",
    "sequence",
    "previousReceiptHash",
    "stage",
    "workspaceRef",
    "executionRef",
    "leaseTokenHash",
    "fenceHash",
    "enabled",
    "capturedAt",
    "expiresAt",
    "snapshotHash",
  ]);
  if (
    o.version !== "p06-kill-gate/1.3.0" ||
    o.source !== "trusted_receipt_port" ||
    typeof o.enabled !== "boolean"
  )
    bad();
  return freeze({
    version: o.version,
    source: o.source,
    sequence: natural(o.sequence, 1_000_000),
    previousReceiptHash:
      o.previousReceiptHash === null ? null : hash(o.previousReceiptHash),
    stage: stage(o.stage),
    workspaceRef: ref(o.workspaceRef),
    executionRef: ref(o.executionRef),
    leaseTokenHash: hash(o.leaseTokenHash),
    fenceHash: hash(o.fenceHash),
    enabled: o.enabled,
    capturedAt: time(o.capturedAt),
    expiresAt: time(o.expiresAt),
    snapshotHash: hash(o.snapshotHash),
  });
}
function gates(
  value: unknown,
  ws: string,
  ex: string,
  lease: string,
  fence: string,
  at: string,
  wanted: readonly P06KillStage[],
): readonly P06KillGate[] {
  if (!Array.isArray(value) || value.length !== wanted.length) bad();
  let previous: string | null = null;
  let previousAt = -1;
  return freeze(
    value.map((item, index) => {
      const g = gate(item);
      const captured = Date.parse(g.capturedAt);
      const core = {
        version: g.version,
        source: g.source,
        sequence: g.sequence,
        previousReceiptHash: g.previousReceiptHash,
        stage: g.stage,
        workspaceRef: g.workspaceRef,
        executionRef: g.executionRef,
        leaseTokenHash: g.leaseTokenHash,
        fenceHash: g.fenceHash,
        enabled: g.enabled,
        capturedAt: g.capturedAt,
        expiresAt: g.expiresAt,
      };
      if (
        g.sequence !== index + 1 ||
        g.previousReceiptHash !== previous ||
        g.stage !== wanted[index] ||
        g.workspaceRef !== ws ||
        g.executionRef !== ex ||
        g.leaseTokenHash !== lease ||
        g.fenceHash !== fence ||
        captured <= previousAt ||
        captured > Date.parse(at) ||
        Date.parse(g.expiresAt) <= Date.parse(at) ||
        digest(core) !== g.snapshotHash
      )
        bad();
      previous = g.snapshotHash;
      previousAt = captured;
      return g;
    }),
  );
}

/** Validates the exact trusted head with the canonical overlap resolver. The port can only supply values, never authority. */
function admission(value: unknown) {
  const o = obj(value, ["activeHead", "budget", "gates"]);
  const h = obj(o.activeHead, [
    "workspaceRef",
    "accountRef",
    "entityRef",
    "sliceRef",
    "market",
    "bindings",
    "overlap",
    "receiptCore",
    "receiptHash",
  ]);
  const b = obj(o.budget, [
    "currentBudgetMinor",
    "absoluteDeltaMinor",
    "relativeDeltaBasisPoints",
    "actionsAlreadyInRun",
  ]);
  if (
    !Array.isArray(h.bindings) ||
    h.bindings.length < 1 ||
    h.bindings.length > 1_000
  )
    bad();
  /* Resolver performs the full, closed revision/restriction/cap grammar before any result is used. */ const bindings =
    h.bindings as readonly EffectiveGuideBinding[];
  if (
    bindings.some(
      (binding) =>
        binding.revision.sliceRef !== h.sliceRef ||
        binding.revision.market !== h.market,
    )
  )
    bad();
  const resolved = resolveEffectiveGuideOverlap({
    workspaceRef: ref(h.workspaceRef),
    entityRef: ref(h.entityRef),
    market: market(h.market),
    guides: bindings,
  });
  if (digest(resolved) !== digest(h.overlap)) bad();
  const receiptCore = obj(h.receiptCore, [
    "version",
    "workspaceRef",
    "accountRef",
    "entityRef",
    "sliceRef",
    "market",
    "guideEvidence",
    "budget",
  ]);
  if (
    receiptCore.version !== "p06-active-head/1.0" ||
    receiptCore.workspaceRef !== h.workspaceRef ||
    receiptCore.accountRef !== h.accountRef ||
    receiptCore.entityRef !== h.entityRef ||
    receiptCore.sliceRef !== h.sliceRef ||
    receiptCore.market !== h.market ||
    digest(receiptCore.guideEvidence) !== digest(resolved.guideEvidence) ||
    digest(receiptCore.budget) !== digest(b) ||
    digest(receiptCore) !== hash(h.receiptHash)
  )
    bad();
  return freeze({
    workspaceRef: ref(h.workspaceRef),
    accountRef: ref(h.accountRef),
    entityRef: ref(h.entityRef),
    sliceRef: ref(h.sliceRef),
    market: market(h.market),
    receiptHash: hash(h.receiptHash),
    resolved,
    budget: {
      currentBudgetMinor: nullableNatural(b.currentBudgetMinor),
      absoluteDeltaMinor: nullableNatural(b.absoluteDeltaMinor),
      relativeDeltaBasisPoints: nullableNatural(b.relativeDeltaBasisPoints),
      actionsAlreadyInRun: natural(b.actionsAlreadyInRun, 10_000),
    },
    rawGates: o.gates,
  });
}

export function createP06ExecutionContractService(port: P06TrustedPort) {
  if (
    !port ||
    typeof port !== "object" ||
    typeof port.admission !== "function" ||
    typeof port.human !== "function" ||
    typeof port.execution !== "function" ||
    typeof port.rollback !== "function"
  )
    bad();
  return freeze({
    admit(
      input: Readonly<{
        workspaceRef: string;
        accountRef: string;
        entityRef: string;
        sliceRef: string;
        market: GuideMarket;
        action: P06Action;
        window: { opensAt: string; closesAt: string };
        evaluatedAt: string;
      }>,
    ) {
      const i = obj(input, [
        "workspaceRef",
        "accountRef",
        "entityRef",
        "sliceRef",
        "market",
        "action",
        "window",
        "evaluatedAt",
      ]);
      const w = obj(i.window, ["opensAt", "closesAt"]);
      const ws = ref(i.workspaceRef),
        accountRef = ref(i.accountRef),
        entityRef = ref(i.entityRef),
        sliceRef = ref(i.sliceRef),
        selected = action(i.action),
        at = time(i.evaluatedAt),
        opensAt = time(w.opensAt),
        closesAt = time(w.closesAt);
      if (Date.parse(opensAt) >= Date.parse(closesAt)) bad();
      const evidence = admission(
        port.admission({
          workspaceRef: ws,
          accountRef,
          entityRef,
          sliceRef,
          market: i.market,
          action: selected,
          evaluatedAt: at,
        }),
      );
      if (
        evidence.workspaceRef !== ws ||
        evidence.accountRef !== accountRef ||
        evidence.entityRef !== entityRef ||
        evidence.sliceRef !== sliceRef ||
        evidence.market !== i.market
      )
        bad();
      const gs = gates(
        evidence.rawGates,
        ws,
        `execution_${evidence.receiptHash.slice(0, 16)}`,
        evidence.receiptHash,
        evidence.receiptHash,
        at,
        ["admission"],
      );
      const reasons = gs
        .filter((g) => g.enabled)
        .map((g) => `kill_switch_${g.stage}`);
      const overlap = evidence.resolved;
      const cap = (kind: string, currency: "TRY" | null) =>
        overlap.numericCaps.find(
          (x) =>
            x.action === selected && x.kind === kind && x.currency === currency,
        )?.value ?? null;
      if (
        selected === "create" ||
        selected === "raw_graph" ||
        selected.endsWith("_rename") ||
        overlap.hold.state !== "clear" ||
        overlap.effectiveMode !== "limited_autonomy" ||
        !overlap.autonomousActions.includes(selected as GuideAction) ||
        Date.parse(at) < Date.parse(opensAt) ||
        Date.parse(at) >= Date.parse(closesAt)
      )
        reasons.push("held");
      if (
        cap("maximum_actions_per_run", null) === null ||
        evidence.budget.actionsAlreadyInRun >=
          cap("maximum_actions_per_run", null)!
      )
        reasons.push("quota");
      if (
        selected.startsWith("budget_") &&
        (evidence.budget.currentBudgetMinor === null ||
          evidence.budget.absoluteDeltaMinor === null ||
          evidence.budget.relativeDeltaBasisPoints === null ||
          evidence.budget.absoluteDeltaMinor >
            (cap("maximum_absolute_budget_delta_minor", "TRY") ?? -1) ||
          evidence.budget.relativeDeltaBasisPoints >
            (cap("maximum_relative_budget_delta_basis_points", null) ?? -1))
      )
        reasons.push("cap");
      const core = {
        version: P06_EXECUTION_CONTRACT_VERSION,
        disposition: reasons.length
          ? ("held" as const)
          : ("admitted_for_disabled_executor" as const),
        reasons: freeze([...new Set(reasons)].sort(cmp)),
        action: selected,
        workspaceRef: ws,
        accountRef,
        entityRef,
        sliceRef,
        market: evidence.market,
        window: { opensAt, closesAt },
        evaluatedAt: at,
        currentBudgetMinor: evidence.budget.currentBudgetMinor,
        absoluteDeltaMinor: evidence.budget.absoluteDeltaMinor,
        relativeDeltaBasisPoints: evidence.budget.relativeDeltaBasisPoints,
        actionsAlreadyInRun: evidence.budget.actionsAlreadyInRun,
        numericCaps: overlap.numericCaps,
        effectiveGuideSetHash: overlap.effectiveGuideSetHash,
        resolutionHash: overlap.resolutionHash,
        activeHeadHash: evidence.receiptHash,
        activeGuideEvidence: overlap.guideEvidence,
        killGateHashes: gs.map((gate) => gate.snapshotHash),
        capabilities: CAPS,
      };
      return freeze({ ...core, admissionHash: digest(core) });
    },
    humanDecision(
      input: Readonly<{
        decision: P06HumanDecision;
        actorRef: string;
        action: P06Action;
        actionUnitRef: string;
        actionUnitHash: string;
        proposalRef: string;
        proposalHash: string;
        evaluatedAt: string;
      }>,
    ) {
      const i = obj(input, [
        "decision",
        "actorRef",
        "action",
        "actionUnitRef",
        "actionUnitHash",
        "proposalRef",
        "proposalHash",
        "evaluatedAt",
      ]);
      if (
        i.decision !== "approve" &&
        i.decision !== "reject" &&
        i.decision !== "defer" &&
        i.decision !== "request_changes"
      )
        bad();
      const binding = {
        actorRef: ref(i.actorRef),
        action: action(i.action),
        actionUnitRef: ref(i.actionUnitRef),
        actionUnitHash: hash(i.actionUnitHash),
        proposalRef: ref(i.proposalRef),
        proposalHash: hash(i.proposalHash),
        evaluatedAt: time(i.evaluatedAt),
      };
      const proof = obj(port.human({ ...binding, decision: i.decision }), [
        "authorizationRef",
        "issuedAt",
        "expiresAt",
        "bindingHash",
      ]);
      if (
        hash(proof.bindingHash) !==
          digest({ ...binding, decision: i.decision }) ||
        Date.parse(time(proof.issuedAt)) > Date.parse(binding.evaluatedAt) ||
        Date.parse(time(proof.expiresAt)) <= Date.parse(binding.evaluatedAt)
      )
        bad();
      const disposition =
        binding.action === "create" || binding.action === "raw_graph"
          ? "denied"
          : i.decision === "approve"
            ? "approved"
            : i.decision === "reject"
              ? "rejected"
              : i.decision === "defer"
                ? "deferred"
                : "changes_requested";
      return freeze({
        ...binding,
        decision: i.decision,
        authorizationRef: ref(proof.authorizationRef),
        humanPresenceHash: digest(proof),
        disposition,
        canWriteMeta: false as const,
      });
    },
    execution(
      input: Readonly<{
        workspaceRef: string;
        executionRef: string;
        leaseTokenHash: string;
        fenceHash: string;
        epoch: number;
        path: P06ExecutionPath;
        trace: readonly P06ExecutionObservation[];
        evaluatedAt: string;
      }>,
    ) {
      const i = obj(
        input,
        [
          "workspaceRef",
          "executionRef",
          "leaseTokenHash",
          "fenceHash",
          "epoch",
          "path",
          "trace",
          "evaluatedAt",
        ],
        "invalid_trace",
      );
      if (
        (i.path !== "normal_write" &&
          i.path !== "already_applied" &&
          i.path !== "ambiguous_transport") ||
        !Array.isArray(i.trace) ||
        i.trace.length > STEPS.length ||
        natural(i.epoch) < 1
      )
        bad("invalid_trace");
      const ws = ref(i.workspaceRef),
        ex = ref(i.executionRef),
        lease = hash(i.leaseTokenHash),
        fence = hash(i.fenceHash),
        at = time(i.evaluatedAt);
      const gs = gates(
        port.execution({
          workspaceRef: ws,
          executionRef: ex,
          leaseTokenHash: lease,
          fenceHash: fence,
          evaluatedAt: at,
        }),
        ws,
        ex,
        lease,
        fence,
        at,
        ["post_claim", "pre_dispatch", "read_after_write"],
      );
      const trace = i.trace.map((item) => {
        const o = item as unknown as Obj;
        const keys = Object.hasOwn(o, "receiptHash")
          ? ["step", "outcome", "receiptHash"]
          : ["step", "outcome"];
        const x = obj(o, keys, "invalid_trace");
        if (
          !STEPS.includes(x.step as P06ExecutionStep) ||
          typeof x.outcome !== "string" ||
          !OUTCOMES.has(x.outcome as P06ExecutionObservation["outcome"])
        )
          bad("invalid_trace");
        return freeze({
          step: x.step as P06ExecutionStep,
          outcome: x.outcome as P06ExecutionObservation["outcome"],
          ...(x.receiptHash === undefined
            ? {}
            : { receiptHash: hash(x.receiptHash) }),
        });
      });
      const expected =
        i.path === "normal_write"
          ? [
              "ok",
              "ok",
              "ok",
              "ok",
              "ok",
              "ok",
              "skipped",
              "skipped",
              "terminal",
              "ok",
            ]
          : i.path === "already_applied"
            ? [
                "ok",
                "ok",
                "already_applied",
                "skipped",
                "skipped",
                "skipped",
                "already_applied",
                "skipped",
                "terminal",
                "ok",
              ]
            : [
                "ok",
                "ok",
                "ok",
                "ok",
                "ambiguous_transport",
                "ambiguous_transport",
                "skipped",
                "resolved_after_read",
                "terminal",
                "ok",
              ];
      const reasons = gs
        .filter((g) => g.enabled)
        .map((g) => `kill_switch_${g.stage}`);
      const stopped = trace.findIndex(
        (x) => x.outcome === "kill" || x.outcome === "stale_fence",
      );
      if (stopped < 0) {
        if (
          trace.length !== STEPS.length ||
          trace.some((x, n) => x.step !== STEPS[n] || x.outcome !== expected[n])
        )
          reasons.push("path");
      } else {
        const x = trace[stopped]!;
        reasons.push("interrupted");
        const s: P06KillStage =
          stopped <= 3
            ? "post_claim"
            : stopped === 4
              ? "pre_dispatch"
              : "read_after_write";
        const expectedHash =
          x.outcome === "stale_fence"
            ? fence
            : gs.find((g) => g.stage === s && g.enabled)?.snapshotHash;
        if (
          stopped < 1 ||
          stopped > 7 ||
          x.step !== STEPS[stopped] ||
          (x.outcome !== "kill" && x.outcome !== "stale_fence") ||
          trace
            .slice(0, stopped)
            .some(
              (item, index) =>
                item.step !== STEPS[index] || item.outcome !== expected[index],
            ) ||
          !expectedHash ||
          x.receiptHash !== expectedHash ||
          trace.length !== stopped + 3 ||
          trace[stopped + 1]?.step !== "immutable_terminal" ||
          trace[stopped + 1]?.outcome !== "terminal" ||
          trace[stopped + 2]?.step !== "release" ||
          trace[stopped + 2]?.outcome !== "ok"
        )
          reasons.push("interrupt");
      }
      const core = {
        version: P06_EXECUTION_CONTRACT_VERSION,
        path: i.path,
        workspaceRef: ws,
        evaluatedAt: at,
        leaseRef: ex,
        leaseTokenHash: lease,
        epoch: i.epoch,
        fenceHash: fence,
        killGateHashes: gs.map((gate) => gate.snapshotHash),
        trace: freeze(trace),
        reasons: freeze([...new Set(reasons)].sort(cmp)),
        disposition: reasons.length
          ? ("held" as const)
          : ("ready_for_disabled_executor" as const),
        capabilities: CAPS,
      };
      return freeze({ ...core, contractHash: digest(core) });
    },
    rollback(
      input: Readonly<{
        workspaceRef: string;
        executionRef: string;
        targetRef: string;
        action: GuideAction;
        evaluatedAt: string;
      }>,
    ) {
      const i = obj(input, [
        "workspaceRef",
        "executionRef",
        "targetRef",
        "action",
        "evaluatedAt",
      ]);
      const selected = action(i.action);
      if (
        selected !== "budget_decrease" &&
        selected !== "budget_increase" &&
        selected !== "status_pause" &&
        selected !== "status_activate"
      )
        bad();
      const ws = ref(i.workspaceRef),
        ex = ref(i.executionRef),
        targetRef = ref(i.targetRef);
      const p = obj(
        port.rollback({
          workspaceRef: ws,
          executionRef: ex,
          targetRef,
          action: selected,
          evaluatedAt: time(i.evaluatedAt),
        }),
        [
          "terminalHash",
          "terminalCore",
          "observationRef",
          "observationHash",
          "observationCore",
          "currency",
          "previousMinor",
          "postMinor",
          "previousStatus",
          "postStatus",
          "failure",
          "verification",
        ],
      );
      if (
        (p.failure !== "verified_failure" &&
          p.failure !== "verification_mismatch") ||
        (p.verification !== "verified" && p.verification !== "mismatch") ||
        (p.failure === "verified_failure") !== (p.verification === "verified")
      )
        bad();
      const terminalCore = obj(p.terminalCore, [
        "version",
        "workspaceRef",
        "executionRef",
        "targetRef",
        "action",
        "failure",
        "verification",
      ]);
      const observationCore = obj(p.observationCore, [
        "version",
        "workspaceRef",
        "executionRef",
        "targetRef",
        "action",
        "currency",
        "previousMinor",
        "postMinor",
        "previousStatus",
        "postStatus",
      ]);
      if (
        terminalCore.version !== "p06-terminal/1.0" ||
        terminalCore.workspaceRef !== ws ||
        terminalCore.executionRef !== ex ||
        terminalCore.targetRef !== targetRef ||
        terminalCore.action !== selected ||
        terminalCore.failure !== p.failure ||
        terminalCore.verification !== p.verification ||
        digest(terminalCore) !== hash(p.terminalHash) ||
        observationCore.version !== "p06-observation/1.0" ||
        observationCore.workspaceRef !== ws ||
        observationCore.executionRef !== ex ||
        observationCore.targetRef !== targetRef ||
        observationCore.action !== selected ||
        observationCore.currency !== p.currency ||
        observationCore.previousMinor !== p.previousMinor ||
        observationCore.postMinor !== p.postMinor ||
        observationCore.previousStatus !== p.previousStatus ||
        observationCore.postStatus !== p.postStatus ||
        digest(observationCore) !== hash(p.observationHash)
      )
        bad();
      const previousMinor = nullableNatural(p.previousMinor),
        postMinor = nullableNatural(p.postMinor);
      const status = (v: unknown): "active" | "paused" | null =>
        v === null ? null : v === "active" || v === "paused" ? v : bad();
      const previousStatus = status(p.previousStatus),
        postStatus = status(p.postStatus),
        budget = selected.startsWith("budget_");
      if (
        budget
          ? p.currency !== "TRY" ||
            previousMinor === null ||
            postMinor === null ||
            (selected === "budget_decrease"
              ? postMinor >= previousMinor
              : postMinor <= previousMinor) ||
            previousStatus !== null ||
            postStatus !== null
          : p.currency !== null ||
            previousMinor !== null ||
            postMinor !== null ||
            previousStatus === null ||
            postStatus === null ||
            (selected === "status_pause"
              ? previousStatus !== "active" || postStatus !== "paused"
              : previousStatus !== "paused" || postStatus !== "active")
      )
        bad();
      const core = {
        version: P06_EXECUTION_CONTRACT_VERSION,
        workspaceRef: ws,
        executionRef: ex,
        targetRef,
        action: selected,
        direction: "restore_previous" as const,
        terminalHash: hash(p.terminalHash),
        observationRef: ref(p.observationRef),
        observationHash: hash(p.observationHash),
        previous: budget ? previousMinor : previousStatus,
        proposed: budget ? previousMinor : previousStatus,
        currency: p.currency,
        failure: p.failure,
        verification: p.verification,
        disposition: "requires_new_human_approval" as const,
        capabilities: CAPS,
      };
      return freeze({ ...core, proposalHash: digest(core) });
    },
  });
}
