import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  PolicyBundleStudioError,
  type PolicyBundleStudioResult,
  type PolicyBundleStudioService,
} from "@/application/policy-bundle-studio-service";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const POLICY_BUNDLE_AGENT_CONTRACT_VERSION = "policy-bundle-agent-tools/1.0.0" as const;

export type PolicyBundleAgentCall = Readonly<{
  name: "policy_bundle_read";
  arguments: Readonly<Record<never, never>>;
}>;

export type PolicyBundleAgentAuthority = Readonly<{
  source: "server_bound_workspace";
  readOnly: true;
  canDraft: false;
  canPublish: false;
  canDisable: false;
  canApproveAction: false;
  canGrant: false;
  canExecute: false;
  canWriteMeta: false;
}>;

export type PolicyBundleAgentReadResult = Readonly<
  Omit<PolicyBundleStudioResult, "authority"> & { authority: PolicyBundleAgentAuthority }
>;

export type PolicyBundleAgentResult = Readonly<{
  contractVersion: typeof POLICY_BUNDLE_AGENT_CONTRACT_VERSION;
  result: PolicyBundleAgentReadResult;
  authority: PolicyBundleAgentAuthority;
}>;

const AUTHORITY = Object.freeze({
  source: "server_bound_workspace" as const,
  readOnly: true as const,
  canDraft: false as const,
  canPublish: false as const,
  canDisable: false as const,
  canApproveAction: false as const,
  canGrant: false as const,
  canExecute: false as const,
  canWriteMeta: false as const,
});

function exact(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new PolicyBundleStudioError("invalid_input");
  }
}

/**
 * Vendor-neutral read boundary for Codex, Claude Code, or another local tool
 * broker. It deliberately calls the same studio read service as the dashboard,
 * then replaces the dashboard role authority with a read-only agent envelope.
 */
export class PolicyBundleAgentContract {
  constructor(
    private readonly service: Pick<PolicyBundleStudioService, "list">,
    private readonly memberships: readonly WorkspaceMembership[],
  ) {}

  async execute(principal: TrustedDecisionRoomPrincipal, call: PolicyBundleAgentCall): Promise<PolicyBundleAgentResult> {
    exact(principal, ["actor", "workspaceId", "workspaceRef", "readerRef"]);
    exact(principal.actor, ["userId"]);
    authorizeWorkspace(principal.actor, principal.workspaceId, "policy_bundle:read", this.memberships);
    exact(call, ["name", "arguments"]);
    if (call.name !== "policy_bundle_read") throw new PolicyBundleStudioError("invalid_input");
    exact(call.arguments, []);

    const studio = await this.service.list(principal);
    const result: PolicyBundleAgentReadResult = Object.freeze({
      contractVersion: studio.contractVersion,
      approvalPolicies: studio.approvalPolicies,
      guardrails: studio.guardrails,
      scopeCatalog: studio.scopeCatalog,
      readiness: studio.readiness,
      authority: AUTHORITY,
    });
    return Object.freeze({
      contractVersion: POLICY_BUNDLE_AGENT_CONTRACT_VERSION,
      result,
      authority: AUTHORITY,
    });
  }
}

export const POLICY_BUNDLE_AGENT_TOOLS = Object.freeze([Object.freeze({
  name: "policy_bundle_read",
  description: "Read the K4 policy-bundle revision feed, server catalog, and selection-aware readiness for the server-bound workspace. This tool cannot draft, publish, approve, grant, execute, or write Meta.",
  inputSchema: Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: Object.freeze({}),
  }),
})]);
