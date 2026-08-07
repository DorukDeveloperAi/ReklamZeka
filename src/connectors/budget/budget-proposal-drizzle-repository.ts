import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  buildEffectiveCampaignContext,
  type EffectiveCampaignContext,
  type EffectiveCampaignContextInput,
} from "@/analyses/effective-campaign-context";
import type {
  BudgetFrozenContextPort,
  BudgetProposal,
  BudgetProposalPort,
  BudgetProposalScope,
  FrozenBudgetContext,
} from "@/application/budget-proposal-service";
import { hashBudgetProposal, verifyBudgetProposal } from "@/application/budget-proposal-service";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type BudgetDatabase = Pick<Database, "select" | "insert" | "execute" | "transaction">;

export class BudgetProposalRepositoryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "context_scope_mismatch"
    | "revision_conflict"
    | "idempotency_conflict"
    | "not_found"
    | "corrupt_store") {
    super("Bütçe önerisi kalıcılık işlemi güvenli biçimde tamamlanamadı");
    this.name = "BudgetProposalRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;

function resultRows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new BudgetProposalRepositoryError("corrupt_store");
  }
  return result.rows as readonly T[];
}

function assertScope(scope: BudgetProposalScope): void {
  if (!scope || !UUID.test(scope.workspaceId) || !UUID.test(scope.adAccountId)
    || !UUID.test(scope.campaignId) || !HASH.test(scope.contextHash)) {
    throw new BudgetProposalRepositoryError("invalid_input");
  }
}

async function assertWorkspace(database: BudgetDatabase, workspaceId: string, lock: boolean): Promise<void> {
  const suffix = lock ? sql` for update` : sql``;
  const rows = resultRows(await database.execute(sql`
    select id from workspaces
    where id = ${workspaceId}::uuid and lifecycle_state = 'active'
    limit 1${suffix}
  `));
  if (rows.length !== 1) throw new BudgetProposalRepositoryError("workspace_scope_mismatch");
}

function contextInput(context: EffectiveCampaignContext): EffectiveCampaignContextInput {
  const { schemaVersion: _schemaVersion, contextHash: _contextHash, capabilities: _capabilities, ...input } = context;
  return input;
}

function restoreContext(row: typeof schema.effectiveCampaignContexts.$inferSelect): EffectiveCampaignContext {
  const payload = row.contextPayload as unknown as EffectiveCampaignContext;
  let rebuilt: EffectiveCampaignContext;
  try {
    rebuilt = buildEffectiveCampaignContext(contextInput(payload));
  } catch {
    throw new BudgetProposalRepositoryError("corrupt_store");
  }
  if (rebuilt.contextHash !== row.contextHash || rebuilt.contextHash !== payload.contextHash
    || rebuilt.workspaceId !== row.workspaceId || rebuilt.identity.accountRef !== row.accountRef
    || rebuilt.identity.campaignRef !== row.campaignRef || rebuilt.identity.entityType !== "campaign"
    || rebuilt.identity.entityRef !== rebuilt.identity.campaignRef
    || rebuilt.capabilities.canAuthorizeAction !== false || rebuilt.capabilities.canExecuteWrite !== false) {
    throw new BudgetProposalRepositoryError("corrupt_store");
  }
  return rebuilt;
}

async function invalidated(database: BudgetDatabase, row: typeof schema.effectiveCampaignContexts.$inferSelect): Promise<boolean> {
  const result = await database.execute(sql`
    select exists (
      select 1 from effective_campaign_context_components component
      join effective_campaign_context_invalidations invalidation
        on invalidation.workspace_id = component.workspace_id
       and invalidation.component_type = component.component_type
       and invalidation.component_ref = component.component_ref
       and invalidation.component_version = component.component_version
      where component.workspace_id = ${row.workspaceId}::uuid
        and component.context_id = ${row.id}::uuid
        and (invalidation.entity_type is null
          or (invalidation.entity_type = 'campaign' and invalidation.entity_ref = ${row.campaignRef}))
    ) as value
  `);
  return resultRows<{ value: boolean }>(result)[0]?.value === true;
}

