import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  DrizzleOperationReadRepository,
  type OperationReadTransaction,
} from "@/connectors/operations/operation-read-drizzle-repository";
import type { CurrentSliceEvidence } from "@/connectors/operations/operation-read-drizzle-repository";
import * as schema from "@/db/schema";
import { guideRunMembershipEvidenceHash } from "@/domain/guides/guide-run-membership-evidence";
import { metaPublicReference } from "@/domain/meta/public-reference";
import type { GuideRunStageableStatusCandidatePort } from "@/server/guide-run-codex-agent-adapter";
type Database = NodePgDatabase<typeof schema>;
type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] =>
  v && typeof v === "object" && "rows" in v && Array.isArray(v.rows)
    ? (v.rows as Row[])
    : [];
const text = (r: Row, k: string) =>
  typeof r[k] === "string" && r[k] ? (r[k] as string) : null;

/** Server-owned status candidate builder; unsupported action/entity shapes return null. */
export class DrizzleGuideRunStageableStatusCandidateRepository implements GuideRunStageableStatusCandidatePort {
  constructor(
    private readonly database: Pick<Database, "transaction">,
    private readonly scopes?: Readonly<{
      currentSliceEvidenceInTransaction(
        transaction: OperationReadTransaction,
        workspaceId: string,
        sliceRef: string | null,
      ): Promise<CurrentSliceEvidence>;
    }>,
  ) {}
  async load(
    input: Parameters<GuideRunStageableStatusCandidatePort["load"]>[0],
  ) {
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`set local transaction isolation level repeatable read`,
      );
      await tx.execute(sql`set local transaction read only`);
      return this.loadInTransaction(tx as OperationReadTransaction, input);
    });
  }

  async loadInTransaction(
    tx: OperationReadTransaction,
    input: Parameters<GuideRunStageableStatusCandidatePort["load"]>[0],
  ) {
    const stored = rows(
      await tx.execute(
        sql`select r.workspace_id::text workspace_id,gr.slice_ref,gr.market_key,gr.mode,a.payload scope_payload,array(select x.action from guide_revision_actions x where x.workspace_id=gr.workspace_id and x.guide_revision_id=gr.id order by x.action) actions from guide_runs r join guide_revisions gr on gr.workspace_id=r.workspace_id and gr.id=r.guide_revision_id and gr.guide_id=r.guide_id join guide_heads gh on gh.workspace_id=r.workspace_id and gh.guide_id=r.guide_id and gh.current_active_revision_id=r.guide_revision_id join guides g on g.workspace_id=r.workspace_id and g.id=r.guide_id and g.tombstoned_at is null join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' join guide_run_artifacts a on a.workspace_id=r.workspace_id and a.run_id=r.id and a.kind='scope_snapshot' where r.run_ref=${input.runRef} and r.guide_revision_hash=${input.guideRevisionHash} limit 2`,
      ),
    );
    if (stored.length !== 1) return null;
    const row = stored[0]!,
      scope = row.scope_payload as Row,
      actions = row.actions;
    if (
      scope?.sliceSnapshotHash !== input.sliceSnapshotHash ||
      !Array.isArray(scope.members) ||
      scope.members.filter(
        (m) =>
          m &&
          typeof m === "object" &&
          (m as Row).memberRef === input.member.memberRef &&
          (m as Row).membershipHash === input.member.membershipHash,
      ).length !== 1 ||
      !Array.isArray(actions) ||
      actions.length !== 1 ||
      !(actions[0] === "status_pause" || actions[0] === "status_activate") ||
      !(
        row.mode === "prepare_human_approval" || row.mode === "limited_autonomy"
      )
    )
      return null;
    const workspaceId = text(row, "workspace_id"),
      sliceRef = text(row, "slice_ref"),
      market = row.market_key;
    if (
      !workspaceId ||
      !sliceRef ||
      !(market === "yerli" || market === "yabanci")
    )
      return null;
    const operation =
      this.scopes ??
      new DrizzleOperationReadRepository({
        transaction: async (
          work: (inner: OperationReadTransaction) => Promise<unknown>,
        ) => work(tx as OperationReadTransaction),
      } as never);
    let current;
    try {
      current = await operation.currentSliceEvidenceInTransaction(
        tx as OperationReadTransaction,
        workspaceId,
        sliceRef,
      );
    } catch {
      return null;
    }
    if (
      current.sliceRef !== sliceRef ||
      current.market?.key !== market ||
      !current.revisionRef ||
      !current.definitionHash
    )
      return null;
    const evaluation = current.resolution?.included.filter(
      (item) =>
        item.entityLevel === "ad_set" &&
        item.entityRef === input.member.memberRef,
    );
    if (
      evaluation?.length !== 1 ||
      guideRunMembershipEvidenceHash({
        sliceRef,
        revisionRef: current.revisionRef,
        definitionHash: current.definitionHash,
        membership: evaluation[0]!,
      }) !== input.member.membershipHash
    )
      return null;
    const ids = current.adSetIds.filter(
      (id) =>
        metaPublicReference("ad_set", workspaceId, id) ===
        input.member.memberRef,
    );
    if (ids.length !== 1) return null;
    const stateRows = rows(
      await tx.execute(
        sql`select configured_status,effective_status from meta_ad_sets where workspace_id=${workspaceId}::uuid and id=${ids[0]}::uuid and disappeared_at is null limit 2`,
      ),
    );
    if (stateRows.length !== 1) return null;
    const from =
      stateRows[0]!.configured_status === stateRows[0]!.effective_status
        ? stateRows[0]!.configured_status
        : null;
    const action = actions[0] as "status_pause" | "status_activate";
    if (
      (action === "status_pause" && from !== "ACTIVE") ||
      (action === "status_activate" && from !== "PAUSED")
    )
      return null;
    const to = action === "status_pause" ? "PAUSED" : "ACTIVE";
    return Object.freeze({
      action,
      stageable: Object.freeze({
        version: "candidate/1.1" as const,
        entityRef: input.member.memberRef,
        entityLevel: "adset" as const,
        membershipHash: input.member.membershipHash,
        sliceRef,
        market,
        typedAction: Object.freeze({
          kind: "status_change",
          entity: Object.freeze({
            level: "adset",
            ref: input.member.memberRef,
          }),
          fromStatus: from,
          toStatus: to,
        }),
      }),
    });
  }
}
