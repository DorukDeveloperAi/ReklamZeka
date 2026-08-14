import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { BudgetImpactContextCandidateService } from "@/application/slice-rule-budget-impact-context-candidate-service";
import { DrizzleBudgetProposalRepository } from "@/connectors/budget/budget-proposal-drizzle-repository";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { FrozenContextBudgetImpactScopeResolver } from "@/connectors/campaigns/frozen-context-budget-impact-scope-resolver";
import { DrizzleSliceRuleBudgetPoolBindingRepository } from "@/connectors/campaigns/slice-rule-budget-pool-binding-drizzle-repository";
import { DrizzleSliceRuleWorkspaceRepository } from "@/connectors/campaigns/slice-rule-workspace-drizzle-repository";
import { DrizzleSliceRuleBudgetImpactTemplateRepository } from "@/connectors/campaigns/slice-rule-budget-impact-template-drizzle-repository";
import * as schema from "@/db/schema";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalSliceRuleBudgetImpactPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createSliceRuleBudgetImpactContextCandidatesHttpHandler, sliceRuleBudgetImpactContextCandidatesNotConfiguredResponse, sliceRuleBudgetImpactContextCandidatesSessionRequiredResponse } from "@/server/slice-rule-budget-impact-context-candidates-http";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
export function createLocalSliceRuleBudgetImpactContextCandidatesHandler(input: Readonly<{ database: Pick<Database, "select" | "insert" | "execute" | "transaction">; config: LocalDecisionRoomConfig }>) {
  return async (request: Request) => {
    try {
      const bound = await resolveTrustedLocalSliceRuleBudgetImpactPrincipal({ request, database: input.database as never, config: input.config });
      const budgets = new DrizzleBudgetProposalRepository(input.database as never);
      const service = new BudgetImpactContextCandidateService(new DrizzleSliceRuleWorkspaceRepository(input.database as never),
        new DrizzleEffectiveCampaignContextRepository(input.database as never), new FrozenContextBudgetImpactScopeResolver(budgets),
        new DrizzleSliceRuleBudgetPoolBindingRepository(input.database as never), new DrizzleSliceRuleBudgetImpactTemplateRepository(input.database as never), [bound.membership]);
      return createSliceRuleBudgetImpactContextCandidatesHttpHandler({ service, resolvePrincipal: async () => bound.principal })(request);
    } catch (reason) {
      return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
        ? sliceRuleBudgetImpactContextCandidatesSessionRequiredResponse() : sliceRuleBudgetImpactContextCandidatesNotConfiguredResponse();
    }
  };
}
