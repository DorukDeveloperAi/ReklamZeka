import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseStarterCategoryAdoptionPlan, parseStarterCategoryAdoptionSuccess, StarterCategoryAdoption } from
  "@/app/dashboard/starter-category-adoption";
import { buildStarterCategoryAdoptionPlan } from "@/application/starter-category-adoption-service";

const payload = buildStarterCategoryAdoptionPlan("workspace_starter", {
  registryHash: "a".repeat(64), dimensions: [], assignments: [], targets: [],
}, { registryHash: "b".repeat(64), definitions: [] });

describe("StarterCategoryAdoption dashboard", () => {
  it("parses only bounded 14-dimension, 42-proposal and seven-profile draft material", () => {
    expect(parseStarterCategoryAdoptionPlan(payload)).toMatchObject({
      contractVersion: "starter-category-adoption/1.1.0",
      summary: { canonicalDimensions: 14, profileProposals: 42, profileDraftsToCreate: 7 },
      authority: { canPersist: false, canAuthorizeAction: false, canWriteMeta: false, canPublishPolicy: false } });
    expect(() => parseStarterCategoryAdoptionPlan({ ...payload,
      authority: { ...payload.authority, canPersist: true } })).toThrow("unsafe_response");
    expect(() => parseStarterCategoryAdoptionPlan({ ...payload, unexpected: true })).toThrow("unsafe_response");
    expect(() => parseStarterCategoryAdoptionPlan({ ...payload,
      targetRefs: [...payload.targetRefs].reverse() })).toThrow("unsafe_response");
    expect(() => parseStarterCategoryAdoptionPlan({ ...payload,
      profileDrafts: [{ ...payload.profileDrafts[0], proposalHashes: ["c".repeat(64)] },
        ...payload.profileDrafts.slice(1)] })).toThrow("unsafe_response");
    expect(() => parseStarterCategoryAdoptionPlan({ ...payload,
      blockers: [{ code: "unknown", blocking: false, refs: ["safe_ref"] }] })).toThrow("unsafe_response");
  });

  it("accepts only an exact replay-bound partial-core adoption result", () => {
    const preview = parseStarterCategoryAdoptionPlan(payload);
    const success = { contractVersion: preview.contractVersion, catalogVersion: preview.catalogVersion,
      catalogHash: preview.catalogHash, planHash: preview.planHash,
      status: "core_adopted_with_owner_configuration_pending",
      pendingOwnerConfiguration: preview.blockers.find((blocker) => blocker.code === "pending_owner_configuration")!.refs,
      result: { outcome: "inserted", registryHash: "c".repeat(64), profileRegistryHash: "d".repeat(64),
        dimensionsCreated: 14, definitionsCreated: 7, profileDraftsCreated: 7, auditAppended: true,
        categoryInvalidationsAppended: 0, profileInvalidationsAppended: 0 },
      authority: { canPersist: true, canConfirm: true, canAuthorizeAction: false,
        canWriteMeta: false, canPublishPolicy: false } } as const;
    expect(parseStarterCategoryAdoptionSuccess(success, preview)).toMatchObject({ outcome: "inserted",
      profileDraftsCreated: 7 });
    expect(() => parseStarterCategoryAdoptionSuccess({ ...success, planHash: "e".repeat(64) }, preview))
      .toThrow("unsafe_response");
    expect(() => parseStarterCategoryAdoptionSuccess({ ...success,
      authority: { ...success.authority, canWriteMeta: true } }, preview)).toThrow("unsafe_response");
  });

  it("renders the fail-closed loading shell without Meta or action controls", () => {
    const html = renderToStaticMarkup(createElement(StarterCategoryAdoption));
    expect(html).toContain("14-DIMENSION STARTER PLAN"); expect(html).toContain("Plan yükleniyor");
    expect(html).not.toContain("Meta write"); expect(html).not.toContain("Action execute");
  });
});
