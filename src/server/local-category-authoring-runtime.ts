import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CategoryAuthoringService } from "@/application/category-authoring-service";
import { DrizzleCategoryAuthoringRepository } from "@/connectors/categories/category-authoring-drizzle-repository";
import * as schema from "@/db/schema";
import { categoryAuthoringNotConfiguredResponse, categoryAuthoringSessionRequiredResponse,
  createCategoryAuthoringHttpHandlers } from "@/server/category-authoring-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalCategoryAuthoringPrincipal,
  type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;

export function createLocalCategoryAuthoringHandlers(input: Readonly<{
  database: Pick<Database, "execute" | "select" | "insert" | "update" | "transaction">;
  config: LocalDecisionRoomConfig;
}>) {
  const execute = async (request: Request, operation: "read" | "publish") => { try {
    const bound = await resolveTrustedLocalCategoryAuthoringPrincipal({ request, database: input.database,
      config: input.config, requiredScope: operation === "read" ? "category_registry:read" : "category_registry:publish" });
    const service = new CategoryAuthoringService(
      new DrizzleCategoryAuthoringRepository(input.database as Database), [bound.membership]);
    const handlers = createCategoryAuthoringHttpHandlers({ service, resolvePrincipal: async () => bound.principal });
    return operation === "read" ? handlers.GET(request) : handlers.POST(request);
  } catch (reason) {
    return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
      ? categoryAuthoringSessionRequiredResponse() : categoryAuthoringNotConfiguredResponse();
  } };
  return Object.freeze({ GET: (request: Request) => execute(request, "read"),
    POST: (request: Request) => execute(request, "publish") });
}
