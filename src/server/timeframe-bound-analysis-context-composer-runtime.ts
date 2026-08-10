import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { TimeframeBoundAnalysisContextComposer } from "@/application/timeframe-bound-analysis-context-composer";
import { DrizzleDeterministicWindowSnapshotRepository } from "@/connectors/analyses/deterministic-window-snapshot-drizzle-repository";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

/** Server-private construction only; no route, MCP tool, action or Meta transport is exposed. */
export function createDrizzleTimeframeBoundAnalysisContextComposer(input: Readonly<{
  database: Database;
  now?: () => Date;
}>): TimeframeBoundAnalysisContextComposer {
  const contexts = new DrizzleEffectiveCampaignContextRepository(input.database);
  return new TimeframeBoundAnalysisContextComposer(
    contexts,
    new DrizzleDeterministicWindowSnapshotRepository(input.database),
    contexts,
    input.now,
  );
}
