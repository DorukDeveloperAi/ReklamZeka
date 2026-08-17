import { describe, expect, it } from "vitest";
import {
  aggregatePrimaryResult,
  createPrimaryResultBindingRevision,
  isPrimaryResultBindingRevision,
  primaryResultSelector,
  resolvePrimaryResultBinding,
} from "@/domain/operations/primary-result";
import { DrizzlePrimaryResultActionCatalogAdapter } from "@/connectors/operations/primary-result-action-catalog-drizzle-adapter";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const organizationCampaignId = "22222222-2222-4222-8222-222222222222";
const sliceId = "33333333-3333-4333-8333-333333333333";
const bindingId = "44444444-4444-4444-8444-444444444444";
const canonicalRows = (actionTypes: readonly string[]) => actionTypes.map((actionType, index) => ({ action_type: actionType, daily_insight_id: `00000000-0000-4000-8000-00000000000${index + 1}`, insight_source_payload_hash: "a".repeat(64), insight_source_revision: "insight-r1", metric_source_payload_hash: "b".repeat(64), metric_source_revision: "metric-r1", observed_at: new Date(`2026-08-17T12:00:0${index}.000Z`) }));
async function canonicalCatalog(actionTypes: readonly string[]) {
  let calls = 0;
  const database = { transaction: async <T>(run: (transaction: { execute(query: unknown): Promise<unknown> }) => Promise<T>) => run({ execute: async () => (++calls === 3 ? { rows: canonicalRows(actionTypes) } : { rows: [] }) }) };
  return new DrizzlePrimaryResultActionCatalogAdapter(database as never).load(workspaceId);
}
const trusted = await canonicalCatalog(["lead", "purchase"]);
if (!trusted) throw new Error("test fixture must expose canonical actions");
const evidence = trusted.canonicalEvidence;
const defaultScope = Object.freeze({ expectedWorkspaceId: workspaceId, currentSlice: Object.freeze({ kind: "none" as const, sliceId: null }), assignedOrganizationCampaignId: organizationCampaignId });
const catalog = trusted.catalog;
const orgBound = () => createPrimaryResultBindingRevision({ bindingId, workspaceId, target: { kind: "organization_campaign", organizationCampaignId }, state: "bound", selector: primaryResultSelector("lead", catalog), actionCatalog: catalog, createdAt: "2026-08-17T12:00:00.000Z" });
const sliceBound = () => createPrimaryResultBindingRevision({ bindingId: "55555555-5555-4555-8555-555555555555", workspaceId, target: { kind: "slice", sliceId }, state: "bound", selector: primaryResultSelector("purchase", catalog), actionCatalog: catalog, createdAt: "2026-08-17T12:01:00.000Z" });
const observation = (overrides: Record<string, unknown> = {}) => ({ action: { state: "known" as const, actionType: "lead", valueDecimal: "2" }, spend: { state: "known" as const, valueMinorDecimal: "1000", currency: "TRY" }, attributionLabel: "7d_click_1d_view", ...overrides });
function resolve(input: Partial<Parameters<typeof resolvePrimaryResultBinding>[0]> = {}) {
  return resolvePrimaryResultBinding({ expectedWorkspaceId: workspaceId, organizationCampaignBinding: orgBound(), sliceBinding: null, currentSlice: { kind: "none", sliceId: null }, assignedOrganizationCampaignId: organizationCampaignId, actionCatalog: catalog, canonicalCatalogEvidence: evidence, ...input });
}
function aggregate(observations: readonly ReturnType<typeof observation>[], input: Partial<Parameters<typeof aggregatePrimaryResult>[0]> = {}) {
  return aggregatePrimaryResult({ resolutionScope: defaultScope, organizationCampaignBinding: orgBound(), sliceBinding: null, actionCatalog: catalog, canonicalCatalogEvidence: evidence, observations, ...input });
}

