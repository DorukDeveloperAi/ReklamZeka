import { createHash } from "node:crypto";
import { projectEffectiveCampaignContext } from "@/analyses/effective-campaign-context-public";
import type { StoredEffectiveCampaignContext } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";

export const CAMPAIGN_CONTEXT_READ_MODEL_VERSION = "campaign-context-read-model/1.1.0" as const;

function approvalQueueCampaignRef(workspaceId: string, campaignId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(campaignId)) {
    throw new CampaignContextReadError("unsafe_source");
  }
  return `entity_${createHash("sha256").update(`${workspaceId}:entity:${campaignId.toLowerCase()}`).digest("hex").slice(0, 16)}`;
}

export class CampaignContextReadError extends Error {
  constructor(readonly code: "invalid_input" | "source_unavailable" | "unsafe_source") {
    super(`Campaign context read rejected: ${code}`);
    this.name = "CampaignContextReadError";
  }
}

export type CampaignContextReadRepository = Readonly<{
  loadLatestValidCampaignPublic(input: Readonly<{ workspaceId: string; campaignRef: string }>): Promise<StoredEffectiveCampaignContext | null>;
}>;

export class CampaignContextReadService {
  constructor(private readonly repository: CampaignContextReadRepository) {}

  async get(input: Readonly<{ workspaceId: string; campaignRef: string }>) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.workspaceId) || !/^ref_[a-f0-9]{12}$/.test(input.campaignRef)) {
      throw new CampaignContextReadError("invalid_input");
    }
    let record: StoredEffectiveCampaignContext | null;
    try { record = await this.repository.loadLatestValidCampaignPublic(input); }
    catch { throw new CampaignContextReadError("source_unavailable"); }
    if (record === null) return Object.freeze({ contractVersion: CAMPAIGN_CONTEXT_READ_MODEL_VERSION, view: "empty" as const, campaignRef: input.campaignRef, writeOperations: 0 as const });
    if (record.invalidated) throw new CampaignContextReadError("unsafe_source");
    let context;
    try { context = projectEffectiveCampaignContext(record.context); }
    catch { throw new CampaignContextReadError("unsafe_source"); }
    if (context.identity.campaignRef !== input.campaignRef || context.writeOperations !== 0) {
      throw new CampaignContextReadError("unsafe_source");
    }
    if (!record.analysisDataScope) throw new CampaignContextReadError("unsafe_source");
    const queueCampaignRef = approvalQueueCampaignRef(input.workspaceId, record.analysisDataScope.campaignId);
    return Object.freeze({
      contractVersion: CAMPAIGN_CONTEXT_READ_MODEL_VERSION,
      view: "context" as const,
      campaignRef: input.campaignRef,
      approvalQueueCampaignRef: queueCampaignRef,
      context,
    });
  }
}
