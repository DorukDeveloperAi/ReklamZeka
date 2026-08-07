import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
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
import { sql } from "drizzle-orm";

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "analyst", "viewer"]);
export const workspaceLifecycleState = pgEnum("workspace_lifecycle_state", [
  "active",
  "tombstoning",
  "tombstoned",
]);
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
export const metaAssetOwnershipKind = pgEnum("meta_asset_ownership_kind", [
  "owned",
  "shared",
  "linked",
  "accessible",
  "unknown",
]);
export const metaPromotionEligibilityStatus = pgEnum("meta_promotion_eligibility_status", [
  "not_evaluated",
  "eligible",
  "ineligible",
  "unknown",
]);
export const metaAssetDiscoveryResource = pgEnum("meta_asset_discovery_resource", [
  "ad_accounts",
  "pages",
  "page_posts",
  "instagram_media",
  "pixels",
  "datasets",
  "apps",
  "whatsapp_business_accounts",
]);
export const metaAssetDiscoverySourceType = pgEnum("meta_asset_discovery_source_type", [
  "connection",
  "ad_account",
  "business",
  "asset",
]);
export const metaAssetDiscoveryStatus = pgEnum("meta_asset_discovery_status", [
  "verified",
  "empty",
  "partial",
  "permission_missing",
  "unsupported",
  "unavailable",
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
export const categoryCardinality = pgEnum("category_cardinality", ["single", "multi"]);
export const categoryEntityLevel = pgEnum("category_entity_level", [
  "campaign",
  "ad_set",
  "ad",
  "creative",
]);
export const categoryAssignmentOperation = pgEnum("category_assignment_operation", [
  "add",
  "override",
  "deny",
]);
export const categoryAssignmentSource = pgEnum("category_assignment_source", [
  "manual",
  "agent",
  "deterministic",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  lifecycleState: workspaceLifecycleState("lifecycle_state").notNull().default("active"),
  tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
  lifecycleGeneration: integer("lifecycle_generation").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("workspaces_lifecycle_generation_positive", sql`${table.lifecycleGeneration} >= 1`),
  check("workspaces_tombstone_state_consistent", sql`
    (
      ${table.lifecycleState} = 'tombstoned'
      and ${table.tombstonedAt} is not null
    ) or (
      ${table.lifecycleState} <> 'tombstoned'
      and ${table.tombstonedAt} is null
    )
  `),
]);

/** Secret-free connection and binding metadata. Credential values stay in the server environment. */
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
  secretReferenceId: text("secret_reference_id"),
  secretProvider: text("secret_provider"),
  secretKeyVersion: integer("secret_key_version"),
  secretBindingName: text("secret_binding_name"),
  secretDisabledAt: timestamp("secret_disabled_at", { withTimezone: true }),
  secretDestroyedAt: timestamp("secret_destroyed_at", { withTimezone: true }),
  lifecycleGeneration: integer("lifecycle_generation").notNull().default(1),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_connections_workspace_external_key_unique").on(
    table.workspaceId,
    table.externalConnectionKey,
  ),
  uniqueIndex("meta_connections_workspace_id_unique").on(table.workspaceId, table.id),
  index("meta_connections_workspace_status_idx").on(table.workspaceId, table.status),
  check("meta_connections_lifecycle_generation_positive", sql`${table.lifecycleGeneration} >= 1`),
  check("meta_connections_secret_metadata_complete", sql`
    (
      ${table.secretReferenceId} is null
      and ${table.secretProvider} is null
      and ${table.secretKeyVersion} is null
      and ${table.secretBindingName} is null
    ) or (
      ${table.secretReferenceId} is not null
      and ${table.secretProvider} = 'environment'
      and ${table.secretKeyVersion} >= 1
      and ${table.secretBindingName} is not null
    )
  `),
  check("meta_connections_destroy_implies_disabled", sql`
    ${table.secretDestroyedAt} is null or ${table.secretDisabledAt} is not null
  `),
  check("meta_connections_lifecycle_consistent", sql`
    ${table.secretReferenceId} is null or (
      (
        ${table.status} = 'revoked'
        and ${table.secretDisabledAt} is not null
        and ${table.secretDestroyedAt} is not null
        and ${table.revokedAt} is not null
      ) or (
        ${table.status} <> 'revoked'
        and ${table.revokedAt} is null
      )
    )
  `),
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
  uniqueIndex("ad_accounts_workspace_id_unique").on(table.workspaceId, table.id),
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
  uniqueIndex("ad_campaigns_id_workspace_unique").on(table.id, table.workspaceId),
  uniqueIndex("ad_campaigns_workspace_id_unique").on(table.workspaceId, table.id),
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
  uniqueIndex("meta_ad_sets_id_workspace_unique").on(table.id, table.workspaceId),
  index("meta_ad_sets_workspace_campaign_idx").on(table.workspaceId, table.campaignId),
]);

export const metaAssets = pgTable("meta_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  assetType: metaAssetType("asset_type").notNull(),
  externalAssetId: text("external_asset_id").notNull(),
  displayName: text("display_name"),
  username: text("username"),
  ownershipKind: metaAssetOwnershipKind("ownership_kind").notNull().default("unknown"),
  ownerBusinessExternalId: text("owner_business_external_id"),
  ownershipEvidence: text("ownership_evidence"),
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
  sourceMessage: text("source_message"),
  sourceCaption: text("source_caption"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  promotionEligibilityStatus: metaPromotionEligibilityStatus("promotion_eligibility_status")
    .notNull()
    .default("not_evaluated"),
  promotionEligibilityReason: text("promotion_eligibility_reason"),
  promotionEligibilityEvaluatedAt: timestamp("promotion_eligibility_evaluated_at", { withTimezone: true }),
  contentHash: text("content_hash"),
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
  index("meta_posts_actor_asset_idx").on(table.actorAssetId),
]);

/**
 * Hash-only evidence for a canonical Meta hierarchy observation. The canonical
 * entity payload remains server-private. It contains the minimum tracked Meta
 * IDs needed for restart recovery, but never ad content, tokens or raw payloads.
 */
export const metaChangeSnapshots = pgTable("meta_change_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  publicRef: text("public_ref").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  fieldCatalogVersion: text("field_catalog_version").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  /** Server-private tracked facts and Meta IDs; never tokens, ad copy, raw payloads, UI/agent/log output. */
  canonicalPayload: jsonb("canonical_payload").$type<unknown>().notNull(),
  safeAggregate: jsonb("safe_aggregate").$type<{
    entityCounts: { campaign: number; adSet: number; ad: number };
    knownFieldCount: number;
    unknownFieldCount: number;
  }>().notNull(),
  persistedAt: timestamp("persisted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_change_snapshots_scope_hash_unique").on(
    table.workspaceId,
    table.metaConnectionId,
    table.adAccountId,
    table.snapshotHash,
  ),
  uniqueIndex("meta_change_snapshots_scope_public_ref_unique").on(
    table.workspaceId,
    table.metaConnectionId,
    table.adAccountId,
    table.publicRef,
  ),
  uniqueIndex("meta_change_snapshots_id_scope_unique").on(
    table.id,
    table.workspaceId,
    table.metaConnectionId,
    table.adAccountId,
  ),
  index("meta_change_snapshots_scope_captured_idx").on(
    table.workspaceId,
    table.metaConnectionId,
    table.adAccountId,
    table.capturedAt,
  ),
  index("meta_change_snapshots_connection_idx").on(table.metaConnectionId),
  index("meta_change_snapshots_account_idx").on(table.adAccountId),
  check("meta_change_snapshots_hash_format", sql`${table.snapshotHash} ~ '^[a-f0-9]{64}$'`),
  check("meta_change_snapshots_public_ref_format", sql`${table.publicRef} ~ '^snapshot_[a-f0-9]{20}$'`),
  check("meta_change_snapshots_schema_version_positive", sql`${table.schemaVersion} >= 1`),
]);

/** Privacy-safe, idempotent timeline events derived from two authentic snapshots. */
export const metaChangeEvents = pgTable("meta_change_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  previousSnapshotId: uuid("previous_snapshot_id").notNull(),
  currentSnapshotId: uuid("current_snapshot_id").notNull(),
  changeRef: text("change_ref").notNull(),
  entityRef: text("entity_ref").notNull(),
  entityType: text("entity_type").notNull(),
  field: text("field").notNull(),
  beforeValue: jsonb("before_value").$type<unknown>().notNull(),
  afterValue: jsonb("after_value").$type<unknown>().notNull(),
  classification: text("classification").notNull(),
  correlatedActionRef: text("correlated_action_ref"),
  timelineHash: text("timeline_hash").notNull(),
  fieldCatalogVersion: text("field_catalog_version").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
  persistedAt: timestamp("persisted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_change_events_scope_change_ref_unique").on(
    table.workspaceId,
    table.metaConnectionId,
    table.adAccountId,
    table.changeRef,
  ),
  index("meta_change_events_scope_occurred_idx").on(
    table.workspaceId,
    table.metaConnectionId,
    table.adAccountId,
    table.occurredAt,
  ),
  index("meta_change_events_previous_snapshot_idx").on(table.previousSnapshotId),
  index("meta_change_events_current_snapshot_idx").on(table.currentSnapshotId),
  index("meta_change_events_connection_idx").on(table.metaConnectionId),
  index("meta_change_events_account_idx").on(table.adAccountId),
  foreignKey({
    columns: [table.previousSnapshotId, table.workspaceId, table.metaConnectionId, table.adAccountId],
    foreignColumns: [
      metaChangeSnapshots.id,
      metaChangeSnapshots.workspaceId,
      metaChangeSnapshots.metaConnectionId,
      metaChangeSnapshots.adAccountId,
    ],
    name: "meta_change_events_previous_snapshot_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.currentSnapshotId, table.workspaceId, table.metaConnectionId, table.adAccountId],
    foreignColumns: [
      metaChangeSnapshots.id,
      metaChangeSnapshots.workspaceId,
      metaChangeSnapshots.metaConnectionId,
      metaChangeSnapshots.adAccountId,
    ],
    name: "meta_change_events_current_snapshot_scope_fk",
  }).onDelete("restrict"),
  check("meta_change_events_distinct_snapshots", sql`${table.previousSnapshotId} <> ${table.currentSnapshotId}`),
  check("meta_change_events_change_ref_format", sql`${table.changeRef} ~ '^ref_[a-f0-9]{20}$'`),
  check("meta_change_events_entity_ref_format", sql`${table.entityRef} ~ '^ref_[a-f0-9]{20}$'`),
  check("meta_change_events_action_ref_format", sql`${table.correlatedActionRef} is null or ${table.correlatedActionRef} ~ '^ref_[a-f0-9]{20}$'`),
  check("meta_change_events_timeline_hash_format", sql`${table.timelineHash} ~ '^[a-f0-9]{64}$'`),
  check("meta_change_events_classification_valid", sql`${table.classification} in ('internal_expected', 'external_change')`),
  check("meta_change_events_entity_type_valid", sql`${table.entityType} in ('campaign', 'ad_set', 'ad')`),
  check("meta_change_events_period_valid", sql`${table.detectedAt} >= ${table.occurredAt}`),
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
  uniqueIndex("meta_creatives_id_workspace_unique").on(table.id, table.workspaceId),
  index("meta_creatives_workspace_post_idx").on(table.workspaceId, table.postId),
  index("meta_creatives_post_idx").on(table.postId),
  index("meta_creatives_actor_asset_idx").on(table.actorAssetId),
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
  uniqueIndex("meta_ads_id_workspace_unique").on(table.id, table.workspaceId),
  index("meta_ads_workspace_ad_set_idx").on(table.workspaceId, table.adSetId),
  index("meta_ads_creative_idx").on(table.creativeId),
]);

/** A versioned, workspace-owned axis in the internal campaign taxonomy. */
export const categoryDimensions = pgTable("category_dimensions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  cardinality: categoryCardinality("cardinality").notNull(),
  allowedEntityLevels: categoryEntityLevel("allowed_entity_levels").array().notNull(),
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("category_dimensions_workspace_key_version_unique").on(
    table.workspaceId,
    table.key,
    table.version,
  ),
  uniqueIndex("category_dimensions_workspace_active_key_unique")
    .on(table.workspaceId, table.key)
    .where(sql`${table.archivedAt} is null`),
  uniqueIndex("category_dimensions_id_workspace_unique").on(table.id, table.workspaceId),
  index("category_dimensions_workspace_archive_idx").on(table.workspaceId, table.archivedAt),
  check("category_dimensions_key_format", sql`${table.key} ~ '^[a-z][a-z0-9_]{0,63}$'`),
  check("category_dimensions_version_positive", sql`${table.version} >= 1`),
  check(
    "category_dimensions_allowed_levels_nonempty",
    sql`coalesce(array_length(${table.allowedEntityLevels}, 1), 0) >= 1`,
  ),
]);

/** A versioned value belonging to one category dimension. */
export const categoryDefinitions = pgTable("category_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  dimensionId: uuid("dimension_id").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.dimensionId, table.workspaceId],
    foreignColumns: [categoryDimensions.id, categoryDimensions.workspaceId],
    name: "category_definitions_dimension_scope_fk",
  }).onDelete("cascade"),
  uniqueIndex("category_definitions_workspace_dimension_key_version_unique").on(
    table.workspaceId,
    table.dimensionId,
    table.key,
    table.version,
  ),
  uniqueIndex("category_definitions_workspace_dimension_active_key_unique")
    .on(table.workspaceId, table.dimensionId, table.key)
    .where(sql`${table.archivedAt} is null`),
  uniqueIndex("category_definitions_id_dimension_workspace_unique").on(
    table.id,
    table.dimensionId,
    table.workspaceId,
  ),
  index("category_definitions_dimension_archive_idx").on(table.dimensionId, table.archivedAt),
  check("category_definitions_key_format", sql`${table.key} ~ '^[a-z][a-z0-9_]{0,63}$'`),
  check("category_definitions_version_positive", sql`${table.version} >= 1`),
]);

