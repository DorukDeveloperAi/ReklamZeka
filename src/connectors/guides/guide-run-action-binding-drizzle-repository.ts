import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
/** The queue append and binding insert must use this exact enclosing transaction. */
export type GuideRunCandidateActionStagingTransaction = Pick<Database, "execute" | "transaction" | "select" | "insert">;
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;

/** Server-composed capability: it stages one canonical queue unit from one
 * persisted candidate. It is deliberately not a lookup by candidate hash. */
export interface GuideRunCandidateActionStagingPort {
  stage(input: Readonly<{ workspaceId: string; guideRevisionId: string; runRef: string; dispositionArtifactRef: string; dispositionOccurredAt: string; candidateRef: string; candidateHash: string; action: string; typedAction: Record<string, unknown>; memberRef: string; membershipHash: string; entityLevel: "campaign" | "adset" | "ad"; sliceRef: string; market: "yerli" | "yabanci" }>, transaction: GuideRunCandidateActionStagingTransaction): Promise<Readonly<{ actionUnitId: string; proposalBundleId: string; actionUnitRef: string; actionUnitHash: string; proposalRef: string; proposalHash: string; entityRef: string; effectiveGuideSetHash: string; resolutionHash: string }>>;
}
export class GuideRunActionBindingRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "corrupt_store" | "conflict") { super(`P06 action binding rejected: ${code}`); }
}
const fail = (code: GuideRunActionBindingRepositoryError["code"]): never => { throw new GuideRunActionBindingRepositoryError(code); };
const rows = (value: unknown): readonly Row[] => { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray((value as { rows?: unknown }).rows)) fail("corrupt_store"); return (value as { rows: readonly Row[] }).rows; };
const one = (value: readonly Row[]): Row | null => { if (value.length > 1) fail("corrupt_store"); return value[0] ?? null; };
const text = (row: Row, key: string): string => { const value = row[key]; if (typeof value !== "string") fail("corrupt_store"); return value as string; };
const uuid = (value: string) => UUID.test(value) ? value : fail("corrupt_store");
const hash = (value: string) => HASH.test(value) ? value : fail("corrupt_store");
const ref = (value: string) => REF.test(value) ? value : fail("corrupt_store");

/** Immutable binding bridge. It does not approve, execute, call Meta, or select
 * an ActionUnit via source_hash. Replays are keyed by disposition artifact. */
