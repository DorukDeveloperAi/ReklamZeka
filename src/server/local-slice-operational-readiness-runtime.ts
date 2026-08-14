import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { SliceOperationalReadinessService } from "@/application/slice-operational-readiness-service";
import { DrizzleCampaignClassificationReviewRepository } from "@/connectors/campaigns/campaign-classification-review-drizzle-repository";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { DrizzleBudgetProposalRepository } from "@/connectors/budget/budget-proposal-drizzle-repository";
import { FrozenContextBudgetImpactScopeResolver } from "@/connectors/campaigns/frozen-context-budget-impact-scope-resolver";
import { createSliceOperationalReadinessHttpHandler, sliceOperationalReadinessNotConfiguredResponse, sliceOperationalReadinessSessionRequiredResponse } from "@/server/slice-operational-readiness-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalCategoryRegistryPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
export function createLocalSliceOperationalReadinessHandler(input: Readonly<{ database: Database; config: LocalDecisionRoomConfig }>) {
  return async (request: Request) => {
    try {
      const bound = await resolveTrustedLocalCategoryRegistryPrincipal({ request, database: input.database, config: input.config });
      const frozen = new DrizzleBudgetProposalRepository(input.database);
      const service = new SliceOperationalReadinessService(new DrizzleCampaignClassificationReviewRepository(input.database),
        new DrizzleEffectiveCampaignContextRepository(input.database), new FrozenContextBudgetImpactScopeResolver(frozen), [bound.membership]);
      return createSliceOperationalReadinessHttpHandler({ service, resolvePrincipal: async () => bound.principal })(request);
    } catch (reason) {
      return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
        ? sliceOperationalReadinessSessionRequiredResponse() : sliceOperationalReadinessNotConfiguredResponse();
    }
  };
}