function categoryAssignmentRevisionScope(): [AnyPgColumn, AnyPgColumn, AnyPgColumn] {
  return [categoryAssignments.id, categoryAssignments.workspaceId, categoryAssignments.dimensionId];
}

/**
 * One immutable assignment revision. Active rows at each hierarchy node are
 * folded by the deterministic resolver; historical rows remain addressable by
 * id + version for frozen analysis context.
 */
export const categoryAssignments = pgTable("category_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  dimensionId: uuid("dimension_id").notNull(),
  definitionId: uuid("definition_id").notNull(),
  entityLevel: categoryEntityLevel("entity_level").notNull(),
  campaignId: uuid("campaign_id"),
  adSetId: uuid("ad_set_id"),
  adId: uuid("ad_id"),
  creativeId: uuid("creative_id"),
  operation: categoryAssignmentOperation("operation").notNull(),
  source: categoryAssignmentSource("source").notNull(),
  manualLock: boolean("manual_lock").notNull().default(false),
  evidence: jsonb("evidence").$type<readonly Readonly<{
    kind: string;
    ref: string;
    observedAt?: string;
  }>[]>().notNull(),
  confidence: doublePrecision("confidence").notNull(),
  version: integer("version").notNull().default(1),
  supersedesAssignmentId: uuid("supersedes_assignment_id"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.definitionId, table.dimensionId, table.workspaceId],
    foreignColumns: [
      categoryDefinitions.id,
      categoryDefinitions.dimensionId,
      categoryDefinitions.workspaceId,
    ],
    name: "category_assignments_definition_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.campaignId, table.workspaceId],
    foreignColumns: [adCampaigns.id, adCampaigns.workspaceId],
    name: "category_assignments_campaign_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.adSetId, table.workspaceId],
    foreignColumns: [metaAdSets.id, metaAdSets.workspaceId],
    name: "category_assignments_ad_set_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.adId, table.workspaceId],
    foreignColumns: [metaAds.id, metaAds.workspaceId],
    name: "category_assignments_ad_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.creativeId, table.workspaceId],
    foreignColumns: [metaCreatives.id, metaCreatives.workspaceId],
    name: "category_assignments_creative_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.supersedesAssignmentId, table.workspaceId, table.dimensionId],
    foreignColumns: categoryAssignmentRevisionScope(),
    name: "category_assignments_supersedes_scope_fk",
  }).onDelete("restrict"),
  uniqueIndex("category_assignments_id_workspace_dimension_unique").on(
    table.id,
    table.workspaceId,
    table.dimensionId,
  ),
  uniqueIndex("category_assignments_campaign_active_value_unique")
    .on(table.workspaceId, table.dimensionId, table.campaignId, table.definitionId)
    .where(sql`${table.archivedAt} is null and ${table.campaignId} is not null`),
  uniqueIndex("category_assignments_ad_set_active_value_unique")
    .on(table.workspaceId, table.dimensionId, table.adSetId, table.definitionId)
    .where(sql`${table.archivedAt} is null and ${table.adSetId} is not null`),
  uniqueIndex("category_assignments_ad_active_value_unique")
    .on(table.workspaceId, table.dimensionId, table.adId, table.definitionId)
    .where(sql`${table.archivedAt} is null and ${table.adId} is not null`),
  uniqueIndex("category_assignments_creative_active_value_unique")
    .on(table.workspaceId, table.dimensionId, table.creativeId, table.definitionId)
    .where(sql`${table.archivedAt} is null and ${table.creativeId} is not null`),
  index("category_assignments_workspace_dimension_idx").on(
    table.workspaceId,
    table.dimensionId,
    table.archivedAt,
  ),
  index("category_assignments_definition_idx").on(table.definitionId),
  index("category_assignments_supersedes_idx").on(table.supersedesAssignmentId),
  check("category_assignments_version_positive", sql`${table.version} >= 1`),
  check("category_assignments_confidence_range", sql`${table.confidence} >= 0 and ${table.confidence} <= 1`),
  check(
    "category_assignments_manual_lock_source",
    sql`not ${table.manualLock} or ${table.source} = 'manual'`,
  ),
  check(
    "category_assignments_evidence_nonempty",
    sql`jsonb_typeof(${table.evidence}) = 'array' and jsonb_array_length(${table.evidence}) >= 1`,
  ),
  check("category_assignments_entity_consistent", sql`
    (
      ${table.entityLevel} = 'campaign'
      and ${table.campaignId} is not null
      and ${table.adSetId} is null
      and ${table.adId} is null
      and ${table.creativeId} is null
    ) or (
      ${table.entityLevel} = 'ad_set'
      and ${table.campaignId} is null
      and ${table.adSetId} is not null
      and ${table.adId} is null
      and ${table.creativeId} is null
    ) or (
      ${table.entityLevel} = 'ad'
      and ${table.campaignId} is null
      and ${table.adSetId} is null
      and ${table.adId} is not null
      and ${table.creativeId} is null
    ) or (
      ${table.entityLevel} = 'creative'
      and ${table.campaignId} is null
      and ${table.adSetId} is null
      and ${table.adId} is null
      and ${table.creativeId} is not null
    )
  `),
]);

/** Append-only guidance source revisions. Official Meta rows carry stricter publication evidence. */
export const guidanceSources = pgTable("guidance_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  sourceKey: text("source_key").notNull(),
  version: integer("version").notNull(),
  sourceType: text("source_type").notNull(),
  title: text("title").notNull(),
  sourceRef: text("source_ref").notNull(),
  sourceUrl: text("source_url"),
  content: text("content").notNull(),
  author: text("author"),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewBy: timestamp("review_by", { withTimezone: true }),
  status: text("status").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  recordHash: text("record_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("guidance_sources_workspace_key_version_unique").on(table.workspaceId, table.sourceKey, table.version),
  index("guidance_sources_workspace_status_idx").on(table.workspaceId, table.status, table.sourceKey),
  check("guidance_sources_version_positive", sql`${table.version} >= 1`),
  check("guidance_sources_required_text", sql`
    btrim(${table.sourceKey}) <> '' and btrim(${table.title}) <> ''
    and btrim(${table.sourceRef}) <> '' and btrim(${table.content}) <> ''
  `),
  check("guidance_sources_type_allowlist", sql`${table.sourceType} in (
    'owner_statement', 'official_meta_guidance', 'business_strategy',
    'observed_result', 'experiment_outcome', 'operating_note'
  )`),
  check("guidance_sources_status_allowlist", sql`${table.status} in ('draft', 'published', 'archived')`),
  check("guidance_sources_record_hash_format", sql`${table.recordHash} ~ '^[a-f0-9]{64}$'`),
  check("guidance_sources_lifecycle_consistent", sql`
    (${table.status} = 'draft' and ${table.publishedAt} is null and ${table.archivedAt} is null)
    or (${table.status} = 'published' and ${table.publishedAt} is not null and ${table.archivedAt} is null)
    or (${table.status} = 'archived' and ${table.archivedAt} is not null)
  `),
  check("guidance_sources_official_publish_evidence", sql`
    ${table.sourceType} <> 'official_meta_guidance' or ${table.status} <> 'published' or (
      ${table.sourceUrl} is not null and ${table.sourceUrl} ~ '^https://' and ${table.capturedAt} is not null
      and ${table.reviewedAt} is not null and ${table.reviewBy} is not null
      and ${table.reviewedAt} >= ${table.capturedAt} and ${table.reviewBy} > ${table.reviewedAt}
    )
  `),
]);

/** Append-only soft-guidance card revisions. The authority check cannot mint policy or action rights. */
export const guidanceCards = pgTable("guidance_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  cardKey: text("card_key").notNull(),
  version: integer("version").notNull(),
  sourceType: text("source_type").notNull(),
  sourceIds: jsonb("source_ids").$type<readonly string[]>().notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  rationale: text("rationale"),
  strength: text("strength").notNull(),
  topic: text("topic").notNull(),
  decisionKey: text("decision_key"),
  positionKey: text("position_key"),
  authority: text("authority").notNull().default("guidance_only"),
  status: text("status").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  ownerRef: text("owner_ref").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  recordHash: text("record_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("guidance_cards_workspace_key_version_unique").on(table.workspaceId, table.cardKey, table.version),
  index("guidance_cards_workspace_status_topic_idx").on(table.workspaceId, table.status, table.topic),
  check("guidance_cards_version_positive", sql`${table.version} >= 1`),
  check("guidance_cards_required_text", sql`
    btrim(${table.cardKey}) <> '' and btrim(${table.title}) <> '' and btrim(${table.body}) <> ''
    and btrim(${table.topic}) <> '' and btrim(${table.ownerRef}) <> ''
  `),
  check("guidance_cards_source_type_allowlist", sql`${table.sourceType} in (
    'owner_statement', 'official_meta_guidance', 'business_strategy',
    'observed_result', 'experiment_outcome', 'operating_note'
  )`),
  check("guidance_cards_strength_allowlist", sql`${table.strength} in ('must', 'should', 'consider', 'avoid', 'question')`),
  check("guidance_cards_status_allowlist", sql`${table.status} in ('draft', 'published', 'archived')`),
  check("guidance_cards_guidance_only_authority", sql`${table.authority} = 'guidance_only'`),
  check("guidance_cards_sources_nonempty", sql`
    jsonb_typeof(${table.sourceIds}) = 'array' and jsonb_array_length(${table.sourceIds}) >= 1
  `),
  check("guidance_cards_decision_pair", sql`(${table.decisionKey} is null) = (${table.positionKey} is null)`),
  check("guidance_cards_effective_interval", sql`
    ${table.effectiveFrom} is null or ${table.effectiveTo} is null or ${table.effectiveFrom} < ${table.effectiveTo}
  `),
  check("guidance_cards_record_hash_format", sql`${table.recordHash} ~ '^[a-f0-9]{64}$'`),
  check("guidance_cards_lifecycle_consistent", sql`
    (${table.status} = 'draft' and ${table.publishedAt} is null and ${table.archivedAt} is null)
    or (${table.status} = 'published' and ${table.publishedAt} is not null and ${table.archivedAt} is null)
    or (${table.status} = 'archived' and ${table.archivedAt} is not null)
  `),
]);

/** Append-only scope binding revisions; values remain advisory-only. */
export const guidanceBindings = pgTable("guidance_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  bindingKey: text("binding_key").notNull(),
  version: integer("version").notNull(),
  cardKey: text("card_key").notNull(),
  facet: text("facet").notNull(),
  value: text("value"),
  entityType: text("entity_type"),
  mode: text("mode").notNull(),
  priority: integer("priority").notNull(),
  recordHash: text("record_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("guidance_bindings_workspace_key_version_unique").on(table.workspaceId, table.bindingKey, table.version),
  index("guidance_bindings_workspace_card_idx").on(table.workspaceId, table.cardKey),
  check("guidance_bindings_version_positive", sql`${table.version} >= 1`),
  check("guidance_bindings_priority_range", sql`${table.priority} between 0 and 100`),
  check("guidance_bindings_required_text", sql`btrim(${table.bindingKey}) <> '' and btrim(${table.cardKey}) <> ''`),
  check("guidance_bindings_facet_allowlist", sql`${table.facet} in ('global', 'account', 'objective', 'internal_category', 'entity', 'topic')`),
  check("guidance_bindings_entity_type_allowlist", sql`${table.entityType} is null or ${table.entityType} in ('campaign', 'ad_set', 'ad', 'creative', 'post')`),
  check("guidance_bindings_mode_allowlist", sql`${table.mode} in ('default', 'exception')`),
  check("guidance_bindings_scope_consistent", sql`
    (${table.facet} = 'global' and ${table.value} is null and ${table.entityType} is null)
    or (${table.facet} = 'entity' and ${table.value} is not null and btrim(${table.value}) <> '' and ${table.entityType} is not null)
    or (${table.facet} not in ('global', 'entity') and ${table.value} is not null and btrim(${table.value}) <> '' and ${table.entityType} is null)
  `),
  check("guidance_bindings_record_hash_format", sql`${table.recordHash} ~ '^[a-f0-9]{64}$'`),
]);

/** Append-only reviewed guidance set revisions with deterministic card ordering. */
export const guidanceSets = pgTable("guidance_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  setKey: text("set_key").notNull(),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  orderedCardIds: jsonb("ordered_card_ids").$type<readonly string[]>().notNull(),
  reviewStatus: text("review_status").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  recordHash: text("record_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("guidance_sets_workspace_key_version_unique").on(table.workspaceId, table.setKey, table.version),
  index("guidance_sets_workspace_status_idx").on(table.workspaceId, table.reviewStatus, table.setKey),
  check("guidance_sets_version_positive", sql`${table.version} >= 1`),
  check("guidance_sets_required_text", sql`btrim(${table.setKey}) <> '' and btrim(${table.name}) <> ''`),
  check("guidance_sets_status_allowlist", sql`${table.reviewStatus} in ('draft', 'reviewed', 'archived')`),
  check("guidance_sets_cards_array", sql`jsonb_typeof(${table.orderedCardIds}) = 'array'`),
  check("guidance_sets_lifecycle_consistent", sql`
    (${table.reviewStatus} = 'draft' and ${table.reviewedAt} is null and ${table.archivedAt} is null)
    or (${table.reviewStatus} = 'reviewed' and ${table.reviewedAt} is not null and ${table.archivedAt} is null)
    or (${table.reviewStatus} = 'archived' and ${table.archivedAt} is not null)
  `),
  check("guidance_sets_record_hash_format", sql`${table.recordHash} ~ '^[a-f0-9]{64}$'`),
]);

