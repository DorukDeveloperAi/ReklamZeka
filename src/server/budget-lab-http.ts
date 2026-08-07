import { NextResponse } from "next/server";
import { BudgetLabAgentContract, type BudgetLabAgentCall } from "@/application/budget-lab-agent-contract";
import { BudgetLabReadError } from "@/application/budget-lab-read-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "read-only", "X-ReklamZeka-Action-Authority": "none",
});

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: HEADERS });
}

function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof BudgetLabReadError) {
    if (reason.code === "invalid_input") return error("invalid_input", "Budget Lab isteği geçersiz.", 400);
    if (reason.code === "not_found") return error("not_found", "Bütçe önerisi bulunamadı.", 404);
    if (reason.code === "unsafe_source") return error("unsafe_source", "Bütçe önerisi güvenli biçimde gösterilemedi.", 422);
  }
  return error("unavailable", "Budget Lab şu anda kullanılamıyor.", 503);
}

export function budgetLabNotConfiguredResponse() {
  return error("source_not_configured", "Budget Lab çalışma alanı ve yerel kimlik bağlama katmanı henüz etkin değil.", 503);
}

export function createBudgetLabHttpHandler(input: Readonly<{
  contract: BudgetLabAgentContract;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return async function GET(request: Request) {
    try {
      const url = new URL(request.url);
      if ([...url.searchParams.keys()].some((key) => !["view", "seriesRef", "revision", "limit", "cursor"].includes(key))) {
        throw new BudgetLabReadError("invalid_input");
      }
      const view = url.searchParams.get("view") ?? "list";
      const seriesRef = url.searchParams.get("seriesRef");
      const revision = url.searchParams.get("revision");
      const limit = url.searchParams.get("limit");
      const cursor = url.searchParams.get("cursor");
      let call: BudgetLabAgentCall;
      if (view === "list" && seriesRef === null && revision === null) {
        call = { name: "budget_lab_list", arguments: { limit: limit === null ? undefined : Number(limit), cursor } };
      } else if (view === "detail" && seriesRef !== null && limit === null && cursor === null) {
        call = { name: "budget_lab_get", arguments: { seriesRef, revision: revision === null ? undefined : Number(revision) } };
      } else throw new BudgetLabReadError("invalid_input");
      const principal = await input.resolvePrincipal(request);
      if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.contract.execute(principal, call), { headers: HEADERS });
    } catch (reason) {
      return failure(reason);
    }
  };
}
