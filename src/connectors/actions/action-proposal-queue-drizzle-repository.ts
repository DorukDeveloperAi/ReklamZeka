import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  assertValidApprovalLifecycle,
  type ActionUnit,
  type ApprovalLifecycle,
} from "@/domain/actions/approval-lifecycle";
import {
  ACTION_PROPOSAL_STAGING_VERSION,
  assertValidStagedActionProposal,
  type PublicSafeActionSummary,
  type StagedActionProposal,
} from "@/application/action-proposal-staging-service";
import { ACTION_PLAN_VERSION, type ActionPlan } from "@/domain/actions/autonomy-valve";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type QueueDatabase = Pick<Database, "select" | "insert" | "execute" | "transaction">;

export class ActionProposalQueueRepositoryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "idempotency_conflict"
    | "policy_conflict"
    | "scope_ambiguity"
    | "corrupt_store") {
    super(`Action proposal queue persistence reddedildi: ${code}`);
    this.name = "ActionProposalQueueRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

type PersistedStagedSummary = StagedActionProposal["summaries"][number] & Readonly<{ actionPlan: ActionPlan }>;
type PersistableStagedActionProposal = Omit<StagedActionProposal, "summaries"> & Readonly<{
  summaries: readonly PersistedStagedSummary[];
}>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new ActionProposalQueueRepositoryError("invalid_input");
  }
}

function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new ActionProposalQueueRepositoryError("corrupt_store");
  }
  return result.rows as readonly T[];
}

function assertInitialLifecycle(candidate: unknown): asserts candidate is ApprovalLifecycle {
  try {
    assertValidApprovalLifecycle(candidate);
  } catch {
    throw new ActionProposalQueueRepositoryError("invalid_input");
  }
  if (candidate.units.some((unit) => unit.state !== "awaiting_approval"
    || unit.decisionRef !== null || unit.decisionActor !== null || unit.decidedAt !== null
    || unit.reasonCode !== null || unit.grant !== null)
    || candidate.trace.length !== 1
    || candidate.trace[0]?.eventType !== "lifecycle_initialized"
    || candidate.trace[0].sequence !== 1
    || candidate.trace[0].unitRef !== null
    || candidate.trace[0].unitHash !== null
    || candidate.trace[0].actorRef !== null
    || candidate.executionAuthority !== "none") {
    throw new ActionProposalQueueRepositoryError("invalid_input");
  }
  const workspaceRefs = new Set(candidate.bundle.units.map((unit) => unit.scope.workspaceRef));
  if (workspaceRefs.size !== 1) throw new ActionProposalQueueRepositoryError("workspace_scope_mismatch");
}

function assertSummary(value: unknown, unit: ActionUnit): asserts value is PersistedStagedSummary {
  exact(value, ["unitRef", "actionPlanHash", "actionHash", "summaryHash", "summary", "actionPlan"]);
  exact(value.summary, ["safety", "before", "after", "evidence"]);
  exact(value.summary.before, ["label", "value"]);
  exact(value.summary.after, ["label", "value"]);
  if (value.summary.safety !== "public_safe" || !Array.isArray(value.summary.evidence)
    || value.summary.evidence.length > 50) throw new ActionProposalQueueRepositoryError("invalid_input");
  for (const evidence of value.summary.evidence) exact(evidence, ["evidenceRef", "label"]);
  const summary = value.summary as PublicSafeActionSummary;
  const actionPlan = value.actionPlan as unknown as ActionPlan;
  exact(actionPlan, [
    "schemaVersion", "actionType", "risk", "action", "effectiveAutonomy", "disposition",
    "reasonCodes", "trace", "budgetDelta", "capabilities", "contextHash", "planHash",
  ]);
  exact(actionPlan.capabilities, ["canExecute", "canWriteMeta", "canGrantApproval", "canAccessRawGraph"]);
  const { planHash, ...planCore } = actionPlan;
  if (actionPlan.schemaVersion !== ACTION_PLAN_VERSION || actionPlan.disposition !== "approval_required"
    || actionPlan.capabilities.canExecute !== false || actionPlan.capabilities.canWriteMeta !== false
    || actionPlan.capabilities.canGrantApproval !== false || actionPlan.capabilities.canAccessRawGraph !== false
    || !HASH.test(value.actionPlanHash as string) || !HASH.test(value.actionHash as string)
    || !HASH.test(value.summaryHash as string) || value.unitRef !== unit.unitRef
    || value.actionPlanHash !== planHash || digest(planCore) !== planHash
    || digest(actionPlan.action) !== value.actionHash || digest(summary) !== value.summaryHash
    || actionPlan.actionType !== unit.scope.actionType || actionPlan.risk !== unit.risk
    || actionPlan.contextHash !== unit.contextHash || actionPlan.planHash !== unit.sourceHash
    || actionPlan.action.entity.ref !== unit.scope.entityRef
    || unit.specHash !== digest({ actionHash: value.actionHash, summaryHash: value.summaryHash })) {
    throw new ActionProposalQueueRepositoryError("invalid_input");
  }
}

