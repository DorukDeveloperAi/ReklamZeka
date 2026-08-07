import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ActionProposalStagingService, type StagedActionProposal } from "@/application/action-proposal-staging-service";
import {
  ActionProposalQueueRepositoryError,
  DrizzleActionProposalQueueRepository,
} from "@/connectors/actions/action-proposal-queue-drizzle-repository";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import {
  ACTION_APPROVAL_POLICY_VERSION,
  createActionBundle,
  initializeApprovalLifecycle,
  type ApprovalPolicy,
} from "@/domain/actions/approval-lifecycle";
import {
  createApprovalPolicyDraft,
  disableApprovalPolicy,
  publishApprovalPolicy,
  type ApprovalPolicyDefinitionRevision,
} from "@/domain/actions/approval-policy-registry";
import { buildActionPlan, EXISTING_POST_SOURCE_BINDING_VERSION,
  type ActionPlan, type ActionValveContext, type AutonomyRule, type TypedActionIntent } from "@/domain/actions/autonomy-valve";
import * as schema from "@/db/schema";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const accountId = "10000000-0000-4000-8000-000000000001";
const campaignId = "20000000-0000-4000-8000-000000000001";
const adSetId = "30000000-0000-4000-8000-000000000001";
const trustedDefinitionId = "40000000-0000-4000-8000-000000000001";

const policy: ApprovalPolicy = {
  version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "policy_queue", revision: 1,
  autonomyMode: "approval_only", requesterRoles: ["operator"],
  approverRoles: [{ risk: "K2", roles: ["owner"] }, { risk: "K3", roles: ["owner"] }],
  grantConsumerRoles: ["owner"], separationOfDutiesRisks: ["K3"], maximumProposalLifetimeSeconds: 86_400,
  maximumGrantLifetimeSeconds: 300,
};

function rule(): AutonomyRule {
  return {
    ruleRef: "autonomy_workspace", workspaceRef: "workspace_alpha",
    scope: { level: "workspace", ref: "workspace_alpha" }, mode: "approval_only", state: "published",
    effectiveFrom: "2026-08-01T00:00:00.000Z", expiresAt: null, killSwitch: false, maximumActionsPerRun: null,
  };
}

function context(entity: ActionValveContext["entity"]): ActionValveContext {
  return {
    workspaceRef: "workspace_alpha", accountGroupRef: null, accountRef: "act_12345",
    internalCategoryRefs: [], campaignRef: "campaign_12345", entity,
    evaluatedAt: "2026-08-07T17:00:00.000Z", rules: [rule()], budgetLimits: null,
    protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] },
  };
}

function staged() {
  const pause: TypedActionIntent = {
    kind: "status_change", entity: { level: "campaign", ref: "campaign_12345" },
    fromStatus: "ACTIVE", toStatus: "PAUSED",
  };
  const activate: TypedActionIntent = {
    kind: "status_change", entity: { level: "adset", ref: "adset_67890" },
    fromStatus: "PAUSED", toStatus: "ACTIVE",
  };
  const plans = [buildActionPlan(pause, context(pause.entity)), buildActionPlan(activate, context(activate.entity))];
  return new ActionProposalStagingService(policy).stage({
    plan: { planRef: "plan_daily", revision: 1, planHash: "a".repeat(64) },
    workspaceRef: "workspace_alpha", accountRef: "act_12345",
    requester: { actorRef: "actor_operator", role: "operator" },
    proposedAt: "2026-08-07T18:00:00.000Z", expiresAt: "2026-08-08T18:00:00.000Z",
    units: plans.map((actionPlan, index) => ({
      unitKey: index === 0 ? "unit_parent" : "unit_child",
      plan: { planRef: "plan_daily", revision: 1, planHash: "a".repeat(64) }, actionPlan,
      workspaceRef: "workspace_alpha", accountRef: "act_12345", entityRef: actionPlan.action.entity.ref,
      actionType: actionPlan.actionType, risk: actionPlan.risk, actionHash: digest(actionPlan.action),
      dependencies: index === 0 ? [] : ["unit_parent"],
      summary: { safety: "public_safe", before: { label: "Önce", value: "Mevcut durum" },
        after: { label: "Sonra", value: "Önerilen durum" },
        evidence: [{ evidenceRef: `evidence_${index}`, label: "Doğrulanmış özet" }] },
    })),
  });
}

