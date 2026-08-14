import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { diagnoseCreativeFatigueV2, type CreativeFatigueWindowV2 } from "@/analyses/creative-fatigue-config-diagnostics-v2";
import { DrizzleCreativeDiagnosticDefinitionRepository } from "@/connectors/analyses/creative-diagnostic-definition-drizzle-repository";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

export class CreativeFatigueConfigDiagnosticAssetRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "insufficient_evidence" | "corrupt_store") {
    super(`Creative fatigue/config diagnostic asset rejected: ${code}`);
    this.name = "CreativeFatigueConfigDiagnosticAssetRepositoryError";
  }
}
function fail(code: CreativeFatigueConfigDiagnosticAssetRepositoryError["code"]): never { throw new CreativeFatigueConfigDiagnosticAssetRepositoryError(code); }
function rows<T extends Row = Row>(value: unknown): readonly T[] { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store"); return value.rows as readonly T[]; }
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function iso(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input"); return value; }
function decimal(value: unknown): number { if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) fail("corrupt_store"); const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0) fail("corrupt_store"); return parsed; }
function integer(value: unknown): number { const parsed = decimal(value); if (!Number.isSafeInteger(parsed)) fail("corrupt_store"); return parsed; }
function window(row: Record<string, unknown>, prefix: "baseline" | "recent"): CreativeFatigueWindowV2 {
  const get = (name: string) => row[`${prefix}_${name}`];
  const coverage = get("daily_coverage");
  if (typeof get("start_date") !== "string" || typeof get("end_date") !== "string" || typeof get("source_ref") !== "string"
    || !coverage || !Array.isArray(coverage)) fail("corrupt_store");
  const dailyCoverage = coverage.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof (entry as Record<string, unknown>).date !== "string"
      || typeof (entry as Record<string, unknown>).settled !== "boolean" || typeof (entry as Record<string, unknown>).sourceSnapshotRef !== "string") fail("corrupt_store");
    return Object.freeze({ date: (entry as Record<string, unknown>).date as string, settled: (entry as Record<string, unknown>).settled as boolean, sourceSnapshotRef: (entry as Record<string, unknown>).sourceSnapshotRef as string });
  });
  return Object.freeze({ startDate: get("start_date") as string, endDate: get("end_date") as string, frequency: decimal(get("frequency")),
    clicks: integer(get("clicks")), impressions: integer(get("impressions")), sourceSnapshotRef: get("source_ref") as string, dailyCoverage: Object.freeze(dailyCoverage) });
}
type DefinitionReader = Pick<DrizzleCreativeDiagnosticDefinitionRepository, "loadCurrentPublishedInTransaction">;
const capabilities = Object.freeze({ canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false, canPublish: false, canApprove: false, canExecute: false, canAccessNetwork: false } as const);

/** Server-private advisory-only writer. It binds immutable source/config windows; it never stages an action. */
export class DrizzleCreativeFatigueConfigDiagnosticAssetRepository {
  constructor(private readonly database: Database,
    private readonly definitions: DefinitionReader = new DrizzleCreativeDiagnosticDefinitionRepository(database)) {}

