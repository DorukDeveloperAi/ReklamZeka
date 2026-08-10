import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { BusinessOutcomeSignalService } from "@/application/business-outcome-signal-service";
import { DrizzleBusinessOutcomeSignalRepository } from "@/connectors/analyses/business-outcome-signal-drizzle-repository";
import * as schema from "@/db/schema";
import { createBusinessOutcomeSignalHttpHandler, businessOutcomeSignalNotConfiguredResponse } from "@/server/business-outcome-signal-http";
import { resolveTrustedLocalBusinessOutcomePrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
type Database = NodePgDatabase<typeof schema>;
export function createLocalBusinessOutcomeSignalHandler(input: Readonly<{ database: Pick<Database, "execute" | "transaction">; config: LocalDecisionRoomConfig }>) {
  return async function POST(request: Request) { try {
    const bound = await resolveTrustedLocalBusinessOutcomePrincipal({ request, database: input.database, config: input.config });
    return createBusinessOutcomeSignalHttpHandler({ service: new BusinessOutcomeSignalService(new DrizzleBusinessOutcomeSignalRepository(input.database as never), [bound.membership]),
      resolvePrincipal: async () => bound.principal })(request);
  } catch { return businessOutcomeSignalNotConfiguredResponse(); } };
}
export { businessOutcomeSignalNotConfiguredResponse };
