import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "drizzle/20260807140801_sleepy_marrow.sql";

describe("decision ledger PostgreSQL persistence contract", () => {
  it("is additive, private and orders the self-scope unique index before its FK", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain('CREATE TABLE "decision_ledger_records"');
    expect(migration).toContain('ALTER TABLE "decision_ledger_records" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "decision_ledger_records" FROM PUBLIC, anon, authenticated',
    );
    expect(migration.indexOf("decision_ledger_records_workspace_row_unique"))
      .toBeLessThan(migration.indexOf("decision_ledger_records_analysis_scope_fk"));
    expect(migration).toContain("decision_ledger_records_context_scope_fk");
    expect(migration).toContain("decision_ledger_records_payload_exact");
    expect(migration).toContain("decision_ledger_records_no_forbidden_material");
    expect(migration).toContain("decision_ledger_records_no_authority_escalation");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|DROP CONSTRAINT|TRUNCATE|DELETE FROM/);
  });

  it("keeps token/raw/prompt and action-authority guards fail closed in SQL", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toMatch(/token\|secret\|prompt/);
    expect(migration).toMatch(/raw\[_-\]\?/);
    expect(migration).toContain("canexecutewrite");
    expect(migration).toContain("approvalgranted");
    expect(migration).toContain("jsonb_path_exists");
    expect(migration).toContain("is true");
  });
});