/** Append-only, advisory-only practice definition revisions. Conversation output cannot mint policy or automation. */
export const advisedPracticeDefinitions = pgTable("advised_practice_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  workspaceRef: text("workspace_ref").notNull(),
  practiceRef: text("practice_ref").notNull(),
  version: integer("version").notNull(),
  schemaVersion: text("schema_version").notNull(),
  previousDefinitionHash: text("previous_definition_hash").notNull(),
  definitionHash: text("definition_hash").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("advised_practice_definitions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("advised_practice_definitions_workspace_ref_version_unique")
    .on(table.workspaceId, table.practiceRef, table.version),
  uniqueIndex("advised_practice_definitions_workspace_ref_hash_unique")
    .on(table.workspaceId, table.practiceRef, table.definitionHash),
  uniqueIndex("advised_practice_definitions_event_binding_unique")
    .on(table.workspaceId, table.id, table.practiceRef, table.version, table.definitionHash),
  index("advised_practice_definitions_workspace_created_idx")
    .on(table.workspaceId, table.createdAt, table.practiceRef),
  check("advised_practice_definitions_version", sql`
    ${table.version} >= 1 and ${table.schemaVersion} = 'advised-practice/1.0.0'
    and ((${table.version} = 1 and ${table.previousDefinitionHash} = 'GENESIS')
      or (${table.version} > 1 and ${table.previousDefinitionHash} ~ '^[a-f0-9]{64}$'))
  `),
  check("advised_practice_definitions_identity", sql`
    ${table.workspaceRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and ${table.practiceRef} ~ '^practice_[a-z0-9][a-z0-9_-]{0,86}$'
    and ${table.definitionHash} ~ '^[a-f0-9]{64}$'
  `),
  check("advised_practice_definitions_payload_exact", sql`(
    jsonb_typeof(${table.payload}) = 'object'
    and ${table.payload} #>> '{schemaVersion}' = ${table.schemaVersion}
    and ${table.payload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.payload} #>> '{practiceRef}' = ${table.practiceRef}
    and (${table.payload} #>> '{version}')::integer = ${table.version}
    and ${table.payload} #>> '{previousDefinitionHash}' = ${table.previousDefinitionHash}
    and ${table.payload} #>> '{definitionHash}' = ${table.definitionHash}
    and ${table.payload} #>> '{capabilities,canCreateGuidance}' = 'false'
    and ${table.payload} #>> '{capabilities,canPromotePolicy}' = 'false'
    and ${table.payload} #>> '{capabilities,canEnableAutomation}' = 'false'
    and ${table.payload} #>> '{capabilities,canAuthorizeAction}' = 'false'
    and ${table.payload} #> '{capabilities}' = '{
      "canCreateGuidance": false,
      "canPromotePolicy": false,
      "canEnableAutomation": false,
      "canAuthorizeAction": false
    }'::jsonb
  ) is true`),
  check("advised_practice_definitions_required_provenance", sql`(
    jsonb_typeof(${table.payload} #> '{provenance,ownerSource}') = 'object'
    and jsonb_typeof(${table.payload} #> '{provenance,metaSources}') = 'array'
    and jsonb_array_length(${table.payload} #> '{provenance,metaSources}') >= 1
    and jsonb_typeof(${table.payload} #> '{provenance,evidenceRefs}') = 'array'
    and jsonb_array_length(${table.payload} #> '{provenance,evidenceRefs}') >= 1
    and jsonb_typeof(${table.payload} #> '{provenance,deliberation}') = 'object'
  ) is true`),
  check("advised_practice_definitions_no_forbidden_material", sql`
    ${table.payload}::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and ${table.payload}::text !~* '"authorization"[[:space:]]*:'
    and ${table.payload}::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  `),
  check("advised_practice_definitions_no_authority_escalation", sql`
    not jsonb_path_exists(
      ${table.payload} - 'capabilities',
      '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(canwrite|writeenabled|actionauthority|writeauthority|executionauthority|approvalgranted|canauthorizeaction|canexecutewrite|canenforcepolicy|canalterapproval|cancreateguidance|canpromotepolicy|canenableautomation)$" flag "i")'
    )
  `),
]);

/** Append-only lifecycle event chain. Standardization is a review only; artifact promotion remains disabled. */
export const advisedPracticeEvents = pgTable("advised_practice_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  definitionId: uuid("definition_id").notNull(),
  workspaceRef: text("workspace_ref").notNull(),
  practiceRef: text("practice_ref").notNull(),
  definitionVersion: integer("definition_version").notNull(),
  definitionHash: text("definition_hash").notNull(),
  schemaVersion: text("schema_version").notNull(),
  sequence: integer("sequence").notNull(),
  previousEventHash: text("previous_event_hash").notNull(),
  eventId: text("event_id").notNull(),
  eventHash: text("event_hash").notNull(),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.definitionId, table.practiceRef, table.definitionVersion, table.definitionHash],
    foreignColumns: [
      advisedPracticeDefinitions.workspaceId, advisedPracticeDefinitions.id, advisedPracticeDefinitions.practiceRef,
      advisedPracticeDefinitions.version, advisedPracticeDefinitions.definitionHash,
    ],
    name: "advised_practice_events_definition_binding_fk",
  }).onDelete("cascade"),
  uniqueIndex("advised_practice_events_workspace_event_unique").on(table.workspaceId, table.eventId),
  uniqueIndex("advised_practice_events_workspace_hash_unique").on(table.workspaceId, table.eventHash),
  uniqueIndex("advised_practice_events_definition_sequence_unique").on(table.workspaceId, table.definitionId, table.sequence),
  index("advised_practice_events_definition_idx").on(table.definitionId),
  index("advised_practice_events_workspace_practice_occurred_idx")
    .on(table.workspaceId, table.practiceRef, table.occurredAt),
  check("advised_practice_events_version", sql`
    ${table.schemaVersion} = 'advised-practice-event/1.0.0' and ${table.definitionVersion} >= 1 and ${table.sequence} >= 1
  `),
  check("advised_practice_events_identity", sql`
    ${table.workspaceRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and ${table.practiceRef} ~ '^practice_[a-z0-9][a-z0-9_-]{0,86}$'
    and ${table.definitionHash} ~ '^[a-f0-9]{64}$'
    and (${table.previousEventHash} = 'GENESIS' or ${table.previousEventHash} ~ '^[a-f0-9]{64}$')
  `),
  check("advised_practice_events_event_identity", sql`
    ${table.eventId} ~ '^practice_event_[a-f0-9]{20}$' and ${table.eventHash} ~ '^[a-f0-9]{64}$'
  `),
  check("advised_practice_events_type", sql`${table.eventType} in (
    'candidate_created', 'reviewed', 'trial_started', 'outcome_recorded', 'standardization_reviewed', 'retired'
  )`),
  check("advised_practice_events_payload_exact", sql`(
    jsonb_typeof(${table.payload}) = 'object'
    and ${table.payload} #>> '{schemaVersion}' = ${table.schemaVersion}
    and ${table.payload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.payload} #>> '{practiceRef}' = ${table.practiceRef}
    and (${table.payload} #>> '{definitionVersion}')::integer = ${table.definitionVersion}
    and ${table.payload} #>> '{definitionHash}' = ${table.definitionHash}
    and (${table.payload} #>> '{sequence}')::integer = ${table.sequence}
    and ${table.payload} #>> '{previousEventHash}' = ${table.previousEventHash}
    and ${table.payload} #>> '{eventId}' = ${table.eventId}
    and ${table.payload} #>> '{eventHash}' = ${table.eventHash}
    and ${table.payload} #>> '{eventType}' = ${table.eventType}
    and (${table.payload} #>> '{occurredAt}')::timestamptz = ${table.occurredAt}
    and ${table.payload} #>> '{authority}' = 'advisory_only'
  ) is true`),
  check("advised_practice_events_outcome", sql`
    ${table.eventType} <> 'outcome_recorded' or (
      ${table.payload} #>> '{result}' in ('validated', 'conditional', 'rejected')
      and jsonb_typeof(${table.payload} #> '{evidenceRefs}') = 'array'
      and jsonb_array_length(${table.payload} #> '{evidenceRefs}') >= 1
    )
  `),
  check("advised_practice_events_review_disabled", sql`
    ${table.eventType} <> 'standardization_reviewed' or (
      ${table.payload} #>> '{policyPromotionCapability}' = 'disabled'
      and ${table.payload} #>> '{automationCapability}' = 'disabled'
      and jsonb_typeof(${table.payload} #> '{decomposition}') = 'array'
      and jsonb_array_length(${table.payload} #> '{decomposition}') >= 1
      and not jsonb_path_exists(${table.payload}, '$.decomposition[*] ? (@.artifactRef != null || @.promotionCapability != "disabled")')
    )
  `),
  check("advised_practice_events_no_forbidden_material", sql`
    ${table.payload}::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and ${table.payload}::text !~* '"authorization"[[:space:]]*:'
    and ${table.payload}::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  `),
  check("advised_practice_events_no_authority_escalation", sql`
    not jsonb_path_exists(
      ${table.payload} - 'authority' - 'policyPromotionCapability' - 'automationCapability',
      '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(canwrite|writeenabled|actionauthority|writeauthority|executionauthority|approvalgranted|canauthorizeaction|canexecutewrite|canenforcepolicy|canalterapproval|canpromotepolicy|canenableautomation)$" flag "i")'
    )
  `),
]);

/** Immutable, server-private L5 analysis context snapshots. */
export const effectiveCampaignContexts = pgTable("effective_campaign_contexts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  identityHash: text("identity_hash").notNull(),
  contextHash: text("context_hash").notNull(),
  schemaVersion: text("schema_version").notNull(),
  metaConnectionId: uuid("meta_connection_id").notNull(),
  adAccountId: uuid("ad_account_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  connectionRef: text("connection_ref").notNull(),
  accountRef: text("account_ref").notNull(),
  campaignRef: text("campaign_ref").notNull(),
  entityType: text("entity_type").notNull(),
  entityRef: text("entity_ref").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  snapshotRefs: jsonb("snapshot_refs").$type<readonly string[]>().notNull(),
  contextPayload: jsonb("context_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.metaConnectionId],
    foreignColumns: [metaConnections.workspaceId, metaConnections.id],
    name: "effective_campaign_contexts_connection_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.workspaceId, table.adAccountId],
    foreignColumns: [adAccounts.workspaceId, adAccounts.id],
    name: "effective_campaign_contexts_account_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.workspaceId, table.campaignId],
    foreignColumns: [adCampaigns.workspaceId, adCampaigns.id],
    name: "effective_campaign_contexts_campaign_scope_fk",
  }).onDelete("restrict"),
  uniqueIndex("effective_campaign_contexts_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("effective_campaign_contexts_workspace_identity_unique").on(table.workspaceId, table.identityHash),
  uniqueIndex("effective_campaign_contexts_workspace_hash_unique").on(table.workspaceId, table.contextHash),
  index("effective_campaign_contexts_workspace_entity_captured_idx")
    .on(table.workspaceId, table.entityType, table.entityRef, table.capturedAt),
  index("effective_campaign_contexts_workspace_campaign_idx")
    .on(table.workspaceId, table.campaignRef, table.capturedAt),
  index("effective_campaign_contexts_connection_idx").on(table.metaConnectionId),
  index("effective_campaign_contexts_account_idx").on(table.adAccountId),
  index("effective_campaign_contexts_campaign_idx").on(table.campaignId),
  check("effective_campaign_contexts_hashes_format", sql`
    ${table.identityHash} ~ '^[a-f0-9]{64}$' and ${table.contextHash} ~ '^[a-f0-9]{64}$'
  `),
  check("effective_campaign_contexts_schema_version", sql`${table.schemaVersion} = 'effective-campaign-context/1.0.0'`),
  check("effective_campaign_contexts_entity_type", sql`${table.entityType} in ('campaign', 'ad_set', 'ad', 'creative')`),
  check("effective_campaign_contexts_required_refs", sql`
    btrim(${table.connectionRef}) <> '' and btrim(${table.accountRef}) <> ''
    and btrim(${table.campaignRef}) <> '' and btrim(${table.entityRef}) <> ''
  `),
  check("effective_campaign_contexts_snapshots_nonempty", sql`
    jsonb_typeof(${table.snapshotRefs}) = 'array' and jsonb_array_length(${table.snapshotRefs}) >= 1
  `),
  check("effective_campaign_contexts_payload_object", sql`jsonb_typeof(${table.contextPayload}) = 'object'`),
  check("effective_campaign_contexts_payload_scope_exact", sql`(
    ${table.contextPayload} #>> '{workspaceId}' = ${table.workspaceId}::text
    and ${table.contextPayload} #>> '{schemaVersion}' = ${table.schemaVersion}
    and ${table.contextPayload} #>> '{contextHash}' = ${table.contextHash}
    and (${table.contextPayload} #>> '{capturedAt}')::timestamptz = ${table.capturedAt}
    and ${table.contextPayload} #>> '{identity,connectionRef}' = ${table.connectionRef}
    and ${table.contextPayload} #>> '{identity,accountRef}' = ${table.accountRef}
    and ${table.contextPayload} #>> '{identity,campaignRef}' = ${table.campaignRef}
    and ${table.contextPayload} #>> '{identity,entityType}' = ${table.entityType}
    and ${table.contextPayload} #>> '{identity,entityRef}' = ${table.entityRef}
    and ${table.contextPayload} #> '{data,snapshotRefs}' = ${table.snapshotRefs}
  ) is true`),
  check("effective_campaign_contexts_no_forbidden_material", sql`
    ${table.contextPayload}::text !~* '"[^"[:space:]]*(token|secret)"[[:space:]]*:'
    and ${table.contextPayload}::text !~* '"authorization"[[:space:]]*:'
    and ${table.contextPayload}::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
    and ${table.contextPayload}::text !~* '"([^"[:space:]]*agent[_-]?)?narration"[[:space:]]*:'
  `),
  check("effective_campaign_contexts_no_authority", sql`(
    jsonb_typeof(${table.contextPayload} #> '{capabilities}') = 'object'
    and (${table.contextPayload} #> '{capabilities}') ?& array[
      'containsRawL0', 'canAuthorizeAction', 'canExecuteWrite'
    ]
    and ${table.contextPayload} #> '{capabilities,containsRawL0}' = 'false'::jsonb
    and ${table.contextPayload} #> '{capabilities,canAuthorizeAction}' = 'false'::jsonb
    and ${table.contextPayload} #> '{capabilities,canExecuteWrite}' = 'false'::jsonb
    and ${table.contextPayload}::text !~* '"(canAuthorizeAction|canExecuteWrite|canEnforcePolicy|canAlterApproval)"[[:space:]]*:[[:space:]]*true'
  ) is true`),
]);

