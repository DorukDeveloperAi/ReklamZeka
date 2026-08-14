import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { OperationalTimelineReadService } from "@/application/operational-timeline-read-service";
import { DrizzleOperationalTimelineRepository } from "@/connectors/decisions/operational-timeline-drizzle-repository";
import * as schema from "@/db/schema";
import { createOperationalTimelineHttpHandler, operationalTimelineNotConfiguredResponse,
  operationalTimelineSessionRequiredResponse } from "@/server/operational-timeline-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalReadPrincipal,
  type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";
type Database = NodePgDatabase<typeof schema>;
export function createLocalOperationalTimelineHandler(input: Readonly<{ database: Pick<Database, "execute">; config: LocalDecisionRoomConfig }>) {
  return async (request: Request) => {
    try {
      const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database, config: input.config, requiredScope: "approval_queue:read" });
      return createOperationalTimelineHttpHandler({ service: new OperationalTimelineReadService(new DrizzleOperationalTimelineRepository(input.database), [bound.membership]),
        resolvePrincipal: async () => bound.principal })(request);
    } catch (reason) {
      return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
        ? operationalTimelineSessionRequiredResponse() : operationalTimelineNotConfiguredResponse();
    }
  };
}
