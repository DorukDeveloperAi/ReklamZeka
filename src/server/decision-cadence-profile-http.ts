import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { DecisionCadenceProfileService, type DecisionCadenceProfileCommand } from "@/application/decision-cadence-profile-service";
import { DecisionCadenceProfileRepositoryError } from "@/connectors/decisions/decision-cadence-profile-drizzle-repository";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "decision-cadence-publish", "X-ReklamZeka-Action-Authority": "none" });
const AUTHORITY = Object.freeze({ canPublishProfile: false, canApprove: false, canExecute: false, canWriteMeta: false });
const FORWARDED = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip"] as const;

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}
function exact(value: unknown): asserts value is Record<string, unknown> {
  const keys = ["accountRef", "campaignRef", "profileRef", "revision", "expectedCurrentHash", "profile"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) throw new Error("invalid_input");
}
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof DecisionCadenceProfileRepositoryError) {
    if (reason.code === "forbidden") return error("forbidden", "Cadence profili yayımlama yetkiniz yok.", 403);
    if (reason.code === "not_found") return error("not_found", "Cadence kapsamı bulunamadı.", 404);
    if (reason.code === "conflict") return error("conflict", "Cadence profili değişti; güncel sürümü yeniden alın.", 409);
    if (reason.code === "invalid_input") return error("invalid_input", "Cadence profili geçersiz.", 400);
  }
  if (reason instanceof SyntaxError || reason instanceof Error && reason.message === "invalid_input") {
    return error("invalid_input", "Cadence isteği geçersiz.", 400);
  }
  return error("unavailable", "Cadence yayınlama şu anda kullanılamıyor.", 503);
}

export function decisionCadenceProfileNotConfiguredResponse() {
  return error("source_not_configured", "Cadence yayınlama yerel çalışma alanına henüz bağlanmadı.", 503);
}

export function createDecisionCadenceProfileHttpHandler(input: Readonly<{
  service: Pick<DecisionCadenceProfileService, "publish">;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return async function POST(request: Request) {
    try {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
        || request.headers.get("origin") === null || request.headers.get("sec-fetch-site") !== "same-origin"
        || FORWARDED.some((header) => request.headers.has(header)) || request.headers.has("x-workspace-id")
        || request.headers.has("x-workspace-ref") || request.headers.get("x-reklamzeka-intent") !== "decision-cadence-publish"
        || request.headers.get("content-type")?.toLowerCase() !== "application/json") throw new Error("invalid_input");
      const text = await request.text();
      if (Buffer.byteLength(text) > 8_192) throw new Error("invalid_input");
      const command = JSON.parse(text) as unknown;
      exact(command);
      const principal = await input.resolvePrincipal(request);
      if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.publish(principal, command as DecisionCadenceProfileCommand), { status: 201, headers: HEADERS });
    } catch (reason) { return failure(reason); }
  };
}
