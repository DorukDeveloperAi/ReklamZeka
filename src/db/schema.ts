import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "analyst", "viewer"]);
export const sourcePlatform = pgEnum("source_platform", ["meta_ads", "google_ads", "csv"]);
export const syncRunStatus = pgEnum("sync_run_status", ["running", "completed", "failed"]);
export const insightFeedbackValue = pgEnum("insight_feedback_value", ["helpful", "unhelpful", "acted"]);
export const metaConnectionStatus = pgEnum("meta_connection_status", [
  "active",
  "disconnected",
  "revoked",
  "invalid",
]);
export const metaAssetType = pgEnum("meta_asset_type", [
  "facebook_page",
  "instagram_account",
  "pixel",
  "dataset",
  "app",
  "whatsapp_account",
  "destination",
]);
export const metaSyncRunStatus = pgEnum("meta_sync_run_status", [
  "pending",
  "running",
  "partial",
  "completed",
  "failed",
  "cancelled",
]);
export const metaSyncStreamType = pgEnum("meta_sync_stream_type", ["inventory", "creative", "insights"]);
export const metaInsightEntityLevel = pgEnum("meta_insight_entity_level", ["campaign", "ad_set", "ad"]);
export const metaMetricAggregation = pgEnum("meta_metric_aggregation", ["additive", "non_additive", "derived"]);
export const metaSyncErrorClassification = pgEnum("meta_sync_error_classification", [
  "authentication",
  "permission_missing",
  "unsupported",
  "rate_limited",
  "payload_too_large",
  "timeout",
  "upstream",
  "validation",
  "cancelled",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Secret-free connection metadata. Credentials remain in connection_secrets and
 * are deliberately not exposed through this relation.
 */
export const metaConnections = pgTable("meta_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  externalConnectionKey: text("external_connection_key").notNull(),
  displayName: text("display_name").notNull(),
  externalBusinessId: text("external_business_id"),
  graphApiVersion: text("graph_api_version").notNull(),
  fieldCatalogVersion: text("field_catalog_version").notNull(),
  status: metaConnectionStatus("status").notNull().default("active"),
  grantedScopes: jsonb("granted_scopes").$type<readonly string[]>().notNull().default([]),
  enabledCapabilities: jsonb("enabled_capabilities").$type<readonly string[]>().notNull().default([]),
  capabilitySnapshot: jsonb("capability_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  capabilityCheckedAt: timestamp("capability_checked_at", { withTimezone: true }),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  dataAccessExpiresAt: timestamp("data_access_expires_at", { withTimezone: true }),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_connections_workspace_external_key_unique").on(
    table.workspaceId,
    table.externalConnectionKey,
  ),
  index("meta_connections_workspace_status_idx").on(table.workspaceId, table.status),
]);

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: membershipRole("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("memberships_workspace_user_unique").on(table.workspaceId, table.userId),
  index("memberships_user_idx").on(table.userId),
]);

export const dataSources = pgTable("data_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").references(() => metaConnections.id, { onDelete: "restrict" }),
  platform: sourcePlatform("platform").notNull(),
  externalAccountId: text("external_account_id").notNull(),
  displayName: text("display_name").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("data_sources_workspace_platform_external_unique").on(
    table.workspaceId,
    table.platform,
    table.externalAccountId,
  ),
  uniqueIndex("data_sources_meta_connection_external_unique").on(
    table.metaConnectionId,
    table.externalAccountId,
  ),
  index("data_sources_meta_connection_idx").on(table.metaConnectionId),
]);

