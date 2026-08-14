import { createHash } from "node:crypto";
import { projectEffectiveCampaignContext } from "@/analyses/effective-campaign-context-public";
import type { StoredEffectiveCampaignContext } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";

export const CAMPAIGN_CONTEXT_READ_MODEL_VERSION = "campaign-context-read-model/1.1.0" as const;
export const CAMPAIGN_CONTEXT_LIST_READ_MODEL_VERSION = "campaign-context-list-read-model/1.0.0" as const;

function approvalQueueCampaignRef(workspaceId: string, campaignId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(campaignId)) {
    throw new CampaignContextReadError("unsafe_source");
  }
  return `entity_${createHash("sha256").update(`${workspaceId}:entity:${campaignId.toLowerCase()}`).digest("hex").slice(0, 16)}`;
}

/** The Decision Room uses a distinct, tenant-scoped public alias for the same frozen campaign. */
function decisionRoomCampaignRef(workspaceId: string, campaignId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(campaignId)) {
    throw new CampaignContextReadError("unsafe_source");
  }
  return `campaign_${createHash("sha256").update(`${workspaceId}:campaign:${campaignId.toLowerCase()}`).digest("hex").slice(0, 20)}`;
}

export class CampaignContextReadError extends Error {
  constructor(readonly code: "invalid_input" | "source_unavailable" | "unsafe_source") {
    super(`Campaign context read rejected: ${code}`);
    this.name = "CampaignContextReadError";
  }
}

export type CampaignContextReadRepository = Readonly<{
  loadLatestValidCampaignPublic(input: Readonly<{ workspaceId: string; campaignRef: string }>): Promise<StoredEffectiveCampaignContext | null>;
  listLatestValidCampaignPublic(input: Readonly<{ workspaceId: string }>): Promise<readonly StoredEffectiveCampaignContext[]>;
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
      decisionRoomCampaignRef: decisionRoomCampaignRef(input.workspaceId, record.analysisDataScope.campaignId),
      context,
    });
  }

  /**
   * A deliberately small discovery model. It does not expose entity IDs,
   * context hashes, category evidence, or approval capability; selecting an
   * item still requires the exact single-context read above.
   */
  async list(input: Readonly<{ workspaceId: string }>) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.workspaceId)) {
      throw new CampaignContextReadError("invalid_input");
    }
    let records: readonly StoredEffectiveCampaignContext[];
    try { records = await this.repository.listLatestValidCampaignPublic(input); }
    catch { throw new CampaignContextReadError("source_unavailable"); }
    const campaignRefs = new Set<string>();
    const items: Array<Readonly<{ campaignRef: string; label: string; objective: string | null; capturedAt: string; sourceState: "frozen_valid" }>> = [];
    for (const record of records) {
      if (record.invalidated) continue;
      let context;
      try { context = projectEffectiveCampaignContext(record.context); }
      catch { throw new CampaignContextReadError("unsafe_source"); }
      const campaignRef = context.identity.campaignRef;
      if (!/^ref_[a-f0-9]{12}$/.test(campaignRef) || campaignRefs.has(campaignRef) || context.writeOperations !== 0) {
        throw new CampaignContextReadError("unsafe_source");
      }
      campaignRefs.add(campaignRef);
      items.push(Object.freeze({
        campaignRef,
        label: `Persisted campaign · ${campaignRef.slice(4, 10)}`,
        objective: context.meta.objective.state === "known" && typeof context.meta.objective.value === "string"
          ? context.meta.objective.value
          : null,
        capturedAt: context.capturedAt,
        sourceState: "frozen_valid" as const,
      }));
      if (items.length === 25) break;
    }
    return Object.freeze({ contractVersion: CAMPAIGN_CONTEXT_LIST_READ_MODEL_VERSION, view: "list" as const, items: Object.freeze(items), writeOperations: 0 as const });
  }
}
