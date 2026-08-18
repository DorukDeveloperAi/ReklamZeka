import "server-only";

import { ConnectorError } from "@/connectors/contract";
import {
  META_GRAPH_API_VERSION,
  type MetaFetch,
} from "@/connectors/meta/graph-client";
import {
  p06ExecutionV2Digest,
  type P06ExecutionV2ReadEvidence,
  type P06ExecutionV2Receipt,
  type P06ExecutionV2WriteCore,
  type P06ExecutionV2Writer,
} from "@/domain/actions/p06-execution-v2";

const GRAPH_ORIGIN = "https://graph.facebook.com";
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const WRITE_TARGET = /^(?:campaign|adset)_([0-9]{5,32})$/;
// The pure v2 contract uses the 64-hex digest directly; the durable ledger
// namespaces the same digest for its database identity.
const IDEMPOTENCY_KEY = /^(?:p06_exec_idem_)?[a-f0-9]{64}$/;
const MAX_BODY_BYTES = 1_048_576;

const digest = p06ExecutionV2Digest;

function targetId(entityRef: string): string {
  const match = WRITE_TARGET.exec(entityRef);
  if (!match)
    throw new ConnectorError(
      "invalid_data",
      "Meta yazma hedefi desteklenmiyor",
      false,
    );
  return match[1]!;
}

function status(value: unknown): "ACTIVE" | "PAUSED" {
  if (value === "ACTIVE" || value === "PAUSED") return value;
  throw new ConnectorError(
    "invalid_data",
    "Meta status yanıtı kanonik değil",
    false,
  );
}

function responseError(response: Response): ConnectorError {
  if (response.status === 401 || response.status === 403) {
    return new ConnectorError(
      "authentication",
      "Meta yazma yetkisi doğrulanamadı",
      false,
    );
  }
  if (response.status === 429)
    return new ConnectorError(
      "rate_limited",
      "Meta yazma sınırı aşıldı",
      false,
    );
  return new ConnectorError(
    response.status >= 500 ? "transient" : "invalid_data",
    `Meta status isteği reddedildi (${response.status})`,
    false,
  );
}

/**
 * Server-private typed status/budget Meta transport. Mutations are deliberately never
 * retried: once a request may have left the process, transport/5xx/body failures
 * become an ambiguous receipt and the execution state machine must read Meta
 * again before deciding whether another write is permissible.
 */
export class P06MetaStatusWriter implements P06ExecutionV2Writer {
  readonly #token: string;

  constructor(
    token: string,
    private readonly fetchImpl: MetaFetch = fetch,
    private readonly options: Readonly<{
      graphApiVersion?: string;
      requestTimeoutMs?: number;
      now?: () => Date;
    }> = {},
  ) {
    if (!token.trim())
      throw new ConnectorError(
        "authentication",
        "Meta access token yapılandırılmadı",
        false,
      );
    this.#token = token;
    if (
      !/^v\d+\.\d+$/.test(this.graphApiVersion) ||
      !Number.isInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 1_000 ||
      this.requestTimeoutMs > 60_000
    ) {
      throw new ConnectorError(
        "invalid_data",
        "Meta writer yapılandırması geçersiz",
        false,
      );
    }
  }

  private get graphApiVersion(): string {
    return this.options.graphApiVersion ?? META_GRAPH_API_VERSION;
  }
  private get requestTimeoutMs(): number {
    return this.options.requestTimeoutMs ?? 20_000;
  }
  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<Readonly<{ response: Response; body: unknown }>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(
        `${GRAPH_ORIGIN}/${this.graphApiVersion}/${path}`,
        {
          ...init,
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.#token}`,
            Accept: "application/json",
            ...init.headers,
          },
        },
      );
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
        throw new ConnectorError(
          "invalid_data",
          "Meta yanıtı güvenlik sınırını aştı",
          false,
        );
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ConnectorError(
          "invalid_data",
          "Meta geçersiz JSON döndürdü",
          false,
        );
      }
      return { response, body };
    } finally {
      clearTimeout(timer);
    }
  }

  async read(
    input: Parameters<P06ExecutionV2Writer["read"]>[0],
  ): Promise<P06ExecutionV2ReadEvidence> {
    if (
      !REF.test(input.workspaceRef) ||
      !REF.test(input.accountRef) ||
      !REF.test(input.entityRef) ||
      !["status_pause", "status_activate", "budget_decrease", "budget_increase"].includes(input.action)
    ) {
      throw new ConnectorError(
        "invalid_data",
        "Meta okuma bağlamı geçersiz",
        false,
      );
    }
    const id = targetId(input.entityRef);
    let result: Awaited<ReturnType<P06MetaStatusWriter["request"]>>;
    const budgetAction = input.action === "budget_decrease" || input.action === "budget_increase";
    if (budgetAction && ((input.budgetKind !== "daily" && input.budgetKind !== "lifetime") || !/^[A-Z]{3}$/.test(input.currency ?? ""))) {
      throw new ConnectorError("invalid_data", "Meta bütçe okuma bağlamı geçersiz", false);
    }
    const budgetField = input.budgetKind === "lifetime" ? "lifetime_budget" : "daily_budget";
    try {
      result = await this.request(`${id}?fields=id,status,effective_status${budgetAction ? `,${budgetField}` : ""}`, {
        method: "GET",
      });
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(
        "transient",
        "Meta status güvenli biçimde okunamadı",
        true,
      );
    }
    if (!result.response.ok) throw responseError(result.response);
    if (
      !result.body ||
      typeof result.body !== "object" ||
      Array.isArray(result.body)
    ) {
      throw new ConnectorError(
        "invalid_data",
        "Meta status yanıtı eksik",
        false,
      );
    }
    const body = result.body as Record<string, unknown>;
    if (body.id !== id)
      throw new ConnectorError(
        "invalid_data",
        "Meta status hedef kimliği uyuşmuyor",
        false,
      );
    const rawBudget = budgetAction ? body[budgetField] : null;
    const budgetMinor = budgetAction && (typeof rawBudget === "string" || typeof rawBudget === "number") && /^\d{1,16}$/.test(String(rawBudget))
      && Number.isSafeInteger(Number(rawBudget)) ? Number(rawBudget) : budgetAction ? null : null;
    if (budgetAction && budgetMinor === null) throw new ConnectorError("invalid_data", "Meta bütçe yanıtı kanonik değil", false);
    const core = Object.freeze({
      workspaceRef: input.workspaceRef,
      accountRef: input.accountRef,
      entityRef: input.entityRef,
      value: Object.freeze({ status: status(body.status), budgetMinor }),
      observedAt: this.now(),
      rawHash: digest(body),
    });
    return Object.freeze({ core, receiptHash: digest(core) });
  }

  async write(
    input: Parameters<P06ExecutionV2Writer["write"]>[0],
  ): Promise<P06ExecutionV2Receipt<P06ExecutionV2WriteCore>> {
    const { request, idempotencyKey } = input;
    if (
      !REF.test(request.executionRef) ||
      !REF.test(request.entityRef) ||
      !IDEMPOTENCY_KEY.test(idempotencyKey) ||
      !["status_pause", "status_activate", "budget_decrease", "budget_increase"].includes(request.action)
    ) {
      throw new ConnectorError(
        "invalid_data",
        "Meta mutation bağlamı geçersiz",
        false,
      );
    }
    const id = targetId(request.entityRef);
    const budgetAction = request.action === "budget_decrease" || request.action === "budget_increase";
    if (budgetAction && ((request.budgetKind !== "daily" && request.budgetKind !== "lifetime")
      || !/^[A-Z]{3}$/.test(request.currency) || request.desired.budgetMinor === null)) {
      throw new ConnectorError("invalid_data", "Meta bütçe mutation bağlamı geçersiz", false);
    }
    const desired = request.action === "status_pause" ? "PAUSED" : "ACTIVE";
    const mutation = budgetAction
      ? { [request.budgetKind === "lifetime" ? "lifetime_budget" : "daily_budget"]: String(request.desired.budgetMinor) }
      : { status: desired };
    const ambiguous = (
      rawHash: string,
    ): P06ExecutionV2Receipt<P06ExecutionV2WriteCore> => {
      const core = Object.freeze({
        executionRef: request.executionRef,
        idempotencyKey,
        entityRef: request.entityRef,
        action: request.action,
        kind: "ambiguous_transport" as const,
        rawHash,
      });
      return Object.freeze({ core, receiptHash: digest(core) });
    };
    let result: Awaited<ReturnType<P06MetaStatusWriter["request"]>>;
    try {
      result = await this.request(id, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(mutation).toString(),
      });
    } catch (error) {
      if (
        error instanceof ConnectorError &&
        (error.code === "authentication" || error.code === "rate_limited")
      )
        throw error;
      return ambiguous(
        digest({ kind: "transport_failure", observedAt: this.now() }),
      );
    }
    if (!result.response.ok) {
      if (result.response.status < 500) throw responseError(result.response);
      return ambiguous(digest(result.body));
    }
    if (
      !result.body ||
      typeof result.body !== "object" ||
      Array.isArray(result.body) ||
      (result.body as Record<string, unknown>).success !== true
    ) {
      return ambiguous(digest(result.body));
    }
    const core = Object.freeze({
      executionRef: request.executionRef,
      idempotencyKey,
      entityRef: request.entityRef,
      action: request.action,
      kind: "written" as const,
      rawHash: digest(result.body),
    });
    return Object.freeze({ core, receiptHash: digest(core) });
  }
}
