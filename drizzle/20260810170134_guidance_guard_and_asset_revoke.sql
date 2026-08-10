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
  parts := pg_catalog.regexp_match(value, '^https://([^/?#]+)(/[^?#]*)?(\\?[^#]*)?$', 'i');
  IF parts IS NULL THEN RETURN false; END IF;
  authority := parts[1];
  IF authority ~ '@' THEN RETURN false; END IF;
  IF authority ~ ':' THEN
    IF pg_catalog.right(authority, 4) <> ':443' THEN RETURN false; END IF;
    official_host := pg_catalog.lower(pg_catalog.left(authority, -4));
  ELSE
    official_host := pg_catalog.lower(authority);
  END IF;
  official_path := coalesce(parts[2], '/');
  IF official_path ~* '(^|/)(\\.|%2e){1,2}(/|$)' OR position(chr(92) in value) > 0 THEN RETURN false; END IF;
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
REVOKE ALL PRIVILEGES ON FUNCTION guidance_official_source_url_allowed(text)
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE analysis_timeframe_definitions, analysis_template_definitions,
  decision_room_schedule_analysis_bindings, decision_room_run_analysis_assets,
  guidance_analysis_run_bindings FROM PUBLIC, anon, authenticated, service_role;
