import { describe, expect, it, vi } from "vitest";
import { DrizzleP06GuideBudgetExecutionDispatchAuthorityRepository } from "@/connectors/actions/p06-guide-budget-execution-dispatch-authority-drizzle-repository";

const request = { executionRef: "p06_execution_111111111111111111111111", workspaceRef: "workspace_main", accountRef: "account_main",
  entityRef: "adset_main", action: "budget_decrease" as const, budgetKind: "daily" as const, currency: "TRY",
  expectedBefore: { status: "ACTIVE" as const, budgetMinor: 10000 }, desired: { status: "ACTIVE" as const, budgetMinor: 9000 },
  evaluatedAt: "2026-08-18T10:00:00.000Z" };
const row = { authorized_at: "2026-08-18T10:01:00.000Z", workspace_id: "00000000-0000-4000-8000-000000000001",
  request_hash: "1".repeat(64), admission_hash: "2".repeat(64), attempt_admission_hash: "2".repeat(64),
  write_spec_hash: "3".repeat(64), attempt_write_spec_hash: "3".repeat(64), dry_run_hash: "4".repeat(64),
  action_plan_hash: "5".repeat(64), unit_action_plan_hash: "5".repeat(64), context_hash: "6".repeat(64),
  unit_context_hash: "6".repeat(64), policy_hash: "7".repeat(64), unit_ref: "action_unit_11111111111111111111",
  unit_hash: "8".repeat(64), source_hash: "9".repeat(64), action_hash: "a".repeat(64),
  action_plan_payload: { action: { kind: "budget_change", entity: { level: "adset", ref: "adset_main" }, budgetKind: "daily",
    currency: "TRY", beforeDecimal: "100", afterDecimal: "90", budgetOwnerRef: "adset_main" } },
  expires_at: "2026-08-18T11:00:00.000Z", plan_ref: `guide_budget_${"b".repeat(32)}_${"4".repeat(64)}`,
  plan_revision: 1, plan_hash: "c".repeat(64), grant_hash: "d".repeat(64), connection_generation: 1 };

describe("P06 Guide budget dispatch authority", () => {
  it("revalidates the persisted P04 binding at dispatch time", async () => {
    const revalidatePersisted = vi.fn().mockResolvedValue(true);
    const execute = vi.fn().mockResolvedValue({ rows: [row] });
    const database = { transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }) };
    const result = await new DrizzleP06GuideBudgetExecutionDispatchAuthorityRepository(database as never, { revalidatePersisted }).revalidate({
      phase: "pre_dispatch", executionRef: request.executionRef, request,
    });
    expect(result.allowed).toBe(true);
    expect(result.authorityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(revalidatePersisted).toHaveBeenCalledWith(expect.objectContaining({ binding: expect.objectContaining({
      actionPlanHash: "5".repeat(64), contextHash: "6".repeat(64), action: expect.objectContaining({ kind: "budget_change" }) }) }));
  });

  it("fails closed for a status route or changed P04 evidence", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [row] });
    const database = { transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }) };
    const gate = { revalidatePersisted: vi.fn().mockResolvedValue(false) };
    const authority = new DrizzleP06GuideBudgetExecutionDispatchAuthorityRepository(database as never, gate);
    expect((await authority.revalidate({ phase: "post_claim", executionRef: request.executionRef, request })).allowed).toBe(false);
    expect((await authority.revalidate({ phase: "post_claim", executionRef: request.executionRef,
      request: { ...request, action: "status_pause", budgetKind: null, currency: null } })).allowed).toBe(false);
  });
});
