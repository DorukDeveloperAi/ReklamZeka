import { NextResponse } from "next/server";
import { metaReadMirrorPublicSource } from "@/application/meta-public-source-adapters";
import type { MetaReadMirrorProjection } from "@/domain/meta/read-mirror-projection";
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

export const metaReadMirrorNotConfiguredResponse = () =>
  NextResponse.json(publicSourceFailure(
    publicSource({ kind: "canonical_meta_mirror", state: "unavailable", observedAt: null, freshnessAt: null,
      freshnessThresholdMinutes: null, reasonCodes: ["canonical_meta_mirror_not_configured"] }),
    "source_not_configured", "Kanonik Meta aynası yerel çalışma alanına henüz bağlanmadı."), { status: 503, headers: HEADERS });

export const metaReadMirrorSessionRequiredResponse = () =>
  error(401, "local_session_required", "Meta aynasını görmek için yerel dashboard oturumunu bağlayın.");

export function createMetaReadMirrorHttpHandler(input: Readonly<{
  load(workspaceId: string): Promise<MetaReadMirrorProjection>;
  workspaceId(request: Request): Promise<string | null>;
}>) {
  return async (request: Request) => {
    try {
      if (request.method !== "GET" || new URL(request.url).search) {
        return error(400, "invalid_input", "Meta aynası isteği geçersiz.");
      }
      const workspaceId = await input.workspaceId(request);
      if (!workspaceId) return error(403, "forbidden", "Meta aynası için doğrulanmış yerel oturum gerekir.");
      const projection = await input.load(workspaceId);
      return NextResponse.json(withPublicSource(projection, metaReadMirrorPublicSource(projection)), { headers: HEADERS });
    } catch {
      return NextResponse.json(publicSourceFailure(
        publicSource({ kind: "canonical_meta_mirror", state: "unavailable", observedAt: null, freshnessAt: null,
          freshnessThresholdMinutes: null, reasonCodes: ["canonical_meta_mirror_unavailable"] }),
        "source_unavailable", "Kanonik Meta aynası güvenli biçimde okunamadı."), { status: 503, headers: HEADERS });
    }
  };
}
