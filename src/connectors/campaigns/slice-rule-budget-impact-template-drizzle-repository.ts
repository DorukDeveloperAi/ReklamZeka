import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createHash } from "node:crypto";
import type { ExactSliceRuleScope } from "@/application/slice-rule-workspace-service";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
/** Server-only mirror template: it exposes no IDs or technical allocation refs. */
export class DrizzleSliceRuleBudgetImpactTemplateRepository {
  constructor(private readonly database: Pick<Database, "select">) {}
  async loadExact(input: Readonly<{ workspaceId: string; adAccountId: string; campaignId: string; contextHash: string; scope: ExactSliceRuleScope }>) {
    const rows = await this.database.select({ campaign: schema.adCampaigns, account: schema.adAccounts, context: schema.effectiveCampaignContexts })
      .from(schema.adCampaigns).innerJoin(schema.adAccounts, and(eq(schema.adAccounts.workspaceId, schema.adCampaigns.workspaceId), eq(schema.adAccounts.id, schema.adCampaigns.adAccountId)))
      .innerJoin(schema.effectiveCampaignContexts, and(eq(schema.effectiveCampaignContexts.workspaceId, schema.adCampaigns.workspaceId), eq(schema.effectiveCampaignContexts.adAccountId, schema.adCampaigns.adAccountId), eq(schema.effectiveCampaignContexts.campaignId, schema.adCampaigns.id)))
      .where(and(eq(schema.adCampaigns.workspaceId, input.workspaceId), eq(schema.adCampaigns.id, input.campaignId), eq(schema.adCampaigns.adAccountId, input.adAccountId), eq(schema.effectiveCampaignContexts.contextHash, input.contextHash), eq(schema.effectiveCampaignContexts.entityType, "campaign"), isNull(schema.adCampaigns.disappearedAt), isNull(schema.adAccounts.disappearedAt))).limit(2);
    const row = rows[0];
    if (rows.length !== 1 || !row || row.campaign.dailyBudgetMinor === null || row.campaign.dailyBudgetMinor < 0 || !/^[A-Z]{3}$/.test(row.account.currency)) return null;
    const hash = createHash("sha256").update(`${input.workspaceId}:${input.contextHash}`).digest("hex").slice(0, 20);
    return Object.freeze({ currency: row.account.currency, currentAmountMinor: row.campaign.dailyBudgetMinor,
      observedAt: row.context.capturedAt.toISOString(), allocationRef: `allocation_${hash}`, categoryRef: `category_${createHash("sha256").update(input.scope.serviceRef).digest("hex").slice(0, 20)}`,
      geoRef: `geo_${createHash("sha256").update(input.scope.countryOrRegion ?? input.scope.market).digest("hex").slice(0, 20)}`, groupRefs: Object.freeze([`market_${input.scope.market}`]) });
  }
}
