import { ConnectorError } from "@/connectors/contract";
import { META_GRAPH_API_VERSION, MetaGraphClient, type MetaFetch } from "./graph-client";
import { AppendOnlyAuditLog } from "@/security/audit";
import type {
  MetaAdCopyExample,
  MetaInventoryAccount,
  MetaInventoryCapability,
  MetaInventoryPage,
  MetaInventorySnapshot,
} from "./types";

type DebugTokenResponse = Readonly<{
  data?: Readonly<{
    is_valid?: boolean;
    scopes?: readonly string[];
    expires_at?: number;
    data_access_expires_at?: number;
  }>;
}>;

type RawAccount = Readonly<{
  id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
  business?: Readonly<{ name?: string }>;
}>;

type RawPage = Readonly<{
  id?: string;
  name?: string;
  category?: string;
  followers_count?: number;
  link?: string;
  instagram_business_account?: Readonly<{ id?: string; username?: string; name?: string }>;
}>;

type RawCampaign = Readonly<{
  id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  objective?: string;
}>;

type RawAd = Readonly<{
  id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  creative?: Readonly<{
    title?: string;
    body?: string;
    instagram_permalink_url?: string;
    object_story_spec?: unknown;
  }>;
}>;

type RawInsight = Readonly<{ date_start?: string; date_stop?: string }>;

export type DiscoverMetaInventoryOptions = Readonly<{
  token: string;
  fetchImpl?: MetaFetch;
  now?: () => Date;
  securityStatus?: "temporary_exposed" | "standard";
}>;

const WRITE_SCOPES = new Set(["ads_management", "pages_manage_ads"]);
const metaInventoryAudit = new AppendOnlyAuditLog();
const READ_CAPABILITIES = [
  "token.inspect",
  "accounts.read",
  "pages.read",
  "instagram.read",
  "campaign_hierarchy.read",
  "ad_copy.read",
  "insights.read",
] as const;

export function maskMetaId(value: string): string {
  const prefix = value.startsWith("act_") ? "act_" : value.slice(0, 4);
  const raw = value.startsWith("act_") ? value.slice(4) : value;
  if (raw.length <= 4) return `${prefix}…`;
  return `${prefix}…${raw.slice(-4)}`;
}

function unixToIso(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value)) return null;
  return new Date(value * 1_000).toISOString();
}

function accountStatus(value: number | undefined): string {
  const labels: Record<number, string> = {
    1: "ACTIVE",
    2: "DISABLED",
    3: "UNSETTLED",
    7: "PENDING_RISK_REVIEW",
    8: "PENDING_SETTLEMENT",
    9: "IN_GRACE_PERIOD",
    100: "PENDING_CLOSURE",
    101: "CLOSED",
  };
  return value === undefined ? "UNKNOWN" : labels[value] ?? `STATUS_${value}`;
}

function storyCopy(value: unknown): Readonly<{ title: string | null; body: string | null }> {
  if (!value || typeof value !== "object") return { title: null, body: null };
  const story = value as {
    link_data?: { name?: string; message?: string };
    video_data?: { title?: string; message?: string };
  };
  return {
    title: story.link_data?.name ?? story.video_data?.title ?? null,
    body: story.link_data?.message ?? story.video_data?.message ?? null,
  };
}

