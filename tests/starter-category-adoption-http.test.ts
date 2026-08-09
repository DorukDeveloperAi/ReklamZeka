import { describe, expect, it, vi } from "vitest";

import { StarterCategoryAdoptionError } from "@/application/starter-category-adoption-service";
import { createStarterCategoryAdoptionHttpHandlers } from "@/server/starter-category-adoption-http";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_starter",
  readerRef: "actor_starter" } as const;
const plan = { contractVersion: "starter-category-adoption/1.1.0", catalogVersion: "starter-category-playbooks/1.1.0",
  catalogHash: "a".repeat(64), registryHash: "b".repeat(64), profileRegistryHash: "c".repeat(64),
  planHash: "d".repeat(64), status: "preview_only", summary: { canonicalDimensions: 14 },
  dimensionCoverage: [], categoryCommands: [], profileProposals: [], profileDrafts: [], targetRefs: ["dimension_safe"],
  blockers: [], ownerConfirmationRequired: true, pendingOwnerConfigurationAcknowledgementRequired: true,
  confirmationLiteral: "adopt_starter_category_playbook", authority: { canPersist: true, canConfirm: true,
    canAuthorizeAction: false, canWriteMeta: false, canPublishPolicy: false } };
const command = { planHash: "d".repeat(64), expectedRegistryHash: "b".repeat(64),
  expectedProfileRegistryHash: "c".repeat(64), targetRefs: ["dimension_safe"],
  confirmation: "adopt_starter_category_playbook", acknowledgedPendingOwnerConfiguration: true };
function request(method: "GET" | "POST", value?: unknown, headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:3000/api/starter-category-adoption", { method,
    body: value === undefined ? undefined : JSON.stringify(value), headers: { cookie: "__Host-rzka_local_session=opaque",
      "sec-fetch-site": "same-origin", "x-reklamzeka-intent": method === "GET"
        ? "starter-category-adoption-preview" : "starter-category-adoption-confirm",
      ...(method === "POST" ? { origin: "http://127.0.0.1:3000", "content-type": "application/json" } : {}), ...headers } });
}
function harness(overrides: Record<string, unknown> = {}) {
  const service = { preview: vi.fn(async () => plan), confirm: vi.fn(async () => ({ contractVersion: plan.contractVersion,
    catalogVersion: plan.catalogVersion, catalogHash: plan.catalogHash, planHash: plan.planHash,
    status: "core_adopted_with_owner_configuration_pending", pendingOwnerConfiguration: ["starter_owner_pending"],
    result: { outcome: "inserted", registryHash: "e".repeat(64), profileRegistryHash: "f".repeat(64),
      dimensionsCreated: 14, definitionsCreated: 7, profileDraftsCreated: 7, auditAppended: true,
      categoryInvalidationsAppended: 0, profileInvalidationsAppended: 0 }, authority: plan.authority })), ...overrides };
  return { service, handlers: createStarterCategoryAdoptionHttpHandlers({ service: service as never,
    resolvePrincipal: vi.fn(async () => principal) }) };
}

describe("starter category adoption HTTP", () => {
  it("serves a cookie-only no-store preview without action or Meta authority", async () => {
    const response = await harness().handlers.GET(request("GET")); const payload = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-reklamzeka-access-mode")).toBe("starter-category-owner-confirmed-core-batch");
    expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
    expect(payload).toMatchObject({ summary: { canonicalDimensions: 14 },
      authority: { canPersist: true, canAuthorizeAction: false } });
    expect(JSON.stringify(payload)).not.toContain(principal.workspaceId);
  });

  it("accepts only exact same-origin acknowledgement with bounded sorted target refs", async () => {
    const { service, handlers } = harness(); const response = await handlers.POST(request("POST", command));
    expect(response.status).toBe(200); expect(service.confirm).toHaveBeenCalledWith(principal, command);
    expect(await response.json()).toMatchObject({ status: "core_adopted_with_owner_configuration_pending" });
    for (const invalid of [{ ...command, actorId: principal.actor.userId },
      { ...command, acknowledgedPendingOwnerConfiguration: false },
      { ...command, targetRefs: ["z_ref", "a_ref"] },
      { ...command, targetRefs: Array.from({ length: 33 }, (_, index) => `dimension_${index}`) }]) {
      expect((await handlers.POST(request("POST", invalid))).status).toBe(400);
    }
    expect((await handlers.POST(request("POST", command, { origin: "https://forged.invalid" }))).status).toBe(400);
    expect((await handlers.POST(request("POST", command, { authorization: "Bearer forged" }))).status).toBe(400);
  });

  it("maps stale plans and transaction-time membership revocation to public-safe responses", async () => {
    const stale = harness({ confirm: vi.fn(async () => { throw new StarterCategoryAdoptionError("conflict"); }) });
    expect((await stale.handlers.POST(request("POST", command))).status).toBe(409);
    const revoked = harness({ confirm: vi.fn(async () => { throw new StarterCategoryAdoptionError("forbidden"); }) });
    const response = await revoked.handlers.POST(request("POST", command));
    expect(response.status).toBe(403); expect(JSON.stringify(await response.json())).not.toContain(principal.workspaceId);
  });
});
