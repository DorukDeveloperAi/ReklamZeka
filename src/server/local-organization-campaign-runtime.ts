import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { OrganizationCampaignService } from "@/application/organization-campaign-service";
import { DrizzleOrganizationCampaignRepository } from "@/connectors/campaigns/organization-campaign-drizzle-repository";
import { DrizzleCampaignClassificationReviewRepository } from "@/connectors/campaigns/campaign-classification-review-drizzle-repository";
import { createOrganizationCampaignHttpHandlers, organizationCampaignNotConfiguredResponse, organizationCampaignSessionRequiredResponse } from "@/server/organization-campaign-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalCategoryAuthoringPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";
type Database = NodePgDatabase<typeof schema>;
export function createLocalOrganizationCampaignHandlers(input: Readonly<{ database: Pick<Database, "transaction">; config: LocalDecisionRoomConfig }>) {
  const execute = async (request: Request, operation: "read" | "publish") => { try {
    const bound = await resolveTrustedLocalCategoryAuthoringPrincipal({ request, database: input.database as never, config: input.config,
      requiredScope: operation === "read" ? "category_registry:read" : "category_registry:publish" });
    const service = new OrganizationCampaignService(new DrizzleOrganizationCampaignRepository(input.database),
      new DrizzleCampaignClassificationReviewRepository(input.database), [bound.membership]);
    const handlers = createOrganizationCampaignHttpHandlers({ service, resolvePrincipal: async () => bound.principal });
    return operation === "read" ? handlers.GET(request) : handlers.POST(request);
  } catch (reason) { return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
    ? organizationCampaignSessionRequiredResponse() : organizationCampaignNotConfiguredResponse(); } };
  return Object.freeze({ GET: (request: Request) => execute(request, "read"), POST: (request: Request) => execute(request, "publish") });
}
