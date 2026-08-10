import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DecisionCadenceProfileService } from "@/application/decision-cadence-profile-service";
import { DrizzleDecisionCadenceProfileRepository } from "@/connectors/decisions/decision-cadence-profile-drizzle-repository";
import * as schema from "@/db/schema";
import { createDecisionCadenceProfileHttpHandler, decisionCadenceProfileNotConfiguredResponse } from "@/server/decision-cadence-profile-http";
import { resolveTrustedLocalDecisionCadencePublishPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";

type Database = NodePgDatabase<typeof schema>;

export function createLocalDecisionCadenceProfileHandler(input: Readonly<{
  database: Pick<Database, "execute" | "transaction">;
  config: LocalDecisionRoomConfig;
}>) {
  return async function POST(request: Request) {
    try {
      const bound = await resolveTrustedLocalDecisionCadencePublishPrincipal({ request, database: input.database, config: input.config });
      return createDecisionCadenceProfileHttpHandler({
        service: new DecisionCadenceProfileService(new DrizzleDecisionCadenceProfileRepository(input.database as never), [bound.membership]),
        resolvePrincipal: async () => bound.principal,
      })(request);
    } catch { return decisionCadenceProfileNotConfiguredResponse(); }
  };
}

export { decisionCadenceProfileNotConfiguredResponse };
