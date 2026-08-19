import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("drizzle/20260817100152_next_goblin_queen.sql", "utf8");
describe("organization campaign migration", () => {
  it("uses canonical tenant category market evidence, not a parallel market taxonomy", () => {
    expect(migration).toContain('"market_definition_id" uuid NOT NULL');
    expect(migration).toContain('REFERENCES "public"."category_definitions"("workspace_id","id")');
    expect(migration).toContain("dimension.key = 'market'");
    expect(migration).toContain("definition.key in ('yerli', 'yabanci')");
    expect(migration).not.toContain("organization_campaign_market");
  });
  it("makes temporal membership tenant-bound, exclusive, dark, and append-only", () => {
    expect(migration).toContain('organization_campaign_meta_memberships_no_overlap');
    expect(migration).toContain("EXCLUDE USING gist");
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "organization_campaign_meta_memberships" FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).not.toContain("CREATE POLICY organization_campaign");
    expect(migration).toContain("organization campaign Meta memberships are append-only");
    expect(migration).toContain("OLD.effective_to is null AND NEW.effective_to is not null");
    expect(migration).toContain("campaign market evidence is missing or conflicts");
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
  });
});
