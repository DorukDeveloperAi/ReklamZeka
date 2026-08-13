import { NextResponse } from "next/server";
import { AuthorizationError } from "@/security/authorization";
import { OperationalTimelineReadError, type OperationalTimelineReadService } from "@/application/operational-timeline-read-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "read-only", "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
function failure(reason: unknown) {
  const status = reason instanceof AuthorizationError ? 403 : reason instanceof OperationalTimelineReadError && reason.code === "invalid_input" ? 400 : 503;
  const code = reason instanceof AuthorizationError ? "forbidden" : reason instanceof OperationalTimelineReadError ? reason.code : "unavailable";
  return NextResponse.json({ error: { code, message: status === 503 ? "Operasyon izi şu anda kullanılamıyor." : "Operasyon izi isteği reddedildi." } }, { status, headers: HEADERS });
}
export function operationalTimelineNotConfiguredResponse() { return failure(new OperationalTimelineReadError("source_unavailable")); }
export function createOperationalTimelineHttpHandler(input: Readonly<{ service: OperationalTimelineReadService; resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal> }>) {
  return async (request: Request) => { try {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.search || !request.headers.get("cookie") || request.headers.has("authorization") || request.headers.has("x-workspace-id")
      || request.headers.get("sec-fetch-site") !== "same-origin") throw new OperationalTimelineReadError("invalid_input");
    return NextResponse.json(await input.service.list(await input.resolvePrincipal(request)), { headers: HEADERS });
  } catch (reason) { return failure(reason); } };
}