export class DrizzleGuideRunActionBindingRepository {
  constructor(private readonly database: Pick<Database, "execute" | "transaction">, private readonly staging?: GuideRunCandidateActionStagingPort) {}
  async bind(input: Readonly<{ workspaceId: string; runRef: string }>): Promise<Readonly<{ bindingId: string; replay: boolean }>> {
    if (!UUID.test(input.workspaceId) || !REF.test(input.runRef)) fail("invalid_input");
    return this.database.transaction(async (tx) => {
      const source = one(rows(await tx.execute(sql`
        select r.id::text run_id,r.guide_revision_id::text guide_revision_id,a.id::text artifact_id,a.artifact_ref,
          a.payload->'disposition'->'candidate'->>'candidateRef' candidate_ref,a.payload->'disposition'->'candidate'->>'candidateHash' candidate_hash,a.payload->'disposition'->'candidate'->>'action' action,
          a.occurred_at::text disposition_occurred_at,a.payload->'disposition'->'candidate'->'stageable'->>'entityRef' member_ref,a.payload->'disposition'->'candidate'->'stageable'->>'membershipHash' membership_hash,a.payload->'disposition'->'candidate'->'stageable'->>'entityLevel' entity_level,a.payload->'disposition'->'candidate'->'stageable'->'typedAction' typed_action,gr.slice_ref,gr.market_key
        from guide_runs r join guide_run_heads h on h.workspace_id=r.workspace_id and h.run_id=r.id and h.state='completed'
        join guide_run_artifacts a on a.workspace_id=r.workspace_id and a.run_id=r.id and a.kind='disposition'
        join guide_revisions gr on gr.workspace_id=r.workspace_id and gr.id=r.guide_revision_id
        join guide_heads gh on gh.workspace_id=r.workspace_id and gh.guide_id=r.guide_id and gh.current_active_revision_id=r.guide_revision_id
        join guides g on g.workspace_id=r.workspace_id and g.id=r.guide_id and g.tombstoned_at is null join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active'
        where r.workspace_id=${input.workspaceId}::uuid and r.run_ref=${input.runRef}
          and exists (select 1 from guide_run_artifacts ss cross join lateral jsonb_array_elements(ss.payload->'members') member
            where ss.workspace_id=r.workspace_id and ss.run_id=r.id and ss.kind='scope_snapshot'
              and member->>'memberRef'=a.payload->'disposition'->'candidate'->'stageable'->>'entityRef'
              and member->>'membershipHash'=a.payload->'disposition'->'candidate'->'stageable'->>'membershipHash')
        order by a.created_at,a.id limit 2 for update of r,h,a,gr,gh,g,w`)));
      if (!source) return fail("not_found");
      const record: Row = source;
      const artifactId = uuid(text(record, "artifact_id"));
      const existing = one(rows(await tx.execute(sql`select id::text from guide_run_action_bindings where workspace_id=${input.workspaceId}::uuid and disposition_artifact_id=${artifactId}::uuid limit 2`)));
      if (existing) return Object.freeze({ bindingId: uuid(text(existing, "id")), replay: true });
      // Entity routing is an explicit persisted fact. Older artifacts lack it
      // and are intentionally unstageable; we never infer it from queue data.
      const memberRef = ref(text(record, "member_ref"));
      const market = text(record, "market_key");
      const staging: GuideRunCandidateActionStagingPort = this.staging ?? fail("not_found");
      const typedAction = record.typed_action; if (!typedAction || typeof typedAction !== "object" || Array.isArray(typedAction)) fail("corrupt_store");
      const dispositionOccurredAt = new Date(text(record, "disposition_occurred_at")).toISOString();
      const entityLevel = text(record, "entity_level");
      const staged = await staging.stage(Object.freeze({ workspaceId: input.workspaceId, guideRevisionId: uuid(text(record, "guide_revision_id")), runRef: input.runRef, dispositionArtifactRef: ref(text(record,"artifact_ref")), dispositionOccurredAt, candidateRef: ref(text(record,"candidate_ref")), candidateHash: hash(text(record,"candidate_hash")), action: text(record,"action"), typedAction: structuredClone(typedAction) as Record<string, unknown>, memberRef, membershipHash: hash(text(record, "membership_hash")), entityLevel: entityLevel === "campaign" ? "campaign" : entityLevel === "adset" ? "adset" : entityLevel === "ad" ? "ad" : fail("corrupt_store"), sliceRef: ref(text(record,"slice_ref")), market: market === "yerli" ? "yerli" : market === "yabanci" ? "yabanci" : fail("corrupt_store") }), tx as GuideRunCandidateActionStagingTransaction);
      const unitId=uuid(staged.actionUnitId), proposalId=uuid(staged.proposalBundleId), unitRef=ref(staged.actionUnitRef), unitHash=hash(staged.actionUnitHash), proposalRef=ref(staged.proposalRef), proposalHash=hash(staged.proposalHash), effectiveGuideSetHash=hash(staged.effectiveGuideSetHash), resolutionHash=hash(staged.resolutionHash);
      const inserted = one(rows(await tx.execute(sql`
        insert into guide_run_action_bindings(workspace_id,run_id,guide_revision_id,disposition_artifact_id,action_unit_id,proposal_bundle_id,action_unit_ref,action_unit_hash,proposal_ref,proposal_hash,entity_ref,member_ref,membership_hash,slice_ref,market_key,effective_guide_set_hash,resolution_hash)
        select ${input.workspaceId}::uuid,${text(record,"run_id")}::uuid,${text(record,"guide_revision_id")}::uuid,${artifactId}::uuid,${unitId}::uuid,${proposalId}::uuid,${unitRef},${unitHash},${proposalRef},${proposalHash},${staged.entityRef},${memberRef},${text(record,"membership_hash")},gr.slice_ref,gr.market_key,
        ${effectiveGuideSetHash},${resolutionHash}
        from guide_runs r join guide_revisions gr on gr.workspace_id=r.workspace_id and gr.id=r.guide_revision_id join guides g on g.workspace_id=r.workspace_id and g.id=r.guide_id join guide_run_artifacts a on a.workspace_id=r.workspace_id and a.id=${artifactId}::uuid
        where r.workspace_id=${input.workspaceId}::uuid and r.id=${text(record,"run_id")}::uuid returning id::text`)));
      if (!inserted) return fail("conflict"); const saved: Row = inserted; return Object.freeze({ bindingId: uuid(text(saved,"id")), replay: false });
    });
  }
}
