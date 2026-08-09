import { describe, expect, it, vi } from "vitest";

import { StarterCategoryAdoptionError } from "@/application/starter-category-adoption-service";
import { createStarterCategoryAdoptionHttpHandlers } from "@/server/starter-category-adoption-http";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_starter",
  readerRef: "reader_starter" } as const;
const plan = { contractVersion: "starter-category-adoption/1.0.0", catalogVersion: "starter-category-playbooks/1.1.0",
  catalogHash: "a".repeat(64), registryHash: "b".repeat(64), planHash: "c".repeat(64), status: "preview_only",
  summary: { canonicalDimensions: 14 }, dimensionCoverage: [], categoryCommands: [], profileProposals: [], blockers: [],
  ownerConfirmationRequired: true, confirmationLiteral: "adopt_starter_category_playbook",
  authority: { canPersist: false, canConfirm: true, canAuthorizeAction: false, canWriteMeta: false, canPublishPolicy: false } };
function request(method: "GET" | "POST", value?: unknown, headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:3000/api/starter-category-adoption", { method,
    body: value === undefined ? undefined : JSON.stringify(value), headers: { cookie: "__Host-rzka_local_session=opaque",
      "sec-fetch-site": "same-origin", "x-reklamzeka-intent": method === "GET"
        ? "starter-category-adoption-preview" : "starter-category-adoption-confirm",
      ...(method === "POST" ? { origin: "http://127.0.0.1:3000", "content-type": "application/json" } : {}), ...headers } });
}
function harness(overrides: Record<string, unknown> = {}) {
  const service = { preview: vi.fn(async () => plan), confirm: vi.fn(async () => ({ ...plan, status: "blocked",
    persistenceAttempted: false, blocker: "atomic_multi_command_category_adoption_unavailable" })), ...overrides };
  return { service, handlers: createStarterCategoryAdoptionHttpHandlers({ service: service as never,
    resolvePrincipal: vi.fn(async () => principal) }) };
}

describe("starter category adoption HTTP", () => {
  it("serves a cookie-only no-store preview without raw tenant or mutation authority", async () => {
    const response = await harness().handlers.GET(request("GET")); const payload = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
    expect(payload).toMatchObject({ summary: { canonicalDimensions: 14 }, authority: { canPersist: false } });
    expect(JSON.stringify(payload)).not.toContain(principal.workspaceId);
  });

  it("accepts only exact same-origin explicit confirmation and returns a zero-write blocker", async () => {
    const command = { planHash: "c".repeat(64), expectedRegistryHash: "b".repeat(64),
      confirmation: "adopt_starter_category_playbook" };
    const { service, handlers } = harness(); const response = await handlers.POST(request("POST", command));
    expect(response.status).toBe(200); expect(service.confirm).toHaveBeenCalledWith(principal, command);
    expect(await response.json()).toMatchObject({ status: "blocked", persistenceAttempted: false });
    for (const invalid of [{ ...command, actorId: principal.actor.userId }, { ...command, confirmation: "yes" }]) {
      expect((await handlers.POST(request("POST", invalid))).status).toBe(400);
    }
    expect((await handlers.POST(request("POST", command, { origin: "https://forged.invalid" }))).status).toBe(400);
    expect((await handlers.POST(request("POST", command, { authorization: "Bearer forged" }))).status).toBe(400);
  });

  it("maps stale plans to public-safe conflict", async () => {
    const { handlers } = harness({ confirm: vi.fn(async () => { throw new StarterCategoryAdoptionError("conflict"); }) });
    const response = await handlers.POST(request("POST", { planHash: "c".repeat(64),
      expectedRegistryHash: "b".repeat(64), confirmation: "adopt_starter_category_playbook" }));
    expect(response.status).toBe(409); expect(JSON.stringify(await response.json())).not.toContain(principal.workspaceId);
  });
});
