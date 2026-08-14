import { createHash, randomBytes } from "node:crypto";

import type {
  ApprovalDecisionKind,
  HumanPresenceAuthorizationPort,
  HumanPresenceEvidence,
} from "@/application/approval-decision-service";

type Challenge = Readonly<{
  digest: string;
  workspaceId: string;
  actorRef: string;
  unitRef: string;
  action: HumanPresenceAction;
  issuedAt: string;
  expiresAt: string;
}>;

export class HumanPresenceChallengeError extends Error {
  constructor() {
    super("İnsan varlığı kanıtı reddedildi");
    this.name = "HumanPresenceChallengeError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIT_REF = /^(?:action|policy)_unit_[a-f0-9]{20}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const PROOF = /^presence_[A-Za-z0-9_-]{32,160}$/;
const ACTIONS = Object.freeze([
  "approve", "reject", "request_changes", "admit_execution", "publish_approval_policy", "publish_guardrail_policy",
] as const);

export type HumanPresenceAction = typeof ACTIONS[number];

function rejected(): never { throw new HumanPresenceChallengeError(); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

/**
 * Process-local adapter for a future OS/UI human-presence ceremony. `issue`
 * must only be called after that ceremony succeeds. The decision path receives
 * only an opaque, action-bound proof and consumes it exactly once.
 */
export class SingleUseHumanPresenceChallengeStore implements HumanPresenceAuthorizationPort {
  private readonly challenges = new Map<string, Challenge>();
  private static readonly MAX_OUTSTANDING = 128;

  issue(input: Readonly<{
    workspaceId: string;
    actorRef: string;
    unitRef: string;
    action: HumanPresenceAction;
    now: string;
    lifetimeSeconds?: number;
  }>): Readonly<{ proof: string; expiresAt: string }> {
    const now = Date.parse(input.now);
    const lifetime = input.lifetimeSeconds ?? 60;
    if (!UUID.test(input.workspaceId) || !REF.test(input.actorRef) || !UNIT_REF.test(input.unitRef)
      || !ACTIONS.includes(input.action)
      || !Number.isFinite(now) || new Date(now).toISOString() !== input.now
      || !Number.isSafeInteger(lifetime) || lifetime < 10 || lifetime > 120) rejected();
    const proof = `presence_${randomBytes(32).toString("base64url")}`;
    const proofDigest = digest(proof);
    const expiresAt = new Date(now + lifetime * 1_000).toISOString();
    for (const [key, challenge] of this.challenges) {
      if (Date.parse(challenge.expiresAt) <= now) this.challenges.delete(key);
    }
    if (this.challenges.size >= SingleUseHumanPresenceChallengeStore.MAX_OUTSTANDING) rejected();
    this.challenges.set(proofDigest, Object.freeze({
      digest: proofDigest,
      workspaceId: input.workspaceId.toLowerCase(),
      actorRef: input.actorRef,
      unitRef: input.unitRef,
      action: input.action,
      issuedAt: input.now,
      expiresAt,
    }));
    return Object.freeze({ proof, expiresAt });
  }

  async consume(input: Readonly<{
    proof: string;
    workspaceId: string;
    actorRef: string;
    unitRef: string;
    action: HumanPresenceAction;
    now: string;
  }>): Promise<HumanPresenceEvidence> {
    if (!PROOF.test(input.proof)) rejected();
    const proofDigest = digest(input.proof);
    const challenge = this.challenges.get(proofDigest);
    // Delete before any validation: a found proof is single-use even when a
    // caller attempts it against the wrong action or identity.
    if (challenge) this.challenges.delete(proofDigest);
    const now = Date.parse(input.now);
    if (!challenge || challenge.digest !== proofDigest || challenge.workspaceId !== input.workspaceId.toLowerCase()
      || challenge.actorRef !== input.actorRef || challenge.unitRef !== input.unitRef || challenge.action !== input.action
      || !Number.isFinite(now) || now < Date.parse(challenge.issuedAt) || now >= Date.parse(challenge.expiresAt)) rejected();
    return Object.freeze({
      authorizationRef: `presence_auth_${proofDigest.slice(0, 32)}`,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
      humanPresence: true as const,
      canExecute: false as const,
    });
  }
}
