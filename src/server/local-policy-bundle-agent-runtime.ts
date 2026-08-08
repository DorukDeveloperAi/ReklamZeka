import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  PolicyBundleAgentContract,
  type PolicyBundleAgentCall,
} from "@/application/policy-bundle-agent-contract";
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
import {
  resolveTrustedLocalReadPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";

type Database = NodePgDatabase<typeof schema>;

/**
 * Server-private bridge for a future MCP/CLI tool broker. It opens no route and
 * accepts no caller-selected workspace: the local capability and current DB
 * membership bind the principal before the shared studio service is assembled.
 */
export function createLocalPolicyBundleAgentAdapter(input: Readonly<{
  database: Database;
  config: LocalDecisionRoomConfig;
}>) {
  return Object.freeze({
    execute: async (request: Request, call: PolicyBundleAgentCall) => {
      const bound = await resolveTrustedLocalReadPrincipal({
        request,
        database: input.database,
        config: input.config,
        requiredScope: "policy_bundle:read",
      });
      const service = new PolicyBundleStudioService(
        new DrizzleApprovalPolicyRegistryRepository(input.database, input.config.workspaceId, input.config.workspaceRef),
        new DrizzleActionGuardrailPolicyRepository(input.database, input.config.workspaceId, input.config.workspaceRef),
        new DrizzleAutonomyRuleRegistryRepository(input.database, input.config.workspaceId, input.config.workspaceRef),
        new DrizzleExistingPostPromotionCatalogRepository(input.database),
        [bound.membership],
      );
      return new PolicyBundleAgentContract(service, [bound.membership]).execute(bound.principal, call);
    },
  });
}
