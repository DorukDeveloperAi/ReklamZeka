import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { BusinessOutcomeSignalService, type BusinessOutcomeSignalCommand } from "@/application/business-outcome-signal-service";
import { BusinessOutcomeSignalRepositoryError } from "@/connectors/analyses/business-outcome-signal-drizzle-repository";
import { AuthorizationError } from "@/security/authorization";
const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-ReklamZeka-Access-Mode": "business-outcome-record", "X-ReklamZeka-Action-Authority": "none" });
const AUTHORITY = Object.freeze({ canRecordEvidence: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, metaProxyEligible: false });
const FORWARDED = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip"] as const;
function error(code: string, message: string, status: number) { return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS }); }
function exact(value: unknown): asserts value is Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 || !Object.prototype.hasOwnProperty.call(value, "source") || !Object.prototype.hasOwnProperty.call(value, "signals")) throw new Error("invalid_input"); }
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError || reason instanceof BusinessOutcomeSignalRepositoryError && reason.code === "forbidden") return error("forbidden", "Business outcome kaydı yetkiniz yok.", 403);
  if (reason instanceof BusinessOutcomeSignalRepositoryError && reason.code === "not_found") return error("not_found", "Çalışma alanı bulunamadı.", 404);
  if (reason instanceof BusinessOutcomeSignalRepositoryError && reason.code === "conflict") return error("conflict", "Business outcome kaydı çakıştı.", 409);
  if (reason instanceof BusinessOutcomeSignalRepositoryError && reason.code === "invalid_input" || reason instanceof SyntaxError || reason instanceof Error && reason.message === "invalid_input") return error("invalid_input", "Business outcome isteği geçersiz.", 400);
  return error("unavailable", "Business outcome kaydı şu anda kullanılamıyor.", 503);
}
export function businessOutcomeSignalNotConfiguredResponse() { return error("source_not_configured", "Business outcome kaydı yerel çalışma alanına henüz bağlanmadı.", 503); }
export function createBusinessOutcomeSignalHttpHandler(input: Readonly<{ service: Pick<BusinessOutcomeSignalService, "record">; resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null> }>) {
  return async function POST(request: Request) { try {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.search || request.headers.has("authorization") || !request.headers.get("cookie") || request.headers.get("origin") === null || request.headers.get("sec-fetch-site") !== "same-origin" || FORWARDED.some((header) => request.headers.has(header)) || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref") || request.headers.get("x-reklamzeka-intent") !== "business-outcome-record" || request.headers.get("content-type")?.toLowerCase() !== "application/json") throw new Error("invalid_input");
    const text = await request.text(); if (Buffer.byteLength(text) > 65_536) throw new Error("invalid_input");
    const command = JSON.parse(text) as unknown; exact(command); const principal = await input.resolvePrincipal(request); if (!principal) throw new AuthorizationError();
    return NextResponse.json(await input.service.record(principal, command as BusinessOutcomeSignalCommand), { status: 201, headers: HEADERS });
  } catch (reason) { return failure(reason); } };
}
