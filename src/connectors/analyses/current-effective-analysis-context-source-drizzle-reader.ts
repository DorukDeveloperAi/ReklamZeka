import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { EffectiveAnalysisContextNotReadySource, EffectiveAnalysisContextRequest,
  EffectiveAnalysisContextSource } from "@/application/effective-analysis-context-composer";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rows(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new Error("invalid_store_result");
  }
  return value.rows as readonly Readonly<Record<string, unknown>>[];
}

function inputIsValid(input: EffectiveAnalysisContextRequest): boolean {
  return UUID.test(input.workspaceId) && input.accountRef.trim().length > 0 && input.entityRef.trim().length > 0
    && ["campaign", "ad_set", "ad", "creative"].includes(input.entityType);
}

const NO_SOURCE_CAPABILITIES = Object.freeze({
  canCompose: false as const, canAuthorizeAction: false as const, canExecute: false as const,
  canExecuteWrite: false as const, canWriteMeta: false as const,
  canApprove: false as const, canSchedule: false as const, canCallTool: false as const,
  canAccessNetwork: false as const, canQuerySql: false as const,
});

/**
 * Server-private current-source checkpoint. It proves the active tenant and
 * account scope in one short repeatable/read-only transaction, then deliberately
 * reports not_ready: there is not yet a single transaction-local reader for
 * every config, guidance, data/history, category, lifecycle, and authority
 * component required for a valid context bundle.
 */
export class DrizzleCurrentEffectiveAnalysisContextSourceReader {
  constructor(private readonly database: Database) {}

  async loadCurrent(input: EffectiveAnalysisContextRequest): Promise<EffectiveAnalysisContextSource> {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 4
      || !inputIsValid(input)) throw new Error("invalid_input");
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      await tx.execute(sql`set transaction isolation level repeatable read, read only`);
      const scope = rows(await tx.execute(sql`
        select to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as captured_at
        from workspaces workspace
        join ad_accounts account on account.workspace_id = workspace.id
          and account.external_account_id = ${input.accountRef}
        where workspace.id = ${input.workspaceId}::uuid and workspace.lifecycle_state = 'active'
        limit 2
      `));
      if (scope.length !== 1 || typeof scope[0]!.captured_at !== "string") throw new Error("scope_not_found");
      const capturedAt = scope[0]!.captured_at;
      if (!Number.isFinite(Date.parse(capturedAt)) || new Date(capturedAt).toISOString() !== capturedAt) throw new Error("corrupt_store");
      const unavailable: EffectiveAnalysisContextNotReadySource = Object.freeze({
        status: "not_ready", capturedAt, reason: "current_source_bundle_unavailable", capabilities: NO_SOURCE_CAPABILITIES,
      });
      return unavailable;
    });
  }
}
