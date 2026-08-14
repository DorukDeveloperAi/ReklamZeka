import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { CampaignClassificationReviewService } from "@/application/campaign-classification-review-service";
import { DrizzleCampaignClassificationReviewRepository } from "@/connectors/campaigns/campaign-classification-review-drizzle-repository";
import { campaignClassificationReviewNotConfiguredResponse, campaignClassificationReviewSessionRequiredResponse, createCampaignClassificationReviewHttpHandler } from "@/server/campaign-classification-review-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalCategoryRegistryPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";
type Database = NodePgDatabase<typeof schema>;
export function createLocalCampaignClassificationReviewHandler(input: Readonly<{ database: Pick<Database, "transaction">; config: LocalDecisionRoomConfig }>) { return async (request: Request) => { try { const bound = await resolveTrustedLocalCategoryRegistryPrincipal({ request, database: input.database as never, config: input.config }); return createCampaignClassificationReviewHttpHandler({ service: new CampaignClassificationReviewService(new DrizzleCampaignClassificationReviewRepository(input.database), [bound.membership]), resolvePrincipal: async () => bound.principal })(request); } catch (reason) { return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError ? campaignClassificationReviewSessionRequiredResponse() : campaignClassificationReviewNotConfiguredResponse(); } }; }
