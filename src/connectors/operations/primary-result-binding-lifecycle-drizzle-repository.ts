import "server-only";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { isPrimaryResultBindingRevision, type PrimaryResultBindingRevision, type TrustedPrimaryResultActionCatalog } from "@/domain/operations/primary-result";
import { isTrustedPrimaryResultActionCatalog } from "@/domain/operations/internal/trusted-primary-result-catalog";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TARGETS = 200;
const rows = (value: unknown): readonly Row[] => {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) throw new PrimaryResultBindingRepositoryError("corrupt_store");
  return value.rows as readonly Row[];
};
const one = (value: readonly Row[]): Row => { if (value.length !== 1) throw new PrimaryResultBindingRepositoryError(value.length ? "corrupt_store" : "not_found"); return value[0]!; };
const str = (row: Row, key: string): string => { const value = row[key]; if (typeof value !== "string" || !value) throw new PrimaryResultBindingRepositoryError("corrupt_store"); return value; };
const nullable = (row: Row, key: string): string | null => row[key] === null ? null : str(row, key);
function targetSql(revision: PrimaryResultBindingRevision) {
  return revision.target.kind === "organization_campaign"
    ? Object.freeze({ kind: "organization_campaign" as const, orgId: revision.target.organizationCampaignId, sliceId: null })
    : Object.freeze({ kind: "slice" as const, orgId: null, sliceId: revision.target.sliceId });
}
function persisted(row: Row): PrimaryResultBindingRevision {
  const kind = str(row, "subject_kind");
  const revision = Object.freeze({
    version: "primary-result-binding/1.0.0" as const,
    bindingId: str(row, "binding_id"), workspaceId: str(row, "workspace_id"),
    target: kind === "organization_campaign"
      ? Object.freeze({ kind: "organization_campaign" as const, organizationCampaignId: str(row, "organization_campaign_id") })
      : kind === "slice" ? Object.freeze({ kind: "slice" as const, sliceId: str(row, "slice_id") }) : null,
    state: str(row, "state") as "bound" | "unbound", selector: nullable(row, "selector"), actionCatalogHash: nullable(row, "action_catalog_hash"),
    previousRevisionHash: nullable(row, "previous_revision_hash"), createdAt: new Date(str(row, "created_at")).toISOString(), revisionHash: str(row, "revision_hash"),
  });
  if (!revision.target || !isPrimaryResultBindingRevision(revision)) throw new PrimaryResultBindingRepositoryError("corrupt_store");
  return revision;
}
function sameRevision(left: PrimaryResultBindingRevision, right: PrimaryResultBindingRevision) { return left.revisionHash === right.revisionHash && JSON.stringify(left) === JSON.stringify(right); }

export class PrimaryResultBindingRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "forbidden" | "not_found" | "conflict" | "corrupt_store") { super(`primary result binding rejected: ${code}`); this.name = "PrimaryResultBindingRepositoryError"; }
}
export type PrimaryResultBindingHead = Readonly<{ bindingId: string; version: number; marketDefinitionId: string; latestRevision: PrimaryResultBindingRevision }>;

/** Server-only persistence. It does not grant guide, approval, or Meta-write authority. */
export class DrizzlePrimaryResultBindingLifecycleRepository {
  constructor(private readonly database: Pick<Database, "transaction">) {}

