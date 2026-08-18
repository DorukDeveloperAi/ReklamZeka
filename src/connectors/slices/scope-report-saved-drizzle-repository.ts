import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  createSavedScopeReportRevision,
  normalizeSavedScopeReportQuery,
  savedScopeReportDigest,
  SavedScopeReportError,
  verifySavedScopeReportRevision,
  type SavedScopeReportQuery,
  type SavedScopeReportRevision,
} from "@/domain/slices/scope-report-saved";
type Database = NodePgDatabase<typeof schema>;
type Row = Record<string, unknown>;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REPORT = /^scope_report_saved_[a-f0-9]{24}$/;
const COMMAND = /^scope_report_save_[a-f0-9]{64}$/;
const rows = (value: unknown): Row[] =>
  value &&
  typeof value === "object" &&
  "rows" in value &&
  Array.isArray(value.rows)
    ? (value.rows as Row[])
    : (() => {
        throw new SavedScopeReportError("corrupt_store");
      })();
const text = (row: Row, key: string) => {
  const value = row[key];
  if (typeof value !== "string" || !value)
    throw new SavedScopeReportError("corrupt_store");
  return value;
};
const integer = (row: Row, key: string) => {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value))
    throw new SavedScopeReportError("corrupt_store");
  return value;
};
function decode(row: Row): SavedScopeReportRevision {
  const query = normalizeSavedScopeReportQuery(row.query_payload);
  const value = {
    version: "saved-scope-report/1.0.0" as const,
    workspaceId: text(row, "workspace_id"),
    reportRef: text(row, "report_ref"),
    commandRef: text(row, "command_ref"),
    revisionNumber: integer(row, "revision_number"),
    previousRevisionHash: text(row, "previous_revision_hash"),
    revisionHash: text(row, "revision_hash"),
    state: text(row, "state") as "active" | "archived",
    label: text(row, "label"),
    query,
    createdByActorId: text(row, "created_by_actor_id"),
    createdAt: new Date(text(row, "created_at")).toISOString(),
    authority: Object.freeze({
      canWriteMeta: false as const,
      canApprove: false as const,
      canExecute: false as const,
    }),
  };
  if (!verifySavedScopeReportRevision(value))
    throw new SavedScopeReportError("corrupt_store");
  return Object.freeze(value);
}
function sameCommand(
  found: SavedScopeReportRevision,
  input: Readonly<{
    workspaceId: string;
    actorId: string;
    commandRef: string;
    reportRef: string | null;
    expectedVersion: number | null;
    label: string;
    query: SavedScopeReportQuery;
    state: "active" | "archived";
  }>,
) {
  return (
    found.workspaceId === input.workspaceId &&
    found.commandRef === input.commandRef &&
    found.createdByActorId === input.actorId &&
    found.label === input.label &&
    found.state === input.state &&
    savedScopeReportDigest(found.query) === savedScopeReportDigest(input.query) &&
    (input.reportRef === null || found.reportRef === input.reportRef)
  );
}

