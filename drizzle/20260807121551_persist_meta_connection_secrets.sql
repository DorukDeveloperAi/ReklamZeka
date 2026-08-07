ALTER TABLE "meta_connections" ADD COLUMN "secret_reference_id" text;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "secret_provider" text;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "secret_key_version" integer;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "secret_binding_name" text;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "secret_disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "secret_destroyed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "lifecycle_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_lifecycle_generation_positive" CHECK ("meta_connections"."lifecycle_generation" >= 1);--> statement-breakpoint
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_secret_metadata_complete" CHECK (
    (
      "meta_connections"."secret_reference_id" is null
      and "meta_connections"."secret_provider" is null
      and "meta_connections"."secret_key_version" is null
      and "meta_connections"."secret_binding_name" is null
    ) or (
      "meta_connections"."secret_reference_id" is not null
      and "meta_connections"."secret_provider" = 'environment'
      and "meta_connections"."secret_key_version" >= 1
      and "meta_connections"."secret_binding_name" is not null
    )
  );--> statement-breakpoint
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_destroy_implies_disabled" CHECK (
    "meta_connections"."secret_destroyed_at" is null or "meta_connections"."secret_disabled_at" is not null
  );
