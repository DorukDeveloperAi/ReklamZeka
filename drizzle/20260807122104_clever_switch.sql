ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_lifecycle_consistent" CHECK (
    "meta_connections"."secret_reference_id" is null or (
      (
      "meta_connections"."status" = 'active'
      and "meta_connections"."secret_disabled_at" is null
      and "meta_connections"."secret_destroyed_at" is null
      and "meta_connections"."revoked_at" is null
    ) or (
      "meta_connections"."status" = 'invalid'
      and "meta_connections"."secret_destroyed_at" is null
      and "meta_connections"."revoked_at" is null
    ) or (
      "meta_connections"."status" = 'disconnected'
      and "meta_connections"."secret_disabled_at" is not null
      and "meta_connections"."secret_destroyed_at" is null
      and "meta_connections"."revoked_at" is null
    ) or (
      "meta_connections"."status" = 'revoked'
      and "meta_connections"."secret_disabled_at" is not null
      and "meta_connections"."secret_destroyed_at" is not null
      and "meta_connections"."revoked_at" is not null
      )
    )
  );
