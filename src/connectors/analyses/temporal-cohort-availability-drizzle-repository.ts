import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { TemporalCohortAvailability, TemporalCohortAvailabilityLoader } from "@/application/orchestrator-readonly-evidence-context";
import * as schema from "@/db/schema";

type Database = Pick<NodePgDatabase<typeof schema>, "execute">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Row = Readonly<{ cohort_ready: unknown; cohort_fresh: unknown; open_alert: unknown }>;

function row(value: unknown): Row {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows) || value.rows.length !== 1) throw new Error("corrupt_store");
  const result = value.rows[0] as Row;
  if (typeof result.cohort_ready !== "boolean" || typeof result.cohort_fresh !== "boolean" || typeof result.open_alert !== "boolean") throw new Error("corrupt_store");
  return result;
}

/**
 * Aggregate-only server read over immutable cohort assets and current alert
 * heads. Existing cohort assets do not carry an explicit domestic/international
 * proof, so this adapter deliberately never upgrades equivalence beyond
 * `unproven`; a later market-bound asset can do so without changing receipts.
 */
export class DrizzleTemporalCohortAvailabilityRepository implements TemporalCohortAvailabilityLoader {
  constructor(private readonly database: Database) {}

  async load(input: Readonly<{ workspaceId: string }>): Promise<TemporalCohortAvailability> {
    if (!UUID.test(input.workspaceId)) throw new Error("invalid_input");
    const result = row(await this.database.execute(sql`
      with latest_alert as (
        select distinct on (alert_ref) status
        from public.delivery_health_alert_ledger_records
        where workspace_id = ${input.workspaceId}::uuid
        order by alert_ref, sequence desc
      ), cohort as (
        select bool_or(
          jsonb_typeof(result_payload->'assessments') = 'array'
          and jsonb_array_length(result_payload->'assessments') >= 4
          and not jsonb_path_exists(result_payload, '$.assessments[*] ? (@.status == "insufficient_data")')
        ) as ready,
        bool_or(occurred_at >= now() - interval '30 days') as fresh
        from public.robust_cohort_diagnostic_assets
        where workspace_id = ${input.workspaceId}::uuid
      ) select coalesce(cohort.ready, false) as cohort_ready, coalesce(cohort.fresh, false) as cohort_fresh,
        exists (select 1 from latest_alert where status <> 'resolved') as open_alert from cohort
    `));
    const delivery = result.open_alert ? "open_alert" as const : "clear" as const;
    const freshness = result.cohort_fresh ? "fresh" as const : "stale" as const;
    // No existing immutable asset binds a market label. Never infer it from a hash.
    return Object.freeze({ state: "insufficient", equivalence: "unproven", delivery, freshness });
  }
}
