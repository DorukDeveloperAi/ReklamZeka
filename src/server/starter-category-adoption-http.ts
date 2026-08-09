import { NextResponse } from "next/server";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { StarterCategoryAdoptionError, type StarterCategoryAdoptionService } from
  "@/application/starter-category-adoption-service";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff", "X-ReklamZeka-Access-Mode": "starter-category-preview-only",
  "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const AUTHORITY = Object.freeze({ canPersist: false, canAuthorizeAction: false, canWriteMeta: false });

function responseError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) throw new StarterCategoryAdoptionError("invalid_input");
}
function shape(request: Request, method: "GET" | "POST", intent: string) {
  const url = new URL(request.url); const origin = request.headers.get("origin");
  let originMatches = method === "GET";
  if (method === "POST" && origin) try { originMatches = new URL(origin).origin === url.origin; } catch { originMatches = false; }
  if (request.method !== method || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
    || request.headers.get("sec-fetch-site") !== "same-origin" || request.headers.get("x-reklamzeka-intent") !== intent
    || method === "POST" && (!originMatches || request.headers.get("content-type")?.toLowerCase() !== "application/json")) {
    throw new StarterCategoryAdoptionError("invalid_input");
  }
}
async function body(request: Request) {
  const raw = await request.text(); if (Buffer.byteLength(raw) > 2_048) throw new StarterCategoryAdoptionError("invalid_input");
  const parsed = JSON.parse(raw) as unknown; exact(parsed, ["planHash", "expectedRegistryHash", "confirmation"]);
  if (typeof parsed.planHash !== "string" || !/^[a-f0-9]{64}$/.test(parsed.planHash)
    || typeof parsed.expectedRegistryHash !== "string" || !/^[a-f0-9]{64}$/.test(parsed.expectedRegistryHash)
    || parsed.confirmation !== "adopt_starter_category_playbook") throw new StarterCategoryAdoptionError("invalid_input");
  return parsed as { planHash: string; expectedRegistryHash: string;
    confirmation: "adopt_starter_category_playbook" };
}
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return responseError("forbidden", reason.publicMessage, 403);
  if (reason instanceof StarterCategoryAdoptionError) return reason.code === "conflict"
    ? responseError("conflict", "Starter adoption planı registry ile birlikte değişti; önizlemeyi yenileyin.", 409)
    : responseError("invalid_input", "Starter adoption isteği geçersiz.", 400);
  if (reason instanceof SyntaxError) return responseError("invalid_input", "Starter adoption isteği geçersiz.", 400);
  return responseError("unavailable", "Starter adoption önizlemesi şu anda kullanılamıyor.", 503);
}
export function starterCategoryAdoptionNotConfiguredResponse() {
  return responseError("source_not_configured", "Starter adoption kaynağı yerel çalışma alanına bağlı değil.", 503);
}
export function starterCategoryAdoptionSessionRequiredResponse() {
  return responseError("local_session_required", "Starter adoption için yerel dashboard oturumunu bağlayın.", 401);
}
export function createStarterCategoryAdoptionHttpHandlers(input: Readonly<{
  service: Pick<StarterCategoryAdoptionService, "preview" | "confirm">;
  resolvePrincipal(request: Request, operation: "read" | "publish"): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return Object.freeze({
    GET: async (request: Request) => { try {
      shape(request, "GET", "starter-category-adoption-preview");
      const principal = await input.resolvePrincipal(request, "read"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.preview(principal), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try {
      shape(request, "POST", "starter-category-adoption-confirm");
      const command = await body(request);
      const principal = await input.resolvePrincipal(request, "publish"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.confirm(principal, command), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
  });
}
