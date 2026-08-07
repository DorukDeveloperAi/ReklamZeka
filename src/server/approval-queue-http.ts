import { NextResponse } from "next/server";

import {
  ApprovalQueueAgentContract,
  type ApprovalQueueAgentCall,
} from "@/application/approval-queue-agent-contract";
import { ApprovalQueueReadError } from "@/application/approval-queue-read-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "read-only",
  "X-ReklamZeka-Action-Authority": "none",
});

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: HEADERS });
}

function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof ApprovalQueueReadError) {
    if (reason.code === "invalid_input") return error("invalid_input", "Onay Kuyruğu isteği geçersiz.", 400);
    if (reason.code === "not_found") return error("not_found", "Onay Kuyruğu kaydı bulunamadı.", 404);
    if (reason.code === "unsafe_source") {
      return error("unsafe_source", "Onay Kuyruğu kaynağı güvenli biçimde gösterilemedi.", 422);
    }
  }
  return error("unavailable", "Onay Kuyruğu şu anda kullanılamıyor.", 503);
}

function exactSearchParams(url: URL, allowed: readonly string[]): boolean {
  const keys = [...url.searchParams.keys()];
  return keys.every((key) => allowed.includes(key))
    && allowed.every((key) => url.searchParams.getAll(key).length <= 1);
}

function boundedLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^[1-9][0-9]{0,2}$/.test(value)) throw new ApprovalQueueReadError("invalid_input");
  const limit = Number(value);
  if (limit > 100) throw new ApprovalQueueReadError("invalid_input");
  return limit;
}

export function approvalQueueNotConfiguredResponse() {
  return error(
    "source_not_configured",
    "Onay Kuyruğu çalışma alanı ve yerel kimlik bağlama katmanı henüz etkin değil.",
    503,
  );
}

export function createApprovalQueueHttpHandler(input: Readonly<{
  contract: ApprovalQueueAgentContract;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return async function GET(request: Request) {
    try {
      const url = new URL(request.url);
      if (!exactSearchParams(url, ["view", "unitRef", "limit", "cursor"])) {
        throw new ApprovalQueueReadError("invalid_input");
      }
      const view = url.searchParams.get("view") ?? "list";
      const unitRef = url.searchParams.get("unitRef");
      const rawLimit = url.searchParams.get("limit");
      const cursor = url.searchParams.get("cursor");
      let call: ApprovalQueueAgentCall;
      if (view === "list" && unitRef === null) {
        call = { name: "approval_queue_list", arguments: { limit: boundedLimit(rawLimit), cursor } };
      } else if (view === "detail" && unitRef !== null && rawLimit === null && cursor === null) {
        call = { name: "approval_queue_get", arguments: { unitRef } };
      } else {
        throw new ApprovalQueueReadError("invalid_input");
      }
      const principal = await input.resolvePrincipal(request);
      if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.contract.execute(principal, call), { headers: HEADERS });
    } catch (reason) {
      return failure(reason);
    }
  };
}
