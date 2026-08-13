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
  accessMode: text("access_mode").notNull().default("read_only"),
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
  check("meta_connections_access_mode_read_only", sql`${table.accessMode} = 'read_only'`),
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

/** Private daily read-sync cursor. Rows are provisioned separately; this slice creates no schedule seed. */
export const metaReadSyncSchedules = pgTable("meta_read_sync_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull(),
  triggerKind: text("trigger_kind").notNull().default("daily"),
  revision: integer("revision").notNull().default(1),
  workspaceLifecycleGeneration: integer("workspace_lifecycle_generation").notNull(),
  connectionLifecycleGeneration: integer("connection_lifecycle_generation").notNull(),
  timeframeDays: integer("timeframe_days").notNull().default(1),
  nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_read_sync_schedules_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("meta_read_sync_schedules_workspace_connection_unique").on(table.workspaceId, table.connectionId),
  uniqueIndex("meta_read_sync_schedules_workspace_binding_unique")
    .on(table.workspaceId, table.id, table.connectionId),
  index("meta_read_sync_schedules_due_idx").on(table.enabled, table.nextDueAt, table.workspaceId),
  foreignKey({
    columns: [table.workspaceId, table.connectionId],
    foreignColumns: [metaConnections.workspaceId, metaConnections.id],
    name: "meta_read_sync_schedules_workspace_connection_fk",
  }).onDelete("cascade"),
  check("meta_read_sync_schedules_contract", sql`
    ${table.triggerKind} = 'daily'
    and ${table.revision} between 1 and 1000000
    and ${table.workspaceLifecycleGeneration} >= 1
    and ${table.connectionLifecycleGeneration} >= 1
    and ${table.timeframeDays} between 1 and 90
  `),
]);

/** Atomic lease and terminal run state for one deterministic logical daily fire. */
export const metaReadSyncScheduleRuns = pgTable("meta_read_sync_schedule_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  scheduleId: uuid("schedule_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  scheduleRevision: integer("schedule_revision").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  scopeKey: text("scope_key").notNull(),
  triggerKind: text("trigger_kind").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  dateStart: date("date_start").notNull(),
  dateStop: date("date_stop").notNull(),
  state: text("state").notNull(),
  leaseToken: text("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  attempt: integer("attempt").notNull(),
  failureReason: text("failure_reason"),
  retryable: boolean("retryable"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_read_sync_schedule_runs_idempotency_unique").on(table.idempotencyKey),
  uniqueIndex("meta_read_sync_schedule_runs_workspace_id_unique").on(table.workspaceId, table.id),
  index("meta_read_sync_schedule_runs_workspace_schedule_idx")
    .on(table.workspaceId, table.scheduleId, table.scheduleRevision, table.scheduledFor),
  index("meta_read_sync_schedule_runs_workspace_scope_state_idx")
    .on(table.workspaceId, table.scopeKey, table.state, table.leaseUntil),
  foreignKey({
    columns: [table.workspaceId, table.scheduleId, table.connectionId],
    foreignColumns: [metaReadSyncSchedules.workspaceId, metaReadSyncSchedules.id, metaReadSyncSchedules.connectionId],
    name: "meta_read_sync_schedule_runs_workspace_schedule_fk",
  }).onDelete("cascade"),
  check("meta_read_sync_schedule_runs_identity", sql`
    ${table.scheduleRevision} between 1 and 1000000
    and ${table.idempotencyKey} ~ '^syncfire_[a-f0-9]{64}$'
    and ${table.scopeKey} ~ '^[a-f0-9]{64}$'
    and ${table.triggerKind} = 'daily'
    and ${table.dateStart} <= ${table.dateStop}
    and ${table.attempt} between 1 and 5
  `),
  check("meta_read_sync_schedule_runs_lifecycle", sql`
    (${table.state} = 'running' and ${table.leaseToken} ~ '^lease_[a-f0-9]{32}$'
      and ${table.leaseUntil} is not null and ${table.leaseUntil} > ${table.startedAt}
      and ${table.completedAt} is null and ${table.failedAt} is null
      and ${table.failureReason} is null and ${table.retryable} is null)
    or (${table.state} = 'completed' and ${table.leaseToken} is null and ${table.leaseUntil} is null
      and ${table.completedAt} is not null and ${table.failedAt} is null
      and ${table.completedAt} >= ${table.startedAt}
      and ${table.failureReason} is null and ${table.retryable} is null)
    or (${table.state} = 'failed' and ${table.leaseToken} is null and ${table.leaseUntil} is null
      and ${table.completedAt} is null and ${table.failedAt} is not null
      and ${table.failedAt} >= ${table.startedAt}
      and ${table.failureReason} in ('scope_unavailable', 'connection_unavailable', 'account_scope_unavailable',
        'rate_limited', 'transient', 'partial_result', 'sync_failed') and ${table.retryable} is not null)
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

/** Restart-durable, server-private local agent session binding. It stores no bearer, nonce, prompt, or model state. */
export const localAgentSessions = pgTable("local_agent_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  sessionRef: text("session_ref").notNull(),
  workspaceRef: text("workspace_ref").notNull(),
  userId: uuid("user_id").notNull(),
  clientRef: text("client_ref").notNull(),
  transport: text("transport").notNull(),
  toolCatalogVersion: text("tool_catalog_version").notNull(),
  allowedTools: jsonb("allowed_tools").$type<readonly string[]>().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("local_agent_sessions_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("local_agent_sessions_workspace_session_unique").on(table.workspaceId, table.sessionRef),
  index("local_agent_sessions_workspace_expiry_idx").on(table.workspaceId, table.expiresAt),
  foreignKey({
    columns: [table.workspaceId, table.userId],
    foreignColumns: [memberships.workspaceId, memberships.userId],
    name: "local_agent_sessions_workspace_membership_fk",
  }).onDelete("cascade"),
  check("local_agent_sessions_identity", sql`
    ${table.sessionRef} ~ '^session_[a-f0-9]{32}$'
    and ${table.workspaceRef} ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,86}$'
    and ${table.clientRef} ~ '^client_[a-z0-9][a-z0-9_-]{0,86}$'
    and ${table.transport} in ('deterministic_fixture', 'project_stdio', 'loopback_http')
    and ${table.toolCatalogVersion} = 'local-agent-tools/1.0.0'
  `),
  check("local_agent_sessions_tools", sql`
    jsonb_typeof(${table.allowedTools}) = 'array'
    and jsonb_array_length(${table.allowedTools}) between 1 and 15
    and ${table.allowedTools} <@ '[
      "decision_room_list", "decision_room_mark_inbox_read", "approval_queue_list", "approval_queue_get",
      "policy_bundle_read",
      "budget_lab_list", "budget_lab_get", "budget_lab_dry_run", "budget_lab_save_draft",
      "practice_lab_list", "practice_lab_get", "practice_lab_prepare_draft",
      "existing_post_promotion_preflight", "guidance_registry_list", "guidance_effective_preview"
    ]'::jsonb
  `),
  check("local_agent_sessions_time", sql`
    ${table.lastSeenAt} >= ${table.startedAt}
    and ${table.lastSeenAt} < ${table.expiresAt}
    and ${table.expiresAt} > ${table.startedAt}
    and ${table.expiresAt} <= ${table.startedAt} + interval '8 hours'
  `),
]);

/** Short-lived ref-only Dashboard→CLI handoff. Consumption is a single conditional UPDATE. */
export const localAgentHandoffs = pgTable("local_agent_handoffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  handoffRef: text("handoff_ref").notNull(),
  workspaceRef: text("workspace_ref").notNull(),
  creatorSessionRef: text("creator_session_ref").notNull(),
  targetSessionRef: text("target_session_ref").notNull(),
  intent: text("intent").notNull(),
  entityRef: text("entity_ref").notNull(),
  timeframeRef: text("timeframe_ref").notNull(),
  contextRef: text("context_ref").notNull(),
  contextVersion: integer("context_version").notNull(),
  templateRef: text("template_ref"),
  correlationRef: text("correlation_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("local_agent_handoffs_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("local_agent_handoffs_workspace_ref_unique").on(table.workspaceId, table.handoffRef),
  index("local_agent_handoffs_creator_idx").on(table.workspaceId, table.creatorSessionRef),
  index("local_agent_handoffs_target_idx").on(table.workspaceId, table.targetSessionRef, table.expiresAt),
  index("local_agent_handoffs_expiry_idx").on(table.workspaceId, table.expiresAt),
  foreignKey({
    columns: [table.workspaceId, table.creatorSessionRef],
    foreignColumns: [localAgentSessions.workspaceId, localAgentSessions.sessionRef],
    name: "local_agent_handoffs_workspace_creator_session_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.targetSessionRef],
    foreignColumns: [localAgentSessions.workspaceId, localAgentSessions.sessionRef],
    name: "local_agent_handoffs_workspace_target_session_fk",
  }).onDelete("cascade"),
  check("local_agent_handoffs_identity", sql`
    ${table.handoffRef} ~ '^handoff_[a-f0-9]{32}$'
    and ${table.workspaceRef} ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,86}$'
    and ${table.creatorSessionRef} ~ '^session_[a-f0-9]{32}$'
    and ${table.targetSessionRef} ~ '^session_[a-f0-9]{32}$'
    and ${table.correlationRef} ~ '^correlation_[a-f0-9]{32}$'
  `),
  check("local_agent_handoffs_context", sql`
    ${table.intent} in ('analysis', 'existing_post_promotion')
    and ${table.contextVersion} between 1 and 1000000
    and ${table.entityRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$'
    and ${table.timeframeRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$'
    and ${table.contextRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$'
    and (${table.templateRef} is null or ${table.templateRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$')
    and (${table.entityRef} || ' ' || ${table.timeframeRef} || ' ' || ${table.contextRef} || ' ' || coalesce(${table.templateRef}, ''))
      !~* '(token|secret|prompt|raw|hash|sql|uuid|grant|approve|execute|human)'
    and ((${table.intent} = 'analysis' and ${table.templateRef} is null)
      or (${table.intent} = 'existing_post_promotion' and ${table.templateRef} is not null))
  `),
  check("local_agent_handoffs_time", sql`
    ${table.expiresAt} >= ${table.createdAt} + interval '15 seconds'
    and ${table.expiresAt} <= ${table.createdAt} + interval '120 seconds'
    and (${table.consumedAt} is null or (${table.consumedAt} >= ${table.createdAt} and ${table.consumedAt} < ${table.expiresAt}))
  `),
]);

/**
 * One durable, vendor-neutral Orchestrator conversation per local operator.
 * The header is immutable; page changes are captured on individual turns.
 */
export const orchestratorConversations = pgTable("orchestrator_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  conversationRef: text("conversation_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("orchestrator_conversations_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("orchestrator_conversations_workspace_ref_unique").on(table.workspaceId, table.conversationRef),
  index("orchestrator_conversations_operator_idx").on(table.workspaceId, table.userId, table.createdAt),
  foreignKey({
    columns: [table.workspaceId, table.userId],
    foreignColumns: [memberships.workspaceId, memberships.userId],
    name: "orchestrator_conversations_workspace_membership_fk",
  }).onDelete("cascade"),
  check("orchestrator_conversations_identity", sql`
    ${table.conversationRef} ~ '^conversation_[a-f0-9]{32}$'
  `),
]);

/** A completed or failed model invocation. Rows are append-only execution receipts. */
export const orchestratorConversationTurns = pgTable("orchestrator_conversation_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  conversationRef: text("conversation_ref").notNull(),
  turnRef: text("turn_ref").notNull(),
  turnNumber: integer("turn_number").notNull(),
  provider: text("provider").notNull(),
  providerThreadRef: text("provider_thread_ref"),
  outcome: text("outcome").notNull(),
  failureCode: text("failure_code"),
  pageGuide: jsonb("page_guide").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("orchestrator_conversation_turns_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("orchestrator_conversation_turns_workspace_ref_unique").on(table.workspaceId, table.turnRef),
  uniqueIndex("orchestrator_conversation_turns_workspace_conversation_ref_unique")
    .on(table.workspaceId, table.conversationRef, table.turnRef),
  uniqueIndex("orchestrator_conversation_turns_sequence_unique")
    .on(table.workspaceId, table.conversationRef, table.turnNumber),
  index("orchestrator_conversation_turns_timeline_idx")
    .on(table.workspaceId, table.conversationRef, table.turnNumber),
  foreignKey({
    columns: [table.workspaceId, table.conversationRef],
    foreignColumns: [orchestratorConversations.workspaceId, orchestratorConversations.conversationRef],
    name: "orchestrator_conversation_turns_workspace_conversation_fk",
  }).onDelete("cascade"),
  check("orchestrator_conversation_turns_identity", sql`
    ${table.turnRef} ~ '^turn_[a-f0-9]{32}$'
    and ${table.turnNumber} between 1 and 1000000
    and ${table.provider} = 'codex_cli'
    and (${table.providerThreadRef} is null or ${table.providerThreadRef} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  `),
  check("orchestrator_conversation_turns_outcome", sql`
    (${table.outcome} = 'completed' and ${table.providerThreadRef} is not null and ${table.failureCode} is null)
    or (${table.outcome} = 'failed' and ${table.failureCode} in
      ('adapter_unavailable', 'adapter_timeout', 'adapter_failed', 'invalid_provider_output') and ${table.providerThreadRef} is null)
  `),
  check("orchestrator_conversation_turns_page_guide", sql`
    jsonb_typeof(${table.pageGuide}) = 'object'
    and ${table.pageGuide} ?& array['version', 'pageId', 'pageLabel', 'purpose', 'codePath', 'recordPath']
    and ${table.pageGuide} - array['version', 'pageId', 'pageLabel', 'purpose', 'codePath', 'recordPath'] = '{}'::jsonb
    and ${table.pageGuide} #>> '{version}' = 'orchestrator-page-guide/1.0.0'
  `),
]);

/** User/assistant transcript material. Only final assistant text is stored. */
export const orchestratorConversationMessages = pgTable("orchestrator_conversation_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  conversationRef: text("conversation_ref").notNull(),
  turnRef: text("turn_ref").notNull(),
  messageRef: text("message_ref").notNull(),
  messageNumber: integer("message_number").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("orchestrator_conversation_messages_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("orchestrator_conversation_messages_workspace_ref_unique").on(table.workspaceId, table.messageRef),
  uniqueIndex("orchestrator_conversation_messages_sequence_unique")
    .on(table.workspaceId, table.conversationRef, table.messageNumber),
  index("orchestrator_conversation_messages_turn_idx").on(table.workspaceId, table.turnRef, table.messageNumber),
  foreignKey({
    columns: [table.workspaceId, table.conversationRef, table.turnRef],
    foreignColumns: [orchestratorConversationTurns.workspaceId,
      orchestratorConversationTurns.conversationRef, orchestratorConversationTurns.turnRef],
    name: "orchestrator_conversation_messages_workspace_turn_fk",
  }).onDelete("cascade"),
  check("orchestrator_conversation_messages_identity", sql`
    ${table.messageRef} ~ '^message_[a-f0-9]{32}$'
    and ${table.messageNumber} between 1 and 2000000
    and ${table.role} in ('user', 'assistant')
    and length(${table.content}) between 1 and 30000
  `),
]);

/** Explicit erasure marker; the transcript remains immutable until workspace purge. */
export const orchestratorConversationTombstones = pgTable("orchestrator_conversation_tombstones", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  conversationRef: text("conversation_ref").notNull(),
  tombstoneRef: text("tombstone_ref").notNull(),
  userId: uuid("user_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("orchestrator_conversation_tombstones_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("orchestrator_conversation_tombstones_workspace_ref_unique")
    .on(table.workspaceId, table.tombstoneRef),
  uniqueIndex("orchestrator_conversation_tombstones_conversation_unique")
    .on(table.workspaceId, table.conversationRef),
  foreignKey({
    columns: [table.workspaceId, table.conversationRef],
    foreignColumns: [orchestratorConversations.workspaceId, orchestratorConversations.conversationRef],
    name: "orchestrator_conversation_tombstones_workspace_conversation_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.userId],
    foreignColumns: [memberships.workspaceId, memberships.userId],
    name: "orchestrator_conversation_tombstones_workspace_membership_fk",
  }).onDelete("cascade"),
  check("orchestrator_conversation_tombstones_identity", sql`
    ${table.tombstoneRef} ~ '^tombstone_[a-f0-9]{32}$'
    and ${table.reason} = 'operator_requested'
  `),
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
  uniqueIndex("meta_ad_sets_workspace_hierarchy_unique")
    .on(table.workspaceId, table.id, table.campaignId, table.adAccountId),
  index("meta_ad_sets_workspace_campaign_idx").on(table.workspaceId, table.campaignId),
]);

/** Immutable canonical affected-geo observation header; contains hashes and refs only, never raw targeting. */
export const metaAffectedGeoSnapshots = pgTable("meta_affected_geo_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  adSetId: uuid("ad_set_id").notNull(),
  workspaceRef: text("workspace_ref").notNull(),
  accountRef: text("account_ref").notNull(),
  campaignRef: text("campaign_ref").notNull(),
  adSetRef: text("ad_set_ref").notNull(),
  schemaVersion: text("schema_version").notNull(),
  sourceKind: text("source_kind").notNull(),
  status: text("status").notNull(),
  sourceGraphVersion: text("source_graph_version").notNull(),
  fieldCatalogVersion: text("field_catalog_version").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  observationRunRef: text("observation_run_ref").notNull(),
  sliceRef: text("slice_ref").notNull(),
  pageRef: text("page_ref").notNull(),
  rawPayloadHash: text("raw_payload_hash").notNull(),
  sourceGeoSubtreeHash: text("source_geo_subtree_hash").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  itemCount: integer("item_count").notNull(),
  locationTypeCount: integer("location_type_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_affected_geo_snapshots_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("meta_affected_geo_snapshots_workspace_hash_unique").on(table.workspaceId, table.snapshotHash),
  uniqueIndex("meta_affected_geo_snapshots_exact_source_unique").on(
    table.workspaceId, table.adSetId, table.capturedAt, table.rawPayloadHash, table.sourceGeoSubtreeHash,
    table.sourceGraphVersion, table.fieldCatalogVersion,
  ),
  index("meta_affected_geo_snapshots_scope_time_idx")
    .on(table.workspaceId, table.adAccountId, table.campaignId, table.adSetId, table.capturedAt),
  foreignKey({
    columns: [table.workspaceId, table.adSetId, table.campaignId, table.adAccountId],
    foreignColumns: [metaAdSets.workspaceId, metaAdSets.id, metaAdSets.campaignId, metaAdSets.adAccountId],
    name: "meta_affected_geo_snapshots_workspace_hierarchy_fk",
  }).onDelete("cascade"),
  check("meta_affected_geo_snapshots_contract", sql`
    ${table.schemaVersion} = 'meta-affected-geo-country-snapshot/1.0.0'
    and ${table.sourceKind} = 'canonical_meta_affected_geo_snapshot'
    and ${table.status} = 'known'
    and ${table.sourceGraphVersion} = 'v23.0'
    and ${table.fieldCatalogVersion} ~ '^[A-Za-z0-9][A-Za-z0-9./_-]{0,127}$'
    and ${table.itemCount} between 1 and 250
    and ${table.locationTypeCount} between 1 and 2
  `),
  check("meta_affected_geo_snapshots_refs", sql`
    ${table.workspaceRef} ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.accountRef} ~ '^account_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.campaignRef} ~ '^campaign_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.adSetRef} ~ '^adset_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.observationRunRef} ~ '^observation_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.sliceRef} ~ '^slice_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.pageRef} ~ '^page_[a-z0-9][a-z0-9_.:-]{0,126}$'
  `),
  check("meta_affected_geo_snapshots_hashes", sql`
    ${table.rawPayloadHash} ~ '^[a-f0-9]{64}$'
    and ${table.sourceGeoSubtreeHash} ~ '^[a-f0-9]{64}$'
    and ${table.snapshotHash} ~ '^[a-f0-9]{64}$'
  `),
]);

/** Canonical included geo refs only; country codes, names, addresses and coordinates never enter this table. */
export const metaAffectedGeoSnapshotItems = pgTable("meta_affected_geo_snapshot_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  snapshotId: uuid("snapshot_id").notNull(),
  polarity: text("polarity").notNull(),
  geoType: text("geo_type").notNull(),
  geoRef: text("geo_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_affected_geo_snapshot_items_identity_unique")
    .on(table.workspaceId, table.snapshotId, table.polarity, table.geoType, table.geoRef),
  index("meta_affected_geo_snapshot_items_workspace_snapshot_idx").on(table.workspaceId, table.snapshotId),
  foreignKey({
    columns: [table.workspaceId, table.snapshotId],
    foreignColumns: [metaAffectedGeoSnapshots.workspaceId, metaAffectedGeoSnapshots.id],
    name: "meta_affected_geo_snapshot_items_workspace_snapshot_fk",
  }).onDelete("cascade"),
  check("meta_affected_geo_snapshot_items_contract", sql`
    ${table.polarity} = 'included' and ${table.geoType} = 'country'
    and ${table.geoRef} ~ '^geo_[a-f0-9]{64}$'
  `),
]);

/** Verified location-type vocabulary is kept separately from geo identity items. */
export const metaAffectedGeoSnapshotLocationTypes = pgTable("meta_affected_geo_snapshot_location_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  snapshotId: uuid("snapshot_id").notNull(),
  locationType: text("location_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_affected_geo_snapshot_location_types_identity_unique")
    .on(table.workspaceId, table.snapshotId, table.locationType),
  index("meta_affected_geo_snapshot_location_types_workspace_snapshot_idx").on(table.workspaceId, table.snapshotId),
  foreignKey({
    columns: [table.workspaceId, table.snapshotId],
    foreignColumns: [metaAffectedGeoSnapshots.workspaceId, metaAffectedGeoSnapshots.id],
    name: "meta_affected_geo_snapshot_location_types_workspace_snapshot_fk",
  }).onDelete("cascade"),
  check("meta_affected_geo_snapshot_location_types_contract", sql`${table.locationType} in ('home', 'recent')`),
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
  uniqueIndex("meta_assets_id_workspace_unique").on(table.id, table.workspaceId),
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
  // Historical snapshot refs use 20 hex chars; L2 daily-observation refs bind
  // the full 32-char content-hash prefix. Both are immutable public aliases.
  check("meta_change_snapshots_public_ref_format", sql`${table.publicRef} ~ '^snapshot_[a-f0-9]{20}([a-f0-9]{12})?$'`),
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
  uniqueIndex("meta_creatives_workspace_id_unique").on(table.workspaceId, table.id),
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
  uniqueIndex("meta_ads_workspace_id_unique").on(table.workspaceId, table.id),
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
  uniqueIndex("category_definitions_workspace_id_unique").on(table.workspaceId, table.id),
  index("category_definitions_dimension_archive_idx").on(table.dimensionId, table.archivedAt),
  check("category_definitions_key_format", sql`${table.key} ~ '^[a-z][a-z0-9_]{0,63}$'`),
  check("category_definitions_version_positive", sql`${table.version} >= 1`),
]);

/** Immutable CategoryProfile revisions; references are advisory inputs and never action authority. */
export const categoryProfileRevisions = pgTable("category_profile_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  categoryDefinitionId: uuid("category_definition_id").notNull(),
  parentCategoryDefinitionId: uuid("parent_category_definition_id"),
  workspaceRef: text("workspace_ref").notNull(),
  profileRef: text("profile_ref").notNull(),
  categoryRef: text("category_ref").notNull(),
  parentCategoryRef: text("parent_category_ref"),
  schemaVersion: text("schema_version").notNull(),
  version: integer("version").notNull(),
  previousProfileHash: text("previous_profile_hash"),
  label: text("label").notNull(),
  description: text("description").notNull(),
  color: text("color").notNull(),
  ownerRef: text("owner_ref").notNull(),
  status: text("status").notNull(),
  profileHash: text("profile_hash").notNull(),
  profilePayload: jsonb("profile_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.categoryDefinitionId],
    foreignColumns: [categoryDefinitions.workspaceId, categoryDefinitions.id],
    name: "category_profile_revisions_definition_scope_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.workspaceId, table.parentCategoryDefinitionId],
    foreignColumns: [categoryDefinitions.workspaceId, categoryDefinitions.id],
    name: "category_profile_revisions_parent_scope_fk",
  }).onDelete("restrict"),
  uniqueIndex("category_profile_revisions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("category_profile_revisions_workspace_profile_version_unique")
    .on(table.workspaceId, table.profileRef, table.version),
  uniqueIndex("category_profile_revisions_workspace_definition_version_unique")
    .on(table.workspaceId, table.categoryDefinitionId, table.version),
  uniqueIndex("category_profile_revisions_workspace_hash_unique").on(table.workspaceId, table.profileHash),
  index("category_profile_revisions_latest_idx").on(table.workspaceId, table.profileRef, table.version),
  index("category_profile_revisions_definition_idx").on(table.workspaceId, table.categoryDefinitionId, table.version),
  check("category_profile_revisions_identity", sql`
    ${table.schemaVersion} = 'category-profile/1.0.0'
    and ${table.version} between 1 and 1000000
    and ${table.workspaceRef} ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.profileRef} ~ '^category_profile_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.categoryRef} ~ '^category_[a-f0-9]{24}$'
    and (${table.parentCategoryRef} is null or ${table.parentCategoryRef} ~ '^category_[a-f0-9]{24}$')
    and ((${table.parentCategoryDefinitionId} is null and ${table.parentCategoryRef} is null)
      or (${table.parentCategoryDefinitionId} is not null and ${table.parentCategoryRef} is not null))
    and ${table.categoryDefinitionId} is distinct from ${table.parentCategoryDefinitionId}
    and ${table.ownerRef} ~ '^actor_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.color} ~ '^#[0-9A-F]{6}$'
    and ${table.profileHash} ~ '^[a-f0-9]{64}$'
    and ((${table.version} = 1 and ${table.previousProfileHash} is null)
      or (${table.version} > 1 and ${table.previousProfileHash} ~ '^[a-f0-9]{64}$'))
    and ${table.status} in ('draft', 'active', 'paused', 'archived')
  `),
  check("category_profile_revisions_payload_exact", sql`(
    jsonb_typeof(${table.profilePayload}) = 'object'
    and ${table.profilePayload} #>> '{schemaVersion}' = ${table.schemaVersion}
    and ${table.profilePayload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.profilePayload} #>> '{profileRef}' = ${table.profileRef}
    and ${table.profilePayload} #>> '{categoryRef}' = ${table.categoryRef}
    and (${table.profilePayload} #>> '{parentCategoryRef}') is not distinct from ${table.parentCategoryRef}
    and (${table.profilePayload} #>> '{version}')::integer = ${table.version}
    and (${table.profilePayload} #>> '{previousProfileHash}') is not distinct from ${table.previousProfileHash}
    and ${table.profilePayload} #>> '{label}' = ${table.label}
    and ${table.profilePayload} #>> '{description}' = ${table.description}
    and ${table.profilePayload} #>> '{color}' = ${table.color}
    and ${table.profilePayload} #>> '{ownerRef}' = ${table.ownerRef}
    and ${table.profilePayload} #>> '{status}' = ${table.status}
    and ${table.profilePayload} #>> '{profileHash}' = ${table.profileHash}
    and ${table.profilePayload} #> '{authority,canAuthorizeAction}' = 'false'::jsonb
    and ${table.profilePayload} #> '{authority,canExecuteWrite}' = 'false'::jsonb
    and ${table.profilePayload} #> '{authority,canWriteMeta}' = 'false'::jsonb
    and ${table.profilePayload} #> '{authority,canGrantApproval}' = 'false'::jsonb
  ) is true`),
  check("category_profile_revisions_bindings", sql`(
    jsonb_typeof(${table.profilePayload} #> '{bindings}') = 'object'
    and jsonb_typeof(${table.profilePayload} #> '{bindings,analysisPlaybookRefs}') = 'array'
    and jsonb_array_length(${table.profilePayload} #> '{bindings,analysisPlaybookRefs}') between 1 and 64
    and jsonb_typeof(${table.profilePayload} #> '{bindings,ruleInstructionBundleRefs}') = 'array'
    and jsonb_array_length(${table.profilePayload} #> '{bindings,ruleInstructionBundleRefs}') <= 64
    and jsonb_typeof(${table.profilePayload} #> '{bindings,budgetPolicyRefs}') = 'array'
    and jsonb_array_length(${table.profilePayload} #> '{bindings,budgetPolicyRefs}') <= 64
    and jsonb_typeof(${table.profilePayload} #> '{bindings,transferPolicyRefs}') = 'array'
    and jsonb_array_length(${table.profilePayload} #> '{bindings,transferPolicyRefs}') <= 64
    and jsonb_typeof(${table.profilePayload} #> '{bindings,schedulePolicyRefs}') = 'array'
    and jsonb_array_length(${table.profilePayload} #> '{bindings,schedulePolicyRefs}') <= 64
    and jsonb_typeof(${table.profilePayload} #> '{bindings,actionPolicyRefs}') = 'array'
    and jsonb_array_length(${table.profilePayload} #> '{bindings,actionPolicyRefs}') <= 64
    and jsonb_typeof(${table.profilePayload} #> '{bindings,creativePolicyRefs}') = 'array'
    and jsonb_array_length(${table.profilePayload} #> '{bindings,creativePolicyRefs}') <= 64
    and not jsonb_path_exists(${table.profilePayload}, '$.bindings.analysisPlaybookRefs[*] ? (!(@ like_regex "^analysis_playbook_[a-z0-9][a-z0-9_.:-]{0,126}$"))')
    and not jsonb_path_exists(${table.profilePayload}, '$.bindings.ruleInstructionBundleRefs[*] ? (!(@ like_regex "^(instruction_bundle_|rule_bundle_)[a-z0-9][a-z0-9_.:-]{0,126}$"))')
    and not jsonb_path_exists(${table.profilePayload}, '$.bindings.budgetPolicyRefs[*] ? (!(@ like_regex "^(budget_policy_|budget_envelope_)[a-z0-9][a-z0-9_.:-]{0,126}$"))')
    and not jsonb_path_exists(${table.profilePayload}, '$.bindings.transferPolicyRefs[*] ? (!(@ like_regex "^transfer_policy_[a-z0-9][a-z0-9_.:-]{0,126}$"))')
    and not jsonb_path_exists(${table.profilePayload}, '$.bindings.schedulePolicyRefs[*] ? (!(@ like_regex "^(schedule_policy_|cadence_profile_)[a-z0-9][a-z0-9_.:-]{0,126}$"))')
    and not jsonb_path_exists(${table.profilePayload}, '$.bindings.actionPolicyRefs[*] ? (!(@ like_regex "^(action_policy_|approval_policy_|guardrail_|autonomy_rule_)[a-z0-9][a-z0-9_.:-]{0,126}$"))')
    and not jsonb_path_exists(${table.profilePayload}, '$.bindings.creativePolicyRefs[*] ? (!(@ like_regex "^creative_policy_[a-z0-9][a-z0-9_.:-]{0,126}$"))')
  ) is true`),
  check("category_profile_revisions_no_forbidden_material", sql`
    ${table.profilePayload}::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|authorization|approvalgranted)"[[:space:]]*:'
    and ${table.profilePayload}::text !~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
    and ${table.profilePayload}::text !~* '"(canAuthorizeAction|canExecuteWrite|canWriteMeta|canGrantApproval)"[[:space:]]*:[[:space:]]*true'
  `),
]);

/** Server-private raw instruction capture. Raw text never enters public policy projections. */
export const instructionPolicyRawProvenance = pgTable("instruction_policy_raw_provenance", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  workspaceRef: text("workspace_ref").notNull(),
  provenanceRef: text("provenance_ref").notNull(),
  rawText: text("raw_text").notNull(),
  rawTextHash: text("raw_text_hash").notNull(),
  capturedByActorRef: text("captured_by_actor_ref").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("instruction_policy_raw_provenance_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("instruction_policy_raw_provenance_workspace_ref_unique").on(table.workspaceId, table.provenanceRef),
  index("instruction_policy_raw_provenance_workspace_captured_idx").on(table.workspaceId, table.capturedAt),
  check("instruction_policy_raw_provenance_identity", sql`
    ${table.workspaceRef} ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.provenanceRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.capturedByActorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.rawTextHash} ~ '^[a-f0-9]{64}$'
    and length(${table.rawText}) between 1 and 16000 and btrim(${table.rawText}) <> ''
  `),
]);

/** Append-only strict policy revisions. The JSONB artifact is normalized, public-safe and authority-free. */
export const strictInstructionPolicyRevisions = pgTable("strict_instruction_policy_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  rawProvenanceId: uuid("raw_provenance_id").notNull(),
  workspaceRef: text("workspace_ref").notNull(),
  policyRef: text("policy_ref").notNull(),
  policyVersion: integer("policy_version").notNull(),
  previousVersionHash: text("previous_version_hash"),
  policyType: text("policy_type").notNull(),
  status: text("status").notNull(),
  rawProvenanceRef: text("raw_provenance_ref").notNull(),
  rawTextHash: text("raw_text_hash").notNull(),
  actorRef: text("actor_ref").notNull(),
  actorRole: text("actor_role").notNull(),
  canonicalHash: text("canonical_hash").notNull(),
  policyPayload: jsonb("policy_payload").$type<Record<string, unknown>>().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.rawProvenanceId],
    foreignColumns: [instructionPolicyRawProvenance.workspaceId, instructionPolicyRawProvenance.id],
    name: "strict_instruction_policy_revisions_provenance_scope_fk",
  }).onDelete("restrict"),
  uniqueIndex("strict_instruction_policy_revisions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("strict_instruction_policy_revisions_workspace_version_unique")
    .on(table.workspaceId, table.policyRef, table.policyVersion),
  uniqueIndex("strict_instruction_policy_revisions_workspace_hash_unique").on(table.workspaceId, table.canonicalHash),
  index("strict_instruction_policy_revisions_current_idx")
    .on(table.workspaceId, table.policyRef, table.policyVersion),
  index("strict_instruction_policy_revisions_provenance_idx").on(table.rawProvenanceId),
  check("strict_instruction_policy_revisions_identity", sql`
    ${table.workspaceRef} ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.policyRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.rawProvenanceRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.actorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.policyVersion} between 1 and 1000000
    and ((${table.policyVersion} = 1 and ${table.previousVersionHash} is null)
      or (${table.policyVersion} > 1 and ${table.previousVersionHash} ~ '^[a-f0-9]{64}$'))
    and ${table.rawTextHash} ~ '^[a-f0-9]{64}$' and ${table.canonicalHash} ~ '^[a-f0-9]{64}$'
    and ${table.policyType} in ('hard_constraint', 'target', 'preference', 'exception', 'prohibition', 'approval', 'schedule')
    and ${table.status} in ('draft', 'published', 'paused', 'archived')
    and ${table.actorRole} in ('owner', 'admin', 'analyst')
  `),
  check("strict_instruction_policy_revisions_payload_exact", sql`(
    jsonb_typeof(${table.policyPayload}) = 'object'
    and ${table.policyPayload} #>> '{dslVersion}' = 'strict-instruction-policy/1.0.0'
    and ${table.policyPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.policyPayload} #>> '{policyRef}' = ${table.policyRef}
    and (${table.policyPayload} #>> '{policyVersion}')::integer = ${table.policyVersion}
    and (${table.policyPayload} #>> '{previousVersionHash}') is not distinct from ${table.previousVersionHash}
    and ${table.policyPayload} #>> '{policyType}' = ${table.policyType}
    and ${table.policyPayload} #>> '{status}' = ${table.status}
    and ${table.policyPayload} #>> '{source,rawProvenanceRef}' = ${table.rawProvenanceRef}
    and ${table.policyPayload} #>> '{source,rawTextHash}' = ${table.rawTextHash}
    and ${table.policyPayload} #>> '{canonicalHash}' = ${table.canonicalHash}
    and ${table.policyPayload} #> '{authority,canExecute}' = 'false'::jsonb
    and ${table.policyPayload} #> '{authority,canWriteMeta}' = 'false'::jsonb
    and ${table.policyPayload} #> '{authority,canApprove}' = 'false'::jsonb
    and ${table.policyPayload} #> '{authority,canSchedule}' = 'false'::jsonb
    and ${table.policyPayload} #> '{authority,canCallTool}' = 'false'::jsonb
    and ${table.policyPayload} #> '{authority,canAccessNetwork}' = 'false'::jsonb
    and ${table.policyPayload} #> '{authority,canQuerySql}' = 'false'::jsonb
  ) is true`),
  check("strict_instruction_policy_revisions_no_raw_text", sql`
    not (${table.policyPayload} ? 'rawText')
    and not jsonb_path_exists(${table.policyPayload}, '$.**.rawText')
    and ${table.policyPayload}::text !~* '"(token|secret|authorization|approvalgranted)"[[:space:]]*:'
  `),
]);

/** Repository-verified, tenant-scoped provenance for authority-free policy composition. */
export const tenantAuthoritySnapshots = pgTable("tenant_authority_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  snapshotRef: text("snapshot_ref").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  repositoryRef: text("repository_ref").notNull(),
  repositoryRevision: text("repository_revision").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  snapshotPayload: jsonb("snapshot_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tenant_authority_snapshots_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("tenant_authority_snapshots_workspace_ref_unique").on(table.workspaceId, table.snapshotRef),
  uniqueIndex("tenant_authority_snapshots_workspace_hash_unique").on(table.workspaceId, table.snapshotHash),
  index("tenant_authority_snapshots_verified_idx").on(table.workspaceId, table.verifiedAt),
  check("tenant_authority_snapshots_identity", sql`${table.snapshotRef} ~ '^authority_snapshot_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.snapshotHash} ~ '^[a-f0-9]{64}$' and ${table.repositoryRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and btrim(${table.repositoryRevision}) <> '' and ${table.expiresAt} > ${table.verifiedAt}`),
  check("tenant_authority_snapshots_exact", sql`(${table.snapshotPayload} #>> '{schemaVersion}' = 'tenant-authority-snapshot/1.0.0' and ${table.snapshotPayload} #>> '{snapshotRef}' = ${table.snapshotRef} and ${table.snapshotPayload} #>> '{snapshotHash}' = ${table.snapshotHash} and ${table.snapshotPayload} #>> '{repository,ref}' = ${table.repositoryRef} and ${table.snapshotPayload} #>> '{repository,revision}' = ${table.repositoryRevision} and ${table.snapshotPayload} #> '{repository,verified}' = 'true'::jsonb and ${table.snapshotPayload} #> '{authority,productionAuthoritySourceBound}' = 'false'::jsonb and ${table.snapshotPayload} #> '{authority,canPublish}' = 'false'::jsonb and ${table.snapshotPayload} #> '{authority,canApprove}' = 'false'::jsonb and ${table.snapshotPayload} #> '{authority,canExecute}' = 'false'::jsonb and ${table.snapshotPayload} #> '{authority,canWriteMeta}' = 'false'::jsonb) is true`),
]);

/** Deterministic, OCC-protected current snapshot pointer; historical snapshots remain immutable. */
export const tenantAuthoritySnapshotHeads = pgTable("tenant_authority_snapshot_heads", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  currentSnapshotId: uuid("current_snapshot_id").notNull(), currentSnapshotHash: text("current_snapshot_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.currentSnapshotId], foreignColumns: [tenantAuthoritySnapshots.workspaceId, tenantAuthoritySnapshots.id], name: "tenant_authority_snapshot_heads_snapshot_scope_fk" }).onDelete("restrict"),
  index("tenant_authority_snapshot_heads_current_idx").on(table.workspaceId, table.currentSnapshotId),
  check("tenant_authority_snapshot_heads_hash", sql`${table.currentSnapshotHash} ~ '^[a-f0-9]{64}$'`),
]);

/** Append-only tenant-local account-group ledger and exact account membership. */
export const accountGroups = pgTable("account_groups", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), groupRef: text("group_ref").notNull(), currentRevision: integer("current_revision").notNull().default(0), currentRevisionHash: text("current_revision_hash"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("account_groups_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("account_groups_workspace_ref_unique").on(table.workspaceId, table.groupRef),
  check("account_groups_identity", sql`${table.groupRef} ~ '^account_group_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.currentRevision} >= 0 and ((${table.currentRevision} = 0 and ${table.currentRevisionHash} is null) or (${table.currentRevision} > 0 and ${table.currentRevisionHash} ~ '^[a-f0-9]{64}$'))`),
]);

export const accountGroupRevisions = pgTable("account_group_revisions", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), accountGroupId: uuid("account_group_id").notNull(),
  groupRef: text("group_ref").notNull(), revision: integer("revision").notNull(), previousRevisionHash: text("previous_revision_hash"), revisionHash: text("revision_hash").notNull(), status: text("status").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.accountGroupId], foreignColumns: [accountGroups.workspaceId, accountGroups.id], name: "account_group_revisions_group_scope_fk" }).onDelete("restrict"), uniqueIndex("account_group_revisions_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("account_group_revisions_workspace_version_unique").on(table.workspaceId, table.groupRef, table.revision), uniqueIndex("account_group_revisions_workspace_hash_unique").on(table.workspaceId, table.revisionHash), index("account_group_revisions_head_idx").on(table.workspaceId, table.groupRef, table.revision),
  check("account_group_revisions_identity", sql`${table.groupRef} ~ '^account_group_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.revision} between 1 and 1000000 and ((${table.revision} = 1 and ${table.previousRevisionHash} is null) or (${table.revision} > 1 and ${table.previousRevisionHash} ~ '^[a-f0-9]{64}$')) and ${table.revisionHash} ~ '^[a-f0-9]{64}$' and ${table.status} in ('draft', 'active', 'archived')`),
  check("account_group_revisions_no_authority", sql`${table.payload} #> '{authority,canPublish}' = 'false'::jsonb and ${table.payload} #> '{authority,canApprove}' = 'false'::jsonb and ${table.payload} #> '{authority,canExecute}' = 'false'::jsonb and ${table.payload} #> '{authority,canWriteMeta}' = 'false'::jsonb`),
]);

export const accountGroupAccountBindings = pgTable("account_group_account_bindings", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), accountGroupRevisionId: uuid("account_group_revision_id").notNull(), adAccountId: uuid("ad_account_id").notNull(), bindingRef: text("binding_ref").notNull(), bindingHash: text("binding_hash").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.accountGroupRevisionId], foreignColumns: [accountGroupRevisions.workspaceId, accountGroupRevisions.id], name: "account_group_account_bindings_revision_scope_fk" }).onDelete("restrict"), foreignKey({ columns: [table.workspaceId, table.adAccountId], foreignColumns: [adAccounts.workspaceId, adAccounts.id], name: "account_group_account_bindings_account_scope_fk" }).onDelete("restrict"), uniqueIndex("account_group_account_bindings_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("account_group_account_bindings_exact_unique").on(table.accountGroupRevisionId, table.adAccountId), index("account_group_account_bindings_account_idx").on(table.workspaceId, table.adAccountId), check("account_group_account_bindings_identity", sql`${table.bindingRef} ~ '^account_group_binding_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.bindingHash} ~ '^[a-f0-9]{64}$'`),
]);

/** Tenant-owned topic ledger; authority scopes resolve revisions, never free-form topic text. */
export const authorityTopics = pgTable("authority_topics", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), topicRef: text("topic_ref").notNull(), currentRevision: integer("current_revision").notNull().default(0), currentRevisionHash: text("current_revision_hash"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("authority_topics_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("authority_topics_workspace_ref_unique").on(table.workspaceId, table.topicRef), check("authority_topics_identity", sql`${table.topicRef} ~ '^topic_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.currentRevision} >= 0 and ((${table.currentRevision} = 0 and ${table.currentRevisionHash} is null) or (${table.currentRevision} > 0 and ${table.currentRevisionHash} ~ '^[a-f0-9]{64}$'))`),
]);
export const authorityTopicRevisions = pgTable("authority_topic_revisions", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), topicId: uuid("topic_id").notNull(), topicRef: text("topic_ref").notNull(), revision: integer("revision").notNull(), previousRevisionHash: text("previous_revision_hash"), revisionHash: text("revision_hash").notNull(), status: text("status").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.topicId], foreignColumns: [authorityTopics.workspaceId, authorityTopics.id], name: "authority_topic_revisions_topic_scope_fk" }).onDelete("restrict"), uniqueIndex("authority_topic_revisions_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("authority_topic_revisions_workspace_version_unique").on(table.workspaceId, table.topicRef, table.revision), uniqueIndex("authority_topic_revisions_workspace_hash_unique").on(table.workspaceId, table.revisionHash), index("authority_topic_revisions_head_idx").on(table.workspaceId, table.topicRef, table.revision), check("authority_topic_revisions_identity", sql`${table.topicRef} ~ '^topic_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.revision} between 1 and 1000000 and ((${table.revision} = 1 and ${table.previousRevisionHash} is null) or (${table.revision} > 1 and ${table.previousRevisionHash} ~ '^[a-f0-9]{64}$')) and ${table.revisionHash} ~ '^[a-f0-9]{64}$' and ${table.status} in ('active', 'archived')`), check("authority_topic_revisions_no_authority", sql`${table.payload} #> '{authority,canPublish}' = 'false'::jsonb and ${table.payload} #> '{authority,canApprove}' = 'false'::jsonb and ${table.payload} #> '{authority,canExecute}' = 'false'::jsonb and ${table.payload} #> '{authority,canWriteMeta}' = 'false'::jsonb`),
]);
export const categoryTopicBindings = pgTable("category_topic_bindings", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), categoryDefinitionId: uuid("category_definition_id").notNull(), topicRevisionId: uuid("topic_revision_id").notNull(), bindingRef: text("binding_ref").notNull(), bindingHash: text("binding_hash").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.categoryDefinitionId], foreignColumns: [categoryDefinitions.workspaceId, categoryDefinitions.id], name: "category_topic_bindings_category_scope_fk" }).onDelete("restrict"), foreignKey({ columns: [table.workspaceId, table.topicRevisionId], foreignColumns: [authorityTopicRevisions.workspaceId, authorityTopicRevisions.id], name: "category_topic_bindings_topic_scope_fk" }).onDelete("restrict"), uniqueIndex("category_topic_bindings_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("category_topic_bindings_exact_unique").on(table.categoryDefinitionId, table.topicRevisionId), index("category_topic_bindings_topic_lookup_idx").on(table.workspaceId, table.topicRevisionId), check("category_topic_bindings_identity", sql`${table.bindingRef} ~ '^category_topic_binding_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.bindingHash} ~ '^[a-f0-9]{64}$'`),
]);
export const policySemanticBindingRevisions = pgTable("policy_semantic_binding_revisions", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), policyRevisionId: uuid("policy_revision_id").notNull(), semanticRef: text("semantic_ref").notNull(), revision: integer("revision").notNull(), previousRevisionHash: text("previous_revision_hash"), revisionHash: text("revision_hash").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.policyRevisionId], foreignColumns: [strictInstructionPolicyRevisions.workspaceId, strictInstructionPolicyRevisions.id], name: "policy_semantic_binding_revisions_policy_scope_fk" }).onDelete("restrict"), uniqueIndex("policy_semantic_binding_revisions_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("policy_semantic_binding_revisions_exact_unique").on(table.policyRevisionId, table.semanticRef, table.revision), uniqueIndex("policy_semantic_binding_revisions_workspace_hash_unique").on(table.workspaceId, table.revisionHash), index("policy_semantic_binding_revisions_lookup_idx").on(table.workspaceId, table.semanticRef, table.revision), check("policy_semantic_binding_revisions_identity", sql`${table.semanticRef} ~ '^semantic_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.revision} between 1 and 1000000 and ((${table.revision} = 1 and ${table.previousRevisionHash} is null) or (${table.revision} > 1 and ${table.previousRevisionHash} ~ '^[a-f0-9]{64}$')) and ${table.revisionHash} ~ '^[a-f0-9]{64}$'`), check("policy_semantic_binding_revisions_no_authority", sql`${table.payload} #> '{authority,canPublish}' = 'false'::jsonb and ${table.payload} #> '{authority,canApprove}' = 'false'::jsonb and ${table.payload} #> '{authority,canExecute}' = 'false'::jsonb and ${table.payload} #> '{authority,canWriteMeta}' = 'false'::jsonb`),
]);

