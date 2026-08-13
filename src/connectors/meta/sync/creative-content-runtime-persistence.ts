import { extractMetaAdContent } from "@/domain/meta/content/extract";

import {
  hashMetaContentPayload,
  type MetaAssetContentPage,
  type MetaAssetContentWriteSummary,
  type MetaAssetContentScope,
} from "./asset-content-persistence";

export const META_CREATIVE_CONTENT_FIELD_CATALOG_VERSION = "meta-creative-post-v23" as const;

export type MetaCreativeSourcePage = Readonly<{
  workspaceId: string;
  connectionId: string;
  externalAccountId: string;
  parentRunId: string;
  sliceId: string;
  cursorId: string;
  nextCursor: string | null;
  observedAt: string;
  sourceGraphVersion: string;
  fieldCatalogVersion: string;
  records: readonly Readonly<Record<string, unknown>>[];
}>;

/**
 * Runtime boundary for the canonical creative/Page/Instagram content writer.
 * It is deliberately persistence-only: Graph reads are completed by the
 * runtime before this port is invoked, and this port has no transport/token.
 */
export interface MetaCreativeSourcePagePersistencePort {
  writeSourcePage(page: MetaCreativeSourcePage): Promise<MetaAssetContentWriteSummary>;
}

type MetaAssetContentPageWriter = Readonly<{
  writePage(page: MetaAssetContentPage): Promise<MetaAssetContentWriteSummary>;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

/**
 * Adapts a normal `MetaAssetContentPersistenceRun` page writer to the partial
 * sync runtime. The writer resolves its tenant/account scope once; every page
 * thereafter is derived solely from the already-read `creative_post` payload.
 */
export class MetaCreativeContentRuntimePersistence implements MetaCreativeSourcePagePersistencePort {
  private writer: Promise<MetaAssetContentPageWriter> | null = null;

  constructor(
    private readonly scope: MetaAssetContentScope,
    private readonly begin: (scope: MetaAssetContentScope) => Promise<MetaAssetContentPageWriter>,
  ) {
    required(scope.workspaceId, "workspaceId");
    required(scope.connectionId, "connectionId");
    required(scope.connectionExternalKey, "connectionExternalKey");
  }

  async writeSourcePage(page: MetaCreativeSourcePage): Promise<MetaAssetContentWriteSummary> {
    if (
      page.workspaceId !== this.scope.workspaceId
      || page.connectionId !== this.scope.connectionId
    ) throw new TypeError("Creative source page scope does not match persistence scope");
    const writer = await (this.writer ??= this.begin(this.scope));
    const observedAt = required(page.observedAt, "observedAt");
    const sourceGraphVersion = required(page.sourceGraphVersion, "sourceGraphVersion");
    const fieldCatalogVersion = required(page.fieldCatalogVersion, "fieldCatalogVersion");
    const records = page.records.map((payload) => ({
      adAccountExternalId: required(page.externalAccountId, "externalAccountId"),
      extraction: extractMetaAdContent(payload),
      sourceRevision: typeof payload.updated_time === "string" && payload.updated_time.trim()
        ? payload.updated_time
        : observedAt,
      sourcePayloadHash: hashMetaContentPayload(payload),
      sourceGraphVersion,
      fieldCatalogVersion,
      fetchedAt: observedAt,
    }));
    return writer.writePage({
      sliceKey: required(page.sliceId, "sliceId"),
      cursor: page.nextCursor,
      checkpoint: {
        schemaVersion: "meta-creative-runtime-persistence/1.0.0",
        phase: "creative_post",
        parentRunId: required(page.parentRunId, "parentRunId"),
        cursorId: required(page.cursorId, "cursorId"),
        observedAt,
        sourceGraphVersion,
        fieldCatalogVersion,
        recordCount: records.length,
        terminal: page.nextCursor === null,
      },
      content: records,
    });
  }
}
