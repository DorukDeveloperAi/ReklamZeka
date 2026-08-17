import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createGuideRevision, type GuideRevision, type GuideRevisionDraft } from "@/domain/guides/guide-revision";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Row = Readonly<Record<string, unknown>>;
type HumanRole = "owner" | "admin";
type InputRole = HumanRole | "analyst" | "viewer";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const key = (prefix: "guide_event" | "guide_activation", ...parts: string[]) => `${prefix}_${createHash("sha256").update(parts.join(":")).digest("hex")}`;
function rows(value: unknown): readonly Row[] { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) throw new GuideLifecycleRepositoryError("corrupt_store"); return value.rows as readonly Row[]; }
function only(value: readonly Row[]): Row { if (value.length !== 1) throw new GuideLifecycleRepositoryError(value.length ? "corrupt_store" : "not_found"); return value[0]!; }
function id(row: Row, field = "id"): string { const value = row[field]; if (typeof value !== "string" || !UUID.test(value)) throw new GuideLifecycleRepositoryError("corrupt_store"); return value; }
function validUuid(value: string): void { if (!UUID.test(value)) throw new GuideLifecycleRepositoryError("invalid_input"); }
function validDate(value: string): void { if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new GuideLifecycleRepositoryError("invalid_input"); }
function human(role: InputRole): asserts role is HumanRole { if (role !== "owner" && role !== "admin") throw new GuideLifecycleRepositoryError("forbidden"); }
function canonical(value: GuideRevision): GuideRevision {
  const allowed = ["workspaceRef", "guideRef", "revision", "previousRevisionHash", "sliceRef", "market", "freeText", "strict", "schedule", "mode", "actionAllowlist", "schemaVersion", "authority", "interpretationHash", "revisionHash"];
  if (Object.keys(value as object).length !== allowed.length || Object.keys(value as object).some((entry) => !allowed.includes(entry))) throw new GuideLifecycleRepositoryError("invalid_input");
  const draft: GuideRevisionDraft = { workspaceRef: value.workspaceRef, guideRef: value.guideRef, revision: value.revision, previousRevisionHash: value.previousRevisionHash, sliceRef: value.sliceRef, market: value.market, freeText: value.freeText, strict: value.strict, schedule: value.schedule, mode: value.mode, actionAllowlist: value.actionAllowlist };
  const result = createGuideRevision(draft);
  if (result.revisionHash !== value.revisionHash || result.interpretationHash !== value.interpretationHash || JSON.stringify(result.authority) !== JSON.stringify(value.authority) || JSON.stringify(result.strict) !== JSON.stringify(value.strict)) throw new GuideLifecycleRepositoryError("invalid_input");
  return result;
}
export class GuideLifecycleRepositoryError extends Error { constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "corrupt_store") { super(`guide lifecycle rejected: ${code}`); this.name = "GuideLifecycleRepositoryError"; } }

/** Server-private persistence: it is deliberately not an Agent or Meta-write entrypoint. */
export class DrizzleGuideLifecycleRepository {
  constructor(private readonly database: Pick<Database, "transaction">) {}

  async createDraft(input: Readonly<{ workspaceId: string; actorId: string; role: InputRole; label: string; guide: GuideRevision; sliceId: string; sliceRevisionId: string; marketDefinitionId: string; occurredAt: string }>) {
    [input.workspaceId, input.actorId, input.sliceId, input.sliceRevisionId, input.marketDefinitionId].forEach(validUuid); validDate(input.occurredAt); human(input.role);
    const role = input.role; human(role); const guide = canonical(input.guide); if (guide.revision !== 1 || guide.previousRevisionHash !== null || !input.label.trim() || input.label.trim().length > 160) throw new GuideLifecycleRepositoryError("invalid_input");
    return this.database.transaction(async (tx) => {
      await this.assertHuman(tx, input.workspaceId, input.actorId, role);
      const guideId = id(only(rows(await tx.execute(sql`insert into guides (workspace_id, guide_ref, label, slice_id, market_definition_id, created_by_actor_id) values (${input.workspaceId}::uuid, ${guide.guideRef}, ${input.label.trim()}, ${input.sliceId}::uuid, ${input.marketDefinitionId}::uuid, ${input.actorId}::uuid) returning id::text`))));
      const revisionId = await this.insertRevision(tx, { ...input, guide, guideId, sourceRevisionId: null });
      await tx.execute(sql`insert into guide_heads (workspace_id, guide_id, latest_revision_id, current_active_revision_id, version, updated_at) values (${input.workspaceId}::uuid, ${guideId}::uuid, ${revisionId}::uuid, null, 0, ${input.occurredAt}::timestamptz)`);
      await this.event(tx, input.workspaceId, guideId, revisionId, "draft_created", input.actorId, input.occurredAt, { revisionHash: guide.revisionHash });
      return Object.freeze({ guideId, revisionId, revisionHash: guide.revisionHash, headVersion: 0 });
    });
  }

