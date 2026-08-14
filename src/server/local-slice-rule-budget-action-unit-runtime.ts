import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { createSliceRuleBudgetActionUnitHttpHandlers } from "@/server/slice-rule-budget-action-unit-http";
import { resolveTrustedLocalSliceRuleBudgetImpactPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
type Database = NodePgDatabase<typeof schema>;
export function createLocalSliceRuleBudgetActionUnitHandlers(input: Readonly<{ database: Pick<Database, "select" | "insert" | "execute" | "transaction">; config: LocalDecisionRoomConfig }>) {
  const handlers = createSliceRuleBudgetActionUnitHttpHandlers({ database: input.database, resolvePrincipal: async (request) => (await resolveTrustedLocalSliceRuleBudgetImpactPrincipal({ request, database: input.database, config: input.config })).principal });
  return Object.freeze({ GET: handlers.GET, POST: handlers.POST });
}
