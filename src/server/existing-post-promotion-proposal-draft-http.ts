import { NextResponse } from "next/server";
import type { ExistingPostPromotionPreflightRequest } from "@/application/existing-post-promotion-preflight-service";
import { ExistingPostPromotionDraftError, type ExistingPostPromotionProposalDraftService } from "@/application/existing-post-promotion-proposal-draft-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { AuthorizationError } from "@/security/authorization";
const FORWARDED = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip"] as const;
const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-ReklamZeka-Access-Mode": "proposal-draft-only", "X-ReklamZeka-Action-Authority": "none" });
const AUTHORITY = Object.freeze({ canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false, canChangeTargeting: false });
function error(code: string, message: string, status: number) { return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS }); }
function failure(reason: unknown) { if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403); if (reason instanceof ExistingPostPromotionDraftError) {
  if (reason.code === "invalid_input") return error("invalid_input", "Öneri taslağı isteği geçersiz.", 400);
  if (reason.code === "preflight_not_ready") return error("preflight_not_ready", "Ön kontrol öneri taslağı için hazır değil.", 409);
  if (reason.code === "material_unavailable") return error("material_unavailable", "Sunucu immutable öneri materyalini henüz kuramıyor.", 503);
} return error("unavailable", "Öneri taslağı şu anda oluşturulamıyor.", 503); }
export function createExistingPostPromotionProposalDraftHttpHandler(input: Readonly<{ service: Pick<ExistingPostPromotionProposalDraftService, "draft">; origin: string; resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null> }>) {
  return async function POST(request: Request) { try {
    const url = new URL(request.url); const origin = new URL(input.origin); const length = request.headers.get("content-length");
    if (request.method !== "POST" || url.origin !== origin.origin || url.search || url.hash || request.headers.get("host") !== origin.host
      || request.headers.get("origin") !== origin.origin || request.headers.get("sec-fetch-site") !== "same-origin"
      || request.headers.get("x-reklamzeka-intent") !== "existing-post-promotion-proposal-draft"
      || request.headers.get("content-type")?.toLowerCase() !== "application/json" || request.headers.has("authorization")
      || !request.headers.get("cookie") || FORWARDED.some((header) => request.headers.has(header))
      || length !== null && (!/^\d{1,4}$/.test(length) || Number(length) > 4096)) throw new ExistingPostPromotionDraftError("invalid_input");
    const text = await request.text(); if (Buffer.byteLength(text) > 4096) throw new ExistingPostPromotionDraftError("invalid_input");
    let body: unknown; try { body = JSON.parse(text) as unknown; } catch { throw new ExistingPostPromotionDraftError("invalid_input"); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("selection" in body)) throw new ExistingPostPromotionDraftError("invalid_input");
    const principal = await input.resolvePrincipal(request); if (!principal) return error("forbidden", "Bu işlem için çalışma alanı yetkiniz yok.", 403);
    const result = await input.service.draft(principal, (body as { selection: ExistingPostPromotionPreflightRequest }).selection);
    return NextResponse.json({ contractVersion: "existing-post-promotion-draft/1.0.0", result, authority: AUTHORITY }, { status: result.outcome === "inserted" ? 201 : 200, headers: HEADERS });
  } catch (reason) { return failure(reason); } };
}
export function existingPostPromotionProposalDraftNotConfiguredResponse() { return error("source_not_configured", "Öneri taslağı henüz etkin değil.", 503); }
