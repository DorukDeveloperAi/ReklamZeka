import { NextResponse } from "next/server";
import { derivedTrustPublicSource } from "@/application/meta-public-source-adapters";
import type { MetaTrustReadinessReadProjection } from "@/application/meta-trust-readiness-read-service";
import { publicSource, publicSourceFailure, withPublicSource } from "@/domain/source/public-source";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "read-only",
  "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Network": "disabled",
});
const error = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status, headers: HEADERS });

const unavailable = (code: string, message: string, reasonCode: string) => NextResponse.json(publicSourceFailure(
  publicSource({ kind: "derived_trust", state: "unavailable", observedAt: null, freshnessAt: null,
    freshnessThresholdMinutes: null, reasonCodes: [reasonCode] }), code, message), { status: 503, headers: HEADERS });

export const metaTrustReadinessNotConfiguredResponse = () =>
  unavailable("source_not_configured", "Meta veri kalitesi raporu yerel çalışma alanına henüz bağlanmadı.", "derived_trust_not_configured");
export const metaTrustReadinessSessionRequiredResponse = () =>
  error(401, "local_session_required", "Meta veri kalitesi raporu için yerel dashboard oturumunu bağlayın.");

export function createMetaTrustReadinessHttpHandler(input: Readonly<{
  load(workspaceId: string): Promise<MetaTrustReadinessReadProjection>;
  workspaceId(request: Request): Promise<string | null>;
}>) {
  return async (request: Request) => {
    try {
      if (request.method !== "GET" || new URL(request.url).search) {
        return error(400, "invalid_input", "Meta veri kalitesi isteği geçersiz.");
      }
      const workspaceId = await input.workspaceId(request);
      if (!workspaceId) return error(403, "forbidden", "Doğrulanmış yerel oturum gerekir.");
      const projection = await input.load(workspaceId);
      return NextResponse.json(withPublicSource(projection, derivedTrustPublicSource(projection)), { headers: HEADERS });
    } catch {
      return unavailable("source_unavailable", "Meta veri kalitesi raporu güvenli biçimde okunamadı.", "derived_trust_unavailable");
    }
  };
}
