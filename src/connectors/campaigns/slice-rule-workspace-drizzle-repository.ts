import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  verifySliceRuleWorkspaceDraft,
  type SliceRuleWorkspaceDraft,
  type SliceRuleWorkspaceDraftPort,
} from "@/application/slice-rule-workspace-service";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type WorkspaceDatabase = Pick<Database, "select" | "insert" | "execute" | "transaction">;

export class SliceRuleWorkspaceRepositoryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "membership_required"
    | "role_denied"
    | "revision_conflict"
    | "idempotency_conflict"
    | "corrupt_store") {
    super("Slice Rule Workspace kalıcılık işlemi güvenli biçimde tamamlanamadı");
    this.name = "SliceRuleWorkspaceRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new SliceRuleWorkspaceRepositoryError("corrupt_store");
  }
  return result.rows as readonly T[];
}

async function assertAccess(database: WorkspaceDatabase, workspaceId: string, actorId: string, write: boolean): Promise<void> {
  if (!UUID.test(workspaceId) || !UUID.test(actorId)) throw new SliceRuleWorkspaceRepositoryError("invalid_input");
  const suffix = write ? sql` for update` : sql``;
  const workspace = rows<{ id: string }>(await database.execute(sql`
    select id from workspaces where id = ${workspaceId}::uuid and lifecycle_state = 'active'
    limit 1${suffix}
  `))[0];
  if (!workspace) throw new SliceRuleWorkspaceRepositoryError("workspace_scope_mismatch");
  const result = await database.execute(sql`
    select role from memberships
    where workspace_id = ${workspaceId}::uuid and user_id = ${actorId}::uuid
    limit 1${suffix}
  `);
  const membership = rows<{ role: "owner" | "admin" | "analyst" | "viewer" }>(result)[0];
  if (!membership) throw new SliceRuleWorkspaceRepositoryError("membership_required");
  if (write && membership.role === "viewer") throw new SliceRuleWorkspaceRepositoryError("role_denied");
}

type DraftRow = typeof schema.sliceRuleWorkspaceDrafts.$inferSelect;

function fromRow(row: DraftRow): SliceRuleWorkspaceDraft {
  const draft = row.draftPayload as unknown as SliceRuleWorkspaceDraft;
  if (!verifySliceRuleWorkspaceDraft(draft)
    || draft.workspaceId !== row.workspaceId || draft.seriesRef !== row.seriesRef || draft.revision !== row.revision
    || draft.previousDraftHash !== row.previousDraftHash || draft.draftRef !== row.draftRef
    || draft.draftHash !== row.draftHash || draft.idempotencyKey !== row.idempotencyKey
    || draft.scope.market !== row.market || draft.scope.serviceRef !== row.serviceRef
    || draft.scope.campaignFamilyRef !== row.campaignFamilyRef
    || (draft.scope.countryOrRegion ?? null) !== row.countryOrRegion
    || (draft.scope.audienceStrategy ?? null) !== row.audienceStrategy
    || (draft.scope.platform ?? null) !== row.platform
    || draft.operatingMode !== row.operatingMode || draft.status !== row.lifecycleState
    || draft.createdAt !== row.draftedAt.toISOString()) {
    throw new SliceRuleWorkspaceRepositoryError("corrupt_store");
  }
  return draft;
}

export function projectSliceRuleWorkspaceDraft(draft: SliceRuleWorkspaceDraft) {
  if (!verifySliceRuleWorkspaceDraft(draft)) throw new SliceRuleWorkspaceRepositoryError("corrupt_store");
  return Object.freeze({ schemaVersion: "public-slice-rule-workspace-draft/1.0.0" as const,
    seriesRef: draft.seriesRef, revision: draft.revision, draftRef: draft.draftRef, draftHash: draft.draftHash,
    status: draft.status, operatingMode: draft.operatingMode, scope: draft.scope, operatingRule: draft.operatingRule,
    createdAt: draft.createdAt, authority: draft.authority });
}

export class DrizzleSliceRuleWorkspaceRepository implements SliceRuleWorkspaceDraftPort {
  constructor(private readonly database: WorkspaceDatabase) {}

