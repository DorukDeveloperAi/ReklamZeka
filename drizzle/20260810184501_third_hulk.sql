ALTER TABLE "effective_campaign_context_components" DROP CONSTRAINT "effective_campaign_context_components_type";--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" DROP CONSTRAINT "effective_campaign_context_invalidations_type";--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" ADD CONSTRAINT "effective_campaign_context_components_type" CHECK ("effective_campaign_context_components"."component_type" in (
    'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver', 'instruction_policy', 'promotion_registry', 'policy_authority', 'business_outcome_evidence', 'cadence_profile',
    'deterministic_feature_snapshot', 'deterministic_window_snapshot'
  ));--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" ADD CONSTRAINT "effective_campaign_context_invalidations_type" CHECK ("effective_campaign_context_invalidations"."component_type" in (
    'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver', 'instruction_policy', 'promotion_registry', 'policy_authority', 'business_outcome_evidence', 'cadence_profile',
    'deterministic_feature_snapshot', 'deterministic_window_snapshot'
  ));--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "effective_campaign_context_components", "effective_campaign_context_invalidations"
  FROM PUBLIC, anon, authenticated, service_role;
