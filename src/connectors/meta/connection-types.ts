export const META_READ_CAPABILITIES = [
  "token.inspect",
  "profile.read",
  "accounts.read",
  "pages.read",
  "instagram.read",
  "campaign_hierarchy.read",
  "ad_copy.read",
  "insights.read",
] as const;

export const META_MANAGEMENT_CAPABILITIES = [
  "ads.write",
  "pages.ads.write",
] as const;

export type MetaReadCapability = typeof META_READ_CAPABILITIES[number];
export type MetaManagementCapability = typeof META_MANAGEMENT_CAPABILITIES[number];
export type MetaCapability = MetaReadCapability | MetaManagementCapability;

export type MetaSecretReference = Readonly<{
  id: string;
  provider: "environment" | "memory";
  keyVersion: number;
  bindingName?: string;
}>;

export type MetaCapabilityEvidence = Readonly<{
  capability: MetaCapability;
  granted: boolean;
  verified: boolean;
  enabled: boolean;
  reason: string;
}>;

export type MetaCapabilitySnapshot = Readonly<{
  capturedAt: string;
  graphApiVersion: string;
  tokenStatus: "valid" | "invalid";
  expiryStatus: "healthy" | "expiring" | "expired" | "unknown";
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
  grantedScopes: readonly string[];
  capabilities: readonly MetaCapabilityEvidence[];
  accessibleAdAccountCount: number;
  principal: Readonly<{ id: string; name: string | null }>;
}>;

export type MetaConnectionStatus = "active" | "disconnected" | "revoked" | "invalid";

export type MetaConnection = Readonly<{
  id: string;
  workspaceId: string;
  displayName: string;
  graphApiVersion: string;
  accessMode: "read_only";
  status: MetaConnectionStatus;
  lifecycleGeneration: number;
  secretReference: MetaSecretReference;
  capabilitySnapshot: MetaCapabilitySnapshot | null;
  createdAt: string;
  updatedAt: string;
  disconnectedAt: string | null;
  revokedAt: string | null;
}>;

export type PublicMetaConnection = Omit<MetaConnection, "secretReference" | "capabilitySnapshot"> & Readonly<{
  secretConfigured: boolean;
  capabilitySnapshot: MetaCapabilitySnapshot | null;
}>;

export function publicMetaConnection(connection: MetaConnection): PublicMetaConnection {
  const { secretReference: _secretReference, capabilitySnapshot, ...safe } = connection;
  const publicSnapshot = capabilitySnapshot ? {
    ...capabilitySnapshot,
    principal: {
      ...capabilitySnapshot.principal,
      id: maskExternalId(capabilitySnapshot.principal.id),
    },
  } : null;
  return { ...safe, capabilitySnapshot: publicSnapshot, secretConfigured: connection.status === "active" };
}

function maskExternalId(value: string): string {
  if (value.length <= 4) return "…";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
