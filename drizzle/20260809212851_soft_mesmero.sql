ALTER TABLE "guidance_analysis_run_bindings" DROP CONSTRAINT "guidance_analysis_run_bindings_arrays";--> statement-breakpoint
ALTER TABLE "guidance_analysis_run_bindings" DROP CONSTRAINT "guidance_analysis_run_bindings_exact_refs";--> statement-breakpoint
ALTER TABLE "guidance_sources" DROP CONSTRAINT "guidance_sources_official_publish_evidence";--> statement-breakpoint
ALTER TABLE "guidance_analysis_run_bindings" ADD CONSTRAINT "guidance_analysis_run_bindings_arrays" CHECK (
    jsonb_typeof("guidance_analysis_run_bindings"."selected_set_refs") = 'array'
    and jsonb_typeof("guidance_analysis_run_bindings"."card_refs") = 'array'
    and jsonb_typeof("guidance_analysis_run_bindings"."source_refs") = 'array'
    and jsonb_array_length("guidance_analysis_run_bindings"."selected_set_refs") <= 50
    and jsonb_array_length("guidance_analysis_run_bindings"."card_refs") <= 500
    and jsonb_array_length("guidance_analysis_run_bindings"."source_refs") <= 1000
  );--> statement-breakpoint
CREATE OR REPLACE FUNCTION guidance_revision_refs_exact(payload jsonb, ref_key text) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  entry jsonb;
  seen_refs text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(payload) <> 'array' OR ref_key NOT IN ('setRef', 'cardRef', 'sourceRef') THEN
    RETURN false;
  END IF;
  FOR entry IN SELECT value FROM pg_catalog.jsonb_array_elements(payload) LOOP
    IF jsonb_typeof(entry) <> 'object'
      OR entry - ref_key - 'version' - 'recordHash' <> '{}'::jsonb
      OR NOT entry ? ref_key OR NOT entry ? 'version' OR NOT entry ? 'recordHash'
      OR jsonb_typeof(entry -> ref_key) <> 'string'
      OR jsonb_typeof(entry -> 'version') <> 'number'
      OR jsonb_typeof(entry -> 'recordHash') <> 'string'
    THEN
      RETURN false;
    END IF;
    IF entry ->> ref_key !~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
      OR entry ->> 'version' !~ '^[1-9][0-9]{0,9}$'
      OR entry ->> 'recordHash' !~ '^[a-f0-9]{64}$'
    THEN
      RETURN false;
    END IF;
    IF (entry ->> 'version')::numeric > 2147483647 OR entry ->> ref_key = ANY(seen_refs) THEN
      RETURN false;
    END IF;
    seen_refs := pg_catalog.array_append(seen_refs, entry ->> ref_key);
  END LOOP;
  RETURN true;
END;
$$;--> statement-breakpoint
ALTER TABLE "guidance_analysis_run_bindings" ADD CONSTRAINT "guidance_analysis_run_bindings_exact_refs" CHECK (
  guidance_revision_refs_exact("selected_set_refs", 'setRef')
  and guidance_revision_refs_exact("card_refs", 'cardRef')
  and guidance_revision_refs_exact("source_refs", 'sourceRef')
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION guidance_official_source_url_allowed(value text) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  parts text[];
  authority text;
  official_host text;
  official_path text;
BEGIN
  IF value ~ '[[:space:][:cntrl:]]' THEN RETURN false; END IF;
  parts := pg_catalog.regexp_match(value, '^https://([^/?#]+)(/[^?#]*)?(\?[^#]*)?$', 'i');
  IF parts IS NULL THEN RETURN false; END IF;
  authority := parts[1];
  IF authority ~ '@' THEN RETURN false; END IF;
  IF authority ~ ':' THEN
    IF pg_catalog.right(authority, 4) <> ':443' THEN RETURN false; END IF;
    official_host := pg_catalog.lower(pg_catalog.left(authority, -4));
  ELSE
    official_host := pg_catalog.lower(authority);
  END IF;
  official_path := pg_catalog.coalesce(parts[2], '/');
  IF official_path ~* '(^|/)(\.|%2e){1,2}(/|$)' OR value ~ '\\' THEN RETURN false; END IF;
  official_path := pg_catalog.regexp_replace(official_path, '/+$', '');
  IF official_path = '' THEN official_path := '/'; END IF;

  IF official_host IN ('facebook.com', 'www.facebook.com') THEN
    RETURN official_path = '/business/help' OR official_path LIKE '/business/help/%'
      OR official_path = '/business/ads-guide' OR official_path LIKE '/business/ads-guide/%';
  ELSIF official_host = 'developers.facebook.com' THEN
    RETURN official_path = '/docs' OR official_path LIKE '/docs/%';
  ELSIF official_host IN ('meta.com', 'www.meta.com') THEN
    RETURN official_path = '/help' OR official_path LIKE '/help/%'
      OR official_path = '/business' OR official_path LIKE '/business/%'
      OR official_path = '/policies' OR official_path LIKE '/policies/%'
      OR official_path = '/technologies' OR official_path LIKE '/technologies/%';
  ELSIF official_host = 'developers.meta.com' THEN
    RETURN official_path = '/' OR official_path = '/docs' OR official_path LIKE '/docs/%';
  ELSIF official_host = 'transparency.meta.com' THEN
    RETURN official_path = '/policies' OR official_path LIKE '/policies/%';
  ELSIF official_host = 'developers.instagram.com' THEN
    RETURN official_path = '/' OR official_path = '/docs' OR official_path LIKE '/docs/%';
  ELSIF official_host = 'help.instagram.com' THEN
    RETURN official_path = '/' OR official_path ~ '^/[0-9]+(/.*)?$';
  ELSIF official_host = 'business.instagram.com' THEN
    RETURN official_path = '/blog' OR official_path LIKE '/blog/%';
  END IF;
  RETURN false;
END;
$$;--> statement-breakpoint
ALTER TABLE "guidance_sources" ADD CONSTRAINT "guidance_sources_official_publish_evidence" CHECK (
    "guidance_sources"."source_type" <> 'official_meta_guidance' or "guidance_sources"."status" <> 'published' or (
      "guidance_sources"."source_url" is not null and guidance_official_source_url_allowed("guidance_sources"."source_url")
      and "guidance_sources"."captured_at" is not null
      and "guidance_sources"."reviewed_at" is not null and "guidance_sources"."review_by" is not null
      and "guidance_sources"."reviewed_at" >= "guidance_sources"."captured_at" and "guidance_sources"."review_by" > "guidance_sources"."reviewed_at"
    )
  );--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION guidance_revision_refs_exact(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION guidance_official_source_url_allowed(text)
  FROM PUBLIC, anon, authenticated, service_role;
