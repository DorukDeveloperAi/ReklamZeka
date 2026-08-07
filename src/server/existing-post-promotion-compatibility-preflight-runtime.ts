import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { ExistingPostPromotionCompatibilityPreflightRepository } from
  "@/application/existing-post-promotion-compatibility-preflight";
import { DrizzleMetaCompatibilityArtifactRepository } from
  "@/connectors/meta/promotion/compatibility-artifact-drizzle-repository";
import { DrizzleExistingPostPromotionCanonicalMaterialResolver } from
  "@/connectors/meta/promotion/existing-post-promotion-canonical-material-drizzle-resolver";
import { DrizzleExistingPostPromotionPreflightRepository } from
  "@/connectors/meta/promotion/existing-post-promotion-preflight-drizzle-repository";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

/** Server-private shared composition; it has no persistence or Meta transport method. */
export function createDrizzleExistingPostPromotionCompatibilityPreflight(input: Readonly<{
  database: Database; principal: TrustedDecisionRoomPrincipal;
}>) {
  return new ExistingPostPromotionCompatibilityPreflightRepository(input.principal,
    new DrizzleExistingPostPromotionPreflightRepository(input.database),
    new DrizzleExistingPostPromotionCanonicalMaterialResolver(input.database),
    new DrizzleMetaCompatibilityArtifactRepository(input.database, input.principal.workspaceId,
      input.principal.workspaceRef));
}
