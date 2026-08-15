import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { TemporalCohortAvailability, TemporalCohortAvailabilityLoader } from "@/application/orchestrator-readonly-evidence-context";
import * as schema from "@/db/schema";

type Database = Pick<NodePgDatabase<typeof schema>, "execute">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Row = Readonly<{ cohort_present: unknown; cohort_ready: unknown; cohort_equivalent: unknown; cohort_mixed_market: unknown; cohort_fresh: unknown; open_alert: unknown }>;

function row(value: unknown): Row {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows) || value.rows.length !== 1) throw new Error("corrupt_store");
  const result = value.rows[0] as Row;
  if (typeof result.cohort_present !== "boolean" || typeof result.cohort_ready !== "boolean" || typeof result.cohort_equivalent !== "boolean" || typeof result.cohort_mixed_market !== "boolean" || typeof result.cohort_fresh !== "boolean" || typeof result.open_alert !== "boolean") throw new Error("corrupt_store");
  return result;
}

/**
 * Aggregate-only server read over immutable cohort assets and current alert
 * heads. Historical assets without an explicit immutable scope proof remain
 * unproven; only the normal materializer path can produce an equivalent receipt.
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
        select count(*) > 0 as present,
          bool_and(
          jsonb_typeof(result_payload->'assessments') = 'array'
          and jsonb_array_length(result_payload->'assessments') >= 4
          and not jsonb_path_exists(result_payload, '$.assessments[*] ? (@.status == "insufficient_data")')
        ) as ready,
        bool_and(
          equivalence_scope is not null
          and equivalence_scope->>'version' = 'cohort-equivalence-scope/1.0.0'
          and equivalence_scope->>'market' in ('domestic', 'international')
          and equivalence_scope->>'serviceHash' ~ '^[a-f0-9]{64}$'
          and equivalence_scope->>'audienceHash' ~ '^[a-f0-9]{64}$'
          and equivalence_scope->>'platformHash' ~ '^[a-f0-9]{64}$'
        ) as equivalent,
        count(distinct equivalence_scope->>'market') filter (where equivalence_scope is not null) > 1 as mixed_market,
        bool_and(occurred_at >= now() - interval '30 days') as fresh
        from public.robust_cohort_diagnostic_assets
        where workspace_id = ${input.workspaceId}::uuid
      ) select cohort.present as cohort_present, coalesce(cohort.ready, false) as cohort_ready, coalesce(cohort.equivalent, false) as cohort_equivalent, coalesce(cohort.mixed_market, false) as cohort_mixed_market, coalesce(cohort.fresh, false) as cohort_fresh,
        exists (select 1 from latest_alert where status <> 'resolved') as open_alert from cohort
    `));
    const delivery = result.open_alert ? "open_alert" as const : "clear" as const;
    const freshness = result.cohort_fresh ? "fresh" as const : "stale" as const;
    const equivalence = result.cohort_mixed_market ? "mixed_market" as const : result.cohort_equivalent ? "equivalent" as const : "unproven" as const;
    return Object.freeze({ state: result.cohort_ready && result.cohort_equivalent && !result.cohort_mixed_market && !result.open_alert && result.cohort_fresh ? "ready" : "insufficient", equivalence, delivery, freshness });
  }
}
