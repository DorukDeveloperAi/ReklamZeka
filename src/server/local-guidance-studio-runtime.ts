import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { GuidanceStudioService } from "@/application/guidance-studio-service";
import { DrizzleGuidanceRegistryRepository } from "@/connectors/guidance/guidance-drizzle-repository";
import * as schema from "@/db/schema";
import { createGuidanceStudioHttpHandlers, guidanceStudioNotConfiguredResponse,
  guidanceStudioSessionRequiredResponse } from "@/server/guidance-studio-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalGuidancePrincipal,
  type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
export function createLocalGuidanceStudioHandlers(input: Readonly<{
  database: Pick<Database, "select" | "insert" | "execute" | "transaction">;
  config: LocalDecisionRoomConfig;
}>) {
  const execute = async (request: Request, operation: "read" | "draft" | "publish") => {
    try {
      const requiredScope = operation === "read" ? "guidance:read" : operation === "draft" ? "guidance:draft" : "guidance:publish";
      const bound = await resolveTrustedLocalGuidancePrincipal({ request, database: input.database, config: input.config, requiredScope });
      const service = new GuidanceStudioService(new DrizzleGuidanceRegistryRepository(input.database as never), [bound.membership]);
      const handlers = createGuidanceStudioHttpHandlers({ service, resolvePrincipal: async () => bound.principal });
      return operation === "read" ? handlers.GET(request) : request.method === "POST" ? handlers.POST(request) : handlers.PATCH(request);
    } catch (reason) {
      return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
        ? guidanceStudioSessionRequiredResponse() : guidanceStudioNotConfiguredResponse();
    }
  };
  return Object.freeze({ GET: (request: Request) => execute(request, "read"),
    POST: (request: Request) => execute(request, "draft"),
    PATCH: (request: Request) => execute(request,
      request.headers.get("x-reklamzeka-intent") === "guidance-studio-revise" ? "draft" : "publish") });
}
