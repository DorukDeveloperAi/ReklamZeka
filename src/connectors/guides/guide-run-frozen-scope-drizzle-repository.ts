import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  GuideRunFrozenScopePort,
  FrozenGuideRunScope,
} from "@/application/guide-run-orchestration-service";
import {
  DrizzleOperationReadRepository,
  type OperationReadTransaction,
} from "@/connectors/operations/operation-read-drizzle-repository";
import { guideRunMembershipEvidenceHash } from "@/domain/guides/guide-run-membership-evidence";
import { canonicalGuideWorkspaceRef } from "@/domain/guides/guide-revision";
import * as schema from "@/db/schema";
type Database = NodePgDatabase<typeof schema>;
const HASH = /^[a-f0-9]{64}$/;
const stable = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, stable(x)]),
        )
      : v;
const hash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(stable(v)))
    .digest("hex");
/** Multi-workspace private adapter: tenant identity is read from the run/revision chain. */
export class DrizzleGuideRunFrozenScopeRepository implements GuideRunFrozenScopePort {
  constructor(private readonly database: Pick<Database, "transaction">) {}
  async loadOrFreeze(
    input: Parameters<GuideRunFrozenScopePort["loadOrFreeze"]>[0],
  ): Promise<FrozenGuideRunScope> {
    if (input.run.state !== "claimed" || !input.run.lease)
      throw new Error("guide frozen scope unavailable");
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`set local transaction isolation level repeatable read`,
      );
      await tx.execute(sql`set local transaction read only`);
      const result = await tx.execute(
        sql`select r.workspace_id::text workspace_id,r.run_payload,gr.slice_ref,gr.market_key,gr.guide_id::text revision_guide_id,r.guide_id::text run_guide_id from guide_runs r join guide_run_heads h on h.workspace_id=r.workspace_id and h.run_id=r.id join guide_revisions gr on gr.workspace_id=r.workspace_id and gr.id=r.guide_revision_id join guide_heads gh on gh.workspace_id=r.workspace_id and gh.guide_id=r.guide_id and gh.current_active_revision_id=r.guide_revision_id join guides g on g.workspace_id=r.workspace_id and g.id=r.guide_id and g.tombstoned_at is null join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' where r.run_ref=${input.run.runRef} and r.guide_revision_hash=${input.run.guideRevisionHash} and gr.revision_hash=${input.guide.revisionHash} and gr.guide_ref=${input.guide.guideRef} and h.head_event_hash=${input.run.headEventHash} and h.state='claimed' and h.lease_token=${input.run.lease!.token}::uuid and h.lease_epoch=${input.run.lease!.epoch}::integer limit 2`,
      );
      const rows = result.rows as Array<Record<string, unknown>>;
      const row = rows[0];
      if (
        rows.length !== 1 ||
        !row ||
        typeof row.workspace_id !== "string" ||
        canonicalGuideWorkspaceRef(row.workspace_id) !==
          input.run.workspaceRef ||
        input.run.workspaceRef !== input.guide.workspaceRef ||
        row.run_guide_id !== row.revision_guide_id ||
        row.slice_ref !== input.guide.sliceRef ||
        row.market_key !== input.guide.market
      )
        throw new Error("guide frozen scope unavailable");
      const payload = row.run_payload as Record<string, unknown>;
      if (
        !payload ||
        payload.workspaceRef !== input.run.workspaceRef ||
        payload.runRef !== input.run.runRef ||
        payload.guideRevisionHash !== input.run.guideRevisionHash
      )
        throw new Error("guide frozen scope unavailable");
      const scopes = new DrizzleOperationReadRepository({
        transaction: async (
          work: (inner: OperationReadTransaction) => Promise<unknown>,
        ) => work(tx as OperationReadTransaction),
      } as never);
      const evidence = await scopes.currentSliceEvidenceInTransaction(
        tx as OperationReadTransaction,
        row.workspace_id,
        input.guide.sliceRef,
      );
      if (
        !evidence.resolution ||
        evidence.resolution.sliceRef !== input.guide.sliceRef ||
        !evidence.revisionRef ||
        !evidence.definitionHash ||
        evidence.market?.key !== input.guide.market ||
        evidence.resolution.included.length > 10000
      )
        throw new Error("guide frozen scope unavailable");
      const members = evidence.resolution.included
        .map((m) =>
          Object.freeze({
            memberRef: m.entityRef,
            membershipHash: guideRunMembershipEvidenceHash({
              sliceRef: input.guide.sliceRef,
              revisionRef: evidence.revisionRef!,
              definitionHash: evidence.definitionHash!,
              membership: m,
            }),
          }),
        )
        .sort((a, b) => a.memberRef.localeCompare(b.memberRef));
      if (
        new Set(members.map((m) => m.memberRef)).size !== members.length ||
        members.some((m) => !HASH.test(m.membershipHash))
      )
        throw new Error("guide frozen scope unavailable");
      const sliceSnapshotHash = hash({
        guideRevisionHash: input.run.guideRevisionHash,
        sliceRef: input.guide.sliceRef,
        sliceDefinitionHash: evidence.definitionHash,
        members,
      });
      return Object.freeze({
        runRef: input.run.runRef,
        guideRevisionHash: input.run.guideRevisionHash,
        sliceRef: input.guide.sliceRef,
        sliceDefinitionHash: evidence.definitionHash,
        sliceSnapshotHash,
        members: Object.freeze(members),
      });
    });
  }
}
