import { describe, expect, it, vi } from "vitest";
import { createDecisionCadenceProfileHttpHandler } from "@/server/decision-cadence-profile-http";
import { DECISION_CADENCE_VERSION } from "@/domain/decisions/cadence";

const principal = { actor: { userId: "11111111-1111-4111-8111-111111111111" }, workspaceId: "22222222-2222-4222-8222-222222222222",
  workspaceRef: "workspace_primary", readerRef: "reader_primary" } as const;
const body = { accountRef: "account_primary", campaignRef: "campaign_primary", profileRef: "cadence_primary", revision: 1,
  expectedCurrentHash: "GENESIS", profile: { version: DECISION_CADENCE_VERSION, settleHours: 24, minimumObservationHours: 12,
    minimumLearningHours: 24, cooldownHours: 24, repeatSuppressionHours: 24, frequencyWindowHours: 168, maxDecisionsPerWindow: 3,
    maxActionsPerWindow: 1, maximumHistoryEntries: 20, minimumEvidenceCount: 2, minimumEvidenceScore: 0.8 } };
function request(value: unknown = body) {
  return new Request("http://localhost:3000/api/decision-cadence", { method: "POST", body: JSON.stringify(value), headers: {
    host: "localhost:3000", cookie: "__Host-rzka_local_session=capability", origin: "http://localhost:3000",
    "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "decision-cadence-publish", "content-type": "application/json",
  } });
}

describe("decision cadence profile HTTP", () => {
  it("accepts only the profile command and exposes no action authority", async () => {
    const publish = vi.fn(async () => ({ outcome: "inserted", profileHash: "a".repeat(64), authority: { canPublishProfile: true,
      canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false } }));
    const POST = createDecisionCadenceProfileHttpHandler({ service: { publish } as never, resolvePrincipal: async () => principal });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(response.headers.get("X-ReklamZeka-Action-Authority")).toBe("none");
    await expect(response.json()).resolves.toMatchObject({ authority: { canExecute: false, canWriteMeta: false } });
    expect(publish).toHaveBeenCalledWith(principal, body);
  });

  it("rejects caller-supplied identity or authority fields before service invocation", async () => {
    const publish = vi.fn();
    const POST = createDecisionCadenceProfileHttpHandler({ service: { publish } as never, resolvePrincipal: async () => principal });
    const response = await POST(request({ ...body, workspaceId: "forged", actionAuthority: "execute" }));
    expect(response.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });
});
