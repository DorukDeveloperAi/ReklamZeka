import { createHash } from "node:crypto";

export const BUDGET_CONSTRAINT_ENGINE_VERSION = "budget-constraint-engine/1.0.0" as const;

export type BudgetAllocation = Readonly<{
  ref: string;
  currentAmountMinor: number;
  categoryRef: string;
  geoRef: string;
  groupRefs: readonly string[];
}>;

export type BudgetSelector = Readonly<{
  allocationRefs?: readonly string[];
  categoryRefs?: readonly string[];
  geoRefs?: readonly string[];
}>;

export type BudgetConstraint =
  | Readonly<{ kind: "floor"; selector: BudgetSelector; amountMinor: number }>
  | Readonly<{ kind: "cap"; selector: BudgetSelector; amountMinor: number }>
  | Readonly<{ kind: "fixed"; selector: BudgetSelector; amountMinor?: number }>
  | Readonly<{ kind: "reserve"; amountMinor: number }>
  | Readonly<{ kind: "transfer_allow"; from: BudgetSelector; to: BudgetSelector }>
  | Readonly<{ kind: "transfer_deny"; from: BudgetSelector; to: BudgetSelector }>
  | Readonly<{ kind: "transfer_only_within_group"; dimension: "category" | "geo" | "group" }>
  | Readonly<{
    kind: "protected";
    dimension: "category" | "geo";
    refs: readonly string[];
    behavior: "no_outflow" | "fixed";
  }>;

export type BudgetAllocationStrategy =
  | Readonly<{ mode: "fixed"; targets: readonly Readonly<{ ref: string; amountMinor: number }>[] }>
  | Readonly<{ mode: "proportional"; weights: readonly Readonly<{ ref: string; weight: number }>[] }>
  | Readonly<{ mode: "priority"; orderedRefs: readonly string[] }>
  | Readonly<{ mode: "ladder"; rungs: readonly Readonly<{ ref: string; upToMinor: number }>[] }>;

export type BudgetConstraintTrace = Readonly<{
  sequence: number;
  stage: "constraint" | "allocation" | "transfer" | "result";
  code: string;
  allocationRef?: string;
  detail: string;
}>;

export type BudgetTransfer = Readonly<{
  fromRef: string;
  toRef: string;
  amountMinor: number;
}>;

export type BudgetConstraintPlan = Readonly<{
  version: typeof BUDGET_CONSTRAINT_ENGINE_VERSION;
  status: "planned" | "no_change" | "unsatisfied";
  reason:
    | "allocation_plan_ready"
    | "already_at_target"
    | "reserve_exceeds_budget"
    | "target_below_floors"
    | "target_above_caps"
    | "fixed_total_mismatch"
    | "ladder_capacity_exhausted"
    | "transfer_restricted";
  totalBudgetMinor: number;
  reserveAmountMinor: number;
  deployableBudgetMinor: number;
  allocations: readonly Readonly<{
    ref: string;
    currentAmountMinor: number;
    proposedAmountMinor: number;
    deltaMinor: number;
  }>[];
  transfers: readonly BudgetTransfer[];
  trace: readonly BudgetConstraintTrace[];
  /** A plan is advisory until a separate autonomy and execution boundary authorizes it. */
  actionAuthority: "none";
  planRef: string;
}>;

export class BudgetConstraintEngineError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_constraint" | "invalid_strategy") {
    super("Bütçe kısıt planı güvenli biçimde üretilemedi");
    this.name = "BudgetConstraintEngineError";
  }
}

type Bounds = { lower: number; upper: number };

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertMinor(value: number, code: BudgetConstraintEngineError["code"]): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new BudgetConstraintEngineError(code);
}

function assertRef(value: string, code: BudgetConstraintEngineError["code"]): void {
  if (typeof value !== "string" || !value.trim()) throw new BudgetConstraintEngineError(code);
}

function matches(node: BudgetAllocation, selector: BudgetSelector): boolean {
  const hasDimension = selector.allocationRefs !== undefined
    || selector.categoryRefs !== undefined
    || selector.geoRefs !== undefined;
  if (!hasDimension) throw new BudgetConstraintEngineError("invalid_constraint");
  return (selector.allocationRefs === undefined || selector.allocationRefs.includes(node.ref))
    && (selector.categoryRefs === undefined || selector.categoryRefs.includes(node.categoryRef))
    && (selector.geoRefs === undefined || selector.geoRefs.includes(node.geoRef));
}