  async createNextDraft(input: Readonly<{ workspaceId: string; actorId: string; role: InputRole; guideId: string; expectedHeadVersion: number; expectedLatestRevisionId: string; expectedLatestRevisionHash: string; guide: GuideRevision; sliceRevisionId: string; marketDefinitionId: string; occurredAt: string }>) {
    [input.workspaceId, input.actorId, input.guideId, input.expectedLatestRevisionId, input.sliceRevisionId, input.marketDefinitionId].forEach(validUuid); validDate(input.occurredAt); human(input.role);
    const role = input.role; human(role); if (!Number.isInteger(input.expectedHeadVersion) || input.expectedHeadVersion < 0 || !HASH.test(input.expectedLatestRevisionHash)) throw new GuideLifecycleRepositoryError("invalid_input"); const guide = canonical(input.guide);
    return this.database.transaction(async (tx) => {
      await this.assertHuman(tx, input.workspaceId, input.actorId, role);
      const head = only(rows(await tx.execute(sql`select latest_revision_id::text,current_active_revision_id::text,version from guide_heads where workspace_id=${input.workspaceId}::uuid and guide_id=${input.guideId}::uuid for update`)));
      if (Number(head.version) !== input.expectedHeadVersion || head.latest_revision_id !== input.expectedLatestRevisionId) throw new GuideLifecycleRepositoryError("conflict");
      const previous = only(rows(await tx.execute(sql`select revision_number,revision_hash,guide_ref from guide_revisions where workspace_id=${input.workspaceId}::uuid and id=${input.expectedLatestRevisionId}::uuid and guide_id=${input.guideId}::uuid for update`)));
      if (previous.revision_hash !== input.expectedLatestRevisionHash || previous.guide_ref !== guide.guideRef || guide.revision !== Number(previous.revision_number) + 1 || guide.previousRevisionHash !== previous.revision_hash) throw new GuideLifecycleRepositoryError("conflict");
      const revisionId = await this.insertRevision(tx, { ...input, guide, guideId: input.guideId, sourceRevisionId: input.expectedLatestRevisionId });
      const updated = rows(await tx.execute(sql`update guide_heads set latest_revision_id=${revisionId}::uuid,version=version+1,updated_at=${input.occurredAt}::timestamptz where workspace_id=${input.workspaceId}::uuid and guide_id=${input.guideId}::uuid and version=${input.expectedHeadVersion} and latest_revision_id=${input.expectedLatestRevisionId}::uuid returning version,current_active_revision_id::text`));
      if (updated.length !== 1 || updated[0]!.current_active_revision_id !== (head.current_active_revision_id ?? null)) throw new GuideLifecycleRepositoryError("conflict");
      await this.event(tx, input.workspaceId, input.guideId, revisionId, "draft_created", input.actorId, input.occurredAt, { revisionHash: guide.revisionHash, sourceRevisionId: input.expectedLatestRevisionId });
      return Object.freeze({ revisionId, revisionHash: guide.revisionHash, headVersion: Number(updated[0]!.version), oldActiveRevisionId: head.current_active_revision_id ?? null });
    });
  }

