import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { PolicyBundlePublicationService } from "@/application/policy-bundle-publication-service";
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
import { SingleUseHumanPresenceChallengeStore } from "@/security/human-presence-challenge";
import type { HumanPresenceConfirmationInput } from "@/security/macos-human-presence-ceremony";
import { resolveTrustedLocalPolicyBundlePrincipal, type LocalDecisionRoomConfig } from
  "@/server/local-decision-room-runtime";
import { createPolicyBundleStudioHttpHandlers, policyBundleStudioNotConfiguredResponse } from
  "@/server/policy-bundle-studio-http";
import { createPolicyBundlePublicationHttpHandler } from "@/server/policy-bundle-publication-http";

type Database = NodePgDatabase<typeof schema>;
export function createLocalPolicyBundleStudioHandlers(input: Readonly<{ database: Database;
  config: LocalDecisionRoomConfig;
  ceremony: Readonly<{ confirm(input: HumanPresenceConfirmationInput): Promise<boolean> }>;
  challengeStore?: SingleUseHumanPresenceChallengeStore }>) {
  const store = input.challengeStore ?? new SingleUseHumanPresenceChallengeStore();
  const approvals = new DrizzleApprovalPolicyRegistryRepository(input.database, input.config.workspaceId, input.config.workspaceRef);
  const guardrails = new DrizzleActionGuardrailPolicyRepository(input.database, input.config.workspaceId, input.config.workspaceRef);
  const execute = async (request: Request, operation: "read" | "draft" | "publish") => {
    try {
      const bound = await resolveTrustedLocalPolicyBundlePrincipal({ request, database: input.database,
        config: input.config, requiredScope: operation === "read" ? "policy_bundle:read"
          : operation === "draft" ? "policy_bundle:draft" : "policy_bundle:publish" });
      if (operation === "publish") {
        const service = new PolicyBundlePublicationService(approvals, guardrails, store, [bound.membership]);
        return createPolicyBundlePublicationHttpHandler({ service, store, origin: input.config.origin,
          resolvePrincipal: async () => bound.principal,
          confirmHumanPresence: (confirmation) => input.ceremony.confirm(confirmation) })(request);
      }
      const service = new PolicyBundleStudioService(
        approvals, guardrails,
        new DrizzleAutonomyRuleRegistryRepository(input.database, input.config.workspaceId, input.config.workspaceRef),
        new DrizzleExistingPostPromotionCatalogRepository(input.database), [bound.membership]);
      const handlers = createPolicyBundleStudioHttpHandlers({ service, resolvePrincipal: async () => bound.principal });
      return operation === "read" ? handlers.GET(request) : handlers.POST(request);
    } catch { return policyBundleStudioNotConfiguredResponse(); }
  };
  return { GET: (request: Request) => execute(request, "read"),
    POST: (request: Request) => execute(request, request.headers.get("x-reklamzeka-intent")?.startsWith("policy-bundle-publish-")
      || request.headers.get("x-reklamzeka-intent") === "policy-bundle-confirm-human-presence" ? "publish" : "draft") };
}
