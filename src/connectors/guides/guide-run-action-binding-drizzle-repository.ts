import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;

export class GuideRunActionBindingRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "corrupt_store" | "conflict") { super(`P06 action binding rejected: ${code}`); }
}
function fail(code: GuideRunActionBindingRepositoryError["code"]): never { throw new GuideRunActionBindingRepositoryError(code); }
function rows(value: unknown): readonly Row[] { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store"); return value.rows as readonly Row[]; }
function one(value: readonly Row[]): Row | null { if (value.length > 1) fail("corrupt_store"); return value[0] ?? null; }
function text(row: Row, key: string): string { const value = row[key]; if (typeof value !== "string") fail("corrupt_store"); return value; }

/**
 * Server-only materializer. The only write is an immutable link to an ActionUnit
 * that already exists in the canonical approval queue; it does not stage,
 * approve, execute, or call Meta.
 */
export class DrizzleGuideRunActionBindingRepository {
  constructor(private readonly database: Pick<Database, "execute" | "transaction">) {}

  async bind(input: Readonly<{ workspaceId: string; runRef: string }>): Promise<Readonly<{ bindingId: string; replay: boolean }>> {
    if (!UUID.test(input.workspaceId) || !REF.test(input.runRef)) fail("invalid_input");
    return this.database.transaction(async (tx) => {
      const source = one(rows(await tx.execute(sql`
        select r.id::text run_id,r.guide_revision_id::text guide_revision_id,a.id::text disposition_artifact_id,
          u.id::text action_unit_id,b.id::text proposal_bundle_id,u.unit_ref,u.unit_hash,b.bundle_ref,b.bundle_hash,u.entity_ref,gr.slice_ref,gr.market_key,
          public.guide_run_sha256(jsonb_build_object('guideRef',g.guide_ref,'guideRevisionHash',r.guide_revision_hash,'sliceRef',gr.slice_ref,'market',gr.market_key)) effective_guide_set_hash,
          public.guide_run_sha256(jsonb_build_object('guideRevisionHash',r.guide_revision_hash,'candidateHash',a.payload->'disposition'->'candidate'->>'candidateHash','actionUnitHash',u.unit_hash,'proposalHash',b.bundle_hash)) resolution_hash
        from guide_runs r
        join guide_run_heads h on h.workspace_id=r.workspace_id and h.run_id=r.id and h.state='completed'
        join guide_run_artifacts a on a.workspace_id=r.workspace_id and a.run_id=r.id and a.kind='disposition'
        join guide_revisions gr on gr.workspace_id=r.workspace_id and gr.id=r.guide_revision_id
        join guide_heads gh on gh.workspace_id=r.workspace_id and gh.guide_id=r.guide_id and gh.current_active_revision_id=r.guide_revision_id
        join guides g on g.workspace_id=r.workspace_id and g.id=r.guide_id and g.tombstoned_at is null
        join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active'
        join action_proposal_units u on u.workspace_id=r.workspace_id and u.source_hash=a.payload->'disposition'->'candidate'->>'candidateHash' and u.action_type=a.payload->'disposition'->'candidate'->>'action'
        join action_proposal_bundles b on b.workspace_id=u.workspace_id and b.id=u.bundle_id
        where r.workspace_id=${input.workspaceId}::uuid and r.run_ref=${input.runRef}
        order by a.created_at,a.id limit 2 for update of r,h,a,gr,gh,g,w,u,b`)));
      if (!source) fail("not_found");
      const existing = one(rows(await tx.execute(sql`select id::text,action_unit_hash,proposal_hash,entity_ref,slice_ref,market_key,effective_guide_set_hash,resolution_hash from guide_run_action_bindings where workspace_id=${input.workspaceId}::uuid and run_id=${text(source, "run_id")}::uuid and action_unit_id=${text(source, "action_unit_id")}::uuid limit 2`)));
      if (existing) {
        if (existing.action_unit_hash !== text(source, "unit_hash") || existing.proposal_hash !== text(source, "bundle_hash") || existing.entity_ref !== text(source, "entity_ref") || existing.slice_ref !== text(source, "slice_ref") || existing.market_key !== text(source, "market_key") || existing.effective_guide_set_hash !== text(source, "effective_guide_set_hash") || existing.resolution_hash !== text(source, "resolution_hash")) fail("conflict");
        return Object.freeze({ bindingId: text(existing, "id"), replay: true });
      }
      const inserted = one(rows(await tx.execute(sql`insert into guide_run_action_bindings(workspace_id,run_id,guide_revision_id,disposition_artifact_id,action_unit_id,proposal_bundle_id,action_unit_ref,action_unit_hash,proposal_ref,proposal_hash,entity_ref,slice_ref,market_key,effective_guide_set_hash,resolution_hash) values(${input.workspaceId}::uuid,${text(source, "run_id")}::uuid,${text(source, "guide_revision_id")}::uuid,${text(source, "disposition_artifact_id")}::uuid,${text(source, "action_unit_id")}::uuid,${text(source, "proposal_bundle_id")}::uuid,${text(source, "unit_ref")},${text(source, "unit_hash")},${text(source, "bundle_ref")},${text(source, "bundle_hash")},${text(source, "entity_ref")},${text(source, "slice_ref")},${text(source, "market_key")},${text(source, "effective_guide_set_hash")},${text(source, "resolution_hash")}) returning id::text`)));
      if (!inserted) fail("conflict");
      return Object.freeze({ bindingId: text(inserted, "id"), replay: false });
    });
  }
}
