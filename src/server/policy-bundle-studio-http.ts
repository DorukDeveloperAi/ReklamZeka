import { NextResponse } from "next/server";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { PolicyBundleStudioError, type PolicyBundleDraftRequest,
  type PolicyBundleStudioService } from "@/application/policy-bundle-studio-service";
import { ActionGuardrailPolicyError } from "@/domain/actions/action-guardrail-policy";
import { ApprovalPolicyRegistryError } from "@/domain/actions/approval-policy-registry";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "policy-bundle-read-draft", "X-ReklamZeka-Action-Authority": "none" });
const AUTHORITY = Object.freeze({ canDraft: false, canPublish: false, canDisable: false, canApproveAction: false,
  canGrant: false, canExecute: false, canWriteMeta: false });
const FORWARDED = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip"] as const;
function response(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return response("forbidden", reason.publicMessage, 403);
  if (reason instanceof PolicyBundleStudioError && reason.code === "draft_exists") {
    return response("draft_exists", "Bu policy için zaten immutable bir taslak var; önce review/yayın akışı tamamlanmalı.", 409);
  }
  if (reason instanceof PolicyBundleStudioError && reason.code === "scope_unavailable") {
    return response("scope_unavailable", "Seçilen kapsam güncel server kataloğunda doğrulanamadı.", 409);
  }
  if (reason instanceof SyntaxError || reason instanceof PolicyBundleStudioError && reason.code === "invalid_input"
    || reason instanceof ApprovalPolicyRegistryError && reason.code === "invalid_input"
    || reason instanceof ActionGuardrailPolicyError && reason.code === "invalid_input") {
    return response("invalid_input", "K4 policy bundle isteği geçersiz.", 400);
  }
  return response("unavailable", "K4 Policy Bundle Studio şu anda kullanılamıyor.", 503);
}
export function policyBundleStudioNotConfiguredResponse() {
  return response("source_not_configured", "K4 Policy Bundle Studio yerel çalışma alanına henüz bağlanmadı.", 503);
}
function trusted(request: Request, method: "GET" | "POST", intent: string): boolean {
  const url = new URL(request.url);
  return request.method === method && !url.search && !request.headers.has("authorization")
    && Boolean(request.headers.get("cookie")) && request.headers.get("sec-fetch-site") === "same-origin"
    && !FORWARDED.some((header) => request.headers.has(header)) && !request.headers.has("x-workspace-id")
    && !request.headers.has("x-workspace-ref") && request.headers.get("x-reklamzeka-intent") === intent;
}

export function createPolicyBundleStudioHttpHandlers(input: Readonly<{
  service: Pick<PolicyBundleStudioService, "list" | "createDraft">;
  resolvePrincipal(request: Request, operation: "read" | "draft"): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return {
    GET: async (request: Request) => { try {
      if (!trusted(request, "GET", "policy-bundle-read")) throw new PolicyBundleStudioError("invalid_input");
      const principal = await input.resolvePrincipal(request, "read"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.list(principal), { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try {
      if (!trusted(request, "POST", "policy-bundle-create-draft") || request.headers.get("origin") === null
        || request.headers.get("content-type")?.toLowerCase() !== "application/json") {
        throw new PolicyBundleStudioError("invalid_input");
      }
      const text = await request.text();
      if (Buffer.byteLength(text) > 16_384) throw new PolicyBundleStudioError("invalid_input");
      const body = JSON.parse(text) as PolicyBundleDraftRequest;
      if (!body || typeof body !== "object" || Array.isArray(body)
        || !(body.kind === "approval_policy" || body.kind === "guardrail_policy")) {
        throw new PolicyBundleStudioError("invalid_input");
      }
      const principal = await input.resolvePrincipal(request, "draft"); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.createDraft(principal, body), { status: 201, headers: HEADERS });
    } catch (reason) { return failure(reason); } },
  };
}
