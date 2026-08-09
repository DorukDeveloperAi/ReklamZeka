import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { guidanceAnalysisRunBindings } from "@/db/schema";

const migration = readFileSync(
  new URL("../drizzle/20260809205228_spotty_rogue.sql", import.meta.url),
  "utf8",
);
const connector = readFileSync(
  new URL("../src/connectors/analyses/decision-room-analysis-registry-drizzle.ts", import.meta.url),
  "utf8",
);

describe("guidance analysis-run binding persistence", () => {
  it("freezes exact set/card/source revisions and hashes behind a tenant-bound run FK", () => {
    expect(getTableName(guidanceAnalysisRunBindings)).toBe("guidance_analysis_run_bindings");
    expect(getTableColumns(guidanceAnalysisRunBindings)).toMatchObject({
      workspaceId: expect.anything(), runId: expect.anything(), registryHash: expect.anything(),
      packHash: expect.anything(), selectedSetRefs: expect.anything(), cardRefs: expect.anything(),
      sourceRefs: expect.anything(), bindingHash: expect.anything(), authority: expect.anything(),
    });
    const config = getTableConfig(guidanceAnalysisRunBindings);
    expect(config.foreignKeys.map((key) => key.getName()))
      .toContain("guidance_analysis_run_bindings_run_scope_fk");
    expect(config.checks.map((check) => check.name))
      .toEqual(expect.arrayContaining(["guidance_analysis_run_bindings_hashes",
        "guidance_analysis_run_bindings_guidance_only", "guidance_analysis_run_bindings_no_forbidden_material"]));
    expect(connector).toContain("jsonb_to_recordset");
    expect(connector).toContain("persisted.record_hash = expected.\"recordHash\"");
    expect(connector).toContain("on conflict (workspace_id, run_id) do nothing");
    expect(migration).toContain("guidance_revision_refs_exact(\"selected_set_refs\", 'setRef')");
    expect(migration).toContain("guidance_revision_refs_exact(\"card_refs\", 'cardRef')");
    expect(migration).toContain("guidance_revision_refs_exact(\"source_refs\", 'sourceRef')");
  });

  it("keeps the binding server-private with FORCE RLS and all Data API roles revoked", () => {
    expect(migration).toContain('ALTER TABLE "guidance_analysis_run_bindings" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "guidance_analysis_run_bindings" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "guidance_analysis_run_bindings" FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON guidance_analysis_run_bindings");
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON FUNCTION guidance_analysis_run_binding_immutable() FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain("'account_group', 'account', 'objective', 'funnel', 'optimization'");
    expect(migration).toContain("'internal_category', 'lifecycle', 'entity', 'promotion_template', 'topic'");
    for (const table of ["guidance_sources", "guidance_cards", "guidance_bindings", "guidance_sets"]) {
      expect(migration).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`CREATE TRIGGER ${table}_append_only_trigger BEFORE UPDATE OR DELETE ON ${table}`);
    }
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "guidance_sources", "guidance_cards", "guidance_bindings", "guidance_sets"');
    expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role");
  });
});