/** Exact policy authority-tier/decision/account-group/topic/semantic bindings. */
export const policyAuthorityCatalogRevisions = pgTable("policy_authority_catalog_revisions", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), catalogRef: text("catalog_ref").notNull(), revision: integer("revision").notNull(), previousRevisionHash: text("previous_revision_hash"), revisionHash: text("revision_hash").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("policy_authority_catalog_revisions_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("policy_authority_catalog_revisions_version_unique").on(table.workspaceId, table.catalogRef, table.revision), uniqueIndex("policy_authority_catalog_revisions_hash_unique").on(table.workspaceId, table.revisionHash),
  check("policy_authority_catalog_revisions_identity", sql`${table.catalogRef} ~ '^authority_catalog_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.revision} >= 1 and ((${table.revision} = 1 and ${table.previousRevisionHash} is null) or (${table.revision} > 1 and ${table.previousRevisionHash} ~ '^[a-f0-9]{64}$')) and ${table.revisionHash} ~ '^[a-f0-9]{64}$'`), check("policy_authority_catalog_revisions_no_authority", sql`${table.payload} #> '{authority,canPublish}' = 'false'::jsonb and ${table.payload} #> '{authority,canApprove}' = 'false'::jsonb and ${table.payload} #> '{authority,canExecute}' = 'false'::jsonb and ${table.payload} #> '{authority,canWriteMeta}' = 'false'::jsonb`),
]);

/** Deterministic, OCC-protected current catalog revision pointer. */
export const policyAuthorityCatalogs = pgTable("policy_authority_catalogs", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  catalogRef: text("catalog_ref").notNull(), currentRevision: integer("current_revision").notNull().default(0), currentRevisionHash: text("current_revision_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("policy_authority_catalogs_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("policy_authority_catalogs_workspace_ref_unique").on(table.workspaceId, table.catalogRef),
  check("policy_authority_catalogs_identity", sql`${table.catalogRef} ~ '^authority_catalog_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.currentRevision} >= 0 and ((${table.currentRevision} = 0 and ${table.currentRevisionHash} is null) or (${table.currentRevision} > 0 and ${table.currentRevisionHash} ~ '^[a-f0-9]{64}$'))`),
]);

export const policyAuthorityBindings = pgTable("policy_authority_bindings", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), policyRevisionId: uuid("policy_revision_id").notNull(), authoritySnapshotId: uuid("authority_snapshot_id").notNull(), authorityCatalogRevisionId: uuid("authority_catalog_revision_id").notNull(), authorityTierRef: text("authority_tier_ref").notNull(), decisionRef: text("decision_ref").notNull(), bindingKind: text("binding_kind").notNull(), bindingRef: text("binding_ref").notNull(), bindingVersion: text("binding_version").notNull(), bindingHash: text("binding_hash").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.policyRevisionId], foreignColumns: [strictInstructionPolicyRevisions.workspaceId, strictInstructionPolicyRevisions.id], name: "policy_authority_bindings_policy_scope_fk" }).onDelete("restrict"), foreignKey({ columns: [table.workspaceId, table.authoritySnapshotId], foreignColumns: [tenantAuthoritySnapshots.workspaceId, tenantAuthoritySnapshots.id], name: "policy_authority_bindings_snapshot_scope_fk" }).onDelete("restrict"), foreignKey({ columns: [table.workspaceId, table.authorityCatalogRevisionId], foreignColumns: [policyAuthorityCatalogRevisions.workspaceId, policyAuthorityCatalogRevisions.id], name: "policy_authority_bindings_catalog_scope_fk" }).onDelete("restrict"), uniqueIndex("policy_authority_bindings_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("policy_authority_bindings_snapshot_exact_unique").on(table.authoritySnapshotId, table.policyRevisionId, table.bindingKind, table.bindingRef, table.bindingVersion), index("policy_authority_bindings_lookup_idx").on(table.workspaceId, table.bindingKind, table.bindingRef, table.bindingVersion), check("policy_authority_bindings_kind", sql`${table.bindingKind} in ('account_group', 'topic', 'semantic')`), check("policy_authority_bindings_identity", sql`${table.authorityTierRef} ~ '^authority_tier_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.decisionRef} ~ '^decision_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.bindingRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and btrim(${table.bindingVersion}) <> '' and ${table.bindingHash} ~ '^[a-f0-9]{64}$'`),
]);

/**
 * Server-private G3 candidate proof. It is intentionally distinct from the
 * production authority catalog: a draft policy can be preview-bound, but
 * cannot become a production authority source through this ledger.
 */
