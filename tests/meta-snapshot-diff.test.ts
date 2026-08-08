import { describe, expect, it } from "vitest";
import golden from "./fixtures/meta-change-snapshot.json";
import {
  diffMetaChangeSnapshots,
  type MetaChangeSnapshotInput,
  MetaSnapshotDiffError,
  normalizeMetaChangeSnapshot,
} from "@/domain/meta/snapshot-diff";

function fixture(): MetaChangeSnapshotInput {
  return structuredClone(golden) as MetaChangeSnapshotInput;
}

function currentFixture(): MetaChangeSnapshotInput {
  const current = fixture();
  (current as { capturedAt: string }).capturedAt = "2026-08-07T10:00:00.000Z";
  (current.campaigns[0]!.dailyBudgetMinor as { state: "known"; value: number | null }).value = 120000;
  (current.adSets[0]!.targetingSignature as { state: "known"; value: string | null }).value =
    "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  (current.ads[0]!.configuredStatus as { state: "known"; value: string | null }).value = "PAUSED";
  (current.ads[0] as { creativeBindingSignature: unknown }).creativeBindingSignature = {
    state: "unknown",
    reason: "creative_field_not_returned",
  };
  return current;
}

describe("Meta versioned change snapshot", () => {
  it("is byte-stable across source ordering and carries resolved budget ownership", () => {
    const input = fixture();
    const first = normalizeMetaChangeSnapshot(input);
    const reordered = normalizeMetaChangeSnapshot({
      ...fixture(),
      campaigns: [...input.campaigns].reverse(),
      adSets: [...input.adSets].reverse(),
      ads: [...input.ads].reverse(),
    });

    expect(reordered).toEqual(first);
    expect(first.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.entities.find((entity) => entity.entityType === "campaign")?.fields.budget_owner).toEqual({
      state: "known",
      value: { model: "CBO", level: "campaign", budgetType: "daily", amountMinor: 100000 },
    });
    expect(first.entities.find((entity) => entity.entityType === "ad_set")?.fields.budget_owner).toEqual({
      state: "known",
      value: null,
    });
  });

  it("creates deterministic external and action-correlated internal events", () => {
    const previous = normalizeMetaChangeSnapshot(fixture());
    const current = normalizeMetaChangeSnapshot(currentFixture());
    const ledger = [
      {
        actionId: "action-budget-field",
        entityType: "campaign" as const,
        externalEntityId: golden.campaigns[0]!.externalCampaignId,
        field: "daily_budget_minor" as const,
        expectedFrom: 100000,
        expectedTo: 120000,
        appliedAt: "2026-08-07T09:00:00.000Z",
        verificationStatus: "verified" as const,
      },
      {
        actionId: "action-budget-owner",
        entityType: "campaign" as const,
        externalEntityId: golden.campaigns[0]!.externalCampaignId,
        field: "budget_owner" as const,
        expectedFrom: { model: "CBO" as const, level: "campaign" as const, budgetType: "daily" as const, amountMinor: 100000 },
        expectedTo: { model: "CBO" as const, level: "campaign" as const, budgetType: "daily" as const, amountMinor: 120000 },
        appliedAt: "2026-08-07T09:00:00.000Z",
        verificationStatus: "verified" as const,
      },
      {
        actionId: "action-pause",
        entityType: "ad" as const,
        externalEntityId: golden.ads[0]!.externalAdId,
        field: "configured_status" as const,
        expectedFrom: "ACTIVE",
        expectedTo: "PAUSED",
        appliedAt: "2026-08-07T09:30:00.000Z",
        verificationStatus: "verified" as const,
      },
    ];

    const first = diffMetaChangeSnapshots({ previous, current, actionLedger: ledger });
    const replay = diffMetaChangeSnapshots({ previous, current, actionLedger: [...ledger].reverse() });

    expect(replay).toEqual(first);
    expect(first.changes.map(({ entityType, field, classification }) => ({ entityType, field, classification }))).toEqual([
      { entityType: "campaign", field: "budget_owner", classification: "internal_expected" },
      { entityType: "campaign", field: "daily_budget_minor", classification: "internal_expected" },
      { entityType: "ad_set", field: "targeting_signature", classification: "external_change" },
      { entityType: "ad", field: "configured_status", classification: "internal_expected" },
    ]);
    expect(first.diagnostics.unknownComparisons).toBe(1);
    expect(first.timelineHash).toMatch(/^[a-f0-9]{64}$/);

    const unverified = diffMetaChangeSnapshots({
      previous,
      current,
      actionLedger: ledger.map((action) => ({ ...action, verificationStatus: "unverified" as const })),
    });
    expect(unverified.changes.every((change) => change.classification === "external_change")).toBe(true);
  });

  it("does not invent a change when either observation is unknown", () => {
    const previousInput = fixture();
    (previousInput.ads[0] as { creativeBindingSignature: unknown }).creativeBindingSignature = {
      state: "unknown",
      reason: "not_returned",
    };
    const currentInput = currentFixture();
    (currentInput.ads[0] as { creativeBindingSignature: unknown }).creativeBindingSignature = {
      state: "known",
      value: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    };
    const timeline = diffMetaChangeSnapshots({
      previous: normalizeMetaChangeSnapshot(previousInput),
      current: normalizeMetaChangeSnapshot(currentInput),
    });

    expect(timeline.changes).not.toContainEqual(expect.objectContaining({ field: "creative_binding_signature" }));
    expect(timeline.diagnostics.unknownComparisons).toBeGreaterThan(0);
  });

  it("returns only opaque refs and safe tracked values in the public timeline", () => {
    const timeline = diffMetaChangeSnapshots({
      previous: normalizeMetaChangeSnapshot(fixture()),
      current: normalizeMetaChangeSnapshot(currentFixture()),
    });
    const serialized = JSON.stringify(timeline);

    expect(timeline.changes.every((change) => /^ref_[a-f0-9]{20}$/.test(change.entityRef))).toBe(true);
    expect(serialized).not.toContain(golden.workspaceId);
    expect(serialized).not.toContain(golden.externalAccountId);
    expect(serialized).not.toContain(golden.campaigns[0]!.externalCampaignId);
    expect(serialized).not.toContain(golden.adSets[0]!.externalAdSetId);
    expect(serialized).not.toContain(golden.ads[0]!.externalAdId);
    expect(serialized).not.toMatch(/access[_-]?token|primaryText|headline|caption|ad copy/i);
  });
});

