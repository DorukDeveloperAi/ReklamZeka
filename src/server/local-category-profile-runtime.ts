import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CategoryProfileLifecycleService } from "@/application/category-profile-lifecycle-service";
import { DrizzleCategoryProfileLifecycleRepository } from
  "@/connectors/categories/category-profile-lifecycle-drizzle-repository";
import * as schema from "@/db/schema";
import { categoryProfileNotConfiguredResponse, categoryProfileSessionRequiredResponse,
  createCategoryProfileLifecycleHttpHandlers } from "@/server/category-profile-lifecycle-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalCategoryAuthoringPrincipal,
  type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;

export function createLocalCategoryProfileHandlers(input: Readonly<{
  database: Pick<Database, "execute" | "transaction">;
  config: LocalDecisionRoomConfig;
}>) {
  const execute = async (request: Request, operation: "read" | "publish") => { try {
    const bound = await resolveTrustedLocalCategoryAuthoringPrincipal({ request, database: input.database as never,
      config: input.config, requiredScope: operation === "read" ? "category_registry:read" : "category_registry:publish" });
    const service = new CategoryProfileLifecycleService(
      new DrizzleCategoryProfileLifecycleRepository(input.database as Database), [bound.membership]);
    const handlers = createCategoryProfileLifecycleHttpHandlers({ service, resolvePrincipal: async () => bound.principal });
    return operation === "read" ? handlers.GET(request) : handlers.POST(request);
  } catch (reason) {
    return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
      ? categoryProfileSessionRequiredResponse() : categoryProfileNotConfiguredResponse();
  } };
  return Object.freeze({ GET: (request: Request) => execute(request, "read"),
    POST: (request: Request) => execute(request, "publish") });
}