export const candidatePreviewBindingRevisions = pgTable("candidate_preview_binding_revisions", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  formalizationRef: text("formalization_ref").notNull(), revision: integer("revision").notNull(), previousRevisionHash: text("previous_revision_hash").notNull(), revisionHash: text("revision_hash").notNull(), g2RevisionHash: text("g2_revision_hash").notNull(),
  guidanceSetId: uuid("guidance_set_id").notNull(), guidanceSetRef: text("guidance_set_ref").notNull(), guidanceSetVersion: integer("guidance_set_version").notNull(), guidanceSetHash: text("guidance_set_hash").notNull(),
  policyRevisionId: uuid("policy_revision_id").notNull(), policyRef: text("policy_ref").notNull(), policyVersion: integer("policy_version").notNull(), policyHash: text("policy_hash").notNull(),
  targetAccountId: uuid("target_account_id").notNull(), targetAccountRef: text("target_account_ref").notNull(),
  authoritySnapshotId: uuid("authority_snapshot_id").notNull(), authoritySnapshotRef: text("authority_snapshot_ref").notNull(), authoritySnapshotHash: text("authority_snapshot_hash").notNull(),
  authorityTier: text("authority_tier").notNull(), decision: jsonb("decision").$type<Readonly<{ decisionKey: string; positionKey: string }>>().notNull(),
  actorRef: text("actor_ref").notNull(), actorRole: text("actor_role").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.policyRevisionId], foreignColumns: [strictInstructionPolicyRevisions.workspaceId, strictInstructionPolicyRevisions.id], name: "candidate_preview_binding_revisions_policy_scope_fk" }).onDelete("restrict"), foreignKey({ columns: [table.workspaceId, table.targetAccountId], foreignColumns: [adAccounts.workspaceId, adAccounts.id], name: "candidate_preview_binding_revisions_account_scope_fk" }).onDelete("restrict"), foreignKey({ columns: [table.workspaceId, table.authoritySnapshotId], foreignColumns: [tenantAuthoritySnapshots.workspaceId, tenantAuthoritySnapshots.id], name: "candidate_preview_binding_revisions_snapshot_scope_fk" }).onDelete("restrict"),
  uniqueIndex("candidate_preview_binding_revisions_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("candidate_preview_binding_revisions_workspace_version_unique").on(table.workspaceId, table.formalizationRef, table.revision), uniqueIndex("candidate_preview_binding_revisions_workspace_hash_unique").on(table.workspaceId, table.revisionHash), index("candidate_preview_binding_revisions_lookup_idx").on(table.workspaceId, table.formalizationRef, table.policyRef, table.targetAccountRef),
  check("candidate_preview_binding_revisions_identity", sql`${table.formalizationRef} ~ '^formalization_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.revision} between 1 and 1000000 and ((${table.revision} = 1 and ${table.previousRevisionHash} = 'GENESIS') or (${table.revision} > 1 and ${table.previousRevisionHash} ~ '^[a-f0-9]{64}$')) and ${table.revisionHash} ~ '^[a-f0-9]{64}$' and ${table.g2RevisionHash} ~ '^[a-f0-9]{64}$' and ${table.guidanceSetRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.guidanceSetVersion} >= 1 and ${table.guidanceSetHash} ~ '^[a-f0-9]{64}$' and ${table.policyRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.policyVersion} between 1 and 1000000 and ${table.policyHash} ~ '^[a-f0-9]{64}$' and ${table.targetAccountRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.authoritySnapshotRef} ~ '^authority_snapshot_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.authoritySnapshotHash} ~ '^[a-f0-9]{64}$' and ${table.authorityTier} in ('platform_legal_tenant_safety', 'system_hard_safety', 'user_locked_instruction', 'budget_commitment', 'entity_exception', 'internal_category_playbook', 'meta_objective_playbook', 'metric_rule', 'agent_advice') and ${table.actorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.actorRole} in ('owner', 'admin')`),
  check("candidate_preview_binding_revisions_exact", sql`(${table.payload} #>> '{formalizationRef}' = ${table.formalizationRef} and (${table.payload} #>> '{revision}')::integer = ${table.revision} and ${table.payload} #>> '{previousRevisionHash}' = ${table.previousRevisionHash} and ${table.payload} #>> '{revisionHash}' = ${table.revisionHash} and ${table.payload} #>> '{g2RevisionHash}' = ${table.g2RevisionHash} and ${table.payload} #>> '{guidanceSet,ref}' = ${table.guidanceSetRef} and (${table.payload} #>> '{guidanceSet,version}')::integer = ${table.guidanceSetVersion} and ${table.payload} #>> '{guidanceSet,hash}' = ${table.guidanceSetHash} and ${table.payload} #>> '{policy,ref}' = ${table.policyRef} and (${table.payload} #>> '{policy,version}')::integer = ${table.policyVersion} and ${table.payload} #>> '{policy,hash}' = ${table.policyHash} and ${table.payload} #>> '{targetAccount,ref}' = ${table.targetAccountRef} and ${table.payload} #>> '{authoritySnapshot,ref}' = ${table.authoritySnapshotRef} and ${table.payload} #>> '{authoritySnapshot,hash}' = ${table.authoritySnapshotHash} and ${table.payload} #>> '{authorityTier}' = ${table.authorityTier} and ${table.payload} #>> '{decision,decisionKey}' = ${table.decision} #>> '{decisionKey}' and ${table.payload} #>> '{decision,positionKey}' = ${table.decision} #>> '{positionKey}' and ${table.payload} #> '{authority,canPublish}' = 'false'::jsonb and ${table.payload} #> '{authority,canApprove}' = 'false'::jsonb and ${table.payload} #> '{authority,canExecute}' = 'false'::jsonb and ${table.payload} #> '{authority,canWriteMeta}' = 'false'::jsonb) is true`),
  check("candidate_preview_binding_revisions_decision_exact", sql`(jsonb_typeof(${table.decision}) = 'object' and (${table.decision} - 'decisionKey' - 'positionKey') = '{}'::jsonb and ${table.decision} #>> '{decisionKey}' ~ '^[a-z][a-z0-9_.:-]{1,127}$' and ${table.decision} #>> '{positionKey}' ~ '^[a-z][a-z0-9_.:-]{1,127}$') is true`),
  check("candidate_preview_binding_revisions_authority_closed", sql`(${table.payload} #> '{authority,canPublish}' = 'false'::jsonb and ${table.payload} #> '{authority,canApprove}' = 'false'::jsonb and ${table.payload} #> '{authority,canExecute}' = 'false'::jsonb and ${table.payload} #> '{authority,canWriteMeta}' = 'false'::jsonb and ${table.payload} #> '{authority,canSchedule}' = 'false'::jsonb and ${table.payload} #> '{authority,canCallTool}' = 'false'::jsonb and ${table.payload} #> '{authority,canAccessNetwork}' = 'false'::jsonb and ${table.payload} #> '{authority,canQuerySql}' = 'false'::jsonb and (${table.payload} #> '{authority,productionAuthoritySourceBound}') is distinct from 'true'::jsonb) is true`),
]);

/** OCC pointer only; candidate evidence itself remains append-only above. */
export const candidatePreviewBindingHeads = pgTable("candidate_preview_binding_heads", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), formalizationRef: text("formalization_ref").notNull(), currentRevisionId: uuid("current_revision_id").notNull(), currentRevision: integer("current_revision").notNull(), currentRevisionHash: text("current_revision_hash").notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.currentRevisionId], foreignColumns: [candidatePreviewBindingRevisions.workspaceId, candidatePreviewBindingRevisions.id], name: "candidate_preview_binding_heads_revision_scope_fk" }).onDelete("restrict"), uniqueIndex("candidate_preview_binding_heads_workspace_formalization_unique").on(table.workspaceId, table.formalizationRef), uniqueIndex("candidate_preview_binding_heads_workspace_row_unique").on(table.workspaceId, table.currentRevisionId), check("candidate_preview_binding_heads_identity", sql`${table.formalizationRef} ~ '^formalization_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.currentRevision} >= 1 and ${table.currentRevisionHash} ~ '^[a-f0-9]{64}$'`),
]);

/** Replacements explicitly invalidate superseded candidate preview proofs. */
export const candidatePreviewBindingInvalidations = pgTable("candidate_preview_binding_invalidations", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), bindingRevisionId: uuid("binding_revision_id").notNull(), bindingRevisionHash: text("binding_revision_hash").notNull(), invalidatedByRevisionId: uuid("invalidated_by_revision_id").notNull(), invalidationHash: text("invalidation_hash").notNull(), observedAt: timestamp("observed_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.bindingRevisionId], foreignColumns: [candidatePreviewBindingRevisions.workspaceId, candidatePreviewBindingRevisions.id], name: "candidate_preview_binding_invalidations_binding_scope_fk" }).onDelete("restrict"), foreignKey({ columns: [table.workspaceId, table.invalidatedByRevisionId], foreignColumns: [candidatePreviewBindingRevisions.workspaceId, candidatePreviewBindingRevisions.id], name: "candidate_preview_binding_invalidations_successor_scope_fk" }).onDelete("restrict"), uniqueIndex("candidate_preview_binding_invalidations_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("candidate_preview_binding_invalidations_binding_unique").on(table.bindingRevisionId), index("candidate_preview_binding_invalidations_lookup_idx").on(table.workspaceId, table.bindingRevisionId), check("candidate_preview_binding_invalidations_identity", sql`${table.bindingRevisionHash} ~ '^[a-f0-9]{64}$' and ${table.invalidationHash} ~ '^[a-f0-9]{64}$'`),
]);

/** Manual locks can only be superseded by another immutable revision. */
export const policyManualLockRevisions = pgTable("policy_manual_lock_revisions", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), policyRevisionId: uuid("policy_revision_id").notNull(), lockRef: text("lock_ref").notNull(), actorRef: text("actor_ref").notNull(), actorRole: text("actor_role").notNull(), sequence: integer("sequence").notNull(), previousRevisionHash: text("previous_revision_hash"), revisionHash: text("revision_hash").notNull(), operation: text("operation").notNull(), reasonCode: text("reason_code").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.policyRevisionId], foreignColumns: [strictInstructionPolicyRevisions.workspaceId, strictInstructionPolicyRevisions.id], name: "policy_manual_lock_revisions_policy_scope_fk" }).onDelete("restrict"), uniqueIndex("policy_manual_lock_revisions_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("policy_manual_lock_revisions_sequence_unique").on(table.policyRevisionId, table.lockRef, table.sequence), uniqueIndex("policy_manual_lock_revisions_workspace_hash_unique").on(table.workspaceId, table.revisionHash), index("policy_manual_lock_revisions_head_idx").on(table.workspaceId, table.policyRevisionId, table.lockRef, table.sequence), check("policy_manual_lock_revisions_identity", sql`${table.lockRef} ~ '^manual_lock_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.actorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.actorRole} in ('owner', 'admin') and ${table.sequence} >= 1 and ((${table.sequence} = 1 and ${table.previousRevisionHash} is null) or (${table.sequence} > 1 and ${table.previousRevisionHash} ~ '^[a-f0-9]{64}$')) and ${table.revisionHash} ~ '^[a-f0-9]{64}$' and ${table.operation} in ('lock', 'unlock') and ${table.reasonCode} ~ '^[a-z][a-z0-9_]{2,63}$'`), check("policy_manual_lock_revisions_exact", sql`(${table.payload} #>> '{lockRef}' = ${table.lockRef} and ${table.payload} #>> '{actor,ref}' = ${table.actorRef} and ${table.payload} #>> '{actor,role}' = ${table.actorRole} and ${table.payload} #>> '{operation}' = ${table.operation} and ${table.payload} #>> '{revisionHash}' = ${table.revisionHash}) is true`), check("policy_manual_lock_revisions_no_authority", sql`${table.payload} #> '{authority,canPublish}' = 'false'::jsonb and ${table.payload} #> '{authority,canApprove}' = 'false'::jsonb and ${table.payload} #> '{authority,canExecute}' = 'false'::jsonb and ${table.payload} #> '{authority,canWriteMeta}' = 'false'::jsonb`),
]);

/** Immutable G0-G4 formalization events; maturity never carries action or Meta-write authority. */
export const progressiveFormalizationRevisions = pgTable("progressive_formalization_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  workspaceRef: text("workspace_ref").notNull(),
  formalizationRef: text("formalization_ref").notNull(),
  sequence: integer("sequence").notNull(),
  previousRevisionHash: text("previous_revision_hash").notNull(),
  fromLevel: text("from_level"),
  toLevel: text("to_level").notNull(),
  transition: text("transition").notNull(),
  actorRef: text("actor_ref").notNull(),
  actorRole: text("actor_role").notNull(),
  revisionHash: text("revision_hash").notNull(),
  revisionPayload: jsonb("revision_payload").$type<Record<string, unknown>>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("progressive_formalization_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("progressive_formalization_workspace_sequence_unique")
    .on(table.workspaceId, table.formalizationRef, table.sequence),
  uniqueIndex("progressive_formalization_workspace_hash_unique").on(table.workspaceId, table.revisionHash),
  index("progressive_formalization_workspace_head_idx")
    .on(table.workspaceId, table.formalizationRef, table.sequence),
  check("progressive_formalization_identity", sql`
    ${table.workspaceRef} ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.formalizationRef} ~ '^formalization_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.actorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.sequence} between 1 and 5
    and (${table.previousRevisionHash} = 'GENESIS' or ${table.previousRevisionHash} ~ '^[a-f0-9]{64}$')
  `),
  check("progressive_formalization_transition_exact", sql`
    (${table.sequence} = 1 and ${table.previousRevisionHash} = 'GENESIS' and ${table.fromLevel} is null
      and ${table.toLevel} = 'G0' and ${table.transition} = 'capture_g0')
    or (${table.sequence} = 2 and ${table.fromLevel} = 'G0' and ${table.toLevel} = 'G1'
      and ${table.transition} = 'scope_g1')
    or (${table.sequence} = 3 and ${table.fromLevel} = 'G1' and ${table.toLevel} = 'G2'
      and ${table.transition} = 'review_g2')
    or (${table.sequence} = 4 and ${table.fromLevel} = 'G2' and ${table.toLevel} = 'G3'
      and ${table.transition} = 'promote_g3')
    or (${table.sequence} = 5 and ${table.fromLevel} = 'G3' and ${table.toLevel} = 'G4'
      and ${table.transition} = 'qualify_g4')
  `),
  check("progressive_formalization_payload_exact", sql`(
    jsonb_typeof(${table.revisionPayload}) = 'object'
    and ${table.revisionPayload} #>> '{schemaVersion}' = 'progressive-formalization/1.0.0'
    and ${table.revisionPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.revisionPayload} #>> '{formalizationRef}' = ${table.formalizationRef}
    and (${table.revisionPayload} #>> '{sequence}')::integer = ${table.sequence}
    and ${table.revisionPayload} #>> '{previousRevisionHash}' = ${table.previousRevisionHash}
    and (${table.revisionPayload} #>> '{fromLevel}') is not distinct from ${table.fromLevel}
    and ${table.revisionPayload} #>> '{toLevel}' = ${table.toLevel}
    and ${table.revisionPayload} #>> '{transition}' = ${table.transition}
    and ${table.revisionPayload} #>> '{actor,actorRef}' = ${table.actorRef}
    and ${table.revisionPayload} #>> '{actor,role}' = ${table.actorRole}
    and ${table.revisionPayload} #>> '{revisionHash}' = ${table.revisionHash}
    and (${table.revisionPayload} #>> '{occurredAt}')::timestamptz = ${table.occurredAt}
    and ${table.actorRole} in ('owner', 'admin', 'analyst')
    and (${table.sequence} <= 2 or ${table.actorRole} in ('owner', 'admin'))
    and ${table.revisionHash} ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(${table.revisionPayload} #> '{payload}') = 'object'
    and ${table.revisionPayload} #> '{authority,canPublish}' = 'false'::jsonb
    and ${table.revisionPayload} #> '{authority,canApprove}' = 'false'::jsonb
    and ${table.revisionPayload} #> '{authority,canExecute}' = 'false'::jsonb
    and ${table.revisionPayload} #> '{authority,canWriteMeta}' = 'false'::jsonb
    and ${table.revisionPayload} #> '{authority,canGrant}' = 'false'::jsonb
    and ${table.revisionPayload} #> '{authority,canSchedule}' = 'false'::jsonb
    and ${table.revisionPayload} #> '{authority,canCallTool}' = 'false'::jsonb
    and ${table.revisionPayload} #> '{authority,canAccessNetwork}' = 'false'::jsonb
    and ${table.revisionPayload} #> '{authority,canQuerySql}' = 'false'::jsonb
  ) is true`),
  check("progressive_formalization_nested_exact", sql`(
    (${table.revisionPayload}
      - 'schemaVersion' - 'formalizationRef' - 'workspaceRef' - 'sequence' - 'previousRevisionHash'
      - 'fromLevel' - 'toLevel' - 'transition' - 'occurredAt' - 'actor' - 'payload' - 'authority' - 'revisionHash') = '{}'::jsonb
    and (${table.revisionPayload} #> '{actor}' - 'actorRef' - 'role') = '{}'::jsonb
    and (${table.revisionPayload} #> '{authority}' - 'canPublish' - 'canApprove' - 'canExecute' - 'canWriteMeta'
      - 'canGrant' - 'canSchedule' - 'canCallTool' - 'canAccessNetwork' - 'canQuerySql') = '{}'::jsonb
    and case ${table.transition}
      when 'capture_g0' then
        (${table.revisionPayload} #> '{payload}' - 'rawProvenanceRef' - 'rawTextHash') = '{}'::jsonb
        and ${table.revisionPayload} #>> '{payload,rawProvenanceRef}' ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
        and ${table.revisionPayload} #>> '{payload,rawTextHash}' ~ '^[a-f0-9]{64}$'
      when 'scope_g1' then
        (${table.revisionPayload} #> '{payload}' - 'guidanceCardRefs' - 'scope') = '{}'::jsonb
        and jsonb_typeof(${table.revisionPayload} #> '{payload,guidanceCardRefs}') = 'array'
        and jsonb_array_length(${table.revisionPayload} #> '{payload,guidanceCardRefs}') between 1 and 1000
        and (${table.revisionPayload} #> '{payload,scope}' - 'global' - 'accountGroupRefs' - 'accountRefs'
          - 'objectiveRefs' - 'internalCategoryRefs' - 'entityRefs' - 'promotionTemplateRefs' - 'topicRefs') = '{}'::jsonb
      when 'review_g2' then
        (${table.revisionPayload} #> '{payload}' - 'guidanceSetRef' - 'reviewedGuidanceHash' - 'confirmation') = '{}'::jsonb
        and ${table.revisionPayload} #>> '{payload,reviewedGuidanceHash}' ~ '^[a-f0-9]{64}$'
        and (${table.revisionPayload} #> '{payload,confirmation}' - 'confirmed' - 'confirmationRef' - 'confirmedAt') = '{}'::jsonb
        and ${table.revisionPayload} #> '{payload,confirmation,confirmed}' = 'true'::jsonb
      when 'promote_g3' then
        (${table.revisionPayload} #> '{payload}' - 'normalizedDraft' - 'confirmation') = '{}'::jsonb
        and (${table.revisionPayload} #> '{payload,confirmation}' - 'confirmed' - 'confirmationRef' - 'confirmedAt') = '{}'::jsonb
        and ${table.revisionPayload} #> '{payload,confirmation,confirmed}' = 'true'::jsonb
        and (${table.revisionPayload} #> '{payload,normalizedDraft}' - 'schemaVersion' - 'workspaceRef'
          - 'formalizationRef' - 'guidanceSetRef' - 'strictPolicy' - 'assumptions' - 'questions' - 'semanticDiff'
          - 'historicalReplay' - 'conflictPreview' - 'impactPreview' - 'authority' - 'draftHash') = '{}'::jsonb
        and (${table.revisionPayload} #> '{payload,normalizedDraft,authority}' - 'canPublish' - 'canApprove'
          - 'canExecute' - 'canWriteMeta' - 'canGrant' - 'canCallTool' - 'canAccessNetwork' - 'canQuerySql') = '{}'::jsonb
        and (${table.revisionPayload} #> '{payload,normalizedDraft,strictPolicy}' - 'dslVersion' - 'workspaceRef'
          - 'policyRef' - 'policyVersion' - 'previousVersionHash' - 'policyType' - 'owner' - 'status' - 'reasonCode'
          - 'priority' - 'effectiveDates' - 'scope' - 'source' - 'clause' - 'authority' - 'canonicalHash') = '{}'::jsonb
        and (${table.revisionPayload} #> '{payload,normalizedDraft,semanticDiff}' - 'status' - 'items' - 'diffHash') = '{}'::jsonb
        and (${table.revisionPayload} #> '{payload,normalizedDraft,historicalReplay}' - 'status'
          - 'evaluatedRevisionRefs' - 'changedOutcomeRefs' - 'unknownOutcomeRefs' - 'replayHash') = '{}'::jsonb
        and (${table.revisionPayload} #> '{payload,normalizedDraft,conflictPreview}' - 'status' - 'conflictRefs' - 'previewHash') = '{}'::jsonb
        and (${table.revisionPayload} #> '{payload,normalizedDraft,impactPreview}' - 'status' - 'affectedScopeRefs'
          - 'affectedEntityCount' - 'affectedPolicyCount' - 'affectedBudgetCount' - 'affectedAutomationCount'
          - 'unresolvedDependencyRefs' - 'previewHash') = '{}'::jsonb
      when 'qualify_g4' then
        (${table.revisionPayload} #> '{payload}' - 'publishedPolicyRef' - 'publishedPolicyHash'
          - 'riskAssessmentRef' - 'capPolicyRef' - 'approvalPolicyRef' - 'rolloutEvidenceRefs'
          - 'actionValveRef' - 'approvalMode' - 'confirmation') = '{}'::jsonb
        and ${table.revisionPayload} #>> '{payload,approvalMode}' = 'approval_only'
        and ${table.revisionPayload} #>> '{payload,publishedPolicyHash}' ~ '^[a-f0-9]{64}$'
        and jsonb_typeof(${table.revisionPayload} #> '{payload,rolloutEvidenceRefs}') = 'array'
        and jsonb_array_length(${table.revisionPayload} #> '{payload,rolloutEvidenceRefs}') between 1 and 1000
        and (${table.revisionPayload} #> '{payload,confirmation}' - 'confirmed' - 'confirmationRef' - 'confirmedAt') = '{}'::jsonb
        and ${table.revisionPayload} #> '{payload,confirmation,confirmed}' = 'true'::jsonb
      else false
    end
  ) is true`),
  check("progressive_formalization_no_forbidden_material", sql`
    ${table.revisionPayload}::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|authorization|approvalgranted)"[[:space:]]*:'
    and ${table.revisionPayload}::text !~* '"(canPublish|canApprove|canExecute|canWriteMeta|canGrant|canSchedule|canCallTool|canAccessNetwork|canQuerySql)"[[:space:]]*:[[:space:]]*true'
  `),
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
  uniqueIndex("guidance_sources_workspace_row_unique").on(table.workspaceId, table.id),
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
      ${table.sourceUrl} is not null and guidance_official_source_url_allowed(${table.sourceUrl})
      and ${table.capturedAt} is not null
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
  uniqueIndex("guidance_cards_workspace_row_unique").on(table.workspaceId, table.id),
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
  check("guidance_bindings_facet_allowlist", sql`${table.facet} in (
    'global', 'account_group', 'account', 'objective', 'funnel', 'optimization',
    'internal_category', 'lifecycle', 'entity', 'promotion_template', 'topic'
  )`),
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
  uniqueIndex("guidance_sets_workspace_row_unique").on(table.workspaceId, table.id),
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

/**
 * Server-private, append-only normalization workbench revisions. A row only
 * records a user-reviewed guidance draft pinned to exact G0/G1/G2 evidence;
 * it cannot publish, promote a strict policy, approve, execute, or write Meta.
 */
export const normalizationWorkbenchRevisions = pgTable("normalization_workbench_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull(),
  cardId: uuid("card_id").notNull(),
  setId: uuid("set_id").notNull(),
  workspaceRef: text("workspace_ref").notNull(),
  normalizationRef: text("normalization_ref").notNull(),
  revision: integer("revision").notNull(),
  previousRevisionHash: text("previous_revision_hash").notNull(),
  sourceKey: text("source_key").notNull(),
  sourceVersion: integer("source_version").notNull(),
  sourceHash: text("source_hash").notNull(),
  cardKey: text("card_key").notNull(),
  cardVersion: integer("card_version").notNull(),
  cardHash: text("card_hash").notNull(),
  setKey: text("set_key").notNull(),
  setVersion: integer("set_version").notNull(),
  setHash: text("set_hash").notNull(),
  actorRef: text("actor_ref").notNull(),
  actorRole: text("actor_role").notNull(),
  revisionHash: text("revision_hash").notNull(),
  revisionPayload: jsonb("revision_payload").$type<Record<string, unknown>>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.sourceId], foreignColumns: [guidanceSources.workspaceId, guidanceSources.id],
    name: "normalization_workbench_revisions_source_scope_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.cardId], foreignColumns: [guidanceCards.workspaceId, guidanceCards.id],
    name: "normalization_workbench_revisions_card_scope_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.setId], foreignColumns: [guidanceSets.workspaceId, guidanceSets.id],
    name: "normalization_workbench_revisions_set_scope_fk" }).onDelete("restrict"),
  uniqueIndex("normalization_workbench_revisions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("normalization_workbench_revisions_workspace_ref_revision_unique")
    .on(table.workspaceId, table.normalizationRef, table.revision),
  uniqueIndex("normalization_workbench_revisions_workspace_hash_unique").on(table.workspaceId, table.revisionHash),
  index("normalization_workbench_revisions_workspace_head_idx")
    .on(table.workspaceId, table.normalizationRef, table.revision),
  index("normalization_workbench_revisions_source_snapshot_idx")
    .on(table.workspaceId, table.sourceKey, table.sourceVersion, table.cardKey, table.setKey),
  check("normalization_workbench_revisions_identity", sql`
    ${table.workspaceRef} ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.normalizationRef} ~ '^normalization_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.revision} between 1 and 1000000
    and ((${table.revision} = 1 and ${table.previousRevisionHash} = 'GENESIS')
      or (${table.revision} > 1 and ${table.previousRevisionHash} ~ '^[a-f0-9]{64}$'))
    and ${table.sourceVersion} >= 1 and ${table.cardVersion} >= 1 and ${table.setVersion} >= 1
    and ${table.sourceHash} ~ '^[a-f0-9]{64}$' and ${table.cardHash} ~ '^[a-f0-9]{64}$'
    and ${table.setHash} ~ '^[a-f0-9]{64}$' and ${table.revisionHash} ~ '^[a-f0-9]{64}$'
    and ${table.actorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.actorRole} in ('owner', 'admin', 'analyst')
  `),
  check("normalization_workbench_revisions_payload_exact", sql`(
    jsonb_typeof(${table.revisionPayload}) = 'object'
    and ${table.revisionPayload} #>> '{schemaVersion}' = 'normalization-workbench/1.0.0'
    and ${table.revisionPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.revisionPayload} #>> '{normalizationRef}' = ${table.normalizationRef}
    and (${table.revisionPayload} #>> '{revision}')::integer = ${table.revision}
    and ${table.revisionPayload} #>> '{previousRevisionHash}' = ${table.previousRevisionHash}
    and ${table.revisionPayload} #>> '{source,ref}' = ${table.sourceKey}
    and (${table.revisionPayload} #>> '{source,version}')::integer = ${table.sourceVersion}
    and ${table.revisionPayload} #>> '{source,recordHash}' = ${table.sourceHash}
    and ${table.revisionPayload} #>> '{card,ref}' = ${table.cardKey}
    and (${table.revisionPayload} #>> '{card,version}')::integer = ${table.cardVersion}
    and ${table.revisionPayload} #>> '{card,recordHash}' = ${table.cardHash}
    and ${table.revisionPayload} #>> '{set,ref}' = ${table.setKey}
    and (${table.revisionPayload} #>> '{set,version}')::integer = ${table.setVersion}
    and ${table.revisionPayload} #>> '{set,recordHash}' = ${table.setHash}
    and ${table.revisionPayload} #>> '{actor,ref}' = ${table.actorRef}
    and ${table.revisionPayload} #>> '{actor,role}' = ${table.actorRole}
    and ${table.revisionPayload} #>> '{revisionHash}' = ${table.revisionHash}
    and (${table.revisionPayload} #>> '{occurredAt}')::timestamptz = ${table.occurredAt}
    and jsonb_typeof(${table.revisionPayload} #> '{normalizedGuidance}') = 'object'
    and jsonb_typeof(${table.revisionPayload} #> '{assumptions}') = 'array'
    and jsonb_typeof(${table.revisionPayload} #> '{questions}') = 'array'
    and ${table.revisionPayload} #>> '{impactSummary,status}' = 'not_applicable'
    and ${table.revisionPayload} #> '{impactSummary,affectedScopeRefs}' = '[]'::jsonb
    and ${table.revisionPayload} #> '{impactSummary,unresolvedDependencyRefs}' = '[]'::jsonb
    and ${table.revisionPayload} #> '{authority,canPublish}' = 'false'::jsonb
    and ${table.revisionPayload} #> '{authority,canPromotePolicy}' = 'false'::jsonb
    and ${table.revisionPayload} #> '{authority,canApprove}' = 'false'::jsonb
    and ${table.revisionPayload} #> '{authority,canExecute}' = 'false'::jsonb
    and ${table.revisionPayload} #> '{authority,canWriteMeta}' = 'false'::jsonb
  ) is true`),
  check("normalization_workbench_revisions_no_forbidden_material", sql`
    ${table.revisionPayload}::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json|text)|authorization|approvalgranted)"[[:space:]]*:'
    and ${table.revisionPayload}::text !~* '"(canPublish|canPromotePolicy|canApprove|canExecute|canWriteMeta)"[[:space:]]*:[[:space:]]*true'
    and not (${table.revisionPayload} ? 'strictPolicy')
  `),
]);

