import {
  PracticeLabReadError,
  type PracticeLabDetailResult,
  type PracticeLabDraftResult,
  type PracticeLabListResult,
  type PracticeLabReadService,
} from "@/application/practice-lab-read-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const PRACTICE_LAB_AGENT_CONTRACT_VERSION = "practice-lab-agent-tools/1.0.0" as const;

export type PracticeLabAgentCall =
  | Readonly<{ name: "practice_lab_list"; arguments: Readonly<{ limit?: number; cursor?: string | null }> }>
  | Readonly<{ name: "practice_lab_get" | "practice_lab_prepare_draft"; arguments: Readonly<{ practiceRef: string }> }>;

export type PracticeLabAgentResult = Readonly<{
  contractVersion: typeof PRACTICE_LAB_AGENT_CONTRACT_VERSION;
  result: PracticeLabListResult | PracticeLabDetailResult | PracticeLabDraftResult;
  authority: Readonly<{
    source: "server_bound_workspace";
    persistence: false;
    policyPromotion: false;
    automation: false;
    metaWrite: false;
    actionExecution: false;
  }>;
}>;

const AUTHORITY = Object.freeze({
  source: "server_bound_workspace" as const,
  persistence: false as const,
  policyPromotion: false as const,
  automation: false as const,
  metaWrite: false as const,
  actionExecution: false as const,
});

function exactKeys(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) throw new PracticeLabReadError("invalid_input");
}

export class PracticeLabAgentContract {
  constructor(
    private readonly service: PracticeLabReadService,
    private readonly memberships: readonly WorkspaceMembership[],
  ) {}

  async execute(principal: TrustedDecisionRoomPrincipal, call: PracticeLabAgentCall): Promise<PracticeLabAgentResult> {
    exactKeys(principal, ["actor", "workspaceId", "workspaceRef", "readerRef"]);
    exactKeys(principal.actor, ["userId"]);
    authorizeWorkspace(principal.actor, principal.workspaceId, "data:read", this.memberships);
    exactKeys(call, ["name", "arguments"]);
    if (!["practice_lab_list", "practice_lab_get", "practice_lab_prepare_draft"].includes(call.name)) {
      throw new PracticeLabReadError("invalid_input");
    }
    exactKeys(call.arguments, call.name === "practice_lab_list" ? ["limit", "cursor"] : ["practiceRef"]);
    const result = call.name === "practice_lab_list"
      ? await this.service.list({
        workspaceRef: principal.workspaceRef,
        limit: call.arguments.limit,
        cursor: call.arguments.cursor,
      })
      : call.name === "practice_lab_get"
        ? await this.service.get({ workspaceRef: principal.workspaceRef, practiceRef: call.arguments.practiceRef })
        : await this.service.prepareDraft({ workspaceRef: principal.workspaceRef, practiceRef: call.arguments.practiceRef });
    return Object.freeze({ contractVersion: PRACTICE_LAB_AGENT_CONTRACT_VERSION, result, authority: AUTHORITY });
  }
}

export const PRACTICE_LAB_AGENT_TOOLS = Object.freeze([
  Object.freeze({
    name: "practice_lab_list",
    description: "List server-bound advised practices without database, Meta, owner, or evidence identifiers.",
    inputSchema: Object.freeze({
      type: "object", additionalProperties: false,
      properties: Object.freeze({
        limit: Object.freeze({ type: "integer", minimum: 1, maximum: 100 }),
        cursor: Object.freeze({ type: ["string", "null"] }),
      }),
    }),
  }),
  Object.freeze({
    name: "practice_lab_get",
    description: "Read one public-safe advised-practice detail and lifecycle projection.",
    inputSchema: Object.freeze({
      type: "object", additionalProperties: false, required: ["practiceRef"],
      properties: Object.freeze({ practiceRef: Object.freeze({ type: "string", pattern: "^practice_[a-z0-9][a-z0-9_-]{0,86}$" }) }),
    }),
  }),
  Object.freeze({
    name: "practice_lab_prepare_draft",
    description: "Prepare an ephemeral human-review conversation brief; it does not persist, promote, automate, or authorize anything.",
    inputSchema: Object.freeze({
      type: "object", additionalProperties: false, required: ["practiceRef"],
      properties: Object.freeze({ practiceRef: Object.freeze({ type: "string", pattern: "^practice_[a-z0-9][a-z0-9_-]{0,86}$" }) }),
    }),
  }),
]);
