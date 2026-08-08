import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  BudgetLabReadError,
  type BudgetLabDetailResult,
  type BudgetLabListResult,
  type BudgetLabReadService,
} from "@/application/budget-lab-read-service";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";
import type { BudgetLabDraftCommand, BudgetLabDraftResult, BudgetLabDraftService } from "@/application/budget-lab-draft-service";

export const BUDGET_LAB_AGENT_CONTRACT_VERSION = "budget-lab-agent-tools/1.0.0" as const;

export type BudgetLabAgentCall =
  | Readonly<{ name: "budget_lab_list"; arguments: Readonly<{ limit?: number; cursor?: string | null }> }>
  | Readonly<{ name: "budget_lab_get"; arguments: Readonly<{ seriesRef: string; revision?: number }> }>
  | Readonly<{ name: "budget_lab_dry_run" | "budget_lab_save_draft"; arguments: Readonly<{ command: BudgetLabDraftCommand }> }>;

const READ_AUTHORITY = Object.freeze({ source: "server_bound_workspace" as const, draft: false as const,
  persistence: false as const, approval: false as const, execution: false as const, metaWrite: false as const });

function exact(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) throw new BudgetLabReadError("invalid_input");
}

export class BudgetLabAgentContract {
  constructor(private readonly service: BudgetLabReadService, private readonly memberships: readonly WorkspaceMembership[],
    private readonly drafts?: BudgetLabDraftService, private readonly now: () => Date = () => new Date()) {}

  async execute(principal: TrustedDecisionRoomPrincipal, call: BudgetLabAgentCall): Promise<Readonly<{
    contractVersion: typeof BUDGET_LAB_AGENT_CONTRACT_VERSION;
    result: BudgetLabListResult | BudgetLabDetailResult | BudgetLabDraftResult;
    authority: Readonly<{ source: "server_bound_workspace"; draft: boolean; persistence: boolean;
      approval: false; execution: false; metaWrite: false }>;
  }>> {
    exact(principal, ["actor", "workspaceId", "workspaceRef", "readerRef"]);
    exact(principal.actor, ["userId"]);
    exact(call, ["name", "arguments"]);
    if (!["budget_lab_list", "budget_lab_get", "budget_lab_dry_run", "budget_lab_save_draft"].includes(call.name)) throw new BudgetLabReadError("invalid_input");
    const drafting = call.name === "budget_lab_dry_run" || call.name === "budget_lab_save_draft";
    authorizeWorkspace(principal.actor, principal.workspaceId, drafting ? "budget:draft" : "data:read", this.memberships);
    exact(call.arguments, call.name === "budget_lab_list" ? ["limit", "cursor"] : call.name === "budget_lab_get" ? ["seriesRef", "revision"] : ["command"]);
    if (drafting && !this.drafts) throw new BudgetLabReadError("source_unavailable");
    const result = call.name === "budget_lab_list"
      ? await this.service.list({ workspaceId: principal.workspaceId, ...call.arguments })
      : call.name === "budget_lab_get" ? await this.service.get({ workspaceId: principal.workspaceId, ...call.arguments })
        : call.name === "budget_lab_dry_run" ? await this.drafts!.dryRun(principal.workspaceId, call.arguments.command)
          : await this.drafts!.saveDraft(principal.workspaceId, principal.actor.userId, this.now().toISOString(), call.arguments.command);
    const authority = drafting ? Object.freeze({ source: "server_bound_workspace" as const, draft: true,
      persistence: call.name === "budget_lab_save_draft", approval: false as const, execution: false as const, metaWrite: false as const })
      : READ_AUTHORITY;
    return Object.freeze({ contractVersion: BUDGET_LAB_AGENT_CONTRACT_VERSION, result, authority });
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
  Object.freeze({
    name: "budget_lab_dry_run",
    description: "Compose a deterministic budget draft without proposal/audit persistence, approval, execution, or Meta access.",
    inputSchema: Object.freeze({ type: "object", additionalProperties: false, required: ["command"], properties: Object.freeze({
      command: Object.freeze({ type: "object", description: "Strict BudgetProposalInput without workspaceId; raw Graph payloads are not accepted." }),
    }) }),
  }),
  Object.freeze({
    name: "budget_lab_save_draft",
    description: "Persist an explicit append-only budget draft and audit event; it does not approve or execute it.",
    inputSchema: Object.freeze({ type: "object", additionalProperties: false, required: ["command"], properties: Object.freeze({
      command: Object.freeze({ type: "object", description: "Strict BudgetProposalInput without workspaceId; raw Graph payloads are not accepted." }),
    }) }),
  }),
]);
