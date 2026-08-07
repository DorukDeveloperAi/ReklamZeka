import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { BudgetLabAgentContract } from "@/application/budget-lab-agent-contract";
import { BudgetLabReadService } from "@/application/budget-lab-read-service";
import { BudgetLabDraftService } from "@/application/budget-lab-draft-service";
import { DrizzleBudgetProposalRepository } from "@/connectors/budget/budget-proposal-drizzle-repository";
import { resolveTrustedLocalDraftPrincipal, resolveTrustedLocalReadPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { budgetLabNotConfiguredResponse, createBudgetLabHttpHandler, createBudgetLabPostHandler } from "@/server/budget-lab-http";

type Database = NodePgDatabase<typeof schema>;

export function createLocalBudgetLabRouteHandler(input: Readonly<{
  database: Pick<Database, "execute" | "select" | "transaction">;
  config: LocalDecisionRoomConfig;
}>) {
  return async function GET(request: Request) {
    try {
      const bound = await resolveTrustedLocalReadPrincipal({
        request, database: input.database, config: input.config, requiredScope: "budget_lab:read",
      });
      return createBudgetLabHttpHandler({
        contract: new BudgetLabAgentContract(
          new BudgetLabReadService(new DrizzleBudgetProposalRepository(input.database as never)),
          [bound.membership],
        ),
        resolvePrincipal: async () => bound.principal,
      })(request);
    } catch {
      return budgetLabNotConfiguredResponse();
    }
  };
}

export function createLocalBudgetLabPostHandler(input: Readonly<{
  database: Pick<Database, "execute" | "select" | "transaction">;
  config: LocalDecisionRoomConfig;
}>) {
  return async function POST(request: Request) {
    try {
      const bound = await resolveTrustedLocalDraftPrincipal({ request, database: input.database, config: input.config });
      const repository = new DrizzleBudgetProposalRepository(input.database as never);
      return createBudgetLabPostHandler({
        contract: new BudgetLabAgentContract(
          new BudgetLabReadService(repository), [bound.membership],
          new BudgetLabDraftService(repository, repository),
        ),
        resolvePrincipal: async () => bound.principal,
      })(request);
    } catch {
      return budgetLabNotConfiguredResponse();
    }
  };
}

export { budgetLabNotConfiguredResponse };
