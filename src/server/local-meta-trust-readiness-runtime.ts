import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { MetaTrustReadinessReadService, type MetaTrustReadinessReadRepository } from "@/application/meta-trust-readiness-read-service";
import { DrizzleMetaTrustReadinessReadRepository } from "@/connectors/meta/trust-readiness-read-drizzle-repository";
import * as schema from "@/db/schema";
import { metaTrustReadinessNotConfiguredResponse, metaTrustReadinessSessionRequiredResponse, createMetaTrustReadinessHttpHandler } from "@/server/meta-trust-readiness-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalReadPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
function failure(reason: unknown) {
  return reason instanceof LocalSessionCapabilityError
    || reason instanceof LocalDecisionRoomBoundaryError && reason.code === "untrusted_request"
    ? metaTrustReadinessSessionRequiredResponse() : metaTrustReadinessNotConfiguredResponse();
}

export function createLocalMetaTrustReadinessRouteHandler(input: Readonly<{
  database: Pick<Database, "transaction" | "execute">;
  config: LocalDecisionRoomConfig;
  repository?: MetaTrustReadinessReadRepository;
}>) {
  return async (request: Request) => {
    try {
      const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database,
        config: input.config, requiredScope: "decision_room:read" });
      const repository = input.repository ?? new DrizzleMetaTrustReadinessReadRepository(input.database as never);
      return createMetaTrustReadinessHttpHandler({
        load: (workspaceId) => new MetaTrustReadinessReadService(repository).read(workspaceId),
        workspaceId: async () => bound.principal.workspaceId,
      })(request);
    } catch (reason) { return failure(reason); }
  };
}

export { metaTrustReadinessNotConfiguredResponse };
