import { createHash } from "node:crypto";

export const META_PORTFOLIO_CAPABILITY_VERSION = "meta-portfolio-capability/1.0.0" as const;

export type MetaPortfolioConnectionFact = Readonly<{
  id: string;
  displayName: string;
  status: "active" | "disconnected" | "revoked" | "invalid";
  accessMode: "read_only";
  grantedScopes: readonly string[];
  enabledCapabilities: readonly string[];
  capabilityCheckedAt: string | null;
}>;

export type MetaPortfolioAccountFact = Readonly<{
  id: string;
  connectionId: string;
  name: string;
  currency: string;
  timezone: string;
  spendCapMinor: number | null;
  disappearedAt: string | null;
  permissionSnapshot: readonly string[] | null;
  capabilitySnapshot: Record<string, unknown> | null;
  groupRefs: readonly string[];
}>;

type AccountReadCapabilityEvidence = Readonly<{
  schemaVersion: "meta-account-capability/1.0.0";
  checkedAt: string;
  canReadAccount: boolean;
}>;

export type MetaPortfolioCapability = Readonly<{
  version: typeof META_PORTFOLIO_CAPABILITY_VERSION;
  connections: readonly Readonly<{
    connectionRef: string;
    displayName: string;
    status: MetaPortfolioConnectionFact["status"];
    readReady: boolean;
    accountCount: number;
  }>[];
  accounts: readonly Readonly<{
    accountRef: string;
    connectionRef: string;
    name: string;
    currency: string;
    timezone: string;
    spendCapMinor: number | null;
    groupRefs: readonly string[];
    readReadiness: "ready" | "partial" | "unavailable";
    reasonCodes: readonly string[];
    capabilities: Readonly<{
      canRead: boolean;
      canPlan: boolean;
      canPublish: false;
      canApprove: false;
      canExecute: false;
      canWriteMeta: false;
    }>;
  }>[];
}>;

export class MetaPortfolioCapabilityError extends Error {
  constructor(readonly code: "invalid_input" | "corrupt_store" | "scope_mismatch" | "cap_exceeded") {
    super(`Meta portfolio capability rejected: ${code}`);
    this.name = "MetaPortfolioCapabilityError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const MAX_CONNECTIONS = 100;
const MAX_ACCOUNTS = 1_000;

function fail(code: MetaPortfolioCapabilityError["code"]): never { throw new MetaPortfolioCapabilityError(code); }
function opaqueRef(kind: "meta_connection" | "ad_account", workspaceId: string, id: string): string {
  return `${kind}_${createHash("sha256").update(`${workspaceId}\u0000${id}`).digest("hex").slice(0, 24)}`;
}
function exactStringList(value: readonly string[] | null, code: MetaPortfolioCapabilityError["code"]): readonly string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 128)) fail(code);
  return Object.freeze([...new Set(value.map((entry) => entry.trim()))].sort());
}
function iso(value: string | null, code: MetaPortfolioCapabilityError["code"]): string | null {
  if (value === null) return null;
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(code);
  return value;
}
function accountReadEvidence(value: Record<string, unknown> | null): AccountReadCapabilityEvidence | null {
  if (value === null || value.schemaVersion !== "meta-account-capability/1.0.0"
    || typeof value.checkedAt !== "string" || typeof value.canReadAccount !== "boolean") return null;
  try { iso(value.checkedAt, "corrupt_store"); } catch { return null; }
  return Object.freeze({ schemaVersion: "meta-account-capability/1.0.0", checkedAt: value.checkedAt, canReadAccount: value.canReadAccount });
}

/**
 * Builds a public-safe, read-only portfolio model. Account groups are merely
 * shared context labels: a group never changes the permission or capability of
 * an individual Meta account.
 */
