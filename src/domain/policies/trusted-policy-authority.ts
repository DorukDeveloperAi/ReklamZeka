/**
 * Server-private proof that a policy authority composition input was read from
 * the tenant-scoped authority repository.  This deliberately is not a general
 * purpose "authority" object: every action and write capability remains false.
 */
export const TRUSTED_POLICY_AUTHORITY_SNAPSHOT_VERSION = "tenant-authority-snapshot/1.0.0" as const;

export type RepositoryVerifiedPolicyAuthoritySnapshot = Readonly<{
  schemaVersion: typeof TRUSTED_POLICY_AUTHORITY_SNAPSHOT_VERSION;
  workspaceId: string;
  workspaceRef: string;
  snapshotRef: string;
  snapshotHash: string;
  repositoryRef: string;
  repositoryRevision: string;
  catalogHash: string;
  scopeHash: string;
  verifiedAt: string;
  expiresAt: string;
}>;
