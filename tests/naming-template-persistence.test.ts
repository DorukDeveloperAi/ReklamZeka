import { readFileSync } from "node:fs";
import { getTableName } from "drizzle-orm";
import { describe,expect,it } from "vitest";
import { namingTemplateHeads,namingTemplateRevisions } from "@/db/schema";
import { CATEGORY_JSONB_MANIFEST } from "@/domain/categories/category-dependency-manifest";
import { INSTRUCTION_POLICY_JSONB_MANIFEST } from "@/domain/policies/instruction-policy-dependency-manifest";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
const migration=readFileSync("drizzle/20260818000900_naming_template_lifecycle.sql","utf8");
describe("naming template persistence",()=>{
  it("keeps schema, security and tombstone parity",()=>{expect(getTableName(namingTemplateRevisions)).toBe("naming_template_revisions");expect(getTableName(namingTemplateHeads)).toBe("naming_template_heads");expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY[\s\S]*FORCE ROW LEVEL SECURITY/);expect(migration).toContain("REVOKE ALL ON TABLE");expect(WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("naming_template_heads")).toBeLessThan(WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("naming_template_revisions"));});
  it("classifies proposal JSON as opaque category context and no policy",()=>{expect(CATEGORY_JSONB_MANIFEST).toContainEqual({table:"naming_template_revisions",column:"template_payload",policy:"opaque_category_context"});expect(INSTRUCTION_POLICY_JSONB_MANIFEST).toContainEqual({table:"naming_template_revisions",column:"template_payload",policy:"policy_absent"});});
  it("enforces exact lifecycle and closed authority in SQL",()=>{expect(migration).toContain("old_r.state='draft'");expect(migration).toContain("old_r.state='published'");expect(migration).toContain("canWriteMeta");expect(migration).toContain("naming template hash invalid");});
});
