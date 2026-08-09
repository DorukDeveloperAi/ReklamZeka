import { NextResponse } from "next/server";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  ProgressiveFormalizationStudioError,
  type ProgressiveFormalizationCommand,
  type ProgressiveFormalizationService,
} from "@/application/progressive-formalization-service";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff", "X-ReklamZeka-Access-Mode": "progressive-formalization-guarded",
  "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const AUTHORITY = Object.freeze({ canApprove: false, canExecute: false, canWriteMeta: false,
  canSchedule: false, canCallTool: false });
const KEYS = Object.freeze({
  capture_g0: ["operation", "expectedRegistryHash", "rawProvenanceRef"],
  scope_g1: ["operation", "expectedRegistryHash", "formalizationRef", "expectedHeadHash", "guidanceCardRefs"],
  review_g2: ["operation", "expectedRegistryHash", "formalizationRef", "expectedHeadHash", "guidanceSetRef", "ownerConfirmation"],
  promote_g3: ["operation", "expectedRegistryHash", "formalizationRef", "expectedHeadHash", "policyRef", "expectedPreviewHash", "ownerConfirmation"],
  qualify_g4: ["operation", "expectedRegistryHash", "formalizationRef", "expectedHeadHash", "expectedPreviewHash", "ownerConfirmation"],
} satisfies Record<ProgressiveFormalizationCommand["operation"], readonly string[]>);

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new ProgressiveFormalizationStudioError("invalid_input");
  }
}
function shape(request: Request, method: "GET" | "POST", intent: string): URL {
  const url = new URL(request.url); const origin = request.headers.get("origin");
  let originMatches = method === "GET";
  if (origin && method === "POST") { try { originMatches = new URL(origin).origin === url.origin; } catch { originMatches = false; } }
  if (request.method !== method || request.headers.has("authorization") || !request.headers.get("cookie")
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
    || request.headers.get("sec-fetch-site") !== "same-origin" || request.headers.get("x-reklamzeka-intent") !== intent
    || method === "POST" && (!originMatches || request.headers.get("content-type")?.toLowerCase() !== "application/json")) {
    throw new ProgressiveFormalizationStudioError("invalid_input");
  }
  return url;
}
async function parseCommand(request: Request): Promise<ProgressiveFormalizationCommand> {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 32_000) throw new ProgressiveFormalizationStudioError("invalid_input");
  const value = JSON.parse(raw) as unknown; exact(value, ["command"]);
  if (!value.command || typeof value.command !== "object" || Array.isArray(value.command)
    || Object.getPrototypeOf(value.command) !== Object.prototype) {
    throw new ProgressiveFormalizationStudioError("invalid_input");
  }
  const candidate = value.command as Record<string, unknown>; const operation = String(candidate.operation);
  if (!Object.hasOwn(KEYS, operation)) throw new ProgressiveFormalizationStudioError("invalid_input");
  exact(candidate, KEYS[operation as keyof typeof KEYS]);
  if ("ownerConfirmation" in candidate) exact(candidate.ownerConfirmation, ["confirmed", "confirmationRef"]);
  return candidate as ProgressiveFormalizationCommand;
}
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof ProgressiveFormalizationStudioError) {
    if (reason.code === "not_found") return error("not_found", "Formalization kaydı bulunamadı.", 404);
    if (reason.code === "conflict") return error("conflict", "Formalization siz çalışırken değişti; yenileyin.", 409);
    if (reason.code === "invalid_transition") return error("invalid_transition", "Formalization geçişi persisted kanıtla uyumlu değil.", 409);
    if (reason.code === "preview_blocked") return error("preview_blocked", "Authoritative preview tamamlanmadan maturity yükseltilemez.", 409);
    if (reason.code === "forbidden") return error("forbidden", "Bu maturity geçişi için güncel rol yetersiz.", 403);
    return error("invalid_input", "Progressive formalization isteği geçersiz.", 400);
  }
  if (reason instanceof SyntaxError) return error("invalid_input", "Progressive formalization isteği geçersiz.", 400);
  return error("unavailable", "Progressive formalization şu anda kullanılamıyor.", 503);
}

export function progressiveFormalizationNotConfiguredResponse() {
  return error("source_not_configured", "Progressive formalization yerel PostgreSQL kaynağına bağlı değil.", 503);
}
export function progressiveFormalizationSessionRequiredResponse() {
  return error("local_session_required", "Progressive formalization için yerel dashboard oturumunu bağlayın.", 401);
}

export function createProgressiveFormalizationHttpHandlers(input: Readonly<{
  service: Pick<ProgressiveFormalizationService, "inspect" | "preview" | "mutate">;
  resolvePrincipal(request: Request, operation: "read" | "draft" | "publish"): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return Object.freeze({
    GET: async (request: Request) => { try {
      const url = new URL(request.url);
      if (!url.search) {
        shape(request, "GET", "progressive-formalization-read");
        const principal = await input.resolvePrincipal(request, "read"); if (!principal) throw new AuthorizationError();
        return NextResponse.json(await input.service.inspect(principal), { headers: HEADERS });
      }
      shape(request, "GET", "progressive-formalization-preview");
      const target = url.searchParams.get("target"); const formalizationRef = url.searchParams.get("formalizationRef");
      const policyRef = url.searchParams.get("policyRef");
      const keys = [...url.searchParams.keys()].sort(); const expected = target === "G3"
        ? ["formalizationRef", "policyRef", "target"] : ["formalizationRef", "target"];
      if ((target !== "G3" && target !== "G4") || !formalizationRef || keys.length !== expected.length
        || keys.some((key, index) => key !== expected[index])) throw new ProgressiveFormalizationStudioError("invalid_input");
      const principal = await input.resolvePrincipal(request, "read"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.preview(principal, { formalizationRef, target,
        policyRef: target === "G3" ? policyRef : null }), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try {
      shape(request, "POST", "progressive-formalization-mutate"); const command = await parseCommand(request);
      const operation = command.operation === "capture_g0" || command.operation === "scope_g1" ? "draft" : "publish";
      const principal = await input.resolvePrincipal(request, operation); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.mutate(principal, command), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
  });
}