type ProposalRow = typeof schema.budgetProposalVersions.$inferSelect;

function proposalFromRow(row: ProposalRow): BudgetProposal {
  const proposal = row.proposalPayload as unknown as BudgetProposal;
  if (!verifyBudgetProposal(proposal)
    || proposal.scope.workspaceId !== row.workspaceId || proposal.scope.adAccountId !== row.adAccountId
    || proposal.scope.campaignId !== row.campaignId || proposal.scope.contextHash !== row.contextHash
    || proposal.seriesRef !== row.seriesRef || proposal.revision !== row.revision
    || proposal.previousProposalHash !== row.previousProposalHash || proposal.proposalRef !== row.proposalRef
    || proposal.proposalHash !== row.proposalHash || proposal.idempotencyKey !== row.idempotencyKey
    || proposal.schemaVersion !== row.schemaVersion || proposal.createdAt !== row.proposedAt.toISOString()) {
    throw new BudgetProposalRepositoryError("corrupt_store");
  }
  return proposal;
}

function publicRef(namespace: string, value: string): string {
  return `${namespace}_${createHash("sha256").update(`${namespace}\0${value}`).digest("hex").slice(0, 16)}`;
}

export type PublicBudgetProposal = ReturnType<typeof projectBudgetProposal>;

/** UI/agent-safe projection: financial evidence remains visible while internal and Meta refs become opaque. */
export function projectBudgetProposal(proposal: BudgetProposal) {
  if (!verifyBudgetProposal(proposal)) throw new BudgetProposalRepositoryError("corrupt_store");
  return Object.freeze({
    schemaVersion: "public-budget-proposal/1.0.0" as const,
    proposalRef: proposal.proposalRef,
    seriesRef: proposal.seriesRef,
    revision: proposal.revision,
    createdAt: proposal.createdAt,
    scope: Object.freeze({
      workspaceRef: publicRef("workspace", proposal.scope.workspaceId),
      accountRef: publicRef("account", proposal.scope.adAccountId),
      campaignRef: publicRef("campaign", proposal.scope.campaignId),
      contextRef: publicRef("context", proposal.scope.contextHash),
    }),
    mapping: proposal.mappingPlan === null ? null : Object.freeze({
      status: proposal.mappingPlan.status,
      suppressionReasons: proposal.mappingPlan.suppressionReasons,
      target: proposal.mappingPlan.target,
      selected: proposal.mappingPlan.selected === null ? null : Object.freeze({
        mappingRef: publicRef("mapping", proposal.mappingPlan.selected.mappingRef),
        metricRef: proposal.mappingPlan.selected.proxy.metricRef,
        entityLevel: proposal.mappingPlan.selected.proxy.entityLevel,
        attributionWindowRef: proposal.mappingPlan.selected.proxy.attributionWindowRef,
      }),
    }),
    alternatives: Object.freeze(proposal.alternatives.map((alternative) => {
      if (alternative.status === "suppressed") return Object.freeze({ ...alternative });
      return Object.freeze({
        scenarioRef: alternative.scenarioRef,
        kind: alternative.kind,
        status: alternative.status,
        result: Object.freeze({
          status: alternative.result.status,
          reason: alternative.result.reason,
          currency: alternative.result.pacing.amounts.currency,
          before: Object.freeze({
            ...alternative.result.before,
            allocations: alternative.result.before.allocations.map((item) => ({
              ...item, ref: publicRef("allocation", item.ref),
            })),
          }),
          after: Object.freeze({
            ...alternative.result.after,
            allocations: alternative.result.after.allocations.map((item) => ({
              ...item, ref: publicRef("allocation", item.ref),
            })),
          }),
          traceSummary: Object.freeze({
            constraintStatus: alternative.result.constraint.status,
            constraintReason: alternative.result.constraint.reason,
            pacingStatus: alternative.result.pacing.adjustment.status,
            pacingSuppressionReasons: Object.freeze([...alternative.result.pacing.adjustment.suppressionReasons]),
            stepCount: alternative.result.constraint.trace.length + alternative.result.pacing.trace.length,
            stages: Object.freeze([...new Set(alternative.result.constraint.trace.map((step) => step.stage))]),
          }),
          actionAuthority: "none" as const,
        }),
        mappingSuppressionReasons: alternative.mappingSuppressionReasons,
        actionAuthority: "none" as const,
      });
    })),
    actionAuthority: "none" as const,
    capabilities: proposal.capabilities,
    writeOperations: 0 as const,
  });
}