  async acceptInterpretation(input: Readonly<{ workspaceId: string; actorId: string; role: InputRole; guideId: string; revisionId: string; interpretationHash: string; occurredAt: string }>) {
    [input.workspaceId, input.actorId, input.guideId, input.revisionId].forEach(validUuid); validDate(input.occurredAt); if (!HASH.test(input.interpretationHash)) throw new GuideLifecycleRepositoryError("invalid_input"); const role = input.role; human(role);
    return this.database.transaction(async (tx) => {
      await this.assertHuman(tx, input.workspaceId, input.actorId, role);
      const revision = only(rows(await tx.execute(sql`select interpretation_hash from guide_revisions where workspace_id=${input.workspaceId}::uuid and id=${input.revisionId}::uuid and guide_id=${input.guideId}::uuid for update`)));
      if (revision.interpretation_hash !== input.interpretationHash) throw new GuideLifecycleRepositoryError("conflict");
      const inserted = rows(await tx.execute(sql`insert into guide_interpretation_acceptances (workspace_id,guide_revision_id,interpretation_hash,accepted_by_actor_id,accepted_at) values (${input.workspaceId}::uuid,${input.revisionId}::uuid,${input.interpretationHash},${input.actorId}::uuid,${input.occurredAt}::timestamptz) on conflict (workspace_id,guide_revision_id,interpretation_hash) do nothing returning id`));
      if (inserted.length === 1) await this.event(tx, input.workspaceId, input.guideId, input.revisionId, "interpretation_accepted", input.actorId, input.occurredAt, { interpretationHash: input.interpretationHash });
      return Object.freeze({ accepted: true as const, created: inserted.length === 1 });
    });
  }

  async activate(input: Readonly<{ workspaceId: string; actorId: string; role: InputRole; guideId: string; revisionId: string; expectedHeadVersion: number; expectedCurrentRevisionId: string | null; occurredAt: string }>) {
    [input.workspaceId, input.actorId, input.guideId, input.revisionId].forEach(validUuid); validDate(input.occurredAt); const role = input.role; human(role);
    if (!Number.isInteger(input.expectedHeadVersion) || input.expectedHeadVersion < 0 || (input.expectedCurrentRevisionId !== null && !UUID.test(input.expectedCurrentRevisionId))) throw new GuideLifecycleRepositoryError("invalid_input");
    return this.database.transaction(async (tx) => {
      await this.assertHuman(tx, input.workspaceId, input.actorId, role);
      const head = only(rows(await tx.execute(sql`select latest_revision_id::text,current_active_revision_id::text,version from guide_heads where workspace_id=${input.workspaceId}::uuid and guide_id=${input.guideId}::uuid for update`)));
      if (head.latest_revision_id !== input.revisionId || Number(head.version) !== input.expectedHeadVersion || (head.current_active_revision_id ?? null) !== input.expectedCurrentRevisionId) {
        if (head.latest_revision_id === input.revisionId && head.current_active_revision_id === input.revisionId) return Object.freeze({ activated: true as const, idempotent: true as const, activationKey: await this.existingActivationKey(tx, input.workspaceId, input.revisionId) });
        throw new GuideLifecycleRepositoryError("conflict");
      }
      const revision = only(rows(await tx.execute(sql`select revision_hash,interpretation_hash from guide_revisions where workspace_id=${input.workspaceId}::uuid and id=${input.revisionId}::uuid and guide_id=${input.guideId}::uuid for update`)));
      if (typeof revision.revision_hash !== "string" || !HASH.test(revision.revision_hash)) throw new GuideLifecycleRepositoryError("corrupt_store");
      if (typeof revision.interpretation_hash !== "string" || !HASH.test(revision.interpretation_hash) || rows(await tx.execute(sql`select id from guide_interpretation_acceptances where workspace_id=${input.workspaceId}::uuid and guide_revision_id=${input.revisionId}::uuid and interpretation_hash=${revision.interpretation_hash} limit 2`)).length !== 1) throw new GuideLifecycleRepositoryError("conflict");
      const advanced = rows(await tx.execute(sql`update guide_heads set current_active_revision_id=${input.revisionId}::uuid,version=version+1,updated_at=${input.occurredAt}::timestamptz where workspace_id=${input.workspaceId}::uuid and guide_id=${input.guideId}::uuid and version=${input.expectedHeadVersion} and latest_revision_id=${input.revisionId}::uuid returning version`));
      if (advanced.length !== 1) throw new GuideLifecycleRepositoryError("conflict"); const activationKey = key("guide_activation", input.workspaceId, input.guideId, revision.revision_hash, String(input.expectedHeadVersion));
      await tx.execute(sql`insert into guide_activation_outbox (workspace_id,guide_id,guide_revision_id,activation_key,created_at) values (${input.workspaceId}::uuid,${input.guideId}::uuid,${input.revisionId}::uuid,${activationKey},${input.occurredAt}::timestamptz) on conflict (workspace_id,activation_key) do nothing`);
      if (input.expectedCurrentRevisionId !== null) await this.event(tx, input.workspaceId, input.guideId, input.expectedCurrentRevisionId, "superseded", input.actorId, input.occurredAt, { replacementRevisionId: input.revisionId, activationKey });
      await this.event(tx, input.workspaceId, input.guideId, input.revisionId, "activated", input.actorId, input.occurredAt, { activationKey, previousRevisionId: input.expectedCurrentRevisionId });
      return Object.freeze({ activated: true as const, idempotent: false as const, activationKey, headVersion: Number(advanced[0]!.version) });
    });
  }

