import { describe, expect, it } from "vitest";
import {
  buildMetaReadMirrorProjection,
  type MetaReadMirrorFact,
} from "@/domain/meta/read-mirror-projection";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const observedAt = "2026-08-13T12:00:00.000Z";

function fact(overrides: Partial<MetaReadMirrorFact> = {}): MetaReadMirrorFact {
  return {
    connectionId: "22222222-2222-4222-8222-222222222222", connectionName: "Ana Meta", connectionStatus: "active",
    accessMode: "read_only", accountId: "33333333-3333-4333-8333-333333333333", accountName: "Yabancı",
    currency: "TRY", timezone: "Europe/Istanbul", accountFetchedAt: "2026-08-13T11:57:00.000Z",
    inventoryStreamStatus: "completed", inventoryStreamUpdatedAt: "2026-08-13T11:58:00.000Z",
    creativeStreamStatus: "completed", creativeStreamUpdatedAt: "2026-08-13T11:59:00.000Z",
    insightStreamStatus: "completed", insightStreamUpdatedAt: "2026-08-13T11:59:30.000Z", insightCanonicalRowCount: 4,
    campaignId: "44444444-4444-4444-8444-444444444444", campaignName: "Intensive FTR",
    campaignStatus: "ACTIVE", campaignObjective: "OUTCOME_LEADS", campaignDailyBudgetMinor: 100000,
    campaignLifetimeBudgetMinor: null, campaignFetchedAt: "2026-08-13T11:57:00.000Z",
    adSetId: "55555555-5555-4555-8555-555555555555", adSetName: "AR · Özel Hedefleme",
    adSetStatus: "ACTIVE", optimizationGoal: "LEAD_GENERATION", targetingSummary: { geo: "AR" },
    adSetDailyBudgetMinor: null, adSetLifetimeBudgetMinor: null, adSetFetchedAt: "2026-08-13T11:57:00.000Z",
    adId: "66666666-6666-4666-8666-666666666666", adName: "WhatsApp FTR", adStatus: "ACTIVE",
    adFetchedAt: "2026-08-13T11:57:00.000Z", creativeId: "77777777-7777-4777-8777-777777777777",
    creativeName: "FTR AR 01", creativeSourceType: "existing_post", primaryText: "Tedavi programını öğrenin",
    headline: "Intensive FTR", description: "Bilgi alın", caption: null, callToActionType: "WHATSAPP_MESSAGE",
    destinationUrl: "https://example.test/ftr", creativeFormat: "video", creativeFetchedAt: "2026-08-13T11:56:00.000Z",
    postId: "88888888-8888-4888-8888-888888888888", postMediaType: "VIDEO",
    postPermalink: "https://example.test/post", postMessage: "Program hakkında bilgi", postCaption: null,
    postPublishedAt: "2026-08-12T08:00:00.000Z", postFetchedAt: "2026-08-13T11:55:00.000Z", ...overrides,
  };
}