/** Exact source component/version references used for selective context invalidation. */
export const effectiveCampaignContextComponents = pgTable("effective_campaign_context_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  contextId: uuid("context_id").notNull(),
  componentType: text("component_type").notNull(),
  componentRef: text("component_ref").notNull(),
  componentVersion: text("component_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.contextId],
    foreignColumns: [effectiveCampaignContexts.workspaceId, effectiveCampaignContexts.id],
    name: "effective_campaign_context_components_context_scope_fk",
  }).onDelete("cascade"),
  uniqueIndex("effective_campaign_context_components_exact_unique")
    .on(table.contextId, table.componentType, table.componentRef, table.componentVersion),
  index("effective_campaign_context_components_lookup_idx")
    .on(table.workspaceId, table.componentType, table.componentRef, table.componentVersion),
  index("effective_campaign_context_components_context_idx").on(table.contextId),
  check("effective_campaign_context_components_type", sql`${table.componentType} in (
    'source_snapshot', 'category_resolution', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver'
  )`),
  check("effective_campaign_context_components_required", sql`
    btrim(${table.componentRef}) <> '' and btrim(${table.componentVersion}) <> ''
  `),
]);

/** Append-only invalidation facts. They never mutate historical context payloads. */
export const effectiveCampaignContextInvalidations = pgTable("effective_campaign_context_invalidations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  eventHash: text("event_hash").notNull(),
  componentType: text("component_type").notNull(),
  componentRef: text("component_ref").notNull(),
  componentVersion: text("component_version").notNull(),
  scopeKind: text("scope_kind").notNull(),
  entityType: text("entity_type"),
  entityRef: text("entity_ref"),
  reasonCode: text("reason_code").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("effective_campaign_context_invalidations_workspace_event_unique")
    .on(table.workspaceId, table.eventHash),
  index("effective_campaign_context_invalidations_component_idx")
    .on(table.workspaceId, table.componentType, table.componentRef, table.componentVersion),
  index("effective_campaign_context_invalidations_entity_idx")
    .on(table.workspaceId, table.entityType, table.entityRef, table.observedAt),
  check("effective_campaign_context_invalidations_hash_format", sql`${table.eventHash} ~ '^[a-f0-9]{64}$'`),
  check("effective_campaign_context_invalidations_type", sql`${table.componentType} in (
    'source_snapshot', 'category_resolution', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver'
  )`),
  check("effective_campaign_context_invalidations_required", sql`
    btrim(${table.componentRef}) <> '' and btrim(${table.componentVersion}) <> ''
  `),
  check("effective_campaign_context_invalidations_entity_scope", sql`
    (${table.scopeKind} = 'workspace_component' and ${table.entityType} is null and ${table.entityRef} is null)
    or (${table.scopeKind} = 'exact_entity_component'
      and ${table.entityType} in ('campaign', 'ad_set', 'ad', 'creative')
      and ${table.entityRef} is not null and btrim(${table.entityRef}) <> '')
  `),
  check("effective_campaign_context_invalidations_reason", sql`
    ${table.reasonCode} in ('source_changed', 'source_removed', 'manual_rebuild')
  `),
]);

/** Append-only, advisory-only budget proposal revisions over one exact frozen campaign context. */
export const budgetProposalVersions = pgTable("budget_proposal_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  contextId: uuid("context_id").notNull(),
  contextHash: text("context_hash").notNull(),
  seriesRef: text("series_ref").notNull(),
  revision: integer("revision").notNull(),
  previousProposalHash: text("previous_proposal_hash").notNull(),
  proposalRef: text("proposal_ref").notNull(),
  proposalHash: text("proposal_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  schemaVersion: text("schema_version").notNull(),
  proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull(),
  proposalPayload: jsonb("proposal_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.adAccountId],
    foreignColumns: [adAccounts.workspaceId, adAccounts.id],
    name: "budget_proposal_versions_account_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.campaignId],
    foreignColumns: [adCampaigns.workspaceId, adCampaigns.id],
    name: "budget_proposal_versions_campaign_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.contextId],
    foreignColumns: [effectiveCampaignContexts.workspaceId, effectiveCampaignContexts.id],
    name: "budget_proposal_versions_context_scope_fk",
  }).onDelete("restrict"),
  uniqueIndex("budget_proposal_versions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("budget_proposal_versions_workspace_series_revision_unique")
    .on(table.workspaceId, table.seriesRef, table.revision),
  uniqueIndex("budget_proposal_versions_workspace_hash_unique").on(table.workspaceId, table.proposalHash),
  uniqueIndex("budget_proposal_versions_workspace_idempotency_unique")
    .on(table.workspaceId, table.idempotencyKey),
  uniqueIndex("budget_proposal_versions_alternative_binding_unique")
    .on(table.workspaceId, table.id, table.proposalHash),
  index("budget_proposal_versions_scope_created_idx")
    .on(table.workspaceId, table.adAccountId, table.campaignId, table.proposedAt, table.id),
  index("budget_proposal_versions_context_idx").on(table.contextId),
  check("budget_proposal_versions_identity", sql`
    ${table.seriesRef} ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and ${table.idempotencyKey} ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and ${table.proposalRef} ~ '^budget_proposal_[a-f0-9]{20}$'
    and ${table.proposalHash} ~ '^[a-f0-9]{64}$'
    and ${table.contextHash} ~ '^[a-f0-9]{64}$'
    and ${table.revision} >= 1
    and ((${table.revision} = 1 and ${table.previousProposalHash} = 'GENESIS')
      or (${table.revision} > 1 and ${table.previousProposalHash} ~ '^[a-f0-9]{64}$'))
  `),
  check("budget_proposal_versions_payload_exact", sql`(
    jsonb_typeof(${table.proposalPayload}) = 'object'
    and ${table.proposalPayload} #>> '{schemaVersion}' = ${table.schemaVersion}
    and ${table.schemaVersion} = 'budget-proposal/1.0.0'
    and ${table.proposalPayload} #>> '{seriesRef}' = ${table.seriesRef}
    and (${table.proposalPayload} #>> '{revision}')::integer = ${table.revision}
    and ${table.proposalPayload} #>> '{previousProposalHash}' = ${table.previousProposalHash}
    and ${table.proposalPayload} #>> '{proposalRef}' = ${table.proposalRef}
    and ${table.proposalPayload} #>> '{proposalHash}' = ${table.proposalHash}
    and ${table.proposalPayload} #>> '{idempotencyKey}' = ${table.idempotencyKey}
    and (${table.proposalPayload} #>> '{createdAt}')::timestamptz = ${table.proposedAt}
    and ${table.proposalPayload} #>> '{scope,workspaceId}' = ${table.workspaceId}::text
    and ${table.proposalPayload} #>> '{scope,adAccountId}' = ${table.adAccountId}::text
    and ${table.proposalPayload} #>> '{scope,campaignId}' = ${table.campaignId}::text
    and ${table.proposalPayload} #>> '{scope,contextHash}' = ${table.contextHash}
    and ${table.proposalPayload} #>> '{frozenContext,contextHash}' = ${table.contextHash}
    and ${table.proposalPayload} #>> '{actionAuthority}' = 'none'
    and ${table.proposalPayload} #> '{capabilities}' = '{
      "canApprove": false, "canExecute": false, "canWriteMeta": false
    }'::jsonb
  ) is true`),
  check("budget_proposal_versions_no_forbidden_material", sql`
    ${table.proposalPayload}::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and ${table.proposalPayload}::text !~* '"authorization"[[:space:]]*:'
    and ${table.proposalPayload}::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  `),
]);

/** Ordered immutable alternatives. They cannot contain approval or execution authority. */
export const budgetProposalAlternatives = pgTable("budget_proposal_alternatives", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id").notNull(),
  proposalHash: text("proposal_hash").notNull(),
  ordinal: integer("ordinal").notNull(),
  scenarioRef: text("scenario_ref").notNull(),
  scenarioKind: text("scenario_kind").notNull(),
  scenarioStatus: text("scenario_status").notNull(),
  alternativePayload: jsonb("alternative_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.proposalId, table.proposalHash],
    foreignColumns: [budgetProposalVersions.workspaceId, budgetProposalVersions.id, budgetProposalVersions.proposalHash],
    name: "budget_proposal_alternatives_proposal_binding_fk",
  }).onDelete("cascade"),
  uniqueIndex("budget_proposal_alternatives_proposal_ordinal_unique").on(table.proposalId, table.ordinal),
  uniqueIndex("budget_proposal_alternatives_proposal_scenario_unique").on(table.proposalId, table.scenarioRef),
  index("budget_proposal_alternatives_workspace_proposal_idx").on(table.workspaceId, table.proposalId),
  check("budget_proposal_alternatives_shape", sql`
    ${table.ordinal} >= 1 and ${table.ordinal} <= 3
    and ${table.scenarioRef} ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and ${table.scenarioKind} in ('keep', 'conservative', 'target_seeking')
    and ${table.scenarioStatus} in ('composed', 'suppressed')
    and ${table.proposalHash} ~ '^[a-f0-9]{64}$'
  `),
  check("budget_proposal_alternatives_payload_exact", sql`(
    jsonb_typeof(${table.alternativePayload}) = 'object'
    and ${table.alternativePayload} #>> '{scenarioRef}' = ${table.scenarioRef}
    and ${table.alternativePayload} #>> '{kind}' = ${table.scenarioKind}
    and ${table.alternativePayload} #>> '{status}' = ${table.scenarioStatus}
    and ${table.alternativePayload} #>> '{actionAuthority}' = 'none'
  ) is true`),
  check("budget_proposal_alternatives_no_authority", sql`
    ${table.alternativePayload}::text !~* '"(canApprove|canExecute|canWriteMeta|approvalGranted|writeEnabled)"[[:space:]]*:[[:space:]]*true'
  `),
]);

/** Append-only, versioned timeframe definitions used by deterministic analysis. */
export const analysisTimeframeDefinitions = pgTable("analysis_timeframe_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  timeframeRef: text("timeframe_ref").notNull(),
  revision: integer("revision").notNull(),
  definitionVersion: text("definition_version").notNull(),
  definitionHash: text("definition_hash").notNull(),
  definitionPayload: jsonb("definition_payload").$type<Record<string, unknown>>().notNull(),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("analysis_timeframe_definitions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("analysis_timeframe_definitions_workspace_ref_revision_unique")
    .on(table.workspaceId, table.timeframeRef, table.revision),
  uniqueIndex("analysis_timeframe_definitions_workspace_ref_hash_unique")
    .on(table.workspaceId, table.timeframeRef, table.definitionHash),
  uniqueIndex("analysis_timeframe_definitions_workspace_current_unique")
    .on(table.workspaceId, table.timeframeRef).where(sql`${table.supersededAt} is null`),
  index("analysis_timeframe_definitions_workspace_lookup_idx")
    .on(table.workspaceId, table.timeframeRef, table.supersededAt),
  check("analysis_timeframe_definitions_shape", sql`(
    ${table.timeframeRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and ${table.revision} >= 1
    and ${table.definitionVersion} = 'analysis-timeframe-definition/1.0.0'
    and ${table.definitionHash} ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(${table.definitionPayload}) = 'object'
    and ${table.definitionPayload} #>> '{version}' = ${table.definitionVersion}
    and ${table.definitionPayload} #>> '{timeframeRef}' = ${table.timeframeRef}
    and (${table.definitionPayload} #>> '{revision}')::integer = ${table.revision}
  ) is true`),
  check("analysis_timeframe_definitions_no_forbidden_material", sql`
    ${table.definitionPayload}::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and ${table.definitionPayload}::text !~* '"authorization"[[:space:]]*:'
    and ${table.definitionPayload}::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  `),
]);

