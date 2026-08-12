import { NextResponse } from "next/server";
import type { MetaPortfolioCapability } from "@/domain/meta/portfolio-capability";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "read-only",
  "X-ReklamZeka-Action-Authority": "none",
});

const error = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status, headers: HEADERS });

export const portfolioCapabilityNotConfiguredResponse = () =>
  error(503, "source_not_configured", "Portföy kapsamı ve yerel kimlik bağlama katmanı henüz etkin değil.");

export const portfolioCapabilitySessionRequiredResponse = () =>
  error(401, "local_session_required", "Portföy kapsamı için yerel dashboard oturumunu bağlayın.");

export function createPortfolioCapabilityHttpHandler(input: Readonly<{
  load(workspaceId: string): Promise<MetaPortfolioCapability>;
  workspaceId(request: Request): Promise<string | null>;
}>) {
  return async (request: Request) => {
    try {
      if (new URL(request.url).search) return error(400, "invalid_input", "Portföy kapsamı isteği geçersiz.");
      const workspaceId = await input.workspaceId(request);
      if (!workspaceId) return error(403, "forbidden", "Portföy kapsamı için doğrulanmış yerel oturum gerekir.");
      return NextResponse.json(await input.load(workspaceId), { headers: HEADERS });
    } catch {
      return error(503, "source_unavailable", "Portföy kapsamı güvenli biçimde okunamadı.");
    }
  };
}
