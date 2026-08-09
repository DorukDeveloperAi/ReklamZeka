import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { PromotionTemplateAuthoringService } from "@/application/promotion-template-authoring";
import { DrizzlePublishedPromotionTemplateCatalog } from
  "@/connectors/meta/promotion/published-promotion-template-catalog-drizzle";
import * as schema from "@/db/schema";
import {
  createPromotionTemplateAuthoringHttpHandlers,
  promotionTemplateAuthoringNotConfiguredResponse,
} from "@/server/promotion-template-authoring-http";
import {
  resolveTrustedLocalReadPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";

type Database = NodePgDatabase<typeof schema>;

/** Cookie-only read/dry-run assembly. It exposes no registry publication or Meta transport. */
export function createLocalPromotionTemplateAuthoringHandlers(input: Readonly<{
  database: Pick<Database, "execute">;
  config: LocalDecisionRoomConfig;
}>) {
  async function bind(request: Request) {
    if (request.headers.has("authorization") || !request.headers.get("cookie")) throw new Error("local_session_required");
    const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database, config: input.config,
      requiredScope: "promotion_catalog:read" });
    const catalog = new DrizzlePublishedPromotionTemplateCatalog(
      input.database,
      input.config.workspaceId,
      input.config.workspaceRef,
    );
    return Object.freeze({
      principal: bound.principal,
      service: new PromotionTemplateAuthoringService(catalog, input.config.workspaceRef, [bound.membership]),
    });
  }

  function handler(request: Request) {
    let bound: Awaited<ReturnType<typeof bind>> | null = null;
    const service = {
      inspect: async (...args: Parameters<PromotionTemplateAuthoringService["inspect"]>) => {
        if (!bound) throw new Error("principal_unavailable");
        return bound.service.inspect(...args);
      },
      dryRun: async (...args: Parameters<PromotionTemplateAuthoringService["dryRun"]>) => {
        if (!bound) throw new Error("principal_unavailable");
        return bound.service.dryRun(...args);
      },
    };
    return createPromotionTemplateAuthoringHttpHandlers({ service, origin: input.config.origin,
      resolvePrincipal: async () => {
        bound = await bind(request);
        return bound.principal;
      } });
  }

  return Object.freeze({
    GET: async (request: Request) => handler(request).GET(request),
    POST: async (request: Request) => handler(request).POST(request),
  });
}

export { promotionTemplateAuthoringNotConfiguredResponse };