describe("Meta snapshot diff fail-closed boundaries", () => {
  it("rejects raw targeting values and orphan hierarchy", () => {
    const rawTargeting = fixture();
    (rawTargeting.adSets[0]!.targetingSignature as { state: "known"; value: string | null }).value = "Istanbul women 25-55";
    expect(() => normalizeMetaChangeSnapshot(rawTargeting)).toThrowError(
      expect.objectContaining<Partial<MetaSnapshotDiffError>>({ code: "invalid_snapshot" }),
    );

    const orphan = fixture();
    (orphan.ads[0] as { externalAdSetId: string }).externalAdSetId = "missing_set";
    expect(() => normalizeMetaChangeSnapshot(orphan)).toThrowError(
      expect.objectContaining<Partial<MetaSnapshotDiffError>>({ code: "orphan_parent" }),
    );
  });

  it("rejects cross-account/time-inverted diffs and malformed ledger timestamps", () => {
    const previous = normalizeMetaChangeSnapshot(fixture());
    const other = currentFixture();
    (other as { externalAccountId: string }).externalAccountId = "act_other";
    expect(() => diffMetaChangeSnapshots({ previous, current: normalizeMetaChangeSnapshot(other) })).toThrowError(
      expect.objectContaining<Partial<MetaSnapshotDiffError>>({ code: "incompatible_snapshots" }),
    );

    const tampered = structuredClone(normalizeMetaChangeSnapshot(currentFixture()));
    (tampered as { snapshotHash: string }).snapshotHash = "x".repeat(64);
    expect(() => diffMetaChangeSnapshots({ previous, current: tampered })).toThrowError(
      expect.objectContaining<Partial<MetaSnapshotDiffError>>({ code: "incompatible_snapshots" }),
    );

    expect(() => diffMetaChangeSnapshots({
      previous,
      current: normalizeMetaChangeSnapshot(currentFixture()),
      actionLedger: [{
        actionId: "bad-action",
        entityType: "ad",
        externalEntityId: golden.ads[0]!.externalAdId,
        field: "configured_status",
        expectedFrom: "ACTIVE",
        expectedTo: "PAUSED",
        appliedAt: "not-a-date",
        verificationStatus: "verified",
      }],
    })).toThrowError(expect.objectContaining<Partial<MetaSnapshotDiffError>>({ code: "invalid_action" }));
  });
});
