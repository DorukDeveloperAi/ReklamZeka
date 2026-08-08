CREATE TYPE "public"."category_assignment_operation" AS ENUM('add', 'override', 'deny');--> statement-breakpoint
CREATE TYPE "public"."category_assignment_source" AS ENUM('manual', 'agent', 'deterministic');--> statement-breakpoint
CREATE TYPE "public"."category_cardinality" AS ENUM('single', 'multi');--> statement-breakpoint
CREATE TYPE "public"."category_entity_level" AS ENUM('campaign', 'ad_set', 'ad', 'creative');--> statement-breakpoint
CREATE TABLE "category_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"dimension_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"entity_level" "category_entity_level" NOT NULL,
	"campaign_id" uuid,
	"ad_set_id" uuid,
	"ad_id" uuid,
	"creative_id" uuid,
	"operation" "category_assignment_operation" NOT NULL,
	"source" "category_assignment_source" NOT NULL,
	"manual_lock" boolean DEFAULT false NOT NULL,
	"evidence" jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_assignment_id" uuid,
	"archived_at" timestamp with time zone,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_assignments_version_positive" CHECK ("category_assignments"."version" >= 1),
	CONSTRAINT "category_assignments_confidence_range" CHECK ("category_assignments"."confidence" >= 0 and "category_assignments"."confidence" <= 1),
	CONSTRAINT "category_assignments_manual_lock_source" CHECK (not "category_assignments"."manual_lock" or "category_assignments"."source" = 'manual'),
	CONSTRAINT "category_assignments_evidence_nonempty" CHECK (jsonb_typeof("category_assignments"."evidence") = 'array' and jsonb_array_length("category_assignments"."evidence") >= 1),
	CONSTRAINT "category_assignments_entity_consistent" CHECK (
    (
      "category_assignments"."entity_level" = 'campaign'
      and "category_assignments"."campaign_id" is not null
      and "category_assignments"."ad_set_id" is null
      and "category_assignments"."ad_id" is null
      and "category_assignments"."creative_id" is null
    ) or (
      "category_assignments"."entity_level" = 'ad_set'
      and "category_assignments"."campaign_id" is null
      and "category_assignments"."ad_set_id" is not null
      and "category_assignments"."ad_id" is null
      and "category_assignments"."creative_id" is null
    ) or (
      "category_assignments"."entity_level" = 'ad'
      and "category_assignments"."campaign_id" is null
      and "category_assignments"."ad_set_id" is null
      and "category_assignments"."ad_id" is not null
      and "category_assignments"."creative_id" is null
    ) or (
      "category_assignments"."entity_level" = 'creative'
      and "category_assignments"."campaign_id" is null
      and "category_assignments"."ad_set_id" is null
      and "category_assignments"."ad_id" is null
      and "category_assignments"."creative_id" is not null
    )
  )
);
--> statement-breakpoint
CREATE TABLE "category_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"dimension_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_definitions_key_format" CHECK ("category_definitions"."key" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "category_definitions_version_positive" CHECK ("category_definitions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "category_dimensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cardinality" "category_cardinality" NOT NULL,
	"allowed_entity_levels" "category_entity_level"[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_dimensions_key_format" CHECK ("category_dimensions"."key" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "category_dimensions_version_positive" CHECK ("category_dimensions"."version" >= 1),
	CONSTRAINT "category_dimensions_allowed_levels_nonempty" CHECK (coalesce(array_length("category_dimensions"."allowed_entity_levels", 1), 0) >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "category_assignments_id_workspace_dimension_unique" ON "category_assignments" USING btree ("id","workspace_id","dimension_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_definitions_id_dimension_workspace_unique" ON "category_definitions" USING btree ("id","dimension_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_dimensions_id_workspace_unique" ON "category_dimensions" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_campaigns_id_workspace_unique" ON "ad_campaigns" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ad_sets_id_workspace_unique" ON "meta_ad_sets" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_id_workspace_unique" ON "meta_ads" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_creatives_id_workspace_unique" ON "meta_creatives" USING btree ("id","workspace_id");--> statement-breakpoint
ALTER TABLE "category_assignments" ADD CONSTRAINT "category_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD CONSTRAINT "category_assignments_definition_scope_fk" FOREIGN KEY ("definition_id","dimension_id","workspace_id") REFERENCES "public"."category_definitions"("id","dimension_id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD CONSTRAINT "category_assignments_campaign_scope_fk" FOREIGN KEY ("campaign_id","workspace_id") REFERENCES "public"."ad_campaigns"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD CONSTRAINT "category_assignments_ad_set_scope_fk" FOREIGN KEY ("ad_set_id","workspace_id") REFERENCES "public"."meta_ad_sets"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD CONSTRAINT "category_assignments_ad_scope_fk" FOREIGN KEY ("ad_id","workspace_id") REFERENCES "public"."meta_ads"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD CONSTRAINT "category_assignments_creative_scope_fk" FOREIGN KEY ("creative_id","workspace_id") REFERENCES "public"."meta_creatives"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD CONSTRAINT "category_assignments_supersedes_scope_fk" FOREIGN KEY ("supersedes_assignment_id","workspace_id","dimension_id") REFERENCES "public"."category_assignments"("id","workspace_id","dimension_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_definitions" ADD CONSTRAINT "category_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_definitions" ADD CONSTRAINT "category_definitions_dimension_scope_fk" FOREIGN KEY ("dimension_id","workspace_id") REFERENCES "public"."category_dimensions"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_dimensions" ADD CONSTRAINT "category_dimensions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_assignments_campaign_active_value_unique" ON "category_assignments" USING btree ("workspace_id","dimension_id","campaign_id","definition_id") WHERE "category_assignments"."archived_at" is null and "category_assignments"."campaign_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "category_assignments_ad_set_active_value_unique" ON "category_assignments" USING btree ("workspace_id","dimension_id","ad_set_id","definition_id") WHERE "category_assignments"."archived_at" is null and "category_assignments"."ad_set_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "category_assignments_ad_active_value_unique" ON "category_assignments" USING btree ("workspace_id","dimension_id","ad_id","definition_id") WHERE "category_assignments"."archived_at" is null and "category_assignments"."ad_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "category_assignments_creative_active_value_unique" ON "category_assignments" USING btree ("workspace_id","dimension_id","creative_id","definition_id") WHERE "category_assignments"."archived_at" is null and "category_assignments"."creative_id" is not null;--> statement-breakpoint
CREATE INDEX "category_assignments_workspace_dimension_idx" ON "category_assignments" USING btree ("workspace_id","dimension_id","archived_at");--> statement-breakpoint
CREATE INDEX "category_assignments_definition_idx" ON "category_assignments" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX "category_assignments_supersedes_idx" ON "category_assignments" USING btree ("supersedes_assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_definitions_workspace_dimension_key_version_unique" ON "category_definitions" USING btree ("workspace_id","dimension_id","key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "category_definitions_workspace_dimension_active_key_unique" ON "category_definitions" USING btree ("workspace_id","dimension_id","key") WHERE "category_definitions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "category_definitions_dimension_archive_idx" ON "category_definitions" USING btree ("dimension_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "category_dimensions_workspace_key_version_unique" ON "category_dimensions" USING btree ("workspace_id","key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "category_dimensions_workspace_active_key_unique" ON "category_dimensions" USING btree ("workspace_id","key") WHERE "category_dimensions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "category_dimensions_workspace_archive_idx" ON "category_dimensions" USING btree ("workspace_id","archived_at");--> statement-breakpoint
ALTER TABLE "category_dimensions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "category_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "category_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "category_dimensions" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "category_definitions" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "category_assignments" FROM PUBLIC, anon, authenticated;
