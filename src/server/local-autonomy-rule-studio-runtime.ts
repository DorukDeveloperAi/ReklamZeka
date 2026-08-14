import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { AutonomyRuleStudioService } from "@/application/autonomy-rule-studio-service";
import { DrizzleAutonomyRuleRegistryRepository } from "@/connectors/actions/autonomy-rule-registry-drizzle-repository";
import { createAutonomyRuleStudioHttpHandlers, autonomyRuleStudioNotConfiguredResponse, autonomyRuleStudioSessionRequiredResponse } from "@/server/autonomy-rule-studio-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalAutonomyRulePrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
export function createLocalAutonomyRuleStudioHandlers(input: Readonly<{ database: Pick<Database, "execute" | "transaction">; config: LocalDecisionRoomConfig }>) {
  const execute = async (request: Request, operation: "read" | "draft") => {
    try {
      const bound = await resolveTrustedLocalAutonomyRulePrincipal({ request, database: input.database, config: input.config,
        requiredScope: operation === "read" ? "autonomy_rules:read" : "autonomy_rules:draft" });
      const repository = new DrizzleAutonomyRuleRegistryRepository(input.database as never, input.config.workspaceId, input.config.workspaceRef);
      const handlers = createAutonomyRuleStudioHttpHandlers({ service: new AutonomyRuleStudioService(repository, [bound.membership]),
        resolvePrincipal: async () => bound.principal });
      return operation === "read" ? handlers.GET(request) : handlers.POST(request);
    } catch (reason) { return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
      ? autonomyRuleStudioSessionRequiredResponse() : autonomyRuleStudioNotConfiguredResponse(); }
  };
  return { GET: (request: Request) => execute(request, "read"), POST: (request: Request) => execute(request, "draft") };
}
