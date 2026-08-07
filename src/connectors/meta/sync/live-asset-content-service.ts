import { ConnectorError } from "@/connectors/contract";
import { discoverMetaAssetMirror } from "@/connectors/meta/asset-mirror";
import { MetaGraphClient, META_GRAPH_API_VERSION, type MetaFetch } from "@/connectors/meta/graph-client";
import { discoverMetaPostMediaInventory } from "@/connectors/meta/post-media-inventory";
import type { CanonicalMetaAssetMirrorSnapshot } from "@/domain/meta/asset-mirror";
import { extractMetaAdContent } from "@/domain/meta/content/extract";
import type { CanonicalMetaPostMediaInventory } from "@/domain/meta/content/post-media-inventory";
import {
  hashMetaContentPayload,
  MetaAssetContentPersistenceRun,
  type MetaAssetContentPage,
  type MetaAssetContentRepository,
  type MetaAssetContentScope,
  type MetaAssetContentWriteSummary,
} from "./asset-content-persistence";
import { MetaGraphSyncTransport } from "./graph-transport";
import { classifyMetaSyncError } from "./runtime";
import { sliceId, stableHash, type MetaReadRequest, type MetaReadTransport, type MetaSyncErrorReason } from "./types";

const SERVICE_SCHEMA_VERSION = "meta-s14-live-v1";
const CONTENT_FIELD_CATALOG_VERSION = "meta-creative-post-v23";

export interface MetaSecretReferenceResolver {
  resolve(reference: string): Promise<string>;
}

export interface MetaAssetContentPageWriter {
  writePage(page: MetaAssetContentPage): Promise<MetaAssetContentWriteSummary>;
}

export interface MetaPostInventoryPersistencePort {
  persist(inventory: CanonicalMetaPostMediaInventory): Promise<void>;
}

export type BeginMetaAssetContentPersistenceRun = (
  scope: MetaAssetContentScope,
) => Promise<MetaAssetContentPageWriter>;

export function repositoryBackedMetaAssetContentRun(
  repository: MetaAssetContentRepository,
): BeginMetaAssetContentPersistenceRun {
  return (scope) => MetaAssetContentPersistenceRun.begin({ repository, scope });
}

type AssetDiscovery = (input: Readonly<{
  token: string;
  workspaceId: string;
  connectionExternalKey: string;
  fetchImpl?: MetaFetch;
  now?: () => Date;
}>) => Promise<CanonicalMetaAssetMirrorSnapshot>;

type PostInventoryDiscovery = (input: Readonly<{
  token: string;
  workspaceId: string;
  connectionExternalKey: string;
  fetchImpl?: MetaFetch;
  now?: () => Date;
  maxPagesPerActor?: number;
}>) => Promise<CanonicalMetaPostMediaInventory>;

export type MetaS14LiveReadOptions = Readonly<{
  secretResolver: MetaSecretReferenceResolver;
  beginPersistenceRun: BeginMetaAssetContentPersistenceRun;
  postInventoryPersistence?: MetaPostInventoryPersistencePort;
  fetchImpl?: MetaFetch;
  transportFactory?: (token: string) => MetaReadTransport;
  discoverAssets?: AssetDiscovery;
  discoverPostInventory?: PostInventoryDiscovery;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
  maxPagesPerAccount?: number;
  maxPagesPerActor?: number;
  accountConcurrency?: number;
  initialPageSize?: number;
  minPageSize?: number;
}>;

export type MetaS14AccountEvidence = Readonly<{
  accountRef: string;
  correlationId: string;
  status: "completed" | "partial";
  pagesRead: number;
  adsObserved: number;
  contentRecords: number;
  contentWithCopy: number;
  existingPostBindings: number;
  issueCount: number;
  failureReason: MetaSyncErrorReason | "page_limit" | "account_not_discovered" | null;
}>;

