CREATE TABLE "business_outcome_entity_heads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_ref" text NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"current_head_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_outcome_entity_heads_shape" CHECK ((
    "business_outcome_entity_heads"."entity_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and "business_outcome_entity_heads"."current_revision" >= 0
    and (("business_outcome_entity_heads"."current_revision" = 0 and "business_outcome_entity_heads"."current_head_hash" is null) or ("business_outcome_entity_heads"."current_revision" > 0 and "business_outcome_entity_heads"."current_head_hash" ~ '^[a-f0-9]{64}$'))
  ) is true)
);
--> statement-breakpoint
CREATE TABLE "business_outcome_evidence_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"evidence_ref" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"entity_ref" text NOT NULL,
	"source_head_hash" text NOT NULL,
	"source_manifest_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"materialized_at" timestamp with time zone NOT NULL,
	"evidence_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_outcome_evidence_snapshots_shape" CHECK ((
    "business_outcome_evidence_snapshots"."evidence_ref" ~ '^outcome_evidence_[a-f0-9]{24}$' and "business_outcome_evidence_snapshots"."evidence_hash" ~ '^[a-f0-9]{64}$'
    and "business_outcome_evidence_snapshots"."entity_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "business_outcome_evidence_snapshots"."source_head_hash" ~ '^[a-f0-9]{64}$' and "business_outcome_evidence_snapshots"."source_manifest_hash" ~ '^[a-f0-9]{64}$'
    and "business_outcome_evidence_snapshots"."window_start" < "business_outcome_evidence_snapshots"."window_end" and jsonb_typeof("business_outcome_evidence_snapshots"."evidence_payload") = 'object'
  ) is true),
	CONSTRAINT "business_outcome_evidence_snapshots_payload_exact" CHECK ((
    "business_outcome_evidence_snapshots"."evidence_payload" #>> '{version}' = 'business-outcome-evidence/1.0.0'
    and "business_outcome_evidence_snapshots"."evidence_payload" #>> '{evidenceRef}' = "business_outcome_evidence_snapshots"."evidence_ref"
    and "business_outcome_evidence_snapshots"."evidence_payload" #>> '{evidenceHash}' = "business_outcome_evidence_snapshots"."evidence_hash"
    and "business_outcome_evidence_snapshots"."evidence_payload" #>> '{entityRef}' = "business_outcome_evidence_snapshots"."entity_ref"
    and "business_outcome_evidence_snapshots"."evidence_payload" #>> '{sourceHeadHash}' = "business_outcome_evidence_snapshots"."source_head_hash"
    and "business_outcome_evidence_snapshots"."evidence_payload" #>> '{sourceManifestHash}' = "business_outcome_evidence_snapshots"."source_manifest_hash"
    and ("business_outcome_evidence_snapshots"."evidence_payload" #>> '{windowStart}')::timestamptz = "business_outcome_evidence_snapshots"."window_start"
    and ("business_outcome_evidence_snapshots"."evidence_payload" #>> '{windowEnd}')::timestamptz = "business_outcome_evidence_snapshots"."window_end"
    and ("business_outcome_evidence_snapshots"."evidence_payload" #>> '{materializedAt}')::timestamptz = "business_outcome_evidence_snapshots"."materialized_at"
  ) is true),
	CONSTRAINT "business_outcome_evidence_snapshots_no_forbidden_material" CHECK (
    "business_outcome_evidence_snapshots"."evidence_payload"::text !~* '"[^"[:space:]]*(token|secret|content_hash|raw[_-]?(payload|request|response|json)|actor|audit)"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "business_outcome_entity_heads" ADD CONSTRAINT "business_outcome_entity_heads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_outcome_evidence_snapshots" ADD CONSTRAINT "business_outcome_evidence_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_outcome_entity_heads_workspace_row_unique" ON "business_outcome_entity_heads" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_outcome_entity_heads_workspace_entity_unique" ON "business_outcome_entity_heads" USING btree ("workspace_id","entity_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "business_outcome_evidence_snapshots_workspace_row_unique" ON "business_outcome_evidence_snapshots" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_outcome_evidence_snapshots_workspace_hash_unique" ON "business_outcome_evidence_snapshots" USING btree ("workspace_id","evidence_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "business_outcome_evidence_snapshots_workspace_ref_unique" ON "business_outcome_evidence_snapshots" USING btree ("workspace_id","evidence_ref");--> statement-breakpoint
CREATE INDEX "business_outcome_evidence_snapshots_lookup_idx" ON "business_outcome_evidence_snapshots" USING btree ("workspace_id","entity_ref","source_head_hash","window_start","window_end");
--> statement-breakpoint
CREATE FUNCTION business_outcome_entity_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_revision <> 1 OR NEW.current_head_hash IS NULL THEN RAISE EXCEPTION 'business_outcome_head_invalid_initial'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'business_outcome_head_immutable';
  END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.entity_ref <> OLD.entity_ref
    OR NEW.created_at <> OLD.created_at OR NEW.current_revision <> OLD.current_revision + 1
    OR NEW.current_head_hash IS NULL OR NEW.current_head_hash = OLD.current_head_hash
    OR NEW.updated_at < OLD.updated_at THEN RAISE EXCEPTION 'business_outcome_head_occ_conflict'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION business_outcome_evidence_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'business_outcome_evidence_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_outcome_entity_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON business_outcome_entity_heads
FOR EACH ROW EXECUTE FUNCTION business_outcome_entity_head_guard();
--> statement-breakpoint
CREATE TRIGGER business_outcome_evidence_snapshots_guard BEFORE UPDATE OR DELETE ON business_outcome_evidence_snapshots
FOR EACH ROW EXECUTE FUNCTION business_outcome_evidence_snapshot_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION business_outcome_entity_head_guard(), business_outcome_evidence_snapshot_guard() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
ALTER TABLE business_outcome_entity_heads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE business_outcome_entity_heads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE business_outcome_evidence_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE business_outcome_evidence_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE business_outcome_entity_heads FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE business_outcome_evidence_snapshots FROM PUBLIC, anon, authenticated, service_role;
