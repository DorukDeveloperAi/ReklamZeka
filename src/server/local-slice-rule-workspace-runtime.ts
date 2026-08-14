import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { BudgetLabDraftService } from "@/application/budget-lab-draft-service";
import { SliceRuleBudgetImpactService } from "@/application/slice-rule-budget-impact-service";
import { SliceRuleWorkspaceService } from "@/application/slice-rule-workspace-service";
import { DrizzleBudgetProposalRepository } from "@/connectors/budget/budget-proposal-drizzle-repository";
import { FrozenContextBudgetImpactScopeResolver } from "@/connectors/campaigns/frozen-context-budget-impact-scope-resolver";
import { DrizzleSliceRuleWorkspaceRepository } from "@/connectors/campaigns/slice-rule-workspace-drizzle-repository";
import { DrizzleSliceRuleBudgetPoolBindingRepository } from "@/connectors/campaigns/slice-rule-budget-pool-binding-drizzle-repository";
import * as schema from "@/db/schema";
import {
  LocalDecisionRoomBoundaryError,
  resolveTrustedLocalInstructionPolicyPrincipal,
  resolveTrustedLocalSliceRuleBudgetImpactPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";
import { createSliceRuleBudgetImpactHttpHandler } from "@/server/slice-rule-budget-impact-http";
import {
  createSliceRuleWorkspaceHttpHandlers,
  sliceRuleWorkspaceNotConfiguredResponse,
  sliceRuleWorkspaceSessionRequiredResponse,
} from "@/server/slice-rule-workspace-http";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;

export function createLocalSliceRuleWorkspaceHandlers(input: Readonly<{
  database: Pick<Database, "select" | "insert" | "execute" | "transaction">;
  config: LocalDecisionRoomConfig;
  now?: () => string;
}>) {
  const execute = async (request: Request, operation: "read" | "draft" | "impact") => {
    try {
      if (operation === "impact") {
        const bound = await resolveTrustedLocalSliceRuleBudgetImpactPrincipal({ request,
          database: input.database, config: input.config });
        const rules = new DrizzleSliceRuleWorkspaceRepository(input.database as never);
        const budgets = new DrizzleBudgetProposalRepository(input.database as never);
        const service = new SliceRuleBudgetImpactService(rules,
          new FrozenContextBudgetImpactScopeResolver(budgets), new BudgetLabDraftService(budgets, budgets),
          new DrizzleSliceRuleBudgetPoolBindingRepository(input.database as never));
        return createSliceRuleBudgetImpactHttpHandler({ service,
          resolvePrincipal: async () => bound.principal })(request);
      }
      const bound = await resolveTrustedLocalInstructionPolicyPrincipal({ request, database: input.database,
        config: input.config, requiredScope: operation === "read" ? "instruction_policy:read" : "instruction_policy:draft" });
      const repository = new DrizzleSliceRuleWorkspaceRepository(input.database as never);
      const service = new SliceRuleWorkspaceService(repository);
      const handlers = createSliceRuleWorkspaceHttpHandlers({ repository, service,
        resolveActor: async () => ({ principal: bound.principal, role: bound.membership.role }),
        now: input.now ?? (() => new Date().toISOString()) });
      return operation === "read" ? handlers.GET(request) : handlers.POST(request);
    } catch (reason) {
      return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
        ? sliceRuleWorkspaceSessionRequiredResponse() : sliceRuleWorkspaceNotConfiguredResponse();
    }
  };
  return Object.freeze({ GET: (request: Request) => execute(request, "read"),
    POST: (request: Request) => execute(request,
      ["slice-rule-budget-impact-preview", "slice-rule-budget-impact-save"].includes(
        request.headers.get("x-reklamzeka-intent") ?? "",
      ) ? "impact" : "draft") });
}
