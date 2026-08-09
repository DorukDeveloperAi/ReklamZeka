import { NextResponse } from "next/server";
import { PracticeLabAgentContract, type PracticeLabAgentCall } from "@/application/practice-lab-agent-contract";
import { PracticeLabReadError } from "@/application/practice-lab-read-service";
import { AdvisedPracticeLifecycleError, type AdvisedPracticeLifecycleCommand,
  type AdvisedPracticeLifecycleService } from "@/application/advised-practice-lifecycle-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "read-guarded-lifecycle",
  "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Write": "disabled",
});

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: HEADERS });
}

function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof PracticeLabReadError) {
    if (reason.code === "invalid_input") return error("invalid_input", "Practice Lab isteği geçersiz.", 400);
    if (reason.code === "not_found") return error("not_found", "Practice bulunamadı.", 404);
    if (reason.code === "unsafe_source" || reason.code === "scope_mismatch") {
      return error("unsafe_source", "Practice Lab kaynağı güvenli biçimde gösterilemedi.", 422);
    }
  }
  if (reason instanceof AdvisedPracticeLifecycleError) {
    if (reason.code === "not_found") return error("not_found", "Practice bulunamadı.", 404);
    if (reason.code === "conflict") return error("conflict", "Practice siz çalışırken değişti; görünümü yenileyin.", 409);
    if (reason.code === "invalid_transition") return error("invalid_transition", "Practice bu lifecycle geçişine uygun değil.", 409);
    return error("invalid_input", "Practice lifecycle isteği geçersiz.", 400);
  }
  return error("unavailable", "Practice Lab şu anda kullanılamıyor.", 503);
}

export function practiceLabNotConfiguredResponse() {
  return error("source_not_configured", "Practice Lab çalışma alanı ve yerel kimlik bağlama katmanı henüz etkin değil.", 503);
}

export function createPracticeLabHttpHandlers(input: Readonly<{
  contract: PracticeLabAgentContract;
  lifecycle: Pick<AdvisedPracticeLifecycleService, "mutate">;
  resolvePrincipal(request: Request, operation: "read" | "draft" | "standardize"): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return Object.freeze({ GET: async (request: Request) => {
    try {
      const url = new URL(request.url);
      if ([...url.searchParams.keys()].some((key) => !["view", "practiceRef", "limit", "cursor"].includes(key))) {
        throw new PracticeLabReadError("invalid_input");
      }
      const view = url.searchParams.get("view") ?? "list";
      const practiceRef = url.searchParams.get("practiceRef");
      const limit = url.searchParams.get("limit");
      const cursor = url.searchParams.get("cursor");
      let call: PracticeLabAgentCall;
      if (view === "list" && practiceRef === null) {
        call = { name: "practice_lab_list", arguments: { limit: limit === null ? undefined : Number(limit), cursor } };
      } else if ((view === "detail" || view === "draft") && practiceRef !== null && limit === null && cursor === null) {
        call = { name: view === "detail" ? "practice_lab_get" : "practice_lab_prepare_draft", arguments: { practiceRef } };
      } else throw new PracticeLabReadError("invalid_input");
      const principal = await input.resolvePrincipal(request, "read");
      if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.contract.execute(principal, call), { headers: HEADERS });
    } catch (reason) {
      return failure(reason);
    }
  }, POST: async (request: Request) => {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      if (request.method !== "POST" || url.search || request.headers.has("authorization")
        || !request.headers.get("cookie") || request.headers.has("x-workspace-id")
        || request.headers.has("x-workspace-ref") || request.headers.get("sec-fetch-site") !== "same-origin"
        || origin === null || new URL(origin).origin !== url.origin
        || request.headers.get("content-type")?.toLowerCase() !== "application/json") {
        throw new AdvisedPracticeLifecycleError("invalid_input");
      }
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 12_000) throw new AdvisedPracticeLifecycleError("invalid_input");
      const value = JSON.parse(raw) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1
        || !("command" in value) || !value.command || typeof value.command !== "object" || Array.isArray(value.command)) {
        throw new AdvisedPracticeLifecycleError("invalid_input");
      }
      const command = value.command as AdvisedPracticeLifecycleCommand;
      if (command.operation !== "propose_standardization" && command.operation !== "standardize") {
        throw new AdvisedPracticeLifecycleError("invalid_input");
      }
      const commandKeys = command.operation === "propose_standardization"
        ? ["operation", "practiceRef", "expectedDefinitionVersion", "expectedRevisionRef", "candidateNote"]
        : ["operation", "practiceRef", "expectedDefinitionVersion", "expectedRevisionRef", "decisionRef",
          "confirmationNote", "humanConfirmation"];
      if (Object.keys(command).length !== commandKeys.length
        || Object.keys(command).some((key) => !commandKeys.includes(key))) {
        throw new AdvisedPracticeLifecycleError("invalid_input");
      }
      const operation = command.operation === "propose_standardization" ? "draft" : "standardize";
      const expectedIntent = operation === "draft" ? "practice-lab-propose-standardization" : "practice-lab-standardize";
      if (request.headers.get("x-reklamzeka-intent") !== expectedIntent) {
        throw new AdvisedPracticeLifecycleError("invalid_input");
      }
      const principal = await input.resolvePrincipal(request, operation);
      if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.lifecycle.mutate(principal, command), { headers: HEADERS });
    } catch (reason) { return failure(reason); }
  } });
}

/** Read-only compatibility wrapper retained for agent-tool callers and focused tests. */
export function createPracticeLabHttpHandler(input: Readonly<{
  contract: PracticeLabAgentContract;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return async function GET(request: Request) {
    const handlers = createPracticeLabHttpHandlers({ ...input,
      lifecycle: { mutate: async () => { throw new AdvisedPracticeLifecycleError("invalid_input"); } },
      resolvePrincipal: (candidate) => input.resolvePrincipal(candidate) });
    return handlers.GET(request);
  };
}
