import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { DrizzleScopeReportSavedRepository } from "@/connectors/slices/scope-report-saved-drizzle-repository";
import {
  createScopeReportSavedHttpHandlers,
  scopeReportSavedForbidden,
  scopeReportSavedInvalidInput,
  scopeReportSavedRequestKind,
  scopeReportSavedSessionRequired,
  scopeReportSavedUnavailable,
} from "@/server/scope-report-saved-http";
import {
  hasTrustedFrameworkForwarding,
  LocalDecisionRoomBoundaryError,
  resolveTrustedLocalSessionIdentity,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";
import {
  cookieToken,
  LocalSessionCapabilityError,
  verifyLocalSessionCapability,
} from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
function trustedShape(
  request: Request,
  config: LocalDecisionRoomConfig,
): boolean {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  const operation = scopeReportSavedRequestKind(request);
  return (
    operation !== null &&
    url.origin === config.origin &&
    request.headers.get("host") === new URL(config.origin).host &&
    !request.headers.has("authorization") &&
    request.headers.get("sec-fetch-site") === "same-origin" &&
    hasTrustedFrameworkForwarding(request, config.origin) &&
    (operation === "list"
      ? request.headers.get("origin") === null ||
        request.headers.get("origin") === config.origin
      : request.headers.get("origin") === config.origin)
  );
}

export function createLocalScopeReportSavedHandlers(
  input: Readonly<{
    database: Pick<Database, "transaction" | "execute">;
    config: LocalDecisionRoomConfig;
  }>,
) {
  const repository = new DrizzleScopeReportSavedRepository(
    input.database as never,
  );
  const invoke = async (request: Request, method: "GET" | "POST") => {
    if (request.method !== method || !trustedShape(request, input.config))
      return scopeReportSavedInvalidInput();
    if (!request.headers.get("cookie"))
      return scopeReportSavedSessionRequired();
    try {
      const operation = scopeReportSavedRequestKind(request)!;
      const bound = await resolveTrustedLocalSessionIdentity({
        request,
        database: input.database as never,
        config: input.config,
        credential: "cookie",
      });
      verifyLocalSessionCapability({
        token: cookieToken(request)!,
        key: input.config.signingKey,
        now: Math.floor(Date.now() / 1000),
        osUid: typeof process.getuid === "function" ? process.getuid() : -1,
        requiredScope:
          operation === "list" ? "scope_report:read" : "scope_report:save",
        expected: input.config,
      });
      return createScopeReportSavedHttpHandlers({
        repository,
        identity: async () => ({
          workspaceId: bound.principal.workspaceId,
          actorId: bound.principal.actor.userId,
        }),
      })[method](request);
    } catch (reason) {
      if (reason instanceof LocalSessionCapabilityError)
        return scopeReportSavedSessionRequired();
      if (reason instanceof LocalDecisionRoomBoundaryError)
        return reason.code === "principal_unavailable"
          ? scopeReportSavedForbidden()
          : scopeReportSavedSessionRequired();
      return scopeReportSavedUnavailable();
    }
  };
  return Object.freeze({
    GET: (request: Request) => invoke(request, "GET"),
    POST: (request: Request) => invoke(request, "POST"),
  });
}
