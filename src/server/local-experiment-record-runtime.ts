import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ExperimentRecordService } from "@/application/experiment-record-service";
import { DrizzleExperimentRecordRepository } from "@/connectors/decisions/experiment-record-drizzle-repository";
import * as schema from "@/db/schema";
import { createExperimentRecordHttpHandler, experimentRecordNotConfiguredResponse } from "@/server/experiment-record-http";
import { resolveTrustedLocalExperimentRecordPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
type Database = NodePgDatabase<typeof schema>;

export function createLocalExperimentRecordHandler(input: Readonly<{ database: Pick<Database, "execute" | "transaction">; config: LocalDecisionRoomConfig }>) {
  return async function POST(request: Request) {
    try {
      const bound = await resolveTrustedLocalExperimentRecordPrincipal({ request, database: input.database, config: input.config });
      return createExperimentRecordHttpHandler({ service: new ExperimentRecordService(new DrizzleExperimentRecordRepository(input.database as never), [bound.membership]),
        resolvePrincipal: async () => bound.principal })(request);
    } catch { return experimentRecordNotConfiguredResponse(); }
  };
}
export { experimentRecordNotConfiguredResponse };
