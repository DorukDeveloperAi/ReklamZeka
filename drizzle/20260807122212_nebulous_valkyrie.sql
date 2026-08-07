ALTER TABLE "meta_connections" DROP CONSTRAINT "meta_connections_lifecycle_consistent";--> statement-breakpoint
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_lifecycle_consistent" CHECK (
    "meta_connections"."secret_reference_id" is null or (
      (
        "meta_connections"."status" = 'revoked'
        and "meta_connections"."secret_disabled_at" is not null
        and "meta_connections"."secret_destroyed_at" is not null
        and "meta_connections"."revoked_at" is not null
      ) or (
        "meta_connections"."status" <> 'revoked'
        and "meta_connections"."revoked_at" is null
      )
    )
  );