import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  DrizzleMetaChangeTimelinePersistenceStore,
  MetaChangeTimelinePersistenceService,
} from "@/connectors/meta/sync/change-timeline-persistence";
import * as schema from "@/db/schema";
import { diffMetaChangeSnapshots, normalizeMetaChangeSnapshot, type MetaChangeSnapshotInput } from "@/domain/meta/snapshot-diff";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 15_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("rollback");
const workspaceId = randomUUID();
const connectionId = randomUUID();
const sourceAId = randomUUID();
const sourceBId = randomUUID();
const accountAId = randomUUID();
const accountBId = randomUUID();
const externalA = `act_${randomUUID()}`;
const externalB = `act_${randomUUID()}`;

function snapshotInput(externalAccountId: string, capturedAt: string, status: "ACTIVE" | "PAUSED" | "unknown"): MetaChangeSnapshotInput {
  return {
    schemaVersion: 1,
    workspaceId,
    externalAccountId,
    capturedAt,
    campaigns: [{
      externalCampaignId: `campaign_${externalAccountId}`,
      configuredStatus: status === "unknown" ? { state: "unknown", reason: "not_observed" } : { state: "known", value: status },
      effectiveStatus: { state: "known", value: "ACTIVE" },
      campaignBudgetOptimization: { state: "known", value: true },
      dailyBudgetMinor: { state: "known", value: 20_000 },
      lifetimeBudgetMinor: { state: "known", value: null },
    }],
    adSets: [],
    ads: [],
  };
}

let insertedSnapshots = 0;
let insertedEvents = 0;
let replayIdempotent = false;
let twoAccountScopeBlocked = false;
let unknownDidNotInventChange = false;
let compositeScopeFkBlocked = false;
let eventRowsRedacted = false;
let restartSnapshotRecovered = false;
let temporaryWorkspaceCommitted = true;

