import type { DecisionRoomExecutionResult, DecisionRoomExecutor } from "@/domain/decisions/executor";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const DECISION_ROOM_DRY_RUN_VERSION = "decision-room-dry-run/1.0.0" as const;

export type DecisionRoomDryRunErrorCode = "invalid_input" | "forbidden" | "execution_failed";

export class DecisionRoomDryRunError extends Error {
  constructor(readonly code: DecisionRoomDryRunErrorCode) {
    super(`Decision Room dry-run reddedildi: ${code}`);
    this.name = "DecisionRoomDryRunError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new DecisionRoomDryRunError("invalid_input");
  }
}

function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)
    || /(token|secret|prompt|raw[_-]?(payload|request|response|json)|authority)/i.test(value)) {
    throw new DecisionRoomDryRunError("invalid_input");
  }
  return value;
}

/** Server-bound, advisory-only manual analysis trigger. It cannot select a tenant or carry action authority. */
export class DecisionRoomDryRunService {
  constructor(
    private readonly executor: Pick<DecisionRoomExecutor, "execute">,
    private readonly memberships: readonly WorkspaceMembership[],
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(principal: TrustedDecisionRoomPrincipal, input: Readonly<{
    requestRef: string;
    accountRef: string;
    campaignRef: string;
    timeframeRef: string;
    templateRef: string;
  }>): Promise<Readonly<{
    contractVersion: typeof DECISION_ROOM_DRY_RUN_VERSION;
    execution: DecisionRoomExecutionResult;
    authority: Readonly<{ metaWrite: false; actionExecution: false; approval: false }>;
  }>> {
    exact(principal, ["actor", "workspaceId", "workspaceRef", "readerRef"]);
    exact(principal.actor, ["userId"]);
    exact(input, ["requestRef", "accountRef", "campaignRef", "timeframeRef", "templateRef"]);
    try {
      authorizeWorkspace(principal.actor, principal.workspaceId, "data:read", this.memberships);
    } catch {
      throw new DecisionRoomDryRunError("forbidden");
    }
    const requestedAt = this.clock();
    if (!Number.isFinite(requestedAt.getTime())) throw new DecisionRoomDryRunError("execution_failed");
    try {
      const execution = await this.executor.execute({
        version: "decision-room-executor/1.0.0",
        trigger: { kind: "manual", requestRef: ref(input.requestRef), requestedByRef: ref(principal.readerRef) },
        requestedAt: requestedAt.toISOString(),
        workspaceRef: ref(principal.workspaceRef),
        accountRef: ref(input.accountRef),
        campaignRef: ref(input.campaignRef),
        timeframeRef: ref(input.timeframeRef),
        templateRef: ref(input.templateRef),
        notificationChannel: "in_app_inbox",
      });
      if (execution.actionAuthority !== "none") throw new Error("authority mismatch");
      return Object.freeze({ contractVersion: DECISION_ROOM_DRY_RUN_VERSION, execution,
        authority: Object.freeze({ metaWrite: false, actionExecution: false, approval: false }) });
    } catch (error) {
      if (error instanceof DecisionRoomDryRunError) throw error;
      throw new DecisionRoomDryRunError("execution_failed");
    }
  }
}
