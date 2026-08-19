import { describe, expect, it } from "vitest";

import { buildActionPlan, type ActionValveContext, type TypedActionIntent } from "@/domain/actions/autonomy-valve";
import { createMetaWriteSpec, MetaWriteSpecError } from "@/domain/actions/meta-write-spec";

const context: ActionValveContext = {
  workspaceRef: "workspace_alpha", accountGroupRef: null, accountRef: "account_main", internalCategoryRefs: [],
  campaignRef: "campaign_main", entity: { level: "campaign", ref: "campaign_main" }, evaluatedAt: "2026-08-10T12:00:00.000Z",
  rules: [], budgetLimits: { currency: "TRY", maximumAbsoluteDeltaDecimal: "20", maximumRelativeDeltaBasisPoints: 2_000, limitRefs: ["budget_cap"] },
  protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] },
};
const unit = { unitRef: "unit_action_one", unitHash: "a".repeat(64) };
function plan(action: TypedActionIntent, patch: Partial<ActionValveContext> = {}) {
  return buildActionPlan(action, { ...context, ...patch, entity: action.entity, campaignRef: action.entity.level === "campaign" ? action.entity.ref : context.campaignRef });
}

describe("typed Meta write spec", () => {
  it("maps only typed status and budget candidates without giving execution or raw Graph authority", () => {
    const pause = createMetaWriteSpec({ ...unit, actionPlan: plan({ kind: "status_change", entity: { level: "campaign", ref: "campaign_main" }, fromStatus: "ACTIVE", toStatus: "PAUSED" }) });
    expect(pause).toMatchObject({ actionType: "status_pause", target: { entityLevel: "campaign", entityRef: "campaign_main" }, mutation: { kind: "status", desiredStatus: "PAUSED" }, requiresSeparateExecutionGrant: true, capabilities: { canExecute: false, canWriteMeta: false, canAccessRawGraph: false } });
    expect(JSON.stringify(pause)).not.toMatch(/"path"|"field"|token|authorization|external/i);

    const budget = createMetaWriteSpec({ ...unit, actionPlan: plan({ kind: "budget_change", entity: { level: "campaign", ref: "campaign_main" }, budgetKind: "daily", currency: "TRY", beforeDecimal: "100", afterDecimal: "90", budgetOwnerRef: "campaign_main" }) });
    expect(budget).toMatchObject({ actionType: "budget_decrease", mutation: { kind: "budget", budgetKind: "daily", currency: "TRY", desiredDecimal: "90" } });

    const activateAd = createMetaWriteSpec({ ...unit, actionPlan: plan({ kind: "status_change", entity: { level: "ad", ref: "ad_one" }, fromStatus: "PAUSED", toStatus: "ACTIVE" }, { entity: { level: "ad", ref: "ad_one" } }) });
    expect(activateAd).toMatchObject({ actionType: "status_activate", target: { entityLevel: "ad", entityRef: "ad_one" }, mutation: { kind: "status", desiredStatus: "ACTIVE" } });

    const rename = createMetaWriteSpec({ ...unit, actionPlan: plan({ kind: "rename", entity: { level: "campaign", ref: "campaign_main" },
      beforeName: "Eski Kampanya", afterName: "Yeni Kampanya", namingEvidenceRef: "naming_evidence_main" }) });
    expect(rename).toMatchObject({ actionType: "campaign_rename", mutation: { kind: "rename", previousName: "Eski Kampanya",
      desiredName: "Yeni Kampanya", namingEvidenceRef: "naming_evidence_main" }, requiresSeparateExecutionGrant: true });
  });

  it("rejects K0/K1/K4, denied plans, forged hashes and raw Graph-shaped input", () => {
    const noChange = plan({ kind: "no_change", entity: { level: "campaign", ref: "campaign_main" }, reasonRef: "reason_observe" });
    expect(() => createMetaWriteSpec({ ...unit, actionPlan: noChange })).toThrowError(expect.objectContaining({ code: "invalid_plan" }));
    const promotion = plan({ kind: "existing_post_promotion", entity: { level: "adset", ref: "adset_one" }, placeholderOnly: true,
      postRef: "post_one", postContentHash: "b".repeat(64), sourceBinding: { version: "existing-post-source-binding/2.0.0", kind: "existing_ad_binding", bindingRef: "binding_one", bindingHash: "c".repeat(64) }, actorRef: "actor_one", promotionTemplateVersionRef: "template_one", audiencePresetVersionRef: "audience_one", destinationRef: "destination_one", budgetPlanVersionRef: "budget_one", timeframeRef: "timeframe_one", scheduleMode: "continuous", durationDays: null }, { entity: { level: "adset", ref: "adset_one" } });
    // K4 is outside this first writer allowlist. A malformed K4 plan is
    // rejected even earlier by the immutable-plan integrity gate.
    expect(() => createMetaWriteSpec({ ...unit, actionPlan: promotion })).toThrow(MetaWriteSpecError);
    const valid = plan({ kind: "status_change", entity: { level: "campaign", ref: "campaign_main" }, fromStatus: "ACTIVE", toStatus: "PAUSED" });
    expect(() => createMetaWriteSpec({ ...unit, actionPlan: { ...valid, planHash: "d".repeat(64) } })).toThrow(MetaWriteSpecError);
    expect(() => createMetaWriteSpec({ ...unit, actionPlan: { kind: "raw_graph", path: "/act_x", field: "status" } as never })).toThrow(MetaWriteSpecError);
  });
});
