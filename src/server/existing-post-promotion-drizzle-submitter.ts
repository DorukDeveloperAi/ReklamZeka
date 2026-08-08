import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { ExistingPostPromotionCanonicalSubmitter } from
  "@/application/existing-post-promotion-canonical-submitter";
import { ExistingPostPromotionProtectionEvidenceMaterializer } from
  "@/application/existing-post-promotion-protection-evidence-materializer";
import { DrizzleActionGuardrailPolicyRepository } from
  "@/connectors/actions/action-guardrail-policy-drizzle-repository";
import { DrizzleActionProposalQueueRepository } from
  "@/connectors/actions/action-proposal-queue-drizzle-repository";
import { DrizzleApprovalPolicyRegistryRepository } from
  "@/connectors/actions/approval-policy-registry-drizzle-repository";
import { createDrizzleAuthenticAffectedGeoEvidenceAdapter } from
  "@/connectors/actions/authentic-affected-geo-evidence-adapter";
import { createDrizzleAuthenticCategoryEvidenceAdapter } from
  "@/connectors/actions/authentic-category-evidence-adapter";
import { DrizzleAutonomyRuleRegistryRepository } from
  "@/connectors/actions/autonomy-rule-registry-drizzle-repository";
import { DrizzleMetaCompatibilityArtifactRepository } from
  "@/connectors/meta/promotion/compatibility-artifact-drizzle-repository";
import { DrizzleExistingPostPromotionCanonicalMaterialResolver } from
  "@/connectors/meta/promotion/existing-post-promotion-canonical-material-drizzle-resolver";
import * as schema from "@/db/schema";
import type { WorkspaceMembership } from "@/security/authorization";
import { ExistingPostPromotionPolicyAdapter, type ExistingPostPromotionMembershipPort } from
  "@/server/existing-post-promotion-policy-adapter";

type Database = NodePgDatabase<typeof schema>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;

export class ExistingPostPromotionDrizzleSubmitterError extends Error {
  constructor(readonly code: "invalid_binding") {
    super("Mevcut gönderi Drizzle submitter güvenli biçimde bağlanamadı");
    this.name = "ExistingPostPromotionDrizzleSubmitterError";
  }
}

function samePrincipal(left: TrustedDecisionRoomPrincipal, right: TrustedDecisionRoomPrincipal): boolean {
  return left.actor.userId === right.actor.userId && left.workspaceId === right.workspaceId
    && left.workspaceRef === right.workspaceRef && left.readerRef === right.readerRef;
}

class RequestBoundMembership implements ExistingPostPromotionMembershipPort {
  constructor(private readonly principal: TrustedDecisionRoomPrincipal,
    private readonly membership: WorkspaceMembership) {}
  async resolve(candidate: TrustedDecisionRoomPrincipal): Promise<WorkspaceMembership | null> {
    return samePrincipal(candidate, this.principal) ? this.membership : null;
  }
}

/**
 * Request-bound server composition. Construction is read/write silent; the only write-capable dependency is
 * the append-only proposal queue. It exposes no approval, execution or Meta transport method.
 */
export function createDrizzleExistingPostPromotionCanonicalSubmitter(input: Readonly<{
  database: Database;
  principal: TrustedDecisionRoomPrincipal;
  membership: WorkspaceMembership;
}>): ExistingPostPromotionCanonicalSubmitter {
  const { database, principal, membership } = input;
  if (!database || !UUID.test(principal.workspaceId) || !UUID.test(principal.actor.userId)
    || !REF.test(principal.workspaceRef) || !REF.test(principal.readerRef)
    || membership.userId !== principal.actor.userId || membership.workspaceId !== principal.workspaceId) {
    throw new ExistingPostPromotionDrizzleSubmitterError("invalid_binding");
  }
  const evidence = new ExistingPostPromotionProtectionEvidenceMaterializer(
    createDrizzleAuthenticCategoryEvidenceAdapter({ database, workspaceId: principal.workspaceId,
      workspaceRef: principal.workspaceRef }),
    createDrizzleAuthenticAffectedGeoEvidenceAdapter({ database, workspaceId: principal.workspaceId,
      workspaceRef: principal.workspaceRef }),
  );
  const policy = new ExistingPostPromotionPolicyAdapter(
    new DrizzleApprovalPolicyRegistryRepository(database, principal.workspaceId, principal.workspaceRef),
    new DrizzleAutonomyRuleRegistryRepository(database, principal.workspaceId, principal.workspaceRef),
    evidence,
    new DrizzleActionGuardrailPolicyRepository(database, principal.workspaceId, principal.workspaceRef),
    new RequestBoundMembership(principal, membership),
  );
  return new ExistingPostPromotionCanonicalSubmitter(
    new DrizzleExistingPostPromotionCanonicalMaterialResolver(database),
    new DrizzleMetaCompatibilityArtifactRepository(database, principal.workspaceId, principal.workspaceRef),
    policy,
    new DrizzleActionProposalQueueRepository(database, principal.workspaceId),
  );
}
