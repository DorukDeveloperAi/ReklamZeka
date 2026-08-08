import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ExistingPostPromotionPreflightAgentContract } from "@/application/existing-post-promotion-preflight-agent-contract";
import { ExistingPostPromotionPublicPreflightService } from "@/application/existing-post-promotion-preflight-service";
import * as schema from "@/db/schema";
import { createDrizzleExistingPostPromotionCompatibilityPreflight } from
  "@/server/existing-post-promotion-compatibility-preflight-runtime";
import { createExistingPostPromotionPreflightHttpHandler, existingPostPromotionPreflightNotConfiguredResponse } from "@/server/existing-post-promotion-preflight-http";
import { resolveTrustedLocalReadPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";

type Database = NodePgDatabase<typeof schema>;

export function createLocalExistingPostPromotionPreflightRouteHandler(input: Readonly<{
  database: Pick<Database, "execute">;
  config: LocalDecisionRoomConfig;
}>) {
  return async function POST(request: Request) {
    try {
      if (request.headers.has("authorization") === request.headers.has("cookie")) {
        return existingPostPromotionPreflightNotConfiguredResponse();
      }
      const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database, config: input.config,
        requiredScope: "promotion_preflight:read" });
      const contract = new ExistingPostPromotionPreflightAgentContract(
        new ExistingPostPromotionPublicPreflightService(createDrizzleExistingPostPromotionCompatibilityPreflight({
          database: input.database as Database, principal: bound.principal })),
        [bound.membership],
      );
      return createExistingPostPromotionPreflightHttpHandler({ contract, origin: input.config.origin,
        resolvePrincipal: async () => bound.principal })(request);
    } catch {
      return existingPostPromotionPreflightNotConfiguredResponse();
    }
  };
}