  async append(input: Readonly<{ draft: SliceRuleWorkspaceDraft; actorId: string }>) {
    if (!verifySliceRuleWorkspaceDraft(input.draft) || !UUID.test(input.actorId)) {
      throw new SliceRuleWorkspaceRepositoryError("invalid_input");
    }
    const draft = input.draft;
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`slice-rule:${draft.workspaceId}:${draft.seriesRef}`}, 0))`);
      await assertAccess(transaction, draft.workspaceId, input.actorId, true);

      const idempotent = await transaction.select().from(schema.sliceRuleWorkspaceDrafts).where(and(
        eq(schema.sliceRuleWorkspaceDrafts.workspaceId, draft.workspaceId),
        eq(schema.sliceRuleWorkspaceDrafts.idempotencyKey, draft.idempotencyKey),
      )).limit(1);
      if (idempotent[0]) {
        const existing = fromRow(idempotent[0]);
        if (existing.draftHash !== draft.draftHash) throw new SliceRuleWorkspaceRepositoryError("idempotency_conflict");
        return Object.freeze({ outcome: "unchanged" as const, auditAppended: false });
      }

      const history = await transaction.select().from(schema.sliceRuleWorkspaceDrafts).where(and(
        eq(schema.sliceRuleWorkspaceDrafts.workspaceId, draft.workspaceId),
        eq(schema.sliceRuleWorkspaceDrafts.seriesRef, draft.seriesRef),
      )).orderBy(asc(schema.sliceRuleWorkspaceDrafts.revision));
      const previous = history.at(-1);
      if ((!previous && (draft.revision !== 1 || draft.previousDraftHash !== "GENESIS"))
        || (previous && (draft.revision !== previous.revision + 1 || draft.previousDraftHash !== previous.draftHash
          || draft.scope.market !== previous.market || draft.scope.serviceRef !== previous.serviceRef
          || draft.scope.campaignFamilyRef !== previous.campaignFamilyRef
          || (draft.scope.countryOrRegion ?? null) !== previous.countryOrRegion
          || (draft.scope.audienceStrategy ?? null) !== previous.audienceStrategy
          || (draft.scope.platform ?? null) !== previous.platform))) {
        throw new SliceRuleWorkspaceRepositoryError("revision_conflict");
      }

      await transaction.insert(schema.sliceRuleWorkspaceDrafts).values({ workspaceId: draft.workspaceId,
        seriesRef: draft.seriesRef, revision: draft.revision, previousDraftHash: draft.previousDraftHash,
        draftRef: draft.draftRef, draftHash: draft.draftHash, idempotencyKey: draft.idempotencyKey,
        market: draft.scope.market, serviceRef: draft.scope.serviceRef, campaignFamilyRef: draft.scope.campaignFamilyRef,
        countryOrRegion: draft.scope.countryOrRegion ?? null, audienceStrategy: draft.scope.audienceStrategy ?? null,
        platform: draft.scope.platform ?? null, operatingMode: draft.operatingMode, lifecycleState: draft.status,
        createdByActorId: input.actorId, draftPayload: draft as unknown as Record<string, unknown>,
        draftedAt: new Date(draft.createdAt) });

      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${draft.workspaceId}`}, 0))`);
      const previousEventHash = rows<{ event_hash: string }>(await transaction.execute(sql`
        select event_hash from audit_events where workspace_id = ${draft.workspaceId}::uuid
        order by occurred_at desc, created_at desc, id desc limit 1
      `))[0]?.event_hash ?? "GENESIS";
      const event = Object.freeze({ workspaceId: draft.workspaceId, actorId: input.actorId,
        action: "slice_rule.draft_saved", resourceType: "slice_rule_workspace_draft", resourceId: draft.draftRef,
        occurredAt: draft.createdAt,
        metadata: Object.freeze({ seriesRef: draft.seriesRef, revision: draft.revision, market: draft.scope.market,
          serviceRef: draft.scope.serviceRef, campaignFamilyRef: draft.scope.campaignFamilyRef,
          operatingMode: "recommendation_only" as const }),
        id: randomUUID(), previousHash: previousEventHash });
      const eventHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
      await transaction.execute(sql`
        insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
          metadata, previous_hash, event_hash, occurred_at)
        values (${event.id}::uuid, ${event.workspaceId}::uuid, ${event.actorId}::uuid, ${event.action},
          ${event.resourceType}, ${event.resourceId}, ${JSON.stringify(event.metadata)}::jsonb,
          ${event.previousHash}, ${eventHash}, ${event.occurredAt}::timestamptz)
      `);
      return Object.freeze({ outcome: "inserted" as const, auditAppended: true });
    });
  }

  async listCurrent(input: Readonly<{ workspaceId: string; actorId: string; limit?: number }>) {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new SliceRuleWorkspaceRepositoryError("invalid_input");
    await assertAccess(this.database, input.workspaceId, input.actorId, false);
    const latest = await this.database.execute(sql`
      select ranked.draft_payload
      from (
        select draft_payload, drafted_at,
          row_number() over (partition by series_ref order by revision desc) as rank
        from slice_rule_workspace_drafts
        where workspace_id = ${input.workspaceId}::uuid
      ) ranked
      where ranked.rank = 1
      order by ranked.drafted_at desc
      limit ${limit}
    `);
    const drafts = rows<{ draft_payload: unknown }>(latest).map((row) => {
      if (!verifySliceRuleWorkspaceDraft(row.draft_payload)) throw new SliceRuleWorkspaceRepositoryError("corrupt_store");
      return row.draft_payload;
    });
    return Object.freeze(drafts.map(projectSliceRuleWorkspaceDraft));
  }
}
