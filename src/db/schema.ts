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
