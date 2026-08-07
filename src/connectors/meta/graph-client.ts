import { ConnectorError } from "@/connectors/contract";
import { withConnectorRetry } from "@/connectors/retry";

export const META_GRAPH_API_VERSION = "v23.0";
const META_GRAPH_ORIGIN = "https://graph.facebook.com";

export type MetaFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type GraphPage<T> = Readonly<{
  data?: readonly T[];
  paging?: Readonly<{ cursors?: Readonly<{ after?: string }> }>;
  summary?: Readonly<{ total_count?: number }>;
}>;

function retryAfterMilliseconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}

function connectorErrorFor(response: Response): ConnectorError {
  if (response.status === 401 || response.status === 403) {
    return new ConnectorError("authentication", "Meta kimlik doğrulaması veya varlık yetkisi başarısız", false);
  }
  if (response.status === 429) {
    return new ConnectorError("rate_limited", "Meta istek sınırına ulaşıldı", true, retryAfterMilliseconds(response));
  }
  if (response.status >= 500) {
    return new ConnectorError("transient", "Meta geçici olarak yanıt veremiyor", true);
  }
  return new ConnectorError("invalid_data", `Meta isteği reddetti (${response.status})`, false);
}

export class MetaGraphClient {
  readonly graphApiVersion: string;

  constructor(
    private readonly token: string,
    private readonly fetchImpl: MetaFetch = fetch,
    options: Readonly<{ graphApiVersion?: string }> = {},
  ) {
    if (!token.trim()) throw new ConnectorError("authentication", "Meta access token yapılandırılmadı", false);
    this.graphApiVersion = options.graphApiVersion ?? META_GRAPH_API_VERSION;
    if (!/^v\d+\.\d+$/.test(this.graphApiVersion)) {
      throw new ConnectorError("invalid_data", "Meta Graph API sürümü geçersiz", false);
    }
  }

  async get<T>(path: string, params: Readonly<Record<string, string>> = {}): Promise<T> {
    return withConnectorRetry(async () => {
      const url = new URL(`${META_GRAPH_ORIGIN}/${this.graphApiVersion}/${path.replace(/^\//, "")}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          cache: "no-store",
          headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
        });
      } catch {
        // Fetch implementations may include the complete request URL or Authorization
        // header in their native errors. Never let that material cross this boundary.
        throw new ConnectorError("transient", "Meta ağına güvenli bağlantı kurulamadı", true);
      }
      if (!response.ok) throw connectorErrorFor(response);
      try {
        return await response.json() as T;
      } catch {
        throw new ConnectorError("invalid_data", "Meta geçersiz JSON döndürdü", false);
      }
    }, { maxAttempts: 3, baseDelayMs: 300 });
  }

  async listAll<T>(
    path: string,
    params: Readonly<Record<string, string>>,
    maxPages = 20,
  ): Promise<readonly T[]> {
    const rows: T[] = [];
    let after: string | undefined;
    let pageNumber = 0;
    do {
      const page = await this.get<GraphPage<T>>(path, { ...params, ...(after ? { after } : {}) });
      if (!Array.isArray(page.data)) throw new ConnectorError("invalid_data", "Meta liste yanıtı data dizisi içermiyor", false);
      rows.push(...page.data);
      after = page.paging?.cursors?.after;
      pageNumber += 1;
    } while (after && pageNumber < maxPages);
    if (after) throw new ConnectorError("invalid_data", "Meta pagination güvenlik sınırını aştı", false);
    return rows;
  }

  async edgeSummary<T>(
    path: string,
    fields: string,
    limit: number,
  ): Promise<Readonly<{ rows: readonly T[]; totalCount: number }>> {
    const page = await this.get<GraphPage<T>>(path, {
      fields,
      limit: String(limit),
      summary: "true",
    });
    if (!Array.isArray(page.data)) throw new ConnectorError("invalid_data", "Meta edge yanıtı data dizisi içermiyor", false);
    return { rows: page.data, totalCount: page.summary?.total_count ?? page.data.length };
  }
}