export class DrizzleBudgetProposalRepository implements BudgetFrozenContextPort, BudgetProposalPort {
  constructor(private readonly database: BudgetDatabase) {}

  async loadExact(scope: BudgetProposalScope): Promise<FrozenBudgetContext> {
    assertScope(scope);
    await assertWorkspace(this.database, scope.workspaceId, false);
    const rows = await this.database.select().from(schema.effectiveCampaignContexts).where(and(
      eq(schema.effectiveCampaignContexts.workspaceId, scope.workspaceId),
      eq(schema.effectiveCampaignContexts.adAccountId, scope.adAccountId),
      eq(schema.effectiveCampaignContexts.campaignId, scope.campaignId),
      eq(schema.effectiveCampaignContexts.contextHash, scope.contextHash),
      eq(schema.effectiveCampaignContexts.entityType, "campaign"),
    )).limit(2);
    if (rows.length !== 1) throw new BudgetProposalRepositoryError("context_scope_mismatch");
    return Object.freeze({
      scope: Object.freeze({ ...scope }),
      context: restoreContext(rows[0]!),
      invalidated: await invalidated(this.database, rows[0]!),
    });
  }

  async append(proposal: BudgetProposal): Promise<Readonly<{ outcome: "inserted" | "unchanged" }>> {
    if (!verifyBudgetProposal(proposal)) throw new BudgetProposalRepositoryError("invalid_input");
    assertScope(proposal.scope);
    return this.database.transaction(async (transaction) => {
      await assertWorkspace(transaction, proposal.scope.workspaceId, true);
      const frozen = await new DrizzleBudgetProposalRepository(transaction).loadExact(proposal.scope);
      if (frozen.invalidated || frozen.context.identity.accountRef !== proposal.frozenContext.accountRef
        || frozen.context.identity.campaignRef !== proposal.frozenContext.campaignRef
        || frozen.context.capturedAt !== proposal.frozenContext.capturedAt) {
        throw new BudgetProposalRepositoryError("context_scope_mismatch");
      }

      const idempotent = await transaction.select().from(schema.budgetProposalVersions).where(and(
        eq(schema.budgetProposalVersions.workspaceId, proposal.scope.workspaceId),
        eq(schema.budgetProposalVersions.idempotencyKey, proposal.idempotencyKey),
      )).limit(1);
      if (idempotent[0]) {
        const existing = proposalFromRow(idempotent[0]);
        if (existing.proposalHash !== proposal.proposalHash) {
          throw new BudgetProposalRepositoryError("idempotency_conflict");
        }
        await this.assertAlternatives(transaction, idempotent[0], existing);
        return Object.freeze({ outcome: "unchanged" as const });
      }

      const history = await transaction.select().from(schema.budgetProposalVersions).where(and(
        eq(schema.budgetProposalVersions.workspaceId, proposal.scope.workspaceId),
        eq(schema.budgetProposalVersions.seriesRef, proposal.seriesRef),
      )).orderBy(asc(schema.budgetProposalVersions.revision));
      const previous = history.at(-1);
      if ((!previous && (proposal.revision !== 1 || proposal.previousProposalHash !== "GENESIS"))
        || (previous && (proposal.revision !== previous.revision + 1
          || proposal.previousProposalHash !== previous.proposalHash
          || proposal.scope.adAccountId !== previous.adAccountId
          || proposal.scope.campaignId !== previous.campaignId))) {
        throw new BudgetProposalRepositoryError("revision_conflict");
      }

      const contextRows = await transaction.select({ id: schema.effectiveCampaignContexts.id })
        .from(schema.effectiveCampaignContexts).where(and(
          eq(schema.effectiveCampaignContexts.workspaceId, proposal.scope.workspaceId),
          eq(schema.effectiveCampaignContexts.adAccountId, proposal.scope.adAccountId),
          eq(schema.effectiveCampaignContexts.campaignId, proposal.scope.campaignId),
          eq(schema.effectiveCampaignContexts.contextHash, proposal.scope.contextHash),
        )).limit(1);
      if (!contextRows[0]) throw new BudgetProposalRepositoryError("context_scope_mismatch");
      const inserted = await transaction.insert(schema.budgetProposalVersions).values({
        workspaceId: proposal.scope.workspaceId,
        adAccountId: proposal.scope.adAccountId,
        campaignId: proposal.scope.campaignId,
        contextId: contextRows[0].id,
        contextHash: proposal.scope.contextHash,
        seriesRef: proposal.seriesRef,
        revision: proposal.revision,
        previousProposalHash: proposal.previousProposalHash,
        proposalRef: proposal.proposalRef,
        proposalHash: proposal.proposalHash,
        idempotencyKey: proposal.idempotencyKey,
        schemaVersion: proposal.schemaVersion,
        proposedAt: new Date(proposal.createdAt),
        proposalPayload: proposal as unknown as Record<string, unknown>,
      }).returning();
      if (!inserted[0]) throw new BudgetProposalRepositoryError("revision_conflict");
      await transaction.insert(schema.budgetProposalAlternatives).values(proposal.alternatives.map((alternative, index) => ({
        workspaceId: proposal.scope.workspaceId,
        proposalId: inserted[0]!.id,
        proposalHash: proposal.proposalHash,
        ordinal: index + 1,
        scenarioRef: alternative.scenarioRef,
        scenarioKind: alternative.kind,
        scenarioStatus: alternative.status,
        alternativePayload: alternative as unknown as Record<string, unknown>,
      })));
      await this.assertAlternatives(transaction, inserted[0], proposal);
      return Object.freeze({ outcome: "inserted" as const });
    });
  }

