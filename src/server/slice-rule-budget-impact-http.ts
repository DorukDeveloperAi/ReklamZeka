import { NextResponse } from "next/server";

import {
  SliceRuleBudgetImpactError,
  type SliceRuleBudgetImpactInput,
  type SliceRuleBudgetImpactService,
} from "@/application/slice-rule-budget-impact-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "slice-rule-budget-impact-advisory",
  "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Write": "disabled",
});
const AUTHORITY = Object.freeze({ recommendationOnly: true as const, canPublish: false as const,
  canApprove: false as const, canCreateProposal: false as const, canExecute: false as const,
  canWriteMeta: false as const });

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new SliceRuleBudgetImpactError("invalid_input");
  }
}

function requestShape(request: Request): void {
  const url = new URL(request.url); const origin = request.headers.get("origin");
  let sameOrigin = false;
  try { sameOrigin = origin !== null && new URL(origin).origin === url.origin; } catch { sameOrigin = false; }
  if (request.method !== "POST" || url.search || !sameOrigin || !request.headers.get("cookie")
    || request.headers.has("authorization") || request.headers.has("x-workspace-id")
    || request.headers.has("x-workspace-ref") || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("content-type")?.toLowerCase() !== "application/json"
    || !["slice-rule-budget-impact-preview", "slice-rule-budget-impact-save"].includes(request.headers.get("x-reklamzeka-intent") ?? "")) {
    throw new SliceRuleBudgetImpactError("invalid_input");
  }
}

async function candidateBody(request: Request): Promise<Readonly<{ seriesRef: string; candidateRef: string; budgetCommand: unknown }>> {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 64_000) throw new SliceRuleBudgetImpactError("invalid_input");
  const value = JSON.parse(raw) as unknown; exact(value, ["command"]);
  exact(value.command, ["seriesRef", "candidateRef", "budgetCommand"]);
  const command = value.command as Record<string, unknown>;
  if (typeof command.seriesRef !== "string" || typeof command.candidateRef !== "string" || !command.budgetCommand
    || typeof command.budgetCommand !== "object" || Array.isArray(command.budgetCommand)) throw new SliceRuleBudgetImpactError("invalid_input");
  const forbidden = /^(?:workspaceId|adAccountId|campaignId|contextHash)$/i;
  const privateValue = /^(?:[a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f-]{27,})$/i;
  const inspect = (entry: unknown): boolean => typeof entry === "string" ? !privateValue.test(entry) : Array.isArray(entry) ? entry.every(inspect) : !entry || typeof entry !== "object" ? true
    : Object.entries(entry as Record<string, unknown>).every(([key, child]) => !forbidden.test(key) && inspect(child));
  if (!inspect(command)) throw new SliceRuleBudgetImpactError("invalid_input");
  return command as Readonly<{ seriesRef: string; candidateRef: string; budgetCommand: unknown }>;
}

function failure(reason: unknown) {
  if (reason instanceof SliceRuleBudgetImpactError) {
    if (reason.code === "draft_missing") return error(reason.code, "Slice rule taslağı bulunamadı.", 404);
    if (["stale_draft", "scope_evidence_not_ready", "market_boundary", "scope_mismatch", "pool_binding_required"].includes(reason.code)) {
      return error(reason.code, "Taslak veya kapsam kanıtı değişti; önizleme üretilmedi.", 409);
    }
    return error(reason.code, reason.code === "invalid_input" ? "Etki önizleme isteği geçersiz."
      : "Güvenli Budget Lab önizlemesi doğrulanamadı.", reason.code === "invalid_input" ? 400 : 503);
  }
  if (reason instanceof SyntaxError) return error("invalid_input", "Etki önizleme isteği geçersiz.", 400);
  return error("unavailable", "Etki önizlemesi şu anda kullanılamıyor.", 503);
}

export function createSliceRuleBudgetImpactHttpHandler(input: Readonly<{
  service: Pick<SliceRuleBudgetImpactService, "preview" | "save">;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal>;
  resolveCandidateCommand?(principal: TrustedDecisionRoomPrincipal, command: Readonly<{ seriesRef: string; candidateRef: string; budgetCommand: unknown }>): Promise<SliceRuleBudgetImpactInput>;
}>) {
  return async (request: Request) => {
    try {
      requestShape(request);
      const principal = await input.resolvePrincipal(request);
      const candidate = await candidateBody(request);
      const scoped = input.resolveCandidateCommand
        ? await input.resolveCandidateCommand(principal, candidate)
        : (() => { throw new SliceRuleBudgetImpactError("invalid_input"); })();
      const result = request.headers.get("x-reklamzeka-intent") === "slice-rule-budget-impact-save"
        ? await input.service.save(scoped, new Date().toISOString())
        : await input.service.preview(scoped);
      return NextResponse.json(result, { headers: HEADERS });
    } catch (reason) { return failure(reason); }
  };
}
