import { describe, expect, it } from "vitest";
import {
  MetaChangeSnapshotDrizzleAdapter,
  MetaChangeSnapshotScopeError,
  META_CHANGE_SNAPSHOT_COLLECTION_CAPS,
  assertMetaChangeSnapshotCollectionBound,
  metaChangeSnapshotInputFromStoredAccount,
  type MetaChangeSnapshotReadStore,
  type MetaChangeSnapshotScope,
  type MetaChangeStoredAccount,
} from "@/connectors/meta/sync/change-snapshot-drizzle-adapter";
import { diffMetaChangeSnapshots, normalizeMetaChangeSnapshot } from "@/domain/meta/snapshot-diff";

const scope: MetaChangeSnapshotScope = {
  workspaceId: "11111111-1111-4111-a111-111111111111",
  connectionId: "22222222-2222-4222-a222-222222222222",
  externalAccountId: "act_123456789012345",
  capturedAt: "2026-08-07T12:00:00.000Z",
};

function stored(): MetaChangeStoredAccount {
  return {
    workspaceId: scope.workspaceId,
    connectionId: scope.connectionId,
    internalAccountId: "account-internal-1",
    externalAccountId: scope.externalAccountId,
    campaigns: [{
      workspaceId: scope.workspaceId,
      internalAdAccountId: "account-internal-1",
      internalCampaignId: "campaign-internal-1",
      externalCampaignId: "campaign_123456789012345",
      configuredStatus: "ACTIVE",
      effectiveStatus: "ACTIVE",
      campaignBudgetOptimization: true,
      dailyBudgetMinor: 100_000,
      lifetimeBudgetMinor: null,
      unsupportedFields: [],
      provenance: { knownNullFields: ["lifetime_budget_minor"] },
    }],
    adSets: [{
      workspaceId: scope.workspaceId,
      internalAdAccountId: "account-internal-1",
      internalAdSetId: "adset-internal-1",
      internalCampaignId: "campaign-internal-1",
      externalAdSetId: "adset_123456789012345",
      configuredStatus: "ACTIVE",
      effectiveStatus: null,
      dailyBudgetMinor: null,
      lifetimeBudgetMinor: null,
      targetingSignature: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      unsupportedFields: [{ field: "effective_status" }],
      provenance: { knownNullFields: ["dailyBudgetMinor", "lifetimeBudgetMinor"] },
    }],
    ads: [{
      workspaceId: scope.workspaceId,
      internalAdAccountId: "account-internal-1",
      internalAdId: "ad-internal-1",
      internalCampaignId: "campaign-internal-1",
      internalAdSetId: "adset-internal-1",
      externalAdId: "ad_123456789012345",
      configuredStatus: "ACTIVE",
      effectiveStatus: "ACTIVE",
      unsupportedFields: [],
      provenance: {},
    }],
    creatives: [{
      workspaceId: scope.workspaceId,
      internalAdAccountId: "account-internal-1",
      internalCreativeId: "creative-internal-1",
      externalCreativeId: "creative_123456789012345",
    }],
    bindings: [{
      workspaceId: scope.workspaceId,
      internalAdId: "ad-internal-1",
      internalCreativeId: "creative-internal-1",
      internalPostId: "post-internal-1",
      externalCreativeId: "creative_123456789012345",
      externalPostId: "post_123456789012345",
      postWorkspaceId: scope.workspaceId,
      postConnectionId: scope.connectionId,
      bindingPayloadHash: "b".repeat(64),
      provenance: { sourceRevision: "2026-08-07T11:00:00.000Z", sourceEdge: "ad.creative" },
    }],
  };
}

class FixtureStore implements MetaChangeSnapshotReadStore {
  constructor(private readonly rows: readonly MetaChangeStoredAccount[]) {}
  readScopedAccount(): Promise<readonly MetaChangeStoredAccount[]> {
    return Promise.resolve(this.rows);
  }
}

