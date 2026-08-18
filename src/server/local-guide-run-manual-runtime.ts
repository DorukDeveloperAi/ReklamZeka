import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import {
  createGuideRunManualHttpHandler,
  guideRunManualNotConfiguredResponse,
  guideRunManualSessionRequiredResponse,
} from "@/server/guide-run-manual-http";
import { createLocalCodexGuideRunManualRuntime } from "@/server/guide-run-worker-runtime";
import {
  LocalDecisionRoomBoundaryError,
  resolveTrustedLocalGuideRunManualPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;

export function createLocalGuideRunManualHandler(
  input: Readonly<{
    database: Pick<Database, "execute" | "transaction">;
    config: LocalDecisionRoomConfig;
    environment?: Readonly<Record<string, string | undefined>>;
    serverCwd?: string;
  }>,
) {
  const runtime = createLocalCodexGuideRunManualRuntime({
    database: input.database,
    environment: input.environment,
    serverCwd: input.serverCwd,
  });
  if (!runtime.enabled || !runtime.worker)
    return guideRunManualNotConfiguredResponse;
  const handler = createGuideRunManualHttpHandler({
    worker: runtime.worker,
    resolvePrincipal: (request) =>
      resolveTrustedLocalGuideRunManualPrincipal({
        request,
        database: input.database,
        config: input.config,
      }),
  });
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (reason) {
      return reason instanceof LocalDecisionRoomBoundaryError ||
        reason instanceof LocalSessionCapabilityError
        ? guideRunManualSessionRequiredResponse()
        : guideRunManualNotConfiguredResponse();
    }
  };
}
