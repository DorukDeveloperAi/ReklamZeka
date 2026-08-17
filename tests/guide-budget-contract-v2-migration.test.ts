import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "drizzle/20260817170000_guide_budget_contract_v2.sql"), "utf8");
describe("P04-Cb guide budget contract migration", () => {
  it("is additive, v2-explicit, immutable and private", () => {
    expect(sql).toContain("CREATE TABLE guide_budget_contracts");
    expect(sql).toContain("guide-budget-contract/2.0.0");
    expect(sql).toContain("guide budget contracts are append-only");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL PRIVILEGES ON TABLE guide_budget_contracts FROM PUBLIC, anon, authenticated, service_role");
    expect(sql).not.toContain("ALTER TABLE guide_revisions ADD");
  });
  it("has tenant-leftmost FK lookup and exact revision/market proof", () => {
    expect(sql).toContain("guide_budget_contracts_workspace_revision_fk_idx ON guide_budget_contracts(workspace_id,guide_revision_id)");
    expect(sql).toContain("FOREIGN KEY(workspace_id,guide_revision_id) REFERENCES guide_revisions(workspace_id,id)");
    expect(sql).toContain("r.revision_hash=NEW.guide_revision_hash AND r.market_key=NEW.market_key");
  });
  it("adds a forward-only completion receipt; historical snapshots cannot be inferred", () => {
    expect(sql).toContain("CREATE TABLE meta_complete_snapshot_receipts");
    expect(sql).toContain("meta_complete_snapshot_receipts_snapshot_scope_fk");
    expect(sql).toContain("completion receipt must bind exact immutable snapshot");
    expect(sql).toContain("meta_complete_snapshot_receipts_workspace_snapshot_fk_idx");
    expect(sql).toContain("ALTER TABLE meta_complete_snapshot_receipts FORCE ROW LEVEL SECURITY");
  });
});