/**
 * Immutable, tenant-scoped guidance selection revisions. A revision freezes
 * the reviewed manifest identity plus the bounded topic/budget input used to
 * build a campaign's advisory guidance pack. The mutable head below is only
 * an OCC pointer; it never replaces historical selection evidence.
 */
export const guidanceCampaignSelectionRevisions = pgTable("guidance_campaign_selection_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  selectionRef: text("selection_ref").notNull(),
  revision: integer("revision").notNull(),
  selectionVersion: text("selection_version").notNull(),
  selectedSetRef: text("selected_set_ref").notNull(),
  selectedSetVersion: integer("selected_set_version").notNull(),
  selectedSetHash: text("selected_set_hash").notNull(),
  topics: jsonb("topics").$type<readonly string[]>().notNull(),
  requiredTopics: jsonb("required_topics").$type<readonly string[]>().notNull(),
  budget: jsonb("budget").$type<Readonly<{ maxCards: number; maxSources: number; maxCharacters: number }>>().notNull(),
  sourceSelectionHash: text("source_selection_hash").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  previousSelectionHash: text("previous_selection_hash").notNull(),
  selectionHash: text("selection_hash").notNull(),
  actorRef: text("actor_ref").notNull(),
  actorRole: text("actor_role").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("guidance_campaign_selection_revisions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("guidance_campaign_selection_revisions_workspace_ref_revision_unique")
    .on(table.workspaceId, table.selectionRef, table.revision),
  uniqueIndex("guidance_campaign_selection_revisions_workspace_ref_hash_unique")
    .on(table.workspaceId, table.selectionRef, table.selectionHash),
  index("guidance_campaign_selection_revisions_campaign_idx")
    .on(table.workspaceId, table.adAccountId, table.campaignId, table.createdAt),
  foreignKey({ columns: [table.workspaceId, table.adAccountId], foreignColumns: [adAccounts.workspaceId, adAccounts.id],
    name: "guidance_campaign_selection_revisions_account_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.campaignId], foreignColumns: [adCampaigns.workspaceId, adCampaigns.id],
    name: "guidance_campaign_selection_revisions_campaign_scope_fk" }).onDelete("cascade"),
  check("guidance_campaign_selection_revisions_identity", sql`
    ${table.selectionRef} ~ '^guidance_selection_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.revision} >= 1 and ${table.selectionVersion} = 'guidance-campaign-selection/1.0.0'
    and btrim(${table.selectedSetRef}) <> '' and ${table.selectedSetVersion} >= 1
    and ${table.selectedSetHash} ~ '^[a-f0-9]{64}$' and ${table.sourceSelectionHash} ~ '^[a-f0-9]{64}$'
    and ${table.selectionHash} ~ '^[a-f0-9]{64}$'
    and ((${table.revision} = 1 and ${table.previousSelectionHash} = 'GENESIS')
      or (${table.revision} > 1 and ${table.previousSelectionHash} ~ '^[a-f0-9]{64}$'))
    and ${table.actorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.actorRole} in ('owner', 'admin') and ${table.effectiveAt} <= ${table.occurredAt}
  `),
  check("guidance_campaign_selection_revisions_topics", sql`
    jsonb_typeof(${table.topics}) = 'array' and jsonb_array_length(${table.topics}) between 1 and 50
    and jsonb_typeof(${table.requiredTopics}) = 'array' and jsonb_array_length(${table.requiredTopics}) <= 50
    and jsonb_typeof(${table.budget}) = 'object'
    and (${table.budget} #>> '{maxCards}')::integer between 1 and 100
    and (${table.budget} #>> '{maxSources}')::integer between 1 and 500
    and (${table.budget} #>> '{maxCharacters}')::integer between 256 and 200000
  `),
]);

/** Mutable current pointer guarded by the writer's workspace row lock and expected hash. */
export const guidanceCampaignSelectionHeads = pgTable("guidance_campaign_selection_heads", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  revisionId: uuid("revision_id").notNull(),
  selectionRef: text("selection_ref").notNull(),
  revision: integer("revision").notNull(),
  selectionHash: text("selection_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("guidance_campaign_selection_heads_scope_unique").on(table.workspaceId, table.adAccountId, table.campaignId),
  uniqueIndex("guidance_campaign_selection_heads_workspace_revision_unique").on(table.workspaceId, table.revisionId),
  foreignKey({ columns: [table.workspaceId, table.adAccountId], foreignColumns: [adAccounts.workspaceId, adAccounts.id],
    name: "guidance_campaign_selection_heads_account_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.campaignId], foreignColumns: [adCampaigns.workspaceId, adCampaigns.id],
    name: "guidance_campaign_selection_heads_campaign_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.revisionId],
    foreignColumns: [guidanceCampaignSelectionRevisions.workspaceId, guidanceCampaignSelectionRevisions.id],
    name: "guidance_campaign_selection_heads_revision_scope_fk" }).onDelete("cascade"),
  check("guidance_campaign_selection_heads_identity", sql`
    ${table.selectionRef} ~ '^guidance_selection_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.revision} >= 1 and ${table.selectionHash} ~ '^[a-f0-9]{64}$'
  `),
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
    'candidate_created', 'reviewed', 'trial_started', 'outcome_recorded', 'standardization_reviewed',
    'standardization_candidate', 'standardized', 'retired'
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
  check("advised_practice_events_candidate_guard", sql`
    ${table.eventType} <> 'standardization_candidate' or (
      ${table.payload} #>> '{proposedByRole}' in ('owner', 'admin', 'analyst')
      and ${table.payload} #>> '{humanConfirmationRequired}' = 'true'
      and ${table.payload} #>> '{capabilities,canPromotePolicy}' = 'false'
      and ${table.payload} #>> '{capabilities,canEnableAutomation}' = 'false'
      and ${table.payload} #>> '{capabilities,canAuthorizeAction}' = 'false'
      and ${table.payload} #>> '{capabilities,canWriteMeta}' = 'false'
    )
  `),
  check("advised_practice_events_standardized_guard", sql`
    ${table.eventType} <> 'standardized' or (
      ${table.payload} #>> '{confirmedByRole}' in ('owner', 'admin')
      and ${table.payload} #>> '{humanConfirmation}' = 'explicit'
      and ${table.payload} #>> '{capabilities,canPromotePolicy}' = 'false'
      and ${table.payload} #>> '{capabilities,canEnableAutomation}' = 'false'
      and ${table.payload} #>> '{capabilities,canAuthorizeAction}' = 'false'
      and ${table.payload} #>> '{capabilities,canWriteMeta}' = 'false'
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
    'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver', 'instruction_policy', 'promotion_registry', 'policy_authority', 'business_outcome_evidence', 'cadence_profile',
    'deterministic_feature_snapshot', 'deterministic_window_snapshot'
  )`),
  check("effective_campaign_context_components_required", sql`
    btrim(${table.componentRef}) <> '' and btrim(${table.componentVersion}) <> ''
  `),
]);

/** Immutable A09 policy-resolution evidence for contexts composed with trusted authority. */
export const effectiveCampaignPolicyCompositions = pgTable("effective_campaign_policy_compositions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  contextId: uuid("context_id").notNull(),
  instructionPolicyRegistryHash: text("instruction_policy_registry_hash").notNull(),
  authorityComponentVersion: text("authority_component_version").notNull(),
  authoritySnapshotRef: text("authority_snapshot_ref").notNull(),
  authoritySnapshotHash: text("authority_snapshot_hash").notNull(),
  authorityCatalogHash: text("authority_catalog_hash").notNull(),
  authorityScopeHash: text("authority_scope_hash").notNull(),
  compositionHash: text("composition_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.contextId], foreignColumns: [effectiveCampaignContexts.workspaceId, effectiveCampaignContexts.id], name: "effective_campaign_policy_compositions_context_scope_fk" }).onDelete("cascade"),
  uniqueIndex("effective_campaign_policy_compositions_context_unique").on(table.contextId),
  uniqueIndex("effective_campaign_policy_compositions_workspace_id_unique").on(table.workspaceId, table.id),
  index("effective_campaign_policy_compositions_workspace_lookup_idx").on(table.workspaceId, table.instructionPolicyRegistryHash, table.authorityComponentVersion),
  check("effective_campaign_policy_compositions_hashes", sql`${table.instructionPolicyRegistryHash} ~ '^[a-f0-9]{64}$' and ${table.authorityComponentVersion} ~ '^[a-f0-9]{64}$' and ${table.authoritySnapshotHash} ~ '^[a-f0-9]{64}$' and ${table.authorityCatalogHash} ~ '^[a-f0-9]{64}$' and ${table.authorityScopeHash} ~ '^[a-f0-9]{64}$' and ${table.compositionHash} ~ '^[a-f0-9]{64}$'`),
]);

export const effectiveCampaignPolicyCompositionItems = pgTable("effective_campaign_policy_composition_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  compositionId: uuid("composition_id").notNull(),
  policyRevisionId: uuid("policy_revision_id").notNull(),
  policyRef: text("policy_ref").notNull(), policyVersion: integer("policy_version").notNull(), policyHash: text("policy_hash").notNull(),
  state: text("state").notNull(), reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.compositionId], foreignColumns: [effectiveCampaignPolicyCompositions.workspaceId, effectiveCampaignPolicyCompositions.id], name: "effective_campaign_policy_composition_items_composition_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.policyRevisionId], foreignColumns: [strictInstructionPolicyRevisions.workspaceId, strictInstructionPolicyRevisions.id], name: "effective_campaign_policy_composition_items_revision_scope_fk" }).onDelete("restrict"),
  uniqueIndex("effective_campaign_policy_composition_items_exact_unique").on(table.compositionId, table.policyRef),
  index("effective_campaign_policy_composition_items_revision_idx").on(table.workspaceId, table.policyRevisionId),
  check("effective_campaign_policy_composition_items_shape", sql`${table.policyVersion} >= 1 and ${table.policyHash} ~ '^[a-f0-9]{64}$' and ${table.state} in ('applied', 'suppressed', 'parked_conflict') and btrim(${table.reason}) <> ''`),
]);

/**
 * Immutable A10 diagnostic input envelope. This is deliberately evidence, not
 * a finding: it preserves the exact frozen context/config/window inputs from
 * which a future cohort, fatigue, or configuration calculation may be made.
 */
export const frozenDiagnosticEvidence = pgTable("frozen_diagnostic_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  contextId: uuid("context_id").notNull(),
  contextRef: text("context_ref").notNull(), contextHash: text("context_hash").notNull(),
  evidenceHash: text("evidence_hash").notNull(), capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  entityType: text("entity_type").notNull(), entityRef: text("entity_ref").notNull(), hierarchyRefs: jsonb("hierarchy_refs").$type<readonly string[]>().notNull(),
  featureManifest: jsonb("feature_manifest").$type<readonly Readonly<{ ref: string; hash: string }>[]>().notNull(),
  windowManifest: jsonb("window_manifest").$type<readonly Readonly<{ ref: string; hash: string }>[]>().notNull(),
  objective: text("objective"), funnel: text("funnel"), optimizationEvent: text("optimization_event"),
  categoryCompositionHash: text("category_composition_hash").notNull(),
  categoryCohortProfileHash: text("category_cohort_profile_hash"),
  policySetHash: text("policy_set_hash").notNull(),
  creativeBindingHash: text("creative_binding_hash"), canonicalConfigEvidence: jsonb("canonical_config_evidence").$type<Record<string, unknown>>().notNull(),
  sourceRefs: jsonb("source_refs").$type<readonly string[]>().notNull(), capabilities: jsonb("capabilities").$type<Record<string, false>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.contextId], foreignColumns: [effectiveCampaignContexts.workspaceId, effectiveCampaignContexts.id], name: "frozen_diagnostic_evidence_context_scope_fk" }).onDelete("cascade"),
  uniqueIndex("frozen_diagnostic_evidence_context_unique").on(table.contextId),
  uniqueIndex("frozen_diagnostic_evidence_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("frozen_diagnostic_evidence_workspace_hash_unique").on(table.workspaceId, table.evidenceHash),
  index("frozen_diagnostic_evidence_lookup_idx").on(table.workspaceId, table.entityType, table.entityRef, table.capturedAt),
  index("frozen_diagnostic_evidence_cohort_compatibility_idx").on(table.workspaceId, table.entityType, table.objective, table.funnel, table.optimizationEvent, table.categoryCompositionHash, table.policySetHash, table.capturedAt),
  index("frozen_diagnostic_evidence_cohort_profile_idx").on(table.workspaceId, table.entityType, table.objective, table.funnel, table.optimizationEvent, table.categoryCohortProfileHash, table.policySetHash, table.capturedAt),
  check("frozen_diagnostic_evidence_hashes", sql`${table.contextHash} ~ '^[a-f0-9]{64}$' and ${table.evidenceHash} ~ '^[a-f0-9]{64}$' and ${table.categoryCompositionHash} ~ '^[a-f0-9]{64}$' and ${table.policySetHash} ~ '^[a-f0-9]{64}$' and (${table.creativeBindingHash} is null or ${table.creativeBindingHash} ~ '^[a-f0-9]{64}$')`),
  check("frozen_diagnostic_evidence_cohort_profile_hash", sql`${table.categoryCohortProfileHash} is null or ${table.categoryCohortProfileHash} ~ '^[a-f0-9]{64}$'`),
  check("frozen_diagnostic_evidence_exact_context", sql`btrim(${table.contextRef}) <> '' and btrim(${table.entityRef}) <> '' and ${table.entityType} in ('campaign', 'ad_set', 'ad', 'creative') and jsonb_typeof(${table.hierarchyRefs}) = 'array' and jsonb_array_length(${table.hierarchyRefs}) >= 1 and jsonb_typeof(${table.featureManifest}) = 'array' and jsonb_array_length(${table.featureManifest}) >= 1 and jsonb_typeof(${table.windowManifest}) = 'array' and jsonb_array_length(${table.windowManifest}) >= 1 and jsonb_typeof(${table.canonicalConfigEvidence}) = 'object' and jsonb_typeof(${table.sourceRefs}) = 'array' and jsonb_array_length(${table.sourceRefs}) >= 1`),
  check("frozen_diagnostic_evidence_no_authority", sql`${table.capabilities} = '{"canAuthorizeAction":false,"canExecuteWrite":false,"canWriteMeta":false,"canPublish":false,"canApprove":false,"canExecute":false,"canAccessNetwork":false}'::jsonb`),
]);

/**
 * Immutable A10.5b cohort replay artifact. Member selection is never caller
 * supplied: the repository records only the exact frozen-evidence members it
 * selected from one workspace/account and compatibility profile.
 */
export const robustCohortDiagnosticAssets = pgTable("robust_cohort_diagnostic_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  targetEvidenceId: uuid("target_evidence_id").notNull(),
  cohortRef: text("cohort_ref").notNull(),
  cohortHash: text("cohort_hash").notNull(),
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull(),
  memberEvidenceRefs: jsonb("member_evidence_refs").$type<readonly Readonly<{ evidenceRef: string; evidenceHash: string; featureRef: string; featureHash: string }>[]>().notNull(),
  resultPayload: jsonb("result_payload").$type<Record<string, unknown>>().notNull(),
  capabilities: jsonb("capabilities").$type<Record<string, false>>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.targetEvidenceId], foreignColumns: [frozenDiagnosticEvidence.workspaceId, frozenDiagnosticEvidence.id], name: "robust_cohort_diagnostic_assets_target_scope_fk" }).onDelete("cascade"),
  uniqueIndex("robust_cohort_diagnostic_assets_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("robust_cohort_diagnostic_assets_hash_unique").on(table.workspaceId, table.cohortHash),
  index("robust_cohort_diagnostic_assets_target_idx").on(table.workspaceId, table.targetEvidenceId, table.occurredAt),
  check("robust_cohort_diagnostic_assets_hashes", sql`${table.cohortHash} ~ '^[a-f0-9]{64}$'`),
  check("robust_cohort_diagnostic_assets_shape", sql`jsonb_typeof(${table.profile}) = 'object' and jsonb_typeof(${table.memberEvidenceRefs}) = 'array' and jsonb_array_length(${table.memberEvidenceRefs}) >= 1 and jsonb_array_length(${table.memberEvidenceRefs}) <= 100 and jsonb_typeof(${table.resultPayload}) = 'object'`),
  check("robust_cohort_diagnostic_assets_advisory_only", sql`${table.capabilities} = '{"canAuthorizeAction":false,"canExecuteWrite":false,"canWriteMeta":false,"canPublish":false,"canApprove":false,"canExecute":false,"canAccessNetwork":false}'::jsonb`),
]);

/** Immutable source-owned contract for creative fatigue/config materialization. */
export const creativeDiagnosticDefinitionRevisions = pgTable("creative_diagnostic_definition_revisions", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  definitionRef: text("definition_ref").notNull(), revision: integer("revision").notNull(), definitionHash: text("definition_hash").notNull(), previousHash: text("previous_hash"),
  state: text("state").notNull(), definitionPayload: jsonb("definition_payload").$type<Record<string, unknown>>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("creative_diagnostic_definition_revisions_exact_unique").on(table.workspaceId, table.definitionRef, table.revision), uniqueIndex("creative_diagnostic_definition_revisions_workspace_id_unique").on(table.workspaceId, table.id),
  index("creative_diagnostic_definition_revisions_lookup_idx").on(table.workspaceId, table.definitionRef, table.state, table.revision),
  check("creative_diagnostic_definition_revisions_shape", sql`${table.definitionRef} ~ '^creative_definition_[a-f0-9]{24}$' and ${table.revision} >= 1 and ${table.definitionHash} ~ '^[a-f0-9]{64}$' and (${table.previousHash} is null or ${table.previousHash} ~ '^[a-f0-9]{64}$') and ${table.state} in ('draft', 'published', 'retired') and jsonb_typeof(${table.definitionPayload}) = 'object'`),
]);

/** Tenant-scoped head plus immutable revision chain for creative evidence settlement. */
export const creativeDiagnosticSettlementPolicies = pgTable("creative_diagnostic_settlement_policies", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), policyRef: text("policy_ref").notNull(), currentRevision: integer("current_revision").notNull().default(0), currentPolicyHash: text("current_policy_hash"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("creative_diagnostic_settlement_policies_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("creative_diagnostic_settlement_policies_workspace_ref_unique").on(table.workspaceId, table.policyRef),
  check("creative_diagnostic_settlement_policies_identity", sql`${table.policyRef} ~ '^creative_settlement_[a-f0-9]{24}$' and ${table.currentRevision} >= 0 and ((${table.currentRevision} = 0 and ${table.currentPolicyHash} is null) or (${table.currentRevision} > 0 and ${table.currentPolicyHash} ~ '^[a-f0-9]{64}$'))`),
]);

export const creativeDiagnosticSettlementPolicyRevisions = pgTable("creative_diagnostic_settlement_policy_revisions", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), policyId: uuid("policy_id").notNull(), policyRef: text("policy_ref").notNull(), revision: integer("revision").notNull(), previousHash: text("previous_hash"), policyHash: text("policy_hash").notNull(), state: text("state").notNull(), settlementLagDays: integer("settlement_lag_days").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.policyId], foreignColumns: [creativeDiagnosticSettlementPolicies.workspaceId, creativeDiagnosticSettlementPolicies.id], name: "creative_diagnostic_settlement_policy_revisions_policy_scope_fk" }).onDelete("restrict"),
  uniqueIndex("creative_diagnostic_settlement_policy_revisions_workspace_row_unique").on(table.workspaceId, table.id), uniqueIndex("creative_diagnostic_settlement_policy_revisions_exact_unique").on(table.workspaceId, table.policyRef, table.revision), index("creative_diagnostic_settlement_policy_revisions_lookup_idx").on(table.workspaceId, table.policyRef, table.state, table.revision),
  check("creative_diagnostic_settlement_policy_revisions_shape", sql`${table.policyRef} ~ '^creative_settlement_[a-f0-9]{24}$' and ${table.revision} >= 1 and ${table.policyHash} ~ '^[a-f0-9]{64}$' and (${table.previousHash} is null or ${table.previousHash} ~ '^[a-f0-9]{64}$') and ${table.state} in ('draft', 'published', 'retired') and ${table.settlementLagDays} between 0 and 90 and jsonb_typeof(${table.payload}) = 'object'`),
]);

export const metaCreativeConfigSnapshots = pgTable("meta_creative_config_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), targetEvidenceId: uuid("target_evidence_id").notNull(), adId: uuid("ad_id").notNull(), creativeId: uuid("creative_id").notNull(),
  bindingHash: text("binding_hash").notNull(), creativeContentHash: text("creative_content_hash").notNull(), configPayload: jsonb("config_payload").$type<Record<string, unknown>>().notNull(), snapshotHash: text("snapshot_hash").notNull(), observedAt: timestamp("observed_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.targetEvidenceId], foreignColumns: [frozenDiagnosticEvidence.workspaceId, frozenDiagnosticEvidence.id], name: "meta_creative_config_snapshots_evidence_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.adId], foreignColumns: [metaAds.workspaceId, metaAds.id], name: "meta_creative_config_snapshots_ad_scope_fk" }).onDelete("restrict"), foreignKey({ columns: [table.workspaceId, table.creativeId], foreignColumns: [metaCreatives.workspaceId, metaCreatives.id], name: "meta_creative_config_snapshots_creative_scope_fk" }).onDelete("restrict"),
  uniqueIndex("meta_creative_config_snapshots_hash_unique").on(table.workspaceId, table.snapshotHash), uniqueIndex("meta_creative_config_snapshots_workspace_id_unique").on(table.workspaceId, table.id), index("meta_creative_config_snapshots_evidence_idx").on(table.workspaceId, table.targetEvidenceId, table.observedAt),
  check("meta_creative_config_snapshots_shape", sql`${table.bindingHash} ~ '^[a-f0-9]{64}$' and ${table.creativeContentHash} ~ '^[a-f0-9]{64}$' and ${table.snapshotHash} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${table.configPayload}) = 'object'`),
]);