  async pause(input: Readonly<{ workspaceId: string; actorId: string; role: InputRole; guideId: string; expectedHeadVersion: number; expectedCurrentRevisionId: string; occurredAt: string }>) {
    [input.workspaceId, input.actorId, input.guideId, input.expectedCurrentRevisionId].forEach(validUuid); validDate(input.occurredAt); const role = input.role; human(role); if (!Number.isInteger(input.expectedHeadVersion) || input.expectedHeadVersion < 0) throw new GuideLifecycleRepositoryError("invalid_input");
    return this.database.transaction(async (tx) => { await this.assertHuman(tx, input.workspaceId, input.actorId, role);
      const updated = rows(await tx.execute(sql`update guide_heads set current_active_revision_id=null,version=version+1,updated_at=${input.occurredAt}::timestamptz where workspace_id=${input.workspaceId}::uuid and guide_id=${input.guideId}::uuid and version=${input.expectedHeadVersion} and current_active_revision_id=${input.expectedCurrentRevisionId}::uuid returning latest_revision_id::text,version`));
      if (updated.length !== 1) throw new GuideLifecycleRepositoryError("conflict"); await this.event(tx, input.workspaceId, input.guideId, input.expectedCurrentRevisionId, "paused", input.actorId, input.occurredAt, { latestRevisionId: updated[0]!.latest_revision_id }); return Object.freeze({ paused: true as const, headVersion: Number(updated[0]!.version) });
    });
  }

  async archive(input: Readonly<{ workspaceId: string; actorId: string; role: InputRole; guideId: string; expectedHeadVersion: number; occurredAt: string }>) {
    [input.workspaceId, input.actorId, input.guideId].forEach(validUuid); validDate(input.occurredAt); const role = input.role; human(role); if (!Number.isInteger(input.expectedHeadVersion) || input.expectedHeadVersion < 0) throw new GuideLifecycleRepositoryError("invalid_input");
    return this.database.transaction(async (tx) => { await this.assertHuman(tx, input.workspaceId, input.actorId, role);
      const head = only(rows(await tx.execute(sql`select latest_revision_id::text,current_active_revision_id::text,version from guide_heads where workspace_id=${input.workspaceId}::uuid and guide_id=${input.guideId}::uuid for update`)));
      if (Number(head.version) !== input.expectedHeadVersion || head.current_active_revision_id !== null || typeof head.latest_revision_id !== "string") throw new GuideLifecycleRepositoryError("conflict");
      if (rows(await tx.execute(sql`update guides set tombstoned_at=${input.occurredAt}::timestamptz where workspace_id=${input.workspaceId}::uuid and id=${input.guideId}::uuid and tombstoned_at is null returning id`)).length !== 1) throw new GuideLifecycleRepositoryError("conflict");
      await this.event(tx, input.workspaceId, input.guideId, head.latest_revision_id, "archived", input.actorId, input.occurredAt, {}); return Object.freeze({ archived: true as const });
    });
  }

