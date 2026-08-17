import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalMetaReadSyncPrincipal, type LocalDecisionRoomConfig } from
  "@/server/local-decision-room-runtime";
import { createManualMetaReadSyncHttpHandler, metaReadSyncNotConfiguredResponse, metaReadSyncSessionRequiredResponse } from
  "@/server/meta-read-sync-manual-http";
import { runDrizzleManualMetaReadSync } from "@/server/meta-read-sync-schedule-tick";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;

export function createLocalManualMetaReadSyncRouteHandler(input: Readonly<{
  database: Database;
  config: LocalDecisionRoomConfig;
  environment?: Record<string, string | undefined>;
}>) {
  return async (request: Request) => {
    try {
      const bound = await resolveTrustedLocalMetaReadSyncPrincipal({ request, database: input.database,
        config: input.config });
      return createManualMetaReadSyncHttpHandler({
        workspaceId: async () => bound.principal.workspaceId,
        run: (workspaceId) => runDrizzleManualMetaReadSync({ now: new Date().toISOString(), workspaceId }, {
          database: input.database, ...(input.environment === undefined ? {} : { environment: input.environment }),
        }),
      })(request);
    } catch (reason) {
      return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
        ? metaReadSyncSessionRequiredResponse() : metaReadSyncNotConfiguredResponse();
    }
  };
}
