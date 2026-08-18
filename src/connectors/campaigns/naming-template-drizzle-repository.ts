import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  createNamingTemplateRevision,
  NamingTemplateError,
  transitionNamingTemplateRevision,
  type NamingTemplateRevision,
} from "@/domain/campaigns/naming-template";
import { metaPublicReference } from "@/domain/meta/public-reference";

type Database = NodePgDatabase<typeof schema>;
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COMMAND = /^naming_template_command_[a-f0-9]{64}$/;
const TEMPLATE = /^naming_template_[a-z0-9][a-z0-9_.:-]{0,95}$/;
const ACCOUNT = /^account_[a-f0-9]{24}$/;
const rows = (value: unknown): Row[] => value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
  ? value.rows as Row[] : fail("corrupt_template");
const fail = (code: NamingTemplateError["code"]): never => { throw new NamingTemplateError(code); };
const text = (row: Row, key: string): string => typeof row[key] === "string" && row[key] ? row[key] as string : fail("corrupt_template");
const integer = (row: Row, key: string): number => {
  const value = Number(row[key]);
  return Number.isSafeInteger(value) ? value : fail("corrupt_template");
};
const workspaceRef = (workspaceId: string) => `workspace_${createHash("sha256").update(workspaceId).digest("hex").slice(0, 24)}`;

function decode(row: Row): NamingTemplateRevision {
  const payload = row.template_payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("corrupt_template");
  let rebuilt: NamingTemplateRevision;
  try {
    const value = payload as NamingTemplateRevision;
    rebuilt = createNamingTemplateRevision({
      workspaceRef: value.workspaceRef, accountRef: value.accountRef, templateRef: value.templateRef,
      revision: value.revision, previousRevisionHash: value.previousRevisionHash, state: value.state,
      namingFamily: value.namingFamily, entityLevel: value.entityLevel, nameRules: value.nameRules,
      corroboration: value.corroboration, proposedAssignments: value.proposedAssignments,
    });
  } catch { return fail("corrupt_template"); }
  if (rebuilt.revisionHash !== (payload as NamingTemplateRevision).revisionHash
    || rebuilt.templateRef !== text(row, "template_ref") || rebuilt.revision !== integer(row, "revision")
    || rebuilt.revisionHash !== text(row, "revision_hash") || rebuilt.state !== text(row, "state")
    || rebuilt.accountRef !== text(row, "account_ref")) fail("corrupt_template");
  return rebuilt;
}

export type SaveNamingTemplateInput = Readonly<{
  workspaceId: string;
  actorId: string;
  accountRef: string;
  templateRef: string;
  commandRef: string;
  expectedRevision: number | null;
  state: "draft" | "published" | "disabled";
  namingFamily: string;
  entityLevel: "campaign" | "ad_set";
  nameRules: NamingTemplateRevision["nameRules"];
  corroboration: NamingTemplateRevision["corroboration"];
  proposedAssignments: NamingTemplateRevision["proposedAssignments"];
}>;

function sameCommand(revision: NamingTemplateRevision, input: SaveNamingTemplateInput, actorId: string): boolean {
  try {
    const expected = createNamingTemplateRevision({
      workspaceRef: revision.workspaceRef, accountRef: input.accountRef, templateRef: input.templateRef,
      revision: revision.revision, previousRevisionHash: revision.previousRevisionHash, state: input.state,
      namingFamily: input.namingFamily, entityLevel: input.entityLevel, nameRules: input.nameRules,
      corroboration: input.corroboration, proposedAssignments: input.proposedAssignments,
    });
    return actorId === input.actorId && revision.revision === (input.expectedRevision ?? 0) + 1
      && expected.revisionHash === revision.revisionHash;
  } catch { return false; }
}

export class DrizzleNamingTemplateRepository {
  constructor(private readonly database: Pick<Database, "transaction">) {}

