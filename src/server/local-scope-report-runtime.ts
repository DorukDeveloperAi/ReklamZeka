import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { ScopeReportReadService } from "@/application/scope-report-read-service";
import { DrizzleOperationReadRepository } from "@/connectors/operations/operation-read-drizzle-repository";
import { createScopeReportHttpHandler, scopeReportForbidden, scopeReportInvalidInput, scopeReportRequestInput, scopeReportSessionRequired, scopeReportUnavailable } from "@/server/scope-report-http";
import { hasTrustedFrameworkForwarding, LocalDecisionRoomBoundaryError, resolveTrustedLocalReadPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
function trustedShape(request: Request, config: LocalDecisionRoomConfig): boolean {
  let url: URL;
  try { url = new URL(request.url); } catch { return false; }
  return scopeReportRequestInput(request) !== null && request.method === "GET" && url.origin === config.origin && request.headers.get("host") === new URL(config.origin).host
    && !request.headers.has("authorization") && request.headers.get("sec-fetch-site") === "same-origin"
    && request.headers.get("x-reklamzeka-intent") === "scope-report-read" && hasTrustedFrameworkForwarding(request, config.origin)
    && (request.headers.get("origin") === null || request.headers.get("origin") === config.origin);
}
export function createLocalScopeReportHandler(input: Readonly<{ database: Pick<Database, "transaction" | "execute">; config: LocalDecisionRoomConfig }>) {
  return async (request: Request) => {
    if (!trustedShape(request, input.config)) return scopeReportInvalidInput();
    if (!request.headers.get("cookie")) return scopeReportSessionRequired();
    try {
      const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database as never, config: input.config, requiredScope: "decision_room:read" });
      return createScopeReportHttpHandler({ service: new ScopeReportReadService(new DrizzleOperationReadRepository(input.database)), workspaceId: async () => bound.principal.workspaceId })(request);
    } catch (reason) {
      if (reason instanceof LocalSessionCapabilityError) return scopeReportSessionRequired();
      if (reason instanceof LocalDecisionRoomBoundaryError) return reason.code === "principal_unavailable" ? scopeReportForbidden() : scopeReportSessionRequired();
      return scopeReportUnavailable();
    }
  };
}
