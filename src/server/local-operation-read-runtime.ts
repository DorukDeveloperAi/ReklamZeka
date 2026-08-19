import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { OperationReadService } from "@/application/operation-read-service";
import { DrizzleOperationReadRepository } from "@/connectors/operations/operation-read-drizzle-repository";
import {
  createOperationReadHttpHandler,
  operationReadForbidden,
  operationReadInvalidInput,
  operationReadRequestInput,
  operationReadSessionRequired,
  operationReadUnavailable,
} from "@/server/operation-read-http";
import {
  hasTrustedFrameworkForwarding,
  resolveTrustedConfiguredLocalReadPrincipal,
  localDecisionRoomConfig,
  LocalDecisionRoomBoundaryError,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;

/** Keeps malformed transport out of identity resolution, so it cannot look like a missing session. */
function trustedOperationReadShape(request: Request, config: LocalDecisionRoomConfig): boolean {
  if (!operationReadRequestInput(request)) return false;
  let url: URL;
  try { url = new URL(request.url); } catch { return false; }
  return url.origin === config.origin
    && request.headers.get("host") === new URL(config.origin).host
    && hasTrustedFrameworkForwarding(request, config.origin)
    && (request.headers.get("origin") === null || request.headers.get("origin") === config.origin);
}

function localReadFailure(reason: unknown) {
  if (reason instanceof LocalSessionCapabilityError) return operationReadSessionRequired();
  if (reason instanceof LocalDecisionRoomBoundaryError) {
    return reason.code === "principal_unavailable" ? operationReadForbidden()
      : reason.code === "untrusted_request" ? operationReadSessionRequired()
        : operationReadUnavailable();
  }
  return operationReadUnavailable();
}

export function createLocalOperationReadHandler(input: Readonly<{
  database: Pick<Database, "transaction" | "execute">;
  config: LocalDecisionRoomConfig;
}>) {
  return async (request: Request) => {
    if (!trustedOperationReadShape(request, input.config)) return operationReadInvalidInput();
    try {
      const bound = await resolveTrustedConfiguredLocalReadPrincipal({ request, database: input.database as never, config: input.config });
      return createOperationReadHttpHandler({
        service: new OperationReadService(new DrizzleOperationReadRepository(input.database)),
        workspaceId: async () => bound.principal.workspaceId,
        requiresSession: false,
      })(request);
    } catch (reason) {
      return localReadFailure(reason);
    }
  };
}

export { localDecisionRoomConfig };
