import { inspectEffectiveCategory } from "@/domain/categories/registry";
import { organizationCampaignPublicRef, organizationMembershipPublicRef, OrganizationCampaignError, ORGANIZATION_CAMPAIGN_VERSION,
  type OrganizationCampaign, type OrganizationCampaignMetaMembership, type OrganizationCampaignProjection } from "@/domain/campaigns/organization-campaign";
import { categoryDefinitionPublicRef, categoryEntityPublicRef } from "@/domain/categories/public-reference";
import type { CampaignClassificationReviewRepository } from "@/application/campaign-classification-review-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

type ReadState = Readonly<{ organizationCampaigns: readonly OrganizationCampaign[]; memberships: readonly OrganizationCampaignMetaMembership[];
  unassignedCampaigns: readonly Readonly<{ id: string; name: string }>[]; hasMore: boolean }>;
export type OrganizationCampaignRepository = Readonly<{
  load(workspaceId: string, asOf: string, page?: Readonly<{ limit: number; afterName: string | null; afterId: string | null }>): Promise<ReadState>;
  create(input: Readonly<{ workspaceId: string; actorId: string; label: string; marketDefinitionId: string }>): Promise<OrganizationCampaign>;
  assign(input: Readonly<{ workspaceId: string; actorId: string; organizationCampaignId: string; campaignId: string;
    marketDefinitionId: string; effectiveFrom: string; effectiveTo: string | null }>): Promise<OrganizationCampaignMetaMembership>;
  close(input: Readonly<{ workspaceId: string; membershipId: string; effectiveTo: string }>): Promise<void>;
}>;

