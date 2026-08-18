import { describe, expect, it, vi } from "vitest";

import { DrizzleP06StatusExecutionDispatchAuthorityRepository } from "@/connectors/actions/p06-status-execution-dispatch-authority-drizzle-repository";

const request = Object.freeze({
  executionRef: "p06_execution_aaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceRef: "workspace_aaaaaaaaaaaaaaaa",
  accountRef: "act_12345",
  entityRef: "adset_12345",
  action: "status_pause" as const,
  expectedBefore: Object.freeze({ status: "ACTIVE" as const, budgetMinor: null }),
  desired: Object.freeze({ status: "PAUSED" as const, budgetMinor: null }),
  evaluatedAt: "2026-08-18T10:00:00.000Z",
});

describe("P06 status dispatch authority", () => {
  it("admits exactly one current tenant-bound authority row", async () => {
    const execute = vi.fn(async () => ({
      rows: [
        {
          authorized_at: "2026-08-18T10:05:00.000Z",
          request_hash: "1".repeat(64),
          workspace_id: "00000000-0000-4000-8000-000000000001",
          context_hash: "2".repeat(64),
          current_context_hash: "2".repeat(64),
          effective_guide_set_hash: "3".repeat(64),
          resolution_hash: "4".repeat(64),
          policy_hash: "5".repeat(64),
          guide_revision_id: "00000000-0000-4000-8000-000000000001",
          slice_ref: "slice_main",
          market_key: "yerli",
          unit_hash: "6".repeat(64),
          action_hash: "8".repeat(64),
          grant_hash: "7".repeat(64),
          connection_generation: 2,
        },
      ],
    }));
    const repository = new DrizzleP06StatusExecutionDispatchAuthorityRepository({
      transaction: vi.fn(async (work) => work({ execute } as never)),
    } as never, {
      loadInTransaction: vi.fn(async () => ({
        workspaceRef: request.workspaceRef,
        accountRef: request.accountRef,
        entityRef: request.entityRef,
        currentStatus: request.expectedBefore.status,
        contextHash: "2".repeat(64),
        approvalPolicyHash: "5".repeat(64),
        effectiveGuideSetHash: "3".repeat(64),
        resolutionHash: "4".repeat(64),
        dataHealthReportHash: "9".repeat(64),
      })),
    } as never);

    const result = await repository.revalidate({
      phase: "pre_dispatch",
      executionRef: request.executionRef,
      request,
    });

    expect(result.allowed).toBe(true);
    expect(result.authorityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("fails closed for absent, ambiguous, or invalid execution authority", async () => {
    const absent = new DrizzleP06StatusExecutionDispatchAuthorityRepository({
      transaction: vi.fn(async (work) =>
        work({ execute: vi.fn(async () => ({ rows: [] })) } as never),
      ),
    } as never, { loadInTransaction: vi.fn() } as never);
    const ambiguous = new DrizzleP06StatusExecutionDispatchAuthorityRepository({
      transaction: vi.fn(async (work) =>
        work({ execute: vi.fn(async () => ({ rows: [{}, {}] })) } as never),
      ),
    } as never, { loadInTransaction: vi.fn() } as never);

    await expect(
      absent.revalidate({ phase: "post_claim", executionRef: request.executionRef, request }),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      ambiguous.revalidate({ phase: "post_claim", executionRef: request.executionRef, request }),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      absent.revalidate({ phase: "post_claim", executionRef: "bad", request }),
    ).resolves.toMatchObject({ allowed: false });
  });
});
