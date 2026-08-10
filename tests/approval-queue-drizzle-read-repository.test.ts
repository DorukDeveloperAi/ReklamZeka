import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  ApprovalQueueDrizzleReadError,
  DrizzleApprovalQueueReadRepository,
} from "@/connectors/actions/approval-queue-drizzle-read-repository";
import { buildActionPlan, type ActionValveContext, type TypedActionIntent } from "@/domain/actions/autonomy-valve";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const foreignWorkspaceId = "00000000-0000-4000-8000-000000000099";
const accountId = "10000000-0000-4000-8000-000000000001";
const campaignId = "20000000-0000-4000-8000-000000000001";
const policyId = "30000000-0000-4000-8000-000000000001";
const unitRef = "action_unit_aaaaaaaaaaaaaaaaaaaa";

function context(entity: ActionValveContext["entity"]): ActionValveContext {
  return {
    workspaceRef: "workspace_alpha", accountGroupRef: null, accountRef: "account_alpha",
    internalCategoryRefs: [], campaignRef: "campaign_alpha", entity,
    evaluatedAt: "2026-08-07T12:00:00.000Z",
    rules: [{
      ruleRef: "autonomy_workspace", workspaceRef: "workspace_alpha",
      scope: { level: "workspace", ref: "workspace_alpha" }, mode: "approval_only", state: "published",
      effectiveFrom: "2026-08-01T00:00:00.000Z", expiresAt: null, killSwitch: false, maximumActionsPerRun: null,
    }],
    budgetLimits: { currency: "TRY", maximumAbsoluteDeltaDecimal: "100", maximumRelativeDeltaBasisPoints: null,
      limitRefs: ["limit_budget"] },
    protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [],
      changeDisposition: "allowed", policyRefs: [] },
  };
}

function budgetPlan() {
  const action: TypedActionIntent = {
    kind: "budget_change", entity: { level: "campaign", ref: "campaign_alpha" }, budgetKind: "daily",
    currency: "TRY", beforeDecimal: "1000", afterDecimal: "950.50", budgetOwnerRef: "campaign_alpha",
  };
  return buildActionPlan(action, context(action.entity));
}

function sourceRow(patch: Record<string, unknown> = {}) {
  return {
    unit_ref: unitRef,
    bundle_ref: "action_bundle_bbbbbbbbbbbbbbbbbbbb",
    initial_state: "awaiting_approval",
    risk: "K2",
    action_type: "budget_decrease",
    ad_account_id: accountId,
    campaign_id: campaignId,
    ad_set_id: null,
    ad_id: null,
    campaign_scope_id: campaignId,
    policy_snapshot_id: policyId,
    proposed_at: "2026-08-07T13:00:00.000Z",
    expires_at: "2026-08-08T13:00:00.000Z",
    current_event_type: null,
    action_plan_payload: budgetPlan(),
    dependencies: [{ unit_ref: "action_unit_cccccccccccccccccccc", status: "awaiting_approval" }],
    ...patch,
  };
}

function database(...resultSets: readonly unknown[][]) {
  const queue = [...resultSets];
  const dialect = new PgDialect();
  const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const db = {
    execute: vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      queries.push(dialect.sqlToQuery(query));
      return { rows: queue.shift() ?? [] };
    }),
  };
  return { db, queries };
}