export const adAccounts = pgTable("ad_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "cascade" }),
  externalAccountId: text("external_account_id").notNull(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  timezone: text("timezone").notNull(),
  configuredStatus: text("configured_status"),
  effectiveStatus: text("effective_status"),
  accountStatus: text("account_status"),
  permissionSnapshot: jsonb("permission_snapshot").$type<readonly string[]>(),
  capabilitySnapshot: jsonb("capability_snapshot").$type<Record<string, unknown>>(),
  unsupportedFields: jsonb("unsupported_fields").$type<readonly Record<string, unknown>[]>(),
  spendCapMinor: bigint("spend_cap_minor", { mode: "number" }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  rawPayloadHash: text("raw_payload_hash"),
  sourceGraphVersion: text("source_graph_version"),
  fieldCatalogVersion: text("field_catalog_version"),
  provenance: jsonb("provenance").$type<Record<string, unknown>>(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  disappearedAt: timestamp("disappeared_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ad_accounts_source_external_unique").on(table.dataSourceId, table.externalAccountId),
  index("ad_accounts_workspace_idx").on(table.workspaceId),
]);

export const adCampaigns = pgTable("ad_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  externalCampaignId: text("external_campaign_id").notNull(),
  name: text("name").notNull(),
  configuredStatus: text("configured_status"),
  effectiveStatus: text("effective_status"),
  statusIssues: jsonb("status_issues").$type<readonly Record<string, unknown>[]>(),
  unsupportedFields: jsonb("unsupported_fields").$type<readonly Record<string, unknown>[]>(),
  objectiveSource: text("objective_source"),
  legacyObjectiveSource: text("legacy_objective_source"),
  canonicalObjective: text("canonical_objective"),
  objectiveMappingVersion: text("objective_mapping_version"),
  buyingType: text("buying_type"),
  bidStrategy: text("bid_strategy"),
  specialAdCategories: jsonb("special_ad_categories").$type<readonly string[]>(),
  advantagePlusEnabled: boolean("advantage_plus_enabled"),
  campaignBudgetOptimization: boolean("campaign_budget_optimization"),
  dailyBudgetMinor: bigint("daily_budget_minor", { mode: "number" }),
  lifetimeBudgetMinor: bigint("lifetime_budget_minor", { mode: "number" }),
  budgetRemainingMinor: bigint("budget_remaining_minor", { mode: "number" }),
  startAt: timestamp("start_at", { withTimezone: true }),
  stopAt: timestamp("stop_at", { withTimezone: true }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  rawPayloadHash: text("raw_payload_hash"),
  sourceGraphVersion: text("source_graph_version"),
  fieldCatalogVersion: text("field_catalog_version"),
  provenance: jsonb("provenance").$type<Record<string, unknown>>(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  disappearedAt: timestamp("disappeared_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ad_campaigns_account_external_unique").on(table.adAccountId, table.externalCampaignId),
  index("ad_campaigns_workspace_idx").on(table.workspaceId),
]);

export const metaAdSets = pgTable("meta_ad_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => adCampaigns.id, { onDelete: "cascade" }),
  externalAdSetId: text("external_ad_set_id").notNull(),
  name: text("name").notNull(),
  configuredStatus: text("configured_status"),
  effectiveStatus: text("effective_status"),
  statusIssues: jsonb("status_issues").$type<readonly Record<string, unknown>[]>(),
  unsupportedFields: jsonb("unsupported_fields").$type<readonly Record<string, unknown>[]>(),
  optimizationGoal: text("optimization_goal"),
  billingEvent: text("billing_event"),
  bidStrategy: text("bid_strategy"),
  bidAmountMinor: bigint("bid_amount_minor", { mode: "number" }),
  costCapMinor: bigint("cost_cap_minor", { mode: "number" }),
  dailyBudgetMinor: bigint("daily_budget_minor", { mode: "number" }),
  lifetimeBudgetMinor: bigint("lifetime_budget_minor", { mode: "number" }),
  attributionSpec: jsonb("attribution_spec").$type<readonly Record<string, unknown>[]>(),
  promotedObject: jsonb("promoted_object").$type<Record<string, unknown>>(),
  targetingSummary: jsonb("targeting_summary").$type<Record<string, unknown>>(),
  targetingSignature: text("targeting_signature"),
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  rawPayloadHash: text("raw_payload_hash").notNull(),
  sourceGraphVersion: text("source_graph_version").notNull(),
  fieldCatalogVersion: text("field_catalog_version").notNull(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  disappearedAt: timestamp("disappeared_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_ad_sets_account_external_unique").on(table.adAccountId, table.externalAdSetId),
  index("meta_ad_sets_workspace_campaign_idx").on(table.workspaceId, table.campaignId),
]);

export const metaAssets = pgTable("meta_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  assetType: metaAssetType("asset_type").notNull(),
  externalAssetId: text("external_asset_id").notNull(),
  displayName: text("display_name"),
  permissionSnapshot: jsonb("permission_snapshot").$type<readonly string[]>(),
  capabilitySnapshot: jsonb("capability_snapshot").$type<Record<string, unknown>>(),
  unsupportedFields: jsonb("unsupported_fields").$type<readonly Record<string, unknown>[]>(),
  configuredStatus: text("configured_status"),
  effectiveStatus: text("effective_status"),
  orphanReason: text("orphan_reason"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  rawPayloadHash: text("raw_payload_hash").notNull(),
  sourceGraphVersion: text("source_graph_version").notNull(),
  fieldCatalogVersion: text("field_catalog_version").notNull(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  disappearedAt: timestamp("disappeared_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_assets_connection_type_external_unique").on(
    table.metaConnectionId,
    table.assetType,
    table.externalAssetId,
  ),
  index("meta_assets_workspace_type_idx").on(table.workspaceId, table.assetType),
]);

export const metaPosts = pgTable("meta_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  actorAssetId: uuid("actor_asset_id").references(() => metaAssets.id, { onDelete: "restrict" }),
  externalPostId: text("external_post_id").notNull(),
  externalMediaId: text("external_media_id"),
  mediaType: text("media_type"),
  permalink: text("permalink"),
  configuredStatus: text("configured_status"),
  effectiveStatus: text("effective_status"),
  unsupportedFields: jsonb("unsupported_fields").$type<readonly Record<string, unknown>[]>(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  rawPayloadHash: text("raw_payload_hash").notNull(),
  sourceGraphVersion: text("source_graph_version").notNull(),
  fieldCatalogVersion: text("field_catalog_version").notNull(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  disappearedAt: timestamp("disappeared_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_posts_connection_external_unique").on(table.metaConnectionId, table.externalPostId),
  index("meta_posts_workspace_actor_idx").on(table.workspaceId, table.actorAssetId),
]);

export const metaCreatives = pgTable("meta_creatives", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  postId: uuid("post_id").references(() => metaPosts.id, { onDelete: "restrict" }),
  actorAssetId: uuid("actor_asset_id").references(() => metaAssets.id, { onDelete: "restrict" }),
  externalCreativeId: text("external_creative_id").notNull(),
  name: text("name"),
  sourceType: text("source_type").notNull(),
  primaryText: text("primary_text"),
  headline: text("headline"),
  description: text("description"),
  caption: text("caption"),
  callToActionType: text("call_to_action_type"),
  destinationUrl: text("destination_url"),
  creativeFormat: text("creative_format"),
  contentProvenance: jsonb("content_provenance").$type<Record<string, unknown>>().notNull(),
  dynamicVariants: jsonb("dynamic_variants").$type<readonly Record<string, unknown>[]>().notNull().default([]),
  unsupportedFields: jsonb("unsupported_fields").$type<readonly Record<string, unknown>[]>(),
  configuredStatus: text("configured_status"),
  effectiveStatus: text("effective_status"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  rawPayloadHash: text("raw_payload_hash").notNull(),
  sourceGraphVersion: text("source_graph_version").notNull(),
  fieldCatalogVersion: text("field_catalog_version").notNull(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  disappearedAt: timestamp("disappeared_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_creatives_account_external_unique").on(table.adAccountId, table.externalCreativeId),
  index("meta_creatives_workspace_post_idx").on(table.workspaceId, table.postId),
]);

export const metaAds = pgTable("meta_ads", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => adCampaigns.id, { onDelete: "cascade" }),
  adSetId: uuid("ad_set_id").notNull().references(() => metaAdSets.id, { onDelete: "cascade" }),
  creativeId: uuid("creative_id").references(() => metaCreatives.id, { onDelete: "restrict" }),
  externalAdId: text("external_ad_id").notNull(),
  name: text("name").notNull(),
  configuredStatus: text("configured_status"),
  effectiveStatus: text("effective_status"),
  statusIssues: jsonb("status_issues").$type<readonly Record<string, unknown>[]>(),
  unsupportedFields: jsonb("unsupported_fields").$type<readonly Record<string, unknown>[]>(),
  reviewFeedback: jsonb("review_feedback").$type<Record<string, unknown>>(),
  trackingSpecs: jsonb("tracking_specs").$type<readonly Record<string, unknown>[]>(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  rawPayloadHash: text("raw_payload_hash").notNull(),
  sourceGraphVersion: text("source_graph_version").notNull(),
  fieldCatalogVersion: text("field_catalog_version").notNull(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  disappearedAt: timestamp("disappeared_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_ads_account_external_unique").on(table.adAccountId, table.externalAdId),
  index("meta_ads_workspace_ad_set_idx").on(table.workspaceId, table.adSetId),
]);

export const metaAssetEdges = pgTable("meta_asset_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").references(() => adAccounts.id, { onDelete: "cascade" }),
  sourceEntityType: text("source_entity_type").notNull(),
  sourceExternalId: text("source_external_id").notNull(),
  targetAssetId: uuid("target_asset_id").notNull().references(() => metaAssets.id, { onDelete: "cascade" }),
  relationship: text("relationship").notNull(),
  capabilitySnapshot: jsonb("capability_snapshot").$type<Record<string, unknown>>(),
  orphanReason: text("orphan_reason"),
  rawPayloadHash: text("raw_payload_hash").notNull(),
  sourceGraphVersion: text("source_graph_version").notNull(),
  fieldCatalogVersion: text("field_catalog_version").notNull(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  disappearedAt: timestamp("disappeared_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("meta_asset_edges_source_target_relationship_unique").on(
    table.metaConnectionId,
    table.sourceEntityType,
    table.sourceExternalId,
    table.targetAssetId,
    table.relationship,
  ),
  index("meta_asset_edges_workspace_account_idx").on(table.workspaceId, table.adAccountId),
]);

export const metaAdCreativeBindings = pgTable("meta_ad_creative_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adId: uuid("ad_id").notNull().references(() => metaAds.id, { onDelete: "cascade" }),
  creativeId: uuid("creative_id").notNull().references(() => metaCreatives.id, { onDelete: "restrict" }),
  postId: uuid("post_id").references(() => metaPosts.id, { onDelete: "restrict" }),
  bindingPayloadHash: text("binding_payload_hash").notNull(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  disappearedAt: timestamp("disappeared_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("meta_ad_creative_bindings_ad_creative_unique").on(table.adId, table.creativeId),
  index("meta_ad_creative_bindings_workspace_idx").on(table.workspaceId),
]);

/**
 * A portfolio run groups independent account/stream work without making one
 * stream's failure roll back another stream's durable result.
 */
export const metaPortfolioSyncRuns = pgTable("meta_portfolio_sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  status: metaSyncRunStatus("status").notNull().default("pending"),
  requestContext: jsonb("request_context").$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_portfolio_sync_runs_workspace_connection_idempotency_unique").on(
    table.workspaceId, table.metaConnectionId, table.idempotencyKey,
  ),
  index("meta_portfolio_sync_runs_workspace_connection_created_idx").on(
    table.workspaceId, table.metaConnectionId, table.createdAt,
  ),
]);

/** Current independent cursor/checkpoint for each account and stream. */
export const metaSyncStreams = pgTable("meta_sync_streams", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  streamType: metaSyncStreamType("stream_type").notNull(),
  status: metaSyncRunStatus("status").notNull().default("pending"),
  cursor: text("cursor"),
  checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull().default({}),
  sourceRevision: text("source_revision"),
  lastErrorClassification: metaSyncErrorClassification("last_error_classification"),
  lastError: jsonb("last_error").$type<Record<string, unknown>>(),
  retryAt: timestamp("retry_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_sync_streams_workspace_connection_account_type_unique").on(
    table.workspaceId, table.metaConnectionId, table.adAccountId, table.streamType,
  ),
  index("meta_sync_streams_workspace_account_status_idx").on(table.workspaceId, table.adAccountId, table.status),
]);

/** One attempted execution of one stream; it can resume a prior partial run. */
export const metaSyncRuns = pgTable("meta_sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  portfolioRunId: uuid("portfolio_run_id").references(() => metaPortfolioSyncRuns.id, { onDelete: "set null" }),
  parentRunId: uuid("parent_run_id").references((): AnyPgColumn => metaSyncRuns.id, { onDelete: "set null" }),
  streamId: uuid("stream_id").notNull().references(() => metaSyncStreams.id, { onDelete: "cascade" }),
  streamType: metaSyncStreamType("stream_type").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: metaSyncRunStatus("status").notNull().default("pending"),
  cursor: text("cursor"),
  checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull().default({}),
  attemptCount: integer("attempt_count").notNull().default(0),
  retryAt: timestamp("retry_at", { withTimezone: true }),
  errorClassification: metaSyncErrorClassification("error_classification"),
  errorDetail: jsonb("error_detail").$type<Record<string, unknown>>(),
  sourceRevision: text("source_revision"),
  sourcePayloadHash: text("source_payload_hash"),
  insertedCount: integer("inserted_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  unchangedCount: integer("unchanged_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_sync_runs_workspace_connection_account_stream_idempotency_unique").on(
    table.workspaceId, table.metaConnectionId, table.adAccountId, table.streamType, table.idempotencyKey,
  ),
  index("meta_sync_runs_workspace_account_stream_started_idx").on(
    table.workspaceId, table.adAccountId, table.streamType, table.startedAt,
  ),
  index("meta_sync_runs_parent_run_idx").on(table.parentRunId),
]);

/** A date/entity slice is the smallest resumable unit of a stream run. */
export const metaSyncSlices = pgTable("meta_sync_slices", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => metaSyncRuns.id, { onDelete: "cascade" }),
  streamType: metaSyncStreamType("stream_type").notNull(),
  entityLevel: metaInsightEntityLevel("entity_level"),
  dateStart: date("date_start", { mode: "string" }),
  dateStop: date("date_stop", { mode: "string" }),
  sliceKey: text("slice_key").notNull(),
  status: metaSyncRunStatus("status").notNull().default("pending"),
  cursor: text("cursor"),
  checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull().default({}),
  attemptCount: integer("attempt_count").notNull().default(0),
  retryAt: timestamp("retry_at", { withTimezone: true }),
  errorClassification: metaSyncErrorClassification("error_classification"),
  errorDetail: jsonb("error_detail").$type<Record<string, unknown>>(),
  sourceRevision: text("source_revision"),
  sourcePayloadHash: text("source_payload_hash"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_sync_slices_run_slice_key_unique").on(table.runId, table.sliceKey),
  index("meta_sync_slices_workspace_account_stream_status_idx").on(
    table.workspaceId, table.adAccountId, table.streamType, table.status,
  ),
]);

/**
 * One canonical daily Meta entity snapshot. Null currency/timezone/window never
 * means a default: fieldAvailability records unsupported or permission gaps.
 */
export const metaDailyInsights = pgTable("meta_daily_insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  syncRunId: uuid("sync_run_id").references(() => metaSyncRuns.id, { onDelete: "set null" }),
  syncSliceId: uuid("sync_slice_id").references(() => metaSyncSlices.id, { onDelete: "set null" }),
  entityLevel: metaInsightEntityLevel("entity_level").notNull(),
  externalEntityId: text("external_entity_id").notNull(),
  dateStart: date("date_start", { mode: "string" }).notNull(),
  dateStop: date("date_stop", { mode: "string" }).notNull(),
  attributionLabel: text("attribution_label").notNull(),
  attributionWindow: jsonb("attribution_window").$type<Record<string, unknown>>(),
  currency: text("currency"),
  timezone: text("timezone"),
  fieldAvailability: jsonb("field_availability").$type<Record<string, unknown>>().notNull().default({}),
  sourceRevision: text("source_revision").notNull(),
  sourcePayloadHash: text("source_payload_hash").notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  metricProvenance: jsonb("metric_provenance").$type<Record<string, unknown>>().notNull().default({}),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_daily_insights_canonical_snapshot_unique").on(
    table.workspaceId, table.adAccountId, table.entityLevel, table.externalEntityId,
    table.dateStart, table.dateStop, table.attributionLabel,
  ),
  index("meta_daily_insights_workspace_account_date_idx").on(table.workspaceId, table.adAccountId, table.dateStart),
  index("meta_daily_insights_run_idx").on(table.syncRunId),
]);

