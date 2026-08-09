import { describe, expect, it, vi } from "vitest";

import { DrizzleCategoryRegistryRepository } from "@/connectors/categories/category-registry-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const dimensionId = "22222222-2222-4222-8222-222222222222";
const definitionId = "33333333-3333-4333-8333-333333333333";
const assignmentId = "44444444-4444-4444-8444-444444444444";
const nextId = "55555555-5555-4555-8555-555555555555";
const campaignId = "66666666-6666-4666-8666-666666666666";

function row(overrides: Record<string, unknown> = {}) {
  return { id: assignmentId, workspaceId, dimensionId, definitionId, entityLevel: "campaign" as const,
    campaignId, adSetId: null, adId: null, creativeId: null, operation: "deny" as const, source: "manual" as const,
    manualLock: true, evidence: [{ kind: "manual_authoring", ref: "reader_owner" }], confidence: 0.83,
    version: 4, supersedesAssignmentId: null, archivedAt: null, assignedAt: new Date("2026-08-09T18:00:00.000Z"),
    createdAt: new Date("2026-08-09T18:00:00.000Z"), ...overrides };
}

function database(current = row()) {
  let inserted: Record<string, unknown> | null = null;
  const tx = {
    select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [current] }) }) })),
    update: vi.fn(() => ({ set: () => ({ where: () => ({ returning: async () => [{ id: assignmentId }] }) }) })),
    insert: vi.fn(() => ({ values: (value: Record<string, unknown>) => ({ returning: async () => {
      inserted = value; return [row({ ...value, archivedAt: null, assignedAt: new Date(), createdAt: new Date() })];
    } }) })),
  };
  return { tx, getInserted: () => inserted,
    database: { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) } };
}

describe("explicit category assignment unlock revision", () => {
  it("copies immutable assignment semantics into one new unlocked revision", async () => {
    const db = database();
    const result = await new DrizzleCategoryRegistryRepository(db.database as never).unlockAssignment({ workspaceId,
      assignmentId, expectedVersion: 4, nextId,
      evidence: [{ kind: "manual_unlock", ref: "reader_owner", observedAt: "2026-08-09T18:01:00.000Z" }] });
    expect(result).toMatchObject({ id: nextId, workspaceId, dimensionId, definitionId,
      entity: { level: "campaign", id: campaignId }, operation: "deny", source: "manual",
      manualLock: false, confidence: 0.83, version: 5 });
    expect(db.getInserted()).toMatchObject({ id: nextId, workspaceId, dimensionId, definitionId,
      entityLevel: "campaign", campaignId, operation: "deny", source: "manual", manualLock: false,
      confidence: 0.83, version: 5, supersedesAssignmentId: assignmentId,
      evidence: [{ kind: "manual_unlock", ref: "reader_owner", observedAt: "2026-08-09T18:01:00.000Z" }] });
    expect(db.tx.update).toHaveBeenCalledTimes(1);
    expect(db.tx.insert).toHaveBeenCalledTimes(1);
  });

  it("keeps unlock closed unless the current revision is manual and locked", async () => {
    for (const current of [row({ source: "agent", manualLock: true }), row({ source: "manual", manualLock: false })]) {
      const db = database(current);
      await expect(new DrizzleCategoryRegistryRepository(db.database as never).unlockAssignment({ workspaceId,
        assignmentId, expectedVersion: 4, nextId, evidence: [{ kind: "manual_unlock", ref: "reader_owner" }] }))
        .rejects.toMatchObject({ code: "manual_lock" });
      expect(db.tx.update).not.toHaveBeenCalled();
      expect(db.tx.insert).not.toHaveBeenCalled();
    }
  });
});
