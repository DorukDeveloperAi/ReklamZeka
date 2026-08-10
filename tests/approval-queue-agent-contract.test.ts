import { describe, expect, it, vi } from "vitest";
import { APPROVAL_QUEUE_AGENT_TOOLS, ApprovalQueueAgentContract } from "@/application/approval-queue-agent-contract";
import { ApprovalQueueReadService } from "@/application/approval-queue-read-service";
import { AuthorizationError } from "@/security/authorization";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const principal = { actor: { userId: "viewer" }, workspaceId, workspaceRef: "workspace_public", readerRef: "reader_public" } as const;

function contract(boundWorkspace = workspaceId) {
  const repository = { list: vi.fn(async () => []), get: vi.fn(async () => null) };
  return { repository, contract: new ApprovalQueueAgentContract(new ApprovalQueueReadService(repository), [
    { userId: "viewer", workspaceId: boundWorkspace, role: "viewer" },
  ]) };
}

describe("Approval Queue model-agnostic agent contract", () => {
  it("allows viewer reads and always returns an authority-none envelope", async () => {
    const h = contract();
    const result = await h.contract.execute(principal, { name: "approval_queue_list", arguments: { limit: 10 } });
    expect(result).toMatchObject({ result: { view: "list", items: [] }, authority: {
      readOnly: true, canApprove: false, canReject: false, canRequestChanges: false,
      canGrant: false, canExecute: false, canWriteMeta: false,
    } });
    expect(h.repository.list).toHaveBeenCalledWith({ workspaceId, entityRef: null, before: null, limit: 11 });
  });

  it("binds workspace to the trusted principal and rejects foreign membership", async () => {
    const h = contract("22222222-2222-4222-a222-222222222222");
    await expect(h.contract.execute(principal, { name: "approval_queue_list", arguments: {} })).rejects.toBeInstanceOf(AuthorizationError);
    expect(h.repository.list).not.toHaveBeenCalled();
  });

  it("rejects extra identity/action arguments and exposes only GET-style read tools", async () => {
    const h = contract();
    await expect(h.contract.execute(principal, { name: "approval_queue_list", arguments: { workspaceId } } as never))
      .rejects.toEqual(expect.objectContaining({ code: "invalid_input" }));
    await expect(h.contract.execute(principal, { name: "approval_queue_get", arguments: { unitRef: "action_unit_aaaaaaaaaaaaaaaaaaaa", approve: true } } as never))
      .rejects.toEqual(expect.objectContaining({ code: "invalid_input" }));
    expect(APPROVAL_QUEUE_AGENT_TOOLS.map((tool) => tool.name)).toEqual(["approval_queue_list", "approval_queue_get"]);
    expect(APPROVAL_QUEUE_AGENT_TOOLS.map((tool) => tool.name).join("|")).not.toMatch(/approve|reject|request_changes|grant|execute|write/);
  });
});