/** Extensible metric rows keep action/action-value families without column churn. */
export const metaDailyInsightMetrics = pgTable("meta_daily_insight_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  dailyInsightId: uuid("daily_insight_id").notNull().references(() => metaDailyInsights.id, { onDelete: "cascade" }),
  metricKey: text("metric_key").notNull(),
  actionType: text("action_type").notNull().default(""),
  aggregation: metaMetricAggregation("aggregation").notNull(),
  valueDecimal: numeric("value_decimal", { precision: 30, scale: 10 }),
  valueMinor: bigint("value_minor", { mode: "number" }),
  valueJson: jsonb("value_json").$type<Record<string, unknown>>(),
  currency: text("currency"),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
  availability: jsonb("availability").$type<Record<string, unknown>>().notNull().default({}),
  sourceRevision: text("source_revision").notNull(),
  sourcePayloadHash: text("source_payload_hash").notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_daily_insight_metrics_snapshot_metric_action_unique").on(
    table.dailyInsightId, table.metricKey, table.actionType,
  ),
  index("meta_daily_insight_metrics_metric_idx").on(table.metricKey),
]);

export const dailyAdMetrics = pgTable("daily_ad_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "cascade" }),
  adCampaignId: uuid("ad_campaign_id").notNull().references(() => adCampaigns.id, { onDelete: "cascade" }),
  metricDate: date("metric_date", { mode: "string" }).notNull(),
  attributionModel: text("attribution_model").notNull(),
  attributionClickDays: integer("attribution_click_days").notNull(),
  attributionViewDays: integer("attribution_view_days").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  spendMinor: bigint("spend_minor", { mode: "number" }).notNull(),
  impressions: bigint("impressions", { mode: "number" }).notNull(),
  clicks: bigint("clicks", { mode: "number" }).notNull(),
  conversions: doublePrecision("conversions").notNull(),
  conversionValueMinor: bigint("conversion_value_minor", { mode: "number" }).notNull(),
  sourceRowId: text("source_row_id").notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
  sourcePayloadHash: text("source_payload_hash").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("daily_ad_metrics_canonical_unique").on(
    table.workspaceId,
    table.dataSourceId,
    table.adCampaignId,
    table.metricDate,
    table.attributionModel,
    table.attributionClickDays,
    table.attributionViewDays,
    table.schemaVersion,
  ),
  index("daily_ad_metrics_workspace_date_idx").on(table.workspaceId, table.metricDate),
]);

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "cascade" }),
  status: syncRunStatus("status").notNull(),
  resumeCursor: text("resume_cursor"),
  insertedCount: integer("inserted_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  unchangedCount: integer("unchanged_count").notNull().default(0),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  index("sync_runs_workspace_source_started_idx").on(table.workspaceId, table.dataSourceId, table.startedAt),
]);

