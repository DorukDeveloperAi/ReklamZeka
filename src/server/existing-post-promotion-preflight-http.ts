import { NextResponse } from "next/server";

import {
  ExistingPostPromotionPreflightAgentContract,
  type ExistingPostPromotionAgentCall,
} from "@/application/existing-post-promotion-preflight-agent-contract";
import { ExistingPostPromotionPublicPreflightError } from "@/application/existing-post-promotion-preflight-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { AuthorizationError } from "@/security/authorization";

const MAX_BODY = 4_096;
const FORWARDED = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip"] as const;
const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "read-only-preflight",
  "X-ReklamZeka-Action-Authority": "none",
});

function responseError(code: string, message: string, status: number) {
  return NextResponse.json({
    error: { code, message },
    authority: { canPersist: false, canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false },
  }, { status, headers: HEADERS });
}
function invalid(): never { throw new ExistingPostPromotionPublicPreflightError("invalid_input"); }
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return responseError("forbidden", reason.publicMessage, 403);
  if (reason instanceof ExistingPostPromotionPublicPreflightError) {
    if (reason.code === "invalid_input") return responseError("invalid_input", "Öne çıkarma ön kontrolü isteği geçersiz.", 400);
    if (reason.code === "not_found") return responseError("not_found", "Öne çıkarma seçimi bulunamadı.", 404);
    if (reason.code === "unsafe_source") return responseError("unsafe_source", "Öne çıkarma kaynağı güvenli biçimde doğrulanamadı.", 422);
  }
  return responseError("unavailable", "Öne çıkarma ön kontrolü şu anda kullanılamıyor.", 503);
}

export function createExistingPostPromotionPreflightHttpHandler(input: Readonly<{
  contract: ExistingPostPromotionPreflightAgentContract;
  origin: string;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return async function POST(request: Request) {
    try {
      let url: URL;
      let configured: URL;
      try { url = new URL(request.url); configured = new URL(input.origin); } catch { return invalid(); }
      if (request.method !== "POST" || url.origin !== configured.origin || url.search || url.hash
        || request.headers.get("host") !== configured.host || request.headers.get("origin") !== configured.origin
        || request.headers.get("sec-fetch-site") !== "same-origin" || FORWARDED.some((header) => request.headers.has(header))
        || request.headers.get("x-reklamzeka-intent") !== "existing-post-promotion-preflight"
        || request.headers.get("content-type")?.toLowerCase() !== "application/json"
        || request.headers.has("transfer-encoding")) invalid();
      const length = request.headers.get("content-length");
      if (length !== null && (!/^(?:0|[1-9][0-9]{0,3})$/.test(length) || Number(length) > MAX_BODY)) invalid();
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > MAX_BODY) invalid();
      let body: unknown;
      try { body = JSON.parse(text) as unknown; } catch { return invalid(); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("selection" in body)) invalid();
      const principal = await input.resolvePrincipal(request);
      if (!principal) throw new AuthorizationError();
      const call: ExistingPostPromotionAgentCall = {
        name: "existing_post_promotion_preflight",
        arguments: (body as { selection: ExistingPostPromotionAgentCall["arguments"] }).selection,
      };
      return NextResponse.json(await input.contract.execute(principal, call), { headers: HEADERS });
    } catch (reason) { return failure(reason); }
  };
}

export function existingPostPromotionPreflightNotConfiguredResponse() {
  return responseError("source_not_configured", "Öne çıkarma ön kontrolü henüz etkin değil.", 503);
}