  async save(input: SaveNamingTemplateInput): Promise<Readonly<{ revision: NamingTemplateRevision; replay: boolean }>> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !ACCOUNT.test(input.accountRef)
      || !TEMPLATE.test(input.templateRef) || !COMMAND.test(input.commandRef)
      || !(input.expectedRevision === null || Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 1)) fail("invalid_input");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`set local transaction isolation level serializable`);
      const replayRows = rows(await tx.execute(sql`select r.template_ref,r.revision,r.revision_hash,r.state,r.template_payload,r.created_by_actor_id::text actor_id,('account_'||substr(encode(extensions.digest(convert_to(r.workspace_id::text,'UTF8')||decode('00','hex')||convert_to('account','UTF8')||decode('00','hex')||convert_to(r.ad_account_id::text,'UTF8'),'sha256'),'hex'),1,24)) account_ref from naming_template_revisions r where r.workspace_id=${input.workspaceId}::uuid and r.command_ref=${input.commandRef} limit 2`));
      if (replayRows.length) {
        if (replayRows.length !== 1) fail("corrupt_template");
        const revision = decode(replayRows[0]!);
        if (!sameCommand(revision, input, text(replayRows[0]!, "actor_id"))) fail("invalid_revision");
        return Object.freeze({ revision, replay: true });
      }
      const accountRows = rows(await tx.execute(sql`select a.id::text from workspaces w join memberships m on m.workspace_id=w.id and m.user_id=${input.actorId}::uuid join ad_accounts a on a.workspace_id=w.id and a.disappeared_at is null where w.id=${input.workspaceId}::uuid and w.lifecycle_state='active' and m.role in('owner','admin','analyst') order by a.id limit 1001 for share of w,m,a`));
      if (accountRows.length > 1000) fail("invalid_scope");
      const accountIds = accountRows.map((row) => text(row, "id"));
      const matches = accountIds.filter((id) => metaPublicReference("account", input.workspaceId, id) === input.accountRef);
      if (matches.length !== 1) fail("invalid_scope");
      const accountId = matches[0]!;
      let revision: NamingTemplateRevision;
      let oldHeadId: string | null = null;
      if (input.expectedRevision === null) {
        revision = createNamingTemplateRevision({ workspaceRef: workspaceRef(input.workspaceId), accountRef: input.accountRef,
          templateRef: input.templateRef, revision: 1, previousRevisionHash: null, state: input.state,
          namingFamily: input.namingFamily, entityLevel: input.entityLevel, nameRules: input.nameRules,
          corroboration: input.corroboration, proposedAssignments: input.proposedAssignments });
      } else {
        const headRows = rows(await tx.execute(sql`select h.id::text head_id,h.version,r.template_payload,r.template_ref,r.revision,r.revision_hash,r.state,${input.accountRef}::text account_ref from naming_template_heads h join naming_template_revisions r on r.workspace_id=h.workspace_id and r.id=h.latest_revision_id where h.workspace_id=${input.workspaceId}::uuid and h.ad_account_id=${accountId}::uuid and h.template_ref=${input.templateRef} for update of h limit 2`));
        if (headRows.length !== 1 || integer(headRows[0]!, "version") !== input.expectedRevision) fail("invalid_revision");
        const previous = decode(headRows[0]!);
        oldHeadId = text(headRows[0]!, "head_id");
        revision = transitionNamingTemplateRevision(previous, { workspaceRef: previous.workspaceRef, accountRef: previous.accountRef,
          templateRef: previous.templateRef, revision: previous.revision + 1, previousRevisionHash: previous.revisionHash,
          state: input.state, namingFamily: input.namingFamily, entityLevel: input.entityLevel, nameRules: input.nameRules,
          corroboration: input.corroboration, proposedAssignments: input.proposedAssignments });
      }
      const clockRows = rows(await tx.execute(sql`select date_trunc('milliseconds',transaction_timestamp())::text created_at`));
      const createdAt = text(clockRows[0]!, "created_at");
      const inserted = rows(await tx.execute(sql`insert into naming_template_revisions(workspace_id,ad_account_id,template_ref,command_ref,revision,previous_revision_hash,revision_hash,state,naming_family,entity_level,template_payload,created_by_actor_id,created_at) values(${input.workspaceId}::uuid,${accountId}::uuid,${revision.templateRef},${input.commandRef},${revision.revision},${revision.previousRevisionHash},${revision.revisionHash},${revision.state},${revision.namingFamily},${revision.entityLevel},${JSON.stringify(revision)}::jsonb,${input.actorId}::uuid,${createdAt}::timestamptz) returning id::text`));
      if (inserted.length !== 1) fail("corrupt_template");
      const revisionId = text(inserted[0]!, "id");
      if (oldHeadId === null) {
        if (input.expectedRevision !== null) fail("invalid_revision");
        const created = rows(await tx.execute(sql`insert into naming_template_heads(workspace_id,ad_account_id,template_ref,latest_revision_id,version,updated_at) values(${input.workspaceId}::uuid,${accountId}::uuid,${revision.templateRef},${revisionId}::uuid,1,${createdAt}::timestamptz) returning id::text`));
        if (created.length !== 1) fail("corrupt_template");
      } else {
        const advanced = rows(await tx.execute(sql`update naming_template_heads set latest_revision_id=${revisionId}::uuid,version=${revision.revision},updated_at=${createdAt}::timestamptz where workspace_id=${input.workspaceId}::uuid and id=${oldHeadId}::uuid and version=${input.expectedRevision} returning id::text`));
        if (advanced.length !== 1) fail("invalid_revision");
      }
      return Object.freeze({ revision, replay: false });
    });
  }

  async list(workspaceId: string, accountRef: string): Promise<readonly NamingTemplateRevision[]> {
    if (!UUID.test(workspaceId) || !ACCOUNT.test(accountRef)) fail("invalid_input");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`set local transaction isolation level repeatable read`);
      await tx.execute(sql`set local transaction read only`);
      const accountRows = rows(await tx.execute(sql`select id::text from ad_accounts where workspace_id=${workspaceId}::uuid and disappeared_at is null order by id limit 1001`));
      const matches = accountRows.map((row) => text(row, "id")).filter((id) => metaPublicReference("account", workspaceId, id) === accountRef);
      if (matches.length !== 1) fail("invalid_scope");
      const result = rows(await tx.execute(sql`select r.template_ref,r.revision,r.revision_hash,r.state,r.template_payload,${accountRef}::text account_ref from naming_template_heads h join naming_template_revisions r on r.workspace_id=h.workspace_id and r.id=h.latest_revision_id where h.workspace_id=${workspaceId}::uuid and h.ad_account_id=${matches[0]}::uuid order by r.template_ref limit 1001`));
      if (result.length > 1000) fail("corrupt_template");
      return Object.freeze(result.map(decode));
    });
  }
}
