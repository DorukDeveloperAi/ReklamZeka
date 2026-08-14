import { createHash } from "node:crypto";
import type { CanonicalMetaAssetMirrorSnapshot } from "@/domain/meta/asset-mirror";

export const META_ACCOUNT_READ_CAPABILITY_VERSION = "meta-account-capability/1.0.0" as const;

export type MetaAccountReadCapabilityEvidence = Readonly<{
  schemaVersion: typeof META_ACCOUNT_READ_CAPABILITY_VERSION;
  checkedAt: string;
  sourceSnapshotHash: string;
  sourceStatus: "verified" | "empty" | "permission_missing" | "unsupported" | "unavailable";
  canReadAccount: boolean;
  capabilities: Readonly<{
    canRead: boolean;
    canPlan: boolean;
    canPublish: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
  }>;
}>;

export type MetaAccountReadCapabilityRecord = Readonly<{
  externalAccountId: string;
  permissionSnapshot: readonly string[];
  capabilitySnapshot: MetaAccountReadCapabilityEvidence;
}>;

export class MetaAccountReadCapabilityEvidenceError extends Error {
  constructor(readonly code: "invalid_snapshot" | "ambiguous_discovery") {
    super(`Meta account read capability evidence rejected: ${code}`);
    this.name = "MetaAccountReadCapabilityEvidenceError";
  }
}

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

/**
 * Projects the one authoritative account-list discovery from an already
 * canonical asset snapshot. It never infers a permission from an absent or
 * unrelated asset edge, and it intentionally contains no Meta write ability.
 */
export function deriveMetaAccountReadCapabilityEvidence(
  snapshot: CanonicalMetaAssetMirrorSnapshot,
  candidateExternalAccountIds: readonly string[] = snapshot.adAccountExternalIds,
): readonly MetaAccountReadCapabilityRecord[] {
  const discoveries = snapshot.discoveries.filter((entry) =>
    entry.resource === "ad_accounts" && entry.sourceType === "connection" && entry.sourceExternalId === null);
  if (discoveries.length !== 1) throw new MetaAccountReadCapabilityEvidenceError("ambiguous_discovery");
  const discovery = discoveries[0]!;
  if (!Number.isFinite(Date.parse(snapshot.fetchedAt)) || !/^[a-f0-9]{64}$/.test(snapshot.snapshotHash)
    || discovery.provenance.fetchedAt !== snapshot.fetchedAt) throw new MetaAccountReadCapabilityEvidenceError("invalid_snapshot");
  const canReadAccount = discovery.status === "verified";
  const capabilitySnapshot = Object.freeze({ schemaVersion: META_ACCOUNT_READ_CAPABILITY_VERSION,
    checkedAt: snapshot.fetchedAt, sourceSnapshotHash: snapshot.snapshotHash, sourceStatus: discovery.status,
    canReadAccount, capabilities: Object.freeze({ canRead: canReadAccount, canPlan: canReadAccount,
      canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
  const discoveredAccountIds = new Set(snapshot.adAccountExternalIds);
  return Object.freeze([...new Set(candidateExternalAccountIds)].sort().map((externalAccountId) => Object.freeze({
    externalAccountId,
    permissionSnapshot: Object.freeze(canReadAccount && discoveredAccountIds.has(externalAccountId) ? ["ads_read"] : []),
    capabilitySnapshot: Object.freeze({ ...capabilitySnapshot,
      canReadAccount: canReadAccount && discoveredAccountIds.has(externalAccountId),
      capabilities: Object.freeze({ ...capabilitySnapshot.capabilities,
        canRead: canReadAccount && discoveredAccountIds.has(externalAccountId),
        canPlan: canReadAccount && discoveredAccountIds.has(externalAccountId) }) }),
  })));
}

/** A deterministic evidence identity for idempotent persistence and tests. */
export function metaAccountReadCapabilityEvidenceHash(value: MetaAccountReadCapabilityEvidence): string {
  return hash(value);
}
