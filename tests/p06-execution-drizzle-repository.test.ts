import { describe, expect, it, vi } from "vitest";
import {
  DrizzleP06ExecutionRepository,
  type P06ExecutionGateSeed,
} from "@/connectors/actions/p06-execution-drizzle-repository";
import { buildActionPlan } from "@/domain/actions/autonomy-valve";
import { createMetaWriteSpec } from "@/domain/actions/meta-write-spec";
import { p06ExecutionV2Digest } from "@/domain/actions/p06-execution-v2";

const id = (suffix: string) =>
  `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const evaluatedAt = "2026-08-18T02:00:00.000Z";
function sqlText(value: unknown): string {
  if (
    !value ||
    typeof value !== "object" ||
    !("queryChunks" in value) ||
    !Array.isArray(value.queryChunks)
  )
    return "";
  return value.queryChunks
    .flatMap((chunk) =>
      chunk &&
      typeof chunk === "object" &&
      "value" in chunk &&
      Array.isArray(chunk.value)
        ? chunk.value.filter(
            (part: unknown): part is string => typeof part === "string",
          )
        : [],
    )
    .join("");
}
const gates: readonly P06ExecutionGateSeed[] = [
  "staging",
  "admission",
  "post_claim",
  "pre_dispatch",
  "read_after_write",
].map((phase, index) => ({
  phase,
  enabled: true,
  allowlistHash: "a".repeat(64),
  capturedAt: `2026-08-18T01:59:0${index}.000Z`,
  expiresAt: "2026-08-18T02:05:00.000Z",
})) as readonly P06ExecutionGateSeed[];

describe("DrizzleP06ExecutionRepository", () => {
  it("materializes a persisted Guide budget admission without accepting caller plan or target data", async () => {
    const unitHash = "9".repeat(64);
    const actionPlan = buildActionPlan({ kind: "budget_change", entity: { level: "adset", ref: "adset_external_1" },
      budgetKind: "daily", currency: "TRY", beforeDecimal: "100.50", afterDecimal: "90.25", budgetOwnerRef: "adset_external_1" },
    { workspaceRef: "workspace_alpha", accountGroupRef: null, accountRef: "act_123", internalCategoryRefs: [],
      campaignRef: "campaign_external_1", entity: { level: "adset", ref: "adset_external_1" }, evaluatedAt,
      rules: [], budgetLimits: { currency: "TRY", maximumAbsoluteDeltaDecimal: "20.25", maximumRelativeDeltaBasisPoints: 2000, limitRefs: ["limit_main"] },
      protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] } });
    const writeSpec = createMetaWriteSpec({ unitRef: "action_unit_11111111111111111111", unitHash, actionPlan });
    const admissionCore = { version: "action-execution-admission/1.0.0" as const, unitRef: writeSpec.unitRef,
      approvalDecisionRef: "decision_one", approvalGrantRef: "grant_one", executionPresenceRef: "presence_one", writeSpec,
      eligibilitySnapshotHash: "b".repeat(64), eligibilityHash: "c".repeat(64), dependencyUnitRefs: Object.freeze([]), evaluatedAt,
      disposition: "admitted_for_disabled_executor" as const,
      capabilities: Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canDispatchNetwork: false as const }) };
    const admission = Object.freeze({ ...admissionCore, admissionHash: p06ExecutionV2Digest(admissionCore) });
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ attempt_id: id("7"), admission_hash: admission.admissionHash,
      write_spec_hash: writeSpec.specHash, admission_payload: admission, unit_id: id("3"), unit_hash: unitHash,
      context_hash: actionPlan.contextHash, action_plan_hash: actionPlan.planHash, action_plan_payload: actionPlan,
      account_ref: "act_123", entity_ref: "adset_external_1", action_type: "budget_decrease", ad_set_id: id("8"), campaign_id: id("9"),
      bundle_id: id("2"), workspace_ref: "workspace_alpha",
      plan_ref: `guide_budget_${id("44").replaceAll("-", "")}_${"d".repeat(64)}`, plan_hash: "e".repeat(64),
      decision_id: id("5"), grant_id: id("6"), grant_hash: "2".repeat(64), policy_hash: "1".repeat(64), current_status: "ACTIVE" }] })
      .mockResolvedValueOnce({ rows: [{ configured_status: "ACTIVE" }] })
      .mockResolvedValueOnce({ rows: [{ id: id("4") }] }).mockResolvedValue({ rows: [] });
    const database = { execute, transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }) };
    const created = await new DrizzleP06ExecutionRepository(database as never).createGuideBudgetHumanApproved({
      workspaceId: id("10"), actionExecutionAttemptId: id("7"), evaluatedAt, gates: gates.slice(0, 2),
    });
    expect(created.request).toMatchObject({ action: "budget_decrease", budgetKind: "daily", currency: "TRY",
      expectedBefore: { status: "ACTIVE", budgetMinor: 10050 }, desired: { status: "ACTIVE", budgetMinor: 9025 } });
    const rendered = execute.mock.calls.map(([query]) => sqlText(query)).join("\n");
    expect(rendered).toContain("action_execution_attempts");
    expect(rendered).toContain("guide_budget_human_approved");
    expect(rendered).not.toMatch(/fetch\(|authorization|access_token/i);
  });

  it("derives a status request from the persisted binding and writes no network capability", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            binding_id: id("1"),
            bundle_id: id("2"),
            unit_id: id("3"),
            action_unit_hash: "b".repeat(64),
            proposal_hash: "c".repeat(64),
            effective_guide_set_hash: "d".repeat(64),
            resolution_hash: "e".repeat(64),
            context_hash: "f".repeat(64),
            account_ref: "act_123",
            entity_ref: "adset_456",
            action_type: "status_pause",
            action_plan_payload: {
              action: {
                kind: "status_change",
                fromStatus: "ACTIVE",
                toStatus: "PAUSED",
              },
            },
            workspace_ref: "workspace_alpha",
            policy_hash: "1".repeat(64),
            grant_hash: "2".repeat(64),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: id("4") }] })
      .mockResolvedValue({ rows: [] });
    const database = {
      execute,
      transaction: async (
        callback: (tx: { execute: typeof execute }) => Promise<unknown>,
      ) => callback({ execute }),
    };
    const repository = new DrizzleP06ExecutionRepository(database as never);
    const created = await repository.createHumanApproved({
      workspaceId: id("10"),
      guideRunActionBindingId: id("1"),
      decisionEventId: id("5"),
      approvalGrantId: id("6"),
      evaluatedAt,
      gates: gates.slice(0, 2),
    });

    expect(created.executionRef).toMatch(/^p06_execution_[a-f0-9]{24}$/);
    expect(created.request).toMatchObject({
      workspaceRef: "workspace_alpha",
      accountRef: "act_123",
      entityRef: "adset_456",
      action: "status_pause",
      expectedBefore: { status: "ACTIVE", budgetMinor: null },
      desired: { status: "PAUSED", budgetMinor: null },
    });
    expect(execute).toHaveBeenCalledTimes(5);
    const rendered = execute.mock.calls
      .map(([query]) => sqlText(query))
      .join("\n");
    expect(rendered).toContain("insert into p06_execution_runs");
    expect(rendered).toContain("insert into p06_execution_heads");
    expect(rendered).toContain("insert into p06_execution_gate_snapshots");
    expect(rendered).not.toMatch(/graph|meta.*write|fetch\(|authorization/i);
  });

  it("rejects missing or reordered mandatory gate phases before a transaction", async () => {
    const transaction = vi.fn();
    const repository = new DrizzleP06ExecutionRepository({
      execute: vi.fn(),
      transaction,
    } as never);
    await expect(
      repository.createHumanApproved({
        workspaceId: id("10"),
        guideRunActionBindingId: id("1"),
        decisionEventId: id("5"),
        approvalGrantId: id("6"),
        evaluatedAt,
        gates: gates.slice(0, 1),
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "invalid_input" }));
    expect(transaction).not.toHaveBeenCalled();
  });

  it("claims a pending head with one immutable lease event and CAS advance", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: id("4"),
            workspace_id: id("10"),
            state: "pending",
            sequence: 0,
            trace_sequence: 0,
            head_event_hash: null,
            lease_token_hash: null,
            fence_hash: null,
            lease_epoch: 0,
            lease_expires_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: id("7") }] })
      .mockResolvedValueOnce({ rows: [{ id: id("8") }] });
    const database = {
      execute,
      transaction: async (
        callback: (tx: { execute: typeof execute }) => Promise<unknown>,
      ) => callback({ execute }),
    };
    const repository = new DrizzleP06ExecutionRepository(database as never);
    const receipt = await repository.claimLease({
      executionRef: "p06_execution_" + "a".repeat(24),
      leaseTokenHash: "3".repeat(64),
      fenceHash: "4".repeat(64),
      now: evaluatedAt,
      leaseUntil: "2026-08-18T02:05:00.000Z",
    });
    expect(receipt.core).toMatchObject({
      owned: true,
      leaseTokenHash: "3".repeat(64),
      fenceHash: "4".repeat(64),
    });
    expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    const rendered = execute.mock.calls
      .map(([query]) => sqlText(query))
      .join("\n");
    expect(rendered).toContain("insert into p06_execution_events");
    expect(rendered).toContain(
      "update p06_execution_heads set state='claimed'",
    );
  });

  it("binds each late gate snapshot to the current lease epoch", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: id("4"), workspace_id: id("10"), lease_epoch: 2 }],
      })
      .mockResolvedValueOnce({ rows: [{ id: id("8") }] });
    const database = {
      execute,
      transaction: async (
        callback: (tx: { execute: typeof execute }) => Promise<unknown>,
      ) => callback({ execute }),
    };
    const repository = new DrizzleP06ExecutionRepository(database as never);
    const receiptHash = await repository.appendGate({
      executionRef: "p06_execution_" + "a".repeat(24),
      gate: gates[2]!,
    });
    expect(receiptHash).toMatch(/^[a-f0-9]{64}$/);
    const rendered = execute.mock.calls
      .map(([query]) => sqlText(query))
      .join("\n");
    expect(rendered).toContain("lease_epoch");
    expect(rendered).toContain("phase,lease_epoch");
  });

  it("appends only the exact next trace step under a live matching fence", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: id("4"),
            workspace_id: id("10"),
            state: "claimed",
            sequence: 1,
            trace_sequence: 0,
            head_event_hash: "5".repeat(64),
            lease_token_hash: "3".repeat(64),
            fence_hash: "4".repeat(64),
            lease_epoch: 1,
            lease_expires_at: "2026-08-18T02:05:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: id("7") }] })
      .mockResolvedValueOnce({ rows: [{ id: id("8") }] });
    const database = {
      execute,
      transaction: async (
        callback: (tx: { execute: typeof execute }) => Promise<unknown>,
      ) => callback({ execute }),
    };
    const repository = new DrizzleP06ExecutionRepository(database as never);
    const saved = await repository.appendTrace({
      executionRef: "p06_execution_" + "a".repeat(24),
      leaseTokenHash: "3".repeat(64),
      fenceHash: "4".repeat(64),
      step: "lease",
      outcome: "ok",
      receiptCore: {
        executionRef: "p06_execution_" + "a".repeat(24),
        owned: true,
      },
      occurredAt: evaluatedAt,
    });
    expect(saved.eventHash).toMatch(/^[a-f0-9]{64}$/);
    const rendered = execute.mock.calls
      .map(([query]) => sqlText(query))
      .join("\n");
    expect(rendered).toContain("trace_sequence");
    expect(rendered).toContain(
      "update p06_execution_heads set state='running'",
    );
  });

  it("stores only hashed public-safe observations bound to one trace event", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ run_id: id("4"), workspace_id: id("10"), event_id: id("7") }],
      })
      .mockResolvedValueOnce({ rows: [{ id: id("9") }] });
    const database = {
      execute,
      transaction: async (
        callback: (tx: { execute: typeof execute }) => Promise<unknown>,
      ) => callback({ execute }),
    };
    const repository = new DrizzleP06ExecutionRepository(database as never);
    const saved = await repository.appendObservation({
      executionRef: "p06_execution_" + "a".repeat(24),
      eventHash: "5".repeat(64),
      kind: "read_before",
      metadataHash: "6".repeat(64),
      rawHash: "7".repeat(64),
      observedValue: { status: "ACTIVE", budgetMinor: null },
      observedAt: evaluatedAt,
    });
    expect(saved).toMatchObject({ observationId: id("9") });
    expect(saved.observationRef).toMatch(/^p06_observation_[a-f0-9]{24}$/);
    const rendered = execute.mock.calls
      .map(([query]) => sqlText(query))
      .join("\n");
    expect(rendered).toContain("insert into p06_execution_observations");
    expect(rendered).not.toMatch(/raw_payload|access_token|authorization/i);
  });
});