/** Append-only template revisions, each bound to one exact context and timeframe revision. */
export const analysisTemplateDefinitions = pgTable("analysis_template_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  contextId: uuid("context_id").notNull(),
  timeframeDefinitionId: uuid("timeframe_definition_id").notNull(),
  accountRef: text("account_ref").notNull(),
  campaignRef: text("campaign_ref").notNull(),
  templateRef: text("template_ref").notNull(),
  revision: integer("revision").notNull(),
  definitionVersion: text("definition_version").notNull(),
  definitionHash: text("definition_hash").notNull(),
  timeframeRef: text("timeframe_ref").notNull(),
  timeframeDefinitionHash: text("timeframe_definition_hash").notNull(),
  contextHash: text("context_hash").notNull(),
  definitionPayload: jsonb("definition_payload").$type<Record<string, unknown>>().notNull(),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.adAccountId],
    foreignColumns: [adAccounts.workspaceId, adAccounts.id],
    name: "analysis_template_definitions_account_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.campaignId],
    foreignColumns: [adCampaigns.workspaceId, adCampaigns.id],
    name: "analysis_template_definitions_campaign_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.contextId],
    foreignColumns: [effectiveCampaignContexts.workspaceId, effectiveCampaignContexts.id],
    name: "analysis_template_definitions_context_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.workspaceId, table.timeframeDefinitionId],
    foreignColumns: [analysisTimeframeDefinitions.workspaceId, analysisTimeframeDefinitions.id],
    name: "analysis_template_definitions_timeframe_scope_fk",
  }).onDelete("restrict"),
  uniqueIndex("analysis_template_definitions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("analysis_template_definitions_workspace_ref_revision_unique")
    .on(table.workspaceId, table.templateRef, table.revision),
  uniqueIndex("analysis_template_definitions_workspace_ref_hash_unique")
    .on(table.workspaceId, table.templateRef, table.definitionHash),
  uniqueIndex("analysis_template_definitions_workspace_current_unique")
    .on(table.workspaceId, table.templateRef).where(sql`${table.supersededAt} is null`),
  index("analysis_template_definitions_workspace_asset_idx")
    .on(table.workspaceId, table.adAccountId, table.campaignId, table.templateRef),
  index("analysis_template_definitions_context_idx").on(table.contextId),
  index("analysis_template_definitions_timeframe_idx").on(table.timeframeDefinitionId),
  check("analysis_template_definitions_shape", sql`(
    ${table.templateRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and ${table.timeframeRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and ${table.revision} >= 1
    and ${table.definitionVersion} = 'analysis-template-definition/1.0.0'
    and ${table.definitionHash} ~ '^[a-f0-9]{64}$'
    and ${table.timeframeDefinitionHash} ~ '^[a-f0-9]{64}$'
    and ${table.contextHash} ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(${table.definitionPayload}) = 'object'
    and ${table.definitionPayload} #>> '{version}' = ${table.definitionVersion}
    and ${table.definitionPayload} #>> '{templateRef}' = ${table.templateRef}
    and (${table.definitionPayload} #>> '{revision}')::integer = ${table.revision}
    and ${table.definitionPayload} #>> '{timeframeRef}' = ${table.timeframeRef}
    and ${table.definitionPayload} #>> '{timeframeDefinitionHash}' = ${table.timeframeDefinitionHash}
    and ${table.definitionPayload} #>> '{contextHash}' = ${table.contextHash}
  ) is true`),
  check("analysis_template_definitions_no_forbidden_material", sql`
    ${table.definitionPayload}::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and ${table.definitionPayload}::text !~* '"authorization"[[:space:]]*:'
    and ${table.definitionPayload}::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  `),
  check("analysis_template_definitions_no_authority_escalation", sql`
    not jsonb_path_exists(
      ${table.definitionPayload},
      '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(canwrite|writeenabled|actionauthority|writeauthority|executionauthority|approvalgranted|canauthorizeaction|canexecutewrite|canenforcepolicy|canalterapproval)$" flag "i")'
    )
  `),
]);

/** Immutable analysis/decision hash-chain rows. This table cannot grant action authority. */
export const decisionLedgerRecords = pgTable("decision_ledger_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  workspaceRef: text("workspace_ref").notNull(),
  version: text("version").notNull(),
  recordType: text("record_type").notNull(),
  sequence: integer("sequence").notNull(),
  previousHash: text("previous_hash").notNull(),
  recordId: text("record_id").notNull(),
  recordHash: text("record_hash").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  effectiveContextId: uuid("effective_context_id"),
  effectiveContextRef: text("effective_context_ref"),
  analysisRecordRowId: uuid("analysis_record_row_id"),
  analysisRecordRef: text("analysis_record_ref"),
  analysisDefinitionRef: text("analysis_definition_ref"),
  cadenceResultRef: text("cadence_result_ref"),
  disposition: text("disposition"),
  payload: text("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.effectiveContextId],
    foreignColumns: [effectiveCampaignContexts.workspaceId, effectiveCampaignContexts.id],
    name: "decision_ledger_records_context_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.workspaceId, table.analysisRecordRowId],
    foreignColumns: [table.workspaceId, table.id],
    name: "decision_ledger_records_analysis_scope_fk",
  }).onDelete("restrict"),
  uniqueIndex("decision_ledger_records_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("decision_ledger_records_workspace_sequence_unique").on(table.workspaceId, table.sequence),
  uniqueIndex("decision_ledger_records_workspace_record_unique").on(table.workspaceId, table.recordId),
  uniqueIndex("decision_ledger_records_workspace_hash_unique").on(table.workspaceId, table.recordHash),
  index("decision_ledger_records_workspace_ref_sequence_idx")
    .on(table.workspaceId, table.workspaceRef, table.sequence),
  index("decision_ledger_records_context_idx").on(table.effectiveContextId),
  index("decision_ledger_records_analysis_idx").on(table.analysisRecordRowId),
  check("decision_ledger_records_version", sql`${table.version} = 'decision-ledger/1.0.0'`),
  check("decision_ledger_records_sequence_positive", sql`${table.sequence} >= 1`),
  check("decision_ledger_records_type", sql`${table.recordType} in ('analysis', 'decision')`),
  check("decision_ledger_records_hash_format", sql`
    ${table.previousHash} = 'GENESIS' or ${table.previousHash} ~ '^[a-f0-9]{64}$'
  `),
  check("decision_ledger_records_identity_format", sql`
    ${table.recordId} ~ '^(analysis|decision)_[a-f0-9]{20}$'
    and ${table.recordHash} ~ '^[a-f0-9]{64}$'
  `),
  check("decision_ledger_records_required", sql`
    btrim(${table.workspaceRef}) <> '' and btrim(${table.recordId}) <> ''
  `),
  check("decision_ledger_records_shape", sql`(
    (${table.recordType} = 'analysis'
      and ${table.effectiveContextId} is not null
      and ${table.effectiveContextRef} is not null and btrim(${table.effectiveContextRef}) <> ''
      and ${table.analysisDefinitionRef} is not null and btrim(${table.analysisDefinitionRef}) <> ''
      and ${table.analysisRecordRowId} is null and ${table.analysisRecordRef} is null
      and ${table.cadenceResultRef} is null and ${table.disposition} is null)
    or (${table.recordType} = 'decision'
      and ${table.effectiveContextId} is null and ${table.effectiveContextRef} is null
      and ${table.analysisDefinitionRef} is null
      and ${table.analysisRecordRowId} is not null
      and ${table.analysisRecordRef} is not null and btrim(${table.analysisRecordRef}) <> ''
      and ${table.cadenceResultRef} is not null and btrim(${table.cadenceResultRef}) <> ''
      and ${table.disposition} in ('act', 'test', 'observe', 'no_change', 'blocked'))
  ) is true`),
  check("decision_ledger_records_payload_object", sql`jsonb_typeof(${table.payload}::jsonb) = 'object'`),
  check("decision_ledger_records_payload_exact", sql`(
    ${table.payload}::jsonb #>> '{version}' = ${table.version}
    and ${table.payload}::jsonb #>> '{recordType}' = ${table.recordType}
    and (${table.payload}::jsonb #>> '{sequence}')::integer = ${table.sequence}
    and ${table.payload}::jsonb #>> '{previousHash}' = ${table.previousHash}
    and ${table.payload}::jsonb #>> '{workspaceRef}' = ${table.workspaceRef}
    and (${table.payload}::jsonb #>> '{occurredAt}')::timestamptz = ${table.occurredAt}
    and ${table.payload}::jsonb #>> '{recordId}' = ${table.recordId}
    and ${table.payload}::jsonb #>> '{recordHash}' = ${table.recordHash}
    and (${table.recordType} <> 'analysis' or (
      ${table.payload}::jsonb #>> '{effectiveContextRef}' = ${table.effectiveContextRef}
      and ${table.payload}::jsonb #>> '{analysisDefinitionRef}' = ${table.analysisDefinitionRef}
      and ${table.payload}::jsonb #>> '{actionAuthority}' = 'none'
      and not (${table.payload}::jsonb ? 'executionAuthority')))
    and (${table.recordType} <> 'decision' or (
      ${table.payload}::jsonb #>> '{analysisRecordRef}' = ${table.analysisRecordRef}
      and ${table.payload}::jsonb #>> '{cadenceResultRef}' = ${table.cadenceResultRef}
      and ${table.payload}::jsonb #>> '{disposition}' = ${table.disposition}
      and ${table.payload}::jsonb #>> '{executionAuthority}' = 'none'
      and not (${table.payload}::jsonb ? 'actionAuthority')))
  ) is true`),
  check("decision_ledger_records_no_forbidden_material", sql`
    ${table.payload} !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and ${table.payload} !~* '"authorization"[[:space:]]*:'
    and ${table.payload} !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  `),
  check("decision_ledger_records_no_authority_escalation", sql`
    not jsonb_path_exists(
      ${table.payload}::jsonb - 'actionAuthority' - 'executionAuthority',
      '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(canwrite|writeenabled|actionauthority|writeauthority|executionauthority|approvalgranted|canauthorizeaction|canexecutewrite|canenforcepolicy|canalterapproval)$" flag "i")'
    )
  `),
]);

/** Persisted, server-private Decision Room cadence configuration. */
export const decisionRoomSchedules = pgTable("decision_room_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  scheduleRef: text("schedule_ref").notNull(),
  revision: integer("revision").notNull(),
  definitionVersion: text("definition_version").notNull(),
  definitionHash: text("definition_hash").notNull(),
  workspaceRef: text("workspace_ref").notNull(),
  accountRef: text("account_ref").notNull(),
  campaignRef: text("campaign_ref").notNull(),
  timeframeRef: text("timeframe_ref").notNull(),
  templateRef: text("template_ref").notNull(),
  timezone: text("timezone").notNull(),
  localTime: text("local_time").notNull(),
  frequency: text("frequency").notNull(),
  dayOfWeek: integer("day_of_week"),
  enabled: boolean("enabled").notNull(),
  catchUpPolicy: text("catch_up_policy").notNull(),
  tickGraceMinutes: integer("tick_grace_minutes").notNull(),
  lastScheduledFor: timestamp("last_scheduled_for", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.adAccountId],
    foreignColumns: [adAccounts.workspaceId, adAccounts.id],
    name: "decision_room_schedules_account_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.campaignId],
    foreignColumns: [adCampaigns.workspaceId, adCampaigns.id],
    name: "decision_room_schedules_campaign_scope_fk",
  }).onDelete("cascade"),
  uniqueIndex("decision_room_schedules_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("decision_room_schedules_run_binding_unique")
    .on(table.workspaceId, table.id, table.adAccountId, table.campaignId, table.definitionHash),
  uniqueIndex("decision_room_schedules_workspace_ref_revision_unique").on(table.workspaceId, table.scheduleRef, table.revision),
  uniqueIndex("decision_room_schedules_workspace_ref_hash_unique").on(table.workspaceId, table.scheduleRef, table.definitionHash),
  uniqueIndex("decision_room_schedules_workspace_current_unique")
    .on(table.workspaceId, table.scheduleRef).where(sql`${table.supersededAt} is null`),
  index("decision_room_schedules_due_idx").on(table.workspaceId, table.nextRunAt)
    .where(sql`${table.supersededAt} is null and ${table.enabled} is true`),
  index("decision_room_schedules_account_idx").on(table.adAccountId),
  index("decision_room_schedules_campaign_idx").on(table.campaignId),
  check("decision_room_schedules_required", sql`
    btrim(${table.scheduleRef}) <> '' and btrim(${table.workspaceRef}) <> ''
    and btrim(${table.accountRef}) <> '' and btrim(${table.campaignRef}) <> ''
    and btrim(${table.timeframeRef}) <> '' and btrim(${table.templateRef}) <> ''
    and btrim(${table.timezone}) <> ''
  `),
  check("decision_room_schedules_revision", sql`
    ${table.revision} >= 1 and ${table.definitionVersion} = 'decision-room-schedule/1.0.0'
    and ${table.definitionHash} ~ '^[a-f0-9]{64}$'
  `),
  check("decision_room_schedules_frequency", sql`
    (${table.frequency} = 'daily' and ${table.dayOfWeek} is null)
    or (${table.frequency} = 'weekly' and ${table.dayOfWeek} between 0 and 6)
  `),
  check("decision_room_schedules_policy", sql`
    ${table.localTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and ${table.catchUpPolicy} in ('skip', 'run_once')
    and ${table.tickGraceMinutes} between 0 and 60
  `),
]);

