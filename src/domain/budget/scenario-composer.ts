import { createHash } from "node:crypto";

import {
  planBudgetAllocation,
  type BudgetAllocation,
  type BudgetAllocationStrategy,
  type BudgetConstraint,
  type BudgetConstraintPlan,
} from "./constraint-engine";
import {
  evaluateBudgetPacing,
  type BudgetPacingInput,
  type BudgetPacingResult,
} from "./pacing-forecast";

export const BUDGET_SCENARIO_COMPOSER_VERSION = "budget-scenario-composer/1.0.0" as const;

export type BudgetScenarioKind = "keep" | "conservative" | "target_seeking";

export type BudgetScenarioDefinition = Readonly<{
  scenarioRef: string;
  kind: BudgetScenarioKind;
  minorUnitScale: number;
  requestedBudgetMinor: number;
  allocations: readonly BudgetAllocation[];
  constraints: readonly BudgetConstraint[];
  strategy: BudgetAllocationStrategy;
  pacing: BudgetPacingInput;
}>;

export type BudgetScenarioComposerInput = Readonly<{
  frozenInput: Readonly<{
    ref: string;
    hash: string;
  }>;
  scenarios: readonly BudgetScenarioDefinition[];
}>;

export type BudgetScenarioAlternative = Readonly<{
  scenarioRef: string;
  kind: BudgetScenarioKind;
  frozenInput: Readonly<{ ref: string; hash: string }>;
  status: "planned" | "no_change" | "suppressed" | "unsatisfied";
  reason:
    | "proposal_ready"
    | "already_at_target"
    | "pacing_suppressed"
    | BudgetConstraintPlan["reason"];
  before: Readonly<{
    commitmentDecimal: string;
    totalAllocationMinor: number;
    allocations: readonly Readonly<{ ref: string; amountMinor: number }>[];
  }>;
  after: Readonly<{
    requestedCommitmentDecimal: string;
    guardedCommitmentDecimal: string;
    guardedBudgetMinor: number;
    totalAllocationMinor: number;
    allocations: readonly Readonly<{ ref: string; amountMinor: number; deltaMinor: number }>[];
  }>;
  constraint: BudgetConstraintPlan;
  pacing: BudgetPacingResult;
  actionAuthority: "none";
}>;

export type BudgetScenarioProposal = Readonly<{
  schemaVersion: typeof BUDGET_SCENARIO_COMPOSER_VERSION;
  proposalRef: string;
  frozenInput: Readonly<{ ref: string; hash: string }>;
  alternatives: readonly BudgetScenarioAlternative[];
  actionAuthority: "none";
}>;

export class BudgetScenarioComposerError extends Error {
  constructor(readonly code: "invalid_contract" | "invalid_frozen_input" | "invalid_scenario" | "amount_mismatch") {
    super("Bütçe senaryoları güvenli biçimde oluşturulamadı");
    this.name = "BudgetScenarioComposerError";
  }
}

const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^(0|[1-9]\d{0,29})(?:\.(\d{1,18}))?$/;
const KINDS = new Set<BudgetScenarioKind>(["keep", "conservative", "target_seeking"]);

function fail(code: BudgetScenarioComposerError["code"]): never {
  throw new BudgetScenarioComposerError(code);
}

function exactKeys(value: unknown, keys: readonly string[], code: BudgetScenarioComposerError["code"]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(code);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(code);
}

function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) fail("invalid_scenario");
  return value;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

function minorFromDecimal(value: string, scale: number): number {
  const match = DECIMAL.exec(value);
  if (!match) fail("amount_mismatch");
  const fraction = match[2] ?? "";
  if (fraction.length > scale) fail("amount_mismatch");
  const units = BigInt(match[1]!) * (10n ** BigInt(scale))
    + BigInt(fraction.padEnd(scale, "0") || "0");
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) fail("amount_mismatch");
  return Number(units);
}

function sumMinor(values: readonly number[]): number {
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(sum)) fail("invalid_scenario");
  return sum;
}

