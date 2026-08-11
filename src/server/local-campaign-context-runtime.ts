import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CampaignContextReadService } from "@/application/campaign-context-read-service";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import * as schema from "@/db/schema";
import { campaignContextNotConfiguredResponse, createCampaignContextHttpHandler, createCampaignContextListHttpHandler } from "@/server/campaign-context-http";
import { resolveTrustedLocalReadPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
type Database = NodePgDatabase<typeof schema>;
export function createLocalCampaignContextRouteHandler(input: Readonly<{ database: Pick<Database, "execute" | "select">; config: LocalDecisionRoomConfig }>) {
  return async (request: Request) => {
    try {
      const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database, config: input.config, requiredScope: "decision_room:read" });
      return createCampaignContextHttpHandler({ service: new CampaignContextReadService(new DrizzleEffectiveCampaignContextRepository(input.database as never)), workspaceId: async () => bound.principal.workspaceId })(request);
    } catch { return campaignContextNotConfiguredResponse(); }
  };
}
export function createLocalCampaignContextListRouteHandler(input: Readonly<{ database: Pick<Database, "execute" | "select">; config: LocalDecisionRoomConfig }>) {
  return async (request: Request) => {
    try {
      const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database, config: input.config, requiredScope: "decision_room:read" });
      return createCampaignContextListHttpHandler({ service: new CampaignContextReadService(new DrizzleEffectiveCampaignContextRepository(input.database as never)), workspaceId: async () => bound.principal.workspaceId })(request);
    } catch { return campaignContextNotConfiguredResponse(); }
  };
}
export { campaignContextNotConfiguredResponse };