describe("Meta change snapshot Drizzle read boundary", () => {
  it("rejects collection overflow before an unbounded snapshot can be composed", () => {
    expect(() => assertMetaChangeSnapshotCollectionBound("campaigns", META_CHANGE_SNAPSHOT_COLLECTION_CAPS.campaigns + 1))
      .toThrowError(expect.objectContaining<Partial<MetaChangeSnapshotScopeError>>({ code: "collection_overflow" }));
    expect(() => assertMetaChangeSnapshotCollectionBound("bindings", META_CHANGE_SNAPSHOT_COLLECTION_CAPS.bindings + 1))
      .toThrowError(expect.objectContaining<Partial<MetaChangeSnapshotScopeError>>({ code: "collection_overflow" }));
  });

  it("keeps an exact workspace/connection/account scope", async () => {
    const input = await new MetaChangeSnapshotDrizzleAdapter(new FixtureStore([stored()])).buildInput(scope);
    expect(input).toMatchObject({
      workspaceId: scope.workspaceId,
      externalAccountId: scope.externalAccountId,
      campaigns: [{ externalCampaignId: "campaign_123456789012345" }],
    });

    const leaked = { ...stored(), workspaceId: "other-workspace" };
    await expect(new MetaChangeSnapshotDrizzleAdapter(new FixtureStore([leaked])).buildInput(scope))
      .rejects.toMatchObject({ code: "scope_mismatch" } satisfies Partial<MetaChangeSnapshotScopeError>);
    await expect(new MetaChangeSnapshotDrizzleAdapter(new FixtureStore([stored(), stored()])).buildInput(scope))
      .rejects.toMatchObject({ code: "scope_mismatch" } satisfies Partial<MetaChangeSnapshotScopeError>);

    const leakedChild = structuredClone(stored());
    (leakedChild.ads[0] as { workspaceId: string }).workspaceId = "other-workspace";
    await expect(new MetaChangeSnapshotDrizzleAdapter(new FixtureStore([leakedChild])).buildInput(scope))
      .rejects.toMatchObject({ code: "scope_mismatch" } satisfies Partial<MetaChangeSnapshotScopeError>);
  });

  it("fails closed for orphan hierarchy and creative bindings", () => {
    const orphanAdSet = structuredClone(stored());
    (orphanAdSet.adSets[0] as { internalCampaignId: string }).internalCampaignId = "missing-campaign";
    expect(() => metaChangeSnapshotInputFromStoredAccount(scope, [orphanAdSet]))
      .toThrowError(expect.objectContaining<Partial<MetaChangeSnapshotScopeError>>({ code: "orphan_parent" }));

    const orphanCreative = structuredClone(stored());
    (orphanCreative.bindings[0] as { internalCreativeId: string }).internalCreativeId = "missing-creative";
    expect(() => metaChangeSnapshotInputFromStoredAccount(scope, [orphanCreative]))
      .toThrowError(expect.objectContaining<Partial<MetaChangeSnapshotScopeError>>({ code: "orphan_parent" }));
  });

  it("is deterministic across DB row order and hashes private binding evidence", () => {
    const first = stored();
    const secondBinding = {
      ...first.bindings[0]!,
      internalCreativeId: "creative-internal-2",
      internalPostId: null,
      externalCreativeId: "creative_223456789012345",
      externalPostId: null,
      postWorkspaceId: null,
      postConnectionId: null,
      bindingPayloadHash: "c".repeat(64),
      provenance: { sourceRevision: "2026-08-07T11:30:00.000Z", sourceEdge: "ad.creative.secondary" },
    };
    const withTwo = {
      ...first,
      creatives: [...first.creatives, {
        workspaceId: scope.workspaceId,
        internalAdAccountId: "account-internal-1",
        internalCreativeId: "creative-internal-2",
        externalCreativeId: "creative_223456789012345",
      }],
      bindings: [...first.bindings, secondBinding],
    };
    const reversed = {
      ...withTwo,
      campaigns: [...withTwo.campaigns].reverse(),
      adSets: [...withTwo.adSets].reverse(),
      ads: [...withTwo.ads].reverse(),
      creatives: [...withTwo.creatives].reverse(),
      bindings: [...withTwo.bindings].reverse(),
    };

    const inputA = metaChangeSnapshotInputFromStoredAccount(scope, [withTwo]);
    const inputB = metaChangeSnapshotInputFromStoredAccount(scope, [reversed]);
    expect(inputB).toEqual(inputA);
    const a = normalizeMetaChangeSnapshot(inputA);
    const b = normalizeMetaChangeSnapshot(inputB);
    expect(b).toEqual(a);
    const signature = a.entities.find((row) => row.entityType === "ad")?.fields.creative_binding_signature;
    expect(signature).toMatchObject({ state: "known", value: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) });
    const serialized = JSON.stringify(signature);
    for (const privateIdentity of ["creative-internal-1", "creative-internal-2", "post-internal-1", "ad-internal-1"]) {
      expect(serialized).not.toContain(privateIdentity);
    }
  });

  it("keeps the binding signature stable across internal reimport evidence but changes for Meta identity", () => {
    const baselineInput = metaChangeSnapshotInputFromStoredAccount(scope, [stored()]);
    const baseline = baselineInput.ads[0]!.creativeBindingSignature;

    const reimported = structuredClone(stored());
    (reimported.ads[0] as { internalAdId: string }).internalAdId = "reimported-ad-uuid";
    (reimported.creatives[0] as { internalCreativeId: string }).internalCreativeId = "reimported-creative-uuid";
    Object.assign(reimported.bindings[0]!, {
      internalAdId: "reimported-ad-uuid",
      internalCreativeId: "reimported-creative-uuid",
      bindingPayloadHash: "d".repeat(64),
      provenance: { sourceRevision: "2026-08-08T11:00:00.000Z", sourceEdge: "reimport" },
    });
    expect(metaChangeSnapshotInputFromStoredAccount(scope, [reimported]).ads[0]!.creativeBindingSignature)
      .toEqual(baseline);

    const changedPost = structuredClone(stored());
    (changedPost.bindings[0] as { externalPostId: string | null }).externalPostId = "post_999999999999999";
    expect(metaChangeSnapshotInputFromStoredAccount(scope, [changedPost]).ads[0]!.creativeBindingSignature)
      .not.toEqual(baseline);

    const changedCreative = structuredClone(stored());
    (changedCreative.creatives[0] as { externalCreativeId: string }).externalCreativeId = "creative_999999999999999";
    (changedCreative.bindings[0] as { externalCreativeId: string }).externalCreativeId = "creative_999999999999999";
    expect(metaChangeSnapshotInputFromStoredAccount(scope, [changedCreative]).ads[0]!.creativeBindingSignature)
      .not.toEqual(baseline);
  });

  it("uses unknown for absent values unless provenance proves known-null", () => {
    const input = metaChangeSnapshotInputFromStoredAccount(scope, [stored()]);
    expect(input.campaigns[0]!.lifetimeBudgetMinor).toEqual({ state: "known", value: null });
    expect(input.adSets[0]!.dailyBudgetMinor).toEqual({ state: "known", value: null });
    expect(input.adSets[0]!.effectiveStatus).toEqual({ state: "unknown", reason: "effectiveStatus_unsupported" });

    const noEvidence = structuredClone(stored());
    (noEvidence.campaigns[0] as { provenance: Record<string, unknown> }).provenance = {};
    expect(metaChangeSnapshotInputFromStoredAccount(scope, [noEvidence]).campaigns[0]!.lifetimeBudgetMinor)
      .toEqual({ state: "unknown", reason: "lifetimeBudgetMinor_not_observed" });
  });

  it("hashes legacy/raw targeting signatures before they enter the snapshot", () => {
    const rawTargeting = structuredClone(stored());
    (rawTargeting.adSets[0] as { targetingSignature: string | null }).targetingSignature = "targeting:istanbul-v1";
    const input = metaChangeSnapshotInputFromStoredAccount(scope, [rawTargeting]);
    expect(input.adSets[0]!.targetingSignature).toMatchObject({
      state: "known",
      value: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(input.adSets[0]!.targetingSignature)).not.toContain("istanbul");
  });

  it("keeps tokens, ad copy and raw identities out of the public change timeline", () => {
    const previous = normalizeMetaChangeSnapshot(metaChangeSnapshotInputFromStoredAccount(scope, [stored()]));
    const currentStored = structuredClone(stored());
    (currentStored.ads[0] as { configuredStatus: string | null }).configuredStatus = "PAUSED";
    const current = normalizeMetaChangeSnapshot(metaChangeSnapshotInputFromStoredAccount(
      { ...scope, capturedAt: "2026-08-07T13:00:00.000Z" },
      [currentStored],
    ));
    const publicJson = JSON.stringify(diffMetaChangeSnapshots({ previous, current }));
    for (const privateValue of [
      scope.workspaceId,
      scope.connectionId,
      scope.externalAccountId,
      "campaign_123456789012345",
      "adset_123456789012345",
      "ad_123456789012345",
      "creative-internal-1",
      "access_token",
      "secret-copy-that-must-never-be-selected",
    ]) expect(publicJson).not.toContain(privateValue);
  });
});
