import { dryRunGuideBudget, type GuideBudgetDryRun, type GuideBudgetDryRunConstraint, type BudgetScopeEvidence } from "@/domain/guides/guide-budget-dry-run";
import { verifyGuideBudgetContractV2, type GuideBudgetContractV2 } from "@/domain/guides/guide-budget-contract-v2";

export type GuideBudgetEvidenceBundle = Readonly<{
  contract: GuideBudgetContractV2;
  targetCurrentBudgetDecimal: string | null;
  scopeEvidence: readonly BudgetScopeEvidence[];
  constraints: readonly GuideBudgetDryRunConstraint[];
}>;

/** Server-only read boundary.  It intentionally exposes no save/execute method. */
export interface GuideBudgetEvidenceReadPort {
  load(input: Readonly<{ workspaceId: string; guideRevisionId: string; at: string }>): Promise<GuideBudgetEvidenceBundle>;
}

export class GuideBudgetDryRunServiceError extends Error {
  constructor(readonly code: "invalid_input" | "evidence_unavailable") { super(code); this.name = "GuideBudgetDryRunServiceError"; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const iso = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export class GuideBudgetDryRunService {
  constructor(private readonly evidence: GuideBudgetEvidenceReadPort) {}

  async execute(input: Readonly<{ workspaceId: string; guideRevisionId: string; at: string }>): Promise<GuideBudgetDryRun> {
    if (!input || !UUID.test(input.workspaceId) || !UUID.test(input.guideRevisionId) || !iso(input.at)) throw new GuideBudgetDryRunServiceError("invalid_input");
    let bundle: GuideBudgetEvidenceBundle;
    try { bundle = await this.evidence.load(input); } catch { throw new GuideBudgetDryRunServiceError("evidence_unavailable"); }
    const contract = bundle.contract;
    if (!verifyGuideBudgetContractV2(contract)) throw new GuideBudgetDryRunServiceError("evidence_unavailable");
    const current = Date.parse(input.at);
    const aged = bundle.scopeEvidence.map((item) => item.freshness === "fresh" && item.observedAt !== null && current - Date.parse(item.observedAt) > contract.maximumEvidenceAgeSeconds * 1000
      ? { ...item, freshness: "stale" as const } : item);
    // Empty/unknown overlap is never equivalent to “no restriction”. Until
    // P06 supplies a verified effective overlap, deny both directions.
    const constraints = bundle.constraints.length ? bundle.constraints : [
      { guideRef: "guide_overlap_unavailable", action: "budget_increase" as const, allowed: false, requiresHumanApproval: true, maximumAbsoluteDeltaDecimal: null, maximumRelativeDeltaBasisPoints: null, parentCeilingDecimal: null, guideMode: "observe_analyze" as const, actionDisposition: "denied" as const },
      { guideRef: "guide_overlap_unavailable", action: "budget_decrease" as const, allowed: false, requiresHumanApproval: true, maximumAbsoluteDeltaDecimal: null, maximumRelativeDeltaBasisPoints: null, parentCeilingDecimal: null, guideMode: "observe_analyze" as const, actionDisposition: "denied" as const },
    ];
    return dryRunGuideBudget({ targetScopeRef: contract.targetScopeRef, market: contract.market, currency: contract.currency,
      targetCurrentBudgetDecimal: bundle.targetCurrentBudgetDecimal, expression: contract.expression, scopeEvidence: aged, constraints });
  }
}
