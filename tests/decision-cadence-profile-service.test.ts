import { describe, expect, it, vi } from "vitest";
import { DecisionCadenceProfileService } from "@/application/decision-cadence-profile-service";
import { DECISION_CADENCE_VERSION } from "@/domain/decisions/cadence";

const principal = { actor: { userId: "11111111-1111-4111-8111-111111111111" }, workspaceId: "22222222-2222-4222-8222-222222222222",
  workspaceRef: "workspace_primary", readerRef: "reader_primary" } as const;
const profile = { version: DECISION_CADENCE_VERSION, settleHours: 24, minimumObservationHours: 12, minimumLearningHours: 24,
  cooldownHours: 24, repeatSuppressionHours: 24, frequencyWindowHours: 168, maxDecisionsPerWindow: 3, maxActionsPerWindow: 1,
  maximumHistoryEntries: 20, minimumEvidenceCount: 2, minimumEvidenceScore: 0.8 } as const;
const command = { accountRef: "account_primary", campaignRef: "campaign_primary", profileRef: "cadence_primary", revision: 1,
  expectedCurrentHash: "GENESIS" as const, profile };

describe("DecisionCadenceProfileService", () => {
  it("derives actor, tenant, role and clock server-side before append-only publication", async () => {
    const publish = vi.fn(async () => ({ outcome: "inserted" as const, profileHash: "a".repeat(64),
      capabilities: { canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const } }));
    const service = new DecisionCadenceProfileService({ publish }, [{ userId: principal.actor.userId, workspaceId: principal.workspaceId, role: "owner" }],
      () => new Date("2026-08-10T12:00:00.000Z"));
    await expect(service.publish(principal, command)).resolves.toMatchObject({ authority: { canPublishProfile: true, canExecute: false, canWriteMeta: false } });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: principal.workspaceId, workspaceRef: principal.workspaceRef,
      actorId: principal.actor.userId, actorRef: principal.readerRef, role: "owner", occurredAt: "2026-08-10T12:00:00.000Z" }));
  });

  it("does not permit analyst publication even if a repository call would otherwise succeed", async () => {
    const publish = vi.fn();
    const service = new DecisionCadenceProfileService({ publish }, [{ userId: principal.actor.userId, workspaceId: principal.workspaceId, role: "analyst" }]);
    await expect(service.publish(principal, command)).rejects.toMatchObject({ status: 403 });
    expect(publish).not.toHaveBeenCalled();
  });
});