  private async assertHuman(tx: Transaction, workspaceId: string, actorId: string, role: HumanRole) { const member = only(rows(await tx.execute(sql`select role::text from memberships where workspace_id=${workspaceId}::uuid and user_id=${actorId}::uuid for update`))); if (member.role !== role) throw new GuideLifecycleRepositoryError("forbidden"); }
  private async existingActivationKey(tx: Transaction, workspaceId: string, revisionId: string) { const row = only(rows(await tx.execute(sql`select activation_key from guide_activation_outbox where workspace_id=${workspaceId}::uuid and guide_revision_id=${revisionId}::uuid`))); if (typeof row.activation_key !== "string") throw new GuideLifecycleRepositoryError("corrupt_store"); return row.activation_key; }
  private async event(tx: Transaction, workspaceId: string, guideId: string, revisionId: string, eventType: "draft_created" | "interpretation_accepted" | "activated" | "superseded" | "paused" | "archived", actorId: string, occurredAt: string, payload: Record<string, unknown>) { const discriminator = eventType === "draft_created" ? String(payload.revisionHash) : eventType === "interpretation_accepted" ? String(payload.interpretationHash) : eventType === "activated" || eventType === "superseded" ? String(payload.activationKey) : eventType; const eventKey = key("guide_event", workspaceId, guideId, revisionId, eventType, discriminator); await tx.execute(sql`insert into guide_lifecycle_events (workspace_id,guide_id,guide_revision_id,event_key,event_type,actor_id,occurred_at,payload) values (${workspaceId}::uuid,${guideId}::uuid,${revisionId}::uuid,${eventKey},${eventType},${actorId}::uuid,${occurredAt}::timestamptz,${JSON.stringify(payload)}::jsonb) on conflict (workspace_id,event_key) do nothing`); }
  private async insertRevision(tx: Transaction, input: Readonly<{ workspaceId: string; actorId: string; guideId: string; guide: GuideRevision; sliceRevisionId: string; marketDefinitionId: string; sourceRevisionId: string | null }>) { const revisionId = id(only(rows(await tx.execute(sql`insert into guide_revisions (workspace_id,guide_id,guide_ref,revision_number,revision_hash,source_revision_id,slice_revision_id,slice_ref,market_definition_id,free_text,strict_payload,schedule_payload,mode,interpretation_hash,created_by_actor_id) values (${input.workspaceId}::uuid,${input.guideId}::uuid,${input.guide.guideRef},${input.guide.revision},${input.guide.revisionHash},${input.sourceRevisionId}::uuid,${input.sliceRevisionId}::uuid,${input.guide.sliceRef},${input.marketDefinitionId}::uuid,${input.guide.freeText},${JSON.stringify(input.guide.strict)}::jsonb,${JSON.stringify(input.guide.schedule)}::jsonb,${input.guide.mode},${input.guide.interpretationHash},${input.actorId}::uuid) returning id::text`))));
    for (const action of input.guide.actionAllowlist) { const authority = input.guide.authority.autonomousActions.includes(action) ? "limited_autonomy" : input.guide.authority.humanApprovalActions.includes(action) ? "human_approval" : "none"; await tx.execute(sql`insert into guide_revision_actions (workspace_id,guide_revision_id,action,authority) values (${input.workspaceId}::uuid,${revisionId}::uuid,${action},${authority})`); }
    for (const [ordinal, budget] of input.guide.strict.budgetRefs.entries()) await tx.execute(sql`insert into guide_revision_budget_refs (workspace_id,guide_revision_id,budget_ref,scope_kind,ordinal) values (${input.workspaceId}::uuid,${revisionId}::uuid,${budget.limitRef},${budget.scopeKind},${ordinal + 1})`); return revisionId;
  }
}