export const metaCreativeWindowInsightSnapshots = pgTable("meta_creative_window_insight_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), configSnapshotId: uuid("config_snapshot_id").notNull(), windowKind: text("window_kind").notNull(), startDate: date("start_date", { mode: "string" }).notNull(), endDate: date("end_date", { mode: "string" }).notNull(),
  frequency: numeric("frequency", { precision: 30, scale: 12 }).notNull(), clicks: bigint("clicks", { mode: "number" }).notNull(), impressions: bigint("impressions", { mode: "number" }).notNull(), attributionLabel: text("attribution_label").notNull(), timezone: text("timezone").notNull(), dailyCoverage: jsonb("daily_coverage").$type<readonly Record<string, unknown>[]>().notNull(), sourceRef: text("source_ref").notNull(), sourceHash: text("source_hash").notNull(), settlementPolicyRef: text("settlement_policy_ref"), settlementPolicyHash: text("settlement_policy_hash"), snapshotHash: text("snapshot_hash").notNull(), observedAt: timestamp("observed_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.configSnapshotId], foreignColumns: [metaCreativeConfigSnapshots.workspaceId, metaCreativeConfigSnapshots.id], name: "meta_creative_window_insight_snapshots_config_scope_fk" }).onDelete("cascade"),
  uniqueIndex("meta_creative_window_insight_snapshots_hash_unique").on(table.workspaceId, table.snapshotHash), uniqueIndex("meta_creative_window_insight_snapshots_workspace_id_unique").on(table.workspaceId, table.id), uniqueIndex("meta_creative_window_insight_snapshots_exact_unique").on(table.configSnapshotId, table.windowKind, table.startDate, table.endDate, table.attributionLabel, table.settlementPolicyHash, table.sourceHash), index("meta_creative_window_insight_snapshots_config_idx").on(table.workspaceId, table.configSnapshotId, table.observedAt),
  check("meta_creative_window_insight_snapshots_shape", sql`${table.windowKind} in ('baseline', 'recent') and ${table.startDate} <= ${table.endDate} and ${table.frequency} >= 0 and ${table.clicks} >= 0 and ${table.impressions} >= 0 and btrim(${table.attributionLabel}) <> '' and btrim(${table.timezone}) <> '' and ${table.sourceRef} ~ '^creative_window_[a-f0-9]{24}$' and ${table.sourceHash} ~ '^[a-f0-9]{64}$' and ((${table.settlementPolicyRef} is null and ${table.settlementPolicyHash} is null) or (${table.settlementPolicyRef} ~ '^creative_settlement_[a-f0-9]{24}$' and ${table.settlementPolicyHash} ~ '^[a-f0-9]{64}$')) and ${table.snapshotHash} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${table.dailyCoverage}) = 'array'`),
]);

export const creativeFatigueConfigDiagnosticAssets = pgTable("creative_fatigue_config_diagnostic_assets", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), targetEvidenceId: uuid("target_evidence_id").notNull(), definitionRevisionId: uuid("definition_revision_id").notNull(), baselineConfigSnapshotId: uuid("baseline_config_snapshot_id").notNull(), recentConfigSnapshotId: uuid("recent_config_snapshot_id").notNull(), baselineWindowId: uuid("baseline_window_id").notNull(), recentWindowId: uuid("recent_window_id").notNull(), diagnosticHash: text("diagnostic_hash").notNull(), resultPayload: jsonb("result_payload").$type<Record<string, unknown>>().notNull(), capabilities: jsonb("capabilities").$type<Record<string, false>>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.targetEvidenceId], foreignColumns: [frozenDiagnosticEvidence.workspaceId, frozenDiagnosticEvidence.id], name: "creative_fatigue_config_diagnostic_assets_evidence_scope_fk" }).onDelete("cascade"), foreignKey({ columns: [table.workspaceId, table.definitionRevisionId], foreignColumns: [creativeDiagnosticDefinitionRevisions.workspaceId, creativeDiagnosticDefinitionRevisions.id], name: "creative_fatigue_config_diagnostic_assets_definition_scope_fk" }).onDelete("restrict"), foreignKey({ columns: [table.workspaceId, table.baselineConfigSnapshotId], foreignColumns: [metaCreativeConfigSnapshots.workspaceId, metaCreativeConfigSnapshots.id], name: "creative_fatigue_config_diagnostic_assets_baseline_config_scope_fk" }).onDelete("restrict"), foreignKey({ columns: [table.workspaceId, table.recentConfigSnapshotId], foreignColumns: [metaCreativeConfigSnapshots.workspaceId, metaCreativeConfigSnapshots.id], name: "creative_fatigue_config_diagnostic_assets_recent_config_scope_fk" }).onDelete("restrict"), foreignKey({ columns: [table.workspaceId, table.baselineWindowId], foreignColumns: [metaCreativeWindowInsightSnapshots.workspaceId, metaCreativeWindowInsightSnapshots.id], name: "creative_fatigue_config_diagnostic_assets_baseline_window_scope_fk" }).onDelete("restrict"), foreignKey({ columns: [table.workspaceId, table.recentWindowId], foreignColumns: [metaCreativeWindowInsightSnapshots.workspaceId, metaCreativeWindowInsightSnapshots.id], name: "creative_fatigue_config_diagnostic_assets_recent_window_scope_fk" }).onDelete("restrict"),
  uniqueIndex("creative_fatigue_config_diagnostic_assets_hash_unique").on(table.workspaceId, table.diagnosticHash), uniqueIndex("creative_fatigue_config_diagnostic_assets_workspace_id_unique").on(table.workspaceId, table.id), index("creative_fatigue_config_diagnostic_assets_target_idx").on(table.workspaceId, table.targetEvidenceId, table.occurredAt),
  check("creative_fatigue_config_diagnostic_assets_shape", sql`${table.diagnosticHash} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${table.resultPayload}) = 'object' and ${table.capabilities} = '{"canAuthorizeAction":false,"canExecuteWrite":false,"canWriteMeta":false,"canPublish":false,"canApprove":false,"canExecute":false,"canAccessNetwork":false}'::jsonb`),
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
    'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver', 'instruction_policy', 'promotion_registry', 'policy_authority', 'business_outcome_evidence', 'cadence_profile',
    'deterministic_feature_snapshot', 'deterministic_window_snapshot'
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

/**
 * Append-only, recommendation-only operating-rule drafts over an exact user-labelled slice.
 * This store is deliberately independent from strict policy publication and action execution.
 */
export const sliceRuleWorkspaceDrafts = pgTable("slice_rule_workspace_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  seriesRef: text("series_ref").notNull(),
  revision: integer("revision").notNull(),
  previousDraftHash: text("previous_draft_hash").notNull(),
  draftRef: text("draft_ref").notNull(),
  draftHash: text("draft_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  market: text("market").notNull(),
  serviceRef: text("service_ref").notNull(),
  campaignFamilyRef: text("campaign_family_ref").notNull(),
  countryOrRegion: text("country_or_region"),
  audienceStrategy: text("audience_strategy"),
  platform: text("platform"),
  operatingMode: text("operating_mode").notNull(),
  lifecycleState: text("lifecycle_state").notNull(),
  createdByActorId: uuid("created_by_actor_id").notNull(),
  draftPayload: jsonb("draft_payload").$type<Record<string, unknown>>().notNull(),
  draftedAt: timestamp("drafted_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.createdByActorId],
    foreignColumns: [memberships.workspaceId, memberships.userId],
    name: "slice_rule_workspace_drafts_membership_scope_fk",
  }).onDelete("restrict"),
  uniqueIndex("slice_rule_workspace_drafts_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("slice_rule_workspace_drafts_series_revision_unique").on(table.workspaceId, table.seriesRef, table.revision),
  uniqueIndex("slice_rule_workspace_drafts_workspace_hash_unique").on(table.workspaceId, table.draftHash),
  uniqueIndex("slice_rule_workspace_drafts_workspace_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
  index("slice_rule_workspace_drafts_scope_idx").on(table.workspaceId, table.market, table.serviceRef, table.campaignFamilyRef, table.draftedAt),
  check("slice_rule_workspace_drafts_identity", sql`
    ${table.seriesRef} ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and ${table.idempotencyKey} ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and ${table.draftRef} ~ '^slice_rule_draft_[a-f0-9]{20}$'
    and ${table.draftHash} ~ '^[a-f0-9]{64}$'
    and ${table.revision} >= 1
    and ((${table.revision} = 1 and ${table.previousDraftHash} = 'GENESIS')
      or (${table.revision} > 1 and ${table.previousDraftHash} ~ '^[a-f0-9]{64}$'))
    and ${table.market} in ('domestic', 'international')
    and ${table.serviceRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.campaignFamilyRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and (${table.countryOrRegion} is null or (length(${table.countryOrRegion}) between 1 and 120 and btrim(${table.countryOrRegion}) = ${table.countryOrRegion}))
    and (${table.audienceStrategy} is null or (length(${table.audienceStrategy}) between 1 and 120 and btrim(${table.audienceStrategy}) = ${table.audienceStrategy}))
    and (${table.platform} is null or ${table.platform} in ('facebook', 'instagram', 'mixed'))
    and ${table.operatingMode} = 'recommendation_only'
    and ${table.lifecycleState} = 'draft'
  `),
  check("slice_rule_workspace_drafts_payload_exact", sql`(
    jsonb_typeof(${table.draftPayload}) = 'object'
    and ${table.draftPayload} #>> '{schemaVersion}' = 'slice-rule-workspace-draft/1.0.0'
    and ${table.draftPayload} #>> '{workspaceId}' = ${table.workspaceId}::text
    and ${table.draftPayload} #>> '{seriesRef}' = ${table.seriesRef}
    and (${table.draftPayload} #>> '{revision}')::integer = ${table.revision}
    and ${table.draftPayload} #>> '{previousDraftHash}' = ${table.previousDraftHash}
    and ${table.draftPayload} #>> '{draftRef}' = ${table.draftRef}
    and ${table.draftPayload} #>> '{draftHash}' = ${table.draftHash}
    and ${table.draftPayload} #>> '{idempotencyKey}' = ${table.idempotencyKey}
    and ${table.draftPayload} #>> '{status}' = ${table.lifecycleState}
    and ${table.draftPayload} #>> '{operatingMode}' = ${table.operatingMode}
    and ${table.draftPayload} #>> '{scope,market}' = ${table.market}
    and ${table.draftPayload} #>> '{scope,serviceRef}' = ${table.serviceRef}
    and ${table.draftPayload} #>> '{scope,campaignFamilyRef}' = ${table.campaignFamilyRef}
    and (${table.draftPayload} #>> '{scope,countryOrRegion}') is not distinct from ${table.countryOrRegion}
    and (${table.draftPayload} #>> '{scope,audienceStrategy}') is not distinct from ${table.audienceStrategy}
    and (${table.draftPayload} #>> '{scope,platform}') is not distinct from ${table.platform}
    and ${table.draftPayload} #>> '{operatingRule,automationMode}' = 'recommendation_only'
    and (${table.draftPayload} #>> '{createdAt}')::timestamptz = ${table.draftedAt}
    and ${table.draftPayload} #> '{authority}' = '{
      "canPublish": false, "canApprove": false, "canExecute": false,
      "canWriteMeta": false, "canEnableAutomation": false
    }'::jsonb
    and ${table.draftPayload} #> '{operatingRule,authority}' = '{
      "canPublish": false, "canApprove": false, "canExecute": false,
      "canWriteMeta": false, "canEnableAutomation": false
    }'::jsonb
  ) is true`),
  check("slice_rule_workspace_drafts_no_forbidden_authority", sql`
    ${table.draftPayload}::text !~* '"(approvalGranted|writeEnabled|policyPublished|actionAuthorized)"[[:space:]]*:[[:space:]]*true'
    and ${table.draftPayload}::text !~* '"[^"[:space:]]*(token|secret|authorization|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
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

/**
 * Immutable, tenant-scoped cadence profiles. A profile is advisory-only: it
 * constrains decision tempo but cannot authorize, approve, or execute work.
 */
export const decisionCadenceProfileRevisions = pgTable("decision_cadence_profile_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  profileRef: text("profile_ref").notNull(),
  revision: integer("revision").notNull(),
  profileVersion: text("profile_version").notNull(),
  profileHash: text("profile_hash").notNull(),
  profilePayload: jsonb("profile_payload").$type<Record<string, unknown>>().notNull(),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.adAccountId], foreignColumns: [adAccounts.workspaceId, adAccounts.id], name: "decision_cadence_profile_revisions_account_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.campaignId], foreignColumns: [adCampaigns.workspaceId, adCampaigns.id], name: "decision_cadence_profile_revisions_campaign_scope_fk" }).onDelete("cascade"),
  uniqueIndex("decision_cadence_profile_revisions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("decision_cadence_profile_revisions_workspace_ref_revision_unique").on(table.workspaceId, table.profileRef, table.revision),
  uniqueIndex("decision_cadence_profile_revisions_workspace_ref_hash_unique").on(table.workspaceId, table.profileRef, table.profileHash),
  uniqueIndex("decision_cadence_profile_revisions_workspace_current_unique").on(table.workspaceId, table.profileRef).where(sql`${table.supersededAt} is null`),
  index("decision_cadence_profile_revisions_scope_idx").on(table.workspaceId, table.adAccountId, table.campaignId, table.profileRef),
  check("decision_cadence_profile_revisions_shape", sql`(
    ${table.profileRef} ~ '^cadence_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.revision} >= 1 and ${table.profileVersion} = 'decision-cadence/1.0.0'
    and ${table.profileHash} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${table.profilePayload}) = 'object'
    and ${table.profilePayload} #>> '{version}' = ${table.profileVersion}
  ) is true`),
  check("decision_cadence_profile_revisions_no_forbidden_material", sql`
    ${table.profilePayload}::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and ${table.profilePayload}::text !~* '"authorization"[[:space:]]*:'
    and ${table.profilePayload}::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  `),
]);

/** Immutable experiment plan/outcome chain. It is advisory evidence, never an execution command. */
export const experimentRecordRevisions = pgTable("experiment_record_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull(), campaignId: uuid("campaign_id").notNull(),
  cadenceProfileRevisionId: uuid("cadence_profile_revision_id").notNull(),
  experimentRef: text("experiment_ref").notNull(), sequence: integer("sequence").notNull(),
  previousRecordHash: text("previous_record_hash").notNull(), recordHash: text("record_hash").notNull(),
  eventType: text("event_type").notNull(), planHash: text("plan_hash").notNull(),
  planPayload: jsonb("plan_payload").$type<Record<string, unknown>>().notNull(),
  outcomePayload: jsonb("outcome_payload").$type<Record<string, unknown>>(),
  actorRef: text("actor_ref").notNull(), actorRole: text("actor_role").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.adAccountId], foreignColumns: [adAccounts.workspaceId, adAccounts.id], name: "experiment_record_revisions_account_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.campaignId], foreignColumns: [adCampaigns.workspaceId, adCampaigns.id], name: "experiment_record_revisions_campaign_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.cadenceProfileRevisionId], foreignColumns: [decisionCadenceProfileRevisions.workspaceId, decisionCadenceProfileRevisions.id], name: "experiment_record_revisions_cadence_profile_scope_fk" }).onDelete("restrict"),
  uniqueIndex("experiment_record_revisions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("experiment_record_revisions_sequence_unique").on(table.workspaceId, table.experimentRef, table.sequence),
  uniqueIndex("experiment_record_revisions_hash_unique").on(table.workspaceId, table.recordHash),
  index("experiment_record_revisions_scope_idx").on(table.workspaceId, table.adAccountId, table.campaignId, table.occurredAt),
  check("experiment_record_revisions_shape", sql`(
    ${table.experimentRef} ~ '^experiment_[a-f0-9]{20}$' and ${table.sequence} >= 1
    and (${table.previousRecordHash} = 'GENESIS' or ${table.previousRecordHash} ~ '^[a-f0-9]{64}$')
    and ${table.recordHash} ~ '^[a-f0-9]{64}$' and ${table.planHash} ~ '^[a-f0-9]{64}$'
    and ${table.eventType} in ('planned', 'outcome_recorded') and ${table.actorRole} in ('owner', 'admin', 'analyst')
    and jsonb_typeof(${table.planPayload}) = 'object' and ${table.planPayload} #>> '{version}' = 'decision-experiment/1.0.0'
    and ((${table.eventType} = 'planned' and ${table.sequence} = 1 and ${table.previousRecordHash} = 'GENESIS' and ${table.outcomePayload} is null)
      or (${table.eventType} = 'outcome_recorded' and ${table.sequence} > 1 and ${table.outcomePayload} is not null
        and jsonb_typeof(${table.outcomePayload}) = 'object' and ${table.outcomePayload} #>> '{version}' = 'decision-experiment/1.0.0'
        and ${table.outcomePayload} #>> '{actionAuthority}' = 'none'))
  ) is true`),
  check("experiment_record_revisions_no_forbidden_material", sql`
    concat_ws('|', ${table.planPayload}::text, ${table.outcomePayload}::text) !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and concat_ws('|', ${table.planPayload}::text, ${table.outcomePayload}::text) !~* '"authorization"[[:space:]]*:'
  `),
]);

/**
 * Canonical owner-entered/CSV business evidence. The source is represented only
 * by its opaque ref and SHA-256 content hash; raw CSV or CRM material is never
 * persisted here.
 */
export const businessOutcomeBatches = pgTable("business_outcome_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  batchId: text("batch_id").notNull(),
  sourceKind: text("source_kind").notNull(), sourceRef: text("source_ref").notNull(), contentHash: text("content_hash").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  actorRef: text("actor_ref").notNull(), actorRole: text("actor_role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("business_outcome_batches_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("business_outcome_batches_workspace_batch_unique").on(table.workspaceId, table.batchId),
  uniqueIndex("business_outcome_batches_workspace_source_unique").on(table.workspaceId, table.sourceRef, table.contentHash),
  index("business_outcome_batches_workspace_observed_idx").on(table.workspaceId, table.observedAt),
  check("business_outcome_batches_shape", sql`(
    ${table.batchId} ~ '^outcome_batch_[a-f0-9]{24}$' and ${table.sourceKind} in ('manual', 'csv')
    and ${table.sourceRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.contentHash} ~ '^[a-f0-9]{64}$'
    and ${table.actorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.actorRole} in ('owner', 'admin', 'analyst')
  ) is true`),
]);

/** Immutable normalized signal rows; these are business evidence, never Meta metrics or action authority. */
export const businessOutcomeSignals = pgTable("business_outcome_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  batchId: text("batch_id").notNull(), signalRef: text("signal_ref").notNull(), entityRef: text("entity_ref").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), outcomeKind: text("outcome_kind").notNull(),
  quantity: integer("quantity").notNull(), valueMinor: bigint("value_minor", { mode: "number" }), currency: text("currency"),
  metaEntityRef: text("meta_entity_ref"), mappingStatus: text("mapping_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.batchId], foreignColumns: [businessOutcomeBatches.workspaceId, businessOutcomeBatches.batchId], name: "business_outcome_signals_batch_scope_fk" }).onDelete("cascade"),
  uniqueIndex("business_outcome_signals_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("business_outcome_signals_workspace_signal_unique").on(table.workspaceId, table.signalRef),
  index("business_outcome_signals_entity_time_idx").on(table.workspaceId, table.entityRef, table.occurredAt),
  index("business_outcome_signals_outcome_time_idx").on(table.workspaceId, table.outcomeKind, table.occurredAt),
  check("business_outcome_signals_shape", sql`(
    ${table.signalRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.entityRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.outcomeKind} in ('qualified_lead', 'appointment', 'sale', 'revenue', 'invalid_lead') and ${table.quantity} >= 1
    and ${table.mappingStatus} in ('verified', 'unmapped')
    and ((${table.outcomeKind} = 'revenue' and ${table.valueMinor} >= 0 and ${table.currency} ~ '^[A-Z]{3}$')
      or (${table.outcomeKind} <> 'revenue' and ${table.valueMinor} is null and ${table.currency} is null))
    and ((${table.mappingStatus} = 'verified' and ${table.metaEntityRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$')
      or (${table.mappingStatus} = 'unmapped' and ${table.metaEntityRef} is null))
  ) is true`),
]);

/** Mutable per-entity head. Immutable evidence snapshots retain every historical head they used. */
export const businessOutcomeEntityHeads = pgTable("business_outcome_entity_heads", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  entityRef: text("entity_ref").notNull(),
  currentRevision: integer("current_revision").notNull().default(0),
  currentHeadHash: text("current_head_hash"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("business_outcome_entity_heads_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("business_outcome_entity_heads_workspace_entity_unique").on(table.workspaceId, table.entityRef),
  check("business_outcome_entity_heads_shape", sql`(
    ${table.entityRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and ${table.currentRevision} >= 0
    and ((${table.currentRevision} = 0 and ${table.currentHeadHash} is null) or (${table.currentRevision} > 0 and ${table.currentHeadHash} ~ '^[a-f0-9]{64}$'))
  ) is true`),
]);

/** Immutable L4 evidence snapshots, bound to one exact entity-head and time window. */
export const businessOutcomeEvidenceSnapshots = pgTable("business_outcome_evidence_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  evidenceRef: text("evidence_ref").notNull(), evidenceHash: text("evidence_hash").notNull(),
  entityRef: text("entity_ref").notNull(), sourceHeadHash: text("source_head_hash").notNull(), sourceManifestHash: text("source_manifest_hash").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(), windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  materializedAt: timestamp("materialized_at", { withTimezone: true }).notNull(), evidencePayload: jsonb("evidence_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("business_outcome_evidence_snapshots_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("business_outcome_evidence_snapshots_workspace_hash_unique").on(table.workspaceId, table.evidenceHash),
  uniqueIndex("business_outcome_evidence_snapshots_workspace_ref_unique").on(table.workspaceId, table.evidenceRef),
  index("business_outcome_evidence_snapshots_lookup_idx").on(table.workspaceId, table.entityRef, table.sourceHeadHash, table.windowStart, table.windowEnd),
  check("business_outcome_evidence_snapshots_shape", sql`(
    ${table.evidenceRef} ~ '^outcome_evidence_[a-f0-9]{24}$' and ${table.evidenceHash} ~ '^[a-f0-9]{64}$'
    and ${table.entityRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.sourceHeadHash} ~ '^[a-f0-9]{64}$' and ${table.sourceManifestHash} ~ '^[a-f0-9]{64}$'
    and ${table.windowStart} < ${table.windowEnd} and jsonb_typeof(${table.evidencePayload}) = 'object'
  ) is true`),
  check("business_outcome_evidence_snapshots_payload_exact", sql`(
    ${table.evidencePayload} #>> '{version}' = 'business-outcome-evidence/1.0.0'
    and ${table.evidencePayload} #>> '{evidenceRef}' = ${table.evidenceRef}
    and ${table.evidencePayload} #>> '{evidenceHash}' = ${table.evidenceHash}
    and ${table.evidencePayload} #>> '{entityRef}' = ${table.entityRef}
    and ${table.evidencePayload} #>> '{sourceHeadHash}' = ${table.sourceHeadHash}
    and ${table.evidencePayload} #>> '{sourceManifestHash}' = ${table.sourceManifestHash}
    and (${table.evidencePayload} #>> '{windowStart}')::timestamptz = ${table.windowStart}
    and (${table.evidencePayload} #>> '{windowEnd}')::timestamptz = ${table.windowEnd}
    and (${table.evidencePayload} #>> '{materializedAt}')::timestamptz = ${table.materializedAt}
  ) is true`),
  check("business_outcome_evidence_snapshots_no_forbidden_material", sql`
    ${table.evidencePayload}::text !~* '"[^"[:space:]]*(token|secret|content_hash|raw[_-]?(payload|request|response|json)|actor|audit)"[[:space:]]*:'
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
  /** Null only for legacy assets created before A10.2; new assets must bind both fields. */
  cadenceProfileRevisionId: uuid("cadence_profile_revision_id"),
  cadenceProfileHash: text("cadence_profile_hash"),
  /** Null only for legacy assets; newly claimed runs freeze their exact agenda contract. */
  agendaHash: text("agenda_hash"),
  agendaPayload: jsonb("agenda_payload").$type<Record<string, unknown>>(),
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
  foreignKey({
    columns: [table.workspaceId, table.cadenceProfileRevisionId],
    foreignColumns: [decisionCadenceProfileRevisions.workspaceId, decisionCadenceProfileRevisions.id],
    name: "decision_room_run_analysis_assets_cadence_profile_scope_fk",
  }).onDelete("restrict"),
  uniqueIndex("decision_room_run_analysis_assets_run_unique").on(table.workspaceId, table.runId),
  uniqueIndex("decision_room_run_analysis_assets_hash_unique").on(table.workspaceId, table.assetHash),
  index("decision_room_run_analysis_assets_template_idx").on(table.templateDefinitionId),
  index("decision_room_run_analysis_assets_timeframe_idx").on(table.timeframeDefinitionId),
  index("decision_room_run_analysis_assets_context_idx").on(table.contextId),
  index("decision_room_run_analysis_assets_cadence_profile_idx").on(table.cadenceProfileRevisionId),
  check("decision_room_run_analysis_assets_shape", sql`(
    ${table.assetHash} ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(${table.resolvedTimeframe}) = 'object'
    and ${table.resolvedTimeframe} #>> '{resolverVersion}' = 'analysis-timeframe-resolver/1.0.0'
    and ((${table.cadenceProfileRevisionId} is null and ${table.cadenceProfileHash} is null)
      or (${table.cadenceProfileRevisionId} is not null and ${table.cadenceProfileHash} ~ '^[a-f0-9]{64}$'))
    and ((${table.agendaHash} is null and ${table.agendaPayload} is null)
      or (${table.agendaHash} ~ '^[a-f0-9]{64}$'
        and jsonb_typeof(${table.agendaPayload}) = 'object'
        and ${table.agendaPayload} #>> '{contractVersion}' = 'analysis-agenda/2.0.0'
        and ${table.agendaPayload} #>> '{agendaHash}' = ${table.agendaHash}))
  ) is true`),
]);

/** Immutable, advisory-only guidance revision selection frozen on first analysis-run claim. */
export const guidanceAnalysisRunBindings = pgTable("guidance_analysis_run_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull(),
  registryHash: text("registry_hash").notNull(),
  packHash: text("pack_hash").notNull(),
  selectedSetRefs: jsonb("selected_set_refs").$type<readonly Readonly<{
    setRef: string; version: number; recordHash: string;
  }>[]>().notNull(),
  cardRefs: jsonb("card_refs").$type<readonly Readonly<{
    cardRef: string; version: number; recordHash: string;
  }>[]>().notNull(),
  sourceRefs: jsonb("source_refs").$type<readonly Readonly<{
    sourceRef: string; version: number; recordHash: string;
  }>[]>().notNull(),
  authority: text("authority").notNull().default("guidance_only"),
  bindingHash: text("binding_hash").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.runId],
    foreignColumns: [decisionRoomRuns.workspaceId, decisionRoomRuns.id],
    name: "guidance_analysis_run_bindings_run_scope_fk",
  }).onDelete("cascade"),
  uniqueIndex("guidance_analysis_run_bindings_run_unique").on(table.workspaceId, table.runId),
  uniqueIndex("guidance_analysis_run_bindings_hash_unique").on(table.workspaceId, table.bindingHash),
  index("guidance_analysis_run_bindings_run_idx").on(table.runId),
  check("guidance_analysis_run_bindings_hashes", sql`
    ${table.registryHash} ~ '^[a-f0-9]{64}$' and ${table.packHash} ~ '^[a-f0-9]{64}$'
    and ${table.bindingHash} ~ '^[a-f0-9]{64}$'
  `),
  check("guidance_analysis_run_bindings_arrays", sql`
    jsonb_typeof(${table.selectedSetRefs}) = 'array'
    and jsonb_typeof(${table.cardRefs}) = 'array'
    and jsonb_typeof(${table.sourceRefs}) = 'array'
    and jsonb_array_length(${table.selectedSetRefs}) <= 50
    and jsonb_array_length(${table.cardRefs}) <= 500
    and jsonb_array_length(${table.sourceRefs}) <= 1000
  `),
  check("guidance_analysis_run_bindings_guidance_only", sql`${table.authority} = 'guidance_only'`),
  check("guidance_analysis_run_bindings_no_forbidden_material", sql`
    concat_ws('|', ${table.selectedSetRefs}::text, ${table.cardRefs}::text, ${table.sourceRefs}::text)
      !~* '(token|secret|prompt|raw[_-]?(payload|request|response|json)|authorization|canwrite|canauthorize|canexecute|canenforce)'
  `),
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
  uniqueIndex("meta_daily_insights_workspace_id_unique").on(table.workspaceId, table.id),
  index("meta_daily_insights_workspace_account_date_idx").on(table.workspaceId, table.adAccountId, table.dateStart),
  index("meta_daily_insights_run_idx").on(table.syncRunId),
]);

/** Immutable, canonical-only L2 metric features. They never grant action authority. */
export const deterministicFeatureSnapshots = pgTable("deterministic_feature_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull(),
  adAccountId: uuid("ad_account_id").notNull(),
  entityLevel: metaInsightEntityLevel("entity_level").notNull(),
  externalEntityId: text("external_entity_id").notNull(),
  featureRef: text("feature_ref").notNull(),
  featureHash: text("feature_hash").notNull(),
  observationRef: text("observation_ref").notNull(),
  role: text("role").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  timezone: text("timezone").notNull(),
  sampleSize: integer("sample_size").notNull(),
  settled: boolean("settled").notNull(),
  qualityStatus: text("quality_status").notNull(),
  qualityReasonCodes: jsonb("quality_reason_codes").$type<readonly string[]>().notNull(),
  sourceManifestHash: text("source_manifest_hash").notNull(),
  formulaCatalogVersion: text("formula_catalog_version").notNull(),
  metricResult: jsonb("metric_result").$type<Record<string, unknown>>().notNull(),
  featurePayload: jsonb("feature_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.metaConnectionId], foreignColumns: [metaConnections.workspaceId, metaConnections.id], name: "deterministic_feature_snapshots_connection_scope_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.adAccountId], foreignColumns: [adAccounts.workspaceId, adAccounts.id], name: "deterministic_feature_snapshots_account_scope_fk" }).onDelete("restrict"),
  uniqueIndex("deterministic_feature_snapshots_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("deterministic_feature_snapshots_workspace_ref_unique").on(table.workspaceId, table.featureRef),
  uniqueIndex("deterministic_feature_snapshots_workspace_hash_unique").on(table.workspaceId, table.featureHash),
  index("deterministic_feature_snapshots_scope_window_idx").on(table.workspaceId, table.adAccountId, table.entityLevel, table.externalEntityId, table.startDate, table.endDate),
  check("deterministic_feature_snapshots_shape", sql`${table.featureRef} ~ '^feature_[a-f0-9]{24}$' and ${table.featureHash} ~ '^[a-f0-9]{64}$' and ${table.sourceManifestHash} ~ '^[a-f0-9]{64}$' and ${table.sampleSize} >= 0 and ${table.role} in ('primary', 'comparison', 'series', 'pre', 'post') and ${table.qualityStatus} in ('ready', 'degraded') and ${table.featurePayload} #>> '{featureRef}' = ${table.featureRef} and ${table.featurePayload} #>> '{featureHash}' = ${table.featureHash}`),
  check("deterministic_feature_snapshots_payload_object", sql`jsonb_typeof(${table.featurePayload}) = 'object' and jsonb_typeof(${table.metricResult}) = 'object' and jsonb_typeof(${table.qualityReasonCodes}) = 'array'`),
  check("deterministic_feature_snapshots_no_authority", sql`${table.featurePayload} #> '{capabilities,containsRawL0}' = 'false'::jsonb and ${table.featurePayload} #> '{capabilities,canAuthorizeAction}' = 'false'::jsonb and ${table.featurePayload} #> '{capabilities,canExecuteWrite}' = 'false'::jsonb`),
]);

/** Exact relational L1 manifest retained for every immutable L2 feature. */
export const deterministicFeatureSnapshotSources = pgTable("deterministic_feature_snapshot_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  featureSnapshotId: uuid("feature_snapshot_id").notNull(),
  dailyInsightId: uuid("daily_insight_id").notNull(),
  snapshotRef: text("snapshot_ref").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.featureSnapshotId], foreignColumns: [deterministicFeatureSnapshots.workspaceId, deterministicFeatureSnapshots.id], name: "deterministic_feature_snapshot_sources_feature_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.dailyInsightId], foreignColumns: [metaDailyInsights.workspaceId, metaDailyInsights.id], name: "deterministic_feature_snapshot_sources_insight_scope_fk" }).onDelete("restrict"),
  uniqueIndex("deterministic_feature_snapshot_sources_exact_unique").on(table.featureSnapshotId, table.dailyInsightId),
  uniqueIndex("deterministic_feature_snapshot_sources_snapshot_unique").on(table.featureSnapshotId, table.snapshotRef),
  index("deterministic_feature_snapshot_sources_insight_idx").on(table.workspaceId, table.dailyInsightId),
  check("deterministic_feature_snapshot_sources_shape", sql`${table.snapshotRef} ~ '^snapshot_[a-f0-9]{32}$' and ${table.contentHash} ~ '^[a-f0-9]{64}$'`),
]);

/** Immutable evidence that a canonical L1 input changed after an L2 feature captured it. */
export const deterministicFeatureSnapshotInvalidations = pgTable("deterministic_feature_snapshot_invalidations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  eventHash: text("event_hash").notNull(),
  featureSnapshotId: uuid("feature_snapshot_id").notNull(),
  dailyInsightId: uuid("daily_insight_id").notNull(),
  previousSourcePayloadHash: text("previous_source_payload_hash").notNull(),
  currentSourcePayloadHash: text("current_source_payload_hash").notNull(),
  reasonCode: text("reason_code").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.featureSnapshotId], foreignColumns: [deterministicFeatureSnapshots.workspaceId, deterministicFeatureSnapshots.id], name: "deterministic_feature_snapshot_invalidations_feature_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.dailyInsightId], foreignColumns: [metaDailyInsights.workspaceId, metaDailyInsights.id], name: "deterministic_feature_snapshot_invalidations_insight_scope_fk" }).onDelete("restrict"),
  uniqueIndex("deterministic_feature_snapshot_invalidations_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("deterministic_feature_snapshot_invalidations_workspace_event_unique").on(table.workspaceId, table.eventHash),
  index("deterministic_feature_snapshot_invalidations_feature_idx").on(table.workspaceId, table.featureSnapshotId),
  index("deterministic_feature_snapshot_invalidations_insight_idx").on(table.workspaceId, table.dailyInsightId),
  check("deterministic_feature_snapshot_invalidations_shape", sql`${table.eventHash} ~ '^[a-f0-9]{64}$' and ${table.reasonCode} = 'l1_source_changed' and ${table.previousSourcePayloadHash} <> ${table.currentSourcePayloadHash}`),
]);