function assertInitialProposal(candidate: unknown): asserts candidate is PersistableStagedActionProposal {
  try {
    assertValidStagedActionProposal(candidate);
  } catch {
    throw new ActionProposalQueueRepositoryError("invalid_input");
  }
  exact(candidate, [
    "version", "idempotencyKey", "bundle", "lifecycle", "auditEventIntents", "summaries", "stagingHash",
    "persistenceRequested", "persisted", "authority", "executionPerformed",
  ]);
  if (candidate.version !== ACTION_PROPOSAL_STAGING_VERSION || typeof candidate.idempotencyKey !== "string"
    || !HASH.test(candidate.idempotencyKey) || typeof candidate.stagingHash !== "string" || !HASH.test(candidate.stagingHash)
    || candidate.persistenceRequested !== true || candidate.persisted !== false || candidate.authority !== "none"
    || candidate.executionPerformed !== false || !Array.isArray(candidate.summaries)
    || !Array.isArray(candidate.auditEventIntents)) throw new ActionProposalQueueRepositoryError("invalid_input");
  assertInitialLifecycle(candidate.lifecycle);
  if (digest(candidate.bundle) !== digest(candidate.lifecycle.bundle)
    || digest(candidate.auditEventIntents) !== digest(candidate.lifecycle.trace)
    || candidate.summaries.length !== candidate.lifecycle.bundle.units.length) {
    throw new ActionProposalQueueRepositoryError("invalid_input");
  }
  const byRef = new Map(candidate.lifecycle.bundle.units.map((unit) => [unit.unitRef, unit]));
  const seen = new Set<string>();
  for (const summary of candidate.summaries) {
    const unitRef = summary && typeof summary === "object" && "unitRef" in summary ? summary.unitRef : null;
    const unit = typeof unitRef === "string" ? byRef.get(unitRef) : undefined;
    if (!unit || seen.has(unit.unitRef)) throw new ActionProposalQueueRepositoryError("invalid_input");
    assertSummary(summary, unit);
    seen.add(unit.unitRef);
  }
  const { stagingHash, ...base } = candidate;
  if (digest(base) !== stagingHash) throw new ActionProposalQueueRepositoryError("invalid_input");
}

async function lockActiveWorkspace(database: QueueDatabase, workspaceId: string): Promise<void> {
  const found = rows<{ id: string }>(await database.execute(sql`
    select id from workspaces
    where id = ${workspaceId}::uuid and lifecycle_state = 'active'
    limit 1 for update
  `));
  if (found.length !== 1) throw new ActionProposalQueueRepositoryError("workspace_scope_mismatch");
}

type AuthenticScope = Readonly<{
  adAccountId: string;
  campaignId: string | null;
  adSetId: string | null;
  adId: string | null;
}>;

