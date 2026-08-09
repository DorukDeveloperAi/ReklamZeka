import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseStarterCategoryAdoptionBlockedResponse, parseStarterCategoryAdoptionPlan, StarterCategoryAdoption } from
  "@/app/dashboard/starter-category-adoption";
import { buildStarterCategoryAdoptionPlan } from "@/application/starter-category-adoption-service";

const coverage = ["service_line", "brand_clinic", "geo_market", "language", "campaign_role", "funnel_intent",
  "audience_strategy", "destination", "budget_pool", "operating_mode", "lifecycle", "experiment",
  "protection_class", "custom"].map((dimensionKey) => ({ dimensionKey, disposition: "satisfied",
    reasonCode: "already_present" }));
const payload = { contractVersion: "starter-category-adoption/1.0.0",
  catalogVersion: "starter-category-playbooks/1.1.0", catalogHash: "a".repeat(64),
  registryHash: "b".repeat(64), planHash: "c".repeat(64), status: "preview_only",
  summary: { canonicalDimensions: 14, dimensionsToCreate: 0, definitionsToCreate: 0,
    profileProposals: 0, satisfied: 14, conflicts: 0, ownerConfigurationRequired: 0 },
  dimensionCoverage: coverage, categoryCommands: [], profileProposals: [],
  blockers: [{ code: "atomic_multi_command_category_adoption_unavailable",
    refs: ["category_authoring_atomic_batch/1.0.0"] }, { code: "category_profile_registry_unavailable",
    refs: ["category_profile_authoritative_inventory/1.0.0"] }], ownerConfirmationRequired: true,
  confirmationLiteral: "adopt_starter_category_playbook", authority: { canPersist: false, canConfirm: true,
    canAuthorizeAction: false, canWriteMeta: false, canPublishPolicy: false } } as const;

describe("StarterCategoryAdoption dashboard", () => {
  it("parses only bounded 14-dimension preview-only material with all write authority closed", () => {
    expect(parseStarterCategoryAdoptionPlan(payload)).toMatchObject({ summary: { canonicalDimensions: 14 },
      authority: { canPersist: false, canAuthorizeAction: false, canWriteMeta: false, canPublishPolicy: false } });
    expect(() => parseStarterCategoryAdoptionPlan({ ...payload,
      authority: { ...payload.authority, canPersist: true } })).toThrow("unsafe_response");
    expect(() => parseStarterCategoryAdoptionPlan({ ...payload,
      dimensionCoverage: [...coverage.slice(0, 13), coverage[0]] })).toThrow("unsafe_response");
    expect(() => parseStarterCategoryAdoptionPlan({ ...payload,
      authority: { ...payload.authority, canConfirm: "true" } })).toThrow("unsafe_response");
    expect(() => parseStarterCategoryAdoptionPlan({ ...payload, unexpected: true })).toThrow("unsafe_response");
    expect(() => parseStarterCategoryAdoptionPlan({ ...payload,
      summary: { ...payload.summary, definitionsToCreate: Number.MAX_SAFE_INTEGER } })).toThrow("unsafe_response");
    expect(() => parseStarterCategoryAdoptionPlan({ ...payload,
      blockers: [...payload.blockers, { code: "unknown", refs: [] }] })).toThrow("unsafe_response");
    expect(parseStarterCategoryAdoptionPlan(buildStarterCategoryAdoptionPlan("workspace_starter", {
      registryHash: "d".repeat(64), dimensions: [], assignments: [], targets: [],
    }))).toMatchObject({ summary: { dimensionsToCreate: 14, definitionsToCreate: 7,
      profileProposals: 42 } });
  });

  it("accepts only the exact replay-bound zero-write confirmation response", () => {
    const preview = parseStarterCategoryAdoptionPlan(payload);
    const blocked = { ...payload, status: "blocked", persistenceAttempted: false,
      blocker: "atomic_multi_command_category_adoption_unavailable",
      continuation: { requiredCapability:
        "category_authoring_atomic_batch/1.0.0 + category_profile_atomic_batch/1.0.0",
      replay: { planHash: payload.planHash, expectedRegistryHash: payload.registryHash,
        confirmation: payload.confirmationLiteral } } } as const;
    expect(parseStarterCategoryAdoptionBlockedResponse(blocked, preview)).toEqual({
      blocker: "atomic_multi_command_category_adoption_unavailable",
    });
    expect(() => parseStarterCategoryAdoptionBlockedResponse({ ...blocked,
      continuation: { ...blocked.continuation, replay: { ...blocked.continuation.replay,
        planHash: "d".repeat(64) } } }, preview)).toThrow("unsafe_response");
  });

  it("renders the fail-closed loading shell without a persistence or Meta-write control", () => {
    const html = renderToStaticMarkup(createElement(StarterCategoryAdoption));
    expect(html).toContain("14-DIMENSION STARTER PLAN"); expect(html).toContain("Plan yükleniyor");
    expect(html).not.toContain("Meta write"); expect(html).not.toContain("Kategorileri oluştur");
  });
});
