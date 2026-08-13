import { createHash } from "node:crypto";

export const META_READ_MIRROR_PROJECTION_VERSION = "meta-read-mirror-projection/1.0.0" as const;

export type MetaReadMirrorFact = Readonly<{
  connectionId: string;
  connectionName: string;
  connectionStatus: "active" | "disconnected" | "revoked" | "invalid";
  accessMode: "read_only";
  accountId: string | null;
  accountName: string | null;
  currency: string | null;
  timezone: string | null;
  accountFetchedAt: string | null;
  inventoryStreamStatus: "pending" | "running" | "partial" | "completed" | "failed" | "cancelled" | null;
  inventoryStreamUpdatedAt: string | null;
  creativeStreamStatus: "pending" | "running" | "partial" | "completed" | "failed" | "cancelled" | null;
  creativeStreamUpdatedAt: string | null;
  campaignId: string | null;
  campaignName: string | null;
  campaignStatus: string | null;
  campaignObjective: string | null;
  campaignDailyBudgetMinor: number | null;
  campaignLifetimeBudgetMinor: number | null;
  campaignFetchedAt: string | null;
  adSetId: string | null;
  adSetName: string | null;
  adSetStatus: string | null;
  optimizationGoal: string | null;
  targetingSummary: Record<string, unknown> | null;
  adSetDailyBudgetMinor: number | null;
  adSetLifetimeBudgetMinor: number | null;
  adSetFetchedAt: string | null;
  adId: string | null;
  adName: string | null;
  adStatus: string | null;
  adFetchedAt: string | null;
  creativeId: string | null;
  creativeName: string | null;
  creativeSourceType: string | null;
  primaryText: string | null;
  headline: string | null;
  description: string | null;
  caption: string | null;
  callToActionType: string | null;
  destinationUrl: string | null;
  creativeFormat: string | null;
  creativeFetchedAt: string | null;
  postId: string | null;
  postMediaType: string | null;
  postPermalink: string | null;
  postMessage: string | null;
  postCaption: string | null;
  postPublishedAt: string | null;
  postFetchedAt: string | null;
}>;

export type MetaReadMirrorProjection = Readonly<{
  version: typeof META_READ_MIRROR_PROJECTION_VERSION;
  sourceState: "ready" | "partial" | "stale" | "empty" | "unavailable";
  observedAt: string;
  latestCanonicalObservationAt: string | null;
  freshnessAgeMinutes: number | null;
  freshnessThresholdMinutes: number;
  reasonCodes: readonly string[];
  summary: Readonly<{ connections: number; accounts: number; campaigns: number; adSets: number; ads: number; creatives: number; posts: number }>;
  authority: Readonly<{
    actionAuthority: "none";
    canPublish: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
  }>;
  connections: readonly MetaReadMirrorConnection[];
}>;

export type MetaReadMirrorConnection = Readonly<{
  connectionRef: string;
  name: string;
  status: MetaReadMirrorFact["connectionStatus"];
  accessMode: "read_only";
  accounts: readonly MetaReadMirrorAccount[];
}>;

export type MetaReadMirrorAccount = Readonly<{
  accountRef: string;
  name: string;
  currency: string;
  timezone: string;
  freshness: Readonly<{
    inventoryStatus: MetaReadMirrorFact["inventoryStreamStatus"];
    creativeStatus: MetaReadMirrorFact["creativeStreamStatus"];
    latestObservedAt: string | null;
  }>;
  campaigns: readonly MetaReadMirrorCampaign[];
}>;

export type MetaReadMirrorCampaign = Readonly<{
  campaignRef: string;
  name: string;
  status: string | null;
  objective: string | null;
  budget: Readonly<{ owner: "campaign" | "ad_set" | "unknown"; dailyMinor: number | null; lifetimeMinor: number | null }>;
  fetchedAt: string;
  adSets: readonly MetaReadMirrorAdSet[];
}>;

export type MetaReadMirrorAdSet = Readonly<{
  adSetRef: string;
  name: string;
  status: string | null;
  optimizationGoal: string | null;
  targetingSummary: Record<string, unknown> | null;
  budget: Readonly<{ owner: "ad_set" | "campaign" | "unknown"; dailyMinor: number | null; lifetimeMinor: number | null }>;
  fetchedAt: string;
  ads: readonly MetaReadMirrorAd[];
}>;