function stagedBudget() {
  const action: TypedActionIntent = {
    kind: "budget_change", entity: { level: "campaign", ref: "campaign_12345" }, budgetKind: "daily",
    currency: "TRY", beforeDecimal: "100", afterDecimal: "90", budgetOwnerRef: "campaign_12345",
  };
  const actionPlan = buildActionPlan(action, {
    ...context(action.entity),
    budgetLimits: { currency: "TRY", maximumAbsoluteDeltaDecimal: "20", maximumRelativeDeltaBasisPoints: null,
      limitRefs: ["limit_budget"] },
  });
  return new ActionProposalStagingService(policy).stage({
    plan: { planRef: "plan_budget", revision: 1, planHash: "b".repeat(64) },
    workspaceRef: "workspace_alpha", accountRef: "act_12345",
    requester: { actorRef: "actor_operator", role: "operator" },
    proposedAt: "2026-08-07T18:00:00.000Z", expiresAt: "2026-08-08T18:00:00.000Z",
    units: [{ unitKey: "unit_budget", plan: { planRef: "plan_budget", revision: 1, planHash: "b".repeat(64) },
      actionPlan, workspaceRef: "workspace_alpha", accountRef: "act_12345", entityRef: action.entity.ref,
      actionType: actionPlan.actionType, risk: actionPlan.risk, actionHash: digest(actionPlan.action), dependencies: [],
      summary: { safety: "public_safe", before: { label: "Önce", value: "100 TRY" },
        after: { label: "Sonra", value: "90 TRY" }, evidence: [{ evidenceRef: "evidence_budget", label: "Bütçe kanıtı" }] } }],
  });
}

function trustedDefinitions(patch: { workspaceRef?: string; policyRef?: string; expiresAt?: string | null } = {}) {
  const workspaceRef = patch.workspaceRef ?? "workspace_alpha";
  const draft = createApprovalPolicyDraft({ workspaceRef,
    policy: { version: ACTION_APPROVAL_POLICY_VERSION, policyRef: patch.policyRef ?? "policy_existing_post", revision: 1,
      autonomyMode: "approval_only", requesterRoles: ["owner"],
      approverRoles: [{ risk: "K4", roles: ["owner", "admin"] }], grantConsumerRoles: ["owner"],
      separationOfDutiesRisks: ["K4"], maximumProposalLifetimeSeconds: 86_400,
      maximumGrantLifetimeSeconds: 300 },
    effectiveFrom: "2026-08-07T10:00:00.000Z", expiresAt: patch.expiresAt ?? null,
    normalizedBy: { actorRef: "actor_analyst", role: "analyst" } });
  const published = publishApprovalPolicy({ draft, actor: { actorRef: "actor_owner", role: "owner" },
    decisionRef: "decision_publish_policy", reasonRef: "reason_reviewed",
    publishedAt: "2026-08-07T10:30:00.000Z" });
  return { draft, published, definitions: [draft, published] as const };
}

