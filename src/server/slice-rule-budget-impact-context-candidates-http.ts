import { NextResponse } from "next/server";

import { BudgetImpactContextCandidateError, type BudgetImpactContextCandidateService } from "@/application/slice-rule-budget-impact-context-candidate-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "slice-rule-budget-impact-context-candidates-read", "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const CLOSED = Object.freeze({ canPreview: false, canSave: false, canApprove: false, canExecute: false, canWriteMeta: false });
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const fail = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message }, authority: CLOSED }, { status, headers: HEADERS });

export function sliceRuleBudgetImpactContextCandidatesNotConfiguredResponse() { return fail(503, "source_not_configured", "Bütçe etki bağlam adayları yerel oturuma bağlı değil."); }
export function sliceRuleBudgetImpactContextCandidatesSessionRequiredResponse() { return fail(401, "local_session_required", "Bütçe etki bağlamı için yerel dashboard oturumunu bağlayın."); }

export function createSliceRuleBudgetImpactContextCandidatesHttpHandler(input: Readonly<{
  service: Pick<BudgetImpactContextCandidateService, "list">;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal>;
}>) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url); const seriesRef = url.searchParams.get("seriesRef");
      if (request.method !== "GET" || url.searchParams.size !== 1 || !seriesRef || !REF.test(seriesRef)
        || !request.headers.get("cookie") || request.headers.has("authorization") || request.headers.has("x-workspace-id")
        || request.headers.has("x-workspace-ref") || request.headers.get("sec-fetch-site") !== "same-origin"
        || request.headers.get("x-reklamzeka-intent") !== "slice-rule-budget-impact-context-candidates-read") {
        return fail(400, "invalid_input", "Bütçe etki bağlam adayı isteği geçersiz.");
      }
      return NextResponse.json(await input.service.list(await input.resolvePrincipal(request), seriesRef), { headers: HEADERS });
    } catch (reason) {
      if (reason instanceof BudgetImpactContextCandidateError) {
        const status = reason.code === "draft_missing" ? 404 : ["pool_binding_required", "candidate_stale", "market_boundary"].includes(reason.code) ? 409 : 400;
        return fail(status, reason.code, "Bütçe etki bağlamı mevcut immutable kapsamda hazır değil.");
      }
      return sliceRuleBudgetImpactContextCandidatesNotConfiguredResponse();
    }
  };
}
