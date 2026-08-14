import { NextResponse } from "next/server";

import {
  ExistingPostPromotionCatalogError,
  type ExistingPostPromotionCatalogService,
} from "@/application/existing-post-promotion-catalog";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { AuthorizationError } from "@/security/authorization";

const FORWARDED = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip"] as const;
const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "read-only-catalog",
  "X-ReklamZeka-Action-Authority": "none",
});
const AUTHORITY = Object.freeze({ canPersist: false, canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false });

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof ExistingPostPromotionCatalogError) {
    if (reason.code === "invalid_input") return error("invalid_input", "Öne çıkarma kataloğu isteği geçersiz.", 400);
    if (reason.code === "unsafe_source") return error("unsafe_source", "Öne çıkarma kataloğu güvenli biçimde gösterilemedi.", 422);
  }
  return error("unavailable", "Öne çıkarma seçim kataloğu şu anda kullanılamıyor.", 503);
}

export function existingPostPromotionCatalogNotConfiguredResponse() {
  return error("source_not_configured", "Öne çıkarma seçim kataloğu ve yerel kimlik bağlama katmanı henüz etkin değil.", 503);
}

export function existingPostPromotionCatalogSessionRequiredResponse() {
  return error("local_session_required", "Öne çıkarma seçim kataloğu için yerel dashboard oturumunu bağlayın.", 401);
}

export function createExistingPostPromotionCatalogHttpHandler(input: Readonly<{
  service: Pick<ExistingPostPromotionCatalogService, "list">;
  origin: string;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return async function GET(request: Request) {
    try {
      const url = new URL(request.url); const configured = new URL(input.origin);
      const requestOrigin = request.headers.get("origin");
      if (request.method !== "GET" || url.origin !== configured.origin || url.search || url.hash
        || request.headers.get("host") !== configured.host || request.headers.get("sec-fetch-site") !== "same-origin"
        || requestOrigin !== null && requestOrigin !== configured.origin || FORWARDED.some((header) => request.headers.has(header))
        || request.headers.has("authorization") || !request.headers.get("cookie")
        || request.headers.get("x-reklamzeka-intent") !== "existing-post-promotion-catalog-read"
        || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")) {
        throw new ExistingPostPromotionCatalogError("invalid_input");
      }
      const principal = await input.resolvePrincipal(request);
      if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.list(principal), { headers: HEADERS });
    } catch (reason) { return failure(reason); }
  };
}