export type MetaReadMirrorAd = Readonly<{
  adRef: string;
  name: string;
  status: string | null;
  fetchedAt: string;
  creative: Readonly<{
    creativeRef: string;
    name: string | null;
    sourceType: string;
    primaryText: string | null;
    headline: string | null;
    description: string | null;
    caption: string | null;
    callToActionType: string | null;
    destinationUrl: string | null;
    format: string | null;
    fetchedAt: string;
    post: Readonly<{
      postRef: string;
      mediaType: string | null;
      permalink: string | null;
      message: string | null;
      caption: string | null;
      publishedAt: string | null;
      fetchedAt: string;
    }> | null;
  }> | null;
}>;

export class MetaReadMirrorProjectionError extends Error {
  constructor(readonly code: "invalid_input" | "corrupt_store" | "cap_exceeded") {
    super(`Meta read mirror projection rejected: ${code}`);
    this.name = "MetaReadMirrorProjectionError";
  }
}

const MAX_ROWS = 5_000;
const STREAM_READY = new Set(["completed"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code: MetaReadMirrorProjectionError["code"]): never { throw new MetaReadMirrorProjectionError(code); }
function ref(kind: "connection" | "account" | "campaign" | "ad_set" | "ad" | "creative" | "post", workspaceId: string, id: string): string {
  return `${kind}_${createHash("sha256").update(`${workspaceId}\u0000${kind}\u0000${id}`).digest("hex").slice(0, 24)}`;
}
function iso(value: string | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("corrupt_store");
  return value;
}
function required(value: string | null): string {
  if (typeof value !== "string" || !value.trim()) fail("corrupt_store");
  return value;
}
function minor(value: number | null): number | null {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) fail("corrupt_store");
  return value;
}
function maxIso(values: readonly (string | null)[]): string | null {
  const present = values.filter((value): value is string => value !== null).map((value) => iso(value)!);
  return present.length === 0 ? null : present.reduce((latest, value) => value > latest ? value : latest);
}

type MutableAdSet = Omit<MetaReadMirrorAdSet, "ads"> & { ads: MetaReadMirrorAd[] };
type MutableCampaign = Omit<MetaReadMirrorCampaign, "adSets"> & { adSets: MutableAdSet[] };
type MutableAccount = Omit<MetaReadMirrorAccount, "campaigns"> & { campaigns: MutableCampaign[] };
type MutableConnection = Omit<MetaReadMirrorConnection, "accounts"> & { accounts: MutableAccount[] };

