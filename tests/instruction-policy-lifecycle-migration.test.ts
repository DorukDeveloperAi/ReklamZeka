import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("drizzle/20260809194948_strict_instruction_policy_lifecycle.sql", "utf8");

describe("strict instruction policy lifecycle migration", () => {
  it("keeps raw provenance separate and revision records append-only", () => {
    expect(migration).toContain('CREATE TABLE "instruction_policy_raw_provenance"');
    expect(migration).toContain('CREATE TABLE "strict_instruction_policy_revisions"');
    expect(migration).toContain('"raw_text" text NOT NULL');
    expect(migration).not.toMatch(/strict_instruction_policy_revisions[\s\S]{0,900}"raw_text" text/i);
    expect(migration).toContain("strict_instruction_policy_revisions_append_only_trigger");
    expect(migration).toContain("instruction_policy_raw_provenance_append_only_trigger");
  });

  it("is journaled with the matching generated schema snapshot", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string }[] };
    const policy = journal.entries.find((entry) => entry.tag === "20260809194948_strict_instruction_policy_lifecycle");
    const advisedPractice = journal.entries.find((entry) => entry.tag === "20260809202132_advised_practice_standardization_lifecycle");
    expect(policy).toMatchObject({ idx: 41 });
    expect(advisedPractice?.idx).toBeGreaterThan(policy!.idx);
    expect(existsSync("drizzle/meta/20260809194948_snapshot.json")).toBe(true);
  });

  it("forces RLS and revokes every Supabase-facing role including service_role", () => {
    for (const table of ["instruction_policy_raw_provenance", "strict_instruction_policy_revisions"]) {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE ${table} FROM PUBLIC, anon, authenticated, service_role`);
    }
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON FUNCTION strict_instruction_policy_append_only() FROM PUBLIC, anon, authenticated, service_role");
  });

  it("permits instruction-policy invalidation facts without mutating frozen contexts", () => {
    expect(migration).toContain("effective_campaign_context_invalidations_type");
    expect(migration).toContain("'instruction_policy'");
    expect(migration).not.toMatch(/update\s+effective_campaign_contexts/i);
    expect(migration).not.toMatch(/delete\s+from\s+effective_campaign_contexts/i);
  });
});