async function authenticScope(
  database: QueueDatabase,
  workspaceId: string,
  unit: ActionUnit,
  actionPlan: ActionPlan,
): Promise<AuthenticScope> {
  const accounts = await database.select({ id: schema.adAccounts.id }).from(schema.adAccounts).where(and(
    eq(schema.adAccounts.workspaceId, workspaceId),
    eq(schema.adAccounts.externalAccountId, unit.scope.accountRef),
  )).limit(2);
  if (accounts.length !== 1) throw new ActionProposalQueueRepositoryError("workspace_scope_mismatch");
  const adAccountId = accounts[0]!.id;
  const level = actionPlan.action.entity.level;
  const matches = level === "campaign"
    ? await database.select({ id: schema.adCampaigns.id }).from(schema.adCampaigns).where(and(
      eq(schema.adCampaigns.workspaceId, workspaceId), eq(schema.adCampaigns.adAccountId, adAccountId),
      eq(schema.adCampaigns.externalCampaignId, unit.scope.entityRef),
    )).limit(2)
    : level === "adset"
      ? await database.select({ id: schema.metaAdSets.id }).from(schema.metaAdSets).where(and(
      eq(schema.metaAdSets.workspaceId, workspaceId), eq(schema.metaAdSets.adAccountId, adAccountId),
      eq(schema.metaAdSets.externalAdSetId, unit.scope.entityRef),
      )).limit(2)
      : await database.select({ id: schema.metaAds.id }).from(schema.metaAds).where(and(
        eq(schema.metaAds.workspaceId, workspaceId), eq(schema.metaAds.adAccountId, adAccountId),
        eq(schema.metaAds.externalAdId, unit.scope.entityRef),
      )).limit(2);
  if (matches.length !== 1) throw new ActionProposalQueueRepositoryError(
    matches.length > 1 ? "scope_ambiguity" : "workspace_scope_mismatch",
  );
  return Object.freeze({
    adAccountId,
    campaignId: level === "campaign" ? matches[0]!.id : null,
    adSetId: level === "adset" ? matches[0]!.id : null,
    adId: level === "ad" ? matches[0]!.id : null,
  });
}

/**
 * Server-only, append-only persistence for a freshly initialized proposal.
 * It deliberately exposes no approval mutation, grant minting, or execution method.
 */
export class DrizzleActionProposalQueueRepository {
  constructor(private readonly database: QueueDatabase, private readonly workspaceId: string) {
    if (!UUID.test(workspaceId)) throw new ActionProposalQueueRepositoryError("invalid_input");
  }

