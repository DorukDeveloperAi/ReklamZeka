import { createHash } from "node:crypto";
import { ConnectorError } from "@/connectors/contract";
import { META_GRAPH_API_VERSION, type MetaFetch } from "@/connectors/meta/graph-client";
import {
  META_POST_MEDIA_INVENTORY_SCHEMA_VERSION,
  contentHashFor,
  normalizeMetaPostMediaInventory,
  type CanonicalMetaPostMediaInventory,
  type MetaContentLifecycle,
  type MetaContentMediaType,
  type MetaPostMediaDiscovery,
  type MetaPostMediaItem,
  type MetaPostMediaProvenance,
} from "@/domain/meta/content/post-media-inventory";

const GRAPH_ORIGIN = "https://graph.facebook.com";
const FIELD_CATALOG_VERSION = "meta-post-media-v1";

type GraphPage<T> = Readonly<{
  data?: readonly T[];
  paging?: Readonly<{ cursors?: Readonly<{ after?: string }> }>;
}>;

type RawInstagramActor = Readonly<{ id?: string; username?: string; name?: string }>;
type RawPageActor = Readonly<{
  id?: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: RawInstagramActor;
}>;
type RawPagePost = Readonly<{
  id?: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  status_type?: string;
  is_published?: boolean;
  attachments?: Readonly<{ data?: readonly Readonly<{ media_type?: string; type?: string }>[] }>;
}>;
type RawInstagramMedia = Readonly<{
  id?: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  username?: string;
}>;

type SafeFailure = Readonly<{ status: "permission_missing" | "unavailable" }>;
type SafeListResult<T> = Readonly<{ rows: readonly T[]; truncated: boolean }> | SafeFailure;

export type DiscoverMetaPostMediaInventoryOptions = Readonly<{
  token: string;
  workspaceId: string;
  connectionExternalKey: string;
  fetchImpl?: MetaFetch;
  now?: () => Date;
  maxPagesPerActor?: number;
}>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function cleanText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isoOrNull(value: string | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function safePermalink(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function pageMediaType(post: RawPagePost): MetaContentMediaType {
  const values = post.attachments?.data?.flatMap((entry) => [entry.media_type, entry.type])
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => entry.toLowerCase()) ?? [];
  if (values.some((entry) => entry.includes("album") || entry.includes("carousel"))) return "carousel";
  if (values.some((entry) => entry.includes("video"))) return "video";
  if (values.some((entry) => entry.includes("photo") || entry.includes("image"))) return "image";
  if (values.some((entry) => entry.includes("link"))) return "link";
  return post.message ? "text" : "unknown";
}

function instagramMediaType(media: RawInstagramMedia): MetaContentMediaType {
  switch (media.media_type?.toUpperCase()) {
    case "IMAGE": return "image";
    case "VIDEO": return "video";
    case "CAROUSEL_ALBUM": return "carousel";
    default: return "unknown";
  }
}

function pageLifecycle(post: RawPagePost): MetaContentLifecycle {
  if (post.is_published === true) return "published";
  if (post.is_published === false) return "hidden";
  return "unknown";
}

function provenance(sourceEdge: string, raw: unknown, fetchedAt: string): MetaPostMediaProvenance {
  return {
    sourceEdge,
    sourceGraphVersion: META_GRAPH_API_VERSION,
    fieldCatalogVersion: FIELD_CATALOG_VERSION,
    fetchedAt,
    rawPayloadHash: hash(raw),
  };
}

function graphFailure(status: number, payload: unknown): SafeFailure {
  let code: number | undefined;
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "number") {
      code = (error as { code: number }).code;
    }
  }
  return { status: status === 401 || status === 403 || code === 10 || code === 190 ? "permission_missing" : "unavailable" };
}

