-- Forward-only tombstone repair.  The normal Slice head may be released only
-- during a locked workspace purge; ordinary mutation remains append-only.
CREATE OR REPLACE FUNCTION public.slice_canonical_market_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'slices are append-only; only workspace tombstone purge is allowed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM category_definitions value JOIN category_dimensions dimension ON dimension.id=value.dimension_id AND dimension.workspace_id=value.workspace_id WHERE value.workspace_id=NEW.workspace_id AND value.id=NEW.market_definition_id AND value.archived_at IS NULL AND dimension.archived_at IS NULL AND dimension.key='market' AND value.key IN ('yerli','yabanci')) THEN RAISE EXCEPTION 'slice market must be an active canonical yerli/yabanci definition'; END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF OLD.tombstoned_at IS NULL AND NEW.tombstoned_at IS NOT NULL AND NEW.id=OLD.id AND NEW.workspace_id=OLD.workspace_id AND NEW.slice_ref=OLD.slice_ref AND NEW.label=OLD.label AND NEW.market_definition_id=OLD.market_definition_id AND NEW.created_by_actor_id=OLD.created_by_actor_id AND NEW.current_published_revision_id IS NOT DISTINCT FROM OLD.current_published_revision_id AND NEW.created_at=OLD.created_at THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') AND NEW.id=OLD.id AND NEW.workspace_id=OLD.workspace_id AND NEW.slice_ref=OLD.slice_ref AND NEW.label=OLD.label AND NEW.market_definition_id=OLD.market_definition_id AND NEW.created_by_actor_id=OLD.created_by_actor_id AND NEW.tombstoned_at IS NOT DISTINCT FROM OLD.tombstoned_at AND NEW.created_at=OLD.created_at AND OLD.current_published_revision_id IS NOT NULL AND NEW.current_published_revision_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.id=OLD.id AND NEW.workspace_id=OLD.workspace_id AND NEW.slice_ref=OLD.slice_ref AND NEW.label=OLD.label AND NEW.market_definition_id=OLD.market_definition_id AND NEW.created_by_actor_id=OLD.created_by_actor_id AND NEW.tombstoned_at IS NOT DISTINCT FROM OLD.tombstoned_at AND NEW.created_at=OLD.created_at AND NEW.current_published_revision_id IS DISTINCT FROM OLD.current_published_revision_id AND NEW.current_published_revision_id IS NOT NULL AND EXISTS (SELECT 1 FROM slice_revisions revision WHERE revision.id=NEW.current_published_revision_id AND revision.workspace_id=NEW.workspace_id AND revision.slice_id=NEW.id AND revision.lifecycle='published' AND revision.market_definition_id=NEW.market_definition_id) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'slices are append-only; only head advancement and tombstoning are allowed';
END;
$$;
REVOKE ALL PRIVILEGES ON FUNCTION public.slice_canonical_market_guard() FROM PUBLIC, anon, authenticated, service_role;