export type MetaS14LiveReadResult = Readonly<{
  schemaVersion: typeof SERVICE_SCHEMA_VERSION;
  runCorrelationId: string;
  status: "completed" | "partial";
  assetEvidence: Readonly<{
    assets: number;
    edges: number;
    verifiedDiscoveries: number;
    unavailableDiscoveries: number;
  }>;
  creativeEvidence: Readonly<{
    selectedAccounts: number;
    completedAccounts: number;
    partialAccounts: number;
    pagesRead: number;
    adsObserved: number;
    contentRecords: number;
    contentWithCopy: number;
    existingPostBindings: number;
    issueCount: number;
    accounts: readonly MetaS14AccountEvidence[];
  }>;
  postInventoryEvidence: Readonly<{
    status: "completed" | "partial";
    items: number;
    verifiedDiscoveries: number;
    partialDiscoveries: number;
    persistenceInvoked: boolean;
    extensionPersistenceInvoked: boolean;
    failureReason: MetaSyncErrorReason | null;
  }>;
  persistenceEvidence: Readonly<{
    pagesWritten: number;
    recordsSubmitted: number;
    inserted: number;
    updated: number;
    unchanged: number;
    stale: number;
  }>;
  writeNetworkCalls: 0;
}>;

export type MetaS14LiveReadInput = Readonly<{
  runId: string;
  workspaceId: string;
  connectionId: string;
  connectionExternalKey: string;
  secretReference: string;
  selectedAdAccountExternalIds: readonly string[];
  sliceKeys: Readonly<{
    /** Existing durable slice created by the parent planner/runtime for asset discovery. */
    asset: string;
    /** Existing durable slice created for the linked Page/Instagram post inventory. */
    postMedia: string;
    /** Must contain the canonical planner creative_post slice for every selected account. */
    creativeByAdAccountExternalId: Readonly<Record<string, string>>;
  }>;
}>;

type MutablePersistenceEvidence = {
  pagesWritten: number;
  recordsSubmitted: number;
  inserted: number;
  updated: number;
  unchanged: number;
  stale: number;
};

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function accountRef(accountId: string): string {
  return `account:${stableHash({ accountId }).slice(0, 12)}`;
}

function addWrite(
  evidence: MutablePersistenceEvidence,
  summary: MetaAssetContentWriteSummary,
): void {
  evidence.pagesWritten += 1;
  evidence.recordsSubmitted += summary.recordCount;
  evidence.inserted += summary.inserted;
  evidence.updated += summary.updated;
  evidence.unchanged += summary.unchanged;
  evidence.stale += summary.stale;
}