async function listAll<T>(input: Readonly<{
  path: string;
  fields: string;
  token: string;
  fetchImpl: MetaFetch;
  maxPages: number;
}>): Promise<SafeListResult<T>> {
  const rows: T[] = [];
  let after: string | undefined;
  for (let pageNumber = 0; pageNumber < input.maxPages; pageNumber += 1) {
    const url = new URL(`${GRAPH_ORIGIN}/${META_GRAPH_API_VERSION}/${input.path.replace(/^\//, "")}`);
    url.searchParams.set("fields", input.fields);
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    let response: Response;
    try {
      response = await input.fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json" },
      });
    } catch {
      return { status: "unavailable" };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "unavailable" };
    }
    if (!response.ok) return graphFailure(response.status, payload);
    const graphPage = payload as GraphPage<T>;
    if (!Array.isArray(graphPage.data)) return { status: "unavailable" };
    rows.push(...graphPage.data);
    after = graphPage.paging?.cursors?.after;
    if (!after) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

function isFailure<T>(value: SafeListResult<T>): value is SafeFailure {
  return "status" in value;
}

function discovery(
  actorType: MetaPostMediaDiscovery["actorType"],
  actorExternalId: string,
  sourceEdge: string,
  result: SafeListResult<unknown>,
): MetaPostMediaDiscovery {
  if (isFailure(result)) {
    return {
      actorType,
      actorExternalId,
      sourceEdge,
      status: result.status,
      itemCount: 0,
      reason: result.status === "permission_missing" ? "permission_missing" : "temporarily_unavailable",
      promotionEligibility: result.status === "permission_missing" ? "permission_missing" : "unknown",
    };
  }
  if (result.truncated) {
    return {
      actorType,
      actorExternalId,
      sourceEdge,
      status: "partial",
      itemCount: result.rows.length,
      reason: "pagination_limit",
      promotionEligibility: "unknown",
    };
  }
  return {
    actorType,
    actorExternalId,
    sourceEdge,
    status: result.rows.length ? "verified" : "empty",
    itemCount: result.rows.length,
    reason: null,
    promotionEligibility: "unknown",
  };
}

/**
 * GET-only linked Page/Instagram content reader. Page access tokens obtained from
 * `/me/accounts` remain function-local and are never copied into domain objects,
 * provenance, errors, checkpoints or the public projection.
 */
