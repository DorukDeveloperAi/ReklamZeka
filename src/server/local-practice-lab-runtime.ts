import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { PracticeLabAgentContract } from "@/application/practice-lab-agent-contract";
import { PracticeLabReadService } from "@/application/practice-lab-read-service";
import { DrizzleAdvisedPracticeRepository } from "@/connectors/guidance/advised-practice-drizzle-repository";
import { resolveTrustedLocalReadPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createPracticeLabHttpHandler, practiceLabNotConfiguredResponse } from "@/server/practice-lab-http";

type Database = NodePgDatabase<typeof schema>;

export function createLocalPracticeLabRouteHandler(input: Readonly<{
  database: Pick<Database, "execute" | "transaction">;
  config: LocalDecisionRoomConfig;
}>) {
  return async function GET(request: Request) {
    try {
      const bound = await resolveTrustedLocalReadPrincipal({
        request, database: input.database, config: input.config, requiredScope: "practice_lab:read",
      });
      const handler = createPracticeLabHttpHandler({
        contract: new PracticeLabAgentContract(
          new PracticeLabReadService(new DrizzleAdvisedPracticeRepository(input.database as never, input.config.workspaceId)),
          [bound.membership],
        ),
        resolvePrincipal: async () => bound.principal,
      });
      return handler(request);
    } catch {
      return practiceLabNotConfiguredResponse();
    }
  };
}

export { practiceLabNotConfiguredResponse };
