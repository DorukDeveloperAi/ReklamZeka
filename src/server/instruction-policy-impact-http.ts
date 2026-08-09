import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { InstructionPolicyImpactRepositoryError, type InstructionPolicyImpactOperation,
  type InstructionPolicyImpactService } from "@/application/instruction-policy-impact-service";
import { AuthorizationError } from "@/security/authorization";

const POLICY_REF = /^policy_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const OPERATIONS = new Set<InstructionPolicyImpactOperation>(["publish", "pause", "archive"]);
const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "instruction-policy-impact-preview", "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Write": "disabled" });
const AUTHORITY = Object.freeze({ canPublish: false, canPause: false, canArchive: false, canApprove: false,
  canExecute: false, canSchedule: false, canCallTool: false, canWriteMeta: false });
function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}
export function instructionPolicyImpactNotConfiguredResponse() {
  return error("source_not_configured", "Talimat politikası dependency etki kaynağı henüz bağlı değil.", 503);
}
export function instructionPolicyImpactSessionRequiredResponse() {
  return error("local_session_required", "Policy etki önizlemesi için yerel dashboard oturumunu bağlayın.", 401);
}
export function createInstructionPolicyImpactHttpHandler(input: Readonly<{
  service: Pick<InstructionPolicyImpactService, "preview">;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return async (request: Request) => { try {
    const url = new URL(request.url); const keys = [...url.searchParams.keys()];
    const policyRef = url.searchParams.get("policyRef"); const operation = url.searchParams.get("operation");
    const origin = request.headers.get("origin"); let matchesOrigin = true;
    if (origin) { try { matchesOrigin = new URL(origin).origin === url.origin; } catch { matchesOrigin = false; } }
    if (request.method !== "GET" || keys.length !== 3 || new Set(keys).size !== 3
      || url.searchParams.get("view") !== "dependency-impact" || !policyRef || !POLICY_REF.test(policyRef)
      || !OPERATIONS.has(operation as InstructionPolicyImpactOperation) || request.headers.has("authorization")
      || !request.headers.get("cookie") || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
      || request.headers.get("sec-fetch-site") !== "same-origin" || !matchesOrigin
      || request.headers.get("x-reklamzeka-intent") !== "instruction-policy-impact-preview") {
      return error("invalid_input", "Talimat politikası etki isteği geçersiz.", 400);
    }
    const principal = await input.resolvePrincipal(request); if (!principal) throw new AuthorizationError();
    const result = await input.service.preview(principal, policyRef, operation as InstructionPolicyImpactOperation);
    return result ? NextResponse.json(result, { headers: HEADERS })
      : error("not_found", "Talimat politikası bulunamadı.", 404);
  } catch (reason) {
    if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
    if (reason instanceof InstructionPolicyImpactRepositoryError && reason.code === "workspace_scope_mismatch") {
      return error("forbidden", "Çalışma alanı erişilebilir değil.", 403);
    }
    if (reason instanceof InstructionPolicyImpactRepositoryError && reason.code === "invalid_input") {
      return error("invalid_input", "Talimat politikası etki isteği geçersiz.", 400);
    }
    return instructionPolicyImpactNotConfiguredResponse();
  } };
}
