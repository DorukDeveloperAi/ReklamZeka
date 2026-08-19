import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { MetaReadMirrorReadService, type MetaReadMirrorReadRepository } from "@/application/meta-read-mirror-read-service";
import { DrizzleMetaReadMirrorRepository } from "@/connectors/meta/read-mirror-drizzle-repository";
import * as schema from "@/db/schema";
import {
  createMetaReadMirrorHttpHandler,
  metaReadMirrorNotConfiguredResponse,
  metaReadMirrorSessionRequiredResponse,
} from "@/server/meta-read-mirror-http";
import {
  LocalDecisionRoomBoundaryError,
  resolveTrustedConfiguredLocalReadPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
function localReadFailure(reason: unknown) {
  return reason instanceof LocalSessionCapabilityError
    || reason instanceof LocalDecisionRoomBoundaryError && reason.code === "untrusted_request"
    ? metaReadMirrorSessionRequiredResponse()
    : metaReadMirrorNotConfiguredResponse();
}

export function createLocalMetaReadMirrorRouteHandler(input: Readonly<{
  database: Pick<Database, "execute" | "transaction">;
  config: LocalDecisionRoomConfig;
  repository?: MetaReadMirrorReadRepository;
}>) {
  return async (request: Request) => {
    try {
      const bound = await resolveTrustedConfiguredLocalReadPrincipal({ request, database: input.database, config: input.config });
      const repository = input.repository ?? new DrizzleMetaReadMirrorRepository(input.database as never);
      const service = new MetaReadMirrorReadService(repository);
      return createMetaReadMirrorHttpHandler({
        load: (workspaceId) => service.read(workspaceId),
        workspaceId: async () => bound.principal.workspaceId,
      })(request);
    } catch (reason) {
      return localReadFailure(reason);
    }
  };
}

export { metaReadMirrorNotConfiguredResponse };
