-- P04-B forward-only preflight. Apply is deliberately gated by the main runner.
ALTER TABLE guide_revisions ADD COLUMN previous_revision_hash text;
ALTER TABLE guide_revisions ADD COLUMN market_key text;
UPDATE guide_revisions r SET previous_revision_hash=p.revision_hash FROM guide_revisions p WHERE p.workspace_id=r.workspace_id AND p.id=r.source_revision_id;
UPDATE guide_revisions r SET market_key=d.key FROM category_definitions d WHERE d.workspace_id=r.workspace_id AND d.id=r.market_definition_id;
ALTER TABLE guide_revisions ALTER COLUMN market_key SET NOT NULL;
ALTER TABLE guide_revisions ADD CONSTRAINT guide_revisions_previous_market_forward CHECK ((previous_revision_hash is null or previous_revision_hash ~ '^[a-f0-9]{64}$') and market_key in ('yerli','yabanci'));
-- Composite-FK audit: every tenant-scoped dependency has an exact workspace-leftmost lookup index.
CREATE INDEX guides_workspace_slice_market_fk_idx ON guides(workspace_id,slice_id,market_definition_id);
CREATE INDEX guides_workspace_creator_fk_idx ON guides(workspace_id,created_by_actor_id);
CREATE INDEX guide_revisions_workspace_guide_market_fk_idx ON guide_revisions(workspace_id,guide_id,guide_ref,market_definition_id);
CREATE INDEX guide_revisions_workspace_slice_revision_fk_idx ON guide_revisions(workspace_id,slice_revision_id);
CREATE INDEX guide_revisions_workspace_source_fk_idx ON guide_revisions(workspace_id,source_revision_id,guide_id);
CREATE INDEX guide_revisions_workspace_creator_fk_idx ON guide_revisions(workspace_id,created_by_actor_id);
CREATE INDEX guide_interpretation_acceptances_workspace_actor_fk_idx ON guide_interpretation_acceptances(workspace_id,accepted_by_actor_id);
CREATE INDEX guide_heads_workspace_latest_fk_idx ON guide_heads(workspace_id,latest_revision_id,guide_id);
CREATE INDEX guide_heads_workspace_active_fk_idx ON guide_heads(workspace_id,current_active_revision_id,guide_id);
CREATE INDEX guide_lifecycle_events_workspace_revision_fk_idx ON guide_lifecycle_events(workspace_id,guide_revision_id,guide_id);
CREATE INDEX guide_lifecycle_events_workspace_actor_fk_idx ON guide_lifecycle_events(workspace_id,actor_id);
CREATE INDEX guide_activation_outbox_workspace_guide_fk_idx ON guide_activation_outbox(workspace_id,guide_id);
CREATE INDEX guide_activation_outbox_workspace_revision_fk_idx ON guide_activation_outbox(workspace_id,guide_revision_id,guide_id);
-- Preserve the applied guard's published-slice and tombstone-delete semantics; add only forward proof.
CREATE OR REPLACE FUNCTION public.guide_revision_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN
   IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'guide revisions are append-only';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM guides g JOIN slices parent ON parent.workspace_id=g.workspace_id AND parent.id=g.slice_id JOIN slice_revisions s ON s.workspace_id=g.workspace_id AND s.id=NEW.slice_revision_id WHERE g.workspace_id=NEW.workspace_id AND g.id=NEW.guide_id AND g.guide_ref=NEW.guide_ref AND g.market_definition_id=NEW.market_definition_id AND g.tombstoned_at IS NULL AND parent.tombstoned_at IS NULL AND parent.current_published_revision_id=NEW.slice_revision_id AND s.slice_id=g.slice_id AND s.slice_ref=NEW.slice_ref AND s.market_definition_id=g.market_definition_id AND s.lifecycle='published') THEN RAISE EXCEPTION 'guide revision must bind one current published same-market slice revision'; END IF;
 IF NOT EXISTS(SELECT 1 FROM category_definitions d JOIN category_dimensions dim ON dim.workspace_id=d.workspace_id AND dim.id=d.dimension_id WHERE d.workspace_id=NEW.workspace_id AND d.id=NEW.market_definition_id AND dim.key='market' AND d.key=NEW.market_key) THEN RAISE EXCEPTION 'guide market key must match canonical definition'; END IF;
 IF NEW.revision_number=1 AND NEW.source_revision_id IS NULL AND NEW.previous_revision_hash IS NULL AND NOT EXISTS(SELECT 1 FROM guide_revisions r WHERE r.workspace_id=NEW.workspace_id AND r.guide_id=NEW.guide_id) THEN RETURN NEW; END IF;
 IF NEW.source_revision_id IS NOT NULL AND EXISTS(SELECT 1 FROM guide_revisions p WHERE p.workspace_id=NEW.workspace_id AND p.id=NEW.source_revision_id AND p.guide_id=NEW.guide_id AND p.revision_number=NEW.revision_number-1 AND p.revision_hash=NEW.previous_revision_hash) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'guide source and previous hash must exactly match';
END; $$;
REVOKE ALL PRIVILEGES ON FUNCTION public.guide_revision_guard() FROM PUBLIC, anon, authenticated, service_role;