function stagedPromotion(approvalPolicy: ApprovalPolicy) {
  const action: TypedActionIntent = {
    kind: "existing_post_promotion", entity: { level: "adset", ref: "adset_67890" }, placeholderOnly: true,
    postRef: "post_existing", postContentHash: "1".repeat(64), actorRef: "actor_page",
    sourceBinding: { version: EXISTING_POST_SOURCE_BINDING_VERSION, kind: "organic_post_binding",
      sourceRef: "source_page_post", sourceHash: "2".repeat(64), postIdentityHash: "3".repeat(64),
      objectStorySpecHash: "4".repeat(64) },
    promotionTemplateVersionRef: "template_version_one", audiencePresetVersionRef: "audience_version_one",
    destinationRef: "destination_site", budgetPlanVersionRef: "budget_plan_one", timeframeRef: "timeframe_week",
    scheduleMode: "fixed_duration", durationDays: 7,
  };
  const actionPlan = buildActionPlan(action, context(action.entity));
  return new ActionProposalStagingService(approvalPolicy).stage({
    plan: { planRef: "plan_promotion", revision: 1, planHash: "e".repeat(64) },
    workspaceRef: "workspace_alpha", accountRef: "act_12345",
    requester: { actorRef: "actor_owner", role: "owner" },
    proposedAt: "2026-08-07T18:00:00.000Z", expiresAt: "2026-08-08T18:00:00.000Z",
    units: [{ unitKey: "unit_promotion", plan: { planRef: "plan_promotion", revision: 1, planHash: "e".repeat(64) },
      actionPlan, workspaceRef: "workspace_alpha", accountRef: "act_12345", entityRef: action.entity.ref,
      actionType: actionPlan.actionType, risk: actionPlan.risk, actionHash: digest(actionPlan.action), dependencies: [],
      summary: { safety: "public_safe", before: { label: "Önce", value: "Organik gönderi" },
        after: { label: "Sonra", value: "Onay bekleyen öne çıkarma" },
        evidence: [{ evidenceRef: "evidence_promotion", label: "Kaynak doğrulandı" }] } }],
  });
}

function definitionRows(definitions: readonly ApprovalPolicyDefinitionRevision[]) {
  return definitions.map((definition, index) => ({
    id: index === definitions.length - 1 ? trustedDefinitionId
      : `40000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`,
    artifactPayload: definition,
  }));
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function rehashPlan(plan: ActionPlan, action: unknown): ActionPlan {
  const { planHash: _planHash, ...core } = { ...plan, action };
  return { ...core, planHash: digest(core) } as ActionPlan;
}

function attackerRehash(
  proposal: StagedActionProposal,
  mutate: (summary: StagedActionProposal["summaries"][number]) => StagedActionProposal["summaries"][number],
): StagedActionProposal {
  const summaries = proposal.summaries.map(mutate).map((entry) => {
    const actionPlan = entry.actionPlan;
    return { ...entry, actionPlanHash: actionPlan.planHash, actionHash: digest(actionPlan.action),
      summaryHash: digest(entry.summary) };
  });
  const summaryByRef = new Map(summaries.map((entry) => [entry.unitRef, entry]));
  const bundle = createActionBundle({
    bundleRef: proposal.bundle.bundleRef,
    plan: proposal.bundle.plan,
    units: proposal.bundle.units.map(({ plan: _plan, unitHash: _unitHash, scopeHash: _scopeHash, ...unit }) => {
      const summary = summaryByRef.get(unit.unitRef)!;
      return { ...unit, sourceHash: summary.actionPlanHash, contextHash: summary.actionPlan.contextHash,
        specHash: digest({ actionHash: summary.actionHash, summaryHash: summary.summaryHash }) };
    }),
  });
  const { policyHash: _policyHash, ...approvalPolicy } = proposal.lifecycle.policy;
  const initialized = initializeApprovalLifecycle({
    bundle, policy: approvalPolicy, initializedAt: bundle.units[0]!.proposedAt,
    eventRef: proposal.lifecycle.trace[0]!.eventRef,
  });
  const base = {
    version: proposal.version, idempotencyKey: proposal.idempotencyKey, bundle,
    lifecycle: initialized.lifecycle, auditEventIntents: initialized.auditEventIntents, summaries,
    persistenceRequested: true as const, persisted: false as const, authority: "none" as const,
    executionPerformed: false as const,
  };
  return { ...base, stagingHash: digest(base) };
}

type Row = Record<string, unknown>;

class AtomicQueueDatabase {
  private store = new Map<unknown, Row[]>();
  private transactionStore: Map<unknown, Row[]> | null = null;
  failTable: unknown = null;
  workspaceActive = true;
  private sequence = 10;

  constructor() {
    this.store.set(schema.adAccounts, [{ id: accountId, workspaceId, externalAccountId: "act_12345" }]);
    this.store.set(schema.adCampaigns, [{ id: campaignId, workspaceId, adAccountId: accountId, externalCampaignId: "campaign_12345" }]);
    this.store.set(schema.metaAdSets, [{ id: adSetId, workspaceId, adAccountId: accountId, externalAdSetId: "adset_67890" }]);
    this.store.set(schema.metaAds, []);
  }

  private active() { return this.transactionStore ?? this.store; }
  table(table: unknown): Row[] { return this.active().get(table) ?? []; }
  setTable(table: unknown, value: Row[]) { this.active().set(table, value); }
  execute = async () => ({ rows: this.workspaceActive ? [{ id: workspaceId }] : [] });
  select = () => ({
    from: (table: unknown) => {
      const chain = { where: () => chain, limit: async (limit: number) => this.table(table).slice(0, limit) };
      return chain;
    },
  });
  insert = (table: unknown) => ({
    values: (value: Row) => {
      let completed: Row | null = null;
      const perform = async () => {
        if (completed) return completed;
        if (table === this.failTable) throw new Error("injected_insert_failure");
        const row = { ...value, id: `90000000-0000-4000-8000-${String(this.sequence++).padStart(12, "0")}` };
        this.setTable(table, [...this.table(table), row]);
        completed = row;
        return row;
      };
      return {
        returning: async () => [await perform()],
        then: <T>(resolve: (value: unknown) => T, reject: (reason: unknown) => T) => perform().then(resolve, reject),
      };
    },
  });
  transaction = async <T>(work: (transaction: AtomicQueueDatabase) => Promise<T>): Promise<T> => {
    if (this.transactionStore) throw new Error("nested_transaction");
    this.transactionStore = new Map([...this.store].map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]));
    try {
      const result = await work(this);
      this.store = this.transactionStore;
      return result;
    } finally { this.transactionStore = null; }
  };
}