export async function discoverMetaPostMediaInventory(
  options: DiscoverMetaPostMediaInventoryOptions,
): Promise<CanonicalMetaPostMediaInventory> {
  if (!options.token.trim()) throw new TypeError("Meta access token is required");
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  const maxPages = options.maxPagesPerActor ?? 20;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new TypeError("maxPagesPerActor must be a positive integer");

  const accountRows = await listAll<RawPageActor>({
    path: "/me/accounts",
    fields: "id,name,access_token,instagram_business_account{id,username,name}",
    token: options.token,
    fetchImpl,
    maxPages: 20,
  });
  const items: MetaPostMediaItem[] = [];
  const discoveries: MetaPostMediaDiscovery[] = [];

  if (isFailure(accountRows)) {
    throw new ConnectorError(
      accountRows.status === "permission_missing" ? "authentication" : "transient",
      accountRows.status === "permission_missing"
        ? "Meta Page bağlantısı için erişim izni bulunamadı"
        : "Meta Page bağlantısı geçici olarak okunamadı",
      accountRows.status !== "permission_missing",
    );
  }
  if (accountRows.truncated) {
    throw new ConnectorError("invalid_data", "Meta Page envanteri pagination güvenlik sınırına ulaştı", false);
  }

  for (const page of accountRows.rows.filter((row): row is RawPageActor & { id: string } => Boolean(row.id?.trim()))) {
      // Deliberately do not retain this value outside the current actor iteration.
      const actorToken = page.access_token?.trim();
      const pageEdge = `/${page.id}/posts`;
      if (!actorToken) {
        const missingAccess: SafeFailure = { status: "permission_missing" };
        discoveries.push(discovery("facebook_page", page.id, pageEdge, missingAccess));
        if (page.instagram_business_account?.id?.trim()) {
          discoveries.push(discovery(
            "instagram_account",
            page.instagram_business_account.id,
            `/${page.instagram_business_account.id}/media`,
            missingAccess,
          ));
        }
        continue;
      }
      const posts = await listAll<RawPagePost>({
        path: pageEdge,
        fields: "id,message,created_time,permalink_url,status_type,is_published,attachments{media_type,type}",
        token: actorToken,
        fetchImpl,
        maxPages,
      });
      discoveries.push(discovery("facebook_page", page.id, pageEdge, posts));
      if (!isFailure(posts)) {
        for (const post of posts.rows.filter((row): row is RawPagePost & { id: string } => Boolean(row.id?.trim()))) {
          const publishedAt = isoOrNull(post.created_time);
          const lifecycle = pageLifecycle(post);
          const messageOrCaption = cleanText(post.message);
          const mediaType = pageMediaType(post);
          items.push({
            externalContentId: post.id,
            contentKind: "page_post",
            actor: { type: "facebook_page", externalId: page.id, displayName: cleanText(page.name), username: null },
            messageOrCaption,
            mediaType,
            publishedAt,
            lifecycle,
            contentHash: contentHashFor({
              externalContentId: post.id,
              contentKind: "page_post",
              actorType: "facebook_page",
              actorExternalId: page.id,
              messageOrCaption,
              mediaType,
              publishedAt,
              lifecycle,
            }),
            ownership: { kind: "accessible", evidence: "/me/accounts" },
            readCapability: { status: "verified", evidence: "edge_read_succeeded" },
            promotionEligibility: { status: "unknown", reason: "not_verified_by_inventory_read" },
            previewSource: { classification: "server_only_sensitive", permalink: safePermalink(post.permalink_url) },
            provenance: provenance(pageEdge, post, fetchedAt),
          });
        }
      }

      const instagram = page.instagram_business_account;
      if (!instagram?.id?.trim()) continue;
      const instagramEdge = `/${instagram.id}/media`;
      const mediaRows = await listAll<RawInstagramMedia>({
        path: instagramEdge,
        fields: "id,caption,media_type,media_product_type,permalink,timestamp,username",
        token: actorToken,
        fetchImpl,
        maxPages,
      });
      discoveries.push(discovery("instagram_account", instagram.id, instagramEdge, mediaRows));
      if (isFailure(mediaRows)) continue;
      for (const media of mediaRows.rows.filter((row): row is RawInstagramMedia & { id: string } => Boolean(row.id?.trim()))) {
        const publishedAt = isoOrNull(media.timestamp);
        const messageOrCaption = cleanText(media.caption);
        const mediaType = instagramMediaType(media);
        const lifecycle: MetaContentLifecycle = publishedAt ? "published" : "unknown";
        items.push({
          externalContentId: media.id,
          contentKind: "instagram_media",
          actor: {
            type: "instagram_account",
            externalId: instagram.id,
            displayName: cleanText(instagram.name),
            username: cleanText(media.username) ?? cleanText(instagram.username),
          },
          messageOrCaption,
          mediaType,
          publishedAt,
          lifecycle,
          contentHash: contentHashFor({
            externalContentId: media.id,
            contentKind: "instagram_media",
            actorType: "instagram_account",
            actorExternalId: instagram.id,
            messageOrCaption,
            mediaType,
            publishedAt,
            lifecycle,
          }),
          ownership: { kind: "linked", evidence: "facebook_page.instagram_business_account" },
          readCapability: { status: "verified", evidence: "edge_read_succeeded" },
          promotionEligibility: { status: "unknown", reason: "not_verified_by_inventory_read" },
          previewSource: { classification: "server_only_sensitive", permalink: safePermalink(media.permalink) },
          provenance: provenance(instagramEdge, media, fetchedAt),
        });
      }
  }

  return normalizeMetaPostMediaInventory({
    schemaVersion: META_POST_MEDIA_INVENTORY_SCHEMA_VERSION,
    workspaceId: options.workspaceId,
    connectionExternalKey: options.connectionExternalKey,
    fetchedAt,
    items,
    discoveries,
    writeOperations: 0,
  });
}
