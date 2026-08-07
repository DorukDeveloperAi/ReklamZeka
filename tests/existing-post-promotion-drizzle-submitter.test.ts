import { describe, expect, it, vi } from "vitest";

import { ExistingPostPromotionDrizzleSubmitterError,
  createDrizzleExistingPostPromotionCanonicalSubmitter } from
  "@/server/existing-post-promotion-drizzle-submitter";

const principal = Object.freeze({ actor: Object.freeze({ userId: "11111111-1111-4111-a111-111111111111" }),
  workspaceId: "22222222-2222-4222-a222-222222222222", workspaceRef: "workspace_alpha",
  readerRef: "actor_local_owner" });
const membership = Object.freeze({ userId: principal.actor.userId, workspaceId: principal.workspaceId,
  role: "owner" as const });

describe("request-bound existing-post Drizzle submitter composition", () => {
  it("constructs without DB/network work and exposes only the canonical submit operation", () => {
    const database = Object.freeze({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), execute: vi.fn(),
      transaction: vi.fn() });
    const submitter = createDrizzleExistingPostPromotionCanonicalSubmitter({ database: database as never,
      principal, membership });
    expect(database.select).not.toHaveBeenCalled(); expect(database.execute).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(submitter)).sort()).toEqual(["constructor", "submitResolved"]);
  });

  it("rejects a mismatched membership before constructing tenant repositories", () => {
    const database = Object.freeze({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), execute: vi.fn(),
      transaction: vi.fn() });
    try {
      createDrizzleExistingPostPromotionCanonicalSubmitter({ database: database as never, principal,
        membership: { ...membership, workspaceId: "33333333-3333-4333-a333-333333333333" } });
      throw new Error("expected rejection");
    } catch (reason) {
      expect(reason).toEqual(new ExistingPostPromotionDrizzleSubmitterError("invalid_binding"));
    }
    expect(database.execute).not.toHaveBeenCalled(); expect(database.transaction).not.toHaveBeenCalled();
  });
});
