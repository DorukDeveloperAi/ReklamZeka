import { NextResponse } from "next/server";
import { canonicalPerformancePublicSource } from "@/application/meta-public-source-adapters";
import type { CanonicalPerformanceReadProjection } from "@/domain/meta/performance-read-model";
import { publicSource, publicSourceFailure, withPublicSource } from "@/domain/source/public-source";
const headers = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "X-ReklamZeka-Access-Mode": "read-only", "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Network": "disabled" });
const fail = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status, headers });
const unavailable = (code: string, message: string, reasonCode: string) => NextResponse.json(publicSourceFailure(
  publicSource({ kind: "canonical_performance", state: "unavailable", observedAt: null, freshnessAt: null,
    freshnessThresholdMinutes: null, reasonCodes: [reasonCode] }), code, message), { status: 503, headers });
export const canonicalPerformanceNotConfiguredResponse = () => unavailable("source_not_configured", "Kanonik performans kaynağı yerel çalışma alanına henüz bağlanmadı.", "canonical_performance_not_configured");
export const canonicalPerformanceSessionRequiredResponse = () => fail(401, "local_session_required", "Performans verisi için yerel dashboard oturumunu bağlayın.");
export function createCanonicalPerformanceReadHttpHandler(input: Readonly<{ load(workspaceId: string): Promise<CanonicalPerformanceReadProjection>; workspaceId(request: Request): Promise<string | null> }>) {
  return async (request: Request) => { try { if (request.method !== "GET" || new URL(request.url).search) return fail(400, "invalid_input", "Performans isteği geçersiz."); const workspaceId = await input.workspaceId(request); if (!workspaceId) return fail(403, "forbidden", "Doğrulanmış yerel oturum gerekir."); const projection = await input.load(workspaceId); return NextResponse.json(withPublicSource(projection, canonicalPerformancePublicSource(projection)), { headers }); } catch { return unavailable("source_unavailable", "Kanonik performans verisi güvenli biçimde okunamadı.", "canonical_performance_unavailable"); } };
}
