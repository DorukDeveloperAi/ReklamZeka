CREATE TYPE "public"."insight_feedback_value" AS ENUM('helpful', 'unhelpful', 'acted');--> statement-breakpoint
CREATE TABLE "insight_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"insight_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"insight_version" text NOT NULL,
	"value" "insight_feedback_value" NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"snapshot_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"calculation_version" text NOT NULL,
	"severity" text NOT NULL,
	"confidence_score" double precision NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"recommended_action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insight_feedback" ADD CONSTRAINT "insight_feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_feedback" ADD CONSTRAINT "insight_feedback_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_feedback" ADD CONSTRAINT "insight_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "insight_feedback_insight_user_unique" ON "insight_feedback" USING btree ("insight_id","user_id");--> statement-breakpoint
CREATE INDEX "insight_feedback_workspace_recorded_idx" ON "insight_feedback" USING btree ("workspace_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "insights_snapshot_rule_version_unique" ON "insights" USING btree ("workspace_id","snapshot_id","rule_id","calculation_version");--> statement-breakpoint
CREATE INDEX "insights_workspace_created_idx" ON "insights" USING btree ("workspace_id","created_at");