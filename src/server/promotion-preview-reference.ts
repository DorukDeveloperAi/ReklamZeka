import { createHash, randomBytes } from "node:crypto";

export type PromotionPreviewReference = Readonly<{
  reference: string;
  expiresAt: string;
  remainingUses: number;
}>;

export type PreviewResolutionCode =
  | "resolved"
  | "not_found"
  | "expired"
  | "workspace_mismatch"
  | "exhausted";

export type PreviewResolution = Readonly<{
  code: PreviewResolutionCode;
  remainingUses: number;
}>;

export type ServerOnlyPromotionPreviewTarget = Readonly<{
  /** Must only be consumed by a trusted server-side renderer or proxy. */
  url: URL;
}>;

type PreviewEntry = {
  workspaceId: string;
  sensitiveUrl: string;
  expiresAtMs: number;
  remainingUses: number;
};

export type PromotionPreviewReferenceVaultOptions = Readonly<{
  now?: () => number;
  random?: (size: number) => Buffer;
  maxTtlMs?: number;
  isAllowedUrl?: (url: URL) => boolean;
}>;

function isMetaPreviewHost(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return hostname === "graph.facebook.com"
    || hostname.endsWith(".facebook.com")
    || hostname === "fbcdn.net"
    || hostname.endsWith(".fbcdn.net")
    || hostname === "cdninstagram.com"
    || hostname.endsWith(".cdninstagram.com")
    || hostname === "instagram.com"
    || hostname.endsWith(".instagram.com");
}

/**
 * Process-local vault for short-lived preview targets. It intentionally has no
 * persistence API and never returns the sensitive target in public results.
 */
export class PromotionPreviewReferenceVault {
  readonly #entries = new Map<string, PreviewEntry>();
  readonly #now: () => number;
  readonly #random: (size: number) => Buffer;
  readonly #maxTtlMs: number;
  readonly #isAllowedUrl: (url: URL) => boolean;

  constructor(options: PromotionPreviewReferenceVaultOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? randomBytes;
    this.#maxTtlMs = options.maxTtlMs ?? 5 * 60 * 1000;
    this.#isAllowedUrl = options.isAllowedUrl ?? isMetaPreviewHost;
    if (!Number.isSafeInteger(this.#maxTtlMs) || this.#maxTtlMs < 1) {
      throw new TypeError("maxTtlMs must be a positive safe integer");
    }
  }

  issue(input: Readonly<{
    workspaceId: string;
    sensitiveUrl: string;
    ttlMs: number;
    maxUses?: number;
  }>): PromotionPreviewReference {
    const workspaceId = input.workspaceId.trim();
    if (!workspaceId) throw new TypeError("workspaceId is required");
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1 || input.ttlMs > this.#maxTtlMs) {
      throw new TypeError(`ttlMs must be between 1 and ${this.#maxTtlMs}`);
    }
    const maxUses = input.maxUses ?? 1;
    if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 5) {
      throw new TypeError("maxUses must be between 1 and 5");
    }

    const url = new URL(input.sensitiveUrl);
    if (url.protocol !== "https:") throw new TypeError("sensitiveUrl must use HTTPS");
    if (url.username || url.password || !this.#isAllowedUrl(url)) {
      throw new TypeError("sensitiveUrl host or credentials are not allowed");
    }

    const randomValue = this.#random(32);
    if (randomValue.length !== 32) throw new Error("preview reference entropy source returned an invalid length");
    const reference = `ppv_${randomValue.toString("base64url")}`;
    const digest = this.#digest(reference);
    const expiresAtMs = this.#now() + input.ttlMs;
    this.#entries.set(digest, {
      workspaceId,
      sensitiveUrl: url.toString(),
      expiresAtMs,
      remainingUses: maxUses,
    });

    return Object.freeze({
      reference,
      expiresAt: new Date(expiresAtMs).toISOString(),
      remainingUses: maxUses,
    });
  }

  consumeServerSide(
    input: Readonly<{ workspaceId: string; reference: string }>,
    consumer: (target: ServerOnlyPromotionPreviewTarget) => void,
  ): PreviewResolution {
    const workspaceId = input.workspaceId.trim();
    const reference = input.reference.trim();
    if (!workspaceId || !reference) return Object.freeze({ code: "not_found", remainingUses: 0 });

    const digest = this.#digest(reference);
    const entry = this.#entries.get(digest);
    if (!entry) return Object.freeze({ code: "not_found", remainingUses: 0 });
    if (this.#now() >= entry.expiresAtMs) {
      this.#entries.delete(digest);
      return Object.freeze({ code: "expired", remainingUses: 0 });
    }
    if (entry.workspaceId !== workspaceId) {
      return Object.freeze({ code: "workspace_mismatch", remainingUses: 0 });
    }
    if (entry.remainingUses < 1) {
      this.#entries.delete(digest);
      return Object.freeze({ code: "exhausted", remainingUses: 0 });
    }

    entry.remainingUses -= 1;
    consumer(Object.freeze({ url: new URL(entry.sensitiveUrl) }));
    const remainingUses = entry.remainingUses;
    return Object.freeze({ code: "resolved", remainingUses });
  }

  disposeExpired(): number {
    const now = this.#now();
    let disposed = 0;
    for (const [digest, entry] of this.#entries) {
      if (now >= entry.expiresAtMs) {
        this.#entries.delete(digest);
        disposed += 1;
      }
    }
    return disposed;
  }

  #digest(reference: string): string {
    return createHash("sha256").update(reference).digest("hex");
  }
}
