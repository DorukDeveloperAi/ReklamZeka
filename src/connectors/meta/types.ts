export type MetaInventoryCapability = Readonly<{
  id: string;
  label: string;
  granted: boolean;
  verified: boolean;
  enabled: boolean;
  note: string;
}>;

export type MetaCampaignExample = Readonly<{
  id: string;
  name: string;
  status: string;
  objective: string | null;
}>;

export type MetaAdCopyExample = Readonly<{
  id: string;
  name: string;
  status: string;
  title: string | null;
  body: string | null;
  instagramPermalink: string | null;
}>;

export type MetaInventoryAccount = Readonly<{
  id: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  status: string;
  businessName: string | null;
  campaignCount: number | null;
  adSetCount: number | null;
  adCount: number | null;
  campaignExamples: readonly MetaCampaignExample[];
  adCopyExamples: readonly MetaAdCopyExample[];
  insightAccess: Readonly<{
    verified: boolean;
    timeframe: string;
    dateStart: string | null;
    dateStop: string | null;
  }>;
}>;

export type MetaInventoryPage = Readonly<{
  id: string;
  name: string;
  category: string | null;
  followers: number | null;
  link: string | null;
  instagram: Readonly<{
    id: string;
    username: string | null;
    name: string | null;
  }> | null;
}>;

export type MetaInventorySnapshot = Readonly<{
  connection: Readonly<{
    status: "valid" | "invalid";
    graphApiVersion: string;
    accessMode: "read_only";
    expiresAt: string | null;
    dataAccessExpiresAt: string | null;
    grantedScopes: readonly string[];
    securityStatus: "temporary_exposed" | "standard";
  }>;
  summary: Readonly<{
    adAccounts: number;
    pages: number;
    linkedInstagramAccounts: number;
    campaigns: number;
    adSets: number;
    ads: number;
    accountsWithCampaigns: number;
  }>;
  capabilities: readonly MetaInventoryCapability[];
  accounts: readonly MetaInventoryAccount[];
  pages: readonly MetaInventoryPage[];
  errors: readonly Readonly<{ resource: string; message: string }>[];
  refreshedAt: string;
  nextAutomaticRefreshAt: string;
  audit: Readonly<{
    eventId: string;
    action: "connection.inventory_refreshed";
    occurredAt: string;
    writeOperations: 0;
  }>;
}>;

export type MetaInventoryApiError = Readonly<{
  error: Readonly<{
    code: "not_configured" | "authentication" | "rate_limited" | "upstream";
    message: string;
  }>;
}>;
