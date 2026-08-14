import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ExistingPostPromotionCatalogService } from "@/application/existing-post-promotion-catalog";
import { DrizzleExistingPostPromotionCatalogRepository } from "@/connectors/meta/promotion/existing-post-promotion-catalog-drizzle-repository";
import * as schema from "@/db/schema";
import {
  createExistingPostPromotionCatalogHttpHandler,
  existingPostPromotionCatalogNotConfiguredResponse,
  existingPostPromotionCatalogSessionRequiredResponse,
} from "@/server/existing-post-promotion-catalog-http";
import {
  LocalDecisionRoomBoundaryError,
  resolveTrustedLocalReadPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

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
      if (request.headers.has("authorization")) {
        return existingPostPromotionCatalogNotConfiguredResponse();
      }
      if (!request.headers.get("cookie")) {
        return existingPostPromotionCatalogSessionRequiredResponse();
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
    } catch (reason) {
      return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
        ? existingPostPromotionCatalogSessionRequiredResponse() : existingPostPromotionCatalogNotConfiguredResponse();
    }
  };
}

export { existingPostPromotionCatalogNotConfiguredResponse, existingPostPromotionCatalogSessionRequiredResponse };
