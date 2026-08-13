import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { verifyBudgetProposal, type BudgetProposal } from "@/application/budget-proposal-service";
import { DrizzleBudgetProposalRepository } from "@/connectors/budget/budget-proposal-drizzle-repository";
import { verifySliceRuleWorkspaceDraft, type SliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type WriterDatabase = Pick<Database, "select" | "insert" | "execute" | "transaction">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const AUTHORITY = Object.freeze({ recommendationOnly: true as const, canPublish: false as const,
  canApprove: false as const, canExecute: false as const, canWriteMeta: false as const,
  canEnableAutomation: false as const });

export class SliceRuleAllocationEntityBindingRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "membership_required" | "role_denied"
    | "source_missing" | "source_ambiguous" | "corrupt_store" | "idempotency_conflict") {
    super("Slice Rule allocation entity binding güvenli biçimde tamamlanamadı");
  }
}

/** Deliberately contains no Meta identifier, owner, currency, or amount. */
export type SliceRuleAllocationEntityBindingCommand = Readonly<{
  workspaceId: string;
  draftHash: string;
  allocationRef: string;
  idempotencyKey: string;
  boundAt: string;
  actorId: string;
}>;

export type SliceRuleAllocationEntityBindingPort = Readonly<{
  append(input: SliceRuleAllocationEntityBindingCommand): Promise<Readonly<{ outcome: "inserted" | "unchanged" }>>;
}>;

function rows<T>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new SliceRuleAllocationEntityBindingRepositoryError("corrupt_store");
  }
  return value.rows as readonly T[];
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

/** Converts the persisted decimal budget to Meta's two-decimal minor-unit representation without float rounding. */
export function sliceRuleDailyBudgetMinor(value: string): number {
  if (!/^(0|[1-9]\d{0,29})(?:\.\d{1,12})?$/.test(value)) throw new SliceRuleAllocationEntityBindingRepositoryError("corrupt_store");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.slice(2).replace(/0/g, "") !== "") throw new SliceRuleAllocationEntityBindingRepositoryError("source_missing");
  const minor = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2) || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new SliceRuleAllocationEntityBindingRepositoryError("source_missing");
  return Number(minor);
}

function valid(input: SliceRuleAllocationEntityBindingCommand): boolean {
  return !!input && typeof input === "object" && Object.keys(input).sort().join("|")
    === ["actorId", "allocationRef", "boundAt", "draftHash", "idempotencyKey", "workspaceId"].join("|")
    && UUID.test(input.workspaceId) && UUID.test(input.actorId) && HASH.test(input.draftHash)
    && REF.test(input.allocationRef) && REF.test(input.idempotencyKey)
    && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.boundAt) && new Date(input.boundAt).toISOString() === input.boundAt;
}

async function assertWriteAccess(database: WriterDatabase, workspaceId: string, actorId: string): Promise<void> {
  const workspace = rows<{ id: string }>(await database.execute(sql`
    select id from workspaces where id = ${workspaceId}::uuid and lifecycle_state = 'active' limit 1 for update`))[0];
  if (!workspace) throw new SliceRuleAllocationEntityBindingRepositoryError("workspace_scope_mismatch");
  const membership = rows<{ role: string }>(await database.execute(sql`
    select role from memberships where workspace_id = ${workspaceId}::uuid and user_id = ${actorId}::uuid limit 1 for update`))[0];
  if (!membership) throw new SliceRuleAllocationEntityBindingRepositoryError("membership_required");
  if (membership.role === "viewer") throw new SliceRuleAllocationEntityBindingRepositoryError("role_denied");
}

function storedDraft(row: typeof schema.sliceRuleWorkspaceDrafts.$inferSelect): SliceRuleWorkspaceDraft {
  const draft = row.draftPayload as unknown as SliceRuleWorkspaceDraft;
  if (!verifySliceRuleWorkspaceDraft(draft) || draft.workspaceId !== row.workspaceId || draft.draftHash !== row.draftHash
    || draft.draftRef !== row.draftRef || draft.status !== row.lifecycleState || draft.operatingMode !== row.operatingMode) {
    throw new SliceRuleAllocationEntityBindingRepositoryError("corrupt_store");
  }
  return draft;
}

/**
 * Server-private, append-only writer. The only caller-controlled selector is
 * an allocation label already embedded in the immutable Slice Rule draft.
 */
export class DrizzleSliceRuleAllocationEntityBindingRepository implements SliceRuleAllocationEntityBindingPort {
  constructor(private readonly database: WriterDatabase) {}

