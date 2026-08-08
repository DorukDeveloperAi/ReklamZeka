CREATE TYPE "public"."workspace_lifecycle_state" AS ENUM('active', 'tombstoning', 'tombstoned');--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "lifecycle_state" "workspace_lifecycle_state" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "tombstoned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "lifecycle_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_lifecycle_generation_positive" CHECK ("workspaces"."lifecycle_generation" >= 1);--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_tombstone_state_consistent" CHECK (
    (
      "workspaces"."lifecycle_state" = 'tombstoned'
      and "workspaces"."tombstoned_at" is not null
    ) or (
      "workspaces"."lifecycle_state" <> 'tombstoned'
      and "workspaces"."tombstoned_at" is null
    )
  );
