import { describe, expect, it, vi } from "vitest";

import {
  PROMOTION_TEMPLATE_AUTHORING_VERSION,
  PromotionTemplateAuthoringService,
  type PromotionTemplateAuthoringSelection,
} from "@/application/promotion-template-authoring";
import type { PublishedPromotionTemplateCatalog } from "@/application/promotion-template-selector-service";
import {
  AUDIENCE_PRESET_VERSION,
  PROMOTION_TEMPLATE_BINDING_VERSION,
  PROMOTION_TEMPLATE_VERSION,
  createAudiencePresetRevision,
  createPromotionTemplateBinding,
  createPromotionTemplateRevision,
} from "@/domain/meta/promotion/promotion-template";
import {
  createPromotionTemplateAuthoringHttpHandlers,
} from "@/server/promotion-template-authoring-http";

const origin = "http://localhost:3000";
const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const workspaceRef = "workspace_local";
const evaluatedAt = "2026-08-09T18:00:00.000Z";
const principal = { actor: { userId }, workspaceId, workspaceRef, readerRef: "reader_owner" } as const;

function candidate(suffix = "hair", alias = "Saç ekimi gönderisini öne çıkar") {
  const preset = createAudiencePresetRevision({
    version: AUDIENCE_PRESET_VERSION, workspaceRef, presetRef: `audience_${suffix}`, revision: 2,
    aliases: ["Türkiye sağlık kitlesi"], state: "published",
    source: { kind: "frozen_targeting_spec", sourceRef: `source_${suffix}`,
      targetingHash: "a".repeat(64), provenanceHash: "b".repeat(64) },
    targeting: { geoRefs: ["geo_turkey"], languages: ["language_tr"], ageMin: 25, ageMax: 55,
      inclusionRefs: ["interest_health"], exclusionRefs: [] }, publishedAt: "2026-08-09T16:00:00.000Z",
  });
  const template = createPromotionTemplateRevision({
    version: PROMOTION_TEMPLATE_VERSION, workspaceRef, templateRef: `template_${suffix}`, revision: 4,
    aliases: [alias], state: "published", accountRefs: ["account_doruk"], actorTypes: ["instagram"],
    internalCategoryRefs: ["category_hair"], postTypes: ["image", "reel"], objectiveRef: "objective_messages",
    optimizationGoalRef: "optimization_conversations", destinationRef: "destination_instagram",
    placementRefs: ["placement_automatic"], namingRuleRef: "naming_standard", trackingRuleRef: "tracking_standard",
    adSetPolicy: "existing_only", audiencePreset: { presetRef: preset.presetRef, revision: preset.revision,
      presetHash: preset.presetHash }, budget: { ownerLevel: "adset", currency: "TRY", kind: "daily",
      defaultDecimal: "1000", minimumDecimal: "500", maximumDecimal: "2000", budgetPlanVersionRef: "budget_plan_v4" },
    timeframe: { timeframeRef: "timeframe_seven_days", scheduleMode: "fixed_duration", durationDays: 7 },
    publishedAt: "2026-08-09T16:01:00.000Z",
  });
  const binding = createPromotionTemplateBinding({
    version: PROMOTION_TEMPLATE_BINDING_VERSION, workspaceRef, bindingRef: `binding_${suffix}`,
    template: { templateRef: template.templateRef, revision: template.revision, templateHash: template.templateHash },
    accountRef: "account_doruk", actor: { type: "instagram", actorRef: "actor_doruk_ig" },
    internalCategoryRefs: ["category_hair"], campaignRef: null, effectiveFrom: "2026-08-09T16:02:00.000Z", expiresAt: null,
  }, template);
  return Object.freeze({ preset, template, binding });
}

function harness(role: "owner" | "admin" | "analyst" | "viewer" = "owner", candidates = [candidate()]) {
  const listPublished = vi.fn(async () => candidates);
  const catalog: PublishedPromotionTemplateCatalog = { listPublished };
  const service = new PromotionTemplateAuthoringService(catalog, workspaceRef, [{ userId, workspaceId, role }]);
  return { service, listPublished };
}

function getRequest(extra: Record<string, string> = {}) {
  return new Request(`${origin}/api/promotion-template-authoring`, { headers: {
    Host: "localhost:3000", "Sec-Fetch-Site": "same-origin", Cookie: "__Host-rzka_local_session=opaque",
    "X-ReklamZeka-Intent": "promotion-template-authoring-read", ...extra,
  } });
}

function postRequest(selection: unknown, extra: Record<string, string> = {}) {
  return new Request(`${origin}/api/promotion-template-authoring`, { method: "POST", headers: {
    Host: "localhost:3000", Origin: origin, "Sec-Fetch-Site": "same-origin",
    Cookie: "__Host-rzka_local_session=opaque", "Content-Type": "application/json",
    "X-ReklamZeka-Intent": "promotion-template-authoring-dry-run", ...extra,
  }, body: JSON.stringify({ selection }) });
}

describe("PromotionTemplate role-aware authoring preview", () => {
  it("projects opaque scopes without exposing account, actor, category or targeting material", async () => {
    const app = harness("viewer");
    const inspection = await app.service.inspect(principal, evaluatedAt);
    expect(inspection).toMatchObject({ contractVersion: PROMOTION_TEMPLATE_AUTHORING_VERSION, role: "viewer",
      capabilities: { canRead: true, canDryRun: false, canPersistDraft: false, canPublish: false, canWriteMeta: false },
      lifecycle: { publishMutation: "unavailable", blocker: "immutable_registry_has_no_authoring_occ_audit_lifecycle" },
      catalog: { scopes: [{ actorType: "instagram", categoryCount: 1, postTypes: ["image", "reel"] }] } });
    const serialized = JSON.stringify(inspection);
    expect(serialized).not.toContain("account_doruk");
    expect(serialized).not.toContain("actor_doruk_ig");
    expect(serialized).not.toContain("category_hair");
    expect(serialized).not.toContain("interest_health");
    expect(serialized).not.toMatch(/[a-f0-9]{64}/);
  });

  it("rejects a forged published candidate on GET before aliases or scope metadata can be projected", async () => {
    const authentic = candidate();
    const forged = { ...authentic, template: { ...authentic.template, aliases: ["Forged public alias"] } };
    const app = harness("viewer", [forged]);
    await expect(app.service.inspect(principal, evaluatedAt)).rejects.toMatchObject({ code: "catalog_integrity_rejected" });
  });

  it("lets analyst/owner dry-run one server-resolved scope while viewer remains read-only", async () => {
    for (const role of ["owner", "admin", "analyst"] as const) {
      const app = harness(role);
      const inspection = await app.service.inspect(principal, evaluatedAt);
      const selection: PromotionTemplateAuthoringSelection = { scopeRef: inspection.catalog.scopes[0]!.scopeRef,
        postType: "image", instruction: "Saç ekimi gönderisini öne çıkar" };
      await expect(app.service.dryRun(principal, selection, evaluatedAt)).resolves.toMatchObject({ role,
        result: { status: "recommended", publishReady: true, dryRunOnly: true,
          recommendation: { promotionTemplate: { templateRef: "template_hair" }, audiencePreset: { presetRef: "audience_hair" } },
          capabilities: { canPersist: false, canPublish: false, canWriteMeta: false, canChangeTargeting: false } },
        capabilities: { canDryRun: true, canPersistDraft: false, canPublish: false } });
    }
    const viewer = harness("viewer");
    const scope = (await viewer.service.inspect(principal, evaluatedAt)).catalog.scopes[0]!.scopeRef;
    await expect(viewer.service.dryRun(principal, { scopeRef: scope, postType: "image", instruction: "Saç ekimi" }, evaluatedAt))
      .rejects.toBeInstanceOf(Error);
  });

  it("returns questions instead of inventing scope, targeting, creative or an ambiguous winner", async () => {
    const emptyFacts = harness("analyst");
    await expect(emptyFacts.service.dryRun(principal, { scopeRef: null, postType: null, instruction: null }, evaluatedAt))
      .resolves.toMatchObject({ result: { status: "unresolved", publishReady: false, recommendation: null } });
    const inspection = await emptyFacts.service.inspect(principal, evaluatedAt);
    const scopeRef = inspection.catalog.scopes[0]!.scopeRef;
    for (const instruction of ["Bu kapsamın hedeflemesini değiştir", "Bu gönderi için yeni görsel üret"]) {
      await expect(emptyFacts.service.dryRun(principal, { scopeRef, postType: "image", instruction }, evaluatedAt))
        .resolves.toMatchObject({ result: { status: "unresolved", publishReady: false, recommendation: null,
          reasons: [expect.anything(), expect.objectContaining({ code: "unsupported_instruction" })] } });
    }
    const ambiguous = harness("analyst", [candidate("hair_a", "Saç ekimi"), candidate("hair_b", "Saç ekimi")]);
    const ambiguousScope = (await ambiguous.service.inspect(principal, evaluatedAt)).catalog.scopes[0]!.scopeRef;
    await expect(ambiguous.service.dryRun(principal, { scopeRef: ambiguousScope, postType: "image", instruction: "Saç ekimi" }, evaluatedAt))
      .resolves.toMatchObject({ result: { status: "ambiguous", publishReady: false, recommendation: null } });
  });
});

