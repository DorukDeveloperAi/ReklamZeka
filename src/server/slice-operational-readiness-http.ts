import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { SliceOperationalReadinessService } from "@/application/slice-operational-readiness-service";
import { AuthorizationError } from "@/security/authorization";

const authority = Object.freeze({ canSave: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false });
const headers = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "slice-operational-readiness-read", "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Network": "disabled" });
const fail = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message }, authority }, { status, headers });
export const sliceOperationalReadinessNotConfiguredResponse = () => fail(503, "source_not_configured", "Slice operasyon uygunluk kaynağı yerel çalışma alanına henüz bağlanmadı.");
export const sliceOperationalReadinessSessionRequiredResponse = () => fail(401, "local_session_required", "Slice operasyon uygunluğu için yerel dashboard oturumunu bağlayın.");

export function createSliceOperationalReadinessHttpHandler(input: Readonly<{ service: Pick<SliceOperationalReadinessService, "list">; resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null> }>) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
        || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref") || request.headers.get("sec-fetch-site") !== "same-origin"
        || request.headers.get("x-reklamzeka-intent") !== "slice-operational-readiness-read") return fail(400, "invalid_input", "Slice operasyon uygunluğu isteği geçersiz.");
      const principal = await input.resolvePrincipal(request);
      if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.list(principal), { headers });
    } catch (reason) {
      if (reason instanceof AuthorizationError) return fail(403, "forbidden", reason.publicMessage);
      return sliceOperationalReadinessNotConfiguredResponse();
    }
  };
}