function timestamp(value: unknown, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) throw new OrganizationCampaignError("invalid_input");
  return new Date(value).toISOString();
}
function label(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > 160) throw new OrganizationCampaignError("invalid_input");
  return value.trim();
}
function ref(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[a-f0-9]{24}$`).test(value)) throw new OrganizationCampaignError("invalid_input");
  return value;
}
function canonicalMarketDefinition(source: Awaited<ReturnType<CampaignClassificationReviewRepository["load"]>>, market: "domestic" | "international") {
  const dimension = source.dimensions.find((item) => item.key === "market" && item.archivedAt === null);
  const key = market === "domestic" ? "yerli" : "yabanci";
  return dimension ? source.definitions.find((item) => item.dimensionId === dimension.id && item.key === key && item.archivedAt === null) ?? null : null;
}
function resolvedCampaignMarketDefinition(source: Awaited<ReturnType<CampaignClassificationReviewRepository["load"]>>, campaignId: string) {
  const dimension = source.dimensions.find((item) => item.key === "market" && item.archivedAt === null);
  const paths = source.paths.filter((path) => path.nodes[0]?.level === "campaign" && path.nodes[0]?.id === campaignId);
  if (!dimension || !paths.length) return null;
  let selected: string | null = null;
  for (const path of paths) {
    const inspected = inspectEffectiveCategory({ dimension, definitions: source.definitions.filter((item) => item.dimensionId === dimension.id), assignments: source.assignments.filter((item) => item.dimensionId === dimension.id), path });
    if (inspected.state !== "applied" || inspected.resolution.values.length !== 1) return null;
    const value = inspected.resolution.values[0]!;
    if (!['yerli', 'yabanci'].includes(value.key) || selected !== null && selected !== value.id) return null;
    selected = value.id;
  }
  return selected;
}

export class OrganizationCampaignService {
  constructor(private readonly repository: OrganizationCampaignRepository, private readonly classification: CampaignClassificationReviewRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async inspect(principal: TrustedDecisionRoomPrincipal, input: Readonly<{ limit?: unknown; cursor?: unknown }> = {}): Promise<OrganizationCampaignProjection & Readonly<{ version: typeof ORGANIZATION_CAMPAIGN_VERSION; nextCursor: string | null }>> {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:read", this.memberships);
    const source = await this.classification.load(principal.workspaceId);
    const rawLimit = input.limit === undefined ? 100 : Number(input.limit); if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) throw new OrganizationCampaignError("invalid_input");
    let afterName: string | null = null; let afterId: string | null = null;
    if (input.cursor !== undefined && input.cursor !== null) { if (typeof input.cursor !== "string" || !input.cursor.startsWith("organization_campaign_cursor_")) throw new OrganizationCampaignError("invalid_input"); try { const value = JSON.parse(Buffer.from(input.cursor.slice(29), "base64url").toString("utf8")); if (!value || value.v !== 1 || typeof value.r !== "string") throw new Error(); const campaign = source.campaigns.find((item) => item.ref === value.r); if (!campaign) throw new Error(); afterName = campaign.name; afterId = campaign.id; } catch { throw new OrganizationCampaignError("invalid_input"); } }
    const state = await this.repository.load(principal.workspaceId, new Date().toISOString(), { limit: rawLimit, afterName, afterId });
    const marketByCampaignRef = new Map(source.campaigns.map((campaign) => {
      const definitionId = resolvedCampaignMarketDefinition(source, campaign.id);
      return [campaign.ref, definitionId === canonicalMarketDefinition(source, "domestic")?.id ? "domestic" : definitionId === canonicalMarketDefinition(source, "international")?.id ? "international" : null] as const;
    }));
    const domesticDefinition = canonicalMarketDefinition(source, "domestic");
    const unassignedCampaigns = Object.freeze(state.unassignedCampaigns.map((campaign) => {
      const campaignRef = categoryEntityPublicRef(principal.workspaceId, "campaign", campaign.id);
      return Object.freeze({ campaignRef, name: campaign.name, market: marketByCampaignRef.get(campaignRef) ?? null });
    })); const last = unassignedCampaigns.at(-1);
    return Object.freeze({ version: ORGANIZATION_CAMPAIGN_VERSION,
      organizationCampaigns: Object.freeze(state.organizationCampaigns.filter((item) => item.tombstonedAt === null).map((item) => Object.freeze({
        ref: organizationCampaignPublicRef(principal.workspaceId, item.id), label: item.label,
        market: domesticDefinition?.id === item.marketDefinitionId ? "domestic" : canonicalMarketDefinition(source, "international")?.id === item.marketDefinitionId ? "international" : null,
        membershipCount: state.memberships.filter((link) => link.organizationCampaignId === item.id).length,
      }))),
      unassignedCampaigns, nextCursor: state.hasMore && last ? `organization_campaign_cursor_${Buffer.from(JSON.stringify({ v: 1, r: last.campaignRef }), "utf8").toString("base64url")}` : null,
      authority: Object.freeze({ canAssign: membership.role === "owner" || membership.role === "admin", canWriteMeta: false as const, canAuthorizeAction: false as const }),
    });
  }

  async create(principal: TrustedDecisionRoomPrincipal, command: Readonly<{ label: unknown; marketDefinitionRef: unknown }>) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:publish", this.memberships);
    if (membership.role !== "owner" && membership.role !== "admin") throw new OrganizationCampaignError("invalid_input");
    const marketDefinitionRef = ref(command.marketDefinitionRef, "category");
    const source = await this.classification.load(principal.workspaceId);
    const marketDefinition = [canonicalMarketDefinition(source, "domestic"), canonicalMarketDefinition(source, "international")]
      .find((item) => item !== null && categoryDefinitionPublicRef("market", item.key) === marketDefinitionRef);
    if (!marketDefinition) throw new OrganizationCampaignError("market_mismatch");
    const created = await this.repository.create({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, label: label(command.label), marketDefinitionId: marketDefinition.id });
    return Object.freeze({ version: ORGANIZATION_CAMPAIGN_VERSION, organizationCampaignRef: organizationCampaignPublicRef(principal.workspaceId, created.id),
      authority: Object.freeze({ canWriteMeta: false as const, canAuthorizeAction: false as const }) });
  }

  async assign(principal: TrustedDecisionRoomPrincipal, command: Readonly<{ organizationCampaignRef: unknown; campaignRef: unknown; effectiveFrom: unknown; effectiveTo?: unknown }>) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:publish", this.memberships);
    if (membership.role !== "owner" && membership.role !== "admin") throw new OrganizationCampaignError("invalid_input");
    const organizationCampaignRef = ref(command.organizationCampaignRef, "organization_campaign");
    const campaignRef = ref(command.campaignRef, "category_entity");
    const effectiveFrom = timestamp(command.effectiveFrom)!; const effectiveTo = timestamp(command.effectiveTo, true);
    if (effectiveTo !== null && effectiveTo <= effectiveFrom) throw new OrganizationCampaignError("invalid_input");
    const state = await this.repository.load(principal.workspaceId, effectiveFrom);
    const organizationCampaign = state.organizationCampaigns.find((item) => organizationCampaignPublicRef(principal.workspaceId, item.id) === organizationCampaignRef && item.tombstonedAt === null);
    if (!organizationCampaign) throw new OrganizationCampaignError("not_found");
    const source = await this.classification.load(principal.workspaceId);
    const campaign = source.campaigns.find((item) => item.ref === campaignRef);
    if (!campaign || resolvedCampaignMarketDefinition(source, campaign.id) !== organizationCampaign.marketDefinitionId) throw new OrganizationCampaignError("market_mismatch");
    try { await this.repository.assign({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, organizationCampaignId: organizationCampaign.id,
      campaignId: campaign.id, marketDefinitionId: organizationCampaign.marketDefinitionId, effectiveFrom, effectiveTo }); } catch (reason) { if (reason && typeof reason === "object" && "code" in reason && ["23P01", "23505"].includes(String((reason as { code?: unknown }).code))) throw new OrganizationCampaignError("temporal_conflict"); throw reason; }
    return Object.freeze({ version: ORGANIZATION_CAMPAIGN_VERSION, assigned: true as const,
      authority: Object.freeze({ canWriteMeta: false as const, canAuthorizeAction: false as const }) });
  }
  async close(principal: TrustedDecisionRoomPrincipal, command: Readonly<{ membershipRef: unknown; closeAt: unknown }>) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:publish", this.memberships);
    if (membership.role !== "owner" && membership.role !== "admin") throw new OrganizationCampaignError("invalid_input");
    const closeAt = timestamp(command.closeAt)!; const membershipRef = ref(command.membershipRef, "organization_membership");
    const state = await this.repository.load(principal.workspaceId, closeAt);
    const row = state.memberships.find((item) => organizationMembershipPublicRef(principal.workspaceId, item.id) === membershipRef && item.effectiveTo === null && closeAt > item.effectiveFrom);
    if (!row) throw new OrganizationCampaignError("not_found");
    try { await this.repository.close({ workspaceId: principal.workspaceId, membershipId: row.id, effectiveTo: closeAt }); } catch (reason) { throw new OrganizationCampaignError("temporal_conflict"); }
    return Object.freeze({ version: ORGANIZATION_CAMPAIGN_VERSION, closed: true as const, authority: Object.freeze({ canWriteMeta: false as const, canAuthorizeAction: false as const }) });
  }
}
