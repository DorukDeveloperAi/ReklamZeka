import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { InstructionPolicyLifecycleError, type InstructionPolicyLifecycleService } from
  "@/application/instruction-policy-lifecycle-service";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff", "X-ReklamZeka-Access-Mode": "instruction-policy-guarded",
  "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const AUTHORITY = Object.freeze({ canApprove: false, canExecute: false, canWriteMeta: false,
  canSchedule: false, canCallTool: false });

function responseError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) throw new InstructionPolicyLifecycleError("invalid_input");
}
const KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  create_draft: ["operation", "expectedRegistryHash", "rawText", "policy"],
  revise_draft: ["operation", "expectedRegistryHash", "expectedVersion", "expectedPolicyHash", "rawText", "policy"],
  publish: ["operation", "expectedRegistryHash", "policyRef", "expectedVersion", "expectedPolicyHash", "reasonCode"],
  pause: ["operation", "expectedRegistryHash", "policyRef", "expectedVersion", "expectedPolicyHash", "reasonCode"],
  archive: ["operation", "expectedRegistryHash", "policyRef", "expectedVersion", "expectedPolicyHash", "reasonCode"],
});

function shape(request: Request, method: "GET" | "POST", intent: string): void {
  const url = new URL(request.url); const origin = request.headers.get("origin");
  let matchesOrigin = method === "GET";
  if (origin && method === "POST") { try { matchesOrigin = new URL(origin).origin === url.origin; } catch { matchesOrigin = false; } }
  if (request.method !== method || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
    || request.headers.get("sec-fetch-site") !== "same-origin" || request.headers.get("x-reklamzeka-intent") !== intent
    || method === "POST" && (!matchesOrigin || request.headers.get("content-type")?.toLowerCase() !== "application/json")) {
    throw new InstructionPolicyLifecycleError("invalid_input");
  }
}

async function command(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 40_000) throw new InstructionPolicyLifecycleError("invalid_input");
  const value = JSON.parse(raw) as unknown; exact(value, ["command"]);
  if (!value.command || typeof value.command !== "object" || Array.isArray(value.command)) {
    throw new InstructionPolicyLifecycleError("invalid_input");
  }
  const candidate = value.command as Record<string, unknown>; const operation = String(candidate.operation);
  if (!Object.hasOwn(KEYS, operation)) throw new InstructionPolicyLifecycleError("invalid_input");
  exact(candidate, KEYS[operation]!); return candidate;
}

function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return responseError("forbidden", reason.publicMessage, 403);
  if (reason instanceof InstructionPolicyLifecycleError) {
    if (reason.code === "not_found") return responseError("not_found", "Talimat politikası bulunamadı.", 404);
    if (reason.code === "conflict") return responseError("conflict",
      "Talimat politikası siz çalışırken değişti; görünümü yenileyin.", 409);
    if (reason.code === "invalid_transition") return responseError("invalid_transition",
      "Talimat politikası bu lifecycle geçişine uygun değil.", 409);
    return responseError("invalid_input", "Talimat politikası isteği geçersiz.", 400);
  }
  if (reason instanceof SyntaxError) return responseError("invalid_input", "Talimat politikası isteği geçersiz.", 400);
  return responseError("unavailable", "Talimat politikası şu anda kullanılamıyor.", 503);
}

export function instructionPolicyNotConfiguredResponse() {
  return responseError("source_not_configured", "Talimat politikası yerel çalışma alanına henüz bağlanmadı.", 503);
}
export function instructionPolicySessionRequiredResponse() {
  return responseError("local_session_required", "Talimat politikası için yerel dashboard oturumunu bağlayın.", 401);
}

export function createInstructionPolicyLifecycleHttpHandlers(input: Readonly<{
  service: Pick<InstructionPolicyLifecycleService, "inspect" | "mutate">;
  resolvePrincipal(request: Request, operation: "read" | "draft" | "publish"): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return Object.freeze({
    GET: async (request: Request) => { try {
      shape(request, "GET", "instruction-policy-read");
      const principal = await input.resolvePrincipal(request, "read"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.inspect(principal), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try {
      shape(request, "POST", "instruction-policy-mutate"); const parsed = await command(request);
      const operation = parsed.operation === "create_draft" || parsed.operation === "revise_draft" ? "draft" : "publish";
      const principal = await input.resolvePrincipal(request, operation); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.mutate(principal, parsed as never), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
  });
}
