import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { SliceRegistryBindings, SliceRegistryRepository, SliceRegistrySnapshotMember } from "@/application/slice-registry-service";
import type { SliceRevision } from "@/domain/slices/slice-definition";
import type { FrozenSliceSnapshot } from "@/domain/slices/slice-resolver";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Row = Readonly<Record<string, unknown>>;
function rows(result: unknown): readonly Row[] { if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) throw new Error("slice registry repository rejected: corrupt_store"); return result.rows as readonly Row[]; }
function id(row: Row, name: string): string { const value = row[name]; if (typeof value !== "string" || !value) throw new Error("slice registry repository rejected: corrupt_store"); return value; }

/**
 * This connector receives only server-resolved tenant IDs. It never resolves a
 * public ref and it never grants Guide, action, or Meta write authority.
 */
export class DrizzleSliceRegistryRepository implements SliceRegistryRepository {
  constructor(private readonly database: Pick<Database, "transaction">) {}

  async create(input: Readonly<{ workspaceId: string; actorId: string; label: string; revision: SliceRevision; bindings: SliceRegistryBindings }>) {
    return this.database.transaction(async (tx) => {
      const slice = rows(await tx.execute(sql`insert into slices (workspace_id, label, market_definition_id, created_by_actor_id) values (${input.workspaceId}::uuid, ${input.label}, ${input.bindings.marketDefinitionId}::uuid, ${input.actorId}::uuid) returning id::text`))[0];
      if (!slice) throw new Error("slice registry repository rejected: write_failed");
      const revisionId = await this.insertRevision(tx, { ...input, sliceId: id(slice, "id"), lifecycle: "draft", sourceRevisionId: null });
      return Object.freeze({ sliceId: id(slice, "id"), revisionId });
    });
  }

  async publish(input: Readonly<{ workspaceId: string; actorId: string; sliceId: string; revision: SliceRevision; bindings: SliceRegistryBindings }>) {
    return this.database.transaction(async (tx) => {
      const revisionId = await this.insertRevision(tx, { ...input, lifecycle: "published", sourceRevisionId: null });
      const advanced = rows(await tx.execute(sql`update slices set current_published_revision_id = ${revisionId}::uuid where workspace_id = ${input.workspaceId}::uuid and id = ${input.sliceId}::uuid and tombstoned_at is null returning id`));
      if (advanced.length !== 1) throw new Error("slice registry repository rejected: slice_not_found");
      return Object.freeze({ revisionId });
    });
  }

  async freeze(input: Readonly<{ workspaceId: string; actorId: string; revisionId: string; snapshot: FrozenSliceSnapshot; members: readonly SliceRegistrySnapshotMember[] }>) {
    return this.database.transaction(async (tx) => {
      if (input.members.length !== input.snapshot.members.length) throw new Error("slice registry repository rejected: snapshot_members_mismatch");
      const snapshot = rows(await tx.execute(sql`insert into slice_resolution_snapshots (workspace_id, slice_revision_id, snapshot_hash, resolved_at) values (${input.workspaceId}::uuid, ${input.revisionId}::uuid, ${input.snapshot.snapshotHash}, ${input.snapshot.resolvedAt}::timestamptz) returning id::text`))[0];
      if (!snapshot) throw new Error("slice registry repository rejected: write_failed"); const snapshotId = id(snapshot, "id");
      for (const [offset, member] of input.members.entries()) {
        await tx.execute(sql`insert into slice_resolution_snapshot_members (workspace_id, snapshot_id, ordinal, entity_level, organization_campaign_id, campaign_id, ad_set_id, reason, market_evidence_refs, matched_dimension_ids, matched_dimension_evidence_refs) values (${input.workspaceId}::uuid, ${snapshotId}::uuid, ${offset + 1}, ${member.entityLevel}, ${member.organizationCampaignId ?? null}::uuid, ${member.campaignId ?? null}::uuid, ${member.adSetId ?? null}::uuid, ${member.reason}, ${JSON.stringify(member.marketEvidenceRefs)}::jsonb, ${JSON.stringify(member.matchedDimensionIds)}::jsonb, ${JSON.stringify(member.matchedDimensionEvidenceRefs)}::jsonb)`);
      }
      return Object.freeze({ snapshotId });
    });
  }

  private async insertRevision(tx: Transaction, input: Readonly<{ workspaceId: string; actorId: string; sliceId: string; revision: SliceRevision; bindings: SliceRegistryBindings; lifecycle: "draft" | "published"; sourceRevisionId: string | null }>) {
    const revision = rows(await tx.execute(sql`insert into slice_revisions (workspace_id, slice_id, revision_number, revision_ref, definition_hash, market_definition_id, lifecycle, source_revision_id, created_by_actor_id) values (${input.workspaceId}::uuid, ${input.sliceId}::uuid, ${input.revision.revisionNumber}, ${input.revision.revisionRef}, ${input.revision.definitionHash}, ${input.bindings.marketDefinitionId}::uuid, ${input.lifecycle}, ${input.sourceRevisionId}::uuid, ${input.actorId}::uuid) returning id::text`))[0];
    if (!revision) throw new Error("slice registry repository rejected: write_failed"); const revisionId = id(revision, "id");
    for (const [position, predicate] of input.bindings.predicates.entries()) {
      const inserted = rows(await tx.execute(sql`insert into slice_revision_predicates (workspace_id, slice_revision_id, dimension_id, position) values (${input.workspaceId}::uuid, ${revisionId}::uuid, ${predicate.dimensionId}::uuid, ${position + 1}) returning id::text`))[0];
      if (!inserted) throw new Error("slice registry repository rejected: write_failed"); const predicateId = id(inserted, "id");
      for (const [valuePosition, definitionId] of predicate.valueIds.entries()) await tx.execute(sql`insert into slice_revision_predicate_values (workspace_id, predicate_id, definition_id, position) values (${input.workspaceId}::uuid, ${predicateId}::uuid, ${definitionId}::uuid, ${valuePosition + 1})`);
    }
    for (const override of input.bindings.overrides) await tx.execute(sql`insert into slice_revision_overrides (workspace_id, slice_revision_id, operation, entity_level, organization_campaign_id, campaign_id, ad_set_id) values (${input.workspaceId}::uuid, ${revisionId}::uuid, ${override.operation}, ${override.entityLevel}, ${override.organizationCampaignId ?? null}::uuid, ${override.campaignId ?? null}::uuid, ${override.adSetId ?? null}::uuid)`);
    return revisionId;
  }
}
