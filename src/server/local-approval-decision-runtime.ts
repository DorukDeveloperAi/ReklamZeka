import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ApprovalDecisionService } from "@/application/approval-decision-service";
import { DrizzleActionApprovalDecisionRepository } from "@/connectors/actions/action-approval-decision-drizzle-repository";
import * as schema from "@/db/schema";
import { SingleUseHumanPresenceChallengeStore } from "@/security/human-presence-challenge";
import {
  approvalDecisionNotConfiguredResponse,
  createApprovalDecisionPostHandler,
  createHumanPresenceChallengePostHandler,
} from "@/server/approval-decision-http";
import {
  resolveTrustedLocalApprovalDecisionPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";

type Database = NodePgDatabase<typeof schema>;
type LocalDecisionDatabase = Pick<Database, "execute" | "transaction">;

export type TrustedHumanPresenceCeremony = Readonly<{
  confirm(input: Readonly<{
    request: Request;
    workspaceId: string;
    actorRef: string;
    unitRef: string;
    action: "approve" | "reject" | "request_changes";
  }>): Promise<boolean>;
}>;

/**
 * Runtime composition for the two-step local decision ceremony. The challenge
 * store is intentionally process-local, so a restart invalidates every
 * outstanding proof. Callers must inject an actual OS/WebAuthn/TTY ceremony;
 * no permissive default exists.
 */
export function createLocalApprovalDecisionRouteHandlers(input: Readonly<{
  database: LocalDecisionDatabase;
  config: LocalDecisionRoomConfig;
  ceremony: TrustedHumanPresenceCeremony;
  challengeStore?: SingleUseHumanPresenceChallengeStore;
}>) {
  const store = input.challengeStore ?? new SingleUseHumanPresenceChallengeStore();
  const repository = new DrizzleActionApprovalDecisionRepository(input.database, input.config.workspaceId);
  const service = new ApprovalDecisionService(repository, store);
  const resolve = (request: Request, _requiredScope: "approval_queue:decide") =>
    resolveTrustedLocalApprovalDecisionPrincipal({ request, database: input.database, config: input.config });
  const challenge = createHumanPresenceChallengePostHandler({
    store,
    origin: input.config.origin,
    resolveDecisionContext: resolve,
    confirmHumanPresence: (binding) => input.ceremony.confirm(binding),
  });
  const decide = createApprovalDecisionPostHandler({ service, origin: input.config.origin, resolveDecisionContext: resolve });
  return Object.freeze({
    POST: (request: Request) => request.headers.get("x-reklamzeka-intent") === "approval-queue-confirm-human-presence"
      ? challenge(request)
      : decide(request),
  });
}

export { approvalDecisionNotConfiguredResponse };
