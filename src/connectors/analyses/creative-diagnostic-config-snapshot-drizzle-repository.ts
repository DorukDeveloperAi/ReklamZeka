import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CreativeDiagnosticConfigSnapshot } from "@/domain/meta/creative-diagnostic-config-snapshot";
import {
  CreativeDiagnosticSourceError,
  DrizzleCreativeDiagnosticSourceRepository,
} from "@/connectors/meta/creative-diagnostic-source-drizzle-repository";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

export class CreativeDiagnosticConfigSnapshotRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "insufficient_evidence" | "corrupt_store") {
    super(`Creative diagnostic config snapshot rejected: ${code}`);
    this.name = "CreativeDiagnosticConfigSnapshotRepositoryError";
  }
}
function fail(code: CreativeDiagnosticConfigSnapshotRepositoryError["code"]): never {
  throw new CreativeDiagnosticConfigSnapshotRepositoryError(code);
}
function rows<T extends Row = Row>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}

export type CreativeDiagnosticConfigSnapshotSource = Pick<DrizzleCreativeDiagnosticSourceRepository, "readCurrent">;

/**
 * Server-private materializer for an ad-bound frozen diagnostic envelope.
 * It does not calculate fatigue, make a finding, or open an action authority.
 */
export class DrizzleCreativeDiagnosticConfigSnapshotRepository {
  constructor(private readonly database: Database,
    private readonly source: CreativeDiagnosticConfigSnapshotSource = new DrizzleCreativeDiagnosticSourceRepository(database)) {}

  async materialize(input: Readonly<{ workspaceId: string; targetEvidenceId: string; observedAt: string }>): Promise<Readonly<{
    id: string; snapshotHash: string; config: CreativeDiagnosticConfigSnapshot; inserted: boolean;
  }>> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.targetEvidenceId)) fail("invalid_input");
    const observedAt = iso(input.observedAt);
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const target = rows<{ account_ref: unknown; entity_ref: unknown; context_hash: unknown }>(await tx.execute(sql`
        select context.account_ref, evidence.entity_ref, evidence.context_hash
        from frozen_diagnostic_evidence evidence
        join effective_campaign_contexts context
          on context.workspace_id = evidence.workspace_id and context.id = evidence.context_id
        join workspaces workspace on workspace.id = evidence.workspace_id
        where evidence.workspace_id = ${input.workspaceId}::uuid and evidence.id = ${input.targetEvidenceId}::uuid
          and evidence.entity_type = 'ad' and context.entity_type = 'ad'
          and workspace.lifecycle_state = 'active'
        limit 2 for share
      `));
      if (target.length === 0) fail("not_found");
      if (target.length !== 1 || typeof target[0]!.account_ref !== "string" || typeof target[0]!.entity_ref !== "string"
        || typeof target[0]!.context_hash !== "string" || !HASH.test(target[0]!.context_hash)) fail("corrupt_store");
      let source: Awaited<ReturnType<CreativeDiagnosticConfigSnapshotSource["readCurrent"]>>;
      try {
        source = await this.source.readCurrent({ workspaceId: input.workspaceId, accountRef: target[0]!.account_ref,
          adRef: target[0]!.entity_ref });
      } catch (error) {
        if (error instanceof CreativeDiagnosticSourceError && ["not_found", "ambiguous"].includes(error.code)) fail("insufficient_evidence");
        fail("corrupt_store");
      }
      if (!UUID.test(source.adId) || !UUID.test(source.creativeId)) fail("corrupt_store");
      const snapshotHash = digest(Object.freeze({ contractVersion: "creative-diagnostic-config-persistence/1.0.0",
        targetEvidenceId: input.targetEvidenceId, contextHash: target[0]!.context_hash, adId: source.adId,
        creativeId: source.creativeId, config: source.config }));
      const payload = Object.freeze({ config: source.config, contextHash: target[0]!.context_hash });
      const inserted = rows<{ id: unknown }>(await tx.execute(sql`
        insert into meta_creative_config_snapshots (id, workspace_id, target_evidence_id, ad_id, creative_id,
          binding_hash, creative_content_hash, config_payload, snapshot_hash, observed_at)
        values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${input.targetEvidenceId}::uuid,
          ${source.adId}::uuid, ${source.creativeId}::uuid, ${source.config.bindingHash},
          ${source.config.creativeContentHash}, ${JSON.stringify(payload)}::jsonb, ${snapshotHash}, ${observedAt}::timestamptz)
        on conflict (workspace_id, snapshot_hash) do nothing returning id::text
      `));
      if (inserted.length === 1 && typeof inserted[0]!.id === "string" && UUID.test(inserted[0]!.id)) {
        return Object.freeze({ id: inserted[0]!.id, snapshotHash, config: source.config, inserted: true });
      }
      if (inserted.length !== 0) fail("corrupt_store");
      const existing = rows<{ id: unknown; config_payload: unknown; binding_hash: unknown; creative_content_hash: unknown }>(await tx.execute(sql`
        select id::text, config_payload, binding_hash, creative_content_hash
        from meta_creative_config_snapshots
        where workspace_id = ${input.workspaceId}::uuid and snapshot_hash = ${snapshotHash}
        limit 2 for share
      `));
      if (existing.length !== 1 || typeof existing[0]!.id !== "string" || !UUID.test(existing[0]!.id)
        || existing[0]!.binding_hash !== source.config.bindingHash || existing[0]!.creative_content_hash !== source.config.creativeContentHash
        || JSON.stringify(stable(existing[0]!.config_payload)) !== JSON.stringify(stable(payload))) fail("corrupt_store");
      return Object.freeze({ id: existing[0]!.id, snapshotHash, config: source.config, inserted: false });
    });
  }
}
