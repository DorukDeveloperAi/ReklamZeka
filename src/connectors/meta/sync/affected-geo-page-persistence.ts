import type { CanonicalAffectedGeoCountrySnapshot } from "@/domain/meta/affected-geo-country-snapshot";
import { affectedGeoSnapshotFromCanonicalInventoryAdSetRaw } from "./affected-geo-inventory-adapter";
import type { CanonicalMetaInventoryAdSet, CanonicalMetaInventoryPage,
  MetaInventoryCanonicalWriteOutcome } from "./inventory-materialization";

export type MetaAffectedGeoResolvedAdSet = Readonly<{
  externalAdSetId: string;
  campaignId: string;
  adSetId: string;
}>;

export type MetaAffectedGeoAppendPort = Readonly<{
  append(input: Readonly<{ workspaceId: string; adAccountId: string; campaignId: string; adSetId: string;
    snapshot: CanonicalAffectedGeoCountrySnapshot }>): Promise<Readonly<{ outcome: "inserted" | "unchanged" }>>;
}>;

export type MetaAffectedGeoPagePersistenceResult = Readonly<{
  known: number;
  unknown: number;
  stale: number;
  inserted: number;
  unchanged: number;
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function privateRecords(value: unknown): readonly Readonly<Record<string, unknown>>[] | null {
  if (!isObject(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "records")
    || !Array.isArray(value.records) || value.records.some((record) => !isObject(record))) return null;
  return value.records as readonly Readonly<Record<string, unknown>>[];
}

function fail(): never { throw new Error("Meta affected-geo private page binding doğrulanamadı"); }

/**
 * Runs inside the canonical inventory transaction. Unknown targeting creates no
 * evidence; corrupt source/hierarchy bindings fail the complete page closed.
 */
export async function appendKnownAffectedGeoForCanonicalAdSetPage(input: Readonly<{
  page: CanonicalMetaInventoryPage;
  privateSource: unknown;
  adAccountId: string;
  hierarchy: readonly MetaAffectedGeoResolvedAdSet[];
  outcomes: readonly MetaInventoryCanonicalWriteOutcome[];
  repository: MetaAffectedGeoAppendPort;
}>): Promise<MetaAffectedGeoPagePersistenceResult> {
  if (input.page.entityLevel !== "ad_set" || input.page.records.length !== input.outcomes.length) fail();
  const records = input.page.records as readonly CanonicalMetaInventoryAdSet[];
  const rawRecords = privateRecords(input.privateSource);
  if (!rawRecords || rawRecords.length !== records.length) fail();
  const resolved = new Map<string, MetaAffectedGeoResolvedAdSet>();
  for (const row of input.hierarchy) {
    if (resolved.has(row.externalAdSetId)) fail();
    resolved.set(row.externalAdSetId, row);
  }
  if (resolved.size !== records.length) fail();

  let known = 0; let unknown = 0; let stale = 0; let inserted = 0; let unchanged = 0;
  for (let index = 0; index < records.length; index += 1) {
    const canonical = records[index]!; const raw = rawRecords[index]!; const hierarchy = resolved.get(canonical.externalId);
    if (!hierarchy || raw.id !== canonical.externalId || raw.campaign_id !== canonical.externalCampaignId) fail();
    const material = affectedGeoSnapshotFromCanonicalInventoryAdSetRaw({
      workspaceId: input.page.workspaceId, connectionId: input.page.connectionId,
      externalAccountId: input.page.externalAccountId, entityLevel: "ad_set",
      parentRunId: input.page.parentRunId, sliceId: input.page.sliceId, cursorId: input.page.cursorId,
      pageHash: input.page.pageHash, observedAt: input.page.observedAt,
      sourceGraphVersion: canonical.trace.sourceGraphVersion,
      fieldCatalogVersion: canonical.trace.fieldCatalogVersion,
      rawPayloadHash: canonical.trace.rawPayloadHash, rawRecord: raw,
    });
    if (material.status !== "bound") fail();
    if (input.outcomes[index] === "stale") { stale += 1; continue; }
    if (material.snapshot.status !== "known") { unknown += 1; continue; }
    known += 1;
    const result = await input.repository.append({ workspaceId: input.page.workspaceId,
      adAccountId: input.adAccountId, campaignId: hierarchy.campaignId, adSetId: hierarchy.adSetId,
      snapshot: material.snapshot });
    if (result.outcome === "inserted") inserted += 1; else unchanged += 1;
  }
  return Object.freeze({ known, unknown, stale, inserted, unchanged });
}
