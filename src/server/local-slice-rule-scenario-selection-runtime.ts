import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { DrizzleSliceRuleScenarioAllocationSelectionRepository } from "@/connectors/campaigns/slice-rule-scenario-allocation-selection-drizzle-repository";
import { createSliceRuleScenarioSelectionHttpHandlers } from "@/server/slice-rule-scenario-selection-http";
import { resolveTrustedLocalSliceRuleBudgetImpactPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
type Database = NodePgDatabase<typeof schema>;
export function createLocalSliceRuleScenarioSelectionHandlers(input: Readonly<{ database: Pick<Database, "select" | "insert" | "execute" | "transaction">; config: LocalDecisionRoomConfig }>) {
  const repository = new DrizzleSliceRuleScenarioAllocationSelectionRepository(input.database as never);
  return createSliceRuleScenarioSelectionHttpHandlers({ repository, resolvePrincipal: async (request) => (await resolveTrustedLocalSliceRuleBudgetImpactPrincipal({ request, database: input.database, config: input.config })).principal, now: () => new Date().toISOString() });
}