  async appendInitial(candidate: unknown): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    lifecycleHash: string;
  }>> {
    assertInitialProposal(candidate);
    const lifecycle = candidate.lifecycle;
    const lifecycleHash = digest(lifecycle);
    const workspaceRef = lifecycle.bundle.units[0]!.scope.workspaceRef;
    const initializedAt = lifecycle.trace[0]!.occurredAt;

    return this.database.transaction(async (transaction) => {
      await lockActiveWorkspace(transaction, this.workspaceId);
      const existing = await transaction.select().from(schema.actionProposalBundles).where(and(
        eq(schema.actionProposalBundles.workspaceId, this.workspaceId),
        eq(schema.actionProposalBundles.bundleRef, lifecycle.bundle.bundleRef),
        eq(schema.actionProposalBundles.planRef, lifecycle.bundle.plan.planRef),
        eq(schema.actionProposalBundles.planRevision, lifecycle.bundle.plan.revision),
      )).limit(2);
      if (existing.length > 1) throw new ActionProposalQueueRepositoryError("corrupt_store");
      if (existing[0]) {
        if (existing[0].lifecycleHash !== lifecycleHash || existing[0].bundleHash !== lifecycle.bundle.bundleHash
          || existing[0].traceHash !== lifecycle.traceHash || existing[0].stagingHash !== candidate.stagingHash
          || existing[0].idempotencyKey !== candidate.idempotencyKey) {
          throw new ActionProposalQueueRepositoryError("idempotency_conflict");
        }
        return Object.freeze({ outcome: "unchanged" as const, lifecycleHash });
      }

      const policyRows = await transaction.select().from(schema.actionApprovalPolicySnapshots).where(and(
        eq(schema.actionApprovalPolicySnapshots.workspaceId, this.workspaceId),
        eq(schema.actionApprovalPolicySnapshots.policyRef, lifecycle.policy.policyRef),
        eq(schema.actionApprovalPolicySnapshots.revision, lifecycle.policy.revision),
      )).limit(2);
      if (policyRows.length > 1) throw new ActionProposalQueueRepositoryError("corrupt_store");
      let policySnapshotId: string;
      if (policyRows[0]) {
        if (policyRows[0].policyHash !== lifecycle.policy.policyHash
          || digest(policyRows[0].policyPayload) !== digest(lifecycle.policy)) {
          throw new ActionProposalQueueRepositoryError("policy_conflict");
        }
        policySnapshotId = policyRows[0].id;
      } else {
        const insertedPolicy = await transaction.insert(schema.actionApprovalPolicySnapshots).values({
          workspaceId: this.workspaceId,
          policyRef: lifecycle.policy.policyRef,
          revision: lifecycle.policy.revision,
          schemaVersion: lifecycle.policy.version,
          policyHash: lifecycle.policy.policyHash,
          policyPayload: lifecycle.policy,
        }).returning({ id: schema.actionApprovalPolicySnapshots.id });
        if (!insertedPolicy[0]) throw new ActionProposalQueueRepositoryError("corrupt_store");
        policySnapshotId = insertedPolicy[0].id;
      }

      const insertedBundle = await transaction.insert(schema.actionProposalBundles).values({
        workspaceId: this.workspaceId,
        policySnapshotId,
        workspaceRef,
        bundleRef: lifecycle.bundle.bundleRef,
        idempotencyKey: candidate.idempotencyKey,
        stagingVersion: candidate.version,
        stagingHash: candidate.stagingHash,
        schemaVersion: lifecycle.bundle.version,
        bundleHash: lifecycle.bundle.bundleHash,
        planRef: lifecycle.bundle.plan.planRef,
        planRevision: lifecycle.bundle.plan.revision,
        planHash: lifecycle.bundle.plan.planHash,
        traceHash: lifecycle.traceHash,
        lifecycleHash,
        bundlePayload: lifecycle.bundle,
        initializedAt: new Date(initializedAt),
      }).returning({ id: schema.actionProposalBundles.id });
      if (!insertedBundle[0]) throw new ActionProposalQueueRepositoryError("corrupt_store");
      const bundleId = insertedBundle[0].id;

      const unitIds = new Map<string, string>();
      const summaries = new Map(candidate.summaries.map((summary) => [summary.unitRef, summary]));
      for (const [index, unit] of lifecycle.bundle.units.entries()) {
        const staged = summaries.get(unit.unitRef);
        if (!staged) throw new ActionProposalQueueRepositoryError("corrupt_store");
        const scope = await authenticScope(transaction, this.workspaceId, unit, staged.actionPlan);
        const inserted = await transaction.insert(schema.actionProposalUnits).values({
          workspaceId: this.workspaceId,
          bundleId,
          ordinal: index + 1,
          unitRef: unit.unitRef,
          unitHash: unit.unitHash,
          scopeHash: unit.scopeHash,
          accountRef: unit.scope.accountRef,
          entityRef: unit.scope.entityRef,
          actionType: unit.scope.actionType,
          risk: unit.risk,
          sourceHash: unit.sourceHash,
          contextHash: unit.contextHash,
          specHash: unit.specHash,
          actionPlanHash: staged.actionPlanHash,
          actionHash: staged.actionHash,
          summaryHash: staged.summaryHash,
          requesterRef: unit.requester.actorRef,
          requesterRole: unit.requester.role,
          proposedAt: new Date(unit.proposedAt),
          expiresAt: new Date(unit.expiresAt),
          initialState: "awaiting_approval",
          ...scope,
          unitPayload: unit,
          actionPlanPayload: staged.actionPlan,
          summaryPayload: staged.summary,
        }).returning({ id: schema.actionProposalUnits.id });
        if (!inserted[0]) throw new ActionProposalQueueRepositoryError("corrupt_store");
        unitIds.set(unit.unitRef, inserted[0].id);
      }

      for (const unit of lifecycle.bundle.units) {
        for (const dependencyUnitRef of unit.dependencies) {
          const unitId = unitIds.get(unit.unitRef);
          const dependencyUnitId = unitIds.get(dependencyUnitRef);
          if (!unitId || !dependencyUnitId) throw new ActionProposalQueueRepositoryError("corrupt_store");
          await transaction.insert(schema.actionProposalDependencies).values({
            workspaceId: this.workspaceId,
            bundleId,
            unitId,
            dependencyUnitId,
            unitRef: unit.unitRef,
            dependencyUnitRef,
          });
        }
      }

      const event = lifecycle.trace[0]!;
      await transaction.insert(schema.actionProposalInitialEvents).values({
        workspaceId: this.workspaceId,
        bundleId,
        eventRef: event.eventRef,
        sequence: event.sequence,
        previousHash: event.previousHash,
        eventHash: event.eventHash,
        eventType: event.eventType,
        occurredAt: new Date(event.occurredAt),
        reasonCode: event.reasonCode,
      });
      return Object.freeze({ outcome: "inserted" as const, lifecycleHash });
    });
  }
}
