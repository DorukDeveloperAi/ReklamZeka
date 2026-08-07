import { describe, expect, it, vi } from "vitest";
import { BudgetLabAgentContract } from "@/application/budget-lab-agent-contract";
import { BudgetLabReadService } from "@/application/budget-lab-read-service";
import { AuthorizationError } from "@/security/authorization";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const command = { scope: {}, seriesRef: "x" } as never;

function contract(role: "owner" | "admin" | "analyst" | "viewer") {
  const drafts = { dryRun: vi.fn(async () => ({ mode: "dry_run" })), saveDraft: vi.fn(async () => ({ mode: "saved_draft" })) };
  return { drafts, contract: new BudgetLabAgentContract(
    new BudgetLabReadService({ listPublic: async () => [], loadPublic: async () => { throw new Error(); } }),
    [{ userId: "actor", workspaceId, role }], drafts as never, () => new Date("2026-08-07T13:00:00.000Z"),
  ) };
}

const principal = { actor: { userId: "actor" }, workspaceId, workspaceRef: "workspace_safe", readerRef: "reader_safe" } as const;

describe("Budget Lab draft agent authorization", () => {
  it.each(["owner", "admin", "analyst"] as const)("allows explicit drafts for %s", async (role) => {
    const h = contract(role);
    await h.contract.execute(principal, { name: "budget_lab_dry_run", arguments: { command } });
    await h.contract.execute(principal, { name: "budget_lab_save_draft", arguments: { command } });
    expect(h.drafts.dryRun).toHaveBeenCalledWith(workspaceId, command);
    expect(h.drafts.saveDraft).toHaveBeenCalledWith(workspaceId, "actor", "2026-08-07T13:00:00.000Z", command);
  });

  it("denies viewers before any draft call", async () => {
    const h = contract("viewer");
    await expect(h.contract.execute(principal, { name: "budget_lab_save_draft", arguments: { command } })).rejects.toBeInstanceOf(AuthorizationError);
    expect(h.drafts.saveDraft).not.toHaveBeenCalled();
  });
});
