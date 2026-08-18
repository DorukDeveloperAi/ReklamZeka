import { createHash } from "node:crypto";

import type { GuideMode } from "@/domain/guides/guide-revision";

export const GUIDE_AGENT_BOUNDARY_VERSION = "guide-agent-boundary/1.0.0" as const;
export const GUIDE_AGENT_KINDS = Object.freeze(["guide_policy", "daily_analysis"] as const);

export type GuideAgentKind = typeof GUIDE_AGENT_KINDS[number];
export type GuideAgentOperation =
  | "read_active_guide"
  | "read_slice_evidence"
  | "read_run_history"
  | "read_other_agent_logs"
  | "suggest_guide_revision"
  | "transfer_form_preview"
  | "analyze_member"
  | "synthesize_slice"
  | "record_finding"
  | "record_recommendation"
  | "stage_action_candidate"
  | "save_guide_revision"
  | "activate_guide_revision"
  | "approve_action"
  | "execute_action"
  | "write_meta";

export type GuideAgentDecision = Readonly<{
  version: typeof GUIDE_AGENT_BOUNDARY_VERSION;
  agentKind: GuideAgentKind;
  conversationRef: string;
  operation: GuideAgentOperation;
  decision: "allowed" | "denied" | "held";
  reason:
    | "read_only_context"
    | "ephemeral_suggestion"
    | "explicit_user_transfer_preview"
    | "run_owned_analysis"
    | "run_owned_ledger_record"
    | "mode_allows_candidate"
    | "wrong_agent"
    | "user_action_required"
    | "data_quality_hold"
    | "mode_forbids_candidate"
    | "authority_forbidden";
  persistence: "none" | "server_run_ledger";
  authority: Readonly<{
    canSaveGuide: false;
    canActivateGuide: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
  }>;
  decisionHash: string;
}>;

export class GuideAgentBoundaryError extends Error {
  constructor(readonly code: "invalid_input") {
    super(`Guide agent boundary rejected: ${code}`);
    this.name = "GuideAgentBoundaryError";
  }
}

const WORKSPACE_REF = /^workspace_[a-f0-9]{16}$/;
const USER_TRANSFER_REF = /^transfer_[a-f0-9]{24,64}$/;
const AUTHORITY = Object.freeze({ canSaveGuide: false as const, canActivateGuide: false as const,
  canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });
const READS = new Set<GuideAgentOperation>([
  "read_active_guide", "read_slice_evidence", "read_run_history", "read_other_agent_logs",
]);
const FORBIDDEN = new Set<GuideAgentOperation>([
  "save_guide_revision", "activate_guide_revision", "approve_action", "execute_action", "write_meta",
]);
const OPERATIONS = new Set<GuideAgentOperation>([
  ...READS, "suggest_guide_revision", "transfer_form_preview", "analyze_member", "synthesize_slice",
  "record_finding", "record_recommendation", "stage_action_candidate", ...FORBIDDEN,
]);

function fail(): never { throw new GuideAgentBoundaryError("invalid_input"); }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compare(left, right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function exact(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail();
}

export function guideAgentConversationRef(workspaceRef: string, agentKind: GuideAgentKind): string {
  if (!WORKSPACE_REF.test(workspaceRef) || !GUIDE_AGENT_KINDS.includes(agentKind)) fail();
  return `guide_conversation_${agentKind}_${digest({ workspaceRef, agentKind }).slice(0, 24)}`;
}

function decide(core: Omit<GuideAgentDecision, "version" | "authority" | "decisionHash">): GuideAgentDecision {
  const body = Object.freeze({ version: GUIDE_AGENT_BOUNDARY_VERSION, ...core, authority: AUTHORITY });
  return Object.freeze({ ...body, decisionHash: digest(body) });
}

/**
 * This gate authorizes only agent output classes. User/API services remain the
 * sole authority for Guide save/activation, approval and Meta execution.
 */
export function evaluateGuideAgentOperation(input: Readonly<{
  workspaceRef: string;
  agentKind: GuideAgentKind;
  operation: GuideAgentOperation;
  guideMode: GuideMode;
  dataQuality: "ready" | "partial" | "empty" | "unavailable";
  userTransferRef: string | null;
}>): GuideAgentDecision {
  exact(input, ["workspaceRef", "agentKind", "operation", "guideMode", "dataQuality", "userTransferRef"]);
  if (!WORKSPACE_REF.test(input.workspaceRef) || !GUIDE_AGENT_KINDS.includes(input.agentKind)
    || !OPERATIONS.has(input.operation)
    || !["observe_analyze", "recommend", "prepare_human_approval", "limited_autonomy"].includes(input.guideMode)
    || !["ready", "partial", "empty", "unavailable"].includes(input.dataQuality)
    || input.userTransferRef !== null && !USER_TRANSFER_REF.test(input.userTransferRef)) fail();
  const base = Object.freeze({ agentKind: input.agentKind,
    conversationRef: guideAgentConversationRef(input.workspaceRef, input.agentKind), operation: input.operation });
  if (FORBIDDEN.has(input.operation)) return decide({ ...base, decision: "denied",
    reason: "authority_forbidden", persistence: "none" });
  if (READS.has(input.operation)) return decide({ ...base, decision: "allowed",
    reason: "read_only_context", persistence: "none" });
  if (input.agentKind === "guide_policy") {
    if (input.operation === "suggest_guide_revision") return decide({ ...base, decision: "allowed",
      reason: "ephemeral_suggestion", persistence: "none" });
    if (input.operation === "transfer_form_preview") return input.userTransferRef === null
      ? decide({ ...base, decision: "denied", reason: "user_action_required", persistence: "none" })
      : decide({ ...base, decision: "allowed", reason: "explicit_user_transfer_preview", persistence: "none" });
    return decide({ ...base, decision: "denied", reason: "wrong_agent", persistence: "none" });
  }
  if (input.operation === "suggest_guide_revision" || input.operation === "transfer_form_preview") {
    return decide({ ...base, decision: "denied", reason: "wrong_agent", persistence: "none" });
  }
  if (input.operation === "analyze_member" || input.operation === "synthesize_slice") {
    return decide({ ...base, decision: "allowed", reason: "run_owned_analysis", persistence: "server_run_ledger" });
  }
  if (input.operation === "record_finding") {
    return decide({ ...base, decision: "allowed", reason: "run_owned_ledger_record", persistence: "server_run_ledger" });
  }
  if (input.operation === "record_recommendation") {
    if (input.dataQuality !== "ready") return decide({ ...base, decision: "held",
      reason: "data_quality_hold", persistence: "server_run_ledger" });
    if (input.guideMode === "observe_analyze") return decide({ ...base, decision: "denied",
      reason: "mode_forbids_candidate", persistence: "server_run_ledger" });
    return decide({ ...base, decision: "allowed", reason: "run_owned_ledger_record", persistence: "server_run_ledger" });
  }
  if (input.operation === "stage_action_candidate") {
    if (input.dataQuality !== "ready") return decide({ ...base, decision: "held",
      reason: "data_quality_hold", persistence: "server_run_ledger" });
    if (input.guideMode !== "prepare_human_approval" && input.guideMode !== "limited_autonomy") {
      return decide({ ...base, decision: "denied", reason: "mode_forbids_candidate", persistence: "server_run_ledger" });
    }
    return decide({ ...base, decision: "allowed", reason: "mode_allows_candidate", persistence: "server_run_ledger" });
  }
  return fail();
}
