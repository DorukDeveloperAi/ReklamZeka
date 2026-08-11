import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const migration = readFileSync("drizzle/20260811160940_medical_black_cat.sql", "utf8");

describe("frozen diagnostic evidence substrate migration", () => {
  it("keeps the diagnostic input envelope private, tenant-bound, append-only and authority-free", () => {
    expect(migration).toContain('CREATE TABLE "frozen_diagnostic_evidence"');
    expect(migration).toContain("frozen_diagnostic_evidence_context_scope_fk");
    expect(migration).toContain('ALTER TABLE "frozen_diagnostic_evidence" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "frozen_diagnostic_evidence" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "frozen_diagnostic_evidence" FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain("frozen_diagnostic_evidence_append_only");
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
    expect(migration).toContain('"canAccessNetwork":false');
  });

  it("registers diagnostic evidence for a FK-safe tombstone purge", () => {
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain("frozen_diagnostic_evidence");
    const source = readFileSync("src/connectors/meta/workspace-tombstone-purge-drizzle-adapter.ts", "utf8");
    expect(source.indexOf("delete from frozen_diagnostic_evidence")).toBeLessThan(source.indexOf("delete from effective_campaign_contexts"));
  });
});
