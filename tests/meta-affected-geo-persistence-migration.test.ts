import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../drizzle/20260807212434_meta_affected_geo_persistence.sql", import.meta.url), "utf8");
const tables = ["meta_affected_geo_snapshots", "meta_affected_geo_snapshot_items",
  "meta_affected_geo_snapshot_location_types"] as const;

describe("canonical Meta affected-geo persistence migration", () => {
  it("uses tenant-composite hierarchy/child FKs and tenant-leftmost indexes", () => {
    expect(migration).toContain('FOREIGN KEY ("workspace_id","ad_set_id","campaign_id","ad_account_id")');
    expect(migration).toContain('REFERENCES "public"."meta_ad_sets"("workspace_id","id","campaign_id","ad_account_id")');
    expect(migration.match(/FOREIGN KEY \("workspace_id","snapshot_id"\)/g)).toHaveLength(2);
    expect(migration).toContain('(\"workspace_id\",\"snapshot_id\",\"polarity\",\"geo_type\",\"geo_ref\")');
    expect(migration).toContain('(\"workspace_id\",\"ad_account_id\",\"campaign_id\",\"ad_set_id\",\"captured_at\")');
    expect(migration.indexOf('CREATE UNIQUE INDEX "meta_affected_geo_snapshots_workspace_id_unique"'))
      .toBeLessThan(migration.indexOf('ADD CONSTRAINT "meta_affected_geo_snapshot_items_workspace_snapshot_fk"'));
    expect(migration.indexOf('CREATE UNIQUE INDEX "meta_ad_sets_workspace_hierarchy_unique"'))
      .toBeLessThan(migration.indexOf('ADD CONSTRAINT "meta_affected_geo_snapshots_workspace_hierarchy_fk"'));
  });

  it("forces RLS, revokes API roles, and blocks UPDATE on all immutable tables", () => {
    for (const table of tables) {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE ${table} FROM PUBLIC, anon, authenticated`);
      expect(migration).toContain(`BEFORE UPDATE ON ${table}`);
    }
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON FUNCTION meta_affected_geo_append_only() FROM PUBLIC, anon, authenticated");
    expect(migration).not.toMatch(/SECURITY\s+DEFINER|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*meta_affected_geo/i);
  });

  it("persists exact known/hash provenance without raw geo or targeting fields", () => {
    for (const column of ["workspace_ref", "account_ref", "campaign_ref", "ad_set_ref", "schema_version",
      "source_graph_version", "field_catalog_version", "captured_at", "observation_run_ref", "slice_ref", "page_ref",
      "raw_payload_hash", "source_geo_subtree_hash", "snapshot_hash"]) expect(migration).toContain(`\"${column}\"`);
    expect(migration).toContain('"status" = \'known\'');
    expect(migration).toContain('"polarity" = \'included\'');
    expect(migration).toContain('"geo_type" = \'country\'');
    expect(migration).not.toMatch(/"(?:country_code|country_name|address|latitude|longitude|coordinates|free_text|targeting|raw_targeting)"/i);
  });
});