describe("PromotionTemplate authoring HTTP boundary", () => {
  it("serves cookie-only catalog and exact scope dry-run with every mutation authority closed", async () => {
    const app = harness("analyst");
    const resolvePrincipal = vi.fn(async () => principal);
    const api = createPromotionTemplateAuthoringHttpHandlers({ service: app.service, origin, resolvePrincipal,
      now: () => evaluatedAt });
    const get = await api.GET(getRequest());
    expect(get.status).toBe(200);
    expect(get.headers.get("x-reklamzeka-action-authority")).toBe("none");
    const catalog = await get.json() as { catalog: { scopes: readonly { scopeRef: string }[] } };
    const selection = { scopeRef: catalog.catalog.scopes[0]!.scopeRef, postType: "image",
      instruction: "Saç ekimi gönderisini öne çıkar" };
    const post = await api.POST(postRequest(selection));
    expect(post.status).toBe(200);
    await expect(post.json()).resolves.toMatchObject({ result: { status: "recommended", dryRunOnly: true },
      capabilities: { canDryRun: true, canPersistDraft: false, canPublish: false, canWriteMeta: false } });
    expect(resolvePrincipal).toHaveBeenCalledTimes(2);
  });

  it("rejects caller identity/scope/account, extra targeting, bearer and cross-origin before principal resolution", async () => {
    const app = harness("analyst");
    const resolvePrincipal = vi.fn(async () => principal);
    const api = createPromotionTemplateAuthoringHttpHandlers({ service: app.service, origin, resolvePrincipal,
      now: () => evaluatedAt });
    const safe = { scopeRef: "promotion_scope_aaaaaaaaaaaaaaaaaaaaaaaa", postType: "image", instruction: "Saç ekimi" };
    for (const request of [
      postRequest({ ...safe, accountRef: "account_forged" }),
      postRequest({ ...safe, targeting: { interests: ["invented"] } }),
      postRequest(safe, { Authorization: "Bearer forged" }),
      postRequest(safe, { "X-Workspace-Id": workspaceId }),
      postRequest(safe, { "X-Account-Id": "1234567890123" }),
      postRequest(safe, { Origin: "https://attacker.invalid" }),
      getRequest({ Authorization: "Bearer forged" }),
    ]) expect((await (request.method === "GET" ? api.GET(request) : api.POST(request))).status).toBe(400);
    expect(resolvePrincipal).not.toHaveBeenCalled();
    expect(app.listPublished).not.toHaveBeenCalled();
  });

  it("denies viewer dry-run before reading the published catalog", async () => {
    const app = harness("viewer");
    const api = createPromotionTemplateAuthoringHttpHandlers({ service: app.service, origin,
      resolvePrincipal: async () => principal, now: () => evaluatedAt });
    const response = await api.POST(postRequest({ scopeRef: "promotion_scope_aaaaaaaaaaaaaaaaaaaaaaaa",
      postType: "image", instruction: "Saç ekimi" }));
    expect(response.status).toBe(403);
    expect(app.listPublished).not.toHaveBeenCalled();
  });
});