try {
  await database.transaction(async (transaction) => {
    // Session-private tables exercise the final Drizzle contract without applying the migration.
    await transaction.execute(sql.raw(`
      create temporary table meta_change_snapshots (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
        meta_connection_id uuid not null, ad_account_id uuid not null, public_ref text not null,
        snapshot_hash text not null, schema_version integer not null, field_catalog_version text not null,
        captured_at timestamptz not null, canonical_payload jsonb not null, safe_aggregate jsonb not null,
        persisted_at timestamptz not null default now(),
        unique (workspace_id, meta_connection_id, ad_account_id, snapshot_hash),
        unique (workspace_id, meta_connection_id, ad_account_id, public_ref),
        unique (id, workspace_id, meta_connection_id, ad_account_id)
      ) on commit drop;
      create temporary table meta_change_events (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
        meta_connection_id uuid not null, ad_account_id uuid not null,
        previous_snapshot_id uuid not null, current_snapshot_id uuid not null,
        change_ref text not null, entity_ref text not null, entity_type text not null, field text not null,
        before_value jsonb not null, after_value jsonb not null, classification text not null,
        correlated_action_ref text, timeline_hash text not null, field_catalog_version text not null,
        occurred_at timestamptz not null, detected_at timestamptz not null, persisted_at timestamptz not null default now(),
        unique (workspace_id, meta_connection_id, ad_account_id, change_ref),
        foreign key (previous_snapshot_id, workspace_id, meta_connection_id, ad_account_id)
          references meta_change_snapshots (id, workspace_id, meta_connection_id, ad_account_id),
        foreign key (current_snapshot_id, workspace_id, meta_connection_id, ad_account_id)
          references meta_change_snapshots (id, workspace_id, meta_connection_id, ad_account_id)
      ) on commit drop;
    `));
    await transaction.insert(schema.workspaces).values({ id: workspaceId, name: "S1.5 timeline E2E" });
    await transaction.insert(schema.metaConnections).values({
      id: connectionId,
      workspaceId,
      externalConnectionKey: "timeline-e2e",
      displayName: "Timeline E2E",
      graphApiVersion: "v23.0",
      fieldCatalogVersion: "meta-change-fields-v1",
    });
    await transaction.insert(schema.dataSources).values([
      { id: sourceAId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads", externalAccountId: externalA, displayName: "Account A" },
      { id: sourceBId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads", externalAccountId: externalB, displayName: "Account B" },
    ]);
    await transaction.insert(schema.adAccounts).values([
      { id: accountAId, workspaceId, dataSourceId: sourceAId, externalAccountId: externalA, name: "Account A", currency: "TRY", timezone: "Europe/Istanbul" },
      { id: accountBId, workspaceId, dataSourceId: sourceBId, externalAccountId: externalB, name: "Account B", currency: "TRY", timezone: "Europe/Istanbul" },
    ]);

    const service = new MetaChangeTimelinePersistenceService(
      new DrizzleMetaChangeTimelinePersistenceStore(transaction as never),
    );
    const previous = normalizeMetaChangeSnapshot(snapshotInput(externalA, "2026-08-07T10:00:00.000Z", "ACTIVE"));
    const current = normalizeMetaChangeSnapshot(snapshotInput(externalA, "2026-08-07T11:00:00.000Z", "PAUSED"));
    const timeline = diffMetaChangeSnapshots({ previous, current });
    const first = await service.persist({
      scope: { workspaceId, connectionId, adAccountId: accountAId }, previous, current, timeline,
      detectedAt: "2026-08-07T11:01:00.000Z",
    });
    const replay = await service.persist({
      scope: { workspaceId, connectionId, adAccountId: accountAId }, previous, current, timeline,
      detectedAt: "2026-08-07T11:01:00.000Z",
    });
    insertedSnapshots = first.insertedSnapshots;
    insertedEvents = first.insertedEvents;
    replayIdempotent = replay.replay && replay.insertedSnapshots === 0 && replay.insertedEvents === 0;
    const restartedService = new MetaChangeTimelinePersistenceService(
      new DrizzleMetaChangeTimelinePersistenceStore(transaction as never),
    );
    restartSnapshotRecovered = (await restartedService.loadLatestSnapshot({
      workspaceId, connectionId, adAccountId: accountAId,
    }))?.snapshotHash === current.snapshotHash;

    twoAccountScopeBlocked = await service.persist({
      scope: { workspaceId, connectionId, adAccountId: accountBId }, previous, current, timeline,
      detectedAt: "2026-08-07T11:01:00.000Z",
    }).then(() => false, (error: unknown) => (error as { code?: string }).code === "scope_mismatch");

    const unknownCurrent = normalizeMetaChangeSnapshot(snapshotInput(externalA, "2026-08-07T12:00:00.000Z", "unknown"));
    const unknownTimeline = diffMetaChangeSnapshots({ previous: current, current: unknownCurrent });
    const unknownResult = await service.persist({
      scope: { workspaceId, connectionId, adAccountId: accountAId }, previous: current, current: unknownCurrent,
      timeline: unknownTimeline, detectedAt: "2026-08-07T12:01:00.000Z",
    });
    unknownDidNotInventChange = unknownResult.eventCount === 0 && unknownTimeline.diagnostics.unknownComparisons > 0;

    const snapshotRows = await transaction.execute(sql<{
      id: string; workspace_id: string; meta_connection_id: string; ad_account_id: string;
    }>`select id, workspace_id, meta_connection_id, ad_account_id from meta_change_snapshots order by captured_at`);
    const firstSnapshot = snapshotRows.rows[0]!;
    compositeScopeFkBlocked = await transaction.transaction(async (savepoint) => {
      await savepoint.execute(sql`
        insert into meta_change_events (
          workspace_id, meta_connection_id, ad_account_id, previous_snapshot_id, current_snapshot_id,
          change_ref, entity_ref, entity_type, field, before_value, after_value, classification,
          timeline_hash, field_catalog_version, occurred_at, detected_at
        ) values (
          ${workspaceId}, ${connectionId}, ${accountBId}, ${firstSnapshot.id}, ${firstSnapshot.id},
          'ref_aaaaaaaaaaaaaaaaaaaa', 'ref_bbbbbbbbbbbbbbbbbbbb', 'campaign', 'configured_status',
          '"ACTIVE"'::jsonb, '"PAUSED"'::jsonb, 'external_change', ${"a".repeat(64)},
          'meta-change-fields-v1', now(), now()
        )
      `);
      return false;
    }).catch(() => true);

    const eventEvidence = JSON.stringify((await transaction.execute(sql`
      select change_ref, entity_ref, entity_type, field, before_value, after_value,
             classification, correlated_action_ref, timeline_hash
      from meta_change_events
    `)).rows);
    eventRowsRedacted = ![externalA, externalB, "campaign_", "access_token", "raw_payload", "secret ad copy"]
      .some((value) => eventEvidence.includes(value));

    if (!replayIdempotent || !restartSnapshotRecovered || !twoAccountScopeBlocked || !unknownDidNotInventChange || !compositeScopeFkBlocked || !eventRowsRedacted) {
      throw new Error("S1.5 timeline persistence acceptance failed");
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  temporaryWorkspaceCommitted = false;
} finally {
  await pool.end();
}

console.log(JSON.stringify({
  insertedSnapshots,
  insertedEvents,
  replayIdempotent,
  restartSnapshotRecovered,
  twoAccountScopeBlocked,
  unknownDidNotInventChange,
  compositeScopeFkBlocked,
  eventRowsRedacted,
  temporaryWorkspaceCommitted,
}));
