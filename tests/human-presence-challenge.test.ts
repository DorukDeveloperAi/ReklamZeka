import { describe, expect, it } from "vitest";

import { HumanPresenceChallengeError, SingleUseHumanPresenceChallengeStore } from "@/security/human-presence-challenge";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const binding = Object.freeze({ workspaceId, actorRef: "actor_owner", unitRef: "action_unit_aaaaaaaaaaaaaaaaaaaa", action: "approve" as const });

describe("single-use human presence challenge", () => {
  it("binds proof to actor, workspace, unit and action and consumes it exactly once", async () => {
    const store = new SingleUseHumanPresenceChallengeStore();
    const challenge = store.issue({ ...binding, now: "2026-08-07T19:00:00.000Z", lifetimeSeconds: 60 });
    const evidence = await store.consume({ ...binding, proof: challenge.proof, now: "2026-08-07T19:00:01.000Z" });
    expect(evidence).toMatchObject({ humanPresence: true, canExecute: false, expiresAt: "2026-08-07T19:01:00.000Z" });
    await expect(store.consume({ ...binding, proof: challenge.proof, now: "2026-08-07T19:00:02.000Z" }))
      .rejects.toBeInstanceOf(HumanPresenceChallengeError);
  });

  it("burns a proof after a wrong actor/action attempt and rejects expired proof", async () => {
    const store = new SingleUseHumanPresenceChallengeStore();
    const wrong = store.issue({ ...binding, now: "2026-08-07T19:00:00.000Z" });
    await expect(store.consume({ ...binding, actorRef: "actor_admin", proof: wrong.proof, now: "2026-08-07T19:00:01.000Z" }))
      .rejects.toBeInstanceOf(HumanPresenceChallengeError);
    await expect(store.consume({ ...binding, proof: wrong.proof, now: "2026-08-07T19:00:02.000Z" }))
      .rejects.toBeInstanceOf(HumanPresenceChallengeError);

    const expired = store.issue({ ...binding, now: "2026-08-07T19:00:00.000Z", lifetimeSeconds: 10 });
    await expect(store.consume({ ...binding, proof: expired.proof, now: "2026-08-07T19:00:10.000Z" }))
      .rejects.toBeInstanceOf(HumanPresenceChallengeError);
  });
});
