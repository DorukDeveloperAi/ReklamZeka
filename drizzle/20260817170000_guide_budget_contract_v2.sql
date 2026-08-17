-- P04-Cb PREONLY.  Do not apply or journal without main-runner acceptance.
-- V1 guide strict_payload is intentionally untouched and remains readable.
CREATE TABLE guide_budget_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  guide_revision_id uuid NOT NULL,
  guide_revision_hash text NOT NULL,
  schema_version text NOT NULL,
  contract_hash text NOT NULL,
  market_key text NOT NULL,
  currency text NOT NULL,
  target_scope_ref text NOT NULL,
  contract_payload jsonb NOT NULL,
  maximum_evidence_age_seconds integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guide_budget_contracts_identity CHECK (
    schema_version = 'guide-budget-contract/2.0.0'
    AND guide_revision_hash ~ '^[a-f0-9]{64}$'
    AND contract_hash ~ '^[a-f0-9]{64}$'
    AND market_key IN ('yerli','yabanci') AND currency = 'TRY'
    AND target_scope_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND maximum_evidence_age_seconds BETWEEN 1 AND 31536000
    AND jsonb_typeof(contract_payload)='object'
    -- Persist the complete, hashed v2 envelope; accepting a draft here would
    -- let a direct SQL writer evade the reader's tamper check.
    AND contract_payload ?& array['guideRevisionHash','market','currency','targetScopeRef','expression','maximumEvidenceAgeSeconds','overlapEnvelope','schemaVersion','contractHash']
    AND contract_payload->>'guideRevisionHash'=guide_revision_hash
    AND contract_payload->>'market'=market_key
    AND contract_payload->>'currency'=currency
    AND contract_payload->>'targetScopeRef'=target_scope_ref
    AND contract_payload->>'maximumEvidenceAgeSeconds'=maximum_evidence_age_seconds::text
    AND contract_payload->>'schemaVersion'=schema_version
    AND contract_payload->>'contractHash'=contract_hash
  )
);
CREATE UNIQUE INDEX guide_budget_contracts_workspace_row_unique ON guide_budget_contracts(workspace_id,id);
CREATE UNIQUE INDEX guide_budget_contracts_workspace_revision_unique ON guide_budget_contracts(workspace_id,guide_revision_id);
CREATE UNIQUE INDEX guide_budget_contracts_workspace_hash_unique ON guide_budget_contracts(workspace_id,contract_hash);
CREATE INDEX guide_budget_contracts_workspace_revision_fk_idx ON guide_budget_contracts(workspace_id,guide_revision_id);
ALTER TABLE guide_budget_contracts ADD CONSTRAINT guide_budget_contracts_revision_scope_fk
  FOREIGN KEY(workspace_id,guide_revision_id) REFERENCES guide_revisions(workspace_id,id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.guide_budget_contract_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'guide budget contracts are append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM guide_revisions r
    JOIN category_definitions d ON d.workspace_id=r.workspace_id AND d.id=r.market_definition_id
    JOIN category_dimensions dim ON dim.workspace_id=d.workspace_id AND dim.id=d.dimension_id
    WHERE r.workspace_id=NEW.workspace_id AND r.id=NEW.guide_revision_id
      AND r.revision_hash=NEW.guide_revision_hash AND r.market_key=NEW.market_key
      AND dim.key='market' AND d.key=NEW.market_key
  ) THEN RAISE EXCEPTION 'guide budget contract must bind exact same-market guide revision'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL PRIVILEGES ON FUNCTION public.guide_budget_contract_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guide_budget_contract_guard BEFORE INSERT OR UPDATE OR DELETE ON guide_budget_contracts
  FOR EACH ROW EXECUTE FUNCTION public.guide_budget_contract_guard();
ALTER TABLE guide_budget_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_budget_contracts FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE guide_budget_contracts FROM PUBLIC, anon, authenticated, service_role;

-- Completion receipt is intentionally forward-only: old snapshot rows stay
-- unqualified, so every reader fails closed until a normal complete run emits
-- an exact receipt in the same outer materialization transaction.
CREATE TABLE meta_complete_snapshot_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  meta_connection_id uuid NOT NULL, ad_account_id uuid NOT NULL, snapshot_id uuid NOT NULL, snapshot_hash text NOT NULL,
  captured_at timestamptz NOT NULL, parent_run_ref text NOT NULL, composition_evidence_hash text NOT NULL, lane text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_complete_snapshot_receipts_contract CHECK (snapshot_hash ~ '^[a-f0-9]{64}$' AND composition_evidence_hash ~ '^[a-f0-9]{64}$' AND parent_run_ref ~ '^[a-zA-Z0-9_.:-]{1,190}$' AND lane='normal_inventory_complete')
);
CREATE UNIQUE INDEX meta_complete_snapshot_receipts_workspace_row_unique ON meta_complete_snapshot_receipts(workspace_id,id);
CREATE UNIQUE INDEX meta_complete_snapshot_receipts_snapshot_unique ON meta_complete_snapshot_receipts(workspace_id,snapshot_id);
CREATE UNIQUE INDEX meta_complete_snapshot_receipts_replay_unique ON meta_complete_snapshot_receipts(workspace_id,ad_account_id,snapshot_hash,parent_run_ref);
CREATE INDEX meta_complete_snapshot_receipts_workspace_account_captured_idx ON meta_complete_snapshot_receipts(workspace_id,ad_account_id,captured_at);
CREATE INDEX meta_complete_snapshot_receipts_workspace_snapshot_fk_idx ON meta_complete_snapshot_receipts(workspace_id,snapshot_id,meta_connection_id,ad_account_id);
ALTER TABLE meta_complete_snapshot_receipts ADD CONSTRAINT meta_complete_snapshot_receipts_snapshot_scope_fk FOREIGN KEY(workspace_id,snapshot_id,meta_connection_id,ad_account_id) REFERENCES meta_change_snapshots(workspace_id,id,meta_connection_id,ad_account_id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION public.meta_complete_snapshot_receipt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'complete snapshot receipts are append-only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM meta_change_snapshots s WHERE s.workspace_id=NEW.workspace_id AND s.id=NEW.snapshot_id AND s.meta_connection_id=NEW.meta_connection_id AND s.ad_account_id=NEW.ad_account_id AND s.snapshot_hash=NEW.snapshot_hash AND s.captured_at=NEW.captured_at) THEN RAISE EXCEPTION 'completion receipt must bind exact immutable snapshot'; END IF; RETURN NEW;
END; $$;
REVOKE ALL PRIVILEGES ON FUNCTION public.meta_complete_snapshot_receipt_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER meta_complete_snapshot_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON meta_complete_snapshot_receipts FOR EACH ROW EXECUTE FUNCTION public.meta_complete_snapshot_receipt_guard();
ALTER TABLE meta_complete_snapshot_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_complete_snapshot_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE meta_complete_snapshot_receipts FROM PUBLIC, anon, authenticated, service_role;
