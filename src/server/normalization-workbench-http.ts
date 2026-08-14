import { NextResponse } from "next/server";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { NormalizationWorkbenchService, NormalizationWorkbenchServiceError } from "@/application/normalization-workbench-service";
import { NormalizationWorkbenchError, type NormalizationWorkbenchAnswers, type NormalizationWorkbenchSelection } from
  "@/connectors/guidance/normalization-workbench-drizzle-repository";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "normalization-workbench-draft-only", "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Write": "disabled" });
const AUTHORITY = Object.freeze({ canPublish: false, canPromotePolicy: false, canApprove: false, canExecute: false, canWriteMeta: false });

function responseError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) throw new NormalizationWorkbenchServiceError("invalid_input");
}
function shape(request: Request, method: "GET" | "POST", intent: string | readonly string[]): void {
  const url = new URL(request.url); const origin = request.headers.get("origin");
  const intents = typeof intent === "string" ? [intent] : intent;
  let sameOrigin = method === "GET";
  if (origin && method === "POST") { try { sameOrigin = new URL(origin).origin === url.origin; } catch { sameOrigin = false; } }
  if (request.method !== method || method === "GET" && url.search || request.headers.has("authorization") || !request.headers.get("cookie")
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref") || request.headers.get("sec-fetch-site") !== "same-origin"
    || !intents.includes(request.headers.get("x-reklamzeka-intent") ?? "") || method === "POST" && (!sameOrigin
      || request.headers.get("content-type")?.toLowerCase() !== "application/json")) throw new NormalizationWorkbenchServiceError("invalid_input");
}
type ParsedCommand = Readonly<{ operation: "preview"; selection: Partial<NormalizationWorkbenchSelection> }>
  | Readonly<{ operation: "assess"; answers: unknown }>
  | Readonly<{ operation: "create"; expectedSelectionHash: string; selection: unknown; answers: NormalizationWorkbenchAnswers }>;
async function command(request: Request): Promise<ParsedCommand> {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 40_000) throw new NormalizationWorkbenchServiceError("invalid_input");
  const value = JSON.parse(raw) as unknown;
  exact(value, ["command"]); if (!value.command || typeof value.command !== "object" || Array.isArray(value.command)) {
    throw new NormalizationWorkbenchServiceError("invalid_input");
  }
  const candidate = value.command as Record<string, unknown>;
  if (candidate.operation === "preview") {
    exact(candidate, ["operation", "selection"]);
    return Object.freeze({ operation: "preview", selection: candidate.selection as Partial<NormalizationWorkbenchSelection> });
  }
  if (candidate.operation === "assess") {
    exact(candidate, ["operation", "answers"]);
    return Object.freeze({ operation: "assess", answers: candidate.answers });
  }
  if (candidate.operation === "create") {
    exact(candidate, ["operation", "expectedSelectionHash", "selection", "answers"]);
    return Object.freeze({ operation: "create", expectedSelectionHash: candidate.expectedSelectionHash as string,
      selection: candidate.selection, answers: candidate.answers as NormalizationWorkbenchAnswers });
  }
  throw new NormalizationWorkbenchServiceError("invalid_input");
}
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError || reason instanceof NormalizationWorkbenchServiceError && reason.code === "forbidden") {
    return responseError("forbidden", "Bu normalizasyon taslağı için güncel çalışma alanı rolü yetersiz.", 403);
  }
  if (reason instanceof NormalizationWorkbenchError) {
    if (reason.code === "not_found") return responseError("not_found", "Seçilen guidance kaynağı bulunamadı.", 404);
    if (reason.code === "conflict") return responseError("conflict", "Kaynak siz çalışırken değişti; önizlemeyi yenileyin.", 409);
    if (reason.code === "needs_input") return responseError("needs_input", "Seçili source/card/set birlikte güvenli biçimde çözülemedi.", 409);
  }
  if (reason instanceof NormalizationWorkbenchServiceError || reason instanceof NormalizationWorkbenchError || reason instanceof SyntaxError) {
    return responseError("invalid_input", "Normalizasyon isteği geçersiz.", 400);
  }
  return responseError("unavailable", "Normalizasyon çalışma alanı şu anda kullanılamıyor.", 503);
}

export function normalizationWorkbenchNotConfiguredResponse() {
  return responseError("source_not_configured", "Normalizasyon çalışma alanı yerel oturuma henüz bağlanmadı.", 503);
}
export function normalizationWorkbenchSessionRequiredResponse() {
  return responseError("local_session_required", "Normalizasyon çalışma alanı için yerel dashboard oturumunu bağlayın.", 401);
}

export function createNormalizationWorkbenchHttpHandlers(input: Readonly<{
  service: Pick<NormalizationWorkbenchService, "inspect" | "preview" | "assess" | "create">;
  resolvePrincipal(request: Request, operation: "read" | "draft"): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return Object.freeze({
    GET: async (request: Request) => { try {
      shape(request, "GET", "normalization-workbench-read");
      const principal = await input.resolvePrincipal(request, "read"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.inspect(principal), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try {
      shape(request, "POST", ["normalization-workbench-read", "normalization-workbench-draft"]); const parsed = await command(request);
      const requiredIntent = parsed.operation === "create" ? "normalization-workbench-draft" : "normalization-workbench-read";
      if (request.headers.get("x-reklamzeka-intent") !== requiredIntent) throw new NormalizationWorkbenchServiceError("invalid_input");
      const principal = await input.resolvePrincipal(request, parsed.operation === "create" ? "draft" : "read");
      if (!principal) throw new AuthorizationError();
      const result = parsed.operation === "preview" ? await input.service.preview(principal, parsed.selection)
        : parsed.operation === "assess" ? await input.service.assess(principal, parsed.answers)
          : await input.service.create(principal, parsed);
      return NextResponse.json(result, { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
  });
}
