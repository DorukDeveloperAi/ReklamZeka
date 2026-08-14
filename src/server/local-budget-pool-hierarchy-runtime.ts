import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { BudgetPoolHierarchyService } from "@/application/budget-pool-hierarchy-service";
import { DrizzleBudgetPoolHierarchyRepository } from "@/connectors/budget/budget-pool-hierarchy-drizzle-repository";
import * as schema from "@/db/schema";
import {
  LocalDecisionRoomBoundaryError,
  resolveTrustedLocalInstructionPolicyPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";
import {
  budgetPoolHierarchyNotConfiguredResponse,
  budgetPoolHierarchySessionRequiredResponse,
  createBudgetPoolHierarchyHttpHandlers,
} from "@/server/budget-pool-hierarchy-http";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
export function createLocalBudgetPoolHierarchyHandlers(input: Readonly<{
  database: Pick<Database, "select" | "insert" | "execute" | "transaction">;
  config: LocalDecisionRoomConfig;
}>) {
  const invoke = async (request: Request, operation: "read" | "draft") => {
    try {
      const bound = await resolveTrustedLocalInstructionPolicyPrincipal({ request, database: input.database, config: input.config,
        requiredScope: operation === "read" ? "instruction_policy:read" : "instruction_policy:draft" });
      const repository = new DrizzleBudgetPoolHierarchyRepository(input.database as never);
      const handlers = createBudgetPoolHierarchyHttpHandlers({ repository, service: new BudgetPoolHierarchyService(repository),
        resolveActor: async () => ({ principal: bound.principal, role: bound.membership.role }) });
      return operation === "read" ? handlers.GET(request) : handlers.POST(request);
    } catch (reason) {
      return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
        ? budgetPoolHierarchySessionRequiredResponse() : budgetPoolHierarchyNotConfiguredResponse();
    }
  };
  return Object.freeze({ GET: (request: Request) => invoke(request, "read"), POST: (request: Request) => invoke(request, "draft") });
}
