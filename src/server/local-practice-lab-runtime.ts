import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { PracticeLabAgentContract } from "@/application/practice-lab-agent-contract";
import { PracticeLabReadService } from "@/application/practice-lab-read-service";
import { AdvisedPracticeLifecycleService } from "@/application/advised-practice-lifecycle-service";
import { DrizzleAdvisedPracticeRepository } from "@/connectors/guidance/advised-practice-drizzle-repository";
import { resolveTrustedLocalPracticeLabPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createPracticeLabHttpHandlers, practiceLabNotConfiguredResponse } from "@/server/practice-lab-http";

type Database = NodePgDatabase<typeof schema>;

export function createLocalPracticeLabRouteHandlers(input: Readonly<{
  database: Pick<Database, "execute" | "transaction">;
  config: LocalDecisionRoomConfig;
}>) {
  const execute = async (request: Request, operation: "read" | "draft" | "standardize") => {
    try {
      const requiredScope = operation === "read" ? "practice_lab:read" as const
        : operation === "draft" ? "practice_lab:draft" as const : "practice_lab:standardize" as const;
      const bound = await resolveTrustedLocalPracticeLabPrincipal({
        request, database: input.database, config: input.config, requiredScope,
      });
      const repository = new DrizzleAdvisedPracticeRepository(input.database as never, input.config.workspaceId);
      const handlers = createPracticeLabHttpHandlers({
        contract: new PracticeLabAgentContract(
          new PracticeLabReadService(repository),
          [bound.membership],
        ),
        lifecycle: new AdvisedPracticeLifecycleService(repository, [bound.membership]),
        resolvePrincipal: async () => bound.principal,
      });
      return operation === "read" ? handlers.GET(request) : handlers.POST(request);
    } catch {
      return practiceLabNotConfiguredResponse();
    }
  };
  return Object.freeze({ GET: (request: Request) => execute(request, "read"),
    POST: async (request: Request) => {
      let operation: "draft" | "standardize" = "standardize";
      try { const body = await request.clone().json() as { command?: { operation?: string } };
        operation = body.command?.operation === "propose_standardization" ? "draft" : "standardize";
      } catch { /* exact HTTP parser returns the public error */ }
      return execute(request, operation);
    } });
}

export function createLocalPracticeLabRouteHandler(input: Parameters<typeof createLocalPracticeLabRouteHandlers>[0]) {
  return createLocalPracticeLabRouteHandlers(input).GET;
}

export { practiceLabNotConfiguredResponse };
