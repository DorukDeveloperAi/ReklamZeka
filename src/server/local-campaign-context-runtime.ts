import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CampaignContextReadService } from "@/application/campaign-context-read-service";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import * as schema from "@/db/schema";
import { campaignContextNotConfiguredResponse, campaignContextSessionRequiredResponse, createCampaignContextHttpHandler, createCampaignContextListHttpHandler } from "@/server/campaign-context-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalReadPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";
type Database = NodePgDatabase<typeof schema>;
function localReadFailure(reason: unknown) {
  return reason instanceof LocalSessionCapabilityError
    || reason instanceof LocalDecisionRoomBoundaryError && reason.code === "untrusted_request"
    ? campaignContextSessionRequiredResponse()
    : campaignContextNotConfiguredResponse();
}
export function createLocalCampaignContextRouteHandler(input: Readonly<{ database: Pick<Database, "execute" | "select">; config: LocalDecisionRoomConfig }>) {
  return async (request: Request) => {
    try {
      const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database, config: input.config, requiredScope: "decision_room:read" });
      return createCampaignContextHttpHandler({ service: new CampaignContextReadService(new DrizzleEffectiveCampaignContextRepository(input.database as never)), workspaceId: async () => bound.principal.workspaceId })(request);
    } catch (reason) { return localReadFailure(reason); }
  };
}
export function createLocalCampaignContextListRouteHandler(input: Readonly<{ database: Pick<Database, "execute" | "select">; config: LocalDecisionRoomConfig }>) {
  return async (request: Request) => {
    try {
      const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database, config: input.config, requiredScope: "decision_room:read" });
      return createCampaignContextListHttpHandler({ service: new CampaignContextReadService(new DrizzleEffectiveCampaignContextRepository(input.database as never)), workspaceId: async () => bound.principal.workspaceId })(request);
    } catch (reason) { return localReadFailure(reason); }
  };
}
export { campaignContextNotConfiguredResponse };
