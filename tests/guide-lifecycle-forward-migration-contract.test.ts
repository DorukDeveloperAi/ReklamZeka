import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql=readFileSync(resolve(process.cwd(),"drizzle/20260817151000_guide_lifecycle_integrity_forward.sql"),"utf8");
describe("P04-B forward guide integrity migration",()=>{
  it("adds/backfills exact predecessor and canonical market proof without weakening RLS",()=>{
    expect(sql).toContain("ADD COLUMN previous_revision_hash"); expect(sql).toContain("ADD COLUMN market_key");
    expect(sql).toContain("SET previous_revision_hash=p.revision_hash"); expect(sql).toContain("SET market_key=d.key");
    expect(sql).toContain("guide market key must match canonical definition"); expect(sql).toContain("guide source and previous hash must exactly match");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.guide_revision_guard()");
    expect(sql).toContain("guide revision must bind one current published same-market slice revision");
    expect(sql).toContain("parent.tombstoned_at IS NULL");
    expect(sql).toContain("parent.current_published_revision_id=NEW.slice_revision_id");
    expect(sql).toContain("lifecycle_state='tombstoning'");
    expect(sql).toContain("REVOKE ALL PRIVILEGES ON FUNCTION public.guide_revision_guard()");
    expect(sql).not.toContain("DROP TRIGGER guide_revisions_append_only");
  });
  it("adds the 13 documented tenant-leftmost composite-FK indexes",()=>{
    const names=["guides_workspace_slice_market_fk_idx","guides_workspace_creator_fk_idx","guide_revisions_workspace_guide_market_fk_idx","guide_revisions_workspace_slice_revision_fk_idx","guide_revisions_workspace_source_fk_idx","guide_revisions_workspace_creator_fk_idx","guide_interpretation_acceptances_workspace_actor_fk_idx","guide_heads_workspace_latest_fk_idx","guide_heads_workspace_active_fk_idx","guide_lifecycle_events_workspace_revision_fk_idx","guide_lifecycle_events_workspace_actor_fk_idx","guide_activation_outbox_workspace_guide_fk_idx","guide_activation_outbox_workspace_revision_fk_idx"];
    expect(names).toHaveLength(13); for(const name of names) expect(sql).toContain(`CREATE INDEX ${name} ON`);
  });
  it("backfills before non-null enforcement and preserves the applied security boundary",()=>{
    expect(sql.indexOf("SET previous_revision_hash=p.revision_hash")).toBeLessThan(sql.indexOf("ADD CONSTRAINT guide_revisions_previous_market_forward"));
    expect(sql.indexOf("SET market_key=d.key")).toBeLessThan(sql.indexOf("ALTER TABLE guide_revisions ALTER COLUMN market_key SET NOT NULL"));
    const applied=readFileSync(resolve(process.cwd(),"drizzle/20260817143000_canonical_guide_lifecycle.sql"),"utf8");
    expect(applied).toContain("ALTER TABLE guide_revisions FORCE ROW LEVEL SECURITY");
    expect(applied).toContain("REVOKE ALL PRIVILEGES ON TABLE guides,guide_revisions");
  });
  it("runs only after the applied canonical lifecycle migration",()=>expect(sql.length).toBeGreaterThan(500));
});
