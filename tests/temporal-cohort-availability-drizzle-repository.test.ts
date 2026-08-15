import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { DrizzleTemporalCohortAvailabilityRepository } from "@/connectors/analyses/temporal-cohort-availability-drizzle-repository";

const workspaceId = "00000000-0000-4000-8000-000000000101";

function repository(row: Record<string, boolean>) {
  return new DrizzleTemporalCohortAvailabilityRepository({ execute: vi.fn(async () => ({ rows: [row] })) } as never);
}

describe("DrizzleTemporalCohortAvailabilityRepository", () => {
  it("keeps historical scope-less cohort assets unproven even when their calculations are otherwise ready", async () => {
    await expect(repository({ cohort_present: true, cohort_ready: true, cohort_equivalent: false, cohort_mixed_market: false, cohort_fresh: true, open_alert: false }).load({ workspaceId }))
      .resolves.toEqual({ state: "insufficient", equivalence: "unproven", delivery: "clear", freshness: "fresh" });
  });

  it("allows readiness only when the aggregate verifier reports one explicit, fresh, clear scope", async () => {
    await expect(repository({ cohort_present: true, cohort_ready: true, cohort_equivalent: true, cohort_mixed_market: false, cohort_fresh: true, open_alert: false }).load({ workspaceId }))
      .resolves.toEqual({ state: "ready", equivalence: "equivalent", delivery: "clear", freshness: "fresh" });
  });

  it("fails closed for mixed markets, stale assets, and open delivery alerts", async () => {
    await expect(repository({ cohort_present: true, cohort_ready: true, cohort_equivalent: true, cohort_mixed_market: true, cohort_fresh: true, open_alert: false }).load({ workspaceId }))
      .resolves.toMatchObject({ state: "insufficient", equivalence: "mixed_market" });
    await expect(repository({ cohort_present: true, cohort_ready: true, cohort_equivalent: true, cohort_mixed_market: false, cohort_fresh: false, open_alert: false }).load({ workspaceId }))
      .resolves.toMatchObject({ state: "insufficient", freshness: "stale" });
    await expect(repository({ cohort_present: true, cohort_ready: true, cohort_equivalent: true, cohort_mixed_market: false, cohort_fresh: true, open_alert: true }).load({ workspaceId }))
      .resolves.toMatchObject({ state: "insufficient", delivery: "open_alert" });
  });

  it("verifies all assets together, preventing separate old/new assets from being combined into a ready receipt", async () => {
    const calls: string[] = []; const dialect = new PgDialect();
    const database = { execute: vi.fn(async (query) => { calls.push(dialect.sqlToQuery(query).sql); return { rows: [{ cohort_present: true, cohort_ready: true, cohort_equivalent: false, cohort_mixed_market: false, cohort_fresh: false, open_alert: false }] }; }) };
    await new DrizzleTemporalCohortAvailabilityRepository(database as never).load({ workspaceId });
    expect(calls[0]).toContain("bool_and");
    expect(calls[0]).toContain("count(distinct equivalence_scope->>'market')");
  });
});
