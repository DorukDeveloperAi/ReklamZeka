import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { CategoryProfileLifecycleError, type CategoryProfileLifecycleService } from
  "@/application/category-profile-lifecycle-service";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff", "X-ReklamZeka-Access-Mode": "category-profile-guarded",
  "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const AUTHORITY = Object.freeze({ canPublishPolicy: false, canAuthorizeAction: false,
  canExecute: false, canWriteMeta: false });

function responseError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) throw new CategoryProfileLifecycleError("invalid_input");
}
const COMMAND_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  create_draft: ["operation", "definitionRef", "parentDefinitionRef", "label", "description", "color", "bindings",
    "expectedRegistryHash"],
  revise_draft: ["operation", "profileRef", "parentDefinitionRef", "label", "description", "color", "bindings",
    "expectedVersion", "expectedProfileHash", "expectedRegistryHash"],
  publish: ["operation", "profileRef", "expectedVersion", "expectedProfileHash", "expectedRegistryHash", "reasonCode"],
  pause: ["operation", "profileRef", "expectedVersion", "expectedProfileHash", "expectedRegistryHash", "reasonCode"],
  archive: ["operation", "profileRef", "expectedVersion", "expectedProfileHash", "expectedRegistryHash", "reasonCode"],
});

function shape(request: Request, method: "GET" | "POST", intent: string): void {
  const url = new URL(request.url); const origin = request.headers.get("origin");
  let matchesOrigin = method === "GET";
  if (origin && method === "POST") { try { matchesOrigin = new URL(origin).origin === url.origin; } catch { matchesOrigin = false; } }
  if (request.method !== method || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
    || request.headers.get("sec-fetch-site") !== "same-origin" || request.headers.get("x-reklamzeka-intent") !== intent
    || method === "POST" && (!matchesOrigin || request.headers.get("content-type")?.toLowerCase() !== "application/json")) {
    throw new CategoryProfileLifecycleError("invalid_input");
  }
}
async function command(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 32_000) throw new CategoryProfileLifecycleError("invalid_input");
  const value = JSON.parse(raw) as unknown; exact(value, ["command"]);
  if (!value.command || typeof value.command !== "object" || Array.isArray(value.command)) {
    throw new CategoryProfileLifecycleError("invalid_input");
  }
  const candidate = value.command as Record<string, unknown>; const operation = String(candidate.operation);
  if (!Object.hasOwn(COMMAND_KEYS, operation)) throw new CategoryProfileLifecycleError("invalid_input");
  exact(candidate, COMMAND_KEYS[operation]!); return candidate;
}
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return responseError("forbidden", reason.publicMessage, 403);
  if (reason instanceof CategoryProfileLifecycleError) {
    if (reason.code === "forbidden") return responseError("forbidden", "Bu işlem için çalışma alanı yetkiniz yok.", 403);
    if (reason.code === "not_found") return responseError("not_found", "Kategori profili bulunamadı.", 404);
    if (reason.code === "conflict") return responseError("conflict",
      "Kategori profili siz çalışırken değişti; görünümü yenileyin.", 409);
    if (reason.code === "invalid_transition") return responseError("invalid_transition",
      "Kategori profili bu lifecycle geçişine uygun değil.", 409);
    return responseError("invalid_input", "Kategori profili isteği geçersiz.", 400);
  }
  if (reason instanceof SyntaxError) return responseError("invalid_input", "Kategori profili isteği geçersiz.", 400);
  return responseError("unavailable", "Kategori profili şu anda kullanılamıyor.", 503);
}

export function categoryProfileNotConfiguredResponse() {
  return responseError("source_not_configured", "Kategori profili yerel çalışma alanına henüz bağlanmadı.", 503);
}
export function categoryProfileSessionRequiredResponse() {
  return responseError("local_session_required", "Kategori profili için yerel dashboard oturumunu bağlayın.", 401);
}

export function createCategoryProfileLifecycleHttpHandlers(input: Readonly<{
  service: Pick<CategoryProfileLifecycleService, "inspect" | "mutate">;
  resolvePrincipal(request: Request, operation: "read" | "publish"): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return Object.freeze({
    GET: async (request: Request) => { try {
      shape(request, "GET", "category-profile-read");
      const principal = await input.resolvePrincipal(request, "read"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.inspect(principal), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try {
      shape(request, "POST", "category-profile-mutate"); const parsed = await command(request);
      const principal = await input.resolvePrincipal(request, "publish"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.mutate(principal, parsed as never), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
  });
}
