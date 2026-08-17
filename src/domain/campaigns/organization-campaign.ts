import { createHash } from "node:crypto";

export const ORGANIZATION_CAMPAIGN_VERSION = "organization-campaign/1.0.0" as const;
export type OrganizationCampaignMarket = "domestic" | "international";

function opaque(prefix: string, workspaceId: string, id: string): string {
  return `${prefix}_${createHash("sha256").update(JSON.stringify({ workspaceId, id })).digest("hex").slice(0, 24)}`;
}

/** Public references deliberately never expose tenant UUIDs. */
export function organizationCampaignPublicRef(workspaceId: string, id: string): string {
  return opaque("organization_campaign", workspaceId, id);
}
export function organizationMembershipPublicRef(workspaceId: string, id: string): string {
  return opaque("organization_membership", workspaceId, id);
}

export type OrganizationCampaign = Readonly<{
  id: string;
  workspaceId: string;
  label: string;
  marketDefinitionId: string;
  tombstonedAt: string | null;
}>;

export type OrganizationCampaignMetaMembership = Readonly<{
  id: string;
  workspaceId: string;
  organizationCampaignId: string;
  campaignId: string;
  marketDefinitionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}>;

export type OrganizationCampaignProjection = Readonly<{
  organizationCampaigns: readonly Readonly<{
    ref: string;
    label: string;
    market: OrganizationCampaignMarket | null;
    membershipCount: number;
  }>[];
  /** Derived with NOT EXISTS; this is never persisted as a fake campaign. */
  unassignedCampaigns: readonly Readonly<{ campaignRef: string; name: string; market: OrganizationCampaignMarket | null }> [];
  authority: Readonly<{ canAssign: boolean; canWriteMeta: false; canAuthorizeAction: false }>;
}>;

export class OrganizationCampaignError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "market_mismatch" | "temporal_conflict") {
    super(code);
    this.name = "OrganizationCampaignError";
  }
}
