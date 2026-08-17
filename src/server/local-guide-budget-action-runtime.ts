import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { GuideBudgetActionPreparationService } from "@/application/guide-budget-action-preparation-service";
import { DrizzleGuideBudgetActionTrustedContextRepository } from "@/connectors/guides/guide-budget-action-trusted-context-drizzle-repository";
import { DrizzleGuideBudgetEvidenceRepository } from "@/connectors/guides/guide-budget-evidence-drizzle-repository";
import { DrizzleOperationReadRepository } from "@/connectors/operations/operation-read-drizzle-repository";
import * as schema from "@/db/schema";
import type { GuideBudgetActionAdmissionGate } from "@/connectors/actions/action-execution-admission-source-drizzle-repository";

type Database = NodePgDatabase<typeof schema>;

/**
 * Private composition only. Callers receive no queue writer, approver, Meta
 * client, or route handler. Until the trusted-context adapter has a canonical
 * parent/pool ceiling, every prepare/admission request deterministically holds.
 */
export function createLocalGuideBudgetActionPreparationService(database: Database): GuideBudgetActionPreparationService {
  return new GuideBudgetActionPreparationService(
    new DrizzleGuideBudgetEvidenceRepository(database, new DrizzleOperationReadRepository(database)),
    new DrizzleGuideBudgetActionTrustedContextRepository(database),
  );
}

export function createLocalGuideBudgetAdmissionGate(database: Database): GuideBudgetActionAdmissionGate {
  return createLocalGuideBudgetActionPreparationService(database);
}
