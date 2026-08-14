import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("skill catalog migration", () => {
  const migration = readFileSync("drizzle/20260814123749_smiling_adam_warlock.sql", "utf8");

  it("keeps workspace catalog records private, RLS-forced, and append-only", () => {
    for (const table of ["orchestrator_profile_revisions", "orchestrator_playbook_revisions"]) {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE ${table} FROM PUBLIC, anon, authenticated, service_role`);
    }
    expect(migration).toContain("SECURITY INVOKER SET search_path = ''");
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
  });

  it("uses the existing guidance source chain and binds immutable turn snapshots", () => {
    expect(migration).toContain('REFERENCES "public"."guidance_sources"("workspace_id","id")');
    expect(migration).toContain('"profile_snapshot" jsonb');
    expect(migration).toContain('"manifest_snapshots" jsonb');
    expect(migration).toContain('"skill_catalog_binding_hash" text');
    expect(migration).not.toMatch(/create table "(?:official|source)_/i);
  });
});