describe("primary-result domain contract", () => {
  it("allows only an exact canonical action selector with catalog provenance", () => {
    expect(primaryResultSelector("lead", catalog)).toBe("actions/lead");
    expect(() => primaryResultSelector("objective:lead", catalog)).toThrow("selector_not_in_catalog");
    expect(catalog).toMatchObject({ provenance: { source: "meta_insights", field: "actions", breakdown: "action_type", extraction: "exact_action_type_only" }, catalogHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it("makes revisions immutable and hashes exact user-visible binding material", async () => {
    const first = orgBound(); const second = orgBound();
    expect(first.revisionHash).toBe(second.revisionHash);
    expect(Object.isFrozen(first)).toBe(true);
    expect(isPrimaryResultBindingRevision(first)).toBe(true);
    const other = await canonicalCatalog(["purchase"]);
    if (!other) throw new Error("test fixture must expose canonical actions");
    expect(() => resolve({ actionCatalog: other.catalog })).toThrow("binding_integrity");
    expect(isPrimaryResultBindingRevision({ ...first, selector: "actions/purchase" })).toBe(false);
    expect(() => createPrimaryResultBindingRevision({ bindingId, workspaceId, target: { kind: "organization_campaign", organizationCampaignId }, state: "bound", selector: "actions/lead", createdAt: "2026-08-17T12:00:00.000Z" })).toThrow("binding_state");
  });

  it("uses a scoped bound slice over its organization binding, but unbound slices fall back", () => {
    const bound = resolve({ sliceBinding: sliceBound(), currentSlice: { kind: "scoped", sliceId } });
    expect(bound).toMatchObject({ state: "bound", reason: "slice_binding", binding: { selector: "actions/purchase" } });
    expect(Object.isFrozen(bound.binding?.target)).toBe(true);
    const unboundSlice = createPrimaryResultBindingRevision({ bindingId: "66666666-6666-4666-8666-666666666666", workspaceId, target: { kind: "slice", sliceId }, state: "unbound", createdAt: "2026-08-17T12:00:00.000Z" });
    expect(resolve({ sliceBinding: unboundSlice, currentSlice: { kind: "scoped", sliceId } })).toMatchObject({ state: "bound", reason: "organization_campaign_fallback", binding: { selector: "actions/lead" } });
  });

  it("ignores global-slice bindings and never binds an unassigned campaign", () => {
    expect(resolve({ sliceBinding: sliceBound(), currentSlice: { kind: "global", sliceId: null } })).toMatchObject({ reason: "global_slice_ignored", binding: { selector: "actions/lead" } });
    expect(resolve({ organizationCampaignBinding: null, sliceBinding: sliceBound(), currentSlice: { kind: "scoped", sliceId }, assignedOrganizationCampaignId: null })).toMatchObject({ state: "unbound", reason: "unassigned" });
  });

  it("rejects a foreign or non-current slice revision and a forged canonical catalog", async () => {
    expect(() => resolve({ expectedWorkspaceId: "77777777-7777-4777-8777-777777777777" })).toThrow("catalog_workspace");
    expect(() => resolve({ sliceBinding: sliceBound(), currentSlice: { kind: "scoped", sliceId: "88888888-8888-4888-8888-888888888888" } })).toThrow("slice_binding");
    await expect(canonicalCatalog(["invented_action"])).resolves.toBeNull();
    const forged = Object.freeze({ ...catalog, actionTypes: Object.freeze([...catalog.actionTypes]) }) as never;
    expect(() => resolve({ actionCatalog: forged })).toThrow("binding_integrity");
  });

  it("rejects extra fields and does not retain mutable target input", () => {
    const target = { kind: "organization_campaign" as const, organizationCampaignId };
    const revision = createPrimaryResultBindingRevision({ bindingId, workspaceId, target, state: "bound", selector: primaryResultSelector("lead", catalog), actionCatalog: catalog, createdAt: "2026-08-17T12:00:00.000Z" });
    target.organizationCampaignId = "99999999-9999-4999-8999-999999999999";
    expect(revision.target).toMatchObject({ organizationCampaignId });
    expect(() => createPrimaryResultBindingRevision({ bindingId, workspaceId, target: { kind: "organization_campaign", organizationCampaignId, ignored: true } as never, state: "bound", selector: primaryResultSelector("lead", catalog), actionCatalog: catalog, createdAt: "2026-08-17T12:00:00.000Z" })).toThrow("binding_target");
  });

  it("sums decimal text without number precision loss and calculates ratio-of-sums", () => {
    const result = aggregate([observation({ action: { state: "known", actionType: "lead", valueDecimal: "9007199254740993.25" }, spend: { state: "known", valueMinorDecimal: "18014398509481986.50", currency: "TRY" } }), observation()]);
    expect(result).toMatchObject({ state: "available", resultDecimal: "9007199254740995.25", resultCostMinorDecimal: "2", currency: "TRY", provenance: { aggregation: "ratio_of_sums" } });
  });

  it("keeps known zero distinct from a missing action and makes zero cost null", () => {
    expect(aggregate([observation({ action: { state: "known", actionType: "lead", valueDecimal: "0" } })])).toMatchObject({ state: "available", resultDecimal: "0", resultCostMinorDecimal: null, reasonCodes: ["zero_result_cost_not_defined"] });
    expect(aggregate([observation({ action: { state: "missing", actionType: "lead" } })])).toMatchObject({ state: "unknown", resultDecimal: null, reasonCodes: ["action_missing"] });
  });

  it("fails closed for attribution and currency incompatibility", () => {
    expect(aggregate([observation(), observation({ attributionLabel: "1d_click" })])).toMatchObject({ state: "unknown", reasonCodes: ["attribution_mismatch"] });
    expect(aggregate([observation(), observation({ spend: { state: "known", valueMinorDecimal: "10", currency: "USD" } })])).toMatchObject({ state: "unknown", reasonCodes: ["currency_mismatch"] });
  });

  it("rejects forged resolution and extra nested observation fields", () => {
    expect(() => aggregatePrimaryResult({ resolution: { state: "bound" }, resolutionScope: defaultScope, organizationCampaignBinding: orgBound(), sliceBinding: null, actionCatalog: catalog, canonicalCatalogEvidence: evidence, observations: [observation()] } as never)).toThrow("observations");
    expect(() => aggregate([observation({ action: { state: "known", actionType: "lead", valueDecimal: "1", ignored: true } } as never)])).toThrow("observation_action");
    expect(aggregate([observation({ spend: { state: "known", valueMinorDecimal: "1", currency: ["TRY"] } } as never)])).toMatchObject({ state: "unknown", reasonCodes: ["currency_mismatch"] });
    expect(() => aggregate([observation({ action: { state: "known", actionType: ["lead"], valueDecimal: "1" } } as never)])).toThrow("observation_action");
  });
});
