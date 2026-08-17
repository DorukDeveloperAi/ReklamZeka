import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
const source=readFileSync(resolve(process.cwd(),"src/connectors/meta/workspace-tombstone-purge-drizzle-adapter.ts"),"utf8");
const before=(a:string,b:string)=>expect(source.indexOf(a)).toBeLessThan(source.indexOf(b));
describe("P03/P04 workspace tombstone inventory and dependency order",()=>{
  it("inspects every immutable Guide and Slice table",()=>{
    for(const table of ["guide_activation_outbox","guide_lifecycle_events","guide_interpretation_acceptances","guide_revision_actions","guide_revision_budget_refs","guide_budget_contracts","guide_heads","guide_revisions","guides","meta_complete_snapshot_receipts","meta_change_snapshots","slice_resolution_snapshot_members","slice_resolution_snapshots","slice_revision_predicate_values","slice_revision_overrides","slice_revision_predicates","slice_revisions","slices"]) expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain(table);
  });
  it("purges evidence before every referenced entity parent",()=>{
    before("delete from guide_activation_outbox","delete from guide_revisions"); before("delete from guide_revisions","delete from guides");
    before("delete from guide_budget_contracts","delete from guide_revisions"); before("delete from meta_complete_snapshot_receipts","delete from meta_change_snapshots");
    before("delete from slice_resolution_snapshot_members","delete from organization_campaign_meta_memberships"); before("delete from slice_revision_overrides","delete from organization_campaigns"); before("delete from slices","delete from category_definitions");
  });
});
