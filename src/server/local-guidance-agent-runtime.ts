import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { GuidanceAgentContract } from "@/application/guidance-agent-contract";
import { DrizzleGuidanceRegistryRepository } from "@/connectors/guidance/guidance-drizzle-repository";
import * as schema from "@/db/schema";
import { createGuidanceAgentHttpHandlers, guidanceAgentNotConfiguredResponse } from "@/server/guidance-agent-http";
import { resolveTrustedLocalReadPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";

type Database = NodePgDatabase<typeof schema>;
export function createLocalGuidanceAgentHandlers(input: Readonly<{ database: Database; config: LocalDecisionRoomConfig }>) {
  const execute = async (request: Request, operation: "GET" | "POST") => { try {
    const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database, config: input.config,
      requiredScope: "guidance:read" });
    const handlers = createGuidanceAgentHttpHandlers({ contract: new GuidanceAgentContract(
      new DrizzleGuidanceRegistryRepository(input.database), [bound.membership]), resolvePrincipal: async () => bound.principal });
    return operation === "GET" ? handlers.GET(request) : handlers.POST(request);
  } catch { return guidanceAgentNotConfiguredResponse(); } };
  return Object.freeze({ GET: (request: Request) => execute(request, "GET"), POST: (request: Request) => execute(request, "POST") });
}
