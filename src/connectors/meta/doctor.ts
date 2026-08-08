import { ConnectorError } from "@/connectors/contract";
import { META_GRAPH_API_VERSION, MetaGraphClient, type MetaFetch } from "./graph-client";
import {
  META_MANAGEMENT_CAPABILITIES,
  META_READ_CAPABILITIES,
  type MetaCapabilityEvidence,
  type MetaCapabilitySnapshot,
  type MetaManagementCapability,
  type MetaReadCapability,
} from "./connection-types";

type DebugTokenResponse = Readonly<{
  data?: Readonly<{
    is_valid?: boolean;
    scopes?: readonly string[];
    expires_at?: number;
    data_access_expires_at?: number;
  }>;
}>;

type PrincipalResponse = Readonly<{ id?: string; name?: string }>;
type AccountSummaryResponse = Readonly<{
  data?: readonly unknown[];
  summary?: Readonly<{ total_count?: number }>;
}>;

const MANAGEMENT_SCOPES: Readonly<Record<MetaManagementCapability, readonly string[]>> = {
  "ads.write": ["ads_management"],
  "pages.ads.write": ["pages_manage_ads"],
};

const READ_SCOPES: Readonly<Record<MetaReadCapability, readonly string[]>> = {
  "token.inspect": [],
  "profile.read": [],
  "accounts.read": ["ads_read", "ads_management"],
  "pages.read": ["pages_show_list"],
  "instagram.read": ["pages_show_list"],
  "campaign_hierarchy.read": ["ads_read", "ads_management"],
  "ad_copy.read": ["ads_read", "ads_management"],
  "insights.read": ["ads_read", "ads_management"],
};

function isoFromUnix(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value)) return null;
  return new Date(value * 1_000).toISOString();
}

function expiryStatus(expiresAt: string | null, now: Date): MetaCapabilitySnapshot["expiryStatus"] {
  if (!expiresAt) return "unknown";
  const remaining = Date.parse(expiresAt) - now.getTime();
  if (remaining <= 0) return "expired";
  return remaining <= 14 * 24 * 60 * 60_000 ? "expiring" : "healthy";
}

function hasAnyScope(scopes: readonly string[], required: readonly string[]): boolean {
  return required.length === 0 || required.some((scope) => scopes.includes(scope));
}

function capabilities(scopes: readonly string[]): readonly MetaCapabilityEvidence[] {
  const read = META_READ_CAPABILITIES.map((capability): MetaCapabilityEvidence => ({
    capability,
    granted: hasAnyScope(scopes, READ_SCOPES[capability]),
    verified: capability === "token.inspect" || capability === "profile.read" || capability === "accounts.read",
    enabled: true,
    reason: "ReklamZeka read connector allowlist'inde etkin",
  }));
  const management = META_MANAGEMENT_CAPABILITIES.map((capability): MetaCapabilityEvidence => ({
    capability,
    granted: hasAnyScope(scopes, MANAGEMENT_SCOPES[capability]),
    verified: false,
    enabled: false,
    reason: "Token grant'i ayrı izlenir; writer A13'e kadar runtime'da yok",
  }));
  return [...read, ...management];
}

export type MetaConnectionDoctorOptions = Readonly<{
  token: string;
  graphApiVersion?: string;
  fetchImpl?: MetaFetch;
  now?: () => Date;
}>;

export async function inspectMetaConnection(options: MetaConnectionDoctorOptions): Promise<MetaCapabilitySnapshot> {
  const now = options.now?.() ?? new Date();
  const client = new MetaGraphClient(options.token, options.fetchImpl, {
    graphApiVersion: options.graphApiVersion ?? META_GRAPH_API_VERSION,
  });

  const debug = await client.get<DebugTokenResponse>("/debug_token", { input_token: options.token });
  if (!debug.data?.is_valid) throw new ConnectorError("authentication", "Meta token geçersiz veya süresi dolmuş", false);
  const scopes = [...(debug.data.scopes ?? [])].sort();
  const expiresAt = isoFromUnix(debug.data.expires_at);
  const status = expiryStatus(expiresAt, now);
  if (status === "expired") throw new ConnectorError("authentication", "Meta token geçersiz veya süresi dolmuş", false);
  const [principal, accounts] = await Promise.all([
    client.get<PrincipalResponse>("/me", { fields: "id,name" }),
    client.get<AccountSummaryResponse>("/me/adaccounts", { fields: "id", limit: "1", summary: "true" }),
  ]);
  if (!principal.id) throw new ConnectorError("invalid_data", "Meta principal kimliği okunamadı", false);

  return Object.freeze({
    capturedAt: now.toISOString(),
    graphApiVersion: client.graphApiVersion,
    tokenStatus: "valid",
    expiryStatus: status,
    expiresAt,
    dataAccessExpiresAt: isoFromUnix(debug.data.data_access_expires_at),
    grantedScopes: Object.freeze(scopes),
    capabilities: Object.freeze(capabilities(scopes)),
    accessibleAdAccountCount: accounts.summary?.total_count ?? accounts.data?.length ?? 0,
    principal: Object.freeze({ id: principal.id, name: principal.name ?? null }),
  });
}
