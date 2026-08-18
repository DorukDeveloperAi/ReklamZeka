import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { GuideLifecycleService } from "@/application/guide-lifecycle-service";
import { createGuideLifecycleHttpHandlers, guideLifecycleNotConfiguredResponse, guideLifecycleSessionRequiredResponse } from "@/server/guide-lifecycle-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalGuideLifecyclePrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
export function createLocalGuideLifecycleHandlers(input: Readonly<{ database: Pick<Database, "execute" | "transaction">; config: LocalDecisionRoomConfig }>) {
  const execute = async (request: Request, operation: "read" | "draft" | "activate") => {
    try {
      const requiredScope = operation === "read" ? "guide_lifecycle:read" : operation === "draft" ? "guide_lifecycle:draft" : "guide_lifecycle:activate";
      const bound = await resolveTrustedLocalGuideLifecyclePrincipal({ request, database: input.database, config: input.config, requiredScope });
      const service = new GuideLifecycleService(input.database, [bound.membership]);
      const handlers = createGuideLifecycleHttpHandlers({ service, resolvePrincipal: async () => bound.principal });
      return request.method === "GET" ? handlers.GET(request) : request.method === "POST" ? handlers.POST(request) : handlers.PATCH(request);
    } catch (reason) {
      return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError ? guideLifecycleSessionRequiredResponse() : guideLifecycleNotConfiguredResponse();
    }
  };
  return Object.freeze({ GET: (request: Request) => execute(request, "read"), POST: (request: Request) => execute(request, "draft"), PATCH: (request: Request) => execute(request, ["guide-lifecycle-accept", "guide-lifecycle-revise"].includes(request.headers.get("x-reklamzeka-intent") ?? "") ? "draft" : "activate") });
}