function selected(nodes: readonly BudgetAllocation[], selector: BudgetSelector): readonly BudgetAllocation[] {
  for (const refs of [selector.allocationRefs, selector.categoryRefs, selector.geoRefs]) {
    if (refs !== undefined) {
      if (!Array.isArray(refs) || refs.length === 0) throw new BudgetConstraintEngineError("invalid_constraint");
      refs.forEach((ref) => assertRef(ref, "invalid_constraint"));
    }
  }
  const result = nodes.filter((node) => matches(node, selector));
  if (result.length === 0) throw new BudgetConstraintEngineError("invalid_constraint");
  return result;
}

function stablePlan(input: Omit<BudgetConstraintPlan, "version" | "actionAuthority" | "planRef">): BudgetConstraintPlan {
  const envelope = {
    version: BUDGET_CONSTRAINT_ENGINE_VERSION,
    ...input,
    actionAuthority: "none" as const,
  };
  return Object.freeze({
    ...envelope,
    planRef: `budget_${createHash("sha256").update(JSON.stringify(envelope)).digest("hex").slice(0, 20)}`,
  });
}

function distributeProportionally(
  refs: readonly string[],
  amount: number,
  weights: ReadonlyMap<string, number>,
  bounds: ReadonlyMap<string, Bounds>,
  proposed: Map<string, number>,
): number {
  let remaining = amount;
  let eligible = refs.filter((ref) => proposed.get(ref)! < bounds.get(ref)!.upper && (weights.get(ref) ?? 0) > 0);
  while (remaining > 0 && eligible.length > 0) {
    const totalWeight = eligible.reduce((sum, ref) => sum + weights.get(ref)!, 0);
    if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) {
      throw new BudgetConstraintEngineError("invalid_strategy");
    }
    const shares = eligible.map((ref) => {
      const numerator = BigInt(remaining) * BigInt(weights.get(ref)!);
      const denominator = BigInt(totalWeight);
      const capacity = bounds.get(ref)!.upper - proposed.get(ref)!;
      const base = Math.min(capacity, Number(numerator / denominator));
      return { ref, base, remainder: numerator % denominator, capacity };
    });
    const before = remaining;
    for (const share of shares) {
      proposed.set(share.ref, proposed.get(share.ref)! + share.base);
      remaining -= share.base;
    }
    const ranked = shares
      .filter((share) => share.capacity > share.base)
      .sort((a, b) => a.remainder === b.remainder
        ? compare(a.ref, b.ref)
        : a.remainder > b.remainder ? -1 : 1);
    for (const share of ranked) {
      if (remaining === 0) break;
      proposed.set(share.ref, proposed.get(share.ref)! + 1);
      remaining -= 1;
    }
    eligible = eligible.filter((ref) => proposed.get(ref)! < bounds.get(ref)!.upper);
    if (before === remaining) break;
  }
  return remaining;
}

/**
 * Produces a deterministic, side-effect-free budget proposal. It deliberately
 * does not call Meta, persist state, or grant execution authority.
 */
