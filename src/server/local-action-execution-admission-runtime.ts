import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ActionExecutionAdmissionService } from "@/application/action-execution-admission-service";
import { DrizzleActionExecutionAdmissionRepository } from "@/connectors/actions/action-execution-admission-drizzle-repository";
import { DrizzleActionExecutionAdmissionSourceRepository } from "@/connectors/actions/action-execution-admission-source-drizzle-repository";
import * as schema from "@/db/schema";
import { SingleUseHumanPresenceChallengeStore } from "@/security/human-presence-challenge";
import type { LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createLocalGuideBudgetAdmissionGate } from "@/server/local-guide-budget-action-runtime";

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
  // Guide-origin units always receive the server-owned gate. A caller cannot
  // omit it to fall back to generic admission; incomplete trusted evidence
  // simply returns false from the gate and the source remains fail-closed.
  const source = new DrizzleActionExecutionAdmissionSourceRepository(input.database, input.config.workspaceId, undefined,
    createLocalGuideBudgetAdmissionGate(input.database as Database));
  const sink = new DrizzleActionExecutionAdmissionRepository(input.database, input.config.workspaceId);
  return new ActionExecutionAdmissionService(source, input.challengeStore ?? new SingleUseHumanPresenceChallengeStore(), sink);
}