describe("DrizzleActionProposalQueueRepository", () => {
  it("atomically persists staged payloads, exact target bindings, DAG and initial event", async () => {
    const database = new AtomicQueueDatabase();
    const proposal = staged();
    const result = await new DrizzleActionProposalQueueRepository(database as never, workspaceId).appendInitial(proposal);
    expect(result.outcome).toBe("inserted");
    expect(database.table(schema.actionApprovalPolicySnapshots)).toHaveLength(1);
    expect(database.table(schema.actionProposalBundles)).toHaveLength(1);
    expect(database.table(schema.actionProposalUnits)).toHaveLength(2);
    expect(database.table(schema.actionProposalDependencies)).toHaveLength(1);
    expect(database.table(schema.actionProposalInitialEvents)).toHaveLength(1);
    expect(database.table(schema.actionProposalUnits)).toEqual(expect.arrayContaining([
      expect.objectContaining({ adAccountId: accountId, campaignId, actionPlanPayload: expect.any(Object), summaryPayload: expect.any(Object) }),
      expect.objectContaining({ adAccountId: accountId, adSetId, actionPlanPayload: expect.any(Object), summaryPayload: expect.any(Object) }),
    ]));
  });

  it("supports exact replay across repository restart and rejects identity conflict", async () => {
    const database = new AtomicQueueDatabase();
    const proposal = staged();
    await new DrizzleActionProposalQueueRepository(database as never, workspaceId).appendInitial(proposal);
    expect((await new DrizzleActionProposalQueueRepository(database as never, workspaceId).appendInitial(proposal)).outcome)
      .toBe("unchanged");
    database.table(schema.actionProposalBundles)[0]!.stagingHash = "f".repeat(64);
    await expect(new DrizzleActionProposalQueueRepository(database as never, workspaceId).appendInitial(proposal))
      .rejects.toEqual(expect.objectContaining<Partial<ActionProposalQueueRepositoryError>>({ code: "idempotency_conflict" }));
  });

  it("binds K4 existing-post policy snapshots only to the exact published-active trusted definition", async () => {
    const trusted = trustedDefinitions();
    const database = new AtomicQueueDatabase();
    database.setTable(schema.approvalPolicyDefinitionRevisions, definitionRows(trusted.definitions));
    const proposal = stagedPromotion(trusted.published.policy);
    const repository = new DrizzleActionProposalQueueRepository(database as never, workspaceId);
    await expect(repository.appendInitial(proposal)).resolves.toMatchObject({ outcome: "inserted" });
    expect(database.table(schema.actionApprovalPolicySnapshots)).toEqual([expect.objectContaining({
      sourceDefinitionId: trustedDefinitionId,
      sourceDefinitionCanonicalHash: trusted.published.canonicalHash,
      policyRef: trusted.published.policyRef, revision: trusted.published.revision,
      policyHash: trusted.published.policyHash, policyPayload: proposal.lifecycle.policy,
    })]);
    await expect(repository.appendInitial(proposal)).resolves.toMatchObject({ outcome: "unchanged" });
    expect(database.table(schema.actionProposalBundles)).toHaveLength(1);
  });

  it("performs zero queue writes when trusted K4 source is missing, ambiguous, mismatched, cross-tenant, draft, disabled, or expired", async () => {
    const trusted = trustedDefinitions();
    const other = trustedDefinitions({ policyRef: "policy_other" });
    const disabled = disableApprovalPolicy({ current: trusted.published, actor: { actorRef: "actor_admin", role: "admin" },
      decisionRef: "decision_disable_policy", reasonRef: "reason_retired", disabledAt: "2026-08-07T11:00:00.000Z" });
    const expired = trustedDefinitions({ policyRef: "policy_expired", expiresAt: "2026-08-07T17:00:00.000Z" });
    const crossTenant = trustedDefinitions({ workspaceRef: "workspace_other", policyRef: "policy_cross_tenant" });
    const arbitraryPolicy = { ...trusted.published.policy, maximumGrantLifetimeSeconds: 600 };
    const cases = [
      { definitions: [], proposal: stagedPromotion(trusted.published.policy) },
      { definitions: [...trusted.definitions, ...other.definitions], proposal: stagedPromotion(trusted.published.policy) },
      { definitions: trusted.definitions, proposal: stagedPromotion(arbitraryPolicy) },
      { definitions: crossTenant.definitions, proposal: stagedPromotion(crossTenant.published.policy) },
      { definitions: [trusted.draft], proposal: stagedPromotion(trusted.draft.policy) },
      { definitions: [...trusted.definitions, disabled], proposal: stagedPromotion(disabled.policy) },
      { definitions: expired.definitions, proposal: stagedPromotion(expired.published.policy) },
    ] as const;
    for (const entry of cases) {
      const database = new AtomicQueueDatabase();
      database.setTable(schema.approvalPolicyDefinitionRevisions, definitionRows(entry.definitions));
      await expect(new DrizzleActionProposalQueueRepository(database as never, workspaceId).appendInitial(entry.proposal))
        .rejects.toEqual(expect.objectContaining({ code: "policy_conflict" }));
      expect(database.table(schema.actionApprovalPolicySnapshots)).toHaveLength(0);
      expect(database.table(schema.actionProposalBundles)).toHaveLength(0);
      expect(database.table(schema.actionProposalUnits)).toHaveLength(0);
    }
  });

  it("rejects a legacy or mismatched existing snapshot without exact trusted source provenance", async () => {
    const trusted = trustedDefinitions();
    const proposal = stagedPromotion(trusted.published.policy);
    const database = new AtomicQueueDatabase();
    database.setTable(schema.approvalPolicyDefinitionRevisions, definitionRows(trusted.definitions));
    database.setTable(schema.actionApprovalPolicySnapshots, [{ id: "50000000-0000-4000-8000-000000000001",
      workspaceId, sourceDefinitionId: null, sourceDefinitionCanonicalHash: null,
      policyRef: trusted.published.policyRef, revision: trusted.published.revision,
      policyHash: trusted.published.policyHash, policyPayload: proposal.lifecycle.policy }]);
    await expect(new DrizzleActionProposalQueueRepository(database as never, workspaceId).appendInitial(proposal))
      .rejects.toEqual(expect.objectContaining({ code: "policy_conflict" }));
    expect(database.table(schema.actionProposalBundles)).toHaveLength(0);
  });

  it("rejects historical snapshot replay when the proposal lifetime field differs from its trusted hash", async () => {
    const trusted = trustedDefinitions();
    const proposal = stagedPromotion(trusted.published.policy);
    for (const policyPayload of [
      { ...proposal.lifecycle.policy, maximumProposalLifetimeSeconds: 43_200 },
      Object.fromEntries(Object.entries(proposal.lifecycle.policy)
        .filter(([key]) => key !== "maximumProposalLifetimeSeconds")),
    ]) {
      const database = new AtomicQueueDatabase();
      database.setTable(schema.approvalPolicyDefinitionRevisions, definitionRows(trusted.definitions));
      database.setTable(schema.actionApprovalPolicySnapshots, [{ id: "50000000-0000-4000-8000-000000000002",
        workspaceId, sourceDefinitionId: trustedDefinitionId,
        sourceDefinitionCanonicalHash: trusted.published.canonicalHash,
        policyRef: trusted.published.policyRef, revision: trusted.published.revision,
        policyHash: trusted.published.policyHash, policyPayload }]);
      await expect(new DrizzleActionProposalQueueRepository(database as never, workspaceId).appendInitial(proposal))
        .rejects.toEqual(expect.objectContaining({ code: "policy_conflict" }));
      expect(database.table(schema.actionProposalBundles)).toHaveLength(0);
    }
  });

  it("permits only a no-write historical exact replay before trusted lookup and creates no new authority rows", async () => {
    const trusted = trustedDefinitions();
    const arbitrary = stagedPromotion({ ...trusted.published.policy, maximumProposalLifetimeSeconds: 172_800 });
    const database = new AtomicQueueDatabase();
    database.setTable(schema.actionProposalBundles, [{
      id: "60000000-0000-4000-8000-000000000001", workspaceId,
      bundleRef: arbitrary.lifecycle.bundle.bundleRef, planRef: arbitrary.lifecycle.bundle.plan.planRef,
      planRevision: arbitrary.lifecycle.bundle.plan.revision, lifecycleHash: digest(arbitrary.lifecycle),
      bundleHash: arbitrary.lifecycle.bundle.bundleHash, traceHash: arbitrary.lifecycle.traceHash,
      stagingHash: arbitrary.stagingHash, idempotencyKey: arbitrary.idempotencyKey,
    }]);
    await expect(new DrizzleActionProposalQueueRepository(database as never, workspaceId).appendInitial(arbitrary))
      .resolves.toEqual({ outcome: "unchanged", lifecycleHash: digest(arbitrary.lifecycle) });
    expect(database.table(schema.actionProposalBundles)).toHaveLength(1);
    expect(database.table(schema.actionApprovalPolicySnapshots)).toHaveLength(0);
    expect(database.table(schema.actionProposalUnits)).toHaveLength(0);
    expect(database.table(schema.actionProposalInitialEvents)).toHaveLength(0);
  });

  it("fails closed for malformed authority input, missing authentic scope, and partial insert", async () => {
    const proposal = staged();
    await expect(new DrizzleActionProposalQueueRepository(new AtomicQueueDatabase() as never, workspaceId)
      .appendInitial({ ...proposal, execute: true })).rejects.toEqual(
      expect.objectContaining<Partial<ActionProposalQueueRepositoryError>>({ code: "invalid_input" }),
    );

    const unbound = new AtomicQueueDatabase();
    unbound.setTable(schema.adAccounts, []);
    await expect(new DrizzleActionProposalQueueRepository(unbound as never, workspaceId).appendInitial(proposal))
      .rejects.toEqual(expect.objectContaining<Partial<ActionProposalQueueRepositoryError>>({ code: "workspace_scope_mismatch" }));
    expect(unbound.table(schema.actionProposalBundles)).toHaveLength(0);

    const rollback = new AtomicQueueDatabase();
    rollback.failTable = schema.actionProposalInitialEvents;
    await expect(new DrizzleActionProposalQueueRepository(rollback as never, workspaceId).appendInitial(proposal))
      .rejects.toThrow("injected_insert_failure");
    expect(rollback.table(schema.actionProposalBundles)).toHaveLength(0);
    expect(rollback.table(schema.actionProposalUnits)).toHaveLength(0);
  });

  it("re-runs canonical staged validation against attacker-rehashed summaries and typed actions", async () => {
    for (const unsafeValue of ["Bearer abcdefghijklmnopqrstuvwxyz", "https://graph.facebook.com/token"]) {
      const forged = attackerRehash(staged(), (entry) => ({
        ...entry, summary: { ...entry.summary, after: { ...entry.summary.after, value: unsafeValue } },
      }));
      const database = new AtomicQueueDatabase();
      await expect(new DrizzleActionProposalQueueRepository(database as never, workspaceId).appendInitial(forged))
        .rejects.toEqual(expect.objectContaining<Partial<ActionProposalQueueRepositoryError>>({ code: "invalid_input" }));
      expect(database.table(schema.actionProposalBundles)).toHaveLength(0);
    }

    const weekly = attackerRehash(stagedBudget(), (entry) => ({
      ...entry, actionPlan: rehashPlan(entry.actionPlan, { ...entry.actionPlan.action, budgetKind: "weekly" }),
    }));
    await expect(new DrizzleActionProposalQueueRepository(new AtomicQueueDatabase() as never, workspaceId).appendInitial(weekly))
      .rejects.toEqual(expect.objectContaining<Partial<ActionProposalQueueRepositoryError>>({ code: "invalid_input" }));

    const extraField = attackerRehash(staged(), (entry) => ({
      ...entry, actionPlan: rehashPlan(entry.actionPlan, { ...entry.actionPlan.action, execute: true }),
    }));
    await expect(new DrizzleActionProposalQueueRepository(new AtomicQueueDatabase() as never, workspaceId).appendInitial(extraField))
      .rejects.toEqual(expect.objectContaining<Partial<ActionProposalQueueRepositoryError>>({ code: "invalid_input" }));
  });

  it("keeps generated migration dark, append-only, exact and dependency-safe", () => {
    const migration = readFileSync("drizzle/20260807173537_action_proposal_queue.sql", "utf8");
    for (const table of ["action_approval_policy_snapshots", "action_proposal_bundles", "action_proposal_units",
      "action_proposal_dependencies", "action_proposal_initial_events"]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE "${table}" FROM PUBLIC, anon, authenticated`);
      expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain(table);
    }
    expect(migration).not.toContain("previous_hash\" = $1");
    expect(migration).toContain("action_proposal_queue_append_only");
    expect(migration).toContain("no_forbidden_material");
    expect(migration).toContain("canAccessRawGraph}' = 'false'");
    expect(migration.indexOf("action_proposal_units_dependency_binding_unique"))
      .toBeLessThan(migration.indexOf("action_proposal_dependencies_unit_scope_fk"));
  });
});
