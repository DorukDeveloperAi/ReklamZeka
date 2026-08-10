import { describe, expect, it, vi } from "vitest";
import { ExperimentRecordService } from "@/application/experiment-record-service";
import { EXPERIMENT_CONTRACT_VERSION } from "@/domain/decisions/cadence";

const principal = { actor: { userId: "11111111-1111-4111-8111-111111111111" }, workspaceId: "22222222-2222-4222-822222222222",
  workspaceRef: "workspace_primary", readerRef: "reader_primary" } as const;
const plan = { version: EXPERIMENT_CONTRACT_VERSION, hypothesis: "Offer improves quality", primaryMetric: "qualified_lead_rate",
  desiredDirection: "increase" as const, primaryVariable: "offer", changedVariables: ["offer"], baselineRef: "baseline_primary",
  guardrailMetrics: ["cpl"], stopConditions: ["guardrail_breach", "contamination"] as const, minimumSampleSize: 10,
  minimumWindowHours: 24, minimumEvidenceScore: 0.7, minimumDetectableEffect: 0.05 };

describe("ExperimentRecordService", () => {
  it("derives the actor, tenant, role and timestamp before writing a planned experiment", async () => {
    const writer = { plan: vi.fn(async () => ({ experimentRef: "experiment_aaaaaaaaaaaaaaaaaaaa", recordHash: "a".repeat(64), outcome: "inserted" as const,
      capabilities: { canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const } })), recordOutcome: vi.fn() };
    const service = new ExperimentRecordService(writer, [{ userId: principal.actor.userId, workspaceId: principal.workspaceId, role: "analyst" }], () => new Date("2026-08-10T12:00:00.000Z"));
    await expect(service.mutate(principal, { operation: "plan", accountRef: "account_primary", campaignRef: "campaign_primary",
      cadenceProfileRevisionId: "33333333-3333-4333-8333-333333333333", plan })).resolves.toMatchObject({ authority: { canRecordEvidence: true, canExecute: false, canWriteMeta: false } });
    expect(writer.plan).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: principal.workspaceId, actorId: principal.actor.userId,
      actorRef: principal.readerRef, role: "analyst", occurredAt: "2026-08-10T12:00:00.000Z" }));
  });

  it("keeps viewers out of both plan and outcome mutations", async () => {
    const writer = { plan: vi.fn(), recordOutcome: vi.fn() };
    const service = new ExperimentRecordService(writer, [{ userId: principal.actor.userId, workspaceId: principal.workspaceId, role: "viewer" }]);
    await expect(service.mutate(principal, { operation: "plan", accountRef: "account_primary", campaignRef: "campaign_primary",
      cadenceProfileRevisionId: "33333333-3333-4333-8333-333333333333", plan })).rejects.toMatchObject({ status: 403 });
    expect(writer.plan).not.toHaveBeenCalled(); expect(writer.recordOutcome).not.toHaveBeenCalled();
  });
});
