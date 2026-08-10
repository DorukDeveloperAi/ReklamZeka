import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { AuthoritativeG3ReplayPreviewService, createAuthoritativeG3ReplayPreviewRepository } from
  "@/application/authoritative-g3-replay-preview-service";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { DrizzleProgressiveFormalizationRepository } from "@/connectors/guidance/progressive-formalization-drizzle-repository";
import { DrizzleInstructionPolicyImpactRepository } from "@/connectors/policies/instruction-policy-impact-drizzle-repository";
import { DrizzleInstructionPolicyLifecycleRepository } from "@/connectors/policies/instruction-policy-lifecycle-drizzle-repository";
import { DrizzleTrustedPolicyAuthorityRepository } from "@/connectors/policies/trusted-policy-authority-drizzle-repository";
import * as schema from "@/db/schema";
import type { WorkspaceMembership } from "@/security/authorization";

type Database = NodePgDatabase<typeof schema>;

/**
 * Server-private composition root.  Deliberately no HTTP, MCP, dashboard, or
 * mutation adapter is exported for this preview surface.
 */
export function createAuthoritativeG3ReplayPreviewService(input: Readonly<{
  database: Database;
  memberships: readonly WorkspaceMembership[];
}>): AuthoritativeG3ReplayPreviewService {
  const authority = new DrizzleTrustedPolicyAuthorityRepository(input.database);
  const contexts = new DrizzleEffectiveCampaignContextRepository(input.database);
  const lifecycle = new DrizzleInstructionPolicyLifecycleRepository(input.database);
  const formalizations = new DrizzleProgressiveFormalizationRepository(input.database);
  const impacts = new DrizzleInstructionPolicyImpactRepository(input.database);
  return new AuthoritativeG3ReplayPreviewService(createAuthoritativeG3ReplayPreviewRepository({
    authority: { loadAuthority: (request) => authority.load(request) },
    contexts: { loadHistoricalContext: (workspaceId, contextHash) => contexts.loadHistorical(workspaceId, contextHash) },
    lifecycle: { inspectLifecycle: (workspaceId) => lifecycle.inspect(workspaceId) },
    formalizations: { inspectFormalizations: (workspaceId) => formalizations.inspect(workspaceId) },
    impacts,
  }), input.memberships);
}