/** Idempotent run and lease state. Action authority is intentionally absent. */
export const decisionRoomRuns = pgTable("decision_room_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  scheduleId: uuid("schedule_id"),
  adAccountId: uuid("ad_account_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  triggerKind: text("trigger_kind").notNull(),
  triggerRef: text("trigger_ref"),
  scheduleDefinitionHash: text("schedule_definition_hash"),
  accountRef: text("account_ref"),
  campaignRef: text("campaign_ref"),
  timeframeRef: text("timeframe_ref"),
  templateRef: text("template_ref"),
  idempotencyKey: text("idempotency_key").notNull(),
  scopeKey: text("scope_key").notNull(),
  runRef: text("run_ref").notNull(),
  state: text("state").notNull(),
  leaseToken: uuid("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  attempt: integer("attempt").notNull().default(0),
  analysisRef: text("analysis_ref"),
  summaryCode: text("summary_code"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.scheduleId, table.adAccountId, table.campaignId, table.scheduleDefinitionHash],
    foreignColumns: [
      decisionRoomSchedules.workspaceId,
      decisionRoomSchedules.id,
      decisionRoomSchedules.adAccountId,
      decisionRoomSchedules.campaignId,
      decisionRoomSchedules.definitionHash,
    ],
    name: "decision_room_runs_schedule_binding_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.workspaceId, table.adAccountId],
    foreignColumns: [adAccounts.workspaceId, adAccounts.id],
    name: "decision_room_runs_account_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.campaignId],
    foreignColumns: [adCampaigns.workspaceId, adCampaigns.id],
    name: "decision_room_runs_campaign_scope_fk",
  }).onDelete("cascade"),
  uniqueIndex("decision_room_runs_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("decision_room_runs_workspace_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
  uniqueIndex("decision_room_runs_workspace_ref_unique").on(table.workspaceId, table.runRef),
  index("decision_room_runs_active_scope_idx").on(table.workspaceId, table.scopeKey, table.leaseUntil),
  index("decision_room_runs_schedule_idx").on(table.scheduleId),
  index("decision_room_runs_account_idx").on(table.adAccountId),
  index("decision_room_runs_campaign_idx").on(table.campaignId),
  index("decision_room_runs_read_page_idx").on(table.workspaceId, table.startedAt, table.runRef),
  check("decision_room_runs_identity", sql`
    ${table.idempotencyKey} ~ '^idempotency_[a-f0-9]{32}$'
    and ${table.scopeKey} ~ '^[a-f0-9]{64}$'
    and ${table.runRef} ~ '^run_[a-f0-9]{20}$'
  `),
  check("decision_room_runs_state", sql`${table.state} in ('running', 'completed', 'failed')`),
  check("decision_room_runs_trigger", sql`
    (${table.triggerKind} = 'manual' and ${table.scheduleId} is null and ${table.scheduleDefinitionHash} is null)
    or (${table.triggerKind} = 'scheduled' and ${table.scheduleId} is not null
      and ${table.scheduleDefinitionHash} ~ '^[a-f0-9]{64}$')
  `),
  check("decision_room_runs_trace_refs", sql`
    (${table.triggerRef} is null and ${table.accountRef} is null and ${table.campaignRef} is null
      and ${table.timeframeRef} is null and ${table.templateRef} is null)
    or (${table.triggerRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
      and btrim(${table.accountRef}) <> '' and length(${table.accountRef}) <= 256
      and btrim(${table.campaignRef}) <> '' and length(${table.campaignRef}) <= 256
      and ${table.timeframeRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
      and ${table.templateRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
      and concat_ws('|', ${table.triggerRef}, ${table.accountRef}, ${table.campaignRef}, ${table.timeframeRef}, ${table.templateRef})
        !~* '(token|secret|prompt|raw[_-]?(payload|request|response|json))')
  `),
  check("decision_room_runs_attempt_positive", sql`${table.attempt} >= 1`),
  check("decision_room_runs_state_shape", sql`(
    (${table.state} = 'running' and ${table.leaseToken} is not null and ${table.leaseUntil} is not null
      and ${table.analysisRef} is null and ${table.summaryCode} is null and ${table.completedAt} is null)
    or (${table.state} = 'completed' and ${table.leaseToken} is null and ${table.leaseUntil} is null
      and ${table.analysisRef} is not null and ${table.summaryCode} is not null and ${table.completedAt} is not null)
    or (${table.state} = 'failed' and ${table.leaseToken} is null and ${table.leaseUntil} is null
      and ${table.analysisRef} is null and ${table.summaryCode} is null and ${table.failedAt} is not null)
  ) is true`),
  check("decision_room_runs_completion_format", sql`
    (${table.analysisRef} is null or ${table.analysisRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$')
    and (${table.summaryCode} is null or ${table.summaryCode} ~ '^[a-z0-9][a-z0-9_:-]{0,127}$')
  `),
]);

/** Immutable schedule-revision binding to exact analysis definition revisions. */
export const decisionRoomScheduleAnalysisBindings = pgTable("decision_room_schedule_analysis_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  scheduleId: uuid("schedule_id").notNull(),
  templateDefinitionId: uuid("template_definition_id").notNull(),
  timeframeDefinitionId: uuid("timeframe_definition_id").notNull(),
  bindingHash: text("binding_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.scheduleId],
    foreignColumns: [decisionRoomSchedules.workspaceId, decisionRoomSchedules.id],
    name: "decision_room_schedule_analysis_bindings_schedule_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.templateDefinitionId],
    foreignColumns: [analysisTemplateDefinitions.workspaceId, analysisTemplateDefinitions.id],
    name: "decision_room_schedule_analysis_bindings_template_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.workspaceId, table.timeframeDefinitionId],
    foreignColumns: [analysisTimeframeDefinitions.workspaceId, analysisTimeframeDefinitions.id],
    name: "decision_room_schedule_analysis_bindings_timeframe_scope_fk",
  }).onDelete("restrict"),
  uniqueIndex("decision_room_schedule_analysis_bindings_schedule_unique").on(table.workspaceId, table.scheduleId),
  uniqueIndex("decision_room_schedule_analysis_bindings_hash_unique").on(table.workspaceId, table.bindingHash),
  index("decision_room_schedule_analysis_bindings_template_idx").on(table.templateDefinitionId),
  index("decision_room_schedule_analysis_bindings_timeframe_idx").on(table.timeframeDefinitionId),
  check("decision_room_schedule_analysis_bindings_hash_format", sql`${table.bindingHash} ~ '^[a-f0-9]{64}$'`),
]);

/** One immutable frozen analysis-asset selection per claimed Decision Room run. */
export const decisionRoomRunAnalysisAssets = pgTable("decision_room_run_analysis_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull(),
  templateDefinitionId: uuid("template_definition_id").notNull(),
  timeframeDefinitionId: uuid("timeframe_definition_id").notNull(),
  contextId: uuid("context_id").notNull(),
  assetHash: text("asset_hash").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  resolvedTimeframe: jsonb("resolved_timeframe").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.runId],
    foreignColumns: [decisionRoomRuns.workspaceId, decisionRoomRuns.id],
    name: "decision_room_run_analysis_assets_run_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.templateDefinitionId],
    foreignColumns: [analysisTemplateDefinitions.workspaceId, analysisTemplateDefinitions.id],
    name: "decision_room_run_analysis_assets_template_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.workspaceId, table.timeframeDefinitionId],
    foreignColumns: [analysisTimeframeDefinitions.workspaceId, analysisTimeframeDefinitions.id],
    name: "decision_room_run_analysis_assets_timeframe_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.workspaceId, table.contextId],
    foreignColumns: [effectiveCampaignContexts.workspaceId, effectiveCampaignContexts.id],
    name: "decision_room_run_analysis_assets_context_scope_fk",
  }).onDelete("restrict"),
  uniqueIndex("decision_room_run_analysis_assets_run_unique").on(table.workspaceId, table.runId),
  uniqueIndex("decision_room_run_analysis_assets_hash_unique").on(table.workspaceId, table.assetHash),
  index("decision_room_run_analysis_assets_template_idx").on(table.templateDefinitionId),
  index("decision_room_run_analysis_assets_timeframe_idx").on(table.timeframeDefinitionId),
  index("decision_room_run_analysis_assets_context_idx").on(table.contextId),
  check("decision_room_run_analysis_assets_shape", sql`(
    ${table.assetHash} ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(${table.resolvedTimeframe}) = 'object'
    and ${table.resolvedTimeframe} #>> '{resolverVersion}' = 'analysis-timeframe-resolver/1.0.0'
  ) is true`),
]);

/** Deduplicated in-app-only completion notifications. */
export const decisionRoomInboxItems = pgTable("decision_room_inbox_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull(),
  notificationRef: text("notification_ref").notNull(),
  channel: text("channel").notNull().default("in_app_inbox"),
  analysisRef: text("analysis_ref").notNull(),
  summaryCode: text("summary_code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.runId],
    foreignColumns: [decisionRoomRuns.workspaceId, decisionRoomRuns.id],
    name: "decision_room_inbox_items_run_scope_fk",
  }).onDelete("cascade"),
  uniqueIndex("decision_room_inbox_items_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("decision_room_inbox_items_workspace_notification_unique").on(table.workspaceId, table.notificationRef),
  uniqueIndex("decision_room_inbox_items_workspace_run_analysis_unique").on(table.workspaceId, table.runId, table.analysisRef),
  index("decision_room_inbox_items_run_idx").on(table.runId),
  index("decision_room_inbox_items_created_idx").on(table.workspaceId, table.createdAt),
  index("decision_room_inbox_items_read_page_idx").on(table.workspaceId, table.createdAt, table.notificationRef),
  check("decision_room_inbox_items_channel", sql`${table.channel} = 'in_app_inbox'`),
  check("decision_room_inbox_items_format", sql`
    ${table.notificationRef} ~ '^inbox_[a-f0-9]{20}$'
    and ${table.analysisRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and ${table.summaryCode} ~ '^[a-z0-9][a-z0-9_:-]{0,127}$'
  `),
]);

/** Per-reader state is separate so dashboard and CLI views remain idempotent. */
export const decisionRoomInboxReads = pgTable("decision_room_inbox_reads", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  inboxItemId: uuid("inbox_item_id").notNull(),
  readerRef: text("reader_ref").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.inboxItemId],
    foreignColumns: [decisionRoomInboxItems.workspaceId, decisionRoomInboxItems.id],
    name: "decision_room_inbox_reads_item_scope_fk",
  }).onDelete("cascade"),
  uniqueIndex("decision_room_inbox_reads_workspace_item_reader_unique")
    .on(table.workspaceId, table.inboxItemId, table.readerRef),
  index("decision_room_inbox_reads_item_idx").on(table.inboxItemId),
  index("decision_room_inbox_reads_reader_idx").on(table.workspaceId, table.readerRef, table.readAt),
  check("decision_room_inbox_reads_reader_required", sql`
    ${table.readerRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and ${table.readerRef} !~* '(token|secret|prompt|raw[_-]?(payload|request|response|json))'
  `),
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
  index("meta_asset_edges_ad_account_idx").on(table.adAccountId),
  index("meta_asset_edges_target_asset_idx").on(table.targetAssetId),
]);

/** Durable outcome of each bounded Graph asset-discovery edge. */
export const metaAssetDiscoveries = pgTable("meta_asset_discoveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").references(() => adAccounts.id, { onDelete: "cascade" }),
  discoveryKey: text("discovery_key").notNull(),
  resource: metaAssetDiscoveryResource("resource").notNull(),
  sourceType: metaAssetDiscoverySourceType("source_type").notNull(),
  sourceExternalId: text("source_external_id"),
  status: metaAssetDiscoveryStatus("status").notNull(),
  reason: text("reason"),
  itemCount: integer("item_count").notNull().default(0),
  sourceEdge: text("source_edge").notNull(),
  rawPayloadHash: text("raw_payload_hash").notNull(),
  sourceGraphVersion: text("source_graph_version").notNull(),
  fieldCatalogVersion: text("field_catalog_version").notNull(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_asset_discoveries_workspace_connection_key_unique").on(
    table.workspaceId,
    table.metaConnectionId,
    table.discoveryKey,
  ),
  index("meta_asset_discoveries_connection_status_idx").on(
    table.metaConnectionId,
    table.status,
  ),
  index("meta_asset_discoveries_ad_account_idx").on(table.adAccountId),
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
  index("meta_ad_creative_bindings_creative_idx").on(table.creativeId),
  index("meta_ad_creative_bindings_post_idx").on(table.postId),
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
 * Hash-only replay ledger. Canonical payloads live in the digital-twin/insight
 * tables; this ledger only lets a restarted worker distinguish unchanged input.
 */
