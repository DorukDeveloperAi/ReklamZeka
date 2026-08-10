import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { EffectiveAnalysisContextComposer } from "@/application/effective-analysis-context-composer";
import { DrizzleCurrentEffectiveAnalysisContextSourceReader } from "@/connectors/analyses/current-effective-analysis-context-source-drizzle-reader";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

/**
 * Server-private composition root for frozen analysis contexts. Both the
 * current-source reader and append-only writer receive the same database
 * boundary. There is deliberately no HTTP, MCP, action, or caller-facts seam.
 */
export function createDrizzleEffectiveAnalysisContextComposer(input: Readonly<{
  database: Database;
}>): EffectiveAnalysisContextComposer {
  return new EffectiveAnalysisContextComposer(
    new DrizzleCurrentEffectiveAnalysisContextSourceReader(input.database),
    new DrizzleEffectiveCampaignContextRepository(input.database),
  );
}
