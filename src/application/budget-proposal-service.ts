import { createHash } from "node:crypto";

import type { EffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import {
  buildOutcomeProxyMappingPlan,
  type OutcomeProxyMappingInput,
  type OutcomeProxyMappingPlan,
} from "@/domain/budget/outcome-proxy-mapping";
import {
  composeBudgetScenarios,
  type BudgetScenarioAlternative,
  type BudgetScenarioDefinition,
  type BudgetScenarioKind,
} from "@/domain/budget/scenario-composer";

export const BUDGET_PROPOSAL_VERSION = "budget-proposal/1.0.0" as const;
export const BUDGET_PROPOSAL_GENESIS = "GENESIS" as const;

export type BudgetProposalScope = Readonly<{
  workspaceId: string;
  adAccountId: string;
  campaignId: string;
  contextHash: string;
}>;

export type FrozenBudgetContext = Readonly<{
  scope: BudgetProposalScope;
  context: EffectiveCampaignContext;
  invalidated: boolean;
}>;

export type BudgetProposalAlternative =
  | Readonly<{
    scenarioRef: string;
    kind: BudgetScenarioKind;
    status: "composed";
    result: BudgetScenarioAlternative;
    mappingSuppressionReasons: readonly string[];
    actionAuthority: "none";
  }>
  | Readonly<{
    scenarioRef: string;
    kind: "target_seeking";
    status: "suppressed";
    reason: "outcome_proxy_mapping_not_ready";
    mappingSuppressionReasons: readonly string[];
    actionAuthority: "none";
  }>;

export type BudgetProposal = Readonly<{
  schemaVersion: typeof BUDGET_PROPOSAL_VERSION;
  seriesRef: string;
  revision: number;
  previousProposalHash: string;
  proposalRef: string;
  proposalHash: string;
  idempotencyKey: string;
  createdAt: string;
  scope: BudgetProposalScope;
  frozenContext: Readonly<{
    contextHash: string;
    capturedAt: string;
    accountRef: string;
    campaignRef: string;
  }>;
  mappingPlan: OutcomeProxyMappingPlan | null;
  alternatives: readonly BudgetProposalAlternative[];
  actionAuthority: "none";
  capabilities: Readonly<{
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
  }>;
}>;

export type BudgetProposalInput = Readonly<{
  scope: BudgetProposalScope;
  seriesRef: string;
  revision: number;
  previousProposalHash: string;
  idempotencyKey: string;
  createdAt: string;
  scenarios: readonly BudgetScenarioDefinition[];
  outcomeProxy: OutcomeProxyMappingInput | null;
}>;

export interface BudgetFrozenContextPort {
  loadExact(scope: BudgetProposalScope): Promise<FrozenBudgetContext>;
}

export interface BudgetProposalPort {
  append(proposal: BudgetProposal): Promise<Readonly<{ outcome: "inserted" | "unchanged" }>>;
}

export class BudgetProposalServiceError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "context_missing"
    | "context_scope_mismatch"
    | "context_invalidated"
    | "context_not_ready") {
    super("Bütçe önerisi güvenli biçimde oluşturulamadı");
    this.name = "BudgetProposalServiceError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

export function hashBudgetProposal(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function assertInput(input: BudgetProposalInput): void {
  if (!input || typeof input !== "object"
    || Object.keys(input).sort().join("|") !== [
      "createdAt", "idempotencyKey", "outcomeProxy", "previousProposalHash", "revision",
      "scenarios", "scope", "seriesRef",
    ].sort().join("|")
    || !input.scope || Object.keys(input.scope).sort().join("|")
      !== ["adAccountId", "campaignId", "contextHash", "workspaceId"].sort().join("|")
    || !UUID.test(input.scope.workspaceId) || !UUID.test(input.scope.adAccountId)
    || !UUID.test(input.scope.campaignId) || !HASH.test(input.scope.contextHash)
    || !REF.test(input.seriesRef) || !REF.test(input.idempotencyKey)
    || !Number.isInteger(input.revision) || input.revision < 1
    || (input.revision === 1 ? input.previousProposalHash !== BUDGET_PROPOSAL_GENESIS : !HASH.test(input.previousProposalHash))
    || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.createdAt) || !Number.isFinite(Date.parse(input.createdAt))
    || !Array.isArray(input.scenarios) || input.scenarios.length < 1 || input.scenarios.length > 3) {
    throw new BudgetProposalServiceError("invalid_input");
  }
}

function assertFrozenContext(scope: BudgetProposalScope, frozen: FrozenBudgetContext): EffectiveCampaignContext {
  const context = frozen.context;
  if (frozen.invalidated) throw new BudgetProposalServiceError("context_invalidated");
  if (frozen.scope.workspaceId !== scope.workspaceId || frozen.scope.adAccountId !== scope.adAccountId
    || frozen.scope.campaignId !== scope.campaignId || frozen.scope.contextHash !== scope.contextHash
    || context.workspaceId !== scope.workspaceId || context.contextHash !== scope.contextHash
    || context.identity.entityType !== "campaign" || context.identity.entityRef !== context.identity.campaignRef) {
    throw new BudgetProposalServiceError("context_scope_mismatch");
  }
  if (context.data.trustStatus !== "ready") throw new BudgetProposalServiceError("context_not_ready");
  return context;
}

function buildCore(input: BudgetProposalInput, context: EffectiveCampaignContext): Omit<BudgetProposal, "proposalRef" | "proposalHash"> {
  const targetSeeking = input.scenarios.find((scenario) => scenario.kind === "target_seeking");
  const mappingPlan = targetSeeking && input.outcomeProxy
    ? buildOutcomeProxyMappingPlan(input.outcomeProxy)
    : null;
  const mappingReady = !targetSeeking || mappingPlan?.status === "ready"
    && mappingPlan.selected !== null
    && targetSeeking.pacing.signal.kind === "proxy"
    && targetSeeking.pacing.signal.metricRef === mappingPlan.selected.proxy.metricRef
    && targetSeeking.pacing.policy.allowProxyAction === true;
  const eligible = input.scenarios.filter((scenario) => scenario.kind !== "target_seeking" || mappingReady);
  const composed = eligible.length === 0 ? null : composeBudgetScenarios({
    frozenInput: { ref: `context.${context.contextHash}`, hash: context.contextHash },
    scenarios: eligible,
  });
  const byScenario = new Map(composed?.alternatives.map((alternative) => [alternative.scenarioRef, alternative]) ?? []);
  const mappingReasons = mappingPlan?.status === "suppressed"
    ? mappingPlan.suppressionReasons
    : targetSeeking && !input.outcomeProxy ? ["missing_mapping"] as const
      : targetSeeking && !mappingReady ? ["proxy_signal_mismatch"] as const : [];
  const alternatives = input.scenarios.map((scenario): BudgetProposalAlternative => {
    const result = byScenario.get(scenario.scenarioRef);
    if (result) return Object.freeze({
      scenarioRef: scenario.scenarioRef, kind: scenario.kind, status: "composed" as const,
      result, mappingSuppressionReasons: Object.freeze([]), actionAuthority: "none" as const,
    });
    if (scenario.kind !== "target_seeking") throw new BudgetProposalServiceError("invalid_input");
    return Object.freeze({
      scenarioRef: scenario.scenarioRef, kind: "target_seeking" as const, status: "suppressed" as const,
      reason: "outcome_proxy_mapping_not_ready" as const,
      mappingSuppressionReasons: Object.freeze([...mappingReasons]), actionAuthority: "none" as const,
    });
  });
  return Object.freeze({
    schemaVersion: BUDGET_PROPOSAL_VERSION,
    seriesRef: input.seriesRef,
    revision: input.revision,
    previousProposalHash: input.previousProposalHash,
    idempotencyKey: input.idempotencyKey,
    createdAt: new Date(input.createdAt).toISOString(),
    scope: Object.freeze({ ...input.scope }),
    frozenContext: Object.freeze({
      contextHash: context.contextHash,
      capturedAt: context.capturedAt,
      accountRef: context.identity.accountRef,
      campaignRef: context.identity.campaignRef,
    }),
    mappingPlan,
    alternatives: Object.freeze(alternatives),
    actionAuthority: "none",
    capabilities: Object.freeze({ canApprove: false, canExecute: false, canWriteMeta: false }),
  });
}

export function verifyBudgetProposal(proposal: BudgetProposal): boolean {
  try {
    const { proposalHash, proposalRef, ...core } = proposal;
    return proposal.schemaVersion === BUDGET_PROPOSAL_VERSION
      && proposal.actionAuthority === "none"
      && proposal.capabilities.canApprove === false
      && proposal.capabilities.canExecute === false
      && proposal.capabilities.canWriteMeta === false
      && proposal.alternatives.length >= 1 && proposal.alternatives.length <= 3
      && proposal.alternatives.every((alternative) => alternative.actionAuthority === "none")
      && proposalHash === hashBudgetProposal(core)
      && proposalRef === `budget_proposal_${proposalHash.slice(0, 20)}`;
  } catch {
    return false;
  }
}

export class BudgetProposalService {
  constructor(
    private readonly contexts: BudgetFrozenContextPort,
    private readonly proposals: BudgetProposalPort,
  ) {}

  async create(input: BudgetProposalInput): Promise<Readonly<{
    proposal: BudgetProposal;
    persistence: "inserted" | "unchanged";
  }>> {
    assertInput(input);
    let frozen: FrozenBudgetContext;
    try {
      frozen = await this.contexts.loadExact(input.scope);
    } catch {
      throw new BudgetProposalServiceError("context_missing");
    }
    const context = assertFrozenContext(input.scope, frozen);
    const core = buildCore(input, context);
    const proposalHash = hashBudgetProposal(core);
    const proposal = Object.freeze({
      ...core,
      proposalRef: `budget_proposal_${proposalHash.slice(0, 20)}`,
      proposalHash,
    });
    if (!verifyBudgetProposal(proposal)) throw new BudgetProposalServiceError("invalid_input");
    const persisted = await this.proposals.append(proposal);
    return Object.freeze({ proposal, persistence: persisted.outcome });
  }
}
