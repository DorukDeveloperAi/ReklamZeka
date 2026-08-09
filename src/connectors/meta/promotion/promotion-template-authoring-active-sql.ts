import { sql } from "drizzle-orm";

/**
 * Immutable registry rows predate authoring lifecycles, so an absent lifecycle
 * remains legacy-active. Draft heads do not alter effective published material:
 * among publication/archive events, only the latest event decides actionability.
 * Its exact immutable hashes must match when published; an archive withdraws the
 * template. This preserves the prior publication while a new draft is prepared.
 *
 * All consumers use the stable `template` and `binding` aliases.
 */
export const currentPromotionTemplateAuthoringHeadSql = sql`
  (
    not exists (
      select 1 from promotion_template_authoring_revisions managed_event
      where managed_event.workspace_id = template.workspace_id
        and managed_event.template_ref = template.template_ref
        and managed_event.status in ('published', 'archived')
    )
    or exists (
      select 1 from promotion_template_authoring_revisions effective_event
      where effective_event.workspace_id = template.workspace_id
        and effective_event.template_ref = template.template_ref
        and effective_event.status = 'published'
        and effective_event.published_template_hash = template.template_hash
        and effective_event.published_binding_hash = binding.binding_hash
        and not exists (
          select 1 from promotion_template_authoring_revisions newer_event
          where newer_event.workspace_id = effective_event.workspace_id
            and newer_event.template_ref = effective_event.template_ref
            and newer_event.status in ('published', 'archived')
            and newer_event.lifecycle_version > effective_event.lifecycle_version
        )
    )
  )
`;
