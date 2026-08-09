import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { PromotionTemplateAuthoringService } from "@/application/promotion-template-authoring";
import { PromotionTemplateLifecycleService } from "@/application/promotion-template-lifecycle-service";
import { DrizzlePromotionTemplateLifecycleRepository } from
  "@/connectors/meta/promotion/promotion-template-lifecycle-drizzle-repository";
import { DrizzlePublishedPromotionTemplateCatalog } from
  "@/connectors/meta/promotion/published-promotion-template-catalog-drizzle";
import * as schema from "@/db/schema";
import {
  createPromotionTemplateAuthoringHttpHandlers,
  createPromotionTemplateLifecycleHttpHandlers,
  promotionTemplateAuthoringNotConfiguredResponse,
} from "@/server/promotion-template-authoring-http";
import {
  resolveTrustedLocalReadPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";

type Database = NodePgDatabase<typeof schema>;

/** Cookie-only read/dry-run assembly. It exposes no registry publication or Meta transport. */
export function createLocalPromotionTemplateAuthoringHandlers(input: Readonly<{
  database: Database;
  config: LocalDecisionRoomConfig;
}>) {
  async function bind(request: Request) {
    if (request.headers.has("authorization") || !request.headers.get("cookie")) throw new Error("local_session_required");
    const lifecycleMutation = request.method === "POST"
      && request.headers.get("x-reklamzeka-intent")?.startsWith("promotion-template-lifecycle-");
    const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database, config: input.config,
      requiredScope: lifecycleMutation ? "promotion_proposal:draft" : "promotion_catalog:read" });
    const catalog = new DrizzlePublishedPromotionTemplateCatalog(
      input.database,
      input.config.workspaceId,
      input.config.workspaceRef,
    );
    return Object.freeze({
      principal: bound.principal,
      service: new PromotionTemplateAuthoringService(catalog, input.config.workspaceRef, [bound.membership]),
      lifecycle: new PromotionTemplateLifecycleService(
        new DrizzlePromotionTemplateLifecycleRepository(input.database), catalog, [bound.membership],
      ),
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
    const preview = createPromotionTemplateAuthoringHttpHandlers({ service, origin: input.config.origin,
      resolvePrincipal: async () => {
        bound = await bind(request);
        return bound.principal;
      } });
    const lifecycle = createPromotionTemplateLifecycleHttpHandlers({ service: {
      inspect: async (...args: Parameters<PromotionTemplateLifecycleService["inspect"]>) => {
        if (!bound) throw new Error("principal_unavailable");
        return bound.lifecycle.inspect(...args);
      },
      mutate: async (...args: Parameters<PromotionTemplateLifecycleService["mutate"]>) => {
        if (!bound) throw new Error("principal_unavailable");
        return bound.lifecycle.mutate(...args);
      },
    }, origin: input.config.origin, resolvePrincipal: async () => {
      bound = await bind(request);
      return bound.principal;
    } });
    return { preview, lifecycle };
  }

  return Object.freeze({
    GET: async (request: Request) => request.headers.get("x-reklamzeka-intent") === "promotion-template-lifecycle-read"
      ? handler(request).lifecycle.GET(request) : handler(request).preview.GET(request),
    POST: async (request: Request) => request.headers.get("x-reklamzeka-intent")?.startsWith("promotion-template-lifecycle-")
      ? handler(request).lifecycle.POST(request) : handler(request).preview.POST(request),
  });
}

export { promotionTemplateAuthoringNotConfiguredResponse };
