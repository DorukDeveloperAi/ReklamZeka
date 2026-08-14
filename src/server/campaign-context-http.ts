import { NextResponse } from "next/server";
import { CampaignContextReadError, CampaignContextReadService } from "@/application/campaign-context-read-service";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "X-ReklamZeka-Access-Mode": "read-only", "X-ReklamZeka-Action-Authority": "none" });
const response = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status, headers: HEADERS });
export const campaignContextNotConfiguredResponse = () => response(503, "source_not_configured", "Kampanya bağlamı ve yerel kimlik bağlama katmanı henüz etkin değil.");
export const campaignContextSessionRequiredResponse = () => response(401, "local_session_required", "Kampanya bağlamı için yerel dashboard oturumunu bağlayın.");

export function createCampaignContextHttpHandler(input: Readonly<{ service: CampaignContextReadService; workspaceId(request: Request): Promise<string | null> }>) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      if ([...url.searchParams.keys()].some((key) => key !== "campaignRef")) throw new CampaignContextReadError("invalid_input");
      const campaignRef = url.searchParams.get("campaignRef");
      const workspaceId = await input.workspaceId(request);
      if (!campaignRef || !workspaceId) return response(403, "forbidden", "Kampanya bağlamı için doğrulanmış yerel oturum gerekir.");
      return NextResponse.json(await input.service.get({ workspaceId, campaignRef }), { headers: HEADERS });
    } catch (error) {
      const code = error instanceof CampaignContextReadError ? error.code : "source_unavailable";
      return response(code === "invalid_input" ? 400 : code === "unsafe_source" ? 422 : 503, code, code === "invalid_input" ? "Kampanya bağlamı isteği geçersiz." : "Kampanya bağlamı güvenli biçimde okunamadı.");
    }
  };
}

export function createCampaignContextListHttpHandler(input: Readonly<{ service: CampaignContextReadService; workspaceId(request: Request): Promise<string | null> }>) {
  return async (request: Request) => {
    try {
      if (new URL(request.url).search) throw new CampaignContextReadError("invalid_input");
      const workspaceId = await input.workspaceId(request);
      if (!workspaceId) return response(403, "forbidden", "Kampanya bağlamı listesi için doğrulanmış yerel oturum gerekir.");
      return NextResponse.json(await input.service.list({ workspaceId }), { headers: HEADERS });
    } catch (error) {
      const code = error instanceof CampaignContextReadError ? error.code : "source_unavailable";
      return response(code === "invalid_input" ? 400 : code === "unsafe_source" ? 422 : 503, code, "Kampanya bağlamı listesi güvenli biçimde okunamadı.");
    }
  };
}
