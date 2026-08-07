import { NextResponse } from "next/server";
import { PracticeLabAgentContract, type PracticeLabAgentCall } from "@/application/practice-lab-agent-contract";
import { PracticeLabReadError } from "@/application/practice-lab-read-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "read-draft-ephemeral",
  "X-ReklamZeka-Action-Authority": "none",
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
  return error("unavailable", "Practice Lab şu anda kullanılamıyor.", 503);
}

export function practiceLabNotConfiguredResponse() {
  return error("source_not_configured", "Practice Lab çalışma alanı ve yerel kimlik bağlama katmanı henüz etkin değil.", 503);
}

export function createPracticeLabHttpHandler(input: Readonly<{
  contract: PracticeLabAgentContract;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return async function GET(request: Request) {
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
      const principal = await input.resolvePrincipal(request);
      if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.contract.execute(principal, call), { headers: HEADERS });
    } catch (reason) {
      return failure(reason);
    }
  };
}
