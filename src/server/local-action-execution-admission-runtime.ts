import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ActionExecutionAdmissionService } from "@/application/action-execution-admission-service";
import { DrizzleActionExecutionAdmissionRepository } from "@/connectors/actions/action-execution-admission-drizzle-repository";
import { DrizzleActionExecutionAdmissionSourceRepository } from "@/connectors/actions/action-execution-admission-source-drizzle-repository";
import * as schema from "@/db/schema";
import { SingleUseHumanPresenceChallengeStore } from "@/security/human-presence-challenge";
import type { LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";

type Database = NodePgDatabase<typeof schema>;
type LocalDatabase = Pick<Database, "execute" | "transaction">;

/**
 * Server-private composition only. It deliberately exposes no HTTP handler,
 * transport, scheduler, or Meta capability; a future boundary must provide a
 * separately confirmed `admit_execution` proof and trusted principal.
 */
export function createLocalActionExecutionAdmissionService(input: Readonly<{
  database: LocalDatabase;
  config: LocalDecisionRoomConfig;
  challengeStore?: SingleUseHumanPresenceChallengeStore;
}>): ActionExecutionAdmissionService {
  const source = new DrizzleActionExecutionAdmissionSourceRepository(input.database, input.config.workspaceId);
  const sink = new DrizzleActionExecutionAdmissionRepository(input.database, input.config.workspaceId);
  return new ActionExecutionAdmissionService(source, input.challengeStore ?? new SingleUseHumanPresenceChallengeStore(), sink);
}
