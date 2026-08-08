import { existsSync } from "node:fs";
import { ConnectorError } from "@/connectors/contract";
import { MetaGraphClient, META_GRAPH_API_VERSION, type MetaFetch } from "@/connectors/meta/graph-client";
import { redactMetaAdSetTargetingShape } from "@/connectors/meta/targeting-shape-redactor";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const token = process.env.META_ACCESS_TOKEN?.trim();
if (!token) throw new Error("META_ACCESS_TOKEN yapılandırılmadı");

const ACCOUNT_LIMIT = 1;
const AD_SET_SAMPLE_LIMIT = 3;
const MAX_NETWORK_ATTEMPTS = 6;
const REQUEST_TIMEOUT_MS = 10_000;
let getNetworkCalls = 0;
let writeNetworkCalls = 0;

function allowedRequest(url: URL): boolean {
  const prefix = `/${META_GRAPH_API_VERSION}/`;
  if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com" || !url.pathname.startsWith(prefix)) return false;
  const params = [...url.searchParams.keys()].sort().join(",");
  if (url.pathname === `${prefix}me/adaccounts`) {
    return params === "fields,limit" && url.searchParams.get("fields") === "id"
      && url.searchParams.get("limit") === String(ACCOUNT_LIMIT);
  }
  return url.pathname.endsWith("/adsets") && params === "fields,limit"
    && url.searchParams.get("fields") === "targeting"
    && url.searchParams.get("limit") === String(AD_SET_SAMPLE_LIMIT);
}

const trackedFetch: MetaFetch = async (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" || init?.body !== undefined && init.body !== null) {
    writeNetworkCalls += 1;
    throw new Error("Canary yalnız gövdesiz GET çağrılarına izin verir");
  }
  const url = new URL(input);
  if (!allowedRequest(url)) throw new Error("Canary izin verilmeyen Meta okuma isteğini engelledi");
  getNetworkCalls += 1;
  if (getNetworkCalls > MAX_NETWORK_ATTEMPTS) throw new Error("Canary ağ çağrısı sınırını aştı");
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(url, { ...init, signal });
};

type GraphPage = Readonly<{ data?: readonly unknown[] }>;

function redactedFailureReason(error: unknown): string {
  if (error instanceof ConnectorError) return `connector_${error.code}`;
  return "canary_failed_closed";
}

try {
  const client = new MetaGraphClient(token, trackedFetch);
  const accountPage = await client.get<GraphPage>("/me/adaccounts", {
    fields: "id",
    limit: String(ACCOUNT_LIMIT),
  });
  const accountRecord = Array.isArray(accountPage.data) ? accountPage.data[0] : undefined;
  const accountId = typeof accountRecord === "object" && accountRecord !== null
    && typeof (accountRecord as Readonly<Record<string, unknown>>).id === "string"
    ? (accountRecord as Readonly<Record<string, string>>).id
    : null;
  if (!accountId) throw new Error("Canary için erişilebilir reklam hesabı bulunamadı");

  const adSetPage = await client.get<GraphPage>(`/${accountId}/adsets`, {
    fields: "targeting",
    limit: String(AD_SET_SAMPLE_LIMIT),
  });
  if (!Array.isArray(adSetPage.data)) throw new Error("Meta AdSet yanıtı beklenen yapıda değil");
  const records = adSetPage.data.slice(0, AD_SET_SAMPLE_LIMIT);
  const shape = redactMetaAdSetTargetingShape(records);

  console.log(JSON.stringify({
    status: "ok",
    graphApiVersion: META_GRAPH_API_VERSION,
    limits: { accounts: ACCOUNT_LIMIT, adSets: AD_SET_SAMPLE_LIMIT, maxNetworkAttempts: MAX_NETWORK_ATTEMPTS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS },
    getNetworkCalls,
    writeNetworkCalls,
    shape,
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    status: "failed_closed",
    reason: redactedFailureReason(error),
    graphApiVersion: META_GRAPH_API_VERSION,
    getNetworkCalls,
    writeNetworkCalls,
  }));
  process.exitCode = 1;
}