export function buildMetaReadMirrorProjection(input: Readonly<{
  workspaceId: string;
  facts: readonly MetaReadMirrorFact[];
  observedAt: string;
  freshnessThresholdMinutes?: number;
  limitReached?: boolean;
}>): MetaReadMirrorProjection {
  if (!UUID.test(input.workspaceId) || !Array.isArray(input.facts) || input.facts.length > MAX_ROWS) fail("invalid_input");
  const observedAt = required(iso(input.observedAt));
  const threshold = input.freshnessThresholdMinutes ?? 24 * 60;
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 30 * 24 * 60) fail("invalid_input");

  const connections = new Map<string, MutableConnection>();
  const accountMaps = new Map<string, Map<string, MutableAccount>>();
  const campaignMaps = new Map<string, Map<string, MutableCampaign>>();
  const adSetMaps = new Map<string, Map<string, MutableAdSet>>();
  const adIds = new Set<string>();
  const creativeIds = new Set<string>();
  const postIds = new Set<string>();
  const latestCandidates: Array<string | null> = [];
  const reasonCodes = new Set<string>();

  for (const fact of input.facts) {
    const connectionId = required(fact.connectionId);
    const connectionName = required(fact.connectionName);
    if (fact.accessMode !== "read_only" || !["active", "disconnected", "revoked", "invalid"].includes(fact.connectionStatus)) fail("corrupt_store");
    let connection = connections.get(connectionId);
    if (!connection) {
      connection = { connectionRef: ref("connection", input.workspaceId, connectionId), name: connectionName,
        status: fact.connectionStatus, accessMode: "read_only", accounts: [] };
      connections.set(connectionId, connection);
      accountMaps.set(connectionId, new Map());
    } else if (connection.name !== connectionName || connection.status !== fact.connectionStatus) fail("corrupt_store");
    if (fact.connectionStatus !== "active") reasonCodes.add("connection_not_active");
    if (fact.accountId === null) continue;

    const accountId = required(fact.accountId);
    const accountName = required(fact.accountName);
    const currency = required(fact.currency);
    const timezone = required(fact.timezone);
    if (!/^[A-Z]{3}$/.test(currency)) fail("corrupt_store");
    const latestAccount = maxIso([fact.accountFetchedAt, fact.inventoryStreamUpdatedAt, fact.creativeStreamUpdatedAt]);
    latestCandidates.push(latestAccount);
    const accounts = accountMaps.get(connectionId)!;
    let account = accounts.get(accountId);
    if (!account) {
      account = { accountRef: ref("account", input.workspaceId, accountId), name: accountName, currency, timezone,
        freshness: { inventoryStatus: fact.inventoryStreamStatus, creativeStatus: fact.creativeStreamStatus,
          latestObservedAt: latestAccount }, campaigns: [] };
      accounts.set(accountId, account);
      connection.accounts.push(account);
      campaignMaps.set(accountId, new Map());
    } else if (account.name !== accountName || account.currency !== currency || account.timezone !== timezone
      || account.freshness.inventoryStatus !== fact.inventoryStreamStatus || account.freshness.creativeStatus !== fact.creativeStreamStatus) fail("corrupt_store");
    if (!STREAM_READY.has(fact.inventoryStreamStatus ?? "") || !STREAM_READY.has(fact.creativeStreamStatus ?? "")) {
      reasonCodes.add("sync_stream_incomplete");
    }
    if (fact.campaignId === null) continue;

    const campaignId = required(fact.campaignId);
    const campaignFetchedAt = required(iso(fact.campaignFetchedAt));
    latestCandidates.push(campaignFetchedAt);
    const campaignDaily = minor(fact.campaignDailyBudgetMinor);
    const campaignLifetime = minor(fact.campaignLifetimeBudgetMinor);
    const campaigns = campaignMaps.get(accountId)!;
    let campaign = campaigns.get(campaignId);
    if (!campaign) {
      campaign = { campaignRef: ref("campaign", input.workspaceId, campaignId), name: required(fact.campaignName),
        status: fact.campaignStatus, objective: fact.campaignObjective,
        budget: { owner: campaignDaily !== null || campaignLifetime !== null ? "campaign" : "unknown",
          dailyMinor: campaignDaily, lifetimeMinor: campaignLifetime }, fetchedAt: campaignFetchedAt, adSets: [] };
      campaigns.set(campaignId, campaign);
      account.campaigns.push(campaign);
      adSetMaps.set(campaignId, new Map());
    }
    if (fact.adSetId === null) continue;

    const adSetId = required(fact.adSetId);
    const adSetFetchedAt = required(iso(fact.adSetFetchedAt));
    latestCandidates.push(adSetFetchedAt);
    const adSetDaily = minor(fact.adSetDailyBudgetMinor);
    const adSetLifetime = minor(fact.adSetLifetimeBudgetMinor);
    const adSets = adSetMaps.get(campaignId)!;
    let adSet = adSets.get(adSetId);
    if (!adSet) {
      adSet = { adSetRef: ref("ad_set", input.workspaceId, adSetId), name: required(fact.adSetName), status: fact.adSetStatus,
        optimizationGoal: fact.optimizationGoal, targetingSummary: fact.targetingSummary,
        budget: { owner: adSetDaily !== null || adSetLifetime !== null ? "ad_set"
          : campaign.budget.owner === "campaign" ? "campaign" : "unknown", dailyMinor: adSetDaily, lifetimeMinor: adSetLifetime },
        fetchedAt: adSetFetchedAt, ads: [] };
      adSets.set(adSetId, adSet);
      campaign.adSets.push(adSet);
    }
    if (fact.adId === null) continue;

    const adId = required(fact.adId);
    const adFetchedAt = required(iso(fact.adFetchedAt));
    latestCandidates.push(adFetchedAt);
    if (adIds.has(adId)) continue;
    adIds.add(adId);
    let creative: MetaReadMirrorAd["creative"] = null;
    if (fact.creativeId !== null) {
      const creativeId = required(fact.creativeId);
      const creativeFetchedAt = required(iso(fact.creativeFetchedAt));
      latestCandidates.push(creativeFetchedAt);
      creativeIds.add(creativeId);
      let post: NonNullable<NonNullable<MetaReadMirrorAd["creative"]>["post"]> | null = null;
      if (fact.postId !== null) {
        const postId = required(fact.postId);
        const postFetchedAt = required(iso(fact.postFetchedAt));
        latestCandidates.push(postFetchedAt);
        postIds.add(postId);
        post = { postRef: ref("post", input.workspaceId, postId), mediaType: fact.postMediaType,
          permalink: fact.postPermalink, message: fact.postMessage, caption: fact.postCaption,
          publishedAt: iso(fact.postPublishedAt), fetchedAt: postFetchedAt };
      }
      creative = { creativeRef: ref("creative", input.workspaceId, creativeId), name: fact.creativeName,
        sourceType: required(fact.creativeSourceType), primaryText: fact.primaryText, headline: fact.headline,
        description: fact.description, caption: fact.caption, callToActionType: fact.callToActionType,
        destinationUrl: fact.destinationUrl, format: fact.creativeFormat, fetchedAt: creativeFetchedAt, post };
    } else reasonCodes.add("creative_binding_missing");
    adSet.ads.push({ adRef: ref("ad", input.workspaceId, adId), name: required(fact.adName),
      status: fact.adStatus, fetchedAt: adFetchedAt, creative });
  }

  for (const connection of connections.values()) {
    connection.accounts.sort((a, b) => a.name.localeCompare(b.name) || a.accountRef.localeCompare(b.accountRef));
    for (const account of connection.accounts) {
      account.campaigns.sort((a, b) => a.name.localeCompare(b.name) || a.campaignRef.localeCompare(b.campaignRef));
      for (const campaign of account.campaigns) {
        campaign.adSets.sort((a, b) => a.name.localeCompare(b.name) || a.adSetRef.localeCompare(b.adSetRef));
        for (const adSet of campaign.adSets) adSet.ads.sort((a, b) => a.name.localeCompare(b.name) || a.adRef.localeCompare(b.adRef));
      }
    }
  }
  if (input.limitReached) reasonCodes.add("projection_limit_reached");
  const connectionList = [...connections.values()].sort((a, b) => a.name.localeCompare(b.name) || a.connectionRef.localeCompare(b.connectionRef));
  const accounts = connectionList.flatMap((connection) => connection.accounts);
  const campaigns = accounts.flatMap((account) => account.campaigns);
  const adSets = campaigns.flatMap((campaign) => campaign.adSets);
  const latestCanonicalObservationAt = maxIso(latestCandidates);
  const freshnessAgeMinutes = latestCanonicalObservationAt === null ? null
    : Math.max(0, Math.floor((Date.parse(observedAt) - Date.parse(latestCanonicalObservationAt)) / 60_000));
  const hasActiveConnection = connectionList.some((connection) => connection.status === "active");
  let sourceState: MetaReadMirrorProjection["sourceState"];
  if (!hasActiveConnection || accounts.length === 0) {
    sourceState = "unavailable";
    reasonCodes.add(hasActiveConnection ? "account_source_unavailable" : "active_connection_unavailable");
  } else if (campaigns.length === 0) {
    sourceState = "empty";
    reasonCodes.add("canonical_hierarchy_empty");
  } else if (freshnessAgeMinutes === null || freshnessAgeMinutes > threshold) {
    sourceState = "stale";
    reasonCodes.add("canonical_observation_stale");
  } else if (reasonCodes.size > 0) sourceState = "partial";
  else sourceState = "ready";

  return Object.freeze({ version: META_READ_MIRROR_PROJECTION_VERSION, sourceState, observedAt,
    latestCanonicalObservationAt, freshnessAgeMinutes, freshnessThresholdMinutes: threshold,
    reasonCodes: Object.freeze([...reasonCodes].sort()),
    summary: Object.freeze({ connections: connectionList.length, accounts: accounts.length, campaigns: campaigns.length,
      adSets: adSets.length, ads: adIds.size, creatives: creativeIds.size, posts: postIds.size }),
    authority: Object.freeze({ actionAuthority: "none", canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false }),
    connections: Object.freeze(connectionList.map((connection) => Object.freeze({ ...connection,
      accounts: Object.freeze(connection.accounts.map((account) => Object.freeze({ ...account,
        campaigns: Object.freeze(account.campaigns.map((campaign) => Object.freeze({ ...campaign,
          adSets: Object.freeze(campaign.adSets.map((adSet) => Object.freeze({ ...adSet, ads: Object.freeze(adSet.ads) }))) }))) }))) }))) });
}
