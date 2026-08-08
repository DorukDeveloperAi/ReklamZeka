import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ExistingPostPromotionProposalDraftService } from "@/application/existing-post-promotion-proposal-draft-service";
import { ExistingPostPromotionPublicPreflightService } from "@/application/existing-post-promotion-preflight-service";
import * as schema from "@/db/schema";
import { createExistingPostPromotionProposalDraftHttpHandler, existingPostPromotionProposalDraftNotConfiguredResponse } from "@/server/existing-post-promotion-proposal-draft-http";
import { resolveTrustedLocalReadPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createDrizzleExistingPostPromotionCanonicalSubmitter } from
  "@/server/existing-post-promotion-drizzle-submitter";
import { createDrizzleExistingPostPromotionCompatibilityPreflight } from
  "@/server/existing-post-promotion-compatibility-preflight-runtime";
type Database = NodePgDatabase<typeof schema>;
export function createLocalExistingPostPromotionProposalDraftRouteHandler(input: Readonly<{ database: Database; config: LocalDecisionRoomConfig }>) {
  return async function POST(request: Request) { try {
    if (request.headers.has("authorization") || !request.headers.get("cookie")) return existingPostPromotionProposalDraftNotConfiguredResponse();
    const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database, config: input.config, requiredScope: "promotion_proposal:draft" });
    const service = new ExistingPostPromotionProposalDraftService(new ExistingPostPromotionPublicPreflightService(
      createDrizzleExistingPostPromotionCompatibilityPreflight({ database: input.database, principal: bound.principal })),
    createDrizzleExistingPostPromotionCanonicalSubmitter({ database: input.database,
      principal: bound.principal, membership: bound.membership }), [bound.membership]);
    return createExistingPostPromotionProposalDraftHttpHandler({ service, origin: input.config.origin, resolvePrincipal: async () => bound.principal })(request);
  } catch { return existingPostPromotionProposalDraftNotConfiguredResponse(); } };
}
