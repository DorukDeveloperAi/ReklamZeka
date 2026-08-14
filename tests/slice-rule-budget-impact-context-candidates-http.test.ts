import { describe, expect, it, vi } from "vitest";
import { createSliceRuleBudgetImpactContextCandidatesHttpHandler } from "@/server/slice-rule-budget-impact-context-candidates-http";

const principal = { workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_local", readerRef: "reader_local", actor: { userId: "22222222-2222-4222-8222-222222222222" } } as const;
function request(seriesRef = "slice_rule.ftr", intent = "slice-rule-budget-impact-context-candidates-read") { return new Request(`http://localhost:3000/api/slice-rule-budget-impact-context-candidates?seriesRef=${seriesRef}`, { headers: { cookie: "session=bound", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": intent } }); }
describe("opaque budget impact context candidate HTTP boundary", () => {
  it("uses only the session-bound principal and closed headers", async () => {
    const list = vi.fn(async () => ({ contractVersion: "slice-rule-budget-impact-context-candidates/1.0.0", seriesRef: "slice_rule.ftr", candidates: [], authority: { canPreview: false, canSave: false, canApprove: false, canExecute: false, canWriteMeta: false } }));
    const response = await createSliceRuleBudgetImpactContextCandidatesHttpHandler({ service: { list } as never, resolvePrincipal: async () => principal })(request());
    expect(response.status).toBe(200); expect(list).toHaveBeenCalledWith(principal, "slice_rule.ftr"); expect(response.headers.get("X-ReklamZeka-Meta-Write")).toBe("disabled");
  });
  it("rejects malformed query and wrong intent before service access", async () => {
    const list = vi.fn(); const handler = createSliceRuleBudgetImpactContextCandidatesHttpHandler({ service: { list } as never, resolvePrincipal: async () => principal });
    expect((await handler(request("slice rule", "bad"))).status).toBe(400); expect(list).not.toHaveBeenCalled();
  });
});
