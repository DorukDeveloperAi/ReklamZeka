import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  BudgetLabReadError,
  type BudgetLabDetailResult,
  type BudgetLabListResult,
  type BudgetLabReadService,
} from "@/application/budget-lab-read-service";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const BUDGET_LAB_AGENT_CONTRACT_VERSION = "budget-lab-agent-tools/1.0.0" as const;

export type BudgetLabAgentCall =
  | Readonly<{ name: "budget_lab_list"; arguments: Readonly<{ limit?: number; cursor?: string | null }> }>
  | Readonly<{ name: "budget_lab_get"; arguments: Readonly<{ seriesRef: string; revision?: number }> }>;

const AUTHORITY = Object.freeze({ source: "server_bound_workspace" as const, draft: false as const,
  approval: false as const, execution: false as const, metaWrite: false as const });

function exact(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) throw new BudgetLabReadError("invalid_input");
}

export class BudgetLabAgentContract {
  constructor(private readonly service: BudgetLabReadService, private readonly memberships: readonly WorkspaceMembership[]) {}

  async execute(principal: TrustedDecisionRoomPrincipal, call: BudgetLabAgentCall): Promise<Readonly<{
    contractVersion: typeof BUDGET_LAB_AGENT_CONTRACT_VERSION;
    result: BudgetLabListResult | BudgetLabDetailResult;
    authority: typeof AUTHORITY;
  }>> {
    exact(principal, ["actor", "workspaceId", "workspaceRef", "readerRef"]);
    exact(principal.actor, ["userId"]);
    authorizeWorkspace(principal.actor, principal.workspaceId, "data:read", this.memberships);
    exact(call, ["name", "arguments"]);
    if (call.name !== "budget_lab_list" && call.name !== "budget_lab_get") throw new BudgetLabReadError("invalid_input");
    exact(call.arguments, call.name === "budget_lab_list" ? ["limit", "cursor"] : ["seriesRef", "revision"]);
    const result = call.name === "budget_lab_list"
      ? await this.service.list({ workspaceId: principal.workspaceId, ...call.arguments })
      : await this.service.get({ workspaceId: principal.workspaceId, ...call.arguments });
    return Object.freeze({ contractVersion: BUDGET_LAB_AGENT_CONTRACT_VERSION, result, authority: AUTHORITY });
  }
}

export const BUDGET_LAB_AGENT_TOOLS = Object.freeze([
  Object.freeze({
    name: "budget_lab_list",
    description: "List tenant-bound deterministic budget proposals using only public-safe summaries.",
    inputSchema: Object.freeze({ type: "object", additionalProperties: false, properties: Object.freeze({
      limit: Object.freeze({ type: "integer", minimum: 1, maximum: 100 }),
      cursor: Object.freeze({ type: ["string", "null"] }),
    }) }),
  }),
  Object.freeze({
    name: "budget_lab_get",
    description: "Read one public-safe budget proposal revision; never draft, approve, execute, or call Meta.",
    inputSchema: Object.freeze({ type: "object", additionalProperties: false, required: ["seriesRef"], properties: Object.freeze({
      seriesRef: Object.freeze({ type: "string", pattern: "^[a-z][a-z0-9_.:-]{0,127}$" }),
      revision: Object.freeze({ type: "integer", minimum: 1 }),
    }) }),
  }),
]);
