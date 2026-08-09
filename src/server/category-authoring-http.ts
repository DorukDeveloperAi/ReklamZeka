import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { CategoryAuthoringError, type CategoryAuthoringService } from "@/application/category-authoring-service";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff", "X-ReklamZeka-Access-Mode": "category-authoring-guarded",
  "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const AUTHORITY = Object.freeze({ canAuthorizeAction: false, canWriteMeta: false });

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) throw new CategoryAuthoringError("invalid_input");
}

const COMMAND_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  create_dimension: ["operation", "key", "name", "description", "cardinality", "allowedEntityLevels", "expectedRegistryHash"],
  revise_dimension: ["operation", "dimensionRef", "expectedVersion", "name", "description", "cardinality",
    "allowedEntityLevels", "expectedRegistryHash", "expectedImpactHash"],
  archive_dimension: ["operation", "dimensionRef", "expectedVersion", "expectedRegistryHash", "expectedImpactHash"],
  create_definition: ["operation", "dimensionRef", "key", "label", "description", "expectedRegistryHash"],
  revise_definition: ["operation", "definitionRef", "expectedVersion", "label", "description",
    "expectedRegistryHash", "expectedImpactHash"],
  archive_definition: ["operation", "definitionRef", "expectedVersion", "expectedRegistryHash", "expectedImpactHash"],
  create_assignment: ["operation", "dimensionRef", "definitionRef", "entityLevel", "entityRef", "viaAdRef",
    "assignmentOperation", "manualLock", "confidenceBasisPoints", "expectedRegistryHash"],
  revise_assignment: ["operation", "assignmentRef", "expectedVersion", "assignmentOperation", "manualLock",
    "confidenceBasisPoints", "expectedRegistryHash"],
  unlock_assignment: ["operation", "assignmentRef", "expectedVersion", "expectedRegistryHash"],
  archive_assignment: ["operation", "assignmentRef", "expectedVersion", "expectedRegistryHash"],
});

function requestShape(request: Request, method: "GET" | "POST", intent: string): void {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  let originMatches = method === "GET";
  if (method === "POST" && origin) {
    try { originMatches = new URL(origin).origin === url.origin; } catch { originMatches = false; }
  }
  if (request.method !== method || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
    || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("x-reklamzeka-intent") !== intent
    || method === "POST" && (!originMatches
      || request.headers.get("content-type")?.toLowerCase() !== "application/json")) {
    throw new CategoryAuthoringError("invalid_input");
  }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 16_384) throw new CategoryAuthoringError("invalid_input");
  const parsed = JSON.parse(raw) as unknown;
  exact(parsed, ["command"]);
  if (!parsed.command || typeof parsed.command !== "object" || Array.isArray(parsed.command)) {
    throw new CategoryAuthoringError("invalid_input");
  }
  const candidate = parsed.command as Record<string, unknown>; const operation = String(candidate.operation);
  if (!Object.hasOwn(COMMAND_KEYS, operation)) throw new CategoryAuthoringError("invalid_input");
  exact(candidate, COMMAND_KEYS[operation]!);
  return candidate;
}

function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof CategoryAuthoringError) {
    if (reason.code === "not_found") return error("not_found", "Kategori kaydı bulunamadı.", 404);
    if (reason.code === "conflict") return error("conflict", "Kategori kaydı siz çalışırken değişti; görünümü yenileyin.", 409);
    if (reason.code === "dependency_blocked") return error("dependency_blocked",
      "Kategori değişikliği aktif veya doğrulanamayan bağımlılıklar nedeniyle engellendi.", 409);
    if (reason.code === "manual_lock") return error("manual_lock", "Manuel kilit açık bir kilit revizyonu olmadan değiştirilemez.", 409);
    return error("invalid_input", "Kategori authoring isteği geçersiz.", 400);
  }
  if (reason instanceof SyntaxError) return error("invalid_input", "Kategori authoring isteği geçersiz.", 400);
  return error("unavailable", "Kategori authoring şu anda kullanılamıyor.", 503);
}

export function categoryAuthoringNotConfiguredResponse() {
  return error("source_not_configured", "Kategori authoring yerel çalışma alanına henüz bağlanmadı.", 503);
}

export function categoryAuthoringSessionRequiredResponse() {
  return error("local_session_required", "Kategori authoring için yerel dashboard oturumunu bağlayın.", 401);
}

export function createCategoryAuthoringHttpHandlers(input: Readonly<{
  service: Pick<CategoryAuthoringService, "inspect" | "mutate">;
  resolvePrincipal(request: Request, operation: "read" | "publish"): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return Object.freeze({
    GET: async (request: Request) => { try {
      requestShape(request, "GET", "category-authoring-read");
      const principal = await input.resolvePrincipal(request, "read"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.inspect(principal), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try {
      requestShape(request, "POST", "category-authoring-mutate");
      const command = await body(request);
      const principal = await input.resolvePrincipal(request, "publish"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.mutate(principal, command as never), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
  });
}
