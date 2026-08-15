import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseStarterCategoryAdoptionPlan, parseStarterCategoryAdoptionSuccess, StarterCategoryAdoption } from
  "@/app/dashboard/starter-category-adoption";
import { buildStarterCategoryAdoptionPlan } from "@/application/starter-category-adoption-service";

const payload = buildStarterCategoryAdoptionPlan("workspace_starter", {
  registryHash: "a".repeat(64), dimensions: [], assignments: [], targets: [],
}, { registryHash: "b".repeat(64), definitions: [] });

describe("StarterCategoryAdoption dashboard", () => {
  it("parses only bounded 15-dimension market-safe starter material", () => {
    expect(parseStarterCategoryAdoptionPlan(payload)).toMatchObject({
      contractVersion: "starter-category-adoption/1.1.0",
      summary: { canonicalDimensions: 15, profileProposals: 54, profileDraftsToCreate: 9 },
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
        dimensionsCreated: 15, definitionsCreated: 9, profileDraftsCreated: 9, auditAppended: true,
        categoryInvalidationsAppended: 0, profileInvalidationsAppended: 0 },
      authority: { canPersist: true, canConfirm: true, canAuthorizeAction: false,
        canWriteMeta: false, canPublishPolicy: false } } as const;
    expect(parseStarterCategoryAdoptionSuccess(success, preview)).toMatchObject({ outcome: "inserted",
      profileDraftsCreated: 9 });
    expect(parseStarterCategoryAdoptionSuccess({ ...success, result: { ...success.result,
      categoryInvalidationsAppended: 3 } }, preview)).toMatchObject({ categoryInvalidationsAppended: 3 });
    expect(() => parseStarterCategoryAdoptionSuccess({ ...success, planHash: "e".repeat(64) }, preview))
      .toThrow("unsafe_response");
    expect(() => parseStarterCategoryAdoptionSuccess({ ...success,
      authority: { ...success.authority, canWriteMeta: true } }, preview)).toThrow("unsafe_response");
  });

  it("renders the fail-closed loading shell without Meta or action controls", () => {
    const html = renderToStaticMarkup(createElement(StarterCategoryAdoption));
    expect(html).toContain("15-BOYUTLU BAŞLANGIÇ PLANI"); expect(html).toContain("Plan yükleniyor");
    expect(html).not.toContain("Meta write"); expect(html).not.toContain("Action execute");
  });

  it("inherits the soft dashboard theme rather than forcing a separate dark palette", () => {
    const css = readFileSync("src/app/dashboard/starter-category-adoption.module.css", "utf8");
    for (const token of ["var(--rz-surface)", "var(--rz-surface-2)", "var(--rz-text)", "var(--rz-muted)", "var(--rz-blue)"]) {
      expect(css).toContain(token);
    }
    expect(css).not.toContain("rgba(15,23,42");
    expect(css).not.toContain("#0e7490");
  });
});
