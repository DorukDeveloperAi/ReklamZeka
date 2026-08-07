CREATE TABLE "guidance_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"binding_key" text NOT NULL,
	"version" integer NOT NULL,
	"card_key" text NOT NULL,
	"facet" text NOT NULL,
	"value" text,
	"entity_type" text,
	"mode" text NOT NULL,
	"priority" integer NOT NULL,
	"record_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guidance_bindings_version_positive" CHECK ("guidance_bindings"."version" >= 1),
	CONSTRAINT "guidance_bindings_priority_range" CHECK ("guidance_bindings"."priority" between 0 and 100),
	CONSTRAINT "guidance_bindings_required_text" CHECK (btrim("guidance_bindings"."binding_key") <> '' and btrim("guidance_bindings"."card_key") <> ''),
	CONSTRAINT "guidance_bindings_facet_allowlist" CHECK ("guidance_bindings"."facet" in ('global', 'account', 'objective', 'internal_category', 'entity', 'topic')),
	CONSTRAINT "guidance_bindings_entity_type_allowlist" CHECK ("guidance_bindings"."entity_type" is null or "guidance_bindings"."entity_type" in ('campaign', 'ad_set', 'ad', 'creative', 'post')),
	CONSTRAINT "guidance_bindings_mode_allowlist" CHECK ("guidance_bindings"."mode" in ('default', 'exception')),
	CONSTRAINT "guidance_bindings_scope_consistent" CHECK (
    ("guidance_bindings"."facet" = 'global' and "guidance_bindings"."value" is null and "guidance_bindings"."entity_type" is null)
		or ("guidance_bindings"."facet" = 'entity' and "guidance_bindings"."value" is not null and btrim("guidance_bindings"."value") <> '' and "guidance_bindings"."entity_type" is not null)
		or ("guidance_bindings"."facet" not in ('global', 'entity') and "guidance_bindings"."value" is not null and btrim("guidance_bindings"."value") <> '' and "guidance_bindings"."entity_type" is null)
  ),
	CONSTRAINT "guidance_bindings_record_hash_format" CHECK ("guidance_bindings"."record_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "guidance_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"card_key" text NOT NULL,
	"version" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_ids" jsonb NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"rationale" text,
	"strength" text NOT NULL,
	"topic" text NOT NULL,
	"decision_key" text,
	"position_key" text,
	"authority" text DEFAULT 'guidance_only' NOT NULL,
	"status" text NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"owner_ref" text NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"record_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guidance_cards_version_positive" CHECK ("guidance_cards"."version" >= 1),
	CONSTRAINT "guidance_cards_required_text" CHECK (
    btrim("guidance_cards"."card_key") <> '' and btrim("guidance_cards"."title") <> '' and btrim("guidance_cards"."body") <> ''
    and btrim("guidance_cards"."topic") <> '' and btrim("guidance_cards"."owner_ref") <> ''
  ),
	CONSTRAINT "guidance_cards_source_type_allowlist" CHECK ("guidance_cards"."source_type" in (
    'owner_statement', 'official_meta_guidance', 'business_strategy',
    'observed_result', 'experiment_outcome', 'operating_note'
  )),
	CONSTRAINT "guidance_cards_strength_allowlist" CHECK ("guidance_cards"."strength" in ('must', 'should', 'consider', 'avoid', 'question')),
	CONSTRAINT "guidance_cards_status_allowlist" CHECK ("guidance_cards"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "guidance_cards_guidance_only_authority" CHECK ("guidance_cards"."authority" = 'guidance_only'),
	CONSTRAINT "guidance_cards_sources_nonempty" CHECK (
    jsonb_typeof("guidance_cards"."source_ids") = 'array' and jsonb_array_length("guidance_cards"."source_ids") >= 1
  ),
	CONSTRAINT "guidance_cards_decision_pair" CHECK (("guidance_cards"."decision_key" is null) = ("guidance_cards"."position_key" is null)),
	CONSTRAINT "guidance_cards_effective_interval" CHECK (
    "guidance_cards"."effective_from" is null or "guidance_cards"."effective_to" is null or "guidance_cards"."effective_from" < "guidance_cards"."effective_to"
  ),
	CONSTRAINT "guidance_cards_record_hash_format" CHECK ("guidance_cards"."record_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "guidance_cards_lifecycle_consistent" CHECK (
    ("guidance_cards"."status" = 'draft' and "guidance_cards"."published_at" is null and "guidance_cards"."archived_at" is null)
    or ("guidance_cards"."status" = 'published' and "guidance_cards"."published_at" is not null and "guidance_cards"."archived_at" is null)
    or ("guidance_cards"."status" = 'archived' and "guidance_cards"."archived_at" is not null)
  )
);
--> statement-breakpoint
CREATE TABLE "guidance_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"set_key" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"ordered_card_ids" jsonb NOT NULL,
	"review_status" text NOT NULL,
	"reviewed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"record_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guidance_sets_version_positive" CHECK ("guidance_sets"."version" >= 1),
	CONSTRAINT "guidance_sets_required_text" CHECK (btrim("guidance_sets"."set_key") <> '' and btrim("guidance_sets"."name") <> ''),
	CONSTRAINT "guidance_sets_status_allowlist" CHECK ("guidance_sets"."review_status" in ('draft', 'reviewed', 'archived')),
	CONSTRAINT "guidance_sets_cards_array" CHECK (jsonb_typeof("guidance_sets"."ordered_card_ids") = 'array'),
	CONSTRAINT "guidance_sets_lifecycle_consistent" CHECK (
    ("guidance_sets"."review_status" = 'draft' and "guidance_sets"."reviewed_at" is null and "guidance_sets"."archived_at" is null)
    or ("guidance_sets"."review_status" = 'reviewed' and "guidance_sets"."reviewed_at" is not null and "guidance_sets"."archived_at" is null)
    or ("guidance_sets"."review_status" = 'archived' and "guidance_sets"."archived_at" is not null)
  ),
	CONSTRAINT "guidance_sets_record_hash_format" CHECK ("guidance_sets"."record_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "guidance_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"version" integer NOT NULL,
	"source_type" text NOT NULL,
	"title" text NOT NULL,
	"source_ref" text NOT NULL,
	"source_url" text,
	"content" text NOT NULL,
	"author" text,
	"captured_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"review_by" timestamp with time zone,
	"status" text NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"record_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guidance_sources_version_positive" CHECK ("guidance_sources"."version" >= 1),
	CONSTRAINT "guidance_sources_required_text" CHECK (
    btrim("guidance_sources"."source_key") <> '' and btrim("guidance_sources"."title") <> ''
    and btrim("guidance_sources"."source_ref") <> '' and btrim("guidance_sources"."content") <> ''
  ),
	CONSTRAINT "guidance_sources_type_allowlist" CHECK ("guidance_sources"."source_type" in (
    'owner_statement', 'official_meta_guidance', 'business_strategy',
    'observed_result', 'experiment_outcome', 'operating_note'
  )),
	CONSTRAINT "guidance_sources_status_allowlist" CHECK ("guidance_sources"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "guidance_sources_record_hash_format" CHECK ("guidance_sources"."record_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "guidance_sources_lifecycle_consistent" CHECK (
    ("guidance_sources"."status" = 'draft' and "guidance_sources"."published_at" is null and "guidance_sources"."archived_at" is null)
    or ("guidance_sources"."status" = 'published' and "guidance_sources"."published_at" is not null and "guidance_sources"."archived_at" is null)
    or ("guidance_sources"."status" = 'archived' and "guidance_sources"."archived_at" is not null)
  ),
	CONSTRAINT "guidance_sources_official_publish_evidence" CHECK (
    "guidance_sources"."source_type" <> 'official_meta_guidance' or "guidance_sources"."status" <> 'published' or (
		"guidance_sources"."source_url" is not null and "guidance_sources"."source_url" ~ '^https://' and "guidance_sources"."captured_at" is not null
      and "guidance_sources"."reviewed_at" is not null and "guidance_sources"."review_by" is not null
      and "guidance_sources"."reviewed_at" >= "guidance_sources"."captured_at" and "guidance_sources"."review_by" > "guidance_sources"."reviewed_at"
    )
  )
);
--> statement-breakpoint
ALTER TABLE "guidance_bindings" ADD CONSTRAINT "guidance_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guidance_cards" ADD CONSTRAINT "guidance_cards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guidance_sets" ADD CONSTRAINT "guidance_sets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guidance_sources" ADD CONSTRAINT "guidance_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guidance_bindings_workspace_key_version_unique" ON "guidance_bindings" USING btree ("workspace_id","binding_key","version");--> statement-breakpoint
CREATE INDEX "guidance_bindings_workspace_card_idx" ON "guidance_bindings" USING btree ("workspace_id","card_key");--> statement-breakpoint
CREATE UNIQUE INDEX "guidance_cards_workspace_key_version_unique" ON "guidance_cards" USING btree ("workspace_id","card_key","version");--> statement-breakpoint
CREATE INDEX "guidance_cards_workspace_status_topic_idx" ON "guidance_cards" USING btree ("workspace_id","status","topic");--> statement-breakpoint
CREATE UNIQUE INDEX "guidance_sets_workspace_key_version_unique" ON "guidance_sets" USING btree ("workspace_id","set_key","version");--> statement-breakpoint
CREATE INDEX "guidance_sets_workspace_status_idx" ON "guidance_sets" USING btree ("workspace_id","review_status","set_key");--> statement-breakpoint
CREATE UNIQUE INDEX "guidance_sources_workspace_key_version_unique" ON "guidance_sources" USING btree ("workspace_id","source_key","version");--> statement-breakpoint
CREATE INDEX "guidance_sources_workspace_status_idx" ON "guidance_sources" USING btree ("workspace_id","status","source_key");--> statement-breakpoint
ALTER TABLE "guidance_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guidance_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guidance_bindings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guidance_sets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "guidance_sources" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "guidance_cards" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "guidance_bindings" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "guidance_sets" FROM PUBLIC, anon, authenticated;
