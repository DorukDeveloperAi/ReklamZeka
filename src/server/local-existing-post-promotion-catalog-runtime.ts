import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ExistingPostPromotionCatalogService } from "@/application/existing-post-promotion-catalog";
import { DrizzleExistingPostPromotionCatalogRepository } from "@/connectors/meta/promotion/existing-post-promotion-catalog-drizzle-repository";
import * as schema from "@/db/schema";
import {
  createExistingPostPromotionCatalogHttpHandler,
  existingPostPromotionCatalogNotConfiguredResponse,
} from "@/server/existing-post-promotion-catalog-http";
import {
  resolveTrustedLocalReadPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";

type Database = NodePgDatabase<typeof schema>;

/** Cookie-only route assembly. The repository receives no Meta transport. */
export function createLocalExistingPostPromotionCatalogRouteHandler(input: Readonly<{
  database: Pick<Database, "execute">;
  config: LocalDecisionRoomConfig;
}>) {
  return async function GET(request: Request) {
    try {
      // This dashboard surface is intentionally browser-cookie only. Reject a
      // bearer before membership or catalog storage is touched.
      if (request.headers.has("authorization") || !request.headers.get("cookie")) {
        return existingPostPromotionCatalogNotConfiguredResponse();
      }
      const bound = await resolveTrustedLocalReadPrincipal({
        request,
        database: input.database,
        config: input.config,
        requiredScope: "promotion_catalog:read",
      });
      const service = new ExistingPostPromotionCatalogService(
        new DrizzleExistingPostPromotionCatalogRepository(input.database),
        [bound.membership],
      );
      return createExistingPostPromotionCatalogHttpHandler({
        service,
        origin: input.config.origin,
        resolvePrincipal: async () => bound.principal,
      })(request);
    } catch {
      return existingPostPromotionCatalogNotConfiguredResponse();
    }
  };
}

export { existingPostPromotionCatalogNotConfiguredResponse };
