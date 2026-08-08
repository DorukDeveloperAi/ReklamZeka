import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { GuidanceStudioError, type GuidanceStudioService } from "@/application/guidance-studio-service";
import { GuidanceRepositoryError } from "@/connectors/guidance/guidance-drizzle-repository";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "guidance-read-author", "X-ReklamZeka-Action-Authority": "none" });
const AUTHORITY = Object.freeze({ canWriteMeta: false, canAuthorizeAction: false, canEnforcePolicy: false });

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) throw new GuidanceStudioError("invalid_input");
}
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof GuidanceStudioError) return reason.code === "not_found"
    ? error("not_found", "Talimat veya kapsam bulunamadı.", 404)
    : reason.code === "conflict" ? error("conflict", "Talimat siz çalışırken değişti; listeyi yenileyin.", 409)
      : error(reason.code, "Guidance isteği geçersiz.", 400);
  if (reason instanceof GuidanceRepositoryError && reason.code === "optimistic_conflict") {
    return error("conflict", "Talimat kayıt defteri siz çalışırken değişti; listeyi yenileyin.", 409);
  }
  if (reason instanceof SyntaxError) return error("invalid_input", "Guidance isteği geçersiz.", 400);
  return error("unavailable", "Guidance Studio şu anda kullanılamıyor.", 503);
}
function requestShape(request: Request, method: string, intent: string, withBody: boolean): void {
  const url = new URL(request.url);
  if (request.method !== method || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
    || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("x-reklamzeka-intent") !== intent
    || withBody && (request.headers.get("origin") === null
      || request.headers.get("content-type")?.toLowerCase() !== "application/json")) {
    throw new GuidanceStudioError("invalid_input");
  }
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const value = await request.text();
  if (Buffer.byteLength(value) > 16_384) throw new GuidanceStudioError("invalid_input");
  return JSON.parse(value) as Record<string, unknown>;
}

export function guidanceStudioNotConfiguredResponse() {
  return error("source_not_configured", "Guidance Studio yerel çalışma alanına henüz bağlanmadı.", 503);
}

export function createGuidanceStudioHttpHandlers(input: Readonly<{
  service: Pick<GuidanceStudioService, "list" | "createDraft" | "mutate">;
  resolvePrincipal(request: Request, operation: "read" | "draft" | "publish"): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return Object.freeze({
    GET: async (request: Request) => { try {
      requestShape(request, "GET", "guidance-studio-read", false);
      const principal = await input.resolvePrincipal(request, "read");
      if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.list(principal), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try {
      requestShape(request, "POST", "guidance-studio-create", true);
      const value = await body(request); exact(value, ["title", "body", "strength", "topic", "scopes", "expectedRegistryHash"]);
      const principal = await input.resolvePrincipal(request, "draft");
      if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.createDraft(principal, value as never), { status: 201, headers: HEADERS });
    } catch (reason) { return failure(reason); } },
    PATCH: async (request: Request) => { try {
      const intent = request.headers.get("x-reklamzeka-intent");
      const operation = intent === "guidance-studio-revise" ? "revise"
        : intent === "guidance-studio-publish" ? "publish" : intent === "guidance-studio-archive" ? "archive" : null;
      if (!operation) throw new GuidanceStudioError("invalid_input");
      requestShape(request, "PATCH", intent!, true);
      const value = await body(request);
      exact(value, operation === "revise"
        ? ["cardRef", "expectedVersion", "expectedRegistryHash", "operation", "title", "body", "strength", "topic", "scopes"]
        : ["cardRef", "expectedVersion", "expectedRegistryHash", "operation"]);
      if (value.operation !== operation) throw new GuidanceStudioError("invalid_input");
      const principal = await input.resolvePrincipal(request, operation === "revise" ? "draft" : "publish");
      if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.mutate(principal, value as never), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
  });
}
