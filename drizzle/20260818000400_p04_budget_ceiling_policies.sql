-- P04 PREONLY. Human-published, target-bound budget ceilings.
-- Advisory budget_pool_hierarchy_revisions remain recommendation-only and are
-- never read as action authority by this table.
CREATE TABLE budget_ceiling_policy_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
 limit_ref text NOT NULL,
 revision integer NOT NULL,
 previous_policy_hash text,
 policy_hash text NOT NULL,
 pool_ref text NOT NULL,
 parent_limit_ref text,
 layer text NOT NULL,
 target_scope_ref text NOT NULL,
 market text NOT NULL,
 currency text NOT NULL,
 ceiling_decimal text NOT NULL,
 effective_from timestamptz NOT NULL,
 effective_to timestamptz NOT NULL,
 state text NOT NULL,
 published_by_actor_id uuid NOT NULL,
 published_at timestamptz NOT NULL,
 policy_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT budget_ceiling_policy_revisions_contract CHECK (
   limit_ref ~ '^limit_[a-z0-9][a-z0-9_.:-]{0,126}$'
   AND revision BETWEEN 1 AND 1000000
   AND ((revision=1 AND previous_policy_hash IS NULL) OR (revision>1 AND previous_policy_hash ~ '^[a-f0-9]{64}$'))
   AND policy_hash ~ '^[a-f0-9]{64}$'
   AND pool_ref ~ '^budget_pool_[a-z0-9][a-z0-9_.:-]{0,119}$'
   AND layer IN ('market','organization_campaign','geo_targeting_platform','campaign_ad_set')
   AND ((layer='market' AND parent_limit_ref IS NULL) OR (layer<>'market' AND parent_limit_ref ~ '^limit_[a-z0-9][a-z0-9_.:-]{0,126}$'))
   AND parent_limit_ref IS DISTINCT FROM limit_ref
   AND target_scope_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
   AND market IN ('yerli','yabanci') AND currency ~ '^[A-Z]{3}$'
   AND ceiling_decimal ~ '^(0|[1-9][0-9]{0,29})(\.[0-9]{1,12})?$' AND ceiling_decimal::numeric>0
   AND effective_to>effective_from AND published_at<=effective_from
   AND state IN ('published','disabled')
   AND jsonb_typeof(policy_payload)='object' AND octet_length(policy_payload::text)<=16878
 ),
 CONSTRAINT budget_ceiling_policy_revisions_payload_exact CHECK ((
   policy_payload ?& ARRAY['workspaceRef','limitRef','revision','previousPolicyHash','poolRef','parentLimitRef','layer','targetScopeRef','market','currency','ceilingDecimal','effectiveFrom','effectiveTo','state','publishedByActorRef','publishedAt','schemaVersion','authority','policyHash']
   AND policy_payload-ARRAY['workspaceRef','limitRef','revision','previousPolicyHash','poolRef','parentLimitRef','layer','targetScopeRef','market','currency','ceilingDecimal','effectiveFrom','effectiveTo','state','publishedByActorRef','publishedAt','schemaVersion','authority','policyHash']='{}'::jsonb
   AND policy_payload->>'schemaVersion'='budget-ceiling-policy/1.0.0'
   AND policy_payload->>'limitRef'=limit_ref AND (policy_payload->>'revision')::integer=revision
   AND policy_payload->>'previousPolicyHash' IS NOT DISTINCT FROM previous_policy_hash
   AND policy_payload->>'policyHash'=policy_hash AND policy_payload->>'poolRef'=pool_ref
   AND policy_payload->>'parentLimitRef' IS NOT DISTINCT FROM parent_limit_ref
   AND policy_payload->>'layer'=layer AND policy_payload->>'targetScopeRef'=target_scope_ref
   AND policy_payload->>'market'=market AND policy_payload->>'currency'=currency
   AND policy_payload->>'ceilingDecimal'=ceiling_decimal
   AND (policy_payload->>'effectiveFrom')::timestamptz=effective_from AND (policy_payload->>'effectiveTo')::timestamptz=effective_to
   AND policy_payload->>'state'=state AND (policy_payload->>'publishedAt')::timestamptz=published_at
   AND policy_payload->>'publishedByActorRef' ~ '^user_[a-z0-9][a-z0-9_.:-]{0,126}$'
   AND policy_payload->'authority'='{"constraintAuthority":"published_human_policy","canApprove":false,"canExecute":false,"canWriteMeta":false,"canEnableAutomation":false}'::jsonb
 ) IS TRUE)
);
CREATE UNIQUE INDEX budget_ceiling_policy_revisions_workspace_row_unique ON budget_ceiling_policy_revisions(workspace_id,id);
CREATE UNIQUE INDEX budget_ceiling_policy_revisions_workspace_revision_unique ON budget_ceiling_policy_revisions(workspace_id,limit_ref,revision);
CREATE UNIQUE INDEX budget_ceiling_policy_revisions_workspace_hash_unique ON budget_ceiling_policy_revisions(workspace_id,policy_hash);
CREATE INDEX budget_ceiling_policy_revisions_current_idx ON budget_ceiling_policy_revisions(workspace_id,limit_ref,revision DESC);
CREATE INDEX budget_ceiling_policy_revisions_actor_fk_idx ON budget_ceiling_policy_revisions(workspace_id,published_by_actor_id);
ALTER TABLE budget_ceiling_policy_revisions ADD CONSTRAINT budget_ceiling_policy_revisions_actor_scope_fk FOREIGN KEY(workspace_id,published_by_actor_id) REFERENCES memberships(workspace_id,user_id) ON DELETE restrict;