  async appendDraft(input: Readonly<{ proposal: BudgetProposal; actorId: string; occurredAt: string }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    auditAppended: boolean;
  }>> {
    if (!verifyBudgetProposal(input.proposal) || !UUID.test(input.actorId)
      || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.occurredAt) || !Number.isFinite(Date.parse(input.occurredAt))) {
      throw new BudgetProposalRepositoryError("invalid_input");
    }
    return this.database.transaction(async (transaction) => {
      const persisted = await new DrizzleBudgetProposalRepository(transaction).append(input.proposal);
      if (persisted.outcome === "unchanged") return Object.freeze({ outcome: "unchanged" as const, auditAppended: false });
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.proposal.scope.workspaceId}`}, 0))`);
      const previousHash = resultRows<{ event_hash: string }>(await transaction.execute(sql`
        select event_hash from audit_events
        where workspace_id = ${input.proposal.scope.workspaceId}::uuid
        order by occurred_at desc, created_at desc, id desc limit 1
      `))[0]?.event_hash ?? "GENESIS";
      // Preserve the existing audit envelope field order so the JSON/SHA-256
      // chain can be verified by the same deterministic reconstruction.
      const event = Object.freeze({
        workspaceId: input.proposal.scope.workspaceId, actorId: input.actorId,
        action: "budget.draft_saved", resourceType: "budget_proposal", resourceId: input.proposal.proposalRef,
        occurredAt: new Date(input.occurredAt).toISOString(),
        metadata: Object.freeze({ seriesRef: input.proposal.seriesRef, revision: input.proposal.revision, mode: "draft" }),
        id: randomUUID(), previousHash,
      });
      const eventHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
      await transaction.execute(sql`
        insert into audit_events (
          id, workspace_id, actor_id, action, resource_type, resource_id,
          metadata, previous_hash, event_hash, occurred_at
        ) values (
          ${event.id}::uuid, ${event.workspaceId}::uuid, ${event.actorId}::uuid,
          ${event.action}, ${event.resourceType}, ${event.resourceId},
          ${JSON.stringify(event.metadata)}::jsonb, ${event.previousHash}, ${eventHash}, ${event.occurredAt}::timestamptz
        )
      `);
      return Object.freeze({ outcome: "inserted" as const, auditAppended: true });
    });
  }

  private async assertAlternatives(database: BudgetDatabase, row: ProposalRow, proposal: BudgetProposal): Promise<void> {
    const rows = await database.select().from(schema.budgetProposalAlternatives).where(and(
      eq(schema.budgetProposalAlternatives.workspaceId, row.workspaceId),
      eq(schema.budgetProposalAlternatives.proposalId, row.id),
    )).orderBy(asc(schema.budgetProposalAlternatives.ordinal));
    if (rows.length !== proposal.alternatives.length || rows.some((entry, index) => {
      const expected = proposal.alternatives[index];
      return !expected || entry.ordinal !== index + 1 || entry.proposalHash !== proposal.proposalHash
        || entry.scenarioRef !== expected.scenarioRef || entry.scenarioKind !== expected.kind
        || entry.scenarioStatus !== expected.status
        || hashBudgetProposal(entry.alternativePayload) !== hashBudgetProposal(expected);
    })) throw new BudgetProposalRepositoryError("corrupt_store");
  }

  async loadPublic(input: Readonly<{ workspaceId: string; seriesRef: string; revision?: number }>): Promise<PublicBudgetProposal> {
    if (!UUID.test(input.workspaceId) || !REF.test(input.seriesRef)
      || input.revision !== undefined && (!Number.isInteger(input.revision) || input.revision < 1)) {
      throw new BudgetProposalRepositoryError("invalid_input");
    }
    await assertWorkspace(this.database, input.workspaceId, false);
    const rows = await this.database.select().from(schema.budgetProposalVersions).where(and(
      eq(schema.budgetProposalVersions.workspaceId, input.workspaceId),
      eq(schema.budgetProposalVersions.seriesRef, input.seriesRef),
      ...(input.revision === undefined ? [] : [eq(schema.budgetProposalVersions.revision, input.revision)]),
    )).orderBy(asc(schema.budgetProposalVersions.revision));
    const row = rows.at(-1);
    if (!row) throw new BudgetProposalRepositoryError("not_found");
    const proposal = proposalFromRow(row);
    await this.assertAlternatives(this.database, row, proposal);
    return projectBudgetProposal(proposal);
  }

  async listPublic(input: Readonly<{
    workspaceId: string;
    before: Readonly<{ createdAt: string; proposalRef: string }> | null;
    limit: number;
  }>): Promise<readonly PublicBudgetProposal[]> {
    if (!UUID.test(input.workspaceId) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 101
      || input.before !== null && (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.before.createdAt)
        || !Number.isFinite(Date.parse(input.before.createdAt))
        || !/^budget_proposal_[a-f0-9]{20}$/.test(input.before.proposalRef))) {
      throw new BudgetProposalRepositoryError("invalid_input");
    }
    await assertWorkspace(this.database, input.workspaceId, false);
    const boundary = input.before === null ? undefined : or(
      lt(schema.budgetProposalVersions.proposedAt, new Date(input.before.createdAt)),
      and(
        eq(schema.budgetProposalVersions.proposedAt, new Date(input.before.createdAt)),
        lt(schema.budgetProposalVersions.proposalRef, input.before.proposalRef),
      ),
    );
    const rows = await this.database.select().from(schema.budgetProposalVersions).where(and(
      eq(schema.budgetProposalVersions.workspaceId, input.workspaceId),
      ...(boundary ? [boundary] : []),
    )).orderBy(
      desc(schema.budgetProposalVersions.proposedAt),
      desc(schema.budgetProposalVersions.proposalRef),
    ).limit(input.limit);
    return Object.freeze(await Promise.all(rows.map(async (row) => {
      const proposal = proposalFromRow(row);
      await this.assertAlternatives(this.database, row, proposal);
      return projectBudgetProposal(proposal);
    })));
  }
}
