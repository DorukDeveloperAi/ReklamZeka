import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { EffectiveCategoryHealthScanError } from "@/application/category-effective-health-scanner";
import type { CategoryEffectiveHealthService } from "@/application/category-effective-health-service";
import { CategoryEffectiveHealthRepositoryError } from "@/connectors/categories/category-effective-health-drizzle-repository";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "category-effective-health-read", "X-ReklamZeka-Action-Authority": "none" });
const AUTHORITY = Object.freeze({ canDraft: false, canPublish: false, canArchive: false, canAssign: false,
  canWriteMeta: false, canAuthorizeAction: false, canEnforcePolicy: false });
function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, status: "incomplete", authority: AUTHORITY }, { status, headers: HEADERS });
}
export function categoryEffectiveHealthNotConfiguredResponse() {
  return error("source_not_configured", "Effective kategori sağlığı yerel çalışma alanına henüz bağlanmadı.", 503);
}
export function categoryEffectiveHealthSessionRequiredResponse() {
  return error("local_session_required", "Effective kategori sağlığı için yerel dashboard oturumunu bağlayın.", 401);
}
export function createCategoryEffectiveHealthHttpHandler(input: Readonly<{
  service: Pick<CategoryEffectiveHealthService, "inspect">;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return async (request: Request) => { try {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
      || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
      || request.headers.get("sec-fetch-site") !== "same-origin"
      || request.headers.get("x-reklamzeka-intent") !== "category-effective-health-read") {
      return error("invalid_input", "Effective kategori sağlığı isteği geçersiz.", 400);
    }
    const principal = await input.resolvePrincipal(request); if (!principal) throw new AuthorizationError();
    return NextResponse.json(await input.service.inspect(principal), { headers: HEADERS });
  } catch (reason) {
    if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
    if (reason instanceof CategoryEffectiveHealthRepositoryError && reason.code === "workspace_scope_mismatch") {
      return error("forbidden", "Çalışma alanı erişilebilir değil.", 403);
    }
    if (reason instanceof EffectiveCategoryHealthScanError) {
      return error("capacity_exceeded", "Portföy güvenli tarama sınırını aştı; sonuç eksik gösterilmedi.", 422);
    }
    return categoryEffectiveHealthNotConfiguredResponse();
  } };
}