  async materialize(input: Readonly<{
    workspaceId: string; targetEvidenceId: string; definitionRef: string;
    baselineConfigSnapshotId: string; recentConfigSnapshotId: string; baselineWindowId: string; recentWindowId: string; occurredAt: string;
  }>): Promise<Readonly<{ id: string; diagnosticHash: string; inserted: boolean; result: unknown; capabilities: typeof capabilities }>> {
    if (!UUID.test(input.workspaceId) || ![input.targetEvidenceId, input.baselineConfigSnapshotId, input.recentConfigSnapshotId, input.baselineWindowId, input.recentWindowId].every((value) => UUID.test(value)) || !/^creative_definition_[a-f0-9]{24}$/.test(input.definitionRef)) fail("invalid_input");
    const occurredAt = iso(input.occurredAt);
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      let definition: Awaited<ReturnType<DefinitionReader["loadCurrentPublishedInTransaction"]>>;
      try { definition = await this.definitions.loadCurrentPublishedInTransaction(tx, { workspaceId: input.workspaceId, definitionRef: input.definitionRef }); }
      catch { fail("insufficient_evidence"); }
      const source = rows<Record<string, unknown>>(await tx.execute(sql`
        select evidence.entity_ref,
          definition.id::text as definition_revision_id,
          baseline_config.snapshot_hash as baseline_config_hash, baseline_config.config_payload as baseline_config_payload, baseline_config.creative_id::text as baseline_creative_id,
          recent_config.snapshot_hash as recent_config_hash, recent_config.config_payload as recent_config_payload, recent_config.creative_id::text as recent_creative_id,
          baseline_window.id::text as baseline_window_id, baseline_window.start_date::text as baseline_start_date, baseline_window.end_date::text as baseline_end_date,
          baseline_window.frequency::text as baseline_frequency, baseline_window.clicks::text as baseline_clicks, baseline_window.impressions::text as baseline_impressions,
          baseline_window.source_ref as baseline_source_ref, baseline_window.daily_coverage as baseline_daily_coverage, baseline_window.snapshot_hash as baseline_window_hash,
          baseline_window.settlement_policy_ref as baseline_policy_ref, baseline_window.settlement_policy_hash as baseline_policy_hash,
          recent_window.id::text as recent_window_id, recent_window.start_date::text as recent_start_date, recent_window.end_date::text as recent_end_date,
          recent_window.frequency::text as recent_frequency, recent_window.clicks::text as recent_clicks, recent_window.impressions::text as recent_impressions,
          recent_window.source_ref as recent_source_ref, recent_window.daily_coverage as recent_daily_coverage, recent_window.snapshot_hash as recent_window_hash,
          recent_window.settlement_policy_ref as recent_policy_ref, recent_window.settlement_policy_hash as recent_policy_hash
        from frozen_diagnostic_evidence evidence
        join creative_diagnostic_definition_revisions definition on definition.workspace_id = evidence.workspace_id
          and definition.definition_ref = ${definition.definitionRef} and definition.revision = ${definition.revision} and definition.definition_hash = ${definition.definitionHash} and definition.state = 'published'
        join meta_creative_config_snapshots baseline_config on baseline_config.workspace_id = evidence.workspace_id and baseline_config.id = ${input.baselineConfigSnapshotId}::uuid and baseline_config.target_evidence_id = evidence.id
        join meta_creative_config_snapshots recent_config on recent_config.workspace_id = evidence.workspace_id and recent_config.id = ${input.recentConfigSnapshotId}::uuid and recent_config.target_evidence_id = evidence.id
        join meta_creative_window_insight_snapshots baseline_window on baseline_window.workspace_id = evidence.workspace_id and baseline_window.id = ${input.baselineWindowId}::uuid and baseline_window.config_snapshot_id = baseline_config.id and baseline_window.window_kind = 'baseline'
        join meta_creative_window_insight_snapshots recent_window on recent_window.workspace_id = evidence.workspace_id and recent_window.id = ${input.recentWindowId}::uuid and recent_window.config_snapshot_id = recent_config.id and recent_window.window_kind = 'recent'
        join workspaces workspace on workspace.id = evidence.workspace_id and workspace.lifecycle_state = 'active'
        where evidence.workspace_id = ${input.workspaceId}::uuid and evidence.id = ${input.targetEvidenceId}::uuid and evidence.entity_type = 'ad'
        limit 2 for share
      `));
      if (source.length === 0) fail("not_found");
      if (source.length !== 1) fail("insufficient_evidence");
      const row = source[0]!;
      const neededHashes = ["baseline_config_hash", "recent_config_hash", "baseline_window_hash", "recent_window_hash", "baseline_policy_hash", "recent_policy_hash"];
      if (typeof row.entity_ref !== "string" || !row.entity_ref || !UUID.test(String(row.definition_revision_id)) || !UUID.test(String(row.baseline_creative_id)) || row.baseline_creative_id !== row.recent_creative_id
        || neededHashes.some((key) => typeof row[key] !== "string" || !HASH.test(row[key] as string))
        || typeof row.baseline_policy_ref !== "string" || typeof row.recent_policy_ref !== "string") fail("corrupt_store");
      const baseline = window(row, "baseline"); const recent = window(row, "recent");
      let fatigue: ReturnType<typeof diagnoseCreativeFatigueV2>;
      try { fatigue = diagnoseCreativeFatigueV2({ subjectRef: row.entity_ref, baseline, recent, minimumImpressions: definition.minimumImpressions,
        minimumFrequencyIncreaseFraction: definition.minimumFrequencyIncreaseFraction, minimumCtrDeclineFraction: definition.minimumCtrDeclineFraction }); }
      catch { fail("insufficient_evidence"); }
      const baselineConfig = row.baseline_config_payload && typeof row.baseline_config_payload === "object" && !Array.isArray(row.baseline_config_payload) ? (row.baseline_config_payload as Record<string, unknown>).config : null;
      const recentConfig = row.recent_config_payload && typeof row.recent_config_payload === "object" && !Array.isArray(row.recent_config_payload) ? (row.recent_config_payload as Record<string, unknown>).config : null;
      if (!baselineConfig || !recentConfig || typeof baselineConfig !== "object" || typeof recentConfig !== "object") fail("corrupt_store");
      const result = Object.freeze({ contractVersion: "creative-fatigue-config-diagnostic-asset/1.0.0", fatigue,
        config: Object.freeze({ baselineSnapshotHash: row.baseline_config_hash, recentSnapshotHash: row.recent_config_hash,
          changed: JSON.stringify(stable(baselineConfig)) !== JSON.stringify(stable(recentConfig)) }),
        settlement: Object.freeze({ baseline: Object.freeze({ ref: row.baseline_policy_ref, hash: row.baseline_policy_hash }), recent: Object.freeze({ ref: row.recent_policy_ref, hash: row.recent_policy_hash }) }) });
      const diagnosticHash = digest(Object.freeze({ targetEvidenceId: input.targetEvidenceId, definitionHash: definition.definitionHash,
        baselineConfigHash: row.baseline_config_hash, recentConfigHash: row.recent_config_hash, baselineWindowHash: row.baseline_window_hash,
        recentWindowHash: row.recent_window_hash, result }));
      const inserted = rows<{ id: unknown }>(await tx.execute(sql`
        insert into creative_fatigue_config_diagnostic_assets (id, workspace_id, target_evidence_id, definition_revision_id,
          baseline_config_snapshot_id, recent_config_snapshot_id, baseline_window_id, recent_window_id, diagnostic_hash, result_payload, capabilities, occurred_at)
        values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${input.targetEvidenceId}::uuid, ${row.definition_revision_id}::uuid,
          ${input.baselineConfigSnapshotId}::uuid, ${input.recentConfigSnapshotId}::uuid, ${input.baselineWindowId}::uuid, ${input.recentWindowId}::uuid,
          ${diagnosticHash}, ${JSON.stringify(result)}::jsonb, ${JSON.stringify(capabilities)}::jsonb, ${occurredAt}::timestamptz)
        on conflict (workspace_id, diagnostic_hash) do nothing returning id::text
      `));
      if (inserted.length === 1 && typeof inserted[0]!.id === "string" && UUID.test(inserted[0]!.id)) return Object.freeze({ id: inserted[0]!.id, diagnosticHash, inserted: true, result, capabilities });
      if (inserted.length !== 0) fail("corrupt_store");
      const existing = rows<{ id: unknown; result_payload: unknown; capabilities: unknown }>(await tx.execute(sql`
        select id::text, result_payload, capabilities from creative_fatigue_config_diagnostic_assets
        where workspace_id = ${input.workspaceId}::uuid and diagnostic_hash = ${diagnosticHash} limit 2 for share
      `));
      if (existing.length !== 1 || typeof existing[0]!.id !== "string" || !UUID.test(existing[0]!.id)
        || JSON.stringify(stable(existing[0]!.result_payload)) !== JSON.stringify(stable(result))
        || JSON.stringify(stable(existing[0]!.capabilities)) !== JSON.stringify(stable(capabilities))) fail("corrupt_store");
      return Object.freeze({ id: existing[0]!.id, diagnosticHash, inserted: false, result, capabilities });
    });
  }
}