describe("Meta read mirror projection", () => {
  it("builds an opaque account→campaign→ad set→ad→creative/post hierarchy with no action authority", () => {
    const result = buildMetaReadMirrorProjection({ workspaceId, observedAt, facts: [fact()] });
    expect(result).toMatchObject({ sourceState: "ready", freshnessAgeMinutes: 1,
      summary: { connections: 1, accounts: 1, campaigns: 1, adSets: 1, ads: 1, creatives: 1, posts: 1 },
      authority: { actionAuthority: "none", canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    const account = result.connections[0]!.accounts[0]!;
    const campaign = account.campaigns[0]!;
    const adSet = campaign.adSets[0]!;
    expect(account.accountRef).toMatch(/^account_[a-f0-9]{24}$/);
    expect(campaign).toMatchObject({ name: "Intensive FTR", budget: { owner: "campaign", dailyMinor: 100000 } });
    expect(adSet).toMatchObject({ name: "AR · Özel Hedefleme", budget: { owner: "campaign" }, targetingSummary: { geo: "AR" } });
    expect(adSet.ads[0]!.creative).toMatchObject({ primaryText: "Tedavi programını öğrenin", headline: "Intensive FTR",
      callToActionType: "WHATSAPP_MESSAGE", post: { message: "Program hakkında bilgi" } });
    expect(JSON.stringify(result)).not.toContain("33333333-3333-4333-8333-333333333333");
  });

  it("distinguishes unavailable, empty, stale and partial without inventing hierarchy", () => {
    const unavailable = buildMetaReadMirrorProjection({ workspaceId, observedAt, facts: [] });
    expect(unavailable).toMatchObject({ sourceState: "unavailable", reasonCodes: ["active_connection_unavailable"] });

    const empty = buildMetaReadMirrorProjection({ workspaceId, observedAt, facts: [fact({ campaignId: null, campaignName: null,
      campaignStatus: null, campaignObjective: null, campaignDailyBudgetMinor: null, campaignFetchedAt: null, adSetId: null,
      adSetName: null, adSetFetchedAt: null, adId: null, adName: null, adFetchedAt: null, creativeId: null,
      creativeSourceType: null, creativeFetchedAt: null, postId: null, postFetchedAt: null })] });
    expect(empty).toMatchObject({ sourceState: "empty", reasonCodes: ["canonical_hierarchy_empty"] });

    const stale = buildMetaReadMirrorProjection({ workspaceId, observedAt, facts: [fact({ accountFetchedAt: "2026-08-11T10:00:00.000Z",
      inventoryStreamUpdatedAt: "2026-08-11T10:00:00.000Z", creativeStreamUpdatedAt: "2026-08-11T10:00:00.000Z",
      campaignFetchedAt: "2026-08-11T10:00:00.000Z", adSetFetchedAt: "2026-08-11T10:00:00.000Z",
      adFetchedAt: "2026-08-11T10:00:00.000Z", creativeFetchedAt: "2026-08-11T10:00:00.000Z", postFetchedAt: "2026-08-11T10:00:00.000Z" })] });
    expect(stale.sourceState).toBe("stale");
    expect(stale.reasonCodes).toContain("canonical_observation_stale");

    const partial = buildMetaReadMirrorProjection({ workspaceId, observedAt, facts: [fact({ creativeStreamStatus: "partial",
      creativeId: null, creativeSourceType: null, creativeFetchedAt: null, postId: null, postFetchedAt: null })] });
    expect(partial.sourceState).toBe("partial");
    expect(partial.reasonCodes).toEqual(["creative_binding_missing", "sync_stream_incomplete"]);
  });

  it("reports an empty completed insight delivery separately from a failed or incomplete sync", () => {
    const emptyDelivery = buildMetaReadMirrorProjection({ workspaceId, observedAt,
      facts: [fact({ insightCanonicalRowCount: 0 })] });
    expect(emptyDelivery.sourceState).toBe("partial");
    expect(emptyDelivery.reasonCodes).toContain("insight_delivery_empty_verified");
    expect(emptyDelivery.connections[0]!.accounts[0]!.freshness).toMatchObject({ insightStatus: "completed", insightCanonicalRowCount: 0 });

    const incomplete = buildMetaReadMirrorProjection({ workspaceId, observedAt,
      facts: [fact({ insightStreamStatus: "partial", insightCanonicalRowCount: 0 })] });
    expect(incomplete.reasonCodes).toContain("insight_sync_incomplete");
    expect(incomplete.reasonCodes).not.toContain("insight_delivery_empty_verified");
  });

  it("never lets a disconnected connection appear ready", () => {
    const result = buildMetaReadMirrorProjection({ workspaceId, observedAt, facts: [fact({ connectionStatus: "disconnected" })] });
    expect(result.sourceState).toBe("unavailable");
    expect(result.reasonCodes).toContain("connection_not_active");
  });
});