export const metaSyncRecordLedger = pgTable("meta_sync_record_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  streamType: metaSyncStreamType("stream_type").notNull(),
  entityLevel: metaInsightEntityLevel("entity_level"),
  recordIdentity: text("record_identity").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("meta_sync_record_ledger_workspace_connection_identity_unique").on(
    table.workspaceId, table.metaConnectionId, table.recordIdentity,
  ),
  index("meta_sync_record_ledger_account_stream_idx").on(table.adAccountId, table.streamType),
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
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
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

/** Immutable, server-private snapshot of the exact policy used to initialize an action queue entry. */
export const actionApprovalPolicySnapshots = pgTable("action_approval_policy_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  policyRef: text("policy_ref").notNull(),
  revision: integer("revision").notNull(),
  schemaVersion: text("schema_version").notNull(),
  policyHash: text("policy_hash").notNull(),
  policyPayload: jsonb("policy_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("action_approval_policy_snapshots_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("action_approval_policy_snapshots_workspace_revision_unique")
    .on(table.workspaceId, table.policyRef, table.revision),
  uniqueIndex("action_approval_policy_snapshots_workspace_hash_unique")
    .on(table.workspaceId, table.policyRef, table.policyHash),
  index("action_approval_policy_snapshots_workspace_created_idx").on(table.workspaceId, table.createdAt),
  check("action_approval_policy_snapshots_revision_positive", sql`${table.revision} >= 1`),
  check("action_approval_policy_snapshots_hash_format", sql`${table.policyHash} ~ '^[a-f0-9]{64}$'`),
  check("action_approval_policy_snapshots_identity", sql`
    ${table.schemaVersion} = 'action-approval-policy/1.0.0'
    and ${table.policyRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
  `),
  check("action_approval_policy_snapshots_payload_exact", sql`
    jsonb_typeof(${table.policyPayload}) = 'object'
    and ${table.policyPayload} #>> '{version}' = ${table.schemaVersion}
    and ${table.policyPayload} #>> '{policyRef}' = ${table.policyRef}
    and (${table.policyPayload} #>> '{revision}')::integer = ${table.revision}
    and ${table.policyPayload} #>> '{policyHash}' = ${table.policyHash}
    and ${table.policyPayload} #>> '{autonomyMode}' = 'approval_only'
  `),
  check("action_approval_policy_snapshots_no_authority", sql`
    not jsonb_path_exists(${table.policyPayload}, '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|grant|authorization)$" flag "i")')
  `),
  check("action_approval_policy_snapshots_no_forbidden_material", sql`
    ${table.policyPayload}::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and ${table.policyPayload}::text !~* '"authorization"[[:space:]]*:'
    and ${table.policyPayload}::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  `),
]);

/** One immutable proposal envelope. This table is queue state, never execution authority. */
export const actionProposalBundles = pgTable("action_proposal_bundles", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  policySnapshotId: uuid("policy_snapshot_id").notNull(),
  workspaceRef: text("workspace_ref").notNull(),
  bundleRef: text("bundle_ref").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  stagingVersion: text("staging_version").notNull(),
  stagingHash: text("staging_hash").notNull(),
  schemaVersion: text("schema_version").notNull(),
  bundleHash: text("bundle_hash").notNull(),
  planRef: text("plan_ref").notNull(),
  planRevision: integer("plan_revision").notNull(),
  planHash: text("plan_hash").notNull(),
  traceHash: text("trace_hash").notNull(),
  lifecycleHash: text("lifecycle_hash").notNull(),
  bundlePayload: jsonb("bundle_payload").$type<Record<string, unknown>>().notNull(),
  initializedAt: timestamp("initialized_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("action_proposal_bundles_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("action_proposal_bundles_workspace_identity_unique")
    .on(table.workspaceId, table.bundleRef, table.planRef, table.planRevision),
  uniqueIndex("action_proposal_bundles_workspace_hash_unique").on(table.workspaceId, table.bundleHash),
  uniqueIndex("action_proposal_bundles_workspace_idempotency_unique")
    .on(table.workspaceId, table.idempotencyKey),
  uniqueIndex("action_proposal_bundles_workspace_staging_hash_unique")
    .on(table.workspaceId, table.stagingHash),
  index("action_proposal_bundles_workspace_initialized_idx").on(table.workspaceId, table.initializedAt, table.id),
  index("action_proposal_bundles_policy_idx").on(table.policySnapshotId),
  foreignKey({
    columns: [table.workspaceId, table.policySnapshotId],
    foreignColumns: [actionApprovalPolicySnapshots.workspaceId, actionApprovalPolicySnapshots.id],
    name: "action_proposal_bundles_policy_scope_fk",
  }).onDelete("cascade"),
  check("action_proposal_bundles_plan_revision_positive", sql`${table.planRevision} >= 1`),
  check("action_proposal_bundles_identity", sql`
    ${table.stagingVersion} = 'action-proposal-staging/1.0.0'
    and ${table.schemaVersion} = 'action-bundle/1.0.0'
    and ${table.workspaceRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.bundleRef} ~ '^action_bundle_[a-f0-9]{20}$'
    and ${table.planRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
  `),
  check("action_proposal_bundles_hash_formats", sql`
    ${table.bundleHash} ~ '^[a-f0-9]{64}$'
    and ${table.planHash} ~ '^[a-f0-9]{64}$'
    and ${table.traceHash} ~ '^[a-f0-9]{64}$'
    and ${table.lifecycleHash} ~ '^[a-f0-9]{64}$'
    and ${table.idempotencyKey} ~ '^[a-f0-9]{64}$'
    and ${table.stagingHash} ~ '^[a-f0-9]{64}$'
  `),
  check("action_proposal_bundles_payload_exact", sql`
    jsonb_typeof(${table.bundlePayload}) = 'object'
    and ${table.bundlePayload} #>> '{version}' = ${table.schemaVersion}
    and ${table.bundlePayload} #>> '{bundleRef}' = ${table.bundleRef}
    and ${table.bundlePayload} #>> '{bundleHash}' = ${table.bundleHash}
    and ${table.bundlePayload} #>> '{plan,planRef}' = ${table.planRef}
    and (${table.bundlePayload} #>> '{plan,revision}')::integer = ${table.planRevision}
    and ${table.bundlePayload} #>> '{plan,planHash}' = ${table.planHash}
    and jsonb_typeof(${table.bundlePayload} #> '{units}') = 'array'
    and jsonb_array_length(${table.bundlePayload} #> '{units}') >= 1
  `),
  check("action_proposal_bundles_no_authority", sql`
    not jsonb_path_exists(${table.bundlePayload}, '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|grant|authorization)$" flag "i")')
  `),
  check("action_proposal_bundles_no_forbidden_material", sql`
    ${table.bundlePayload}::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and ${table.bundlePayload}::text !~* '"authorization"[[:space:]]*:'
    and ${table.bundlePayload}::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  `),
]);

/**
 * Opaque refs are retained only as private, hash-bound source identity. Every
 * queued Meta mutation must also bind to exactly one tenant-local account and
 * one target at the action plan's declared campaign/adset/ad level.
 */
export const actionProposalUnits = pgTable("action_proposal_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  bundleId: uuid("bundle_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  unitRef: text("unit_ref").notNull(),
  unitHash: text("unit_hash").notNull(),
  scopeHash: text("scope_hash").notNull(),
  accountRef: text("account_ref").notNull(),
  entityRef: text("entity_ref").notNull(),
  actionType: text("action_type").notNull(),
  risk: text("risk").notNull(),
  sourceHash: text("source_hash").notNull(),
  contextHash: text("context_hash").notNull(),
  specHash: text("spec_hash").notNull(),
  actionPlanHash: text("action_plan_hash").notNull(),
  actionHash: text("action_hash").notNull(),
  summaryHash: text("summary_hash").notNull(),
  requesterRef: text("requester_ref").notNull(),
  requesterRole: text("requester_role").notNull(),
  proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  initialState: text("initial_state").notNull(),
  adAccountId: uuid("ad_account_id").notNull(),
  campaignId: uuid("campaign_id"),
  adSetId: uuid("ad_set_id"),
  adId: uuid("ad_id"),
  unitPayload: jsonb("unit_payload").$type<Record<string, unknown>>().notNull(),
  actionPlanPayload: jsonb("action_plan_payload").$type<Record<string, unknown>>().notNull(),
  summaryPayload: jsonb("summary_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("action_proposal_units_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("action_proposal_units_dependency_binding_unique")
    .on(table.workspaceId, table.bundleId, table.id, table.unitRef),
  uniqueIndex("action_proposal_units_bundle_ordinal_unique").on(table.bundleId, table.ordinal),
  uniqueIndex("action_proposal_units_bundle_ref_unique").on(table.bundleId, table.unitRef),
  uniqueIndex("action_proposal_units_bundle_hash_unique").on(table.bundleId, table.unitHash),
  index("action_proposal_units_workspace_account_idx").on(table.workspaceId, table.adAccountId),
  index("action_proposal_units_bundle_idx").on(table.bundleId),
  foreignKey({
    columns: [table.workspaceId, table.bundleId],
    foreignColumns: [actionProposalBundles.workspaceId, actionProposalBundles.id],
    name: "action_proposal_units_bundle_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.adAccountId],
    foreignColumns: [adAccounts.workspaceId, adAccounts.id],
    name: "action_proposal_units_account_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.workspaceId, table.campaignId],
    foreignColumns: [adCampaigns.workspaceId, adCampaigns.id],
    name: "action_proposal_units_campaign_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.adSetId, table.workspaceId],
    foreignColumns: [metaAdSets.id, metaAdSets.workspaceId],
    name: "action_proposal_units_ad_set_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.adId, table.workspaceId],
    foreignColumns: [metaAds.id, metaAds.workspaceId],
    name: "action_proposal_units_ad_scope_fk",
  }).onDelete("restrict"),
  check("action_proposal_units_ordinal_positive", sql`${table.ordinal} >= 1`),
  check("action_proposal_units_initial_state", sql`${table.initialState} = 'awaiting_approval'`),
  check("action_proposal_units_risk", sql`${table.risk} in ('K0', 'K1', 'K2', 'K3', 'K4')`),
  check("action_proposal_units_identity", sql`
    ${table.unitRef} ~ '^action_unit_[a-f0-9]{20}$'
    and ${table.accountRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.entityRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.requesterRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.requesterRole} in ('owner', 'admin', 'operator', 'analyst')
    and ${table.actionType} in ('internal_annotation', 'status_pause', 'status_activate', 'budget_decrease', 'budget_increase', 'existing_post_promotion')
  `),
  check("action_proposal_units_hash_formats", sql`
    ${table.unitHash} ~ '^[a-f0-9]{64}$'
    and ${table.scopeHash} ~ '^[a-f0-9]{64}$'
    and ${table.sourceHash} ~ '^[a-f0-9]{64}$'
    and ${table.contextHash} ~ '^[a-f0-9]{64}$'
    and ${table.specHash} ~ '^[a-f0-9]{64}$'
    and ${table.actionPlanHash} ~ '^[a-f0-9]{64}$'
    and ${table.actionHash} ~ '^[a-f0-9]{64}$'
    and ${table.summaryHash} ~ '^[a-f0-9]{64}$'
  `),
  check("action_proposal_units_authentic_entity_single", sql`
    num_nonnulls(${table.campaignId}, ${table.adSetId}, ${table.adId}) = 1
    and not (${table.actionType} in ('budget_decrease', 'budget_increase') and ${table.adId} is not null)
  `),
  check("action_proposal_units_time_order", sql`${table.expiresAt} > ${table.proposedAt}`),
  check("action_proposal_units_payload_exact", sql`
    jsonb_typeof(${table.unitPayload}) = 'object'
    and ${table.unitPayload} #>> '{unitRef}' = ${table.unitRef}
    and ${table.unitPayload} #>> '{unitHash}' = ${table.unitHash}
    and ${table.unitPayload} #>> '{scopeHash}' = ${table.scopeHash}
    and ${table.unitPayload} #>> '{scope,accountRef}' = ${table.accountRef}
    and ${table.unitPayload} #>> '{scope,entityRef}' = ${table.entityRef}
    and ${table.unitPayload} #>> '{scope,actionType}' = ${table.actionType}
    and ${table.unitPayload} #>> '{risk}' = ${table.risk}
    and ${table.unitPayload} #>> '{sourceHash}' = ${table.sourceHash}
    and ${table.unitPayload} #>> '{contextHash}' = ${table.contextHash}
    and ${table.unitPayload} #>> '{specHash}' = ${table.specHash}
    and ${table.unitPayload} #>> '{requester,actorRef}' = ${table.requesterRef}
    and ${table.unitPayload} #>> '{requester,role}' = ${table.requesterRole}
    and (${table.unitPayload} #>> '{proposedAt}')::timestamptz = ${table.proposedAt}
    and (${table.unitPayload} #>> '{expiresAt}')::timestamptz = ${table.expiresAt}
  `),
  check("action_proposal_units_action_plan_exact", sql`
    jsonb_typeof(${table.actionPlanPayload}) = 'object'
    and ${table.actionPlanPayload} #>> '{schemaVersion}' = 'action-plan/1.0.0'
    and ${table.actionPlanPayload} #>> '{planHash}' = ${table.actionPlanHash}
    and ${table.actionPlanPayload} #>> '{actionType}' = ${table.actionType}
    and ${table.actionPlanPayload} #>> '{risk}' = ${table.risk}
    and ${table.actionPlanPayload} #>> '{action,entity,ref}' = ${table.entityRef}
    and ${table.actionPlanPayload} #>> '{disposition}' = 'approval_required'
    and ${table.actionPlanPayload} #>> '{contextHash}' = ${table.contextHash}
    and ${table.actionPlanPayload} #>> '{capabilities,canExecute}' = 'false'
    and ${table.actionPlanPayload} #>> '{capabilities,canWriteMeta}' = 'false'
    and ${table.actionPlanPayload} #>> '{capabilities,canGrantApproval}' = 'false'
    and ${table.actionPlanPayload} #>> '{capabilities,canAccessRawGraph}' = 'false'
  `),
  check("action_proposal_units_summary_exact", sql`
    jsonb_typeof(${table.summaryPayload}) = 'object'
    and ${table.summaryPayload} #>> '{safety}' = 'public_safe'
    and jsonb_typeof(${table.summaryPayload} #> '{before}') = 'object'
    and jsonb_typeof(${table.summaryPayload} #> '{after}') = 'object'
    and jsonb_typeof(${table.summaryPayload} #> '{evidence}') = 'array'
  `),
  check("action_proposal_units_authentic_level_exact", sql`
    (${table.actionPlanPayload} #>> '{action,entity,level}' = 'campaign'
      and ${table.campaignId} is not null and ${table.adSetId} is null and ${table.adId} is null)
    or (${table.actionPlanPayload} #>> '{action,entity,level}' = 'adset'
      and ${table.campaignId} is null and ${table.adSetId} is not null and ${table.adId} is null)
    or (${table.actionPlanPayload} #>> '{action,entity,level}' = 'ad'
      and ${table.campaignId} is null and ${table.adSetId} is null and ${table.adId} is not null)
  `),
  check("action_proposal_units_no_authority", sql`
    not jsonb_path_exists(${table.unitPayload}, '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|grant|authorization)$" flag "i")')
    and not jsonb_path_exists(${table.actionPlanPayload} - 'capabilities', '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|grant|authorization)$" flag "i")')
    and not jsonb_path_exists(${table.summaryPayload}, '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|grant|authorization)$" flag "i")')
  `),
  check("action_proposal_units_no_forbidden_material", sql`
    (${table.unitPayload}::text || ${table.actionPlanPayload}::text || ${table.summaryPayload}::text)
      !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and (${table.unitPayload}::text || ${table.actionPlanPayload}::text || ${table.summaryPayload}::text)
      !~* '"authorization"[[:space:]]*:'
    and (${table.unitPayload}::text || ${table.actionPlanPayload}::text || ${table.summaryPayload}::text)
      !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  `),
]);

/** Immutable edges preserve the proposal DAG without carrying approval state. */
export const actionProposalDependencies = pgTable("action_proposal_dependencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  bundleId: uuid("bundle_id").notNull(),
  unitId: uuid("unit_id").notNull(),
  dependencyUnitId: uuid("dependency_unit_id").notNull(),
  unitRef: text("unit_ref").notNull(),
  dependencyUnitRef: text("dependency_unit_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("action_proposal_dependencies_edge_unique").on(table.bundleId, table.unitId, table.dependencyUnitId),
  index("action_proposal_dependencies_unit_idx").on(table.unitId),
  index("action_proposal_dependencies_dependency_idx").on(table.dependencyUnitId),
  foreignKey({
    columns: [table.workspaceId, table.bundleId],
    foreignColumns: [actionProposalBundles.workspaceId, actionProposalBundles.id],
    name: "action_proposal_dependencies_bundle_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.bundleId, table.unitId, table.unitRef],
    foreignColumns: [
      actionProposalUnits.workspaceId,
      actionProposalUnits.bundleId,
      actionProposalUnits.id,
      actionProposalUnits.unitRef,
    ],
    name: "action_proposal_dependencies_unit_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.bundleId, table.dependencyUnitId, table.dependencyUnitRef],
    foreignColumns: [
      actionProposalUnits.workspaceId,
      actionProposalUnits.bundleId,
      actionProposalUnits.id,
      actionProposalUnits.unitRef,
    ],
    name: "action_proposal_dependencies_dependency_scope_fk",
  }).onDelete("cascade"),
  check("action_proposal_dependencies_identity", sql`
    ${table.unitRef} ~ '^action_unit_[a-f0-9]{20}$'
    and ${table.dependencyUnitRef} ~ '^action_unit_[a-f0-9]{20}$'
    and ${table.unitRef} <> ${table.dependencyUnitRef}
  `),
]);

/** Exactly the initialization audit intent; later approval events belong to a future append API. */
export const actionProposalInitialEvents = pgTable("action_proposal_initial_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  bundleId: uuid("bundle_id").notNull(),
  eventRef: text("event_ref").notNull(),
  sequence: integer("sequence").notNull(),
  previousHash: text("previous_hash").notNull(),
  eventHash: text("event_hash").notNull(),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  reasonCode: text("reason_code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("action_proposal_initial_events_bundle_unique").on(table.bundleId),
  uniqueIndex("action_proposal_initial_events_workspace_event_unique").on(table.workspaceId, table.eventRef),
  uniqueIndex("action_proposal_initial_events_workspace_hash_unique").on(table.workspaceId, table.eventHash),
  index("action_proposal_initial_events_bundle_idx").on(table.bundleId),
  foreignKey({
    columns: [table.workspaceId, table.bundleId],
    foreignColumns: [actionProposalBundles.workspaceId, actionProposalBundles.id],
    name: "action_proposal_initial_events_bundle_scope_fk",
  }).onDelete("cascade"),
  check("action_proposal_initial_events_shape", sql`
    ${table.sequence} = 1
    and ${table.previousHash} = '0000000000000000000000000000000000000000000000000000000000000000'
    and ${table.eventType} = 'lifecycle_initialized'
    and ${table.eventHash} ~ '^[a-f0-9]{64}$'
  `),
  check("action_proposal_initial_events_identity", sql`
    ${table.eventRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.reasonCode} ~ '^[a-z][a-z0-9_.:-]{0,127}$'
  `),
]);

/**
 * One immutable human decision command and its complete pure transition evidence.
 * A row is approval evidence only: it cannot be consumed or executed.
 */
export const actionApprovalDecisionEvents = pgTable("action_approval_decision_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  bundleId: uuid("bundle_id").notNull(),
  unitId: uuid("unit_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  commandRef: text("command_ref").notNull(),
  commandKind: text("command_kind").notNull(),
  unitRef: text("unit_ref").notNull(),
  unitHash: text("unit_hash").notNull(),
  actorRef: text("actor_ref").notNull(),
  actorRole: text("actor_role").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  reasonCode: text("reason_code").notNull(),
  commandHash: text("command_hash").notNull(),
  freshnessHash: text("freshness_hash").notNull(),
  lifecycleBeforeHash: text("lifecycle_before_hash").notNull(),
  lifecycleAfterHash: text("lifecycle_after_hash").notNull(),
  traceAfterHash: text("trace_after_hash").notNull(),
  commandPayload: jsonb("command_payload").$type<Record<string, unknown>>().notNull(),
  eventPayloads: jsonb("event_payloads").$type<readonly Record<string, unknown>[]>().notNull(),
  executionAuthority: text("execution_authority").notNull().default("none"),
  executionPerformed: boolean("execution_performed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("action_approval_decision_events_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("action_approval_decision_events_bundle_ordinal_unique")
    .on(table.workspaceId, table.bundleId, table.ordinal),
  uniqueIndex("action_approval_decision_events_bundle_unit_unique")
    .on(table.workspaceId, table.bundleId, table.unitId),
  uniqueIndex("action_approval_decision_events_workspace_command_unique").on(table.workspaceId, table.commandRef),
  uniqueIndex("action_approval_decision_events_workspace_hash_unique").on(table.workspaceId, table.commandHash),
  index("action_approval_decision_events_bundle_idx").on(table.workspaceId, table.bundleId, table.ordinal),
  index("action_approval_decision_events_unit_idx").on(table.unitId),
  foreignKey({
    columns: [table.workspaceId, table.bundleId],
    foreignColumns: [actionProposalBundles.workspaceId, actionProposalBundles.id],
    name: "action_approval_decision_events_bundle_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.bundleId, table.unitId, table.unitRef],
    foreignColumns: [
      actionProposalUnits.workspaceId,
      actionProposalUnits.bundleId,
      actionProposalUnits.id,
      actionProposalUnits.unitRef,
    ],
    name: "action_approval_decision_events_unit_scope_fk",
  }).onDelete("cascade"),
  check("action_approval_decision_events_ordinal_positive", sql`${table.ordinal} >= 1`),
  check("action_approval_decision_events_identity", sql`
    ${table.commandRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.unitRef} ~ '^action_unit_[a-f0-9]{20}$'
    and ${table.actorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.actorRole} in ('owner', 'admin', 'operator')
    and ${table.reasonCode} ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and ${table.commandKind} in ('approve', 'reject', 'request_changes')
  `),
  check("action_approval_decision_events_hash_formats", sql`
    ${table.unitHash} ~ '^[a-f0-9]{64}$'
    and ${table.commandHash} ~ '^[a-f0-9]{64}$'
    and ${table.freshnessHash} ~ '^[a-f0-9]{64}$'
    and ${table.lifecycleBeforeHash} ~ '^[a-f0-9]{64}$'
    and ${table.lifecycleAfterHash} ~ '^[a-f0-9]{64}$'
    and ${table.traceAfterHash} ~ '^[a-f0-9]{64}$'
  `),
  check("action_approval_decision_events_exact", sql`
    jsonb_typeof(${table.commandPayload}) = 'object'
    and ${table.commandPayload} #>> '{commandRef}' = ${table.commandRef}
    and ${table.commandPayload} #>> '{kind}' = ${table.commandKind}
    and ${table.commandPayload} #>> '{unitRef}' = ${table.unitRef}
    and ${table.commandPayload} #>> '{actor,actorRef}' = ${table.actorRef}
    and ${table.commandPayload} #>> '{actor,role}' = ${table.actorRole}
    and (${table.commandPayload} #>> '{decidedAt}')::timestamptz = ${table.decidedAt}
    and ${table.commandPayload} #>> '{reasonCode}' = ${table.reasonCode}
    and jsonb_typeof(${table.commandPayload} #> '{freshness}') = 'array'
    and jsonb_typeof(${table.eventPayloads}) = 'array'
    and jsonb_array_length(${table.eventPayloads}) >= 1
    and ${table.executionAuthority} = 'none'
    and ${table.executionPerformed} = false
  `),
  check("action_approval_decision_events_approval_shape", sql`
    (${table.commandKind} = 'approve'
      and ${table.commandPayload} #>> '{authorization,humanPresence}' = 'true'
      and ${table.commandPayload} #>> '{authorization,canExecute}' = 'false'
      and ${table.commandPayload} ? 'grantRef')
    or (${table.commandKind} in ('reject', 'request_changes')
      and not (${table.commandPayload} ? 'authorization')
      and not (${table.commandPayload} ? 'grantRef'))
  `),
  check("action_approval_decision_events_no_authority", sql`
    not jsonb_path_exists(${table.commandPayload} - 'authorization', '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|execute|write)$" flag "i")')
    and not jsonb_path_exists(${table.eventPayloads}, '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|grant|authorization|execute|write)$" flag "i")')
  `),
  check("action_approval_decision_events_no_forbidden_material", sql`
    (${table.commandPayload}::text || ${table.eventPayloads}::text)
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  `),
]);

/** Immutable, unconsumed approval evidence. It explicitly carries no execution authority. */
export const actionApprovalEvidenceGrants = pgTable("action_approval_evidence_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  bundleId: uuid("bundle_id").notNull(),
  unitId: uuid("unit_id").notNull(),
  decisionEventId: uuid("decision_event_id").notNull(),
  grantRef: text("grant_ref").notNull(),
  unitRef: text("unit_ref").notNull(),
  unitHash: text("unit_hash").notNull(),
  scopeHash: text("scope_hash").notNull(),
  planRef: text("plan_ref").notNull(),
  planRevision: integer("plan_revision").notNull(),
  planHash: text("plan_hash").notNull(),
  approverRef: text("approver_ref").notNull(),
  approverRole: text("approver_role").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  grantHash: text("grant_hash").notNull(),
  grantPayload: jsonb("grant_payload").$type<Record<string, unknown>>().notNull(),
  capability: text("capability").notNull().default("approval_evidence_only"),
  canExecute: boolean("can_execute").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("action_approval_evidence_grants_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("action_approval_evidence_grants_decision_unique").on(table.workspaceId, table.decisionEventId),
  uniqueIndex("action_approval_evidence_grants_bundle_unit_unique")
    .on(table.workspaceId, table.bundleId, table.unitId),
  uniqueIndex("action_approval_evidence_grants_workspace_ref_unique").on(table.workspaceId, table.grantRef),
  uniqueIndex("action_approval_evidence_grants_workspace_hash_unique").on(table.workspaceId, table.grantHash),
  index("action_approval_evidence_grants_bundle_idx").on(table.workspaceId, table.bundleId),
  index("action_approval_evidence_grants_unit_idx").on(table.unitId),
  foreignKey({
    columns: [table.workspaceId, table.bundleId],
    foreignColumns: [actionProposalBundles.workspaceId, actionProposalBundles.id],
    name: "action_approval_evidence_grants_bundle_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.bundleId, table.unitId, table.unitRef],
    foreignColumns: [
      actionProposalUnits.workspaceId,
      actionProposalUnits.bundleId,
      actionProposalUnits.id,
      actionProposalUnits.unitRef,
    ],
    name: "action_approval_evidence_grants_unit_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.decisionEventId],
    foreignColumns: [actionApprovalDecisionEvents.workspaceId, actionApprovalDecisionEvents.id],
    name: "action_approval_evidence_grants_decision_scope_fk",
  }).onDelete("cascade"),
  check("action_approval_evidence_grants_identity", sql`
    ${table.grantRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.unitRef} ~ '^action_unit_[a-f0-9]{20}$'
    and ${table.planRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.approverRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.approverRole} in ('owner', 'admin', 'operator')
    and ${table.planRevision} >= 1
  `),
  check("action_approval_evidence_grants_hash_formats", sql`
    ${table.unitHash} ~ '^[a-f0-9]{64}$'
    and ${table.scopeHash} ~ '^[a-f0-9]{64}$'
    and ${table.planHash} ~ '^[a-f0-9]{64}$'
    and ${table.grantHash} ~ '^[a-f0-9]{64}$'
  `),
  check("action_approval_evidence_grants_exact", sql`
    jsonb_typeof(${table.grantPayload}) = 'object'
    and ${table.grantPayload} #>> '{version}' = 'action-approval-grant/1.0.0'
    and ${table.grantPayload} #>> '{grantRef}' = ${table.grantRef}
    and ${table.grantPayload} #>> '{unitRef}' = ${table.unitRef}
    and ${table.grantPayload} #>> '{unitHash}' = ${table.unitHash}
    and ${table.grantPayload} #>> '{scopeHash}' = ${table.scopeHash}
    and ${table.grantPayload} #>> '{planRef}' = ${table.planRef}
    and (${table.grantPayload} #>> '{planRevision}')::integer = ${table.planRevision}
    and ${table.grantPayload} #>> '{planHash}' = ${table.planHash}
    and ${table.grantPayload} #>> '{approver,actorRef}' = ${table.approverRef}
    and ${table.grantPayload} #>> '{approver,role}' = ${table.approverRole}
    and (${table.grantPayload} #>> '{approvedAt}')::timestamptz = ${table.approvedAt}
    and (${table.grantPayload} #>> '{expiresAt}')::timestamptz = ${table.expiresAt}
    and ${table.grantPayload} #>> '{grantHash}' = ${table.grantHash}
    and ${table.grantPayload} #>> '{singleUse}' = 'true'
    and ${table.grantPayload} #> '{consumedAt}' = 'null'::jsonb
    and ${table.grantPayload} #> '{consumedBy}' = 'null'::jsonb
    and ${table.grantPayload} #>> '{capability}' = 'approval_evidence_only'
    and ${table.grantPayload} #>> '{canExecute}' = 'false'
    and ${table.capability} = 'approval_evidence_only'
    and ${table.canExecute} = false
    and ${table.expiresAt} > ${table.approvedAt}
  `),
  check("action_approval_evidence_grants_no_forbidden_material", sql`
    ${table.grantPayload}::text
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  `),
]);