function alternative(
  definition: BudgetScenarioDefinition,
  frozenInput: Readonly<{ ref: string; hash: string }>,
): BudgetScenarioAlternative {
  exactKeys(definition, [
    "scenarioRef", "kind", "minorUnitScale", "requestedBudgetMinor", "allocations",
    "constraints", "strategy", "pacing",
  ], "invalid_scenario");
  ref(definition.scenarioRef);
  if (!KINDS.has(definition.kind)
    || !Number.isSafeInteger(definition.minorUnitScale)
    || definition.minorUnitScale < 0
    || definition.minorUnitScale > 12
    || !Number.isSafeInteger(definition.requestedBudgetMinor)
    || definition.requestedBudgetMinor < 0
    || !Array.isArray(definition.allocations)
    || !Array.isArray(definition.constraints)) {
    fail("invalid_scenario");
  }
  if (definition.pacing.policy.moneyScale !== definition.minorUnitScale) fail("amount_mismatch");

  const pacing = evaluateBudgetPacing(definition.pacing);
  if (minorFromDecimal(pacing.adjustment.requestedCommitmentDecimal, definition.minorUnitScale)
    !== definition.requestedBudgetMinor) fail("amount_mismatch");
  const guardedBudgetMinor = minorFromDecimal(
    pacing.adjustment.guardedCommitmentDecimal,
    definition.minorUnitScale,
  );
  const constraint = planBudgetAllocation({
    totalBudgetMinor: guardedBudgetMinor,
    allocations: definition.allocations,
    constraints: definition.constraints,
    strategy: definition.strategy,
  });

  const beforeAllocations = constraint.allocations.map((item) => Object.freeze({
    ref: item.ref,
    amountMinor: item.currentAmountMinor,
  }));
  const proposalMayChange = pacing.adjustment.status !== "suppressed" && constraint.status !== "unsatisfied";
  const afterAllocations = constraint.allocations.map((item) => Object.freeze({
    ref: item.ref,
    amountMinor: proposalMayChange ? item.proposedAmountMinor : item.currentAmountMinor,
    deltaMinor: proposalMayChange ? item.deltaMinor : 0,
  }));
  const status: BudgetScenarioAlternative["status"] = pacing.adjustment.status === "suppressed"
    ? "suppressed"
    : constraint.status === "unsatisfied"
      ? "unsatisfied"
      : constraint.status === "no_change" && pacing.adjustment.status === "no_change"
        ? "no_change"
        : "planned";
  const reason: BudgetScenarioAlternative["reason"] = pacing.adjustment.status === "suppressed"
    ? "pacing_suppressed"
    : constraint.status === "unsatisfied"
      ? constraint.reason
      : status === "no_change"
        ? "already_at_target"
        : "proposal_ready";

  return Object.freeze({
    scenarioRef: definition.scenarioRef,
    kind: definition.kind,
    frozenInput,
    status,
    reason,
    before: Object.freeze({
      commitmentDecimal: pacing.amounts.committedDecimal,
      totalAllocationMinor: sumMinor(beforeAllocations.map((item) => item.amountMinor)),
      allocations: Object.freeze(beforeAllocations),
    }),
    after: Object.freeze({
      requestedCommitmentDecimal: pacing.adjustment.requestedCommitmentDecimal,
      guardedCommitmentDecimal: pacing.adjustment.guardedCommitmentDecimal,
      guardedBudgetMinor,
      totalAllocationMinor: sumMinor(afterAllocations.map((item) => item.amountMinor)),
      allocations: Object.freeze(afterAllocations),
    }),
    constraint,
    pacing,
    actionAuthority: "none",
  });
}

/**
 * Composes at most three explicit, advisory budget alternatives over one frozen
 * input. Scenario labels carry no policy defaults: every amount, constraint,
 * allocation strategy and pacing guard must be supplied by the caller.
 */
export function composeBudgetScenarios(input: BudgetScenarioComposerInput): BudgetScenarioProposal {
  exactKeys(input, ["frozenInput", "scenarios"], "invalid_contract");
  exactKeys(input.frozenInput, ["ref", "hash"], "invalid_frozen_input");
  if (typeof input.frozenInput.ref !== "string" || !REF.test(input.frozenInput.ref)
    || typeof input.frozenInput.hash !== "string" || !HASH.test(input.frozenInput.hash)) {
    fail("invalid_frozen_input");
  }
  if (!Array.isArray(input.scenarios) || input.scenarios.length === 0 || input.scenarios.length > 3) {
    fail("invalid_scenario");
  }
  const kinds = new Set<BudgetScenarioKind>();
  const scenarioRefs = new Set<string>();
  for (const scenario of input.scenarios) {
    if (kinds.has(scenario.kind) || scenarioRefs.has(scenario.scenarioRef)) fail("invalid_scenario");
    kinds.add(scenario.kind);
    scenarioRefs.add(scenario.scenarioRef);
  }
  const frozenInput = Object.freeze({ ref: input.frozenInput.ref, hash: input.frozenInput.hash });
  const alternatives = Object.freeze(input.scenarios.map((scenario) => alternative(scenario, frozenInput)));
  const envelope = {
    schemaVersion: BUDGET_SCENARIO_COMPOSER_VERSION,
    frozenInput,
    alternatives,
    actionAuthority: "none" as const,
  };
  const digest = createHash("sha256").update(JSON.stringify(stableValue(envelope))).digest("hex").slice(0, 20);
  return Object.freeze({ ...envelope, proposalRef: `budget_scenarios_${digest}` });
}