async function mapBounded<T, U>(
  inputs: readonly T[],
  concurrency: number,
  work: (input: T) => Promise<U>,
): Promise<readonly U[]> {
  const results = new Array<U>(inputs.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= inputs.length) return;
      results[index] = await work(inputs[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
  return results;
}

function hasCopy(extraction: ReturnType<typeof extractMetaAdContent>): boolean {
  return Boolean(
    extraction.creative.primaryText
    || extraction.creative.headline
    || extraction.creative.description
    || extraction.creative.caption
    || extraction.creative.dynamicVariants.length,
  );
}

/**
 * S1.4 read orchestrator. Raw IDs, tokens and ad text stay inside the connector/persistence
 * boundary; the returned result contains only deterministic references and aggregate evidence.
 */
export class MetaS14LiveAssetContentService {
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private readonly maxPagesPerAccount: number;
  private readonly maxPagesPerActor: number;
  private readonly accountConcurrency: number;
  private readonly initialPageSize: number;
  private readonly minPageSize: number;

  constructor(private readonly options: MetaS14LiveReadOptions) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? (async (milliseconds) => {
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
    });
    this.random = options.random ?? Math.random;
    this.maxAttempts = positiveInteger(options.maxAttempts ?? 3, "maxAttempts");
    this.maxPagesPerAccount = positiveInteger(options.maxPagesPerAccount ?? 100, "maxPagesPerAccount");
    this.maxPagesPerActor = positiveInteger(options.maxPagesPerActor ?? 20, "maxPagesPerActor");
    this.accountConcurrency = positiveInteger(options.accountConcurrency ?? 2, "accountConcurrency");
    this.initialPageSize = positiveInteger(options.initialPageSize ?? 100, "initialPageSize");
    this.minPageSize = positiveInteger(options.minPageSize ?? 25, "minPageSize");
    if (this.minPageSize > this.initialPageSize) throw new TypeError("minPageSize cannot exceed initialPageSize");
  }

  async run(input: MetaS14LiveReadInput): Promise<MetaS14LiveReadResult> {
    const runId = required(input.runId, "runId");
    const scope: MetaAssetContentScope = {
      workspaceId: required(input.workspaceId, "workspaceId"),
      connectionId: required(input.connectionId, "connectionId"),
      connectionExternalKey: required(input.connectionExternalKey, "connectionExternalKey"),
    };
    const secretReference = required(input.secretReference, "secretReference");
    const selectedAccounts = [...new Set(input.selectedAdAccountExternalIds.map((id) => required(id, "ad account")))].sort();
    if (!selectedAccounts.length) throw new TypeError("At least one ad account must be selected");
    const assetSliceKey = required(input.sliceKeys.asset, "asset slice key");
    const postMediaSliceKey = required(input.sliceKeys.postMedia, "post/media slice key");
    const creativeSliceKeys = new Map(selectedAccounts.map((accountId) => {
      const provided = required(
        input.sliceKeys.creativeByAdAccountExternalId[accountId] ?? "",
        `creative slice key for ${accountRef(accountId)}`,
      );
      const canonical = sliceId("creative_post", accountId, "ad", null, null);
      if (provided !== canonical) throw new TypeError(`Creative slice key is not canonical for ${accountRef(accountId)}`);
      return [accountId, provided] as const;
    }));
    const distinctSliceKeys = new Set([assetSliceKey, postMediaSliceKey, ...creativeSliceKeys.values()]);
    if (distinctSliceKeys.size !== selectedAccounts.length + 2) {
      throw new TypeError("Asset, post/media and per-account creative slice keys must be distinct");
    }

    let token: string;
    try {
      token = await this.options.secretResolver.resolve(secretReference);
    } catch {
      // Resolver/provider errors may embed secret material or provider-specific paths.
      throw new ConnectorError("authentication", "Meta secret reference güvenli biçimde çözülemedi", false);
    }
    if (!token.trim()) throw new ConnectorError("authentication", "Meta access token yapılandırılmadı", false);
    const fetchImpl = this.options.fetchImpl;
    const discoverAssets = this.options.discoverAssets ?? discoverMetaAssetMirror;
    const discoverPostInventory = this.options.discoverPostInventory ?? discoverMetaPostMediaInventory;
    const transport = this.options.transportFactory?.(token)
      ?? new MetaGraphSyncTransport(new MetaGraphClient(token, fetchImpl));
    const persistence = await this.options.beginPersistenceRun(scope);
    const runCorrelationId = stableHash({ runId, workspaceId: scope.workspaceId, connectionId: scope.connectionId });
    const persistenceEvidence: MutablePersistenceEvidence = {
      pagesWritten: 0,
      recordsSubmitted: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      stale: 0,
    };

    // All discovery HTTP completes before writePage opens a repository transaction.
    const assetSnapshot = await discoverAssets({
      token,
      workspaceId: scope.workspaceId,
      connectionExternalKey: scope.connectionExternalKey,
      fetchImpl,
      now: this.now,
    });
    addWrite(persistenceEvidence, await persistence.writePage({
      sliceKey: assetSliceKey,
      cursor: null,
      checkpoint: {
        schemaVersion: SERVICE_SCHEMA_VERSION,
        phase: "asset_mirror",
        runCorrelationId,
        snapshotHash: assetSnapshot.snapshotHash,
        assetCount: assetSnapshot.assets.length,
        edgeCount: assetSnapshot.edges.length,
        terminal: true,
      },
      assetSnapshot,
      content: [],
    }));

    const discoveredAccounts = new Set(assetSnapshot.adAccountExternalIds);
    const accountEvidence = await mapBounded(
      selectedAccounts,
      this.accountConcurrency,
      (accountId) => this.readCreativeAccount({
        accountId,
        discovered: discoveredAccounts.has(accountId),
        runId,
        runCorrelationId,
        transport,
        persistence,
        persistenceEvidence,
        sliceKey: creativeSliceKeys.get(accountId)!,
      }),
    );

    let postInventoryEvidence: MetaS14LiveReadResult["postInventoryEvidence"];
    try {
      // The callback receives the canonical result only after all linked-content HTTP has completed.
      const inventory = await discoverPostInventory({
        token,
        workspaceId: scope.workspaceId,
        connectionExternalKey: scope.connectionExternalKey,
        fetchImpl,
        now: this.now,
        maxPagesPerActor: this.maxPagesPerActor,
      });
      addWrite(persistenceEvidence, await persistence.writePage({
        sliceKey: postMediaSliceKey,
        cursor: null,
        checkpoint: {
          schemaVersion: SERVICE_SCHEMA_VERSION,
          phase: "post_media_inventory",
          runCorrelationId,
          itemCount: inventory.items.length,
          discoveryCount: inventory.discoveries.length,
          snapshotHash: inventory.snapshotHash,
          terminal: true,
        },
        postMediaInventory: inventory,
        content: [],
      }));
      if (this.options.postInventoryPersistence) {
        await this.options.postInventoryPersistence.persist(inventory);
      }
      postInventoryEvidence = {
        status: inventory.discoveries.some((entry) => entry.status === "partial" || entry.status === "unavailable" || entry.status === "permission_missing")
          ? "partial"
          : "completed",
        items: inventory.items.length,
        verifiedDiscoveries: inventory.discoveries.filter((entry) => entry.status === "verified" || entry.status === "empty").length,
        partialDiscoveries: inventory.discoveries.filter((entry) => entry.status !== "verified" && entry.status !== "empty").length,
        persistenceInvoked: true,
        extensionPersistenceInvoked: Boolean(this.options.postInventoryPersistence),
        failureReason: null,
      };
    } catch (error) {
      postInventoryEvidence = {
        status: "partial",
        items: 0,
        verifiedDiscoveries: 0,
        partialDiscoveries: 1,
        persistenceInvoked: false,
        extensionPersistenceInvoked: false,
        failureReason: classifyMetaSyncError(error).reason,
      };
    }

    const completedAccounts = accountEvidence.filter((entry) => entry.status === "completed").length;
    const resultStatus = completedAccounts === accountEvidence.length && postInventoryEvidence.status === "completed"
      ? "completed"
      : "partial";
    return {
      schemaVersion: SERVICE_SCHEMA_VERSION,
      runCorrelationId,
      status: resultStatus,
      assetEvidence: {
        assets: assetSnapshot.assets.length,
        edges: assetSnapshot.edges.length,
        verifiedDiscoveries: assetSnapshot.discoveries.filter((entry) => entry.status === "verified" || entry.status === "empty").length,
        unavailableDiscoveries: assetSnapshot.discoveries.filter((entry) => entry.status !== "verified" && entry.status !== "empty").length,
      },
      creativeEvidence: {
        selectedAccounts: accountEvidence.length,
        completedAccounts,
        partialAccounts: accountEvidence.length - completedAccounts,
        pagesRead: accountEvidence.reduce((sum, entry) => sum + entry.pagesRead, 0),
        adsObserved: accountEvidence.reduce((sum, entry) => sum + entry.adsObserved, 0),
        contentRecords: accountEvidence.reduce((sum, entry) => sum + entry.contentRecords, 0),
        contentWithCopy: accountEvidence.reduce((sum, entry) => sum + entry.contentWithCopy, 0),
        existingPostBindings: accountEvidence.reduce((sum, entry) => sum + entry.existingPostBindings, 0),
        issueCount: accountEvidence.reduce((sum, entry) => sum + entry.issueCount, 0),
        accounts: accountEvidence,
      },
      postInventoryEvidence,
      persistenceEvidence,
      writeNetworkCalls: 0,
    };
  }

  private async readCreativeAccount(input: Readonly<{
    accountId: string;
    discovered: boolean;
    runId: string;
    runCorrelationId: string;
    transport: MetaReadTransport;
    persistence: MetaAssetContentPageWriter;
    persistenceEvidence: MutablePersistenceEvidence;
    sliceKey: string;
  }>): Promise<MetaS14AccountEvidence> {
    const ref = accountRef(input.accountId);
    const correlationId = stableHash({ runId: input.runId, accountId: input.accountId, stream: "creative_post" });
    const evidence: {
      accountRef: string;
      correlationId: string;
      pagesRead: number;
      adsObserved: number;
      contentRecords: number;
      contentWithCopy: number;
      existingPostBindings: number;
      issueCount: number;
    } = {
      accountRef: ref,
      correlationId,
      pagesRead: 0,
      adsObserved: 0,
      contentRecords: 0,
      contentWithCopy: 0,
      existingPostBindings: 0,
      issueCount: 0,
    };
    if (!input.discovered) return { ...evidence, status: "partial", failureReason: "account_not_discovered" };

    let cursor: string | null = null;
    let pageSize = this.initialPageSize;
    for (let pageOrdinal = 1; pageOrdinal <= this.maxPagesPerAccount; pageOrdinal += 1) {
      const requestCursorId = stableHash({ correlationId, cursor });
      const request: MetaReadRequest = {
        method: "GET",
        stream: "creative_post",
        accountId: input.accountId,
        entityLevel: "ad",
        dateStart: null,
        dateStop: null,
        cursor,
        limit: pageSize,
        correlation: {
          parentRunId: input.runId,
          streamRunId: correlationId,
          accountId: input.accountId,
          sliceId: input.sliceKey,
          cursorId: requestCursorId,
        },
      };
      const fetched = await this.fetchBounded(input.transport, request);
      if ("error" in fetched) {
        return { ...evidence, status: "partial", failureReason: fetched.error };
      }
      const page = fetched.page;
      if (!Array.isArray(page.records) || !Number.isFinite(page.usageHeadroom) || page.usageHeadroom < 0 || page.usageHeadroom > 1) {
        return { ...evidence, status: "partial", failureReason: "malformed_response" };
      }
      const fetchedAt = this.now().toISOString();
      const records = page.records.map((payload) => ({
        adAccountExternalId: input.accountId,
        extraction: extractMetaAdContent(payload),
        sourceRevision: typeof payload.updated_time === "string" && payload.updated_time.trim()
          ? payload.updated_time
          : fetchedAt,
        sourcePayloadHash: hashMetaContentPayload(payload),
        sourceGraphVersion: META_GRAPH_API_VERSION,
        fieldCatalogVersion: CONTENT_FIELD_CATALOG_VERSION,
        fetchedAt,
      }));
      const nextCursor = page.nextCursor;
      let summary: MetaAssetContentWriteSummary;
      try {
        summary = await input.persistence.writePage({
          sliceKey: input.sliceKey,
          cursor: nextCursor,
          checkpoint: {
            schemaVersion: SERVICE_SCHEMA_VERSION,
            phase: "creative_post",
            runCorrelationId: input.runCorrelationId,
            accountRef: ref,
            correlationId,
            requestCursorId,
            cursorId: stableHash({ correlationId, cursor: nextCursor }),
            pageOrdinal,
            fetchedRecordCount: page.records.length,
            extractedContentCount: records.length,
            nextCursorPresent: nextCursor !== null,
            terminal: nextCursor === null,
          },
          content: records,
        });
      } catch {
        return { ...evidence, status: "partial", failureReason: "unknown" };
      }
      addWrite(input.persistenceEvidence, summary);
      evidence.pagesRead += 1;
      evidence.adsObserved += page.records.length;
      evidence.contentRecords += records.length;
      evidence.contentWithCopy += records.filter((record) => hasCopy(record.extraction)).length;
      evidence.existingPostBindings += records.filter((record) => record.extraction.post !== null).length;
      evidence.issueCount += records.reduce((sum, record) => sum + record.extraction.issues.length, 0);
      cursor = nextCursor;
      if (cursor === null) return { ...evidence, status: "completed", failureReason: null };
      pageSize = page.usageHeadroom < 0.2
        ? Math.max(this.minPageSize, Math.floor(pageSize / 2))
        : page.usageHeadroom > 0.7
          ? Math.min(500, pageSize + Math.max(1, Math.floor(pageSize / 4)))
          : pageSize;
      if (page.usageHeadroom <= 0.1) await this.sleep(250);
    }
    return { ...evidence, status: "partial", failureReason: "page_limit" };
  }

  private async fetchBounded(
    transport: MetaReadTransport,
    request: MetaReadRequest,
  ): Promise<Readonly<{ page: Awaited<ReturnType<MetaReadTransport["get"]>> }> | Readonly<{ error: MetaSyncErrorReason }>> {
    let reason: MetaSyncErrorReason = "unknown";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return { page: await transport.get(request) };
      } catch (error) {
        const classified = classifyMetaSyncError(error);
        reason = classified.reason;
        if (!classified.retryable || attempt === this.maxAttempts) break;
        await this.sleep(Math.round(100 * 2 ** (attempt - 1) * (0.5 + this.random())));
      }
    }
    return { error: reason };
  }
}
