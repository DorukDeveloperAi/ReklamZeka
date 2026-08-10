import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { BusinessOutcomeReadError, BusinessOutcomeReadService } from "@/application/business-outcome-read-service";
import { BusinessOutcomeSignalRepositoryError } from "@/connectors/analyses/business-outcome-signal-drizzle-repository";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-ReklamZeka-Access-Mode": "business-outcome-read", "X-ReklamZeka-Action-Authority": "none" });
const AUTHORITY = Object.freeze({ canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false });
const FORWARDED = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip"] as const;
function error(code: string, message: string, status: number) { return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS }); }
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof BusinessOutcomeReadError || reason instanceof BusinessOutcomeSignalRepositoryError && reason.code === "invalid_input") return error("invalid_input", "Business outcome okuma isteği geçersiz.", 400);
  return error("unavailable", "Business outcome kaynağı şu anda okunamıyor.", 503);
}
export function createBusinessOutcomeReadHttpHandler(input: Readonly<{ service: Pick<BusinessOutcomeReadService, "list">; resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null> }>) {
  return async function GET(request: Request) { try {
    const url = new URL(request.url);
    if (request.method !== "GET" || request.headers.has("authorization") || !request.headers.get("cookie") || request.headers.get("origin") === null
      || request.headers.get("sec-fetch-site") !== "same-origin" || FORWARDED.some((header) => request.headers.has(header)) || request.headers.has("x-workspace-id")
      || request.headers.has("x-workspace-ref") || request.headers.get("x-reklamzeka-intent") !== "business-outcome-read"
      || [...url.searchParams.keys()].some((key) => !["entityRef", "limit", "cursor"].includes(key))) throw new BusinessOutcomeReadError("invalid_input");
    const principal = await input.resolvePrincipal(request); if (!principal) throw new AuthorizationError();
    return NextResponse.json(await input.service.list(principal, { entityRef: url.searchParams.get("entityRef") ?? undefined,
      limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined, cursor: url.searchParams.get("cursor") ?? undefined }), { headers: HEADERS });
  } catch (reason) { return failure(reason); } };
}
export function businessOutcomeReadNotConfiguredResponse() { return error("source_not_configured", "Business outcome okuma kaynağı yerel çalışma alanına henüz bağlanmadı.", 503); }