CREATE OR REPLACE FUNCTION public.budget_ceiling_policy_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE prior public.budget_ceiling_policy_revisions%ROWTYPE; expected_workspace_ref text; expected_actor_ref text;
BEGIN
 expected_workspace_ref:='workspace_'||substr(encode(extensions.digest(convert_to(NEW.workspace_id::text,'UTF8'),'sha256'),'hex'),1,16);
 expected_actor_ref:='user_'||substr(encode(extensions.digest(convert_to(NEW.published_by_actor_id::text,'UTF8'),'sha256'),'hex'),1,24);
 IF NEW.policy_payload->>'workspaceRef' IS DISTINCT FROM expected_workspace_ref OR NEW.policy_payload->>'publishedByActorRef' IS DISTINCT FROM expected_actor_ref THEN RAISE EXCEPTION 'budget ceiling policy identity invalid'; END IF;
 IF NEW.policy_hash IS DISTINCT FROM public.guide_run_sha256(NEW.policy_payload-'policyHash') THEN RAISE EXCEPTION 'budget ceiling policy hash invalid'; END IF;
 IF NEW.revision>1 THEN
   SELECT * INTO prior FROM public.budget_ceiling_policy_revisions WHERE workspace_id=NEW.workspace_id AND limit_ref=NEW.limit_ref AND revision=NEW.revision-1 FOR SHARE;
   IF prior.id IS NULL OR NEW.previous_policy_hash IS DISTINCT FROM prior.policy_hash THEN RAISE EXCEPTION 'budget ceiling policy chain invalid'; END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM public.budget_ceiling_policy_revisions WHERE workspace_id=NEW.workspace_id AND limit_ref=NEW.limit_ref) THEN RAISE EXCEPTION 'budget ceiling genesis invalid'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspaces w JOIN public.memberships m ON m.workspace_id=w.id AND m.user_id=NEW.published_by_actor_id AND m.role IN ('owner','admin') WHERE w.id=NEW.workspace_id AND w.lifecycle_state='active' AND w.tombstoned_at IS NULL) THEN RAISE EXCEPTION 'budget ceiling publisher invalid'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.budget_ceiling_policy_immutable_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'budget ceiling policies are append-only';
END $$;
CREATE TRIGGER budget_ceiling_policy_revisions_insert_guard BEFORE INSERT ON budget_ceiling_policy_revisions FOR EACH ROW EXECUTE FUNCTION public.budget_ceiling_policy_insert_guard();
CREATE TRIGGER budget_ceiling_policy_revisions_immutable BEFORE UPDATE OR DELETE ON budget_ceiling_policy_revisions FOR EACH ROW EXECUTE FUNCTION public.budget_ceiling_policy_immutable_guard();
ALTER TABLE budget_ceiling_policy_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_ceiling_policy_revisions FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE budget_ceiling_policy_revisions FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.budget_ceiling_policy_insert_guard(),public.budget_ceiling_policy_immutable_guard() FROM PUBLIC,anon,authenticated,service_role;