export function buildMetaPortfolioCapability(input: Readonly<{
  workspaceId: string;
  connections: readonly MetaPortfolioConnectionFact[];
  accounts: readonly MetaPortfolioAccountFact[];
}>): MetaPortfolioCapability {
  if (typeof input.workspaceId !== "string" || !input.workspaceId) fail("invalid_input");
  if (!Array.isArray(input.connections) || !Array.isArray(input.accounts)) fail("invalid_input");
  if (input.connections.length > MAX_CONNECTIONS || input.accounts.length > MAX_ACCOUNTS) fail("cap_exceeded");
  const connections = new Map<string, MetaPortfolioConnectionFact>();
  for (const connection of input.connections) {
    if (!connection || typeof connection.id !== "string" || !connection.id || connections.has(connection.id)
      || typeof connection.displayName !== "string" || !connection.displayName.trim() || connection.displayName.length > 256
      || !["active", "disconnected", "revoked", "invalid"].includes(connection.status) || connection.accessMode !== "read_only") fail("corrupt_store");
    exactStringList(connection.grantedScopes, "corrupt_store");
    exactStringList(connection.enabledCapabilities, "corrupt_store");
    iso(connection.capabilityCheckedAt, "corrupt_store");
    connections.set(connection.id, connection);
  }
  const accountIds = new Set<string>();
  const normalizedAccounts = input.accounts.map((account) => {
    if (!account || typeof account.id !== "string" || !account.id || accountIds.has(account.id)
      || !connections.has(account.connectionId) || typeof account.name !== "string" || !account.name.trim() || account.name.length > 256
      || typeof account.currency !== "string" || !/^[A-Z]{3}$/.test(account.currency)
      || typeof account.timezone !== "string" || !account.timezone.trim() || account.timezone.length > 128
      || account.spendCapMinor !== null && (!Number.isSafeInteger(account.spendCapMinor) || account.spendCapMinor < 0)
      || account.capabilitySnapshot !== null && (typeof account.capabilitySnapshot !== "object" || Array.isArray(account.capabilitySnapshot))) fail("corrupt_store");
    accountIds.add(account.id);
    const groupRefs = exactStringList(account.groupRefs, "corrupt_store");
    if (!groupRefs || groupRefs.some((groupRef) => !REF.test(groupRef) || !groupRef.startsWith("account_group_"))) fail("corrupt_store");
    return Object.freeze({ ...account, groupRefs, permissionSnapshot: exactStringList(account.permissionSnapshot, "corrupt_store"), disappearedAt: iso(account.disappearedAt, "corrupt_store") });
  });

  const accountsByConnection = new Map<string, number>();
  const accounts = normalizedAccounts.map((account) => {
    const connection = connections.get(account.connectionId)!;
    accountsByConnection.set(account.connectionId, (accountsByConnection.get(account.connectionId) ?? 0) + 1);
    const hasConnectionReadScope = connection.grantedScopes.includes("ads_read") && connection.enabledCapabilities.includes("accounts.read");
    const hasAccountPermissions = account.permissionSnapshot?.includes("ads_read") === true;
    const hasAccountCapabilities = accountReadEvidence(account.capabilitySnapshot)?.canReadAccount === true;
    const reasonCodes = [
      ...(connection.status !== "active" ? ["connection_not_active"] : []),
      ...(account.disappearedAt !== null ? ["account_disappeared"] : []),
      ...(!hasConnectionReadScope ? ["connection_read_scope_not_verified"] : []),
      ...(!hasAccountPermissions ? ["account_permission_not_observed"] : []),
      ...(!hasAccountCapabilities ? ["account_capability_not_observed"] : []),
    ];
    const canRead = reasonCodes.length === 0;
    const readReadiness = canRead ? "ready" as const : connection.status !== "active" || account.disappearedAt !== null
      ? "unavailable" as const : "partial" as const;
    return Object.freeze({ accountRef: opaqueRef("ad_account", input.workspaceId, account.id),
      connectionRef: opaqueRef("meta_connection", input.workspaceId, account.connectionId), name: account.name,
      currency: account.currency, timezone: account.timezone, spendCapMinor: account.spendCapMinor,
      groupRefs: account.groupRefs, readReadiness, reasonCodes: Object.freeze(reasonCodes),
      capabilities: Object.freeze({ canRead, canPlan: canRead, canPublish: false as const, canApprove: false as const,
        canExecute: false as const, canWriteMeta: false as const }) });
  }).sort((left, right) => left.accountRef.localeCompare(right.accountRef));

  const publicConnections = [...connections.values()].map((connection) => Object.freeze({
    connectionRef: opaqueRef("meta_connection", input.workspaceId, connection.id), displayName: connection.displayName,
    status: connection.status, readReady: connection.status === "active" && connection.capabilityCheckedAt !== null,
    accountCount: accountsByConnection.get(connection.id) ?? 0,
  })).sort((left, right) => left.connectionRef.localeCompare(right.connectionRef));
  return Object.freeze({ version: META_PORTFOLIO_CAPABILITY_VERSION, connections: Object.freeze(publicConnections), accounts: Object.freeze(accounts) });
}
