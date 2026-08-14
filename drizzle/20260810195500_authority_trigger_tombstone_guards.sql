-- Earlier guard wrappers attempted to invoke a trigger function as an ordinary
-- function. PostgreSQL rejects that call before the tombstone exception can be
-- evaluated. Keep append-only enforcement, but make the tombstone exception a
-- normal helper that each trigger wrapper can safely use.
CREATE FUNCTION public.authority_substrate_tombstone_delete_allowed(target_workspace_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = target_workspace_id AND lifecycle_state = 'tombstoning'
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.account_group_revision_chain_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expected_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND public.authority_substrate_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'authority_substrate_append_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account_groups WHERE workspace_id = NEW.workspace_id AND id = NEW.account_group_id AND group_ref = NEW.group_ref) THEN RAISE EXCEPTION 'account_group_revision_identity_mismatch'; END IF;
  IF NEW.revision = 1 THEN
    IF EXISTS (SELECT 1 FROM public.account_group_revisions WHERE workspace_id = NEW.workspace_id AND group_ref = NEW.group_ref) THEN RAISE EXCEPTION 'account_group_revision_genesis_conflict'; END IF;
  ELSE
    SELECT revision_hash INTO expected_previous FROM public.account_group_revisions WHERE workspace_id = NEW.workspace_id AND group_ref = NEW.group_ref AND revision = NEW.revision - 1;
    IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN RAISE EXCEPTION 'account_group_revision_chain_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.account_group_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    IF public.authority_substrate_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'authority_substrate_append_only';
  END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.group_ref <> OLD.group_ref OR NEW.current_revision <> OLD.current_revision + 1
    OR NOT EXISTS (SELECT 1 FROM public.account_group_revisions revision WHERE revision.workspace_id = NEW.workspace_id AND revision.account_group_id = NEW.id AND revision.group_ref = NEW.group_ref AND revision.revision = NEW.current_revision AND revision.revision_hash = NEW.current_revision_hash) THEN RAISE EXCEPTION 'account_group_head_occ_conflict'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.policy_manual_lock_chain_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expected_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND public.authority_substrate_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'authority_substrate_append_only';
  END IF;
  IF NEW.sequence = 1 THEN
    IF EXISTS (SELECT 1 FROM public.policy_manual_lock_revisions WHERE policy_revision_id = NEW.policy_revision_id AND lock_ref = NEW.lock_ref) THEN RAISE EXCEPTION 'policy_manual_lock_genesis_conflict'; END IF;
  ELSE
    SELECT revision_hash INTO expected_previous FROM public.policy_manual_lock_revisions WHERE policy_revision_id = NEW.policy_revision_id AND lock_ref = NEW.lock_ref AND sequence = NEW.sequence - 1;
    IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN RAISE EXCEPTION 'policy_manual_lock_chain_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.action_unit_frozen_context_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE stored_context_hash text; unit_context_hash text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND public.authority_substrate_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'authority_substrate_append_only';
  END IF;
  SELECT context_hash INTO stored_context_hash FROM public.effective_campaign_contexts WHERE workspace_id = NEW.workspace_id AND id = NEW.context_id;
  SELECT context_hash INTO unit_context_hash FROM public.action_proposal_units WHERE workspace_id = NEW.workspace_id AND id = NEW.action_proposal_unit_id;
  IF stored_context_hash IS NULL OR unit_context_hash IS NULL OR stored_context_hash <> NEW.context_hash OR unit_context_hash <> NEW.context_hash THEN RAISE EXCEPTION 'action_unit_frozen_context_hash_mismatch'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.policy_authority_catalog_revision_chain_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expected_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND public.authority_substrate_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'authority_substrate_append_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.policy_authority_catalogs WHERE workspace_id = NEW.workspace_id AND catalog_ref = NEW.catalog_ref) THEN RAISE EXCEPTION 'policy_authority_catalog_missing_head'; END IF;
  IF NEW.revision = 1 THEN
    IF EXISTS (SELECT 1 FROM public.policy_authority_catalog_revisions WHERE workspace_id = NEW.workspace_id AND catalog_ref = NEW.catalog_ref) THEN RAISE EXCEPTION 'policy_authority_catalog_genesis_conflict'; END IF;
  ELSE
    SELECT revision_hash INTO expected_previous FROM public.policy_authority_catalog_revisions WHERE workspace_id = NEW.workspace_id AND catalog_ref = NEW.catalog_ref AND revision = NEW.revision - 1;
    IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN RAISE EXCEPTION 'policy_authority_catalog_chain_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.policy_authority_catalog_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    IF public.authority_substrate_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'authority_substrate_append_only';
  END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.catalog_ref <> OLD.catalog_ref OR NEW.current_revision <> OLD.current_revision + 1
    OR NOT EXISTS (SELECT 1 FROM public.policy_authority_catalog_revisions revision WHERE revision.workspace_id = NEW.workspace_id AND revision.catalog_ref = NEW.catalog_ref AND revision.revision = NEW.current_revision AND revision.revision_hash = NEW.current_revision_hash) THEN RAISE EXCEPTION 'policy_authority_catalog_head_occ_conflict'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.tenant_authority_snapshot_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE new_verified_at timestamptz; old_verified_at timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.authority_substrate_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'authority_substrate_append_only';
  END IF;
  SELECT verified_at INTO new_verified_at FROM public.tenant_authority_snapshots WHERE workspace_id = NEW.workspace_id AND id = NEW.current_snapshot_id AND snapshot_hash = NEW.current_snapshot_hash;
  IF new_verified_at IS NULL THEN RAISE EXCEPTION 'tenant_authority_snapshot_head_hash_mismatch'; END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.updated_at < OLD.updated_at THEN RAISE EXCEPTION 'tenant_authority_snapshot_head_occ_conflict'; END IF;
  SELECT verified_at INTO old_verified_at FROM public.tenant_authority_snapshots WHERE workspace_id = OLD.workspace_id AND id = OLD.current_snapshot_id;
  IF old_verified_at IS NULL OR new_verified_at <= old_verified_at THEN RAISE EXCEPTION 'tenant_authority_snapshot_head_occ_conflict'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.authority_topic_revision_chain_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expected_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND public.authority_substrate_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'authority_substrate_append_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.authority_topics WHERE workspace_id = NEW.workspace_id AND id = NEW.topic_id AND topic_ref = NEW.topic_ref) THEN RAISE EXCEPTION 'authority_topic_revision_identity_mismatch'; END IF;
  IF NEW.revision = 1 THEN
    IF EXISTS (SELECT 1 FROM public.authority_topic_revisions WHERE workspace_id = NEW.workspace_id AND topic_ref = NEW.topic_ref) THEN RAISE EXCEPTION 'authority_topic_revision_genesis_conflict'; END IF;
  ELSE
    SELECT revision_hash INTO expected_previous FROM public.authority_topic_revisions WHERE workspace_id = NEW.workspace_id AND topic_ref = NEW.topic_ref AND revision = NEW.revision - 1;
    IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN RAISE EXCEPTION 'authority_topic_revision_chain_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.authority_topic_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    IF public.authority_substrate_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'authority_substrate_append_only';
  END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.topic_ref <> OLD.topic_ref OR NEW.current_revision <> OLD.current_revision + 1
    OR NOT EXISTS (SELECT 1 FROM public.authority_topic_revisions revision WHERE revision.workspace_id = NEW.workspace_id AND revision.topic_id = NEW.id AND revision.topic_ref = NEW.topic_ref AND revision.revision = NEW.current_revision AND revision.revision_hash = NEW.current_revision_hash) THEN RAISE EXCEPTION 'authority_topic_head_occ_conflict'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.authority_semantic_binding_chain_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expected_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND public.authority_substrate_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'authority_substrate_append_only';
  END IF;
  IF NEW.revision = 1 THEN
    IF EXISTS (SELECT 1 FROM public.policy_semantic_binding_revisions WHERE policy_revision_id = NEW.policy_revision_id AND semantic_ref = NEW.semantic_ref) THEN RAISE EXCEPTION 'policy_semantic_binding_genesis_conflict'; END IF;
  ELSE
    SELECT revision_hash INTO expected_previous FROM public.policy_semantic_binding_revisions WHERE policy_revision_id = NEW.policy_revision_id AND semantic_ref = NEW.semantic_ref AND revision = NEW.revision - 1;
    IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN RAISE EXCEPTION 'policy_semantic_binding_chain_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.authority_substrate_tombstone_delete_allowed(uuid) FROM PUBLIC, anon, authenticated, service_role;
