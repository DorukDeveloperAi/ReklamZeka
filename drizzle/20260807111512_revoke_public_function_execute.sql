-- Custom SQL migration file, put your code below! --
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Revoking
-- only anon/authenticated is insufficient because both inherit PUBLIC grants.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