/** Immutable L3 window evidence, bound to the exact ready L2 feature set. */
export const deterministicWindowSnapshots = pgTable("deterministic_window_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull(), adAccountId: uuid("ad_account_id").notNull(),
  entityLevel: metaInsightEntityLevel("entity_level").notNull(), externalEntityId: text("external_entity_id").notNull(),
  windowRef: text("window_ref").notNull(), windowHash: text("window_hash").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(), endDate: date("end_date", { mode: "string" }).notNull(),
  windowPayload: jsonb("window_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.metaConnectionId], foreignColumns: [metaConnections.workspaceId, metaConnections.id], name: "deterministic_window_snapshots_connection_scope_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.adAccountId], foreignColumns: [adAccounts.workspaceId, adAccounts.id], name: "deterministic_window_snapshots_account_scope_fk" }).onDelete("restrict"),
  uniqueIndex("deterministic_window_snapshots_workspace_id_unique").on(table.workspaceId, table.id),
  uniqueIndex("deterministic_window_snapshots_workspace_ref_unique").on(table.workspaceId, table.windowRef),
  uniqueIndex("deterministic_window_snapshots_workspace_hash_unique").on(table.workspaceId, table.windowHash),
  index("deterministic_window_snapshots_scope_idx").on(table.workspaceId, table.adAccountId, table.entityLevel, table.externalEntityId, table.startDate, table.endDate),
  check("deterministic_window_snapshots_shape", sql`${table.windowRef} ~ '^window_[a-f0-9]{24}$' and ${table.windowHash} ~ '^[a-f0-9]{64}$' and ${table.startDate} <= ${table.endDate} and ${table.windowPayload} #>> '{windowRef}' = ${table.windowRef} and ${table.windowPayload} #>> '{windowHash}' = ${table.windowHash}`),
  check("deterministic_window_snapshots_no_authority", sql`${table.windowPayload} #> '{capabilities,containsRawL0}' = 'false'::jsonb and ${table.windowPayload} #> '{capabilities,canAuthorizeAction}' = 'false'::jsonb and ${table.windowPayload} #> '{capabilities,canExecuteWrite}' = 'false'::jsonb`),
]);

/** Exact L2 lineage for an immutable L3 window; stale L2 rows are rejected by the private reader. */
export const deterministicWindowSnapshotFeatures = pgTable("deterministic_window_snapshot_features", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  windowSnapshotId: uuid("window_snapshot_id").notNull(), featureSnapshotId: uuid("feature_snapshot_id").notNull(),
  featureRef: text("feature_ref").notNull(), featureHash: text("feature_hash").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.windowSnapshotId], foreignColumns: [deterministicWindowSnapshots.workspaceId, deterministicWindowSnapshots.id], name: "deterministic_window_snapshot_features_window_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.featureSnapshotId], foreignColumns: [deterministicFeatureSnapshots.workspaceId, deterministicFeatureSnapshots.id], name: "deterministic_window_snapshot_features_feature_scope_fk" }).onDelete("restrict"),
  uniqueIndex("deterministic_window_snapshot_features_exact_unique").on(table.windowSnapshotId, table.featureSnapshotId),
  uniqueIndex("deterministic_window_snapshot_features_ref_unique").on(table.windowSnapshotId, table.featureRef),
  index("deterministic_window_snapshot_features_feature_idx").on(table.workspaceId, table.featureSnapshotId),
  check("deterministic_window_snapshot_features_shape", sql`${table.featureRef} ~ '^feature_[a-f0-9]{24}$' and ${table.featureHash} ~ '^[a-f0-9]{64}$'`),
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
/** Immutable published audience selection; agents may reference but never synthesize or mutate its targeting. */
export const audiencePresetRevisions = pgTable("audience_preset_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  presetRef: text("preset_ref").notNull(),
  revision: integer("revision").notNull(),
  schemaVersion: text("schema_version").notNull(),
  state: text("state").notNull(),
  audienceKind: text("audience_kind").notNull(),
  sourceRef: text("source_ref").notNull(),
  targetingHash: text("targeting_hash").notNull(),
  provenanceHash: text("provenance_hash").notNull(),
  presetHash: text("preset_hash").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("audience_preset_revisions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("audience_preset_revisions_identity_unique").on(table.workspaceId, table.presetRef, table.revision),
  uniqueIndex("audience_preset_revisions_hash_unique").on(table.workspaceId, table.presetHash),
  index("audience_preset_revisions_workspace_published_idx").on(table.workspaceId, table.publishedAt),
  check("audience_preset_revisions_shape", sql`
    ${table.revision} >= 1 and ${table.schemaVersion} = 'audience-preset/1.0.0' and ${table.state} = 'published'
    and ${table.audienceKind} in ('meta_saved_audience', 'meta_custom_audience', 'frozen_targeting_spec')
    and ${table.presetRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.sourceRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.targetingHash} ~ '^[a-f0-9]{64}$' and ${table.provenanceHash} ~ '^[a-f0-9]{64}$'
    and ${table.presetHash} ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(${table.payload}) = 'object'
    and ${table.payload} #>> '{version}' = ${table.schemaVersion}
    and ${table.payload} #>> '{presetRef}' = ${table.presetRef}
    and (${table.payload} #>> '{revision}')::integer = ${table.revision}
    and ${table.payload} #>> '{state}' = 'published'
    and ${table.payload} #>> '{source,kind}' = ${table.audienceKind}
    and ${table.payload} #>> '{source,sourceRef}' = ${table.sourceRef}
    and ${table.payload} #>> '{source,targetingHash}' = ${table.targetingHash}
    and ${table.payload} #>> '{source,provenanceHash}' = ${table.provenanceHash}
    and ${table.payload} #>> '{presetHash}' = ${table.presetHash}
  `),
  check("audience_preset_revisions_no_authority", sql`
    not jsonb_path_exists(${table.payload}, '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|authorization|grant|creative|copy|headline)$" flag "i")')
    and ${table.payload}::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  `),
]);

