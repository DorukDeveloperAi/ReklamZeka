import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { normalizeMetaChangeSnapshot } from "@/domain/meta/snapshot-diff";
import { CurrentMetaHierarchyConfigReader, CurrentMetaHierarchyConfigReaderError } from "@/connectors/meta/current-meta-hierarchy-config-reader";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const capturedAt = "2026-08-10T12:00:00.000Z";
const input = { workspaceId, accountRef: "account_primary", entityType: "ad_set" as const, entityRef: "adset_primary" };
const sourceSnapshot = normalizeMetaChangeSnapshot({ schemaVersion: 1, workspaceId, externalAccountId: "account_primary", capturedAt,
  campaigns: [{ externalCampaignId: "campaign_primary", configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" }, campaignBudgetOptimization: { state: "known", value: false }, dailyBudgetMinor: { state: "known", value: null }, lifetimeBudgetMinor: { state: "known", value: null } }],
  adSets: [{ externalAdSetId: "adset_primary", externalCampaignId: "campaign_primary", configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" }, dailyBudgetMinor: { state: "known", value: null }, lifetimeBudgetMinor: { state: "known", value: null }, targetingSignature: { state: "known", value: null } }], ads: [],
});
function candidate(overrides: Record<string, unknown> = {}) { return { workspace_id: workspaceId, connection_ref: "connection_primary", account_ref: "account_primary", campaign_ref: "campaign_primary", hierarchy_refs: ["campaign_primary", "adset_primary"], campaign_objective: "OUTCOME_SALES", ad_sets: [{ external_ad_set_id: "adset_primary", optimization_goal: "OFFSITE_CONVERSIONS" }], source_snapshot_id: "22222222-2222-4222-8222-222222222222", source_snapshot_public_ref: "snapshot_0123456789abcdef0123", source_snapshot_hash: sourceSnapshot.snapshotHash, source_snapshot_schema_version: sourceSnapshot.schemaVersion, source_snapshot_field_catalog_version: sourceSnapshot.fieldCatalogVersion, source_snapshot_captured_at: capturedAt, source_snapshot_payload: sourceSnapshot, database_now: capturedAt, ...overrides }; }
function reader(rows: readonly unknown[]) { const execute = vi.fn(async () => ({ rows })); return { execute, reader: new CurrentMetaHierarchyConfigReader(), tx: { execute } }; }

describe("CurrentMetaHierarchyConfigReader", () => {
  it("uses caller-owned transaction only and emits a canonical config plus immutable source evidence", async () => {
    const harness = reader([candidate()]);
    const result = await harness.reader.readCurrent(harness.tx as never, input);
    expect(result).toMatchObject({ capturedAt, identity: { connectionRef: "connection_primary", accountRef: "account_primary", campaignRef: "campaign_primary", hierarchyRefs: ["campaign_primary", "adset_primary"] }, sourceSnapshotEvidence: { snapshotHash: sourceSnapshot.snapshotHash, capturedAt }, metaAnalysisConfigSnapshot: { workspaceId, externalAccountId: "account_primary", campaigns: [{ externalCampaignId: "campaign_primary" }], adSets: [{ externalAdSetId: "adset_primary", externalCampaignId: "campaign_primary" }] } });
    expect(harness.execute).toHaveBeenCalledTimes(1);
    const rendered = new PgDialect().sqlToQuery((harness.execute.mock.calls as unknown[][])[0]![0] as never).sql;
    expect(rendered).toContain("transaction_timestamp()");
    expect(rendered).toContain("connection.status = 'active'");
    expect(rendered).toContain("candidate.captured_at <= transaction_timestamp()");
    expect(rendered).not.toMatch(/set transaction/i);
  });
  it.each([["missing", [], "not_found"], ["ambiguous", [candidate(), candidate({ source_snapshot_id: "33333333-3333-4333-8333-333333333333" })], "ambiguous"], ["future", [candidate({ source_snapshot_captured_at: "2026-08-11T12:00:00.000Z" })], "future"], ["corrupt snapshot", [candidate({ source_snapshot_hash: "a".repeat(64) })], "corrupt_store"], ["partial ad-set observations", [candidate({ ad_sets: [] })], "corrupt_store"]] as const)("fails closed on %s", async (_name, rows, code) => {
    const harness = reader(rows); await expect(harness.reader.readCurrent(harness.tx as never, input)).rejects.toEqual(expect.objectContaining<Partial<CurrentMetaHierarchyConfigReaderError>>({ code }));
  });
  it("rejects malformed caller input before database I/O", async () => { const harness = reader([candidate()]); await expect(harness.reader.readCurrent(harness.tx as never, { ...input, workspaceId: "not-a-uuid" })).rejects.toEqual(expect.objectContaining<Partial<CurrentMetaHierarchyConfigReaderError>>({ code: "invalid_input" })); expect(harness.execute).not.toHaveBeenCalled(); });
});
