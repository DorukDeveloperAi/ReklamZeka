import { describe, expect, it, vi } from "vitest";
import { BudgetLabAgentContract } from "@/application/budget-lab-agent-contract";
import { BudgetLabReadService, type BudgetLabRepository } from "@/application/budget-lab-read-service";
import { GET as disabledGet } from "@/app/api/budget-lab/route";
import { budgetLabNotConfiguredResponse, createBudgetLabHttpHandler, createBudgetLabPostHandler } from "@/server/budget-lab-http";

const principal = { actor: { userId: "user_owner" }, workspaceId: "11111111-1111-4111-a111-111111111111", workspaceRef: "workspace_safe", readerRef: "reader_owner" } as const;

function handler(repository: BudgetLabRepository = { listPublic: async () => [], loadPublic: async () => { throw Object.assign(new Error(), { code: "not_found" }); } }) {
  const resolvePrincipal = vi.fn(async () => principal);
  const contract = new BudgetLabAgentContract(new BudgetLabReadService(repository), [{ userId: "user_owner", workspaceId: principal.workspaceId, role: "viewer" }]);
  return { resolvePrincipal, GET: createBudgetLabHttpHandler({ contract, resolvePrincipal }) };
}

describe("Budget Lab HTTP boundary", () => {
  it("accepts only bounded GET list/detail and exposes no action authority", async () => {
    const api = handler();
    const response = await api.GET(new Request("http://localhost/api/budget-lab?view=list&limit=25"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("x-reklamzeka-access-mode")).toBe("read-only");
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(await response.json()).toMatchObject({ result: { view: "list", items: [] }, authority: { draft: false, approval: false, execution: false, metaWrite: false } });
  });

  it("rejects caller-supplied workspace identity and malformed combinations before principal resolution", async () => {
    const api = handler();
    for (const url of [
      "http://localhost/api/budget-lab?workspaceId=11111111-1111-4111-a111-111111111111",
      "http://localhost/api/budget-lab?view=detail&seriesRef=budget.series&limit=1",
      "http://localhost/api/budget-lab?view=list&revision=1",
    ]) expect((await api.GET(new Request(url))).status).toBe(400);
    expect(api.resolvePrincipal).not.toHaveBeenCalled();
  });

  it("fails closed when route assembly is absent", async () => {
    for (const response of [disabledGet(), budgetLabNotConfiguredResponse()]) {
      expect(response.status).toBe(503);
      expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
      expect(await response.json()).toEqual({ error: { code: "source_not_configured", message: "Budget Lab çalışma alanı ve yerel kimlik bağlama katmanı henüz etkin değil." } });
    }
  });

  it("accepts only exact explicit draft intents and bounded JSON", async () => {
    const execute = vi.fn(async (_principal, call) => ({ result: { mode: call.name === "budget_lab_dry_run" ? "dry_run" : "saved_draft" } }));
    const resolvePrincipal = vi.fn(async () => principal);
    const POST = createBudgetLabPostHandler({ contract: { execute } as never, resolvePrincipal });
    const valid = await POST(new Request("http://localhost/api/budget-lab", { method: "POST", headers: {
      "Content-Type": "application/json", "X-ReklamZeka-Intent": "budget-lab-dry-run",
    }, body: JSON.stringify({ command: { seriesRef: "budget.series" } }) }));
    expect(valid.status).toBe(200);
    expect(valid.headers.get("x-reklamzeka-access-mode")).toBe("draft-only");
    expect(execute).toHaveBeenCalledWith(principal, expect.objectContaining({ name: "budget_lab_dry_run" }));

    for (const request of [
      new Request("http://localhost/api/budget-lab", { method: "POST", headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "execute" }, body: "{}" }),
      new Request("http://localhost/api/budget-lab", { method: "POST", headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "budget-lab-save-draft" }, body: JSON.stringify({ command: {}, rawGraphPayload: {} }) }),
      new Request("http://localhost/api/budget-lab", { method: "POST", headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "budget-lab-save-draft" }, body: JSON.stringify({ command: null }) }),
      new Request("http://localhost/api/budget-lab", { method: "POST", headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "budget-lab-save-draft" }, body: "{" }),
      new Request("http://localhost/api/budget-lab", { method: "POST", headers: { "Content-Type": "text/plain", "X-ReklamZeka-Intent": "budget-lab-save-draft" }, body: "{}" }),
    ]) expect((await POST(request)).status).toBe(400);
  });
});
