import { NextResponse } from "next/server";
import { GuidanceAgentContract, GuidanceAgentError, type GuidanceAgentCall } from "@/application/guidance-agent-contract";
import { GuidanceFacetScopeError } from "@/application/guidance-facet-scope-resolver";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "guidance-agent-read", "X-ReklamZeka-Action-Authority": "none" });
function error(code: string, message: string, status: number) { return NextResponse.json({ error: { code, message } }, { status, headers: HEADERS }); }
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof GuidanceAgentError) return error(reason.code, "Guidance agent isteği geçersiz.", 400);
  if (reason instanceof GuidanceFacetScopeError) {
    if (reason.code === "unknown_scope_ref") return error(reason.code, "Guidance kapsam referansı güncel katalogda bulunamadı.", 400);
    if (reason.code === "stale_catalog") return error(reason.code, "Guidance kapsam kataloğu değişti; yeniden listeleyin.", 409);
    if (reason.code === "catalog_unavailable") return error(reason.code, "Guidance kapsam kataloğu kullanılamıyor.", 503);
    if (reason.code === "invalid_input") return error(reason.code, "Guidance agent isteği geçersiz.", 400);
    return error("unsafe_source", "Guidance kapsam kataloğu güvenli biçimde çözülemedi.", 503);
  }
  return error("unavailable", "Guidance agent okuma kaynağı kullanılamıyor.", 503);
}
function boundary(request: Request, method: "GET" | "POST", intent: string): void {
  if (request.method !== method || !request.headers.get("authorization") || request.headers.has("cookie")
    || request.headers.get("x-reklamzeka-intent") !== intent || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")) throw new GuidanceAgentError("invalid_input");
}
export function guidanceAgentNotConfiguredResponse() { return error("source_not_configured", "Guidance agent kaynağı yapılandırılmadı.", 503); }
export function createGuidanceAgentHttpHandlers(input: Readonly<{
  contract: GuidanceAgentContract;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) { return Object.freeze({
  GET: async (request: Request) => { try {
    boundary(request, "GET", "guidance-registry-list");
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => !["view", "status"].includes(key))
      || url.searchParams.get("view") !== "list") throw new GuidanceAgentError("invalid_input");
    const status = url.searchParams.get("status");
    if (status !== null && !["draft", "published", "archived"].includes(status)) throw new GuidanceAgentError("invalid_input");
    const principal = await input.resolvePrincipal(request); if (!principal) throw new AuthorizationError();
    const call: GuidanceAgentCall = { name: "guidance_registry_list", arguments: {
      status: status === null ? undefined : status as "draft" | "published" | "archived" } };
    return NextResponse.json(await input.contract.execute(principal, call), { headers: HEADERS });
  } catch (reason) { return failure(reason); } },
  POST: async (request: Request) => { try {
    boundary(request, "POST", "guidance-effective-preview");
    if (new URL(request.url).search) throw new GuidanceAgentError("invalid_input");
    if (request.headers.get("origin") === null || request.headers.get("content-type")?.toLowerCase() !== "application/json") {
      throw new GuidanceAgentError("invalid_input");
    }
    const text = await request.text(); if (Buffer.byteLength(text) > 32_768) throw new GuidanceAgentError("invalid_input");
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 1 || !("context" in raw)) {
      throw new GuidanceAgentError("invalid_input");
    }
    const principal = await input.resolvePrincipal(request); if (!principal) throw new AuthorizationError();
    return NextResponse.json(await input.contract.execute(principal,
      { name: "guidance_effective_preview", arguments: (raw as { context: never }).context }), { headers: HEADERS });
  } catch (reason) { return failure(reason); } },
}); }