/** Immutable template revision bound to one immutable audience preset revision. */
export const promotionTemplateRevisions = pgTable("promotion_template_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  audiencePresetRevisionId: uuid("audience_preset_revision_id").notNull(),
  templateRef: text("template_ref").notNull(),
  revision: integer("revision").notNull(),
  schemaVersion: text("schema_version").notNull(),
  state: text("state").notNull(),
  templateHash: text("template_hash").notNull(),
  audiencePresetHash: text("audience_preset_hash").notNull(),
  actorTypeScope: jsonb("actor_type_scope").$type<readonly string[]>().notNull(),
  objectiveRef: text("objective_ref").notNull(),
  optimizationGoalRef: text("optimization_goal_ref").notNull(),
  destinationRef: text("destination_ref").notNull(),
  adSetPolicy: text("ad_set_policy").notNull(),
  budgetOwnerLevel: text("budget_owner_level").notNull(),
  budgetKind: text("budget_kind").notNull(),
  currency: text("currency").notNull(),
  budgetDefault: numeric("budget_default", { precision: 30, scale: 12 }).notNull(),
  budgetMinimum: numeric("budget_minimum", { precision: 30, scale: 12 }),
  budgetMaximum: numeric("budget_maximum", { precision: 30, scale: 12 }),
  budgetPlanVersionRef: text("budget_plan_version_ref").notNull(),
  timeframeRef: text("timeframe_ref").notNull(),
  scheduleMode: text("schedule_mode").notNull(),
  durationDays: integer("duration_days"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("promotion_template_revisions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("promotion_template_revisions_identity_unique").on(table.workspaceId, table.templateRef, table.revision),
  uniqueIndex("promotion_template_revisions_hash_unique").on(table.workspaceId, table.templateHash),
  index("promotion_template_revisions_audience_idx").on(table.audiencePresetRevisionId),
  foreignKey({ columns: [table.workspaceId, table.audiencePresetRevisionId],
    foreignColumns: [audiencePresetRevisions.workspaceId, audiencePresetRevisions.id],
    name: "promotion_template_revisions_audience_scope_fk" }).onDelete("restrict"),
  check("promotion_template_revisions_shape", sql`
    ${table.revision} >= 1 and ${table.schemaVersion} = 'promotion-template/1.0.0' and ${table.state} = 'published'
    and ${table.templateRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.templateHash} ~ '^[a-f0-9]{64}$' and ${table.audiencePresetHash} ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(${table.actorTypeScope}) = 'array' and jsonb_array_length(${table.actorTypeScope}) >= 1
    and not jsonb_path_exists(${table.actorTypeScope}, '$[*] ? (@ != "page" && @ != "instagram")')
    and ${table.adSetPolicy} in ('existing_only', 'existing_or_new_draft')
    and ${table.budgetOwnerLevel} in ('campaign', 'adset') and ${table.budgetKind} in ('daily', 'lifetime')
    and ${table.currency} ~ '^[A-Z]{3}$' and ${table.budgetDefault} >= 0
    and (${table.budgetMinimum} is null or ${table.budgetMinimum} <= ${table.budgetDefault})
    and (${table.budgetMaximum} is null or ${table.budgetMaximum} >= ${table.budgetDefault})
    and ((${table.scheduleMode} = 'continuous' and ${table.durationDays} is null)
      or (${table.scheduleMode} = 'fixed_duration' and ${table.durationDays} between 1 and 365))
    and jsonb_typeof(${table.payload}) = 'object'
    and ${table.payload} #>> '{version}' = ${table.schemaVersion}
    and ${table.payload} #>> '{templateRef}' = ${table.templateRef}
    and (${table.payload} #>> '{revision}')::integer = ${table.revision}
    and ${table.payload} #>> '{templateHash}' = ${table.templateHash}
    and ${table.payload} #>> '{audiencePreset,presetHash}' = ${table.audiencePresetHash}
    and ${table.payload} #>> '{budget,ownerLevel}' = ${table.budgetOwnerLevel}
    and ${table.payload} #>> '{budget,currency}' = ${table.currency}
    and ${table.payload} #>> '{budget,kind}' = ${table.budgetKind}
    and ${table.payload} #>> '{timeframe,timeframeRef}' = ${table.timeframeRef}
  `),
  check("promotion_template_revisions_no_authority", sql`
    not jsonb_path_exists(${table.payload}, '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|authorization|grant|creative|copy|headline)$" flag "i")')
    and ${table.payload}::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  `),
]);

/** Authentic account/Page-or-Instagram/category/campaign applicability for one immutable template revision. */
export const promotionTemplateBindings = pgTable("promotion_template_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  templateRevisionId: uuid("template_revision_id").notNull(),
  adAccountId: uuid("ad_account_id").notNull(),
  actorAssetId: uuid("actor_asset_id").notNull(),
  campaignId: uuid("campaign_id"),
  bindingRef: text("binding_ref").notNull(),
  bindingHash: text("binding_hash").notNull(),
  actorType: text("actor_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("promotion_template_bindings_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("promotion_template_bindings_identity_unique").on(table.workspaceId, table.bindingRef),
  uniqueIndex("promotion_template_bindings_hash_unique").on(table.workspaceId, table.bindingHash),
  index("promotion_template_bindings_template_idx").on(table.templateRevisionId),
  index("promotion_template_bindings_account_idx").on(table.adAccountId),
  index("promotion_template_bindings_actor_idx").on(table.actorAssetId),
  index("promotion_template_bindings_campaign_idx").on(table.campaignId),
  foreignKey({ columns: [table.workspaceId, table.templateRevisionId],
    foreignColumns: [promotionTemplateRevisions.workspaceId, promotionTemplateRevisions.id],
    name: "promotion_template_bindings_template_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.adAccountId], foreignColumns: [adAccounts.workspaceId, adAccounts.id],
    name: "promotion_template_bindings_account_scope_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.campaignId], foreignColumns: [adCampaigns.workspaceId, adCampaigns.id],
    name: "promotion_template_bindings_campaign_scope_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.actorAssetId, table.workspaceId], foreignColumns: [metaAssets.id, metaAssets.workspaceId],
    name: "promotion_template_bindings_actor_scope_fk" }).onDelete("restrict"),
  check("promotion_template_bindings_shape", sql`
    ${table.bindingRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.bindingHash} ~ '^[a-f0-9]{64}$' and ${table.actorType} in ('page', 'instagram')
    and (${table.expiresAt} is null or ${table.expiresAt} > ${table.effectiveFrom})
    and jsonb_typeof(${table.payload}) = 'object'
    and ${table.payload} #>> '{version}' = 'promotion-template-binding/1.0.0'
    and ${table.payload} #>> '{bindingRef}' = ${table.bindingRef}
    and ${table.payload} #>> '{bindingHash}' = ${table.bindingHash}
    and ${table.payload} #>> '{actor,type}' = ${table.actorType}
  `),
  check("promotion_template_bindings_no_authority", sql`
    not jsonb_path_exists(${table.payload}, '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|authorization|grant|creative|copy|headline)$" flag "i")')
    and ${table.payload}::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  `),
]);

/** Immutable category edges keep multi-category applicability normalized and tenant-bound. */
export const promotionTemplateBindingCategories = pgTable("promotion_template_binding_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  bindingId: uuid("binding_id").notNull(),
  categoryDefinitionId: uuid("category_definition_id").notNull(),
  categoryRef: text("category_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("promotion_template_binding_categories_edge_unique")
    .on(table.workspaceId, table.bindingId, table.categoryDefinitionId),
  index("promotion_template_binding_categories_binding_idx").on(table.bindingId),
  index("promotion_template_binding_categories_category_idx").on(table.categoryDefinitionId),
  foreignKey({ columns: [table.workspaceId, table.bindingId],
    foreignColumns: [promotionTemplateBindings.workspaceId, promotionTemplateBindings.id],
    name: "promotion_template_binding_categories_binding_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.categoryDefinitionId],
    foreignColumns: [categoryDefinitions.workspaceId, categoryDefinitions.id],
    name: "promotion_template_binding_categories_category_scope_fk" }).onDelete("restrict"),
  check("promotion_template_binding_categories_identity", sql`
    ${table.categoryRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
  `),
]);

/** Append-only authoring lifecycle for independently reusable immutable AudiencePreset versions. */
export const audiencePresetAuthoringRevisions = pgTable("audience_preset_authoring_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  workspaceRef: text("workspace_ref").notNull(),
  presetRef: text("preset_ref").notNull(),
  lifecycleVersion: integer("lifecycle_version").notNull(),
  previousRecordHash: text("previous_record_hash"),
  status: text("status").notNull(),
  presetRevision: integer("preset_revision").notNull(),
  presetHash: text("preset_hash").notNull(),
  presetPayload: jsonb("preset_payload").$type<Record<string, unknown>>().notNull(),
  publishedPresetHash: text("published_preset_hash"),
  publishedPresetPayload: jsonb("published_preset_payload").$type<Record<string, unknown>>(),
  actorRef: text("actor_ref").notNull(),
  actorRole: text("actor_role").notNull(),
  reasonCode: text("reason_code").notNull(),
  recordHash: text("record_hash").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("audience_preset_authoring_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("audience_preset_authoring_version_unique")
    .on(table.workspaceId, table.presetRef, table.lifecycleVersion),
  uniqueIndex("audience_preset_authoring_hash_unique").on(table.workspaceId, table.recordHash),
  index("audience_preset_authoring_current_idx").on(table.workspaceId, table.presetRef, table.lifecycleVersion),
  check("audience_preset_authoring_identity", sql`
    ${table.workspaceRef} ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.presetRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.lifecycleVersion} between 1 and 1000000 and ${table.presetRevision} between 1 and 1000000
    and ((${table.lifecycleVersion} = 1 and ${table.previousRecordHash} is null)
      or (${table.lifecycleVersion} > 1 and ${table.previousRecordHash} ~ '^[a-f0-9]{64}$'))
    and ${table.presetHash} ~ '^[a-f0-9]{64}$' and ${table.recordHash} ~ '^[a-f0-9]{64}$'
    and ${table.status} in ('draft', 'published', 'archived')
    and ${table.actorRole} in ('owner', 'admin', 'analyst')
    and (${table.status} = 'draft' or ${table.actorRole} in ('owner', 'admin'))
    and ${table.actorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.reasonCode} ~ '^[a-z][a-z0-9_]{1,63}$'
  `),
  check("audience_preset_authoring_payload_exact", sql`(
    jsonb_typeof(${table.presetPayload}) = 'object'
    and ${table.presetPayload} #>> '{version}' = 'audience-preset-draft-material/1.0.0'
    and ${table.presetPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.presetPayload} #>> '{presetRef}' = ${table.presetRef}
    and (${table.presetPayload} #>> '{revision}')::integer = ${table.presetRevision}
    and ${table.presetPayload} #>> '{materialHash}' = ${table.presetHash}
    and ${table.presetPayload} #> '{authority,canAuthorizeAction}' = 'false'::jsonb
    and ${table.presetPayload} #> '{authority,canExecuteWrite}' = 'false'::jsonb
    and ${table.presetPayload} #> '{authority,canWriteMeta}' = 'false'::jsonb
    and ${table.presetPayload} #> '{authority,canGrantApproval}' = 'false'::jsonb
    and not (${table.presetPayload} ? 'state') and not (${table.presetPayload} ? 'publishedAt')
    and ((${table.status} = 'draft' and ${table.publishedPresetHash} is null and ${table.publishedPresetPayload} is null)
      or (${table.status} = 'published' and ${table.publishedPresetHash} ~ '^[a-f0-9]{64}$'
          and ${table.publishedPresetPayload} #>> '{presetHash}' = ${table.publishedPresetHash}
          and ${table.publishedPresetPayload} #>> '{version}' = 'audience-preset/1.0.0'
          and ${table.publishedPresetPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
          and ${table.publishedPresetPayload} #>> '{presetRef}' = ${table.presetRef}
          and (${table.publishedPresetPayload} #>> '{revision}')::integer = ${table.presetRevision}
          and ${table.publishedPresetPayload} #>> '{state}' = 'published'
          and ${table.publishedPresetPayload} ? 'publishedAt'
          and (${table.publishedPresetPayload} - 'version' - 'state' - 'publishedAt' - 'presetHash')
            = (${table.presetPayload} - 'version' - 'authority' - 'materialHash'))
      or (${table.status} = 'archived' and (
        (${table.publishedPresetHash} is null and ${table.publishedPresetPayload} is null)
        or (${table.publishedPresetHash} ~ '^[a-f0-9]{64}$'
          and ${table.publishedPresetPayload} #>> '{presetHash}' = ${table.publishedPresetHash}
          and ${table.publishedPresetPayload} #>> '{version}' = 'audience-preset/1.0.0'
          and ${table.publishedPresetPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
          and ${table.publishedPresetPayload} #>> '{presetRef}' = ${table.presetRef}
          and (${table.publishedPresetPayload} #>> '{revision}')::integer = ${table.presetRevision}
          and ${table.publishedPresetPayload} #>> '{state}' = 'published'
          and ${table.publishedPresetPayload} ? 'publishedAt'
          and (${table.publishedPresetPayload} - 'version' - 'state' - 'publishedAt' - 'presetHash')
            = (${table.presetPayload} - 'version' - 'authority' - 'materialHash')))))
  ) is true`),
  check("audience_preset_authoring_no_authority", sql`
    (${table.presetPayload}::text || coalesce(${table.publishedPresetPayload}::text, ''))
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|authorization|approvalgranted)"[[:space:]]*:'
    and (${table.presetPayload}::text || coalesce(${table.publishedPresetPayload}::text, ''))
      !~* '"(canAuthorizeAction|canExecuteWrite|canWriteMeta|canGrantApproval)"[[:space:]]*:[[:space:]]*true'
  `),
]);

/** Append-only mutable template lifecycle bound to one exact published immutable preset triple. */
export const promotionTemplateAuthoringRevisions = pgTable("promotion_template_authoring_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  workspaceRef: text("workspace_ref").notNull(),
  templateRef: text("template_ref").notNull(),
  lifecycleVersion: integer("lifecycle_version").notNull(),
  previousRecordHash: text("previous_record_hash"),
  status: text("status").notNull(),
  presetRef: text("preset_ref").notNull(),
  presetRevision: integer("preset_revision").notNull(),
  presetHash: text("preset_hash").notNull(),
  presetPayload: jsonb("preset_payload").$type<Record<string, unknown>>().notNull(),
  templateRevision: integer("template_revision").notNull(),
  templateHash: text("template_hash").notNull(),
  templatePayload: jsonb("template_payload").$type<Record<string, unknown>>().notNull(),
  bindingRef: text("binding_ref").notNull(),
  bindingHash: text("binding_hash").notNull(),
  bindingPayload: jsonb("binding_payload").$type<Record<string, unknown>>().notNull(),
  publishedTemplateHash: text("published_template_hash"),
  publishedTemplatePayload: jsonb("published_template_payload").$type<Record<string, unknown>>(),
  publishedBindingHash: text("published_binding_hash"),
  publishedBindingPayload: jsonb("published_binding_payload").$type<Record<string, unknown>>(),
  actorRef: text("actor_ref").notNull(),
  actorRole: text("actor_role").notNull(),
  reasonCode: text("reason_code").notNull(),
  recordHash: text("record_hash").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("promotion_template_authoring_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("promotion_template_authoring_version_unique")
    .on(table.workspaceId, table.templateRef, table.lifecycleVersion),
  uniqueIndex("promotion_template_authoring_hash_unique").on(table.workspaceId, table.recordHash),
  index("promotion_template_authoring_current_idx").on(table.workspaceId, table.templateRef, table.lifecycleVersion),
  index("promotion_template_authoring_preset_idx")
    .on(table.workspaceId, table.presetRef, table.presetRevision, table.presetHash),
  check("promotion_template_authoring_identity", sql`
    ${table.workspaceRef} ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.templateRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.presetRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.bindingRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.lifecycleVersion} between 1 and 1000000
    and ${table.presetRevision} between 1 and 1000000 and ${table.templateRevision} between 1 and 1000000
    and ((${table.lifecycleVersion} = 1 and ${table.previousRecordHash} is null)
      or (${table.lifecycleVersion} > 1 and ${table.previousRecordHash} ~ '^[a-f0-9]{64}$'))
    and ${table.presetHash} ~ '^[a-f0-9]{64}$' and ${table.templateHash} ~ '^[a-f0-9]{64}$'
    and ${table.bindingHash} ~ '^[a-f0-9]{64}$' and ${table.recordHash} ~ '^[a-f0-9]{64}$'
    and ${table.status} in ('draft', 'published', 'archived')
    and ${table.actorRole} in ('owner', 'admin', 'analyst')
    and (${table.status} = 'draft' or ${table.actorRole} in ('owner', 'admin'))
    and ${table.actorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.reasonCode} ~ '^[a-z][a-z0-9_]{1,63}$'
  `),
  check("promotion_template_authoring_payload_exact", sql`(
    jsonb_typeof(${table.presetPayload}) = 'object'
    and jsonb_typeof(${table.templatePayload}) = 'object' and jsonb_typeof(${table.bindingPayload}) = 'object'
    and ${table.presetPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.presetPayload} #>> '{presetRef}' = ${table.presetRef}
    and (${table.presetPayload} #>> '{revision}')::integer = ${table.presetRevision}
    and ${table.presetPayload} #>> '{presetHash}' = ${table.presetHash}
    and ${table.templatePayload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.templatePayload} #>> '{templateRef}' = ${table.templateRef}
    and (${table.templatePayload} #>> '{revision}')::integer = ${table.templateRevision}
    and ${table.templatePayload} #>> '{materialHash}' = ${table.templateHash}
    and ${table.templatePayload} #>> '{audiencePreset,presetRef}' = ${table.presetRef}
    and (${table.templatePayload} #>> '{audiencePreset,revision}')::integer = ${table.presetRevision}
    and ${table.templatePayload} #>> '{audiencePreset,presetHash}' = ${table.presetHash}
    and ${table.bindingPayload} #>> '{bindingRef}' = ${table.bindingRef}
    and ${table.bindingPayload} #>> '{materialHash}' = ${table.bindingHash}
    and ${table.bindingPayload} #>> '{template,templateRef}' = ${table.templateRef}
    and (${table.bindingPayload} #>> '{template,revision}')::integer = ${table.templateRevision}
    and ${table.bindingPayload} #>> '{template,materialHash}' = ${table.templateHash}
    and not (${table.templatePayload} ? 'state') and not (${table.templatePayload} ? 'publishedAt')
    and not (${table.bindingPayload} ? 'effectiveFrom')
    and ((${table.status} = 'draft' and ${table.publishedTemplateHash} is null
      and ${table.publishedTemplatePayload} is null and ${table.publishedBindingHash} is null
      and ${table.publishedBindingPayload} is null)
      or (${table.status} = 'published' and ${table.publishedTemplateHash} ~ '^[a-f0-9]{64}$'
          and ${table.publishedBindingHash} ~ '^[a-f0-9]{64}$'
          and ${table.publishedTemplatePayload} #>> '{templateHash}' = ${table.publishedTemplateHash}
          and ${table.publishedTemplatePayload} #>> '{version}' = 'promotion-template/1.0.0'
          and ${table.publishedTemplatePayload} #>> '{workspaceRef}' = ${table.workspaceRef}
          and ${table.publishedTemplatePayload} #>> '{templateRef}' = ${table.templateRef}
          and (${table.publishedTemplatePayload} #>> '{revision}')::integer = ${table.templateRevision}
          and ${table.publishedTemplatePayload} #>> '{state}' = 'published'
          and ${table.publishedTemplatePayload} #>> '{audiencePreset,presetRef}' = ${table.presetRef}
          and (${table.publishedTemplatePayload} #>> '{audiencePreset,revision}')::integer = ${table.presetRevision}
          and ${table.publishedTemplatePayload} #>> '{audiencePreset,presetHash}' = ${table.presetHash}
          and ${table.publishedBindingPayload} #>> '{bindingHash}' = ${table.publishedBindingHash}
          and ${table.publishedBindingPayload} #>> '{version}' = 'promotion-template-binding/1.0.0'
          and ${table.publishedBindingPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
          and ${table.publishedBindingPayload} #>> '{bindingRef}' = ${table.bindingRef}
          and ${table.publishedBindingPayload} #>> '{template,templateRef}' = ${table.templateRef}
          and (${table.publishedBindingPayload} #>> '{template,revision}')::integer = ${table.templateRevision}
          and ${table.publishedBindingPayload} #>> '{template,templateHash}' = ${table.publishedTemplateHash}
          and ${table.publishedBindingPayload} ? 'effectiveFrom'
          and (${table.publishedTemplatePayload} - 'version' - 'state' - 'publishedAt' - 'templateHash')
            = (${table.templatePayload} - 'version' - 'authority' - 'materialHash')
          and (${table.publishedBindingPayload} - 'version' - 'effectiveFrom' - 'expiresAt' - 'bindingHash' - 'template')
            = (${table.bindingPayload} - 'version' - 'authority' - 'materialHash' - 'template'))
      or (${table.status} = 'archived' and (
        (${table.publishedTemplateHash} is null and ${table.publishedTemplatePayload} is null
          and ${table.publishedBindingHash} is null and ${table.publishedBindingPayload} is null)
        or (${table.publishedTemplateHash} ~ '^[a-f0-9]{64}$'
          and ${table.publishedBindingHash} ~ '^[a-f0-9]{64}$'
          and ${table.publishedTemplatePayload} #>> '{templateHash}' = ${table.publishedTemplateHash}
          and ${table.publishedTemplatePayload} #>> '{version}' = 'promotion-template/1.0.0'
          and ${table.publishedTemplatePayload} #>> '{workspaceRef}' = ${table.workspaceRef}
          and ${table.publishedTemplatePayload} #>> '{templateRef}' = ${table.templateRef}
          and (${table.publishedTemplatePayload} #>> '{revision}')::integer = ${table.templateRevision}
          and ${table.publishedTemplatePayload} #>> '{state}' = 'published'
          and ${table.publishedTemplatePayload} #>> '{audiencePreset,presetRef}' = ${table.presetRef}
          and (${table.publishedTemplatePayload} #>> '{audiencePreset,revision}')::integer = ${table.presetRevision}
          and ${table.publishedTemplatePayload} #>> '{audiencePreset,presetHash}' = ${table.presetHash}
          and ${table.publishedBindingPayload} #>> '{bindingHash}' = ${table.publishedBindingHash}
          and ${table.publishedBindingPayload} #>> '{version}' = 'promotion-template-binding/1.0.0'
          and ${table.publishedBindingPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
          and ${table.publishedBindingPayload} #>> '{bindingRef}' = ${table.bindingRef}
          and ${table.publishedBindingPayload} #>> '{template,templateRef}' = ${table.templateRef}
          and (${table.publishedBindingPayload} #>> '{template,revision}')::integer = ${table.templateRevision}
          and ${table.publishedBindingPayload} #>> '{template,templateHash}' = ${table.publishedTemplateHash}
          and ${table.publishedBindingPayload} ? 'effectiveFrom'
          and (${table.publishedTemplatePayload} - 'version' - 'state' - 'publishedAt' - 'templateHash')
            = (${table.templatePayload} - 'version' - 'authority' - 'materialHash')
          and (${table.publishedBindingPayload} - 'version' - 'effectiveFrom' - 'expiresAt' - 'bindingHash' - 'template')
            = (${table.bindingPayload} - 'version' - 'authority' - 'materialHash' - 'template')))))
  ) is true`),
  check("promotion_template_authoring_no_authority", sql`
    (${table.presetPayload}::text || ${table.templatePayload}::text || ${table.bindingPayload}::text
      || coalesce(${table.publishedTemplatePayload}::text, '') || coalesce(${table.publishedBindingPayload}::text, ''))
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|authorization|approvalgranted)"[[:space:]]*:'
    and (${table.presetPayload}::text || ${table.templatePayload}::text || ${table.bindingPayload}::text
      || coalesce(${table.publishedTemplatePayload}::text, '') || coalesce(${table.publishedBindingPayload}::text, ''))
      !~* '"(canAuthorizeAction|canExecuteWrite|canWriteMeta|canGrantApproval)"[[:space:]]*:[[:space:]]*true'
  `),
]);

export const actionApprovalPolicySnapshots = pgTable("action_approval_policy_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  sourceDefinitionId: uuid("source_definition_id"),
  sourceDefinitionCanonicalHash: text("source_definition_canonical_hash"),
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
  index("action_approval_policy_snapshots_source_definition_idx").on(table.workspaceId, table.sourceDefinitionId),
  index("action_approval_policy_snapshots_workspace_created_idx").on(table.workspaceId, table.createdAt),
  foreignKey({
    columns: [table.workspaceId, table.sourceDefinitionId, table.policyRef, table.revision,
      table.policyHash, table.sourceDefinitionCanonicalHash],
    foreignColumns: [approvalPolicyDefinitionRevisions.workspaceId, approvalPolicyDefinitionRevisions.id,
      approvalPolicyDefinitionRevisions.policyRef, approvalPolicyDefinitionRevisions.revision,
      approvalPolicyDefinitionRevisions.policyHash, approvalPolicyDefinitionRevisions.canonicalHash],
    name: "action_approval_policy_snapshots_source_definition_scope_fk",
  }).onDelete("restrict"),
  check("action_approval_policy_snapshots_revision_positive", sql`${table.revision} >= 1`),
  check("action_approval_policy_snapshots_hash_format", sql`${table.policyHash} ~ '^[a-f0-9]{64}$'`),
  check("action_approval_policy_snapshots_source_definition_exact", sql`
    (${table.sourceDefinitionId} is null and ${table.sourceDefinitionCanonicalHash} is null)
    or (${table.sourceDefinitionId} is not null and ${table.sourceDefinitionCanonicalHash} ~ '^[a-f0-9]{64}$')
  `),
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
    and ${table.policyPayload} ? 'maximumProtectionEvidenceAgeSeconds'
    and jsonb_typeof(${table.policyPayload} #> '{maximumProtectionEvidenceAgeSeconds}') = 'number'
    and (${table.policyPayload} #>> '{maximumProtectionEvidenceAgeSeconds}')::integer between 1 and 604800
    and ${table.policyPayload} ? 'maximumProposalLifetimeSeconds'
    and jsonb_typeof(${table.policyPayload} #> '{maximumProposalLifetimeSeconds}') = 'number'
    and (${table.policyPayload} #>> '{maximumProposalLifetimeSeconds}')::integer between 1 and 604800
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

/**
 * Relational evidence that an advisory action unit was built against one frozen
 * context. This is provenance only: it cannot convert a unit into executable work.
 */
export const actionProposalUnitFrozenContexts = pgTable("action_proposal_unit_frozen_contexts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  actionProposalUnitId: uuid("action_proposal_unit_id").notNull(),
  contextId: uuid("context_id").notNull(),
  contextHash: text("context_hash").notNull(),
  bindingHash: text("binding_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.actionProposalUnitId], foreignColumns: [actionProposalUnits.workspaceId, actionProposalUnits.id], name: "action_proposal_unit_frozen_contexts_unit_scope_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.contextId], foreignColumns: [effectiveCampaignContexts.workspaceId, effectiveCampaignContexts.id], name: "action_proposal_unit_frozen_contexts_context_scope_fk" }).onDelete("restrict"),
  uniqueIndex("action_proposal_unit_frozen_contexts_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("action_proposal_unit_frozen_contexts_unit_unique").on(table.actionProposalUnitId),
  index("action_proposal_unit_frozen_contexts_context_idx").on(table.workspaceId, table.contextId),
  check("action_proposal_unit_frozen_contexts_hashes", sql`${table.contextHash} ~ '^[a-f0-9]{64}$' and ${table.bindingHash} ~ '^[a-f0-9]{64}$'`),
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

/**
 * One immutable execution identity for one approved ActionUnit decision. This
 * is an admission ledger only: a row cannot itself grant a Meta write.
 */
export const actionExecutionAttempts = pgTable("action_execution_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  bundleId: uuid("bundle_id").notNull(),
  unitId: uuid("unit_id").notNull(),
  decisionEventId: uuid("decision_event_id").notNull(),
  approvalGrantId: uuid("approval_grant_id").notNull(),
  executionRef: text("execution_ref").notNull(),
  unitRef: text("unit_ref").notNull(),
  approvalDecisionRef: text("approval_decision_ref").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  admissionHash: text("admission_hash").notNull(),
  writeSpecHash: text("write_spec_hash").notNull(),
  admissionPayload: jsonb("admission_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("action_execution_attempts_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("action_execution_attempts_workspace_ref_unique").on(table.workspaceId, table.executionRef),
  uniqueIndex("action_execution_attempts_workspace_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
  uniqueIndex("action_execution_attempts_decision_unique").on(table.workspaceId, table.decisionEventId),
  index("action_execution_attempts_unit_idx").on(table.workspaceId, table.unitId, table.createdAt),
  foreignKey({ columns: [table.workspaceId, table.bundleId], foreignColumns: [actionProposalBundles.workspaceId, actionProposalBundles.id], name: "action_execution_attempts_bundle_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.bundleId, table.unitId, table.unitRef], foreignColumns: [actionProposalUnits.workspaceId, actionProposalUnits.bundleId, actionProposalUnits.id, actionProposalUnits.unitRef], name: "action_execution_attempts_unit_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.decisionEventId], foreignColumns: [actionApprovalDecisionEvents.workspaceId, actionApprovalDecisionEvents.id], name: "action_execution_attempts_decision_scope_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.workspaceId, table.approvalGrantId], foreignColumns: [actionApprovalEvidenceGrants.workspaceId, actionApprovalEvidenceGrants.id], name: "action_execution_attempts_grant_scope_fk" }).onDelete("cascade"),
  check("action_execution_attempts_identity", sql`
    ${table.executionRef} ~ '^action_execution_[a-f0-9]{20}$'
    and ${table.unitRef} ~ '^action_unit_[a-f0-9]{20}$'
    and ${table.approvalDecisionRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.idempotencyKey} ~ '^[a-f0-9]{64}$'
    and ${table.admissionHash} ~ '^[a-f0-9]{64}$'
    and ${table.writeSpecHash} ~ '^[a-f0-9]{64}$'
  `),
  check("action_execution_attempts_payload_exact", sql`
    jsonb_typeof(${table.admissionPayload}) = 'object'
    and ${table.admissionPayload} #>> '{version}' = 'action-execution-admission/1.0.0'
    and ${table.admissionPayload} #>> '{unitRef}' = ${table.unitRef}
    and ${table.admissionPayload} #>> '{approvalDecisionRef}' = ${table.approvalDecisionRef}
    and ${table.admissionPayload} #>> '{admissionHash}' = ${table.admissionHash}
    and ${table.admissionPayload} #>> '{writeSpec,specHash}' = ${table.writeSpecHash}
    and ${table.admissionPayload} #>> '{disposition}' = 'admitted_for_disabled_executor'
    and ${table.admissionPayload} #>> '{capabilities,canExecute}' = 'false'
    and ${table.admissionPayload} #>> '{capabilities,canWriteMeta}' = 'false'
    and ${table.admissionPayload} #>> '{capabilities,canDispatchNetwork}' = 'false'
  `),
  check("action_execution_attempts_no_forbidden_material", sql`
    ${table.admissionPayload}::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  `),
]);

/** Append-only execution timeline. New events, never mutable status columns. */
export const actionExecutionEvents = pgTable("action_execution_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  executionAttemptId: uuid("execution_attempt_id").notNull(),
  sequence: integer("sequence").notNull(),
  eventRef: text("event_ref").notNull(),
  previousHash: text("previous_hash").notNull(),
  eventHash: text("event_hash").notNull(),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  eventPayload: jsonb("event_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("action_execution_events_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("action_execution_events_attempt_sequence_unique").on(table.executionAttemptId, table.sequence),
  uniqueIndex("action_execution_events_workspace_ref_unique").on(table.workspaceId, table.eventRef),
  uniqueIndex("action_execution_events_workspace_hash_unique").on(table.workspaceId, table.eventHash),
  index("action_execution_events_attempt_idx").on(table.workspaceId, table.executionAttemptId, table.sequence),
  foreignKey({ columns: [table.workspaceId, table.executionAttemptId], foreignColumns: [actionExecutionAttempts.workspaceId, actionExecutionAttempts.id], name: "action_execution_events_attempt_scope_fk" }).onDelete("cascade"),
  check("action_execution_events_identity", sql`
    ${table.sequence} >= 1
    and ${table.eventRef} ~ '^action_execution_event_[a-f0-9]{20}$'
    and ${table.previousHash} ~ '^[a-f0-9]{64}$'
    and ${table.eventHash} ~ '^[a-f0-9]{64}$'
    and ${table.eventType} in ('admitted', 'dispatch_claimed', 'write_accepted', 'verified', 'failed', 'parked')
  `),
  check("action_execution_events_payload_shape", sql`
    jsonb_typeof(${table.eventPayload}) = 'object'
    and ${table.eventPayload} #>> '{executionAuthority}' = 'none'
    and ${table.eventPayload} #>> '{networkDispatched}' = 'false'
  `),
  check("action_execution_events_no_forbidden_material", sql`
    ${table.eventPayload}::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  `),
]);

/**
 * Append-only normalized autonomy rules. Guidance references are provenance only;
 * publication always carries an explicit owner/admin decision and grants no execution authority.
 */
export const autonomyRuleRevisions = pgTable("autonomy_rule_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ruleRef: text("rule_ref").notNull(),
  revision: integer("revision").notNull(),
  schemaVersion: text("schema_version").notNull(),
  workspaceRef: text("workspace_ref").notNull(),
  scopeLevel: text("scope_level").notNull(),
  scopeRef: text("scope_ref"),
  entityLevel: text("entity_level"),
  actionType: text("action_type"),
  mode: text("mode").notNull(),
  state: text("state").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  killSwitch: boolean("kill_switch").notNull().default(false),
  maximumActionsPerRun: integer("maximum_actions_per_run"),
  normalizedByActorRef: text("normalized_by_actor_ref").notNull(),
  normalizedByRole: text("normalized_by_role").notNull(),
  sourceGuidanceRefs: jsonb("source_guidance_refs").$type<readonly string[]>().notNull().default([]),
  publishedByActorRef: text("published_by_actor_ref"),
  publishedByRole: text("published_by_role"),
  publicationDecisionRef: text("publication_decision_ref"),
  publicationReasonRef: text("publication_reason_ref"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  canonicalHash: text("canonical_hash").notNull(),
  artifactPayload: jsonb("artifact_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("autonomy_rule_revisions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("autonomy_rule_revisions_workspace_ref_revision_unique")
    .on(table.workspaceId, table.ruleRef, table.revision),
  uniqueIndex("autonomy_rule_revisions_workspace_hash_unique").on(table.workspaceId, table.canonicalHash),
  index("autonomy_rule_revisions_workspace_state_ref_revision_idx")
    .on(table.workspaceId, table.state, table.ruleRef, table.revision),
  check("autonomy_rule_revisions_identity", sql`
    ${table.revision} >= 1 and ${table.revision} <= 1000000
    and ${table.schemaVersion} = 'autonomy-rule-artifact/1.0.0'
    and ${table.ruleRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.workspaceRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.normalizedByActorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.canonicalHash} ~ '^[a-f0-9]{64}$'
  `),
  check("autonomy_rule_revisions_mode_state", sql`
    ${table.mode} in ('denied', 'approval_only', 'policy_limited')
    and ${table.state} in ('draft', 'published', 'disabled')
    and ${table.normalizedByRole} in ('owner', 'admin', 'analyst')
    and (${table.maximumActionsPerRun} is null or ${table.maximumActionsPerRun} between 1 and 1000000)
    and (not ${table.killSwitch} or ${table.mode} = 'denied')
    and (${table.expiresAt} is null or ${table.expiresAt} > ${table.effectiveFrom})
  `),
  check("autonomy_rule_revisions_scope", sql`
    (${table.scopeLevel} = 'action_type' and ${table.scopeRef} is null and ${table.entityLevel} is null
      and ${table.actionType} in ('no_change', 'internal_annotation', 'status_pause', 'status_activate',
        'budget_decrease', 'budget_increase', 'existing_post_promotion'))
    or (${table.scopeLevel} = 'entity' and ${table.scopeRef} is not null
      and ${table.entityLevel} in ('campaign', 'adset', 'ad') and ${table.actionType} is null)
    or (${table.scopeLevel} in ('workspace', 'account_group', 'account', 'internal_category', 'campaign')
      and ${table.scopeRef} is not null and ${table.entityLevel} is null and ${table.actionType} is null
      and (${table.scopeLevel} <> 'workspace' or ${table.scopeRef} = ${table.workspaceRef}))
  `),
  check("autonomy_rule_revisions_publication", sql`
    (${table.state} = 'draft' and ${table.publishedByActorRef} is null and ${table.publishedByRole} is null
      and ${table.publicationDecisionRef} is null and ${table.publicationReasonRef} is null and ${table.publishedAt} is null)
    or (${table.state} in ('published', 'disabled') and ${table.publishedByActorRef} is not null
      and ${table.publishedByRole} in ('owner', 'admin') and ${table.publicationDecisionRef} is not null
      and ${table.publicationReasonRef} is not null and ${table.publishedAt} is not null)
  `),
  check("autonomy_rule_revisions_guidance_metadata", sql`
    jsonb_typeof(${table.sourceGuidanceRefs}) = 'array'
    and jsonb_array_length(${table.sourceGuidanceRefs}) <= 100
  `),
  check("autonomy_rule_revisions_payload_exact", sql`
    jsonb_typeof(${table.artifactPayload}) = 'object'
    and ${table.artifactPayload} #>> '{version}' = ${table.schemaVersion}
    and ${table.artifactPayload} #>> '{ruleRef}' = ${table.ruleRef}
    and (${table.artifactPayload} #>> '{revision}')::integer = ${table.revision}
    and ${table.artifactPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.artifactPayload} #>> '{scope,level}' = ${table.scopeLevel}
    and (${table.artifactPayload} #>> '{scope,ref}') is not distinct from ${table.scopeRef}
    and (${table.artifactPayload} #>> '{scope,entityLevel}') is not distinct from ${table.entityLevel}
    and (${table.artifactPayload} #>> '{scope,actionType}') is not distinct from ${table.actionType}
    and ${table.artifactPayload} #>> '{mode}' = ${table.mode}
    and ${table.artifactPayload} #>> '{state}' = ${table.state}
    and (${table.artifactPayload} #>> '{effectiveFrom}')::timestamptz = ${table.effectiveFrom}
    and (${table.artifactPayload} #>> '{expiresAt}')::timestamptz is not distinct from ${table.expiresAt}
    and (${table.artifactPayload} #>> '{killSwitch}')::boolean = ${table.killSwitch}
    and (${table.artifactPayload} #>> '{maximumActionsPerRun}')::integer is not distinct from ${table.maximumActionsPerRun}
    and ${table.artifactPayload} #>> '{provenance,normalizedByActorRef}' = ${table.normalizedByActorRef}
    and ${table.artifactPayload} #>> '{provenance,normalizedByRole}' = ${table.normalizedByRole}
    and ${table.artifactPayload} #> '{provenance,sourceGuidanceRefs}' = ${table.sourceGuidanceRefs}
    and (${table.artifactPayload} #>> '{provenance,publishedByActorRef}') is not distinct from ${table.publishedByActorRef}
    and (${table.artifactPayload} #>> '{provenance,publishedByRole}') is not distinct from ${table.publishedByRole}
    and (${table.artifactPayload} #>> '{provenance,publicationDecisionRef}') is not distinct from ${table.publicationDecisionRef}
    and (${table.artifactPayload} #>> '{provenance,publicationReasonRef}') is not distinct from ${table.publicationReasonRef}
    and (${table.artifactPayload} #>> '{provenance,publishedAt}')::timestamptz is not distinct from ${table.publishedAt}
    and ${table.artifactPayload} #>> '{canonicalHash}' = ${table.canonicalHash}
    and ${table.artifactPayload} #>> '{authority,canExecute}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canWriteMeta}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canGrantApproval}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canPromoteGuidance}' = 'false'
  `),
  check("autonomy_rule_revisions_no_forbidden_material", sql`
    ${table.artifactPayload}::text
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|free[_-]?text)"[[:space:]]*:'
  `),
]);

/**
 * Tenant-bound, append-only action guardrail policy revisions. Guidance is
 * provenance only; these records grant no approval, execution, or Meta authority.
 */
export const actionGuardrailPolicyRevisions = pgTable("action_guardrail_policy_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  workspaceRef: text("workspace_ref").notNull(),
  policyRef: text("policy_ref").notNull(),
  revision: integer("revision").notNull(),
  previousHash: text("previous_hash"),
  schemaVersion: text("schema_version").notNull(),
  state: text("state").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  defaultDisposition: text("default_disposition").notNull(),
  actionTypes: jsonb("action_types").$type<readonly string[]>().notNull(),
  accountRefs: jsonb("account_refs").$type<readonly string[]>().notNull(),
  campaignRefs: jsonb("campaign_refs").$type<readonly string[]>().notNull(),
  entities: jsonb("entities").$type<readonly Record<string, unknown>[]>().notNull(),
  internalCategoryRefs: jsonb("internal_category_refs").$type<readonly string[]>().notNull(),
  geoRefs: jsonb("geo_refs").$type<readonly string[]>().notNull(),
  clauses: jsonb("clauses").$type<readonly Record<string, unknown>[]>().notNull(),
  normalizedByActorRef: text("normalized_by_actor_ref").notNull(),
  normalizedByRole: text("normalized_by_role").notNull(),
  sourceGuidanceRefs: jsonb("source_guidance_refs").$type<readonly string[]>().notNull().default([]),
  publishedByActorRef: text("published_by_actor_ref"),
  publishedByRole: text("published_by_role"),
  publicationDecisionRef: text("publication_decision_ref"),
  publicationReasonRef: text("publication_reason_ref"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  disabledByActorRef: text("disabled_by_actor_ref"),
  disabledByRole: text("disabled_by_role"),
  disableDecisionRef: text("disable_decision_ref"),
  disableReasonRef: text("disable_reason_ref"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  canonicalHash: text("canonical_hash").notNull(),
  artifactPayload: jsonb("artifact_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("action_guardrail_policy_revisions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("action_guardrail_policy_revisions_workspace_ref_revision_unique")
    .on(table.workspaceId, table.policyRef, table.revision),
  uniqueIndex("action_guardrail_policy_revisions_workspace_hash_unique").on(table.workspaceId, table.canonicalHash),
  index("action_guardrail_policy_revisions_resolve_idx")
    .on(table.workspaceId, table.state, table.policyRef, table.revision),
  check("action_guardrail_policy_revisions_identity", sql`
    ${table.schemaVersion} = 'action-guardrail-policy/1.0.0'
    and ${table.revision} between 1 and 1000000
    and ${table.workspaceRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.policyRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.normalizedByActorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ((${table.revision} = 1 and ${table.previousHash} is null)
      or (${table.revision} > 1 and ${table.previousHash} ~ '^[a-f0-9]{64}$'))
    and ${table.canonicalHash} ~ '^[a-f0-9]{64}$'
  `),
  check("action_guardrail_policy_revisions_lifecycle", sql`
    ${table.state} in ('draft', 'published', 'disabled')
    and ${table.normalizedByRole} in ('owner', 'admin', 'analyst')
    and ${table.defaultDisposition} = 'allow_if_no_matching_deny'
    and (${table.expiresAt} is null or ${table.expiresAt} > ${table.effectiveFrom})
    and ((${table.state} = 'draft' and ${table.publishedByActorRef} is null and ${table.publishedByRole} is null
      and ${table.publicationDecisionRef} is null and ${table.publicationReasonRef} is null and ${table.publishedAt} is null
      and ${table.disabledByActorRef} is null and ${table.disabledByRole} is null
      and ${table.disableDecisionRef} is null and ${table.disableReasonRef} is null and ${table.disabledAt} is null)
      or (${table.state} = 'published' and ${table.publishedByActorRef} is not null
        and ${table.publishedByRole} in ('owner', 'admin') and ${table.publicationDecisionRef} is not null
        and ${table.publicationReasonRef} is not null and ${table.publishedAt} is not null
        and ${table.disabledByActorRef} is null and ${table.disabledByRole} is null
        and ${table.disableDecisionRef} is null and ${table.disableReasonRef} is null and ${table.disabledAt} is null)
      or (${table.state} = 'disabled' and ${table.publishedByActorRef} is not null
        and ${table.publishedByRole} in ('owner', 'admin') and ${table.publicationDecisionRef} is not null
        and ${table.publicationReasonRef} is not null and ${table.publishedAt} is not null
        and ${table.disabledByActorRef} is not null and ${table.disabledByRole} in ('owner', 'admin')
        and ${table.disableDecisionRef} is not null and ${table.disableReasonRef} is not null
        and ${table.disabledAt} is not null and ${table.disabledAt} >= ${table.publishedAt}))
  `),
  check("action_guardrail_policy_revisions_selector_clauses", sql`
    jsonb_typeof(${table.actionTypes}) = 'array' and jsonb_array_length(${table.actionTypes}) between 1 and 5
    and not jsonb_path_exists(${table.actionTypes}, '$[*] ? (@ != "status_pause" && @ != "status_activate" && @ != "budget_decrease" && @ != "budget_increase" && @ != "existing_post_promotion")')
    and jsonb_typeof(${table.accountRefs}) = 'array' and jsonb_array_length(${table.accountRefs}) <= 500
    and jsonb_typeof(${table.campaignRefs}) = 'array' and jsonb_array_length(${table.campaignRefs}) <= 500
    and jsonb_typeof(${table.entities}) = 'array' and jsonb_array_length(${table.entities}) <= 500
    and jsonb_typeof(${table.internalCategoryRefs}) = 'array' and jsonb_array_length(${table.internalCategoryRefs}) <= 500
    and jsonb_typeof(${table.geoRefs}) = 'array' and jsonb_array_length(${table.geoRefs}) <= 500
    and jsonb_typeof(${table.clauses}) = 'array' and jsonb_array_length(${table.clauses}) <= 500
    and jsonb_typeof(${table.sourceGuidanceRefs}) = 'array' and jsonb_array_length(${table.sourceGuidanceRefs}) <= 500
  `),
  check("action_guardrail_policy_revisions_payload_exact", sql`
    jsonb_typeof(${table.artifactPayload}) = 'object'
    and ${table.artifactPayload} #>> '{version}' = ${table.schemaVersion}
    and ${table.artifactPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.artifactPayload} #>> '{policyRef}' = ${table.policyRef}
    and (${table.artifactPayload} #>> '{revision}')::integer = ${table.revision}
    and (${table.artifactPayload} #>> '{previousHash}') is not distinct from ${table.previousHash}
    and ${table.artifactPayload} #>> '{state}' = ${table.state}
    and (${table.artifactPayload} #>> '{effectiveFrom}')::timestamptz = ${table.effectiveFrom}
    and (${table.artifactPayload} #>> '{expiresAt}')::timestamptz is not distinct from ${table.expiresAt}
    and ${table.artifactPayload} #>> '{defaultDisposition}' = ${table.defaultDisposition}
    and ${table.artifactPayload} #> '{selector,actionTypes}' = ${table.actionTypes}
    and ${table.artifactPayload} #> '{selector,accountRefs}' = ${table.accountRefs}
    and ${table.artifactPayload} #> '{selector,campaignRefs}' = ${table.campaignRefs}
    and ${table.artifactPayload} #> '{selector,entities}' = ${table.entities}
    and ${table.artifactPayload} #> '{selector,internalCategoryRefs}' = ${table.internalCategoryRefs}
    and ${table.artifactPayload} #> '{selector,geoRefs}' = ${table.geoRefs}
    and ${table.artifactPayload} #> '{clauses}' = ${table.clauses}
    and ${table.artifactPayload} #>> '{provenance,normalizedByActorRef}' = ${table.normalizedByActorRef}
    and ${table.artifactPayload} #>> '{provenance,normalizedByRole}' = ${table.normalizedByRole}
    and ${table.artifactPayload} #> '{provenance,sourceGuidanceRefs}' = ${table.sourceGuidanceRefs}
    and (${table.artifactPayload} #>> '{provenance,publishedByActorRef}') is not distinct from ${table.publishedByActorRef}
    and (${table.artifactPayload} #>> '{provenance,publishedByRole}') is not distinct from ${table.publishedByRole}
    and (${table.artifactPayload} #>> '{provenance,publicationDecisionRef}') is not distinct from ${table.publicationDecisionRef}
    and (${table.artifactPayload} #>> '{provenance,publicationReasonRef}') is not distinct from ${table.publicationReasonRef}
    and (${table.artifactPayload} #>> '{provenance,publishedAt}')::timestamptz is not distinct from ${table.publishedAt}
    and (${table.artifactPayload} #>> '{provenance,disabledByActorRef}') is not distinct from ${table.disabledByActorRef}
    and (${table.artifactPayload} #>> '{provenance,disabledByRole}') is not distinct from ${table.disabledByRole}
    and (${table.artifactPayload} #>> '{provenance,disableDecisionRef}') is not distinct from ${table.disableDecisionRef}
    and (${table.artifactPayload} #>> '{provenance,disableReasonRef}') is not distinct from ${table.disableReasonRef}
    and (${table.artifactPayload} #>> '{provenance,disabledAt}')::timestamptz is not distinct from ${table.disabledAt}
    and ${table.artifactPayload} #>> '{authority,canApprove}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canExecute}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canWriteMeta}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canGrantApproval}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canPromoteGuidance}' = 'false'
    and ${table.artifactPayload} #>> '{canonicalHash}' = ${table.canonicalHash}
  `),
  check("action_guardrail_policy_revisions_no_forbidden_material", sql`
    ${table.artifactPayload}::text
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|free[_-]?text|authorization|approvalgranted)"[[:space:]]*:'
  `),
]);

/** Reviewed, append-only ApprovalPolicy definitions; never approval or execution authority by themselves. */
export const approvalPolicyDefinitionRevisions = pgTable("approval_policy_definition_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  workspaceRef: text("workspace_ref").notNull(),
  policyRef: text("policy_ref").notNull(),
  revision: integer("revision").notNull(),
  previousHash: text("previous_hash"),
  schemaVersion: text("schema_version").notNull(),
  actionType: text("action_type").notNull(),
  risk: text("risk").notNull(),
  state: text("state").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  normalizedByActorRef: text("normalized_by_actor_ref").notNull(),
  normalizedByRole: text("normalized_by_role").notNull(),
  publishedByActorRef: text("published_by_actor_ref"),
  publishedByRole: text("published_by_role"),
  publicationDecisionRef: text("publication_decision_ref"),
  publicationReasonRef: text("publication_reason_ref"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  disabledByActorRef: text("disabled_by_actor_ref"),
  disabledByRole: text("disabled_by_role"),
  disableDecisionRef: text("disable_decision_ref"),
  disableReasonRef: text("disable_reason_ref"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  policyHash: text("policy_hash").notNull(),
  canonicalHash: text("canonical_hash").notNull(),
  policyPayload: jsonb("policy_payload").$type<Record<string, unknown>>().notNull(),
  artifactPayload: jsonb("artifact_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("approval_policy_definition_revisions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("approval_policy_definition_revisions_snapshot_source_unique").on(
    table.workspaceId, table.id, table.policyRef, table.revision, table.policyHash, table.canonicalHash,
  ),
  uniqueIndex("approval_policy_definition_revisions_workspace_ref_revision_unique")
    .on(table.workspaceId, table.policyRef, table.revision),
  uniqueIndex("approval_policy_definition_revisions_workspace_hash_unique").on(table.workspaceId, table.canonicalHash),
  index("approval_policy_definition_revisions_resolve_idx")
    .on(table.workspaceId, table.actionType, table.risk, table.state, table.policyRef, table.revision),
  check("approval_policy_definition_revisions_identity", sql`
    ${table.schemaVersion} = 'approval-policy-definition/1.0.0'
    and ${table.revision} between 1 and 1000000
    and ${table.workspaceRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.policyRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.normalizedByActorRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ((${table.revision} = 1 and ${table.previousHash} is null)
      or (${table.revision} > 1 and ${table.previousHash} ~ '^[a-f0-9]{64}$'))
    and ${table.policyHash} ~ '^[a-f0-9]{64}$' and ${table.canonicalHash} ~ '^[a-f0-9]{64}$'
  `),
  check("approval_policy_definition_revisions_applicability", sql`
    ${table.actionType} = 'existing_post_promotion' and ${table.risk} = 'K4'
  `),
  check("approval_policy_definition_revisions_lifecycle", sql`
    ${table.state} in ('draft', 'published', 'disabled')
    and ${table.normalizedByRole} in ('owner', 'admin', 'analyst')
    and (${table.expiresAt} is null or ${table.expiresAt} > ${table.effectiveFrom})
    and ((${table.state} = 'draft' and ${table.publishedByActorRef} is null and ${table.publishedByRole} is null
      and ${table.publicationDecisionRef} is null and ${table.publicationReasonRef} is null and ${table.publishedAt} is null
      and ${table.disabledByActorRef} is null and ${table.disabledByRole} is null
      and ${table.disableDecisionRef} is null and ${table.disableReasonRef} is null and ${table.disabledAt} is null)
      or (${table.state} = 'published' and ${table.publishedByActorRef} is not null
        and ${table.publishedByRole} in ('owner', 'admin') and ${table.publicationDecisionRef} is not null
        and ${table.publicationReasonRef} is not null and ${table.publishedAt} is not null
        and ${table.disabledByActorRef} is null and ${table.disabledByRole} is null
        and ${table.disableDecisionRef} is null and ${table.disableReasonRef} is null and ${table.disabledAt} is null)
      or (${table.state} = 'disabled' and ${table.publishedByActorRef} is not null
        and ${table.publishedByRole} in ('owner', 'admin') and ${table.publicationDecisionRef} is not null
        and ${table.publicationReasonRef} is not null and ${table.publishedAt} is not null
        and ${table.disabledByActorRef} is not null and ${table.disabledByRole} in ('owner', 'admin')
        and ${table.disableDecisionRef} is not null and ${table.disableReasonRef} is not null
        and ${table.disabledAt} is not null and ${table.disabledAt} >= ${table.publishedAt}))
  `),
  check("approval_policy_definition_revisions_policy_exact", sql`
    jsonb_typeof(${table.policyPayload}) = 'object'
    and ${table.policyPayload} #>> '{version}' = 'action-approval-policy/1.0.0'
    and ${table.policyPayload} #>> '{policyRef}' = ${table.policyRef}
    and (${table.policyPayload} #>> '{revision}')::integer = ${table.revision}
    and ${table.policyPayload} #>> '{autonomyMode}' = 'approval_only'
    and jsonb_typeof(${table.policyPayload} #> '{requesterRoles}') = 'array'
    and jsonb_typeof(${table.policyPayload} #> '{approverRoles}') = 'array'
    and jsonb_typeof(${table.policyPayload} #> '{grantConsumerRoles}') = 'array'
    and jsonb_typeof(${table.policyPayload} #> '{separationOfDutiesRisks}') = 'array'
    and ${table.policyPayload} ? 'maximumProtectionEvidenceAgeSeconds'
    and jsonb_typeof(${table.policyPayload} #> '{maximumProtectionEvidenceAgeSeconds}') = 'number'
    and (${table.policyPayload} #>> '{maximumProtectionEvidenceAgeSeconds}')::integer between 1 and 604800
    and ${table.policyPayload} ? 'maximumProposalLifetimeSeconds'
    and jsonb_typeof(${table.policyPayload} #> '{maximumProposalLifetimeSeconds}') = 'number'
    and (${table.policyPayload} #>> '{maximumProposalLifetimeSeconds}')::integer between 1 and 604800
    and (${table.policyPayload} #>> '{maximumGrantLifetimeSeconds}')::integer between 1 and 86400
  `),
  check("approval_policy_definition_revisions_artifact_exact", sql`
    jsonb_typeof(${table.artifactPayload}) = 'object'
    and ${table.artifactPayload} #>> '{version}' = ${table.schemaVersion}
    and ${table.artifactPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.artifactPayload} #>> '{policyRef}' = ${table.policyRef}
    and (${table.artifactPayload} #>> '{revision}')::integer = ${table.revision}
    and (${table.artifactPayload} #>> '{previousHash}') is not distinct from ${table.previousHash}
    and ${table.artifactPayload} #>> '{applicability,actionType}' = ${table.actionType}
    and ${table.artifactPayload} #>> '{applicability,risk}' = ${table.risk}
    and ${table.artifactPayload} #>> '{state}' = ${table.state}
    and (${table.artifactPayload} #>> '{effectiveFrom}')::timestamptz = ${table.effectiveFrom}
    and (${table.artifactPayload} #>> '{expiresAt}')::timestamptz is not distinct from ${table.expiresAt}
    and ${table.artifactPayload} #> '{policy}' = ${table.policyPayload}
    and ${table.artifactPayload} #>> '{policyHash}' = ${table.policyHash}
    and ${table.artifactPayload} #>> '{canonicalHash}' = ${table.canonicalHash}
    and ${table.artifactPayload} #>> '{provenance,normalizedByActorRef}' = ${table.normalizedByActorRef}
    and ${table.artifactPayload} #>> '{provenance,normalizedByRole}' = ${table.normalizedByRole}
    and (${table.artifactPayload} #>> '{provenance,publishedByActorRef}') is not distinct from ${table.publishedByActorRef}
    and (${table.artifactPayload} #>> '{provenance,publishedByRole}') is not distinct from ${table.publishedByRole}
    and (${table.artifactPayload} #>> '{provenance,publicationDecisionRef}') is not distinct from ${table.publicationDecisionRef}
    and (${table.artifactPayload} #>> '{provenance,publicationReasonRef}') is not distinct from ${table.publicationReasonRef}
    and (${table.artifactPayload} #>> '{provenance,publishedAt}')::timestamptz is not distinct from ${table.publishedAt}
    and (${table.artifactPayload} #>> '{provenance,disabledByActorRef}') is not distinct from ${table.disabledByActorRef}
    and (${table.artifactPayload} #>> '{provenance,disabledByRole}') is not distinct from ${table.disabledByRole}
    and (${table.artifactPayload} #>> '{provenance,disableDecisionRef}') is not distinct from ${table.disableDecisionRef}
    and (${table.artifactPayload} #>> '{provenance,disableReasonRef}') is not distinct from ${table.disableReasonRef}
    and (${table.artifactPayload} #>> '{provenance,disabledAt}')::timestamptz is not distinct from ${table.disabledAt}
    and ${table.artifactPayload} #>> '{authority,canApprove}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canGrant}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canExecute}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canWriteMeta}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canPromoteGuidance}' = 'false'
  `),
  check("approval_policy_definition_revisions_no_forbidden_material", sql`
    (${table.policyPayload}::text || ${table.artifactPayload}::text)
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|free[_-]?text|authorization|approvalgranted)"[[:space:]]*:'
  `),
]);

/**
 * One generic append-only registry for reviewed Meta compatibility mappings and
 * exact selection evidence. Mapping artifacts describe identity only; they do
 * not grant policy, approval, execution, or Meta write authority.
 */
export const metaCompatibilityArtifactRevisions = pgTable("meta_compatibility_artifact_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  artifactRef: text("artifact_ref").notNull(),
  revision: integer("revision").notNull(),
  schemaVersion: text("schema_version").notNull(),
  workspaceRef: text("workspace_ref").notNull(),
  artifactKind: text("artifact_kind").notNull(),
  dimension: text("dimension").notNull(),
  state: text("state").notNull(),
  selectionHash: text("selection_hash"),
  outcome: text("outcome"),
  previousHash: text("previous_hash"),
  reviewedByActorRef: text("reviewed_by_actor_ref"),
  reviewedByRole: text("reviewed_by_role"),
  reviewDecisionRef: text("review_decision_ref"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewBy: timestamp("review_by", { withTimezone: true }),
  publishedByActorRef: text("published_by_actor_ref"),
  publishedByRole: text("published_by_role"),
  publicationDecisionRef: text("publication_decision_ref"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  tombstonedByActorRef: text("tombstoned_by_actor_ref"),
  tombstoneDecisionRef: text("tombstone_decision_ref"),
  tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
  canonicalHash: text("canonical_hash").notNull(),
  artifactPayload: jsonb("artifact_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("meta_compatibility_artifact_revisions_workspace_row_unique").on(table.workspaceId, table.id),
  uniqueIndex("meta_compatibility_artifact_revisions_identity_unique")
    .on(table.workspaceId, table.artifactRef, table.revision),
  uniqueIndex("meta_compatibility_artifact_revisions_hash_unique").on(table.workspaceId, table.canonicalHash),
  index("meta_compatibility_artifact_revisions_registry_idx")
    .on(table.workspaceId, table.state, table.artifactKind, table.dimension, table.artifactRef, table.revision),
  index("meta_compatibility_artifact_revisions_selection_idx")
    .on(table.workspaceId, table.selectionHash, table.dimension, table.state, table.revision),
  check("meta_compatibility_artifact_revisions_identity", sql`
    ${table.revision} between 1 and 1000000
    and ${table.schemaVersion} = 'meta-compatibility-artifact/1.0.0'
    and ${table.artifactRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.workspaceRef} ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ${table.artifactKind} in ('mapping', 'evidence')
    and ${table.dimension} in ('destination', 'optimization', 'placement', 'special_category', 'tracking')
    and ${table.state} in ('draft', 'reviewed', 'published', 'tombstoned')
    and ${table.canonicalHash} ~ '^[a-f0-9]{64}$'
    and (${table.previousHash} is null or ${table.previousHash} ~ '^[a-f0-9]{64}$')
  `),
  check("meta_compatibility_artifact_revisions_kind_shape", sql`
    (${table.artifactKind} = 'mapping' and ${table.selectionHash} is null and ${table.outcome} is null)
    or (${table.artifactKind} = 'evidence' and ${table.selectionHash} ~ '^[a-f0-9]{64}$'
      and ${table.outcome} in ('confirmed', 'rejected', 'unknown'))
  `),
  check("meta_compatibility_artifact_revisions_lifecycle", sql`
    (${table.state} = 'draft' and ${table.revision} = 1 and ${table.previousHash} is null
      and ${table.reviewedByActorRef} is null and ${table.reviewedByRole} is null and ${table.reviewDecisionRef} is null
      and ${table.reviewedAt} is null and ${table.reviewBy} is null
      and ${table.publishedByActorRef} is null and ${table.publishedByRole} is null and ${table.publicationDecisionRef} is null and ${table.publishedAt} is null
      and ${table.tombstonedByActorRef} is null and ${table.tombstoneDecisionRef} is null and ${table.tombstonedAt} is null)
    or (${table.state} = 'reviewed' and ${table.revision} >= 2 and ${table.previousHash} is not null
      and ${table.reviewedByActorRef} is not null and ${table.reviewedByRole} in ('owner', 'admin')
      and ${table.reviewDecisionRef} is not null and ${table.reviewedAt} is not null and ${table.reviewBy} > ${table.reviewedAt}
      and ${table.publishedByActorRef} is null and ${table.publishedByRole} is null and ${table.publicationDecisionRef} is null and ${table.publishedAt} is null
      and ${table.tombstonedByActorRef} is null and ${table.tombstoneDecisionRef} is null and ${table.tombstonedAt} is null)
    or (${table.state} = 'published' and ${table.revision} >= 3 and ${table.previousHash} is not null
      and ${table.reviewedByActorRef} is not null and ${table.reviewedByRole} in ('owner', 'admin')
      and ${table.reviewDecisionRef} is not null and ${table.reviewedAt} is not null
      and ${table.publishedByActorRef} is not null and ${table.publishedByRole} in ('owner', 'admin')
      and ${table.publicationDecisionRef} is not null and ${table.publishedAt} >= ${table.reviewedAt} and ${table.reviewBy} > ${table.publishedAt}
      and ${table.tombstonedByActorRef} is null and ${table.tombstoneDecisionRef} is null and ${table.tombstonedAt} is null)
    or (${table.state} = 'tombstoned' and ${table.revision} >= 4 and ${table.previousHash} is not null
      and ${table.reviewedByActorRef} is not null and ${table.reviewedByRole} in ('owner', 'admin')
      and ${table.reviewDecisionRef} is not null and ${table.reviewedAt} is not null
      and ${table.publishedByActorRef} is not null and ${table.publishedByRole} in ('owner', 'admin')
      and ${table.publicationDecisionRef} is not null and ${table.publishedAt} >= ${table.reviewedAt} and ${table.reviewBy} > ${table.publishedAt}
      and ${table.tombstonedByActorRef} is not null and ${table.tombstoneDecisionRef} is not null and ${table.tombstonedAt} >= ${table.publishedAt})
  `),
  check("meta_compatibility_artifact_revisions_payload_exact", sql`
    jsonb_typeof(${table.artifactPayload}) = 'object'
    and ${table.artifactPayload} #>> '{version}' = ${table.schemaVersion}
    and ${table.artifactPayload} #>> '{artifactRef}' = ${table.artifactRef}
    and (${table.artifactPayload} #>> '{revision}')::integer = ${table.revision}
    and ${table.artifactPayload} #>> '{workspaceRef}' = ${table.workspaceRef}
    and ${table.artifactPayload} #>> '{dimension}' = ${table.dimension}
    and ${table.artifactPayload} #>> '{state}' = ${table.state}
    and ${table.artifactPayload} #>> '{content,kind}' = ${table.artifactKind}
    and (${table.artifactPayload} #>> '{content,selectionHash}') is not distinct from ${table.selectionHash}
    and (${table.artifactPayload} #>> '{content,outcome}') is not distinct from ${table.outcome}
    and (${table.artifactPayload} #>> '{previousHash}') is not distinct from ${table.previousHash}
    and ${table.artifactPayload} #>> '{canonicalHash}' = ${table.canonicalHash}
    and ${table.artifactPayload} #>> '{authority,canExecute}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canWriteMeta}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canGrantApproval}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canCreatePolicy}' = 'false'
    and ${table.artifactPayload} #>> '{authority,canPromoteGuidance}' = 'false'
  `),
  check("meta_compatibility_artifact_revisions_no_forbidden_material", sql`
    ${table.artifactPayload}::text
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|free[_-]?text)"[[:space:]]*:'
  `),
]);
