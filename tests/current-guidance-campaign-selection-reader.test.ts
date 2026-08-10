import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CurrentGuidanceCampaignSelectionReader, CurrentGuidanceCampaignSelectionReaderError } from "@/connectors/guidance/current-guidance-campaign-selection-reader";
import { GUIDANCE_CAMPAIGN_SELECTION_VERSION } from "@/connectors/guidance/guidance-campaign-selection-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const capturedAt = "2026-08-10T12:00:00.000Z";
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
const core = Object.freeze({ selectionRef: "guidance_selection_primary", revision: 1, selectedSetRef: "set_primary",
  selectedSetVersion: 1, selectedSetHash: "a".repeat(64), topics: ["quality"], requiredTopics: [],
  budget: { maxCards: 10, maxSources: 20, maxCharacters: 1000 }, effectiveAt: capturedAt });
const sourceSelectionHash = digest({ selectionVersion: GUIDANCE_CAMPAIGN_SELECTION_VERSION, selectedSetRef: core.selectedSetRef,
  selectedSetVersion: core.selectedSetVersion, selectedSetHash: core.selectedSetHash, topics: core.topics,
  requiredTopics: core.requiredTopics, budget: core.budget, effectiveAt: core.effectiveAt });
const selectionHash = digest({ ...core, sourceSelectionHash, previousSelectionHash: "GENESIS", actorRef: "actor_owner", actorRole: "owner", occurredAt: capturedAt });
function row(overrides: Record<string, unknown> = {}) {
  return { selection_ref: core.selectionRef, revision: 1, selection_version: GUIDANCE_CAMPAIGN_SELECTION_VERSION,
    selected_set_ref: core.selectedSetRef, selected_set_version: 1, selected_set_hash: core.selectedSetHash,
    topics: core.topics, required_topics: core.requiredTopics, budget: core.budget, source_selection_hash: sourceSelectionHash,
    effective_at: capturedAt, previous_selection_hash: "GENESIS", selection_hash: selectionHash, actor_ref: "actor_owner",
    actor_role: "owner", occurred_at: capturedAt, created_at: capturedAt, database_now: capturedAt, ...overrides };
}
function reader(candidate = row()) {
  const execute = vi.fn(async () => ({ rows: [candidate] }));
  const guidanceReader = { readCurrentInTransaction: vi.fn(async () => ({ capturedAt, registryHash: "b".repeat(64),
    reviewedSets: [{ setRef: core.selectedSetRef, setVersion: 1, setHash: core.selectedSetHash, cards: [] }] })) };
  return { execute, reader: new CurrentGuidanceCampaignSelectionReader(guidanceReader) };
}

describe("CurrentGuidanceCampaignSelectionReader", () => {
  it("reads the exact head revision and reviewed manifest in the caller snapshot", async () => {
    const harness = reader();
    await expect(harness.reader.readCurrentInTransaction({ execute: harness.execute } as never,
      { workspaceId, accountRef: "account_primary", campaignRef: "campaign_primary" }, capturedAt)).resolves.toMatchObject({
      selectionRef: core.selectionRef, sourceSelectionHash, selectionHash,
    });
  });

  it("fails closed on a tampered selection hash", async () => {
    const harness = reader(row({ selection_hash: "c".repeat(64) }));
    await expect(harness.reader.readCurrentInTransaction({ execute: harness.execute } as never,
      { workspaceId, accountRef: "account_primary", campaignRef: "campaign_primary" }, capturedAt))
      .rejects.toEqual(expect.objectContaining<Partial<CurrentGuidanceCampaignSelectionReaderError>>({ code: "corrupt_store" }));
  });
});
