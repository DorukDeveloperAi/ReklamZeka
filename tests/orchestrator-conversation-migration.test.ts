import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from
  "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const migration = readFileSync("drizzle/20260813123350_majestic_george_stacy.sql", "utf8");
const catalogBindingMigration = readFileSync("drizzle/20260814140114_regular_steve_rogers.sql", "utf8");
const catalogBindingHardeningMigration = readFileSync("drizzle/20260814140309_mushy_boomerang.sql", "utf8");
const readOnlyEvidenceMigration = readFileSync("drizzle/20260814144129_orchestrator_readonly_evidence_context.sql", "utf8");
const skillRunMigration = readFileSync("drizzle/20260814145753_simple_masked_marvel.sql", "utf8");
const repository = readFileSync("src/connectors/agents/orchestrator-conversation-drizzle-repository.ts", "utf8");

describe("Orchestrator conversation ledger migration", () => {
  it("creates conversation/turn/message/tombstone storage with tenant-leftmost indexes", () => {
    for (const table of ["orchestrator_conversations", "orchestrator_conversation_turns",
      "orchestrator_conversation_messages", "orchestrator_conversation_tombstones"]) {
      expect(migration).toContain(`CREATE TABLE \"${table}\"`);
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE ${table} FROM PUBLIC, anon, authenticated, service_role`);
      expect(migration).toContain(`CREATE TRIGGER ${table}_immutable`);
      expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain(table);
    }
    expect(migration).toContain("orchestrator_conversation_messages_sequence_unique");
    expect(migration).toContain("orchestrator_conversation_tombstones_conversation_unique");
  });

  it("installs referenced unique indexes before composite foreign keys and permits only tombstone purge deletion", () => {
    expect(migration.indexOf("orchestrator_conversation_turns_workspace_conversation_ref_unique"))
      .toBeLessThan(migration.indexOf("orchestrator_conversation_messages_workspace_turn_fk"));
    expect(migration.indexOf("orchestrator_conversations_workspace_ref_unique"))
      .toBeLessThan(migration.indexOf("orchestrator_conversation_turns_workspace_conversation_fk"));
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
    expect(migration).toContain("orchestrator conversation ledger is append-only");
    expect(migration).toContain("SECURITY INVOKER SET search_path = ''");
    expect(migration).not.toMatch(/security definer/i);
  });

  it("extends the existing immutable turn ledger without backfilling legacy rows or exposing playbook text", () => {
    expect(catalogBindingMigration).toContain('ADD COLUMN "playbook_snapshots" jsonb DEFAULT \'[]\'::jsonb NOT NULL');
    expect(catalogBindingMigration).toContain("'LEGACY_NOT_RECORDED'");
    expect(catalogBindingMigration).toContain("'UNAVAILABLE_NOT_BOUND'");
    expect(catalogBindingHardeningMigration).toContain('"(body|content|prompt|token|secret|authorization)"');
    expect(catalogBindingHardeningMigration).toContain("'skill_catalog_unavailable'");
    expect(`${catalogBindingMigration}\n${catalogBindingHardeningMigration}`).not.toMatch(/grant\s+.*(?:anon|authenticated)|disable row level security/i);
    expect(repository).toContain("JSON.stringify(input.skillCatalogSnapshot.playbooks)");
    expect(repository).not.toContain("skillCatalogBinding");
  });

  it("adds an independent, fail-closed readonly evidence snapshot without weakening RLS or append-only storage", () => {
    expect(readOnlyEvidenceMigration).toContain('ADD COLUMN "evidence_context_snapshot" jsonb');
    expect(readOnlyEvidenceMigration).toContain('ADD COLUMN "evidence_context_hash" text');
    expect(readOnlyEvidenceMigration).toContain("'LEGACY_NOT_RECORDED'");
    expect(readOnlyEvidenceMigration).toContain("'UNAVAILABLE_NOT_BOUND'");
    expect(readOnlyEvidenceMigration).toContain('"(name|campaignRef|accountRef|spend|outcome|cpa|title|detail|action|sql|token|secret|authorization)"');
    expect(readOnlyEvidenceMigration).not.toMatch(/grant\s+.*(?:anon|authenticated)|disable row level security|drop trigger/i);
  });

  it("adds a selected-skill receipt independently of the mutable workspace catalog", () => {
    expect(skillRunMigration).toContain('ADD COLUMN "skill_run_snapshot" jsonb');
    expect(skillRunMigration).toContain('ADD COLUMN "skill_run_hash" text');
    expect(skillRunMigration).toContain("'receiptRef', 'receiptHash', 'evidenceContextHash', 'intent', 'selectedSkills'");
    expect(skillRunMigration).toContain('"(name|campaignRef|accountRef|spend|outcome|cpa|title|detail|action|sql|token|secret|authorization|prompt|policy|rule)"');
    expect(skillRunMigration).not.toMatch(/grant\s+.*(?:anon|authenticated)|disable row level security|drop trigger/i);
    expect(repository).toContain("JSON.stringify(input.skillRunSnapshot)");
    expect(repository).not.toContain("loadActive(");
  });
});