function safeMessage(error: unknown): string {
  if (error instanceof ConnectorError) return error.message;
  return "Meta kaynağı okunamadı";
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  operation: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const result: R[] = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      result[index] = await operation(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return result;
}

function buildCapabilities(scopes: readonly string[], verified: ReadonlySet<string>): readonly MetaInventoryCapability[] {
  const has = (scope: string) => scopes.includes(scope);
  return [
    { id: "accounts.read", label: "Reklam hesapları", granted: has("ads_read") || has("ads_management"), verified: verified.has("accounts.read"), enabled: true, note: "Hesap adı, durum, para birimi ve saat dilimi" },
    { id: "pages.read", label: "Facebook sayfaları", granted: has("pages_show_list"), verified: verified.has("pages.read"), enabled: true, note: "Sayfa listesi ve herkese açık profil alanları" },
    { id: "instagram.read", label: "Bağlı Instagram", granted: has("pages_show_list"), verified: verified.has("instagram.read"), enabled: true, note: "Sayfaya bağlı profesyonel hesap ilişkisi" },
    { id: "campaign_hierarchy.read", label: "Kampanya hiyerarşisi", granted: has("ads_read") || has("ads_management"), verified: verified.has("campaign_hierarchy.read"), enabled: true, note: "Campaign → ad set → ad; salt okunur" },
    { id: "ad_copy.read", label: "Yayındaki reklam metni", granted: has("ads_read") || has("ads_management"), verified: verified.has("ad_copy.read"), enabled: true, note: "Creative metni ve Instagram permalink" },
    { id: "insights.read", label: "Timeframe insights", granted: has("ads_read") || has("ads_management"), verified: verified.has("insights.read"), enabled: true, note: "Son 7 gün için hesap düzeyi erişim kontrolü" },
    { id: "ads.write", label: "Reklam yönetimi", granted: scopes.some((scope) => WRITE_SCOPES.has(scope)), verified: false, enabled: false, note: "Token kapsamı var; ReklamZeka writer ve execute kapalı" },
  ];
}

export async function discoverMetaInventory(options: DiscoverMetaInventoryOptions): Promise<MetaInventorySnapshot> {
  const now = options.now ?? (() => new Date());
  const client = new MetaGraphClient(options.token, options.fetchImpl);
  const refreshedAt = now();
  const errors: Array<{ resource: string; message: string }> = [];
  const verified = new Set<string>(["token.inspect"]);

  const debug = await client.get<DebugTokenResponse>("/debug_token", { input_token: options.token });
  if (!debug.data?.is_valid) throw new ConnectorError("authentication", "Meta token geçersiz veya süresi dolmuş", false);
  const scopes = [...(debug.data.scopes ?? [])].sort();

  const [rawAccounts, rawPages] = await Promise.all([
    client.listAll<RawAccount>("/me/adaccounts", {
      fields: "id,name,currency,timezone_name,account_status,business{name}",
      limit: "100",
    }).then((rows) => { verified.add("accounts.read"); return rows; }),
    client.listAll<RawPage>("/me/accounts", {
      fields: "id,name,category,followers_count,link,instagram_business_account{id,username,name}",
      limit: "100",
    }).then((rows) => {
      verified.add("pages.read");
      verified.add("instagram.read");
      return rows;
    }),
  ]);

  const validAccounts = rawAccounts.filter((account): account is RawAccount & { id: string; name: string } => Boolean(account.id && account.name));
  const accounts = await mapWithConcurrency(validAccounts, 2, async (account): Promise<MetaInventoryAccount> => {
    let campaignCount: number | null = null;
    let adSetCount: number | null = null;
    let adCount: number | null = null;
    let campaignExamples: MetaInventoryAccount["campaignExamples"] = [];
    let adCopyExamples: readonly MetaAdCopyExample[] = [];
    let insightAccess: MetaInventoryAccount["insightAccess"] = { verified: false, timeframe: "last_7d", dateStart: null, dateStop: null };

    try {
      const result = await client.edgeSummary<RawCampaign>(`/${account.id}/campaigns`, "id,name,status,effective_status,objective", 5);
      campaignCount = result.totalCount;
      campaignExamples = result.rows.filter((row): row is RawCampaign & { id: string; name: string } => Boolean(row.id && row.name)).map((row) => ({
        id: maskMetaId(row.id),
        name: row.name,
        status: row.effective_status ?? row.status ?? "UNKNOWN",
        objective: row.objective ?? null,
      }));
      verified.add("campaign_hierarchy.read");
    } catch (error) {
      errors.push({ resource: `${account.name} / campaigns`, message: safeMessage(error) });
    }

    try {
      const result = await client.edgeSummary<Record<string, unknown>>(`/${account.id}/adsets`, "id", 1);
      adSetCount = result.totalCount;
      verified.add("campaign_hierarchy.read");
    } catch (error) {
      errors.push({ resource: `${account.name} / adsets`, message: safeMessage(error) });
    }

    try {
      const result = await client.edgeSummary<RawAd>(
        `/${account.id}/ads`,
        "id,name,status,effective_status,creative{id,title,body,instagram_permalink_url,object_story_spec}",
        3,
      );
      adCount = result.totalCount;
      adCopyExamples = result.rows.filter((row): row is RawAd & { id: string; name: string } => Boolean(row.id && row.name)).map((row) => {
        const story = storyCopy(row.creative?.object_story_spec);
        return {
          id: maskMetaId(row.id),
          name: row.name,
          status: row.effective_status ?? row.status ?? "UNKNOWN",
          title: row.creative?.title ?? story.title,
          body: row.creative?.body ?? story.body,
          instagramPermalink: row.creative?.instagram_permalink_url ?? null,
        };
      });
      verified.add("campaign_hierarchy.read");
      verified.add("ad_copy.read");
    } catch (error) {
      errors.push({ resource: `${account.name} / ads`, message: safeMessage(error) });
    }

    try {
      const insight = await client.get<{ data?: readonly RawInsight[] }>(`/${account.id}/insights`, {
        fields: "date_start,date_stop,spend,impressions,reach,clicks",
        level: "account",
        date_preset: "last_7d",
        limit: "1",
      });
      const row = insight.data?.[0];
      insightAccess = { verified: true, timeframe: "last_7d", dateStart: row?.date_start ?? null, dateStop: row?.date_stop ?? null };
      verified.add("insights.read");
    } catch (error) {
      errors.push({ resource: `${account.name} / insights`, message: safeMessage(error) });
    }

    return {
      id: maskMetaId(account.id),
      name: account.name,
      currency: account.currency ?? null,
      timezone: account.timezone_name ?? null,
      status: accountStatus(account.account_status),
      businessName: account.business?.name ?? null,
      campaignCount,
      adSetCount,
      adCount,
      campaignExamples,
      adCopyExamples,
      insightAccess,
    };
  });

  const pages: readonly MetaInventoryPage[] = rawPages
    .filter((page): page is RawPage & { id: string; name: string } => Boolean(page.id && page.name))
    .map((page) => ({
      id: maskMetaId(page.id),
      name: page.name,
      category: page.category ?? null,
      followers: page.followers_count ?? null,
      link: page.link ?? null,
      instagram: page.instagram_business_account?.id ? {
        id: maskMetaId(page.instagram_business_account.id),
        username: page.instagram_business_account.username ?? null,
        name: page.instagram_business_account.name ?? null,
      } : null,
    }));

  const sum = (values: readonly (number | null)[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
  const occurredAt = refreshedAt.toISOString();
  const summary = {
    adAccounts: accounts.length,
    pages: pages.length,
    linkedInstagramAccounts: pages.filter((page) => page.instagram).length,
    campaigns: sum(accounts.map((account) => account.campaignCount)),
    adSets: sum(accounts.map((account) => account.adSetCount)),
    ads: sum(accounts.map((account) => account.adCount)),
    accountsWithCampaigns: accounts.filter((account) => (account.campaignCount ?? 0) > 0).length,
  };
  const auditEvent = metaInventoryAudit.append({
    workspaceId: "demo-workspace",
    actorId: "meta-inventory-worker",
    action: "connection.inventory_refreshed",
    resourceType: "meta_connection",
    resourceId: "meta-read-mirror",
    occurredAt,
    metadata: {
      adAccounts: summary.adAccounts,
      pages: summary.pages,
      campaigns: summary.campaigns,
      partialErrors: errors.length,
      writeOperations: 0,
    },
  });
  return {
    connection: {
      status: "valid",
      graphApiVersion: META_GRAPH_API_VERSION,
      accessMode: "read_only",
      expiresAt: unixToIso(debug.data.expires_at),
      dataAccessExpiresAt: unixToIso(debug.data.data_access_expires_at),
      grantedScopes: scopes,
      securityStatus: options.securityStatus ?? "standard",
    },
    summary,
    capabilities: buildCapabilities(scopes, verified),
    accounts,
    pages,
    errors,
    refreshedAt: occurredAt,
    nextAutomaticRefreshAt: new Date(refreshedAt.getTime() + 15 * 60_000).toISOString(),
    audit: {
      eventId: auditEvent.id,
      action: "connection.inventory_refreshed",
      occurredAt,
      writeOperations: 0,
    },
  };
}
