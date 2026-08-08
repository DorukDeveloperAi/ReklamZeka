import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CategoryEffectiveHealthService } from "@/application/category-effective-health-service";
import { DrizzleCategoryEffectiveHealthRepository } from "@/connectors/categories/category-effective-health-drizzle-repository";
import * as schema from "@/db/schema";
import { categoryEffectiveHealthNotConfiguredResponse, categoryEffectiveHealthSessionRequiredResponse,
  createCategoryEffectiveHealthHttpHandler } from "@/server/category-effective-health-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalCategoryRegistryPrincipal,
  type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
export function createLocalCategoryEffectiveHealthHandler(input: Readonly<{
  database: Pick<Database, "execute">; config: LocalDecisionRoomConfig;
}>) {
  return async (request: Request) => { try {
    const bound = await resolveTrustedLocalCategoryRegistryPrincipal({ request, database: input.database, config: input.config });
    return createCategoryEffectiveHealthHttpHandler({ service: new CategoryEffectiveHealthService(
      new DrizzleCategoryEffectiveHealthRepository(input.database), [bound.membership]),
    resolvePrincipal: async () => bound.principal })(request);
  } catch (reason) {
    return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
      ? categoryEffectiveHealthSessionRequiredResponse() : categoryEffectiveHealthNotConfiguredResponse();
  } };
}