export type SaveScopeReportInput = Readonly<{
  workspaceId: string;
  actorId: string;
  commandRef: string;
  reportRef: string | null;
  expectedVersion: number | null;
  label: string;
  query: SavedScopeReportQuery;
  state: "active" | "archived";
}>;
export class DrizzleScopeReportSavedRepository {
  constructor(private readonly database: Pick<Database, "transaction">) {}
  async save(
    raw: SaveScopeReportInput,
  ): Promise<
    Readonly<{ revision: SavedScopeReportRevision; replay: boolean }>
  > {
    const input = Object.freeze({
      ...raw,
      query: normalizeSavedScopeReportQuery(raw.query),
    });
    if (
      !UUID.test(input.workspaceId) ||
      !UUID.test(input.actorId) ||
      !COMMAND.test(input.commandRef) ||
      !(input.reportRef === null || REPORT.test(input.reportRef)) ||
      !(
        input.expectedVersion === null ||
        (Number.isSafeInteger(input.expectedVersion) &&
          input.expectedVersion >= 1)
      ) ||
      input.label.trim() !== input.label ||
      input.label.length < 1 ||
      input.label.length > 160 ||
      (input.reportRef === null) !== (input.expectedVersion === null)
    )
      throw new SavedScopeReportError("invalid_input");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`set local transaction isolation level serializable`);
      const replayRows = rows(
        await tx.execute(
          sql`select workspace_id::text,report_ref,command_ref,revision_number,previous_revision_hash,revision_hash,state,label,query_payload,created_by_actor_id::text,created_at::text from scope_report_saved_revisions where workspace_id=${input.workspaceId}::uuid and command_ref=${input.commandRef} limit 2`,
        ),
      );
      if (replayRows.length) {
        if (replayRows.length !== 1)
          throw new SavedScopeReportError("corrupt_store");
        const revision = decode(replayRows[0]!);
        if (!sameCommand(revision, input))
          throw new SavedScopeReportError("conflict");
        return Object.freeze({ revision, replay: true });
      }
      const actor = rows(
        await tx.execute(
          sql`select w.id::text workspace_id from workspaces w join memberships m on m.workspace_id=w.id and m.user_id=${input.actorId}::uuid and m.role in('owner','admin','analyst') where w.id=${input.workspaceId}::uuid and w.lifecycle_state='active' for share of w,m`,
        ),
      );
      if (actor.length !== 1) throw new SavedScopeReportError("invalid_input");
      const clock = rows(
        await tx.execute(
          sql`select date_trunc('milliseconds',transaction_timestamp())::text created_at`,
        ),
      );
      const createdAt = new Date(text(clock[0]!, "created_at")).toISOString();
      let bindingId: string,
        reportRef: string,
        revisionNumber: number,
        previousRevisionHash: string,
        oldHeadId: string | null = null;
      if (input.reportRef === null) {
        bindingId = randomUUID();
        reportRef = `scope_report_saved_${savedScopeReportDigest({ workspaceId: input.workspaceId, bindingId }).slice(0, 24)}`;
        revisionNumber = 1;
        previousRevisionHash = "GENESIS";
      } else {
        const headRows = rows(
          await tx.execute(
            sql`select h.id::text head_id,h.binding_id::text,h.report_ref,h.version,r.revision_hash from scope_report_saved_heads h join scope_report_saved_revisions r on r.workspace_id=h.workspace_id and r.id=h.latest_revision_id where h.workspace_id=${input.workspaceId}::uuid and h.report_ref=${input.reportRef} for update of h limit 2`,
          ),
        );
        if (
          headRows.length !== 1 ||
          integer(headRows[0]!, "version") !== input.expectedVersion
        )
          throw new SavedScopeReportError("conflict");
        bindingId = text(headRows[0]!, "binding_id");
        reportRef = text(headRows[0]!, "report_ref");
        revisionNumber = input.expectedVersion! + 1;
        previousRevisionHash = text(headRows[0]!, "revision_hash");
        oldHeadId = text(headRows[0]!, "head_id");
      }
      const revision = createSavedScopeReportRevision({
        workspaceId: input.workspaceId,
        reportRef,
        commandRef: input.commandRef,
        revisionNumber,
        previousRevisionHash,
        state: input.state,
        label: input.label,
        query: input.query,
        createdByActorId: input.actorId,
        createdAt,
      });
      const inserted = rows(
        await tx.execute(
          sql`insert into scope_report_saved_revisions(workspace_id,binding_id,report_ref,command_ref,revision_number,previous_revision_hash,revision_hash,state,label,slice_ref,query_payload,created_by_actor_id,created_at) values(${revision.workspaceId}::uuid,${bindingId}::uuid,${revision.reportRef},${revision.commandRef},${revision.revisionNumber},${revision.previousRevisionHash},${revision.revisionHash},${revision.state},${revision.label},${revision.query.slice},${JSON.stringify(revision.query)}::jsonb,${revision.createdByActorId}::uuid,${revision.createdAt}::timestamptz) returning id::text`,
        ),
      );
      if (inserted.length !== 1)
        throw new SavedScopeReportError("corrupt_store");
      const revisionId = text(inserted[0]!, "id");
      if (oldHeadId === null) {
        const created = rows(
          await tx.execute(
            sql`insert into scope_report_saved_heads(workspace_id,binding_id,report_ref,latest_revision_id,version,updated_at) values(${input.workspaceId}::uuid,${bindingId}::uuid,${reportRef},${revisionId}::uuid,1,${createdAt}::timestamptz) returning id::text`,
          ),
        );
        if (created.length !== 1)
          throw new SavedScopeReportError("corrupt_store");
      } else {
        const advanced = rows(
          await tx.execute(
            sql`update scope_report_saved_heads set latest_revision_id=${revisionId}::uuid,version=${revisionNumber},updated_at=${createdAt}::timestamptz where workspace_id=${input.workspaceId}::uuid and id=${oldHeadId}::uuid and version=${input.expectedVersion} returning id::text`,
          ),
        );
        if (advanced.length !== 1) throw new SavedScopeReportError("conflict");
      }
      return Object.freeze({ revision, replay: false });
    });
  }
  async list(
    workspaceId: string,
  ): Promise<readonly SavedScopeReportRevision[]> {
    if (!UUID.test(workspaceId))
      throw new SavedScopeReportError("invalid_input");
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`set local transaction isolation level repeatable read`,
      );
      await tx.execute(sql`set local transaction read only`);
      const result = rows(
        await tx.execute(
          sql`select r.workspace_id::text,r.report_ref,r.command_ref,r.revision_number,r.previous_revision_hash,r.revision_hash,r.state,r.label,r.query_payload,r.created_by_actor_id::text,r.created_at::text from scope_report_saved_heads h join scope_report_saved_revisions r on r.workspace_id=h.workspace_id and r.id=h.latest_revision_id where h.workspace_id=${workspaceId}::uuid order by r.label,r.report_ref limit 1001`,
        ),
      );
      if (result.length > 1000)
        throw new SavedScopeReportError("corrupt_store");
      return Object.freeze(result.map(decode));
    });
  }
}