  async persist(input: Readonly<{ workspaceId: string; actorId: string; actorRole: "owner" | "admin" | "analyst" | "viewer"; expectedHeadVersion: number; expectedRevisionHash: string | null; revision: PrimaryResultBindingRevision; actionCatalog: TrustedPrimaryResultActionCatalog | null }>): Promise<PrimaryResultBindingHead> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !isPrimaryResultBindingRevision(input.revision) || input.revision.workspaceId !== input.workspaceId || !Number.isSafeInteger(input.expectedHeadVersion) || input.expectedHeadVersion < 0 || (input.expectedRevisionHash !== null && !/^[a-f0-9]{64}$/.test(input.expectedRevisionHash))) throw new PrimaryResultBindingRepositoryError("invalid_input");
    if (input.revision.state === "bound" ? !input.actionCatalog || !isTrustedPrimaryResultActionCatalog(input.actionCatalog) || input.actionCatalog.workspaceId !== input.workspaceId || input.actionCatalog.catalogHash !== input.revision.actionCatalogHash : input.actionCatalog !== null) throw new PrimaryResultBindingRepositoryError("invalid_input");
    const target = targetSql(input.revision);
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`set local transaction isolation level serializable`);
      const workspace = rows(await tx.execute(sql`select lifecycle_state from workspaces where id=${input.workspaceId}::uuid for update`));
      if (workspace.length !== 1 || workspace[0]!.lifecycle_state !== "active") throw new PrimaryResultBindingRepositoryError("not_found");
      const membership = rows(await tx.execute(sql`select role from memberships where workspace_id=${input.workspaceId}::uuid and user_id=${input.actorId}::uuid for update`));
      if (membership.length !== 1 || (membership[0]!.role !== "owner" && membership[0]!.role !== "admin")) throw new PrimaryResultBindingRepositoryError("forbidden");
      const subject = rows(await tx.execute(target.kind === "organization_campaign"
        ? sql`select market_definition_id::text market_definition_id from organization_campaigns where workspace_id=${input.workspaceId}::uuid and id=${target.orgId}::uuid and tombstoned_at is null for update`
        : sql`select market_definition_id::text market_definition_id from slices where workspace_id=${input.workspaceId}::uuid and id=${target.sliceId}::uuid and tombstoned_at is null for update`));
      if (subject.length !== 1) throw new PrimaryResultBindingRepositoryError("not_found");
      const marketDefinitionId = str(subject[0]!, "market_definition_id");
      const headRows = rows(await tx.execute(sql`select h.id::text head_id,h.binding_id::text,h.version,h.market_definition_id::text,h.latest_revision_id::text,r.* from primary_result_binding_heads h join primary_result_binding_revisions r on r.workspace_id=h.workspace_id and r.id=h.latest_revision_id where h.workspace_id=${input.workspaceId}::uuid and h.subject_kind=${target.kind} and h.organization_campaign_id is not distinct from ${target.orgId}::uuid and h.slice_id is not distinct from ${target.sliceId}::uuid for update`));
      if (headRows.length > 1) throw new PrimaryResultBindingRepositoryError("corrupt_store");
      const existingByHash = rows(await tx.execute(sql`select * from primary_result_binding_revisions where workspace_id=${input.workspaceId}::uuid and revision_hash=${input.revision.revisionHash}`));
      if (existingByHash.length > 1) throw new PrimaryResultBindingRepositoryError("corrupt_store");
      if (existingByHash.length === 1) {
        const existing = persisted(existingByHash[0]!);
        if (!sameRevision(existing, input.revision) || headRows.length !== 1 || str(headRows[0]!, "latest_revision_id") !== str(existingByHash[0]!, "id")) throw new PrimaryResultBindingRepositoryError("conflict");
        return Object.freeze({ bindingId: str(headRows[0]!, "binding_id"), version: Number(headRows[0]!.version), marketDefinitionId: str(headRows[0]!, "market_definition_id"), latestRevision: existing });
      }
      const current = headRows.length === 1 ? headRows[0]! : null;
      const currentRevision = current ? persisted(current) : null;
      if ((current ? Number(current.version) : 0) !== input.expectedHeadVersion || (currentRevision?.revisionHash ?? null) !== input.expectedRevisionHash || input.revision.previousRevisionHash !== input.expectedRevisionHash || (current && input.revision.bindingId !== str(current, "binding_id"))) throw new PrimaryResultBindingRepositoryError("conflict");
      const revisionNumber = input.expectedHeadVersion + 1;
      const inserted = one(rows(await tx.execute(sql`insert into primary_result_binding_revisions (workspace_id,binding_id,subject_kind,organization_campaign_id,slice_id,market_definition_id,revision_number,revision_hash,previous_revision_hash,state,selector,action_catalog_hash,created_by_actor_id,created_at) values (${input.workspaceId}::uuid,${input.revision.bindingId}::uuid,${target.kind},${target.orgId}::uuid,${target.sliceId}::uuid,${marketDefinitionId}::uuid,${revisionNumber},${input.revision.revisionHash},${input.revision.previousRevisionHash},${input.revision.state},${input.revision.selector},${input.revision.actionCatalogHash},${input.actorId}::uuid,${input.revision.createdAt}::timestamptz) returning id::text`)));
      const revisionId = str(inserted, "id");
      if (!current) await tx.execute(sql`insert into primary_result_binding_heads (workspace_id,binding_id,subject_kind,organization_campaign_id,slice_id,market_definition_id,latest_revision_id,version,updated_at) values (${input.workspaceId}::uuid,${input.revision.bindingId}::uuid,${target.kind},${target.orgId}::uuid,${target.sliceId}::uuid,${marketDefinitionId}::uuid,${revisionId}::uuid,1,${input.revision.createdAt}::timestamptz)`);
      else {
        const updated = rows(await tx.execute(sql`update primary_result_binding_heads set latest_revision_id=${revisionId}::uuid,version=${revisionNumber},updated_at=${input.revision.createdAt}::timestamptz where workspace_id=${input.workspaceId}::uuid and id=${str(current,"head_id")}::uuid and version=${input.expectedHeadVersion} returning id`));
        if (updated.length !== 1) throw new PrimaryResultBindingRepositoryError("conflict");
      }
      return Object.freeze({ bindingId: input.revision.bindingId, version: revisionNumber, marketDefinitionId, latestRevision: input.revision });
    }).catch((reason: unknown) => { if (reason instanceof PrimaryResultBindingRepositoryError) throw reason; const error = new PrimaryResultBindingRepositoryError("conflict"); (error as Error & { cause?: unknown }).cause = reason; throw error; });
  }

  async current(workspaceId: string, targets: readonly PrimaryResultBindingRevision["target"][]): Promise<ReadonlyMap<string, PrimaryResultBindingHead>> {
    if (!UUID.test(workspaceId) || targets.length > MAX_TARGETS || targets.some((target) => target.kind === "organization_campaign" ? !UUID.test(target.organizationCampaignId) : !UUID.test(target.sliceId))) throw new PrimaryResultBindingRepositoryError("invalid_input");
    const wanted = targets.map((target) => target.kind === "organization_campaign" ? { kind: target.kind, id: target.organizationCampaignId } : { kind: target.kind, id: target.sliceId });
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`set local transaction isolation level repeatable read`); await tx.execute(sql`set local transaction read only`);
      const result = rows(await tx.execute(sql`select h.id::text head_id,h.binding_id::text,h.version,h.market_definition_id::text,h.latest_revision_id::text,r.* from primary_result_binding_heads h join primary_result_binding_revisions r on r.workspace_id=h.workspace_id and r.id=h.latest_revision_id join workspaces w on w.id=h.workspace_id and w.lifecycle_state='active' join jsonb_to_recordset(${JSON.stringify(wanted)}::jsonb) as wanted(kind text,id uuid) on wanted.kind=h.subject_kind and wanted.id is not distinct from coalesce(h.organization_campaign_id,h.slice_id) where h.workspace_id=${workspaceId}::uuid and ((h.subject_kind='organization_campaign' and exists(select 1 from organization_campaigns o where o.workspace_id=h.workspace_id and o.id=h.organization_campaign_id and o.tombstoned_at is null)) or (h.subject_kind='slice' and exists(select 1 from slices s where s.workspace_id=h.workspace_id and s.id=h.slice_id and s.tombstoned_at is null))) limit ${MAX_TARGETS + 1}`));
      if (result.length > MAX_TARGETS) throw new PrimaryResultBindingRepositoryError("corrupt_store");
      const out = new Map<string, PrimaryResultBindingHead>();
      for (const row of result) { const revision = persisted(row); const key = revision.target.kind === "organization_campaign" ? `organization_campaign:${revision.target.organizationCampaignId}` : `slice:${revision.target.sliceId}`; if (out.has(key)) throw new PrimaryResultBindingRepositoryError("corrupt_store"); out.set(key, Object.freeze({ bindingId: str(row, "binding_id"), version: Number(row.version), marketDefinitionId: str(row, "market_definition_id"), latestRevision: revision })); }
      return out;
    });
  }
}
