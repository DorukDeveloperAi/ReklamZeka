import { describe, expect, it } from "vitest";

import { assessMetaWriteEligibility } from "@/domain/actions/meta-write-eligibility";
import { createMetaWriteSpec } from "@/domain/actions/meta-write-spec";
import { buildActionPlan, type ActionValveContext } from "@/domain/actions/autonomy-valve";

const context: ActionValveContext = { workspaceRef: "workspace_alpha", accountGroupRef: null, accountRef: "account_main", internalCategoryRefs: [], campaignRef: "campaign_main", entity: { level: "ad", ref: "ad_main" }, evaluatedAt: "2026-08-10T12:00:00.000Z", rules: [], budgetLimits: null, protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] } };
function spec(kind: "pause" | "activate" | "budget" = "pause") {
  const action = kind === "budget" ? { kind: "budget_change" as const, entity: { level: "campaign" as const, ref: "campaign_main" }, budgetKind: "daily" as const, currency: "TRY", beforeDecimal: "100", afterDecimal: "90", budgetOwnerRef: "campaign_main" }
    : { kind: "status_change" as const, entity: kind === "activate" ? { level: "ad" as const, ref: "ad_main" } : { level: "ad" as const, ref: "ad_main" }, fromStatus: kind === "activate" ? "PAUSED" as const : "ACTIVE" as const, toStatus: kind === "activate" ? "ACTIVE" as const : "PAUSED" as const };
  const plan = buildActionPlan(action, { ...context, entity: action.entity, campaignRef: action.entity.level === "campaign" ? action.entity.ref : "campaign_main",
    budgetLimits: kind === "budget" ? { currency: "TRY", maximumAbsoluteDeltaDecimal: "20", maximumRelativeDeltaBasisPoints: 2_000, limitRefs: ["budget_cap"] } : null });
  return createMetaWriteSpec({ unitRef: "unit_action_one", unitHash: "a".repeat(64), actionPlan: plan });
}
function snapshot() { return { workspaceRef: "workspace_alpha", accountRef: "account_main", capturedAt: "2026-08-10T12:00:00.000Z", target: { entityLevel: "ad" as const, entityRef: "ad_main", configuredStatus: "ACTIVE" as const, effectiveStatus: "ACTIVE" as const, budgetOwnerRef: null }, ancestors: [{ entityLevel: "campaign" as const, entityRef: "campaign_main", configuredStatus: "ACTIVE" as const, effectiveStatus: "ACTIVE" as const }, { entityLevel: "adset" as const, entityRef: "adset_main", configuredStatus: "ACTIVE" as const, effectiveStatus: "ACTIVE" as const }], sourceSnapshotHash: "b".repeat(64) }; }

describe("Meta write eligibility matrix", () => {
  it("admits only a fully active pause candidate and keeps all write authority false", () => {
    expect(assessMetaWriteEligibility({ writeSpec: spec(), snapshot: snapshot() })).toMatchObject({ disposition: "eligible_for_separate_human_execution", reasons: [], capabilities: { canExecute: false, canWriteMeta: false, canDispatchNetwork: false } });
  });
  it("blocks activation behind an inactive or unknown parent and stale target shape", () => {
    expect(assessMetaWriteEligibility({ writeSpec: spec("activate"), snapshot: { ...snapshot(), target: { ...snapshot().target, configuredStatus: "PAUSED", effectiveStatus: "PAUSED" }, ancestors: [{ ...snapshot().ancestors[0]!, effectiveStatus: "PAUSED" }] } }).reasons).toContain("parent_not_effective_active");
    expect(assessMetaWriteEligibility({ writeSpec: spec(), snapshot: { ...snapshot(), target: { ...snapshot().target, effectiveStatus: "UNKNOWN" } } }).reasons).toContain("target_state_unknown");
  });
  it("requires the exact active campaign or ad set budget owner", () => {
    const budgetSnapshot = { ...snapshot(), target: { entityLevel: "campaign" as const, entityRef: "campaign_main", configuredStatus: "ACTIVE" as const, effectiveStatus: "ACTIVE" as const, budgetOwnerRef: "campaign_main" } };
    expect(assessMetaWriteEligibility({ writeSpec: spec("budget"), snapshot: budgetSnapshot }).disposition).toBe("eligible_for_separate_human_execution");
    expect(assessMetaWriteEligibility({ writeSpec: spec("budget"), snapshot: { ...budgetSnapshot, target: { ...budgetSnapshot.target, budgetOwnerRef: "campaign_other" } } }).reasons).toContain("budget_owner_mismatch");
  });
});
