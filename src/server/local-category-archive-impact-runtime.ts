import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CategoryArchiveImpactService } from "@/application/category-archive-impact-service";
import { DrizzleCategoryArchiveImpactRepository } from "@/connectors/categories/category-archive-impact-drizzle-repository";
import * as schema from "@/db/schema";
import { categoryArchiveImpactNotConfiguredResponse, categoryArchiveImpactSessionRequiredResponse,
  createCategoryArchiveImpactHttpHandler } from "@/server/category-archive-impact-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalCategoryRegistryPrincipal,
  type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
export function createLocalCategoryArchiveImpactHandler(input: Readonly<{
  database: Pick<Database, "execute">; config: LocalDecisionRoomConfig;
}>) {
  return async (request: Request) => { try {
    const bound = await resolveTrustedLocalCategoryRegistryPrincipal({ request, database: input.database,
      config: input.config });
    return createCategoryArchiveImpactHttpHandler({ service: new CategoryArchiveImpactService(
      new DrizzleCategoryArchiveImpactRepository(input.database), [bound.membership]),
    resolvePrincipal: async () => bound.principal })(request);
  } catch (reason) {
    return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
      ? categoryArchiveImpactSessionRequiredResponse() : categoryArchiveImpactNotConfiguredResponse();
  } };
}
