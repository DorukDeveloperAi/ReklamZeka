import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DrizzleMetaPortfolioCapabilityRepository } from "@/connectors/meta/portfolio-capability-drizzle-repository";
import * as schema from "@/db/schema";
import {
  createPortfolioCapabilityHttpHandler,
  portfolioCapabilityNotConfiguredResponse,
  portfolioCapabilitySessionRequiredResponse,
} from "@/server/portfolio-capability-http";
import {
  LocalDecisionRoomBoundaryError,
  resolveTrustedLocalReadPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
type CapabilityRepository = Readonly<{ load(workspaceId: string): ReturnType<DrizzleMetaPortfolioCapabilityRepository["load"]> }>;

function localReadFailure(reason: unknown) {
  return reason instanceof LocalSessionCapabilityError
    || reason instanceof LocalDecisionRoomBoundaryError && reason.code === "untrusted_request"
    ? portfolioCapabilitySessionRequiredResponse()
    : portfolioCapabilityNotConfiguredResponse();
}

export function createLocalPortfolioCapabilityRouteHandler(input: Readonly<{
  database: Pick<Database, "execute" | "select" | "transaction">;
  config: LocalDecisionRoomConfig;
  repository?: CapabilityRepository;
}>) {
  return async (request: Request) => {
    try {
      const bound = await resolveTrustedLocalReadPrincipal({
        request,
        database: input.database,
        config: input.config,
        requiredScope: "decision_room:read",
      });
      const repository = input.repository ?? new DrizzleMetaPortfolioCapabilityRepository(input.database as never);
      return createPortfolioCapabilityHttpHandler({
        load: (workspaceId) => repository.load(workspaceId),
        workspaceId: async () => bound.principal.workspaceId,
      })(request);
    } catch (reason) {
      return localReadFailure(reason);
    }
  };
}

export { portfolioCapabilityNotConfiguredResponse };