export function planBudgetAllocation(input: Readonly<{
  totalBudgetMinor: number;
  allocations: readonly BudgetAllocation[];
  constraints: readonly BudgetConstraint[];
  strategy: BudgetAllocationStrategy;
}>): BudgetConstraintPlan {
  if (!input || typeof input !== "object" || !input.strategy || typeof input.strategy !== "object") {
    throw new BudgetConstraintEngineError("invalid_input");
  }
  assertMinor(input.totalBudgetMinor, "invalid_input");
  if (!Array.isArray(input.allocations) || input.allocations.length === 0 || !Array.isArray(input.constraints)) {
    throw new BudgetConstraintEngineError("invalid_input");
  }
  const nodes = [...input.allocations].sort((a, b) => compare(a.ref, b.ref));
  const refs = new Set<string>();
  for (const node of nodes) {
    assertRef(node.ref, "invalid_input");
    assertRef(node.categoryRef, "invalid_input");
    assertRef(node.geoRef, "invalid_input");
    assertMinor(node.currentAmountMinor, "invalid_input");
    if (refs.has(node.ref) || !Array.isArray(node.groupRefs)) throw new BudgetConstraintEngineError("invalid_input");
    refs.add(node.ref);
    node.groupRefs.forEach((ref: string) => assertRef(ref, "invalid_input"));
  }
  const currentTotal = nodes.reduce((sum, node) => sum + node.currentAmountMinor, 0);
  if (!Number.isSafeInteger(currentTotal)) throw new BudgetConstraintEngineError("invalid_input");

  const trace: BudgetConstraintTrace[] = [];
  const addTrace = (stage: BudgetConstraintTrace["stage"], code: string, detail: string, allocationRef?: string) => {
    trace.push({ sequence: trace.length + 1, stage, code, detail, ...(allocationRef ? { allocationRef } : {}) });
  };
  const bounds = new Map(nodes.map((node) => [node.ref, { lower: 0, upper: input.totalBudgetMinor }]));
  let reserveAmountMinor = 0;
  const transferConstraints: BudgetConstraint[] = [];
  for (const constraint of input.constraints) {
    if (!constraint || typeof constraint !== "object" || ![
      "floor", "cap", "fixed", "reserve", "transfer_allow", "transfer_deny",
      "transfer_only_within_group", "protected",
    ].includes(constraint.kind)) throw new BudgetConstraintEngineError("invalid_constraint");
    if (constraint.kind === "reserve") {
      assertMinor(constraint.amountMinor, "invalid_constraint");
      reserveAmountMinor += constraint.amountMinor;
      if (!Number.isSafeInteger(reserveAmountMinor)) throw new BudgetConstraintEngineError("invalid_constraint");
      addTrace("constraint", "reserve_applied", `reserve=${constraint.amountMinor}`);
      continue;
    }
    if (constraint.kind.startsWith("transfer_")) {
      transferConstraints.push(constraint);
      if (constraint.kind === "transfer_only_within_group") {
        if (!["category", "geo", "group"].includes(constraint.dimension)) throw new BudgetConstraintEngineError("invalid_constraint");
      } else {
        selected(nodes, constraint.from);
        selected(nodes, constraint.to);
      }
      addTrace("constraint", constraint.kind, "transfer boundary registered");
      continue;
    }
    if (constraint.kind === "protected") {
      if (!Array.isArray(constraint.refs) || constraint.refs.length === 0
        || !["category", "geo"].includes(constraint.dimension)
        || !["no_outflow", "fixed"].includes(constraint.behavior)) {
        throw new BudgetConstraintEngineError("invalid_constraint");
      }
      constraint.refs.forEach((ref: string) => assertRef(ref, "invalid_constraint"));
      const protectedNodes = nodes.filter((node) => constraint.refs.includes(
        constraint.dimension === "category" ? node.categoryRef : node.geoRef,
      ));
      if (protectedNodes.length === 0) throw new BudgetConstraintEngineError("invalid_constraint");
      for (const node of protectedNodes) {
        const bound = bounds.get(node.ref)!;
        bound.lower = Math.max(bound.lower, node.currentAmountMinor);
        if (constraint.behavior === "fixed") bound.upper = Math.min(bound.upper, node.currentAmountMinor);
        addTrace("constraint", `protected_${constraint.behavior}`, constraint.dimension, node.ref);
      }
      continue;
    }
    assertMinor(constraint.amountMinor ?? 0, "invalid_constraint");
    for (const node of selected(nodes, constraint.selector)) {
      const bound = bounds.get(node.ref)!;
      if (constraint.kind === "floor") bound.lower = Math.max(bound.lower, constraint.amountMinor);
      if (constraint.kind === "cap") bound.upper = Math.min(bound.upper, constraint.amountMinor);
      if (constraint.kind === "fixed") {
        const amount = constraint.amountMinor ?? node.currentAmountMinor;
        bound.lower = Math.max(bound.lower, amount);
        bound.upper = Math.min(bound.upper, amount);
      }
      addTrace("constraint", `${constraint.kind}_applied`, `amount=${constraint.amountMinor ?? node.currentAmountMinor}`, node.ref);
    }
  }

  const deployable = input.totalBudgetMinor - reserveAmountMinor;
  const emptyAllocations = nodes.map((node) => ({
    ref: node.ref, currentAmountMinor: node.currentAmountMinor, proposedAmountMinor: node.currentAmountMinor, deltaMinor: 0,
  }));
  const finishUnsatisfied = (reason: BudgetConstraintPlan["reason"]): BudgetConstraintPlan => {
    addTrace("result", reason, "no executable proposal produced");
    return stablePlan({ status: "unsatisfied", reason, totalBudgetMinor: input.totalBudgetMinor,
      reserveAmountMinor, deployableBudgetMinor: Math.max(0, deployable), allocations: emptyAllocations,
      transfers: [], trace });
  };
  if (deployable < 0) return finishUnsatisfied("reserve_exceeds_budget");
  const lowerTotal = [...bounds.values()].reduce((sum, bound) => sum + bound.lower, 0);
  const upperTotal = [...bounds.values()].reduce((sum, bound) => sum + bound.upper, 0);
  if (!Number.isSafeInteger(lowerTotal) || !Number.isSafeInteger(upperTotal)) {
    throw new BudgetConstraintEngineError("invalid_constraint");
  }
  if (deployable < lowerTotal) return finishUnsatisfied("target_below_floors");
  for (const bound of bounds.values()) {
    if (bound.lower > bound.upper) return finishUnsatisfied("target_above_caps");
  }
  if (deployable > upperTotal) return finishUnsatisfied("target_above_caps");

  const proposed = new Map(nodes.map((node) => [node.ref, bounds.get(node.ref)!.lower]));
  if (input.strategy.mode === "fixed") {
    if (!Array.isArray(input.strategy.targets) || input.strategy.targets.length !== nodes.length) {
      throw new BudgetConstraintEngineError("invalid_strategy");
    }
    let total = 0;
    const seen = new Set<string>();
    for (const target of input.strategy.targets) {
      assertRef(target.ref, "invalid_strategy"); assertMinor(target.amountMinor, "invalid_strategy");
      if (!refs.has(target.ref) || seen.has(target.ref)) throw new BudgetConstraintEngineError("invalid_strategy");
      seen.add(target.ref); total += target.amountMinor;
      const bound = bounds.get(target.ref)!;
      if (target.amountMinor < bound.lower || target.amountMinor > bound.upper) return finishUnsatisfied(
        target.amountMinor < bound.lower ? "target_below_floors" : "target_above_caps",
      );
      proposed.set(target.ref, target.amountMinor);
    }
    if (total !== deployable) return finishUnsatisfied("fixed_total_mismatch");
  } else if (input.strategy.mode === "proportional") {
    if (!Array.isArray(input.strategy.weights)) throw new BudgetConstraintEngineError("invalid_strategy");
    const weights = new Map<string, number>();
    for (const item of input.strategy.weights) {
      assertRef(item.ref, "invalid_strategy");
      if (!refs.has(item.ref) || weights.has(item.ref)
        || !Number.isSafeInteger(item.weight) || item.weight <= 0) {
        throw new BudgetConstraintEngineError("invalid_strategy");
      }
      weights.set(item.ref, item.weight);
    }
    if (weights.size !== nodes.length) throw new BudgetConstraintEngineError("invalid_strategy");
    const remaining = distributeProportionally(nodes.map((node) => node.ref), deployable - lowerTotal, weights, bounds, proposed);
    if (remaining > 0) return finishUnsatisfied("target_above_caps");
  } else if (input.strategy.mode === "priority") {
    if (!Array.isArray(input.strategy.orderedRefs) || new Set(input.strategy.orderedRefs).size !== nodes.length
      || input.strategy.orderedRefs.some((ref) => !refs.has(ref))) throw new BudgetConstraintEngineError("invalid_strategy");
    let remaining = deployable - lowerTotal;
    for (const ref of input.strategy.orderedRefs) {
      const amount = Math.min(remaining, bounds.get(ref)!.upper - proposed.get(ref)!);
      proposed.set(ref, proposed.get(ref)! + amount); remaining -= amount;
    }
    if (remaining > 0) return finishUnsatisfied("target_above_caps");
  } else if (input.strategy.mode === "ladder") {
    if (!Array.isArray(input.strategy.rungs) || input.strategy.rungs.length === 0) throw new BudgetConstraintEngineError("invalid_strategy");
    let remaining = deployable - lowerTotal;
    for (const rung of input.strategy.rungs) {
      assertRef(rung.ref, "invalid_strategy"); assertMinor(rung.upToMinor, "invalid_strategy");
      if (!refs.has(rung.ref)) throw new BudgetConstraintEngineError("invalid_strategy");
      const ceiling = Math.min(rung.upToMinor, bounds.get(rung.ref)!.upper);
      const amount = Math.min(remaining, Math.max(0, ceiling - proposed.get(rung.ref)!));
      proposed.set(rung.ref, proposed.get(rung.ref)! + amount); remaining -= amount;
      addTrace("allocation", "ladder_rung", `upTo=${rung.upToMinor}`, rung.ref);
    }
    if (remaining > 0) return finishUnsatisfied("ladder_capacity_exhausted");
  } else {
    throw new BudgetConstraintEngineError("invalid_strategy");
  }

  for (const node of nodes) addTrace("allocation", "target_computed", `amount=${proposed.get(node.ref)!}`, node.ref);
  const deficits = nodes.map((node) => ({ ref: node.ref, amount: Math.max(0, proposed.get(node.ref)! - node.currentAmountMinor) }));
  const surpluses = nodes.map((node) => ({ ref: node.ref, amount: Math.max(0, node.currentAmountMinor - proposed.get(node.ref)!) }));
  const totalDelta = deployable - currentTotal;
  let externalFunding = Math.max(0, totalDelta);
  for (const deficit of deficits) {
    const funded = Math.min(deficit.amount, externalFunding); deficit.amount -= funded; externalFunding -= funded;
  }
  let externalWithdrawal = Math.max(0, -totalDelta);
  for (const surplus of surpluses) {
    const withdrawn = Math.min(surplus.amount, externalWithdrawal); surplus.amount -= withdrawn; externalWithdrawal -= withdrawn;
  }

  const nodeByRef = new Map(nodes.map((node) => [node.ref, node]));
  const canTransfer = (fromRef: string, toRef: string): boolean => {
    const from = nodeByRef.get(fromRef)!; const to = nodeByRef.get(toRef)!;
    const allowRules = transferConstraints.filter((rule) => rule.kind === "transfer_allow");
    if (allowRules.length > 0 && !allowRules.some((rule) => rule.kind === "transfer_allow"
      && matches(from, rule.from) && matches(to, rule.to))) return false;
    if (transferConstraints.some((rule) => rule.kind === "transfer_deny"
      && matches(from, rule.from) && matches(to, rule.to))) return false;
    return transferConstraints.filter((rule) => rule.kind === "transfer_only_within_group").every((rule) => {
      if (rule.kind !== "transfer_only_within_group") return true;
      if (rule.dimension === "category") return from.categoryRef === to.categoryRef;
      if (rule.dimension === "geo") return from.geoRef === to.geoRef;
      return from.groupRefs.some((group: string) => to.groupRefs.includes(group));
    });
  };
  const transfers: BudgetTransfer[] = [];
  for (const surplus of surpluses) {
    for (const deficit of deficits) {
      if (surplus.amount === 0 || deficit.amount === 0 || !canTransfer(surplus.ref, deficit.ref)) continue;
      const amount = Math.min(surplus.amount, deficit.amount);
      transfers.push({ fromRef: surplus.ref, toRef: deficit.ref, amountMinor: amount });
      surplus.amount -= amount; deficit.amount -= amount;
      addTrace("transfer", "transfer_planned", `to=${deficit.ref};amount=${amount}`, surplus.ref);
    }
  }
  if (surpluses.some((item) => item.amount > 0) || deficits.some((item) => item.amount > 0)) {
    return finishUnsatisfied("transfer_restricted");
  }
  const allocations = nodes.map((node) => ({ ref: node.ref, currentAmountMinor: node.currentAmountMinor,
    proposedAmountMinor: proposed.get(node.ref)!, deltaMinor: proposed.get(node.ref)! - node.currentAmountMinor }));
  const changed = allocations.some((allocation) => allocation.deltaMinor !== 0);
  const reason = changed ? "allocation_plan_ready" as const : "already_at_target" as const;
  addTrace("result", reason, changed ? "proposal is ready for separate approval" : "current allocation already matches target");
  return stablePlan({ status: changed ? "planned" : "no_change", reason, totalBudgetMinor: input.totalBudgetMinor,
    reserveAmountMinor, deployableBudgetMinor: deployable, allocations, transfers, trace });
}
