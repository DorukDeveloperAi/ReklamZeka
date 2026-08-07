import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { PolicyBundleStudioService } from "@/application/policy-bundle-studio-service";
import { DrizzleActionGuardrailPolicyRepository } from
  "@/connectors/actions/action-guardrail-policy-drizzle-repository";
import { DrizzleApprovalPolicyRegistryRepository } from
  "@/connectors/actions/approval-policy-registry-drizzle-repository";
import { DrizzleAutonomyRuleRegistryRepository } from
  "@/connectors/actions/autonomy-rule-registry-drizzle-repository";
import { DrizzleExistingPostPromotionCatalogRepository } from
  "@/connectors/meta/promotion/existing-post-promotion-catalog-drizzle-repository";
import * as schema from "@/db/schema";
import { resolveTrustedLocalPolicyBundlePrincipal, type LocalDecisionRoomConfig } from
  "@/server/local-decision-room-runtime";
import { createPolicyBundleStudioHttpHandlers, policyBundleStudioNotConfiguredResponse } from
  "@/server/policy-bundle-studio-http";

type Database = NodePgDatabase<typeof schema>;
export function createLocalPolicyBundleStudioHandlers(input: Readonly<{ database: Database;
  config: LocalDecisionRoomConfig }>) {
  const execute = async (request: Request, operation: "read" | "draft") => {
    try {
      const bound = await resolveTrustedLocalPolicyBundlePrincipal({ request, database: input.database,
        config: input.config, requiredScope: operation === "read" ? "policy_bundle:read" : "policy_bundle:draft" });
      const service = new PolicyBundleStudioService(
        new DrizzleApprovalPolicyRegistryRepository(input.database, input.config.workspaceId, input.config.workspaceRef),
        new DrizzleActionGuardrailPolicyRepository(input.database, input.config.workspaceId, input.config.workspaceRef),
        new DrizzleAutonomyRuleRegistryRepository(input.database, input.config.workspaceId, input.config.workspaceRef),
        new DrizzleExistingPostPromotionCatalogRepository(input.database), [bound.membership]);
      const handlers = createPolicyBundleStudioHttpHandlers({ service, resolvePrincipal: async () => bound.principal });
      return operation === "read" ? handlers.GET(request) : handlers.POST(request);
    } catch { return policyBundleStudioNotConfiguredResponse(); }
  };
  return { GET: (request: Request) => execute(request, "read"), POST: (request: Request) => execute(request, "draft") };
}
