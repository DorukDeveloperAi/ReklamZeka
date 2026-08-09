import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { StarterCategoryAdoptionService } from "@/application/starter-category-adoption-service";
import { DrizzleCategoryAuthoringRepository } from "@/connectors/categories/category-authoring-drizzle-repository";
import * as schema from "@/db/schema";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalCategoryAuthoringPrincipal,
  type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createStarterCategoryAdoptionHttpHandlers, starterCategoryAdoptionNotConfiguredResponse,
  starterCategoryAdoptionSessionRequiredResponse } from "@/server/starter-category-adoption-http";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
export function createLocalStarterCategoryAdoptionHandlers(input: Readonly<{
  database: Pick<Database, "execute" | "select" | "insert" | "update" | "transaction">;
  config: LocalDecisionRoomConfig;
}>) {
  const execute = async (request: Request, operation: "read" | "publish") => { try {
    const bound = await resolveTrustedLocalCategoryAuthoringPrincipal({ request, database: input.database,
      config: input.config, requiredScope: operation === "read" ? "category_registry:read" : "category_registry:publish" });
    const service = new StarterCategoryAdoptionService(
      new DrizzleCategoryAuthoringRepository(input.database as Database), [bound.membership]);
    const handlers = createStarterCategoryAdoptionHttpHandlers({ service, resolvePrincipal: async () => bound.principal });
    return operation === "read" ? handlers.GET(request) : handlers.POST(request);
  } catch (reason) {
    return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
      ? starterCategoryAdoptionSessionRequiredResponse() : starterCategoryAdoptionNotConfiguredResponse();
  } };
  return Object.freeze({ GET: (request: Request) => execute(request, "read"),
    POST: (request: Request) => execute(request, "publish") });
}
