import { describe, expect, it, vi } from "vitest";
import { createBusinessOutcomeSignalHttpHandler } from "@/server/business-outcome-signal-http";
const principal = { actor: { userId: "11111111-1111-4111-8111-111111111111" }, workspaceId: "22222222-2222-4222-8222-222222222222", workspaceRef: "workspace_primary", readerRef: "reader_primary" } as const;
const command = { source: { kind: "manual", sourceRef: "source_outcomes", contentHash: "a".repeat(64), observedAt: "2026-08-10T09:00:00.000Z" }, signals: [{ signalRef: "signal_lead", entityRef: "campaign_primary", occurredAt: "2026-08-09T09:00:00.000Z", outcome: "qualified_lead", quantity: 1, valueMinor: null, currency: null, metaEntityRef: null, mappingStatus: "unmapped" }] };
function request(body: unknown) { return new Request("http://localhost:3000/api/business-outcomes", { method: "POST", body: JSON.stringify(body), headers: { host: "localhost:3000", cookie: "__Host-rzka_local_session=capability", origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "business-outcome-record", "content-type": "application/json" } }); }
describe("business outcome signal HTTP", () => {
  it("only accepts canonical source/signals and emits no action or Meta authority", async () => {
    const record = vi.fn(async () => ({ batchId: "outcome_batch_aaaaaaaaaaaaaaaaaaaaaaaa", outcome: "inserted", summary: { metaProxyEligible: false }, authority: { canRecordEvidence: true, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, metaProxyEligible: false } }));
    const POST = createBusinessOutcomeSignalHttpHandler({ service: { record } as never, resolvePrincipal: async () => principal });
    const response = await POST(request(command)); expect(response.status).toBe(201); expect(response.headers.get("X-ReklamZeka-Action-Authority")).toBe("none"); expect(record).toHaveBeenCalledWith(principal, command);
  });
  it("rejects raw payload, caller identity and forged authority keys", async () => {
    const record = vi.fn(); const POST = createBusinessOutcomeSignalHttpHandler({ service: { record } as never, resolvePrincipal: async () => principal });
    expect((await POST(request({ ...command, rawCsv: "email,phone", workspaceId: "forged", actionAuthority: "execute" }))).status).toBe(400); expect(record).not.toHaveBeenCalled();
  });
});
