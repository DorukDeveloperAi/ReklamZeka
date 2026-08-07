import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../drizzle/20260807215739_medical_thena.sql", import.meta.url), "utf8");

describe("ApprovalPolicy proposal lifetime migration boundary", () => {
  it("fails closed if policy history appears after the reviewed zero-row preflight", () => {
    const guard = migration.indexOf('IF EXISTS (SELECT 1 FROM "approval_policy_definition_revisions")');
    const snapshotGuard = migration.indexOf('OR EXISTS (SELECT 1 FROM "action_approval_policy_snapshots")');
    const firstMutation = migration.indexOf('ALTER TABLE "action_approval_policy_snapshots" DROP CONSTRAINT');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(snapshotGuard).toBeGreaterThan(guard);
    expect(firstMutation).toBeGreaterThan(snapshotGuard);
    expect(migration).toContain("automatic backfill is forbidden");
  });

  it("requires the explicit integer-compatible 1..604800 value in definitions and queue snapshots", () => {
    expect(migration.match(/\? 'maximumProposalLifetimeSeconds'/g)).toHaveLength(2);
    expect(migration.match(/maximumProposalLifetimeSeconds}'\) = 'number'/g)).toHaveLength(2);
    expect(migration.match(/between 1 and 604800/g)).toHaveLength(2);
    expect(migration).toContain('ADD CONSTRAINT "approval_policy_definition_revisions_policy_exact"');
    expect(migration).toContain('ADD CONSTRAINT "action_approval_policy_snapshots_payload_exact"');
  });

  it("contains no seed, default, or data rewrite", () => {
    expect(migration).not.toMatch(/\b(?:insert|update|delete)\b/i);
    expect(migration).not.toMatch(/\bdefault\b/i);
  });
});
