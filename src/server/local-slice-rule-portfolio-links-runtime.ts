import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { DrizzleSliceRulePortfolioLinkReadRepository } from "@/connectors/campaigns/slice-rule-portfolio-link-drizzle-read-repository";
import * as schema from "@/db/schema";
import { resolveTrustedLocalInstructionPolicyPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createSliceRulePortfolioLinksHttpHandler } from "@/server/slice-rule-portfolio-links-http";

type Database = NodePgDatabase<typeof schema>;

export function createLocalSliceRulePortfolioLinksHandler(input: Readonly<{ database: Pick<Database, "select" | "execute">; config: LocalDecisionRoomConfig }>) {
  const repository = new DrizzleSliceRulePortfolioLinkReadRepository(input.database);
  return createSliceRulePortfolioLinksHttpHandler({ repository, resolvePrincipal: async (request) => (await resolveTrustedLocalInstructionPolicyPrincipal({ request,
    database: input.database as never, config: input.config, requiredScope: "instruction_policy:read" })).principal });
}
