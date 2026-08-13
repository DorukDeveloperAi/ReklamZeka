import { NextResponse } from "next/server";
import type { MetaReadMirrorProjection } from "@/domain/meta/read-mirror-projection";

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
  error(503, "source_not_configured", "Kanonik Meta aynası yerel çalışma alanına henüz bağlanmadı.");

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
      return NextResponse.json(await input.load(workspaceId), { headers: HEADERS });
    } catch {
      return error(503, "source_unavailable", "Kanonik Meta aynası güvenli biçimde okunamadı.");
    }
  };
}
