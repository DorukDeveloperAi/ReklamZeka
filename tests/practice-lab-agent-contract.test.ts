import { describe, expect, it, vi } from "vitest";
import { PracticeLabAgentContract, PRACTICE_LAB_AGENT_TOOLS } from "@/application/practice-lab-agent-contract";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const principal = {
  actor: { userId: "22222222-2222-4222-a222-222222222222" },
  workspaceId, workspaceRef: "workspace_alpha", readerRef: "reader_owner",
};
const membership = { userId: principal.actor.userId, workspaceId, role: "owner" as const };

describe("Practice Lab model-agnostic agent contract", () => {
  it("binds workspace server-side and exposes read/ephemeral-draft tools only", async () => {
    const list = vi.fn(async () => ({ contractVersion: "practice-lab-read-model/1.0.0", view: "list", items: [], nextCursor: null, authority: {} }));
    const get = vi.fn();
    const prepareDraft = vi.fn();
    const contract = new PracticeLabAgentContract({ list, get, prepareDraft } as never, [membership]);
    const result = await contract.execute(principal, { name: "practice_lab_list", arguments: { limit: 10 } });
    expect(list).toHaveBeenCalledWith({ workspaceRef: "workspace_alpha", limit: 10, cursor: undefined });
    expect(result.authority).toEqual({
      source: "server_bound_workspace", persistence: false, policyPromotion: false,
      automation: false, metaWrite: false, actionExecution: false,
    });
    expect(PRACTICE_LAB_AGENT_TOOLS.map((tool) => tool.name)).toEqual([
      "practice_lab_list", "practice_lab_get", "practice_lab_prepare_draft",
    ]);
    expect(JSON.stringify(PRACTICE_LAB_AGENT_TOOLS)).not.toMatch(/approve|execute_write|promote_policy/);
  });

  it("rejects a caller-selected workspace or unknown tool", async () => {
    const contract = new PracticeLabAgentContract({} as never, [membership]);
    await expect(contract.execute(principal, {
      name: "practice_lab_list", arguments: { workspaceRef: "workspace_foreign" },
    } as never)).rejects.toEqual(expect.objectContaining({ code: "invalid_input" }));
    await expect(contract.execute(principal, {
      name: "practice_lab_promote_policy", arguments: { practiceRef: "practice_alpha" },
    } as never)).rejects.toEqual(expect.objectContaining({ code: "invalid_input" }));
  });
});
