import { NextResponse } from "next/server";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { DrizzleSliceRuleScenarioAllocationSelectionRepository, SliceRuleScenarioAllocationSelectionRepositoryError } from "@/connectors/campaigns/slice-rule-scenario-allocation-selection-drizzle-repository";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "human-selection-only", "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const AUTHORITY = Object.freeze({ canSelect: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const, canEnableAutomation: false as const });
const CANDIDATE = /^selection_candidate_[a-f0-9]{64}$/; const KEY = /^[a-z][a-z0-9_.:-]{0,127}$/;

function error(code: string, message: string, status: number) { return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS }); }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw new Error("invalid_input");
}
function trusted(request: Request, method: "GET" | "POST", intent: string) {
  const url = new URL(request.url); const origin = request.headers.get("origin"); let sameOrigin = method === "GET";
  try { if (origin) sameOrigin = new URL(origin).origin === url.origin; } catch { sameOrigin = false; }
  if (request.method !== method || url.search || !request.headers.get("cookie") || request.headers.has("authorization") || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
    || request.headers.get("sec-fetch-site") !== "same-origin" || request.headers.get("x-reklamzeka-intent") !== intent
    || method === "POST" && (!sameOrigin || request.headers.get("content-type")?.toLowerCase() !== "application/json")) throw new Error("invalid_input");
}
async function command(request: Request) {
  const raw = await request.text(); if (Buffer.byteLength(raw) > 1_000) throw new Error("invalid_input");
  const value = JSON.parse(raw) as unknown; exact(value, ["command"]); exact(value.command, ["candidateRef", "idempotencyKey"]);
  if (!CANDIDATE.test(String(value.command.candidateRef)) || !KEY.test(String(value.command.idempotencyKey))) throw new Error("invalid_input");
  return value.command as Readonly<{ candidateRef: string; idempotencyKey: string }>;
}
function failure(reason: unknown) {
  if (reason instanceof SliceRuleScenarioAllocationSelectionRepositoryError) {
    if (["membership_required", "role_denied", "workspace_scope_mismatch"].includes(reason.code)) return error("forbidden", "Bu çalışma alanında senaryo seçme yetkiniz yok.", 403);
    if (["delivery_hold", "market_boundary", "scope_mismatch", "stale_source", "source_missing", "source_ambiguous", "source_not_selectable", "idempotency_conflict"].includes(reason.code)) return error(reason.code, "Seçim kaynağı değişti veya güvenlik kapısı seçimi engelledi.", 409);
  }
  if (reason instanceof SyntaxError || reason instanceof Error && reason.message === "invalid_input") return error("invalid_input", "Senaryo seçimi isteği geçersiz.", 400);
  return error("unavailable", "Seçilebilir senaryolar şu anda güvenli biçimde okunamıyor.", 503);
}

export function createSliceRuleScenarioSelectionHttpHandlers(input: Readonly<{
  repository: Pick<DrizzleSliceRuleScenarioAllocationSelectionRepository, "listCandidates" | "resolveCandidate" | "append">;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal>;
  now(): string;
}>) {
  return Object.freeze({
    GET: async (request: Request) => { try { trusted(request, "GET", "slice-rule-scenario-selection-read"); const principal = await input.resolvePrincipal(request);
      return NextResponse.json({ contractVersion: "slice-rule-scenario-selection/1.0.0", candidates: await input.repository.listCandidates(principal.workspaceId), authority: AUTHORITY }, { headers: HEADERS });
    } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try { trusted(request, "POST", "slice-rule-scenario-select"); const [parsed, principal] = await Promise.all([command(request), input.resolvePrincipal(request)]);
      const source = await input.repository.resolveCandidate(principal.workspaceId, parsed.candidateRef);
      const result = await input.repository.append({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, selectedAt: input.now(), idempotencyKey: parsed.idempotencyKey,
        draftHash: source.draftHash, proposalHash: source.proposalHash, scenarioRef: source.scenarioRef, allocationRef: source.allocationRef });
      return NextResponse.json({ contractVersion: "slice-rule-scenario-selection/1.0.0", candidateRef: parsed.candidateRef, persistence: result.outcome,
        selectionRef: `selection_${result.selectionEvidenceHash}`, authority: AUTHORITY }, { status: result.outcome === "inserted" ? 201 : 200, headers: HEADERS });
    } catch (reason) { return failure(reason); } },
  });
}