  async append(input: SliceRuleAllocationEntityBindingCommand) {
    if (!valid(input)) throw new SliceRuleAllocationEntityBindingRepositoryError("invalid_input");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`slice-rule-allocation:${input.workspaceId}:${input.draftHash}:${input.allocationRef}`}, 0))`);
      await assertWriteAccess(tx, input.workspaceId, input.actorId);

      const replay = await tx.select().from(schema.sliceRuleAllocationEntityBindings).where(and(
        eq(schema.sliceRuleAllocationEntityBindings.workspaceId, input.workspaceId),
        eq(schema.sliceRuleAllocationEntityBindings.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (replay[0]) {
        if (replay[0].draftHash === input.draftHash && replay[0].allocationRef === input.allocationRef) {
          return Object.freeze({ outcome: "unchanged" as const });
        }
        throw new SliceRuleAllocationEntityBindingRepositoryError("idempotency_conflict");
      }

      const draftRows = await tx.select().from(schema.sliceRuleWorkspaceDrafts).where(and(
        eq(schema.sliceRuleWorkspaceDrafts.workspaceId, input.workspaceId), eq(schema.sliceRuleWorkspaceDrafts.draftHash, input.draftHash),
      )).limit(2);
      if (draftRows.length !== 1) throw new SliceRuleAllocationEntityBindingRepositoryError("source_missing");
      const draft = storedDraft(draftRows[0]!);
      const rule = draft.operatingRule.rule;
      if (rule.kind !== "targeting_budget_preservation") {
        throw new SliceRuleAllocationEntityBindingRepositoryError("source_missing");
      }
      const allocation = rule.allocations.filter((entry) => entry.allocationRef === input.allocationRef);
      if (allocation.length !== 1) throw new SliceRuleAllocationEntityBindingRepositoryError("source_missing");
      const expectedMinor = sliceRuleDailyBudgetMinor(allocation[0]!.dailyBudgetDecimal);

      // The frozen context is not supplied by a caller. It must already be the
      // exact persisted BudgetProposal provenance edge for this draft.
      const provenance = await tx.select().from(schema.sliceRuleBudgetProposalBindings).where(and(
        eq(schema.sliceRuleBudgetProposalBindings.workspaceId, input.workspaceId),
        eq(schema.sliceRuleBudgetProposalBindings.draftHash, input.draftHash),
      )).limit(2);
      if (provenance.length !== 1) throw new SliceRuleAllocationEntityBindingRepositoryError(
        provenance.length === 0 ? "source_missing" : "source_ambiguous");
      const proposals = await tx.select().from(schema.budgetProposalVersions).where(and(
        eq(schema.budgetProposalVersions.workspaceId, input.workspaceId),
        eq(schema.budgetProposalVersions.proposalHash, provenance[0]!.proposalHash),
      )).limit(2);
      if (proposals.length !== 1 || proposals[0]!.proposalRef !== provenance[0]!.proposalRef
        || !verifyBudgetProposal(proposals[0]!.proposalPayload as BudgetProposal)) {
        throw new SliceRuleAllocationEntityBindingRepositoryError("corrupt_store");
      }
      const proposal = proposals[0]!;
      const frozen = await new DrizzleBudgetProposalRepository(tx).loadExact({ workspaceId: input.workspaceId,
        adAccountId: proposal.adAccountId, campaignId: proposal.campaignId, contextHash: proposal.contextHash });
      if (frozen.invalidated) throw new SliceRuleAllocationEntityBindingRepositoryError("source_missing");
      const context = await tx.select().from(schema.effectiveCampaignContexts).where(and(
        eq(schema.effectiveCampaignContexts.workspaceId, input.workspaceId), eq(schema.effectiveCampaignContexts.id, proposal.contextId),
        eq(schema.effectiveCampaignContexts.contextHash, proposal.contextHash), eq(schema.effectiveCampaignContexts.adAccountId, proposal.adAccountId),
        eq(schema.effectiveCampaignContexts.campaignId, proposal.campaignId), eq(schema.effectiveCampaignContexts.entityType, "campaign"),
      )).limit(2);
      if (context.length !== 1) throw new SliceRuleAllocationEntityBindingRepositoryError("source_missing");

      const candidates = await tx.select({ adSet: schema.metaAdSets, campaign: schema.adCampaigns, account: schema.adAccounts })
        .from(schema.metaAdSets).innerJoin(schema.adCampaigns, and(eq(schema.adCampaigns.id, schema.metaAdSets.campaignId),
          eq(schema.adCampaigns.workspaceId, schema.metaAdSets.workspaceId)))
        .innerJoin(schema.adAccounts, and(eq(schema.adAccounts.id, schema.metaAdSets.adAccountId),
          eq(schema.adAccounts.workspaceId, schema.metaAdSets.workspaceId)))
        .where(and(eq(schema.metaAdSets.workspaceId, input.workspaceId), eq(schema.metaAdSets.adAccountId, proposal.adAccountId),
          eq(schema.metaAdSets.campaignId, proposal.campaignId), isNull(schema.metaAdSets.disappearedAt), isNull(schema.adCampaigns.disappearedAt),
          isNull(schema.adAccounts.disappearedAt), eq(schema.adAccounts.currency, rule.currency)));
      const matching = candidates.flatMap(({ adSet, campaign, account }) => {
        const adSetDaily = adSet.dailyBudgetMinor === expectedMinor;
        const campaignDaily = campaign.campaignBudgetOptimization === true && campaign.dailyBudgetMinor === expectedMinor;
        if (!adSetDaily && !campaignDaily) return [];
        const owner = adSetDaily ? Object.freeze({ level: "ad_set" as const, entityId: adSet.id, kind: "daily" as const,
          amount: adSet.dailyBudgetMinor!, rawPayloadHash: adSet.rawPayloadHash, sourceGraphVersion: adSet.sourceGraphVersion,
          fieldCatalogVersion: adSet.fieldCatalogVersion, observedAt: adSet.fetchedAt })
          : Object.freeze({ level: "campaign" as const, entityId: campaign.id, kind: "daily" as const,
            amount: campaign.dailyBudgetMinor!, rawPayloadHash: campaign.rawPayloadHash, sourceGraphVersion: campaign.sourceGraphVersion,
            fieldCatalogVersion: campaign.fieldCatalogVersion, observedAt: campaign.fetchedAt });
        if (!owner.rawPayloadHash || !owner.sourceGraphVersion || !owner.fieldCatalogVersion) return [];
        return [Object.freeze({ adSet, campaign, account, owner })];
      });
      if (matching.length !== 1) throw new SliceRuleAllocationEntityBindingRepositoryError(
        matching.length === 0 ? "source_missing" : "source_ambiguous");
      const target = matching[0]!;
      const evidenceCore = Object.freeze({ sourceKind: "canonical_meta_inventory" as const,
        observedAt: target.owner.observedAt.toISOString(), rawPayloadHash: target.owner.rawPayloadHash,
        sourceGraphVersion: target.owner.sourceGraphVersion, fieldCatalogVersion: target.owner.fieldCatalogVersion,
        frozenContextHash: proposal.contextHash, hierarchyRawPayloadHash: target.adSet.rawPayloadHash });
      const sourceEvidence = Object.freeze({ ...evidenceCore, evidenceHash: hash(evidenceCore) });
      const payload = Object.freeze({ schemaVersion: "slice-rule-allocation-entity-binding/1.0.0" as const,
        draftHash: input.draftHash, allocationRef: input.allocationRef,
        hierarchy: Object.freeze({ adAccountId: target.account.id, campaignId: target.campaign.id, adSetId: target.adSet.id }),
        budgetOwner: Object.freeze({ level: target.owner.level, entityId: target.owner.entityId }),
        budget: Object.freeze({ kind: target.owner.kind, currency: target.account.currency, currentAmountMinor: target.owner.amount }),
        sourceEvidence, boundAt: input.boundAt, authority: AUTHORITY });
      await tx.insert(schema.sliceRuleAllocationEntityBindings).values({ workspaceId: input.workspaceId, draftHash: input.draftHash,
        allocationRef: input.allocationRef, adAccountId: target.account.id, campaignId: target.campaign.id, adSetId: target.adSet.id,
        budgetOwnerLevel: target.owner.level, budgetOwnerEntityId: target.owner.entityId, budgetKind: target.owner.kind,
        currency: target.account.currency, currentAmountMinor: target.owner.amount, sourceEvidenceHash: sourceEvidence.evidenceHash,
        sourceObservedAt: target.owner.observedAt, sourceEvidence, idempotencyKey: input.idempotencyKey,
        boundByActorId: input.actorId, bindingPayload: payload, boundAt: new Date(input.boundAt) });
      return Object.freeze({ outcome: "inserted" as const });
    });
  }
}
