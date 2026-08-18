import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { GuideLifecycleService, GuideLifecycleServiceError } from "@/application/guide-lifecycle-service";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "guide-lifecycle-human-gated", "X-ReklamZeka-Action-Authority": "none" });
const AUTHORITY = Object.freeze({ canWriteMeta: false, canExecute: false, canSelfActivate: false });
function response(code: string, message: string, status: number) { return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS }); }
function shape(request: Request, method: string, intent: string, body: boolean) {
  const url = new URL(request.url);
  if (request.method !== method || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref") || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("x-reklamzeka-intent") !== intent || body && (request.headers.get("origin") !== url.origin || request.headers.get("content-type")?.toLowerCase() !== "application/json")) throw new GuideLifecycleServiceError("invalid_input");
}
async function json(request: Request) { const value = await request.text(); if (Buffer.byteLength(value) > 16_384) throw new GuideLifecycleServiceError("invalid_input"); return JSON.parse(value) as Record<string, unknown>; }
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return response("forbidden", reason.publicMessage, 403);
  if (reason instanceof SyntaxError) return response("invalid_input", "Kılavuz isteği geçersiz.", 400);
  if (reason instanceof GuideLifecycleServiceError) return reason.code === "not_found" ? response("not_found", "Kılavuz kapsamı bulunamadı.", 404)
    : reason.code === "conflict" ? response("conflict", "Kılavuz siz çalışırken değişti; listeyi yenileyin.", 409)
      : reason.code === "forbidden" ? response("forbidden", "Bu Kılavuz işlemi için yetkiniz yok.", 403)
        : reason.code === "unavailable" ? response("unavailable", "Kılavuz kaynağı şu anda kullanılamıyor.", 503)
          : response("invalid_input", "Kılavuz isteği geçersiz.", 400);
  return response("unavailable", "Kılavuz kaynağı şu anda kullanılamıyor.", 503);
}
export function guideLifecycleNotConfiguredResponse() { return response("source_not_configured", "Kılavuz yaşam döngüsü yerel çalışma alanına bağlı değil.", 503); }
export function guideLifecycleSessionRequiredResponse() { return response("local_session_required", "Kılavuzlar için yerel dashboard oturumunu bağlayın.", 401); }

export function createGuideLifecycleHttpHandlers(input: Readonly<{ service: Pick<GuideLifecycleService, "list" | "create" | "mutate">; resolvePrincipal(request: Request, operation: "read" | "draft" | "activate"): Promise<TrustedDecisionRoomPrincipal | null> }>) {
  return Object.freeze({
    GET: async (request: Request) => { try { shape(request, "GET", "guide-lifecycle-read", false); const principal = await input.resolvePrincipal(request, "read"); if (!principal) throw new AuthorizationError(); return NextResponse.json(await input.service.list(principal), { headers: HEADERS }); } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try { shape(request, "POST", "guide-lifecycle-create", true); const principal = await input.resolvePrincipal(request, "draft"); if (!principal) throw new AuthorizationError(); return NextResponse.json(await input.service.create(principal, await json(request) as never), { status: 201, headers: HEADERS }); } catch (reason) { return failure(reason); } },
    PATCH: async (request: Request) => { try { const intent = request.headers.get("x-reklamzeka-intent"); const expectedOperation = intent === "guide-lifecycle-accept" ? "accept" : intent === "guide-lifecycle-activate" ? "activate" : intent === "guide-lifecycle-pause" ? "pause" : null; if (!expectedOperation) throw new GuideLifecycleServiceError("invalid_input"); shape(request, "PATCH", intent!, true); const value = await json(request); if (value.operation !== expectedOperation) throw new GuideLifecycleServiceError("invalid_input"); const principal = await input.resolvePrincipal(request, expectedOperation === "accept" ? "draft" : "activate"); if (!principal) throw new AuthorizationError(); return NextResponse.json(await input.service.mutate(principal, value), { headers: HEADERS }); } catch (reason) { return failure(reason); } },
  });
}
