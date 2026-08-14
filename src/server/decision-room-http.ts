import { NextResponse } from "next/server";
import {
  DecisionRoomAgentContract,
  type TrustedDecisionRoomPrincipal,
} from "@/application/decision-room-agent-contract";
import { DecisionRoomReadError } from "@/application/decision-room-read-service";
import { AuthorizationError } from "@/security/authorization";

export type DecisionRoomPrincipalResolver = (request: Request) => Promise<TrustedDecisionRoomPrincipal | null>;

type HttpDependencies = Readonly<{
  contract: DecisionRoomAgentContract;
  resolvePrincipal: DecisionRoomPrincipalResolver;
}>;

const NO_STORE = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "read-only",
  "X-ReklamZeka-Action-Authority": "none",
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

function readError(error: unknown) {
  if (error instanceof AuthorizationError) return errorResponse("forbidden", error.publicMessage, 403);
  if (error instanceof DecisionRoomReadError) {
    if (error.code === "not_found") return errorResponse("not_found", "Decision Room kaydı bulunamadı.", 404);
    if (error.code === "invalid_input") return errorResponse("invalid_input", "Decision Room isteği geçersiz.", 400);
    return errorResponse("invalid_source", "Decision Room kaynağı güvenli biçimde okunamadı.", 422);
  }
  return errorResponse("unavailable", "Decision Room şu anda kullanılamıyor.", 503);
}

function exactSearchParams(url: URL, allowed: readonly string[]): boolean {
  return [...url.searchParams.keys()].every((key) => allowed.includes(key));
}

async function principalOrThrow(request: Request, resolver: DecisionRoomPrincipalResolver) {
  const principal = await resolver(request);
  if (!principal) throw new AuthorizationError();
  return principal;
}

export function createDecisionRoomHttpHandlers(dependencies: HttpDependencies) {
  return Object.freeze({
    async GET(request: Request) {
      try {
        const url = new URL(request.url);
        if (!exactSearchParams(url, ["view", "campaignRef", "limit", "cursor"])) throw new DecisionRoomReadError("invalid_input");
        const view = url.searchParams.get("view");
        const campaignRef = url.searchParams.get("campaignRef");
        const rawLimit = url.searchParams.get("limit");
        const cursor = url.searchParams.get("cursor");
        const principal = await principalOrThrow(request, dependencies.resolvePrincipal);
        const response = await dependencies.contract.execute(principal, {
          name: "decision_room_list",
          arguments: {
            view: view as "schedules" | "runs" | "inbox",
            campaignRef,
            limit: rawLimit === null ? undefined : Number(rawLimit),
            cursor,
          },
        });
        return NextResponse.json(response, { headers: NO_STORE });
      } catch (error) {
        return readError(error);
      }
    },

    async PATCH(request: Request) {
      try {
        const url = new URL(request.url);
        if (url.search || request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
          throw new DecisionRoomReadError("invalid_input");
        }
        const contentLength = request.headers.get("content-length");
        if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > 1024)) {
          throw new DecisionRoomReadError("invalid_input");
        }
        const text = await request.text();
        if (text.length > 1024) throw new DecisionRoomReadError("invalid_input");
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          throw new DecisionRoomReadError("invalid_input");
        }
        if (!body || typeof body !== "object" || Array.isArray(body)
          || Object.keys(body).length !== 1 || !("notificationRef" in body)) {
          throw new DecisionRoomReadError("invalid_input");
        }
        const principal = await principalOrThrow(request, dependencies.resolvePrincipal);
        const response = await dependencies.contract.execute(principal, {
          name: "decision_room_mark_inbox_read",
          arguments: { notificationRef: (body as { notificationRef: string }).notificationRef },
        });
        return NextResponse.json(response, { headers: NO_STORE });
      } catch (error) {
        return readError(error);
      }
    },
  });
}

export function decisionRoomNotConfiguredResponse() {
  return errorResponse(
    "source_not_configured",
    "Decision Room çalışma alanı ve kimlik bağlama katmanı henüz etkin değil.",
    503,
  );
}
