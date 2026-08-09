ALTER TABLE "audience_preset_authoring_revisions" DROP CONSTRAINT "audience_preset_authoring_payload_exact";--> statement-breakpoint
ALTER TABLE "audience_preset_authoring_revisions" DROP CONSTRAINT "audience_preset_authoring_no_authority";--> statement-breakpoint
ALTER TABLE "promotion_template_authoring_revisions" DROP CONSTRAINT "promotion_template_authoring_payload_exact";--> statement-breakpoint
ALTER TABLE "promotion_template_authoring_revisions" DROP CONSTRAINT "promotion_template_authoring_no_authority";--> statement-breakpoint
ALTER TABLE "audience_preset_authoring_revisions" ADD CONSTRAINT "audience_preset_authoring_payload_exact" CHECK ((
    jsonb_typeof("audience_preset_authoring_revisions"."preset_payload") = 'object'
    and "audience_preset_authoring_revisions"."preset_payload" #>> '{version}' = 'audience-preset-draft-material/1.0.0'
    and "audience_preset_authoring_revisions"."preset_payload" #>> '{workspaceRef}' = "audience_preset_authoring_revisions"."workspace_ref"
    and "audience_preset_authoring_revisions"."preset_payload" #>> '{presetRef}' = "audience_preset_authoring_revisions"."preset_ref"
    and ("audience_preset_authoring_revisions"."preset_payload" #>> '{revision}')::integer = "audience_preset_authoring_revisions"."preset_revision"
    and "audience_preset_authoring_revisions"."preset_payload" #>> '{materialHash}' = "audience_preset_authoring_revisions"."preset_hash"
    and "audience_preset_authoring_revisions"."preset_payload" #> '{authority,canAuthorizeAction}' = 'false'::jsonb
    and "audience_preset_authoring_revisions"."preset_payload" #> '{authority,canExecuteWrite}' = 'false'::jsonb
    and "audience_preset_authoring_revisions"."preset_payload" #> '{authority,canWriteMeta}' = 'false'::jsonb
    and "audience_preset_authoring_revisions"."preset_payload" #> '{authority,canGrantApproval}' = 'false'::jsonb
    and not ("audience_preset_authoring_revisions"."preset_payload" ? 'state') and not ("audience_preset_authoring_revisions"."preset_payload" ? 'publishedAt')
    and (("audience_preset_authoring_revisions"."status" = 'draft' and "audience_preset_authoring_revisions"."published_preset_hash" is null and "audience_preset_authoring_revisions"."published_preset_payload" is null)
      or ("audience_preset_authoring_revisions"."status" = 'published' and "audience_preset_authoring_revisions"."published_preset_hash" ~ '^[a-f0-9]{64}$'
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{presetHash}' = "audience_preset_authoring_revisions"."published_preset_hash"
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{version}' = 'audience-preset/1.0.0'
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{workspaceRef}' = "audience_preset_authoring_revisions"."workspace_ref"
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{presetRef}' = "audience_preset_authoring_revisions"."preset_ref"
          and ("audience_preset_authoring_revisions"."published_preset_payload" #>> '{revision}')::integer = "audience_preset_authoring_revisions"."preset_revision"
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{state}' = 'published'
          and "audience_preset_authoring_revisions"."published_preset_payload" ? 'publishedAt'
          and ("audience_preset_authoring_revisions"."published_preset_payload" - 'version' - 'state' - 'publishedAt' - 'presetHash')
            = ("audience_preset_authoring_revisions"."preset_payload" - 'version' - 'authority' - 'materialHash'))
      or ("audience_preset_authoring_revisions"."status" = 'archived' and (
        ("audience_preset_authoring_revisions"."published_preset_hash" is null and "audience_preset_authoring_revisions"."published_preset_payload" is null)
        or ("audience_preset_authoring_revisions"."published_preset_hash" ~ '^[a-f0-9]{64}$'
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{presetHash}' = "audience_preset_authoring_revisions"."published_preset_hash"
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{version}' = 'audience-preset/1.0.0'
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{workspaceRef}' = "audience_preset_authoring_revisions"."workspace_ref"
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{presetRef}' = "audience_preset_authoring_revisions"."preset_ref"
          and ("audience_preset_authoring_revisions"."published_preset_payload" #>> '{revision}')::integer = "audience_preset_authoring_revisions"."preset_revision"
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{state}' = 'published'
          and "audience_preset_authoring_revisions"."published_preset_payload" ? 'publishedAt'
          and ("audience_preset_authoring_revisions"."published_preset_payload" - 'version' - 'state' - 'publishedAt' - 'presetHash')
            = ("audience_preset_authoring_revisions"."preset_payload" - 'version' - 'authority' - 'materialHash')))))
  ) is true);--> statement-breakpoint
ALTER TABLE "audience_preset_authoring_revisions" ADD CONSTRAINT "audience_preset_authoring_no_authority" CHECK (
    ("audience_preset_authoring_revisions"."preset_payload"::text || coalesce("audience_preset_authoring_revisions"."published_preset_payload"::text, ''))
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|authorization|approvalgranted)"[[:space:]]*:'
    and ("audience_preset_authoring_revisions"."preset_payload"::text || coalesce("audience_preset_authoring_revisions"."published_preset_payload"::text, ''))
      !~* '"(canAuthorizeAction|canExecuteWrite|canWriteMeta|canGrantApproval)"[[:space:]]*:[[:space:]]*true'
  );--> statement-breakpoint
ALTER TABLE "promotion_template_authoring_revisions" ADD CONSTRAINT "promotion_template_authoring_payload_exact" CHECK ((
    jsonb_typeof("promotion_template_authoring_revisions"."preset_payload") = 'object'
    and jsonb_typeof("promotion_template_authoring_revisions"."template_payload") = 'object' and jsonb_typeof("promotion_template_authoring_revisions"."binding_payload") = 'object'
    and "promotion_template_authoring_revisions"."preset_payload" #>> '{workspaceRef}' = "promotion_template_authoring_revisions"."workspace_ref"
    and "promotion_template_authoring_revisions"."preset_payload" #>> '{presetRef}' = "promotion_template_authoring_revisions"."preset_ref"
    and ("promotion_template_authoring_revisions"."preset_payload" #>> '{revision}')::integer = "promotion_template_authoring_revisions"."preset_revision"
    and "promotion_template_authoring_revisions"."preset_payload" #>> '{presetHash}' = "promotion_template_authoring_revisions"."preset_hash"
    and "promotion_template_authoring_revisions"."template_payload" #>> '{workspaceRef}' = "promotion_template_authoring_revisions"."workspace_ref"
    and "promotion_template_authoring_revisions"."template_payload" #>> '{templateRef}' = "promotion_template_authoring_revisions"."template_ref"
    and ("promotion_template_authoring_revisions"."template_payload" #>> '{revision}')::integer = "promotion_template_authoring_revisions"."template_revision"
    and "promotion_template_authoring_revisions"."template_payload" #>> '{materialHash}' = "promotion_template_authoring_revisions"."template_hash"
    and "promotion_template_authoring_revisions"."template_payload" #>> '{audiencePreset,presetRef}' = "promotion_template_authoring_revisions"."preset_ref"
    and ("promotion_template_authoring_revisions"."template_payload" #>> '{audiencePreset,revision}')::integer = "promotion_template_authoring_revisions"."preset_revision"
    and "promotion_template_authoring_revisions"."template_payload" #>> '{audiencePreset,presetHash}' = "promotion_template_authoring_revisions"."preset_hash"
    and "promotion_template_authoring_revisions"."binding_payload" #>> '{bindingRef}' = "promotion_template_authoring_revisions"."binding_ref"
    and "promotion_template_authoring_revisions"."binding_payload" #>> '{materialHash}' = "promotion_template_authoring_revisions"."binding_hash"
    and "promotion_template_authoring_revisions"."binding_payload" #>> '{template,templateRef}' = "promotion_template_authoring_revisions"."template_ref"
    and ("promotion_template_authoring_revisions"."binding_payload" #>> '{template,revision}')::integer = "promotion_template_authoring_revisions"."template_revision"
    and "promotion_template_authoring_revisions"."binding_payload" #>> '{template,materialHash}' = "promotion_template_authoring_revisions"."template_hash"
    and not ("promotion_template_authoring_revisions"."template_payload" ? 'state') and not ("promotion_template_authoring_revisions"."template_payload" ? 'publishedAt')
    and not ("promotion_template_authoring_revisions"."binding_payload" ? 'effectiveFrom')
    and (("promotion_template_authoring_revisions"."status" = 'draft' and "promotion_template_authoring_revisions"."published_template_hash" is null
      and "promotion_template_authoring_revisions"."published_template_payload" is null and "promotion_template_authoring_revisions"."published_binding_hash" is null
      and "promotion_template_authoring_revisions"."published_binding_payload" is null)
      or ("promotion_template_authoring_revisions"."status" = 'published' and "promotion_template_authoring_revisions"."published_template_hash" ~ '^[a-f0-9]{64}$'
          and "promotion_template_authoring_revisions"."published_binding_hash" ~ '^[a-f0-9]{64}$'
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{templateHash}' = "promotion_template_authoring_revisions"."published_template_hash"
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{version}' = 'promotion-template/1.0.0'
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{workspaceRef}' = "promotion_template_authoring_revisions"."workspace_ref"
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{templateRef}' = "promotion_template_authoring_revisions"."template_ref"
          and ("promotion_template_authoring_revisions"."published_template_payload" #>> '{revision}')::integer = "promotion_template_authoring_revisions"."template_revision"
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{state}' = 'published'
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{audiencePreset,presetRef}' = "promotion_template_authoring_revisions"."preset_ref"
          and ("promotion_template_authoring_revisions"."published_template_payload" #>> '{audiencePreset,revision}')::integer = "promotion_template_authoring_revisions"."preset_revision"
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{audiencePreset,presetHash}' = "promotion_template_authoring_revisions"."preset_hash"
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{bindingHash}' = "promotion_template_authoring_revisions"."published_binding_hash"
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{version}' = 'promotion-template-binding/1.0.0'
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{workspaceRef}' = "promotion_template_authoring_revisions"."workspace_ref"
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{bindingRef}' = "promotion_template_authoring_revisions"."binding_ref"
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{template,templateRef}' = "promotion_template_authoring_revisions"."template_ref"
          and ("promotion_template_authoring_revisions"."published_binding_payload" #>> '{template,revision}')::integer = "promotion_template_authoring_revisions"."template_revision"
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{template,templateHash}' = "promotion_template_authoring_revisions"."published_template_hash"
          and "promotion_template_authoring_revisions"."published_binding_payload" ? 'effectiveFrom'
          and ("promotion_template_authoring_revisions"."published_template_payload" - 'version' - 'state' - 'publishedAt' - 'templateHash')
            = ("promotion_template_authoring_revisions"."template_payload" - 'version' - 'authority' - 'materialHash')
          and ("promotion_template_authoring_revisions"."published_binding_payload" - 'version' - 'effectiveFrom' - 'expiresAt' - 'bindingHash' - 'template')
            = ("promotion_template_authoring_revisions"."binding_payload" - 'version' - 'authority' - 'materialHash' - 'template'))
      or ("promotion_template_authoring_revisions"."status" = 'archived' and (
        ("promotion_template_authoring_revisions"."published_template_hash" is null and "promotion_template_authoring_revisions"."published_template_payload" is null
          and "promotion_template_authoring_revisions"."published_binding_hash" is null and "promotion_template_authoring_revisions"."published_binding_payload" is null)
        or ("promotion_template_authoring_revisions"."published_template_hash" ~ '^[a-f0-9]{64}$'
          and "promotion_template_authoring_revisions"."published_binding_hash" ~ '^[a-f0-9]{64}$'
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{templateHash}' = "promotion_template_authoring_revisions"."published_template_hash"
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{version}' = 'promotion-template/1.0.0'
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{workspaceRef}' = "promotion_template_authoring_revisions"."workspace_ref"
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{templateRef}' = "promotion_template_authoring_revisions"."template_ref"
          and ("promotion_template_authoring_revisions"."published_template_payload" #>> '{revision}')::integer = "promotion_template_authoring_revisions"."template_revision"
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{state}' = 'published'
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{audiencePreset,presetRef}' = "promotion_template_authoring_revisions"."preset_ref"
          and ("promotion_template_authoring_revisions"."published_template_payload" #>> '{audiencePreset,revision}')::integer = "promotion_template_authoring_revisions"."preset_revision"
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{audiencePreset,presetHash}' = "promotion_template_authoring_revisions"."preset_hash"
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{bindingHash}' = "promotion_template_authoring_revisions"."published_binding_hash"
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{version}' = 'promotion-template-binding/1.0.0'
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{workspaceRef}' = "promotion_template_authoring_revisions"."workspace_ref"
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{bindingRef}' = "promotion_template_authoring_revisions"."binding_ref"
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{template,templateRef}' = "promotion_template_authoring_revisions"."template_ref"
          and ("promotion_template_authoring_revisions"."published_binding_payload" #>> '{template,revision}')::integer = "promotion_template_authoring_revisions"."template_revision"
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{template,templateHash}' = "promotion_template_authoring_revisions"."published_template_hash"
          and "promotion_template_authoring_revisions"."published_binding_payload" ? 'effectiveFrom'
          and ("promotion_template_authoring_revisions"."published_template_payload" - 'version' - 'state' - 'publishedAt' - 'templateHash')
            = ("promotion_template_authoring_revisions"."template_payload" - 'version' - 'authority' - 'materialHash')
          and ("promotion_template_authoring_revisions"."published_binding_payload" - 'version' - 'effectiveFrom' - 'expiresAt' - 'bindingHash' - 'template')
            = ("promotion_template_authoring_revisions"."binding_payload" - 'version' - 'authority' - 'materialHash' - 'template')))))
  ) is true);--> statement-breakpoint
ALTER TABLE "promotion_template_authoring_revisions" ADD CONSTRAINT "promotion_template_authoring_no_authority" CHECK (
    ("promotion_template_authoring_revisions"."preset_payload"::text || "promotion_template_authoring_revisions"."template_payload"::text || "promotion_template_authoring_revisions"."binding_payload"::text
      || coalesce("promotion_template_authoring_revisions"."published_template_payload"::text, '') || coalesce("promotion_template_authoring_revisions"."published_binding_payload"::text, ''))
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|authorization|approvalgranted)"[[:space:]]*:'
    and ("promotion_template_authoring_revisions"."preset_payload"::text || "promotion_template_authoring_revisions"."template_payload"::text || "promotion_template_authoring_revisions"."binding_payload"::text
      || coalesce("promotion_template_authoring_revisions"."published_template_payload"::text, '') || coalesce("promotion_template_authoring_revisions"."published_binding_payload"::text, ''))
      !~* '"(canAuthorizeAction|canExecuteWrite|canWriteMeta|canGrantApproval)"[[:space:]]*:[[:space:]]*true'
  );
--> statement-breakpoint
DROP TRIGGER "audience_preset_authoring_append_only_trigger" ON "audience_preset_authoring_revisions";
--> statement-breakpoint
DROP TRIGGER "promotion_template_authoring_append_only_trigger" ON "promotion_template_authoring_revisions";
--> statement-breakpoint
CREATE FUNCTION promotion_authoring_revision_immutable() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'promotion_authoring_revision_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audience_preset_authoring_append_only_trigger
BEFORE UPDATE OR DELETE ON audience_preset_authoring_revisions
FOR EACH ROW EXECUTE FUNCTION promotion_authoring_revision_immutable();
--> statement-breakpoint
CREATE TRIGGER promotion_template_authoring_append_only_trigger
BEFORE UPDATE OR DELETE ON promotion_template_authoring_revisions
FOR EACH ROW EXECUTE FUNCTION promotion_authoring_revision_immutable();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION promotion_authoring_revision_immutable()
  FROM PUBLIC, anon, authenticated, service_role;
