import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { OrganizationCampaignRepository } from "@/application/organization-campaign-service";
import type { OrganizationCampaign, OrganizationCampaignMetaMembership } from "@/domain/campaigns/organization-campaign";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function rows<T>(result: unknown): readonly T[] { if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) throw new Error("organization campaign repository rejected: corrupt_store"); return result.rows as readonly T[]; }
function text(value: unknown): string { if (typeof value !== "string" || !value.trim()) throw new Error("organization campaign repository rejected: corrupt_store"); return value; }
function instant(value: unknown): string { const date = value instanceof Date ? value : new Date(String(value)); if (Number.isNaN(date.valueOf())) throw new Error("organization campaign repository rejected: corrupt_store"); return date.toISOString(); }

/** Repository commands remain server-private; opaque public refs are resolved in the application service. */
export class DrizzleOrganizationCampaignRepository implements OrganizationCampaignRepository {
  constructor(private readonly database: Pick<Database, "transaction">) {}
  async load(workspaceId: string, asOf: string, page: Readonly<{ limit: number; afterName: string | null; afterId: string | null }> = { limit: 100, afterName: null, afterId: null }) {
    if (!UUID.test(workspaceId) || Number.isNaN(Date.parse(asOf))) throw new Error("organization campaign repository rejected: invalid_scope");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`set local transaction isolation level repeatable read`); await tx.execute(sql`set local transaction read only`);
      const organizationCampaigns = rows<any>(await tx.execute(sql`select id::text, workspace_id::text, label, market_definition_id::text, tombstoned_at from organization_campaigns where workspace_id = ${workspaceId}::uuid order by created_at, id`)).map((row): OrganizationCampaign => Object.freeze({ id: text(row.id), workspaceId: text(row.workspace_id), label: text(row.label), marketDefinitionId: text(row.market_definition_id), tombstonedAt: row.tombstoned_at === null ? null : instant(row.tombstoned_at) }));
      const memberships = rows<any>(await tx.execute(sql`select id::text, workspace_id::text, organization_campaign_id::text, campaign_id::text, market_definition_id::text, effective_from, effective_to from organization_campaign_meta_memberships where workspace_id = ${workspaceId}::uuid and effective_from <= ${asOf}::timestamptz and (effective_to is null or effective_to > ${asOf}::timestamptz) order by effective_from, id`)).map((row): OrganizationCampaignMetaMembership => Object.freeze({ id: text(row.id), workspaceId: text(row.workspace_id), organizationCampaignId: text(row.organization_campaign_id), campaignId: text(row.campaign_id), marketDefinitionId: text(row.market_definition_id), effectiveFrom: instant(row.effective_from), effectiveTo: row.effective_to === null ? null : instant(row.effective_to) }));
      // This is intentionally a virtual projection; no "unassigned" row is ever stored.
      const unassignedCampaigns = rows<any>(await tx.execute(sql`select campaign.id::text, campaign.name from ad_campaigns campaign where campaign.workspace_id = ${workspaceId}::uuid and campaign.disappeared_at is null and not exists (select 1 from organization_campaign_meta_memberships membership where membership.workspace_id = campaign.workspace_id and membership.campaign_id = campaign.id and membership.effective_from <= ${asOf}::timestamptz and (membership.effective_to is null or membership.effective_to > ${asOf}::timestamptz)) and (${page.afterName}::text is null or (campaign.name, campaign.id) > (${page.afterName}::text, ${page.afterId}::uuid)) order by campaign.name, campaign.id limit ${page.limit + 1}`));
      return Object.freeze({ organizationCampaigns: Object.freeze(organizationCampaigns), memberships: Object.freeze(memberships), hasMore: unassignedCampaigns.length > page.limit, unassignedCampaigns: Object.freeze(unassignedCampaigns.slice(0, page.limit).map((row) => Object.freeze({ id: text(row.id), name: text(row.name) }))) });
    });
  }
  async create(input: Readonly<{ workspaceId: string; actorId: string; label: string; marketDefinitionId: string }>) {
    const result = await this.database.transaction(async (tx) => rows<any>(await tx.execute(sql`insert into organization_campaigns (workspace_id, label, market_definition_id, created_by_actor_id) values (${input.workspaceId}::uuid, ${input.label}, ${input.marketDefinitionId}::uuid, ${input.actorId}::uuid) returning id::text, workspace_id::text, label, market_definition_id::text, tombstoned_at`)));
    const row = result[0]; if (!row) throw new Error("organization campaign repository rejected: write_failed");
    return Object.freeze({ id: text(row.id), workspaceId: text(row.workspace_id), label: text(row.label), marketDefinitionId: text(row.market_definition_id), tombstonedAt: row.tombstoned_at === null ? null : instant(row.tombstoned_at) } satisfies OrganizationCampaign);
  }
  async assign(input: Readonly<{ workspaceId: string; actorId: string; organizationCampaignId: string; campaignId: string; marketDefinitionId: string; effectiveFrom: string; effectiveTo: string | null }>) {
    const result = await this.database.transaction(async (tx) => rows<any>(await tx.execute(sql`insert into organization_campaign_meta_memberships (workspace_id, organization_campaign_id, campaign_id, market_definition_id, effective_from, effective_to, assigned_by_actor_id) values (${input.workspaceId}::uuid, ${input.organizationCampaignId}::uuid, ${input.campaignId}::uuid, ${input.marketDefinitionId}::uuid, ${input.effectiveFrom}::timestamptz, ${input.effectiveTo}::timestamptz, ${input.actorId}::uuid) returning id::text, workspace_id::text, organization_campaign_id::text, campaign_id::text, market_definition_id::text, effective_from, effective_to`)));
    const row = result[0]; if (!row) throw new Error("organization campaign repository rejected: write_failed");
    return Object.freeze({ id: text(row.id), workspaceId: text(row.workspace_id), organizationCampaignId: text(row.organization_campaign_id), campaignId: text(row.campaign_id), marketDefinitionId: text(row.market_definition_id), effectiveFrom: instant(row.effective_from), effectiveTo: row.effective_to === null ? null : instant(row.effective_to) } satisfies OrganizationCampaignMetaMembership);
  }
  async close(input: Readonly<{ workspaceId: string; membershipId: string; effectiveTo: string }>): Promise<void> {
    await this.database.transaction(async (tx) => {
      const result = rows<any>(await tx.execute(sql`update organization_campaign_meta_memberships set effective_to = ${input.effectiveTo}::timestamptz where workspace_id = ${input.workspaceId}::uuid and id = ${input.membershipId}::uuid and effective_to is null and effective_from < ${input.effectiveTo}::timestamptz returning id`));
      if (result.length !== 1) throw new Error("organization campaign repository rejected: close_conflict");
    });
  }
}
