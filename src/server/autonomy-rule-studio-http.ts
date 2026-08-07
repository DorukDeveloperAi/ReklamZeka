import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { type AutonomyRuleDraftRequest, type AutonomyRuleStudioService } from "@/application/autonomy-rule-studio-service";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "autonomy-read-draft", "X-ReklamZeka-Action-Authority": "none" });
const AUTHORITY = Object.freeze({ canPublish: false, canDisable: false, canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false });
const FORWARDED = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip"] as const;
function error(code: string, message: string, status: number) { return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS }); }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) throw new Error("invalid_input");
}
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof Error && reason.message === "invalid_input") return error("invalid_input", "Otonomi kuralı isteği geçersiz.", 400);
  return error("unavailable", "Autonomy Studio şu anda kullanılamıyor.", 503);
}
export function autonomyRuleStudioNotConfiguredResponse() { return error("source_not_configured", "Autonomy Studio yerel çalışma alanına henüz bağlanmadı.", 503); }

export function createAutonomyRuleStudioHttpHandlers(input: Readonly<{
  service: Pick<AutonomyRuleStudioService, "list" | "createDraft">;
  resolvePrincipal(request: Request, operation: "read" | "draft"): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return {
    GET: async (request: Request) => { try {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
        || request.headers.get("sec-fetch-site") !== "same-origin" || FORWARDED.some((header) => request.headers.has(header))
        || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
        || request.headers.get("x-reklamzeka-intent") !== "autonomy-rules-read") throw new Error("invalid_input");
      const principal = await input.resolvePrincipal(request, "read"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.list(principal), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
        || FORWARDED.some((header) => request.headers.has(header)) || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
        || request.headers.get("origin") === null || request.headers.get("sec-fetch-site") !== "same-origin"
        || request.headers.get("x-reklamzeka-intent") !== "autonomy-rule-create-draft"
        || request.headers.get("content-type")?.toLowerCase() !== "application/json") throw new Error("invalid_input");
      const text = await request.text(); if (Buffer.byteLength(text) > 8_192) throw new Error("invalid_input");
      const body = JSON.parse(text) as unknown;
      exact(body, ["ruleRef", "scope", "mode", "effective", "expires", "killSwitch", "maxActions", "sourceGuidanceRefs"]);
      const principal = await input.resolvePrincipal(request, "draft"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.createDraft(principal, body as unknown as AutonomyRuleDraftRequest), { status: 201, headers: HEADERS });
    } catch (reason) { return failure(reason); } },
  };
}
