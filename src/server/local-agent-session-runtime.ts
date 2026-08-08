import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { LocalAgentSessionLifecycleService } from "@/application/local-agent-session-contract";
import { DrizzleLocalAgentSessionRepository } from "@/connectors/agents/local-agent-session-drizzle-repository";
import * as schema from "@/db/schema";
import {
  createLocalAgentHandoffHttpHandlers,
} from "@/server/local-agent-handoff-http";
import {
  createLocalAgentSessionHttpHandlers,
} from "@/server/local-agent-session-http";
import {
  resolveTrustedLocalSessionIdentity,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";

type Database = NodePgDatabase<typeof schema>;
type LocalDatabase = Pick<Database, "execute" | "transaction">;

/** One repository/service composition is shared by dashboard and CLI route families. */
export function createLocalAgentCoordinationHandlers(input: Readonly<{
  database: LocalDatabase;
  config: LocalDecisionRoomConfig;
}>) {
  const service = new LocalAgentSessionLifecycleService(
    new DrizzleLocalAgentSessionRepository(input.database as never),
  );
  const resolveIdentity = async (request: Request, credential: "cookie" | "bearer") =>
    resolveTrustedLocalSessionIdentity({ request, database: input.database, config: input.config, credential });
  return Object.freeze({
    sessions: createLocalAgentSessionHttpHandlers({ service, origin: input.config.origin, resolveIdentity }),
    handoffs: createLocalAgentHandoffHttpHandlers({ service, origin: input.config.origin, resolveIdentity }),
  });
}
