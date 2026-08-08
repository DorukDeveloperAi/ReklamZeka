import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { CategoryArchiveImpactService } from "@/application/category-archive-impact-service";
import { CategoryArchiveImpactRepositoryError } from "@/connectors/categories/category-archive-impact-drizzle-repository";
import { AuthorizationError } from "@/security/authorization";

const TARGET_REF = /^(dimension|category)_[a-f0-9]{24}$/;
const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "category-archive-impact-preview", "X-ReklamZeka-Action-Authority": "none" });
const AUTHORITY = Object.freeze({ canArchive: false, canAssign: false, canAuthorizeAction: false, canWriteMeta: false });
function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}
export function categoryArchiveImpactNotConfiguredResponse() {
  return error("source_not_configured", "Kategori arşiv etki kaynağı henüz bağlı değil.", 503);
}
export function categoryArchiveImpactSessionRequiredResponse() {
  return error("local_session_required", "Arşiv etki önizlemesi için yerel dashboard oturumunu bağlayın.", 401);
}
export function createCategoryArchiveImpactHttpHandler(input: Readonly<{
  service: Pick<CategoryArchiveImpactService, "preview">;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return async (request: Request) => { try {
    const url = new URL(request.url); const keys = [...url.searchParams.keys()];
    const targetRef = url.searchParams.get("targetRef");
    if (request.method !== "GET" || keys.length !== 2 || new Set(keys).size !== 2
      || url.searchParams.get("view") !== "archive-impact" || !targetRef || !TARGET_REF.test(targetRef)
      || request.headers.has("authorization") || !request.headers.get("cookie")
      || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
      || request.headers.get("sec-fetch-site") !== "same-origin"
      || request.headers.get("x-reklamzeka-intent") !== "category-archive-impact-preview") {
      return error("invalid_input", "Kategori arşiv etki isteği geçersiz.", 400);
    }
    const principal = await input.resolvePrincipal(request); if (!principal) throw new AuthorizationError();
    const result = await input.service.preview(principal, targetRef);
    return result ? NextResponse.json(result, { headers: HEADERS })
      : error("not_found", "Kategori hedefi bulunamadı.", 404);
  } catch (reason) {
    if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
    if (reason instanceof CategoryArchiveImpactRepositoryError && reason.code === "workspace_scope_mismatch") {
      return error("forbidden", "Çalışma alanı erişilebilir değil.", 403);
    }
    return categoryArchiveImpactNotConfiguredResponse();
  } };
}
