CREATE TABLE "business_outcome_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"batch_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"content_hash" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_ref" text NOT NULL,
	"actor_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_outcome_batches_shape" CHECK ((
    "business_outcome_batches"."batch_id" ~ '^outcome_batch_[a-f0-9]{24}$' and "business_outcome_batches"."source_kind" in ('manual', 'csv')
    and "business_outcome_batches"."source_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "business_outcome_batches"."content_hash" ~ '^[a-f0-9]{64}$'
    and "business_outcome_batches"."actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "business_outcome_batches"."actor_role" in ('owner', 'admin', 'analyst')
  ) is true)
);
--> statement-breakpoint
CREATE TABLE "business_outcome_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"batch_id" text NOT NULL,
	"signal_ref" text NOT NULL,
	"entity_ref" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"outcome_kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"value_minor" bigint,
	"currency" text,
	"meta_entity_ref" text,
	"mapping_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_outcome_signals_shape" CHECK ((
    "business_outcome_signals"."signal_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "business_outcome_signals"."entity_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "business_outcome_signals"."outcome_kind" in ('qualified_lead', 'appointment', 'sale', 'revenue', 'invalid_lead') and "business_outcome_signals"."quantity" >= 1
    and "business_outcome_signals"."mapping_status" in ('verified', 'unmapped')
    and (("business_outcome_signals"."outcome_kind" = 'revenue' and "business_outcome_signals"."value_minor" >= 0 and "business_outcome_signals"."currency" ~ '^[A-Z]{3}$')
      or ("business_outcome_signals"."outcome_kind" <> 'revenue' and "business_outcome_signals"."value_minor" is null and "business_outcome_signals"."currency" is null))
    and (("business_outcome_signals"."mapping_status" = 'verified' and "business_outcome_signals"."meta_entity_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$')
      or ("business_outcome_signals"."mapping_status" = 'unmapped' and "business_outcome_signals"."meta_entity_ref" is null))
  ) is true)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "business_outcome_batches_workspace_row_unique" ON "business_outcome_batches" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_outcome_batches_workspace_batch_unique" ON "business_outcome_batches" USING btree ("workspace_id","batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_outcome_batches_workspace_source_unique" ON "business_outcome_batches" USING btree ("workspace_id","source_ref","content_hash");--> statement-breakpoint
CREATE INDEX "business_outcome_batches_workspace_observed_idx" ON "business_outcome_batches" USING btree ("workspace_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_outcome_signals_workspace_row_unique" ON "business_outcome_signals" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_outcome_signals_workspace_signal_unique" ON "business_outcome_signals" USING btree ("workspace_id","signal_ref");--> statement-breakpoint
CREATE INDEX "business_outcome_signals_entity_time_idx" ON "business_outcome_signals" USING btree ("workspace_id","entity_ref","occurred_at");--> statement-breakpoint
CREATE INDEX "business_outcome_signals_outcome_time_idx" ON "business_outcome_signals" USING btree ("workspace_id","outcome_kind","occurred_at");
--> statement-breakpoint
ALTER TABLE "business_outcome_batches" ADD CONSTRAINT "business_outcome_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_outcome_batches" ADD CONSTRAINT "business_outcome_batches_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_outcome_signals" ADD CONSTRAINT "business_outcome_signals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_outcome_signals" ADD CONSTRAINT "business_outcome_signals_batch_scope_fk" FOREIGN KEY ("workspace_id","batch_id") REFERENCES "public"."business_outcome_batches"("workspace_id","batch_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION business_outcome_immutable_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'business_outcome_immutable';
  END IF;
  RAISE EXCEPTION 'business_outcome_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER business_outcome_batches_immutable_trigger BEFORE UPDATE OR DELETE ON business_outcome_batches
FOR EACH ROW EXECUTE FUNCTION business_outcome_immutable_guard();
--> statement-breakpoint
CREATE TRIGGER business_outcome_signals_immutable_trigger BEFORE UPDATE OR DELETE ON business_outcome_signals
FOR EACH ROW EXECUTE FUNCTION business_outcome_immutable_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION business_outcome_immutable_guard() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
ALTER TABLE business_outcome_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE business_outcome_batches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE business_outcome_signals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE business_outcome_signals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE business_outcome_batches FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE business_outcome_signals FROM PUBLIC, anon, authenticated, service_role;