export const connectionSecrets = pgTable("connection_secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "cascade" }),
  algorithm: text("algorithm").notNull(),
  keyVersion: integer("key_version").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  ciphertext: text("ciphertext").notNull(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("connection_secrets_source_unique").on(table.dataSourceId),
  index("connection_secrets_workspace_idx").on(table.workspaceId),
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>(),
  previousHash: text("previous_hash").notNull(),
  eventHash: text("event_hash").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("audit_events_hash_unique").on(table.eventHash),
  index("audit_events_workspace_occurred_idx").on(table.workspaceId, table.occurredAt),
]);

export const insights = pgTable("insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").notNull(),
  ruleId: text("rule_id").notNull(),
  calculationVersion: text("calculation_version").notNull(),
  severity: text("severity").notNull(),
  confidenceScore: doublePrecision("confidence_score").notNull(),
  title: text("title").notNull(),
  explanation: text("explanation").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  recommendedAction: text("recommended_action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("insights_snapshot_rule_version_unique").on(
    table.workspaceId, table.snapshotId, table.ruleId, table.calculationVersion,
  ),
  index("insights_workspace_created_idx").on(table.workspaceId, table.createdAt),
]);

export const insightFeedback = pgTable("insight_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  insightId: uuid("insight_id").notNull().references(() => insights.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  insightVersion: text("insight_version").notNull(),
  value: insightFeedbackValue("value").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("insight_feedback_insight_user_unique").on(table.insightId, table.userId),
  index("insight_feedback_workspace_recorded_idx").on(table.workspaceId, table.recordedAt),
]);

export const reportShares = pgTable("report_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("report_shares_token_hash_unique").on(table.tokenHash),
  index("report_shares_workspace_expires_idx").on(table.workspaceId, table.expiresAt),
]);

export const operationalEvents = pgTable("operational_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  metric: text("metric").notNull(),
  value: doublePrecision("value").notNull(),
  tags: jsonb("tags").$type<Record<string, string | number | boolean>>(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("operational_events_metric_observed_idx").on(table.metric, table.observedAt),
  index("operational_events_workspace_observed_idx").on(table.workspaceId, table.observedAt),
]);