describe("Approval Queue Drizzle read repository", () => {
  it("maps one tenant's persisted proposal to an exact public-safe read model", async () => {
    const fixture = database([sourceRow()]);
    const repository = new DrizzleApprovalQueueReadRepository(fixture.db as never, workspaceId);
    const result = await repository.list({ workspaceId, entityRef: null, campaignRef: null, before: null, limit: 26 });

    expect(result).toEqual([expect.objectContaining({
      unitRef,
      bundleRef: "action_bundle_bbbbbbbbbbbbbbbbbbbb",
      status: "awaiting_approval",
      risk: "K2",
      actionType: "budget_decrease",
      beforeAfter: { field: "daily_budget_minor", beforeMinor: 100_000, afterMinor: 95_050, currency: "TRY" },
      autonomy: expect.objectContaining({ decision: "approval_required", trace: [{
        scope: "workspace", decision: "approval_required", reasonCode: "autonomy.applied",
      }] }),
      dependencies: [{ unitRef: "action_unit_cccccccccccccccccccc", status: "awaiting_approval" }],
      summaryCode: "approval.budget_decrease",
    })]);
    expect(result[0]?.accountRef).toMatch(/^account_[a-f0-9]{16}$/);
    expect(result[0]?.entity).toMatchObject({ type: "campaign", ref: expect.stringMatching(/^entity_[a-f0-9]{16}$/), label: null });
    expect(result[0]?.autonomy.profileRef).toMatch(/^autonomy_[a-f0-9]{16}$/);
    const serialized = JSON.stringify(result);
    for (const privateValue of [workspaceId, accountId, campaignId, policyId, "account_alpha", "campaign_alpha"]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0]?.dependencies)).toBe(true);
  });

  it("enforces descending temporal keyset pagination in the tenant-scoped SQL", async () => {
    const fixture = database([]);
    const repository = new DrizzleApprovalQueueReadRepository(fixture.db as never, workspaceId);
    await repository.list({
      workspaceId,
      entityRef: null,
      campaignRef: null,
      before: { createdAt: "2026-08-07T13:00:00.000Z", unitRef },
      limit: 26,
    });
    const query = fixture.queries[0]!;
    expect(query.sql).toContain("where unit.workspace_id = $1::uuid");
    expect(query.sql).toContain("(unit.proposed_at, unit.unit_ref) < ($9::timestamptz, $10::text)");
    expect(query.sql).toContain("order by unit.proposed_at desc, unit.unit_ref desc");
    expect(query.sql).not.toMatch(/\boffset\b/i);
    expect(query.params).toEqual([workspaceId, null, workspaceId, null, null, workspaceId, null, "2026-08-07T13:00:00.000Z", "2026-08-07T13:00:00.000Z", unitRef, 26]);
  });

  it("filters by the derived public entity reference inside the tenant-scoped query", async () => {
    const fixture = database([]);
    const repository = new DrizzleApprovalQueueReadRepository(fixture.db as never, workspaceId);
    await repository.list({ workspaceId, entityRef: "entity_0123456789abcdef", campaignRef: null, before: null, limit: 26 });
    const query = fixture.queries[0]!;
    expect(query.sql).toContain("coalesce(unit.campaign_id, unit.ad_set_id, unit.ad_id)");
    expect(query.sql).toContain("digest($3::text || ':entity:'");
    expect(query.params).toEqual([workspaceId, "entity_0123456789abcdef", workspaceId, "entity_0123456789abcdef", null, workspaceId, null, null, null, null, 26]);
    expect(query.sql).not.toContain("campaign_alpha");
  });

  it("resolves a campaign scope through direct, ad-set, or ad unit bindings", async () => {
    const fixture = database([]);
    const repository = new DrizzleApprovalQueueReadRepository(fixture.db as never, workspaceId);
    await repository.list({ workspaceId, entityRef: null, campaignRef: "entity_0123456789abcdef", before: null, limit: 26 });
    const query = fixture.queries[0]!;
    expect(query.sql).toContain("left join meta_ad_sets unit_ad_set");
    expect(query.sql).toContain("left join meta_ads unit_ad");
    expect(query.sql).toContain("coalesce(unit.campaign_id, unit_ad_set.campaign_id, unit_ad.campaign_id)");
    expect(query.params).toEqual([workspaceId, null, workspaceId, null, "entity_0123456789abcdef", workspaceId,
      "entity_0123456789abcdef", null, null, null, 26]);
  });

  it("returns tenant-bound detail and null for not found", async () => {
    const found = database([sourceRow()]);
    const result = await new DrizzleApprovalQueueReadRepository(found.db as never, workspaceId)
      .get({ workspaceId, unitRef });
    expect(result?.unitRef).toBe(unitRef);
    expect(found.queries[0]?.sql).toContain("unit.workspace_id = $1::uuid and unit.unit_ref = $2");
    expect(found.queries[0]?.params).toEqual([workspaceId, unitRef]);

    await expect(new DrizzleApprovalQueueReadRepository(database([]).db as never, workspaceId)
      .get({ workspaceId, unitRef })).resolves.toBeNull();
  });

  it("projects append-only decision and dependency event state instead of the initial fixture state", async () => {
    const fixture = database([sourceRow({
      current_event_type: "unit_approved",
      dependencies: [{ unit_ref: "action_unit_cccccccccccccccccccc", status: "changes_requested" }],
    })]);
    const result = await new DrizzleApprovalQueueReadRepository(fixture.db as never, workspaceId)
      .get({ workspaceId, unitRef });
    expect(result).toMatchObject({ status: "approved", dependencies: [{ status: "changes_requested" }] });
    expect(fixture.queries[0]?.sql).toContain("jsonb_array_elements(decision.event_payloads)");
  });

  it("rejects cross-tenant access and malformed inputs before database I/O", async () => {
    const fixture = database();
    const repository = new DrizzleApprovalQueueReadRepository(fixture.db as never, workspaceId);
    await expect(repository.list({ workspaceId: foreignWorkspaceId, entityRef: null, campaignRef: null, before: null, limit: 26 }))
      .rejects.toEqual(expect.objectContaining<Partial<ApprovalQueueDrizzleReadError>>({ code: "workspace_scope_mismatch" }));
    await expect(repository.get({ workspaceId: foreignWorkspaceId, unitRef }))
      .rejects.toEqual(expect.objectContaining<Partial<ApprovalQueueDrizzleReadError>>({ code: "workspace_scope_mismatch" }));
    await expect(repository.list({ workspaceId, entityRef: null, campaignRef: null, before: null, limit: 0 }))
      .rejects.toEqual(expect.objectContaining<Partial<ApprovalQueueDrizzleReadError>>({ code: "invalid_input" }));
    await expect(repository.list({ workspaceId: 7, entityRef: null, campaignRef: null, before: null, limit: 26 } as never))
      .rejects.toEqual(expect.objectContaining<Partial<ApprovalQueueDrizzleReadError>>({ code: "invalid_input" }));
    await expect(repository.get({ workspaceId, unitRef, execute: true } as never))
      .rejects.toEqual(expect.objectContaining<Partial<ApprovalQueueDrizzleReadError>>({ code: "invalid_input" }));
    expect(fixture.db.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-level entity binding", () => sourceRow({ campaign_id: null, ad_set_id: campaignId })],
    ["forged plan payload", () => sourceRow({ action_plan_payload: { ...budgetPlan(), execute: true } })],
    ["unsupported dependency state", () => sourceRow({ dependencies: [{ unit_ref: "action_unit_cccccccccccccccccccc", status: "executing" }] })],
    ["unsupported decision event", () => sourceRow({ current_event_type: "approval_grant_consumed" })],
    ["duplicate dependencies", () => sourceRow({ dependencies: [
      { unit_ref: "action_unit_cccccccccccccccccccc", status: "awaiting_approval" },
      { unit_ref: "action_unit_cccccccccccccccccccc", status: "awaiting_approval" },
    ] })],
    ["fractional minor amount", () => {
      const plan = budgetPlan();
      return sourceRow({ action_plan_payload: { ...plan, action: { ...plan.action, afterDecimal: "950.501" } } });
    }],
  ])("fails closed on malformed persisted %s", async (_label, make) => {
    const fixture = database([make()]);
    await expect(new DrizzleApprovalQueueReadRepository(fixture.db as never, workspaceId)
      .list({ workspaceId, entityRef: null, campaignRef: null, before: null, limit: 26 }))
      .rejects.toEqual(expect.objectContaining<Partial<ApprovalQueueDrizzleReadError>>({ code: "corrupt_store" }));
  });
});
