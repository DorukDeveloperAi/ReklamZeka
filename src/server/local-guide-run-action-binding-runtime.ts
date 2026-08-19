import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { DrizzleGuideRunActionBindingRepository } from "@/connectors/guides/guide-run-action-binding-drizzle-repository";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

/** Private P06 composition. This exposes only immutable materialization; it
 * intentionally has no approval decision, executor, or Meta client. */
export function createLocalGuideRunActionBindingMaterializer(database: Database) {
  return new DrizzleGuideRunActionBindingRepository(database);
}
