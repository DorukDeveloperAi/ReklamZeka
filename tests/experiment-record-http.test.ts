import { describe, expect, it, vi } from "vitest";
import { createExperimentRecordHttpHandler } from "@/server/experiment-record-http";
import { EXPERIMENT_CONTRACT_VERSION } from "@/domain/decisions/cadence";
const principal = { actor: { userId: "11111111-1111-4111-8111-111111111111" }, workspaceId: "22222222-2222-4222-822222222222",
  workspaceRef: "workspace_primary", readerRef: "reader_primary" } as const;
const command = { operation: "plan", accountRef: "account_primary", campaignRef: "campaign_primary", cadenceProfileRevisionId: "33333333-3333-4333-8333-333333333333",
  plan: { version: EXPERIMENT_CONTRACT_VERSION, hypothesis: "Offer improves quality", primaryMetric: "qualified_lead_rate", desiredDirection: "increase",
    primaryVariable: "offer", changedVariables: ["offer"], baselineRef: "baseline_primary", guardrailMetrics: ["cpl"],
    stopConditions: ["guardrail_breach", "contamination"], minimumSampleSize: 10, minimumWindowHours: 24, minimumEvidenceScore: 0.7, minimumDetectableEffect: 0.05 } };
function request(body: unknown) { return new Request("http://localhost:3000/api/experiment-records", { method: "POST", body: JSON.stringify(body), headers: {
  host: "localhost:3000", cookie: "__Host-rzka_local_session=capability", origin: "http://localhost:3000", "sec-fetch-site": "same-origin",
  "x-reklamzeka-intent": "experiment-record-mutate", "content-type": "application/json" } }); }
describe("experiment record HTTP", () => {
  it("admits a strictly shaped advisory evidence command only", async () => {
    const mutate = vi.fn(async () => ({ experimentRef: "experiment_aaaaaaaaaaaaaaaaaaaa", recordHash: "a".repeat(64), outcome: "inserted",
      authority: { canRecordEvidence: true, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } }));
    const POST = createExperimentRecordHttpHandler({ service: { mutate } as never, resolvePrincipal: async () => principal });
    const response = await POST(request(command));
    expect(response.status).toBe(201); expect(response.headers.get("X-ReklamZeka-Action-Authority")).toBe("none");
    expect(mutate).toHaveBeenCalledWith(principal, command);
  });
  it("rejects caller-supplied tenant or action authority fields", async () => {
    const mutate = vi.fn(); const POST = createExperimentRecordHttpHandler({ service: { mutate } as never, resolvePrincipal: async () => principal });
    expect((await POST(request({ ...command, workspaceId: "forged", actionAuthority: "execute" }))).status).toBe(400);
    expect(mutate).not.toHaveBeenCalled();
  });
});
