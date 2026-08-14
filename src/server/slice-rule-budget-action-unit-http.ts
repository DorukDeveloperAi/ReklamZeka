import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { DrizzleSliceRuleBudgetActionUnitMaterializer, SliceRuleBudgetActionUnitMaterializerError } from "@/connectors/campaigns/slice-rule-budget-action-unit-materializer";
import { DrizzleSliceRuleDecisionTraceReadRepository, SLICE_RULE_DECISION_TRACE_VERSION } from "@/connectors/campaigns/slice-rule-decision-trace-drizzle-read-repository";
import * as schema from "@/db/schema";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { publicActionPreparationFlag } from "@/domain/actions/action-preparation-flag";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "human-approval-queue-only", "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const AUTHORITY = Object.freeze({ canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });
const REF = /^selection_[a-f0-9]{64}$/;
const KEY = /^[a-z][a-z0-9_.:-]{0,127}$/;

type Database = Pick<typeof schema, never>;
type SelectionReader = Readonly<{ select: Function }>;
type Command = Readonly<{ selectionRef: string; idempotencyKey: string; proposedAt: string; expiresAt: string }>;
function response(code: string, message: string, status: number) { return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS }); }
function requestShape(request: Request, method: "GET" | "POST", intent: string) {
  const url = new URL(request.url); const origin = request.headers.get("origin");
  let sameOrigin = method === "GET"; try { if (origin) sameOrigin = new URL(origin).origin === url.origin; } catch { sameOrigin = false; }
  if (request.method !== method || url.search || !request.headers.get("cookie") || request.headers.has("authorization")
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref") || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("x-reklamzeka-intent") !== intent || method === "POST" && (!sameOrigin || request.headers.get("content-type")?.toLowerCase() !== "application/json")) throw new Error("invalid_input");
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw new Error("invalid_input"); }
async function command(request: Request): Promise<Command> {
  const raw = await request.text(); if (Buffer.byteLength(raw) > 2_000) throw new Error("invalid_input");
  const value = JSON.parse(raw) as unknown; exact(value, ["command"]); exact(value.command, ["selectionRef", "idempotencyKey", "proposedAt", "expiresAt"]);
  const parsed = value.command as Command;
  if (!REF.test(parsed.selectionRef) || !KEY.test(parsed.idempotencyKey) || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(parsed.proposedAt)
    || new Date(parsed.proposedAt).toISOString() !== parsed.proposedAt || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(parsed.expiresAt)
    || new Date(parsed.expiresAt).toISOString() !== parsed.expiresAt || parsed.expiresAt <= parsed.proposedAt) throw new Error("invalid_input");
  return parsed;
}

/** Public refs are evidence hashes, never the selection's internal UUID. */
export function selectionRef(evidenceHash: string) { return `selection_${evidenceHash}`; }
export function createSliceRuleBudgetActionUnitHttpHandlers(input: Readonly<{
  database: SelectionReader & ConstructorParameters<typeof DrizzleSliceRuleBudgetActionUnitMaterializer>[0]
    & ConstructorParameters<typeof DrizzleSliceRuleDecisionTraceReadRepository>[0];
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal>;
}>) {
  const selectionRows = async (workspaceId: string) => input.database.select({ id: schema.sliceRuleScenarioAllocationSelections.id,
    selectionEvidenceHash: schema.sliceRuleScenarioAllocationSelections.selectionEvidenceHash, selectedAt: schema.sliceRuleScenarioAllocationSelections.selectedAt })
    .from(schema.sliceRuleScenarioAllocationSelections).where(eq(schema.sliceRuleScenarioAllocationSelections.workspaceId, workspaceId)).limit(101);
  return Object.freeze({
    GET: async (request: Request) => { try { requestShape(request, "GET", "slice-rule-budget-action-unit-read"); const principal = await input.resolvePrincipal(request); const [rows, trace] = await Promise.all([
      selectionRows(principal.workspaceId), new DrizzleSliceRuleDecisionTraceReadRepository(input.database).list(principal.workspaceId),
    ]);
      return NextResponse.json({ contractVersion: "slice-rule-budget-action-unit-http/1.0.0", selections: rows.map((row) => ({ selectionRef: selectionRef(row.selectionEvidenceHash), selectedAt: row.selectedAt.toISOString() })), decisionTrace: { contractVersion: SLICE_RULE_DECISION_TRACE_VERSION, items: trace }, actionPreparation: publicActionPreparationFlag(), authority: AUTHORITY }, { headers: HEADERS });
    } catch { return response("unavailable", "Seçilmiş bütçe senaryoları güvenli biçimde okunamadı.", 503); } },
    POST: async (request: Request) => { try { requestShape(request, "POST", "slice-rule-budget-action-unit-materialize"); const [parsed, principal] = await Promise.all([command(request), input.resolvePrincipal(request)]);
      const rows = await input.database.select({ id: schema.sliceRuleScenarioAllocationSelections.id }).from(schema.sliceRuleScenarioAllocationSelections).where(and(eq(schema.sliceRuleScenarioAllocationSelections.workspaceId, principal.workspaceId), eq(schema.sliceRuleScenarioAllocationSelections.selectionEvidenceHash, parsed.selectionRef.slice("selection_".length)))).limit(2);
      if (rows.length !== 1) return response(rows.length ? "selection_ambiguous" : "selection_not_found", "Seçilmiş bütçe senaryosu bulunamadı veya tekil değil.", 404);
      const result = await new DrizzleSliceRuleBudgetActionUnitMaterializer(input.database).materialize({ workspaceId: principal.workspaceId, selectionId: rows[0]!.id, actorId: principal.actor.userId, idempotencyKey: parsed.idempotencyKey, proposedAt: parsed.proposedAt, expiresAt: parsed.expiresAt });
      return NextResponse.json({ contractVersion: "slice-rule-budget-action-unit-http/1.0.0", selectionRef: parsed.selectionRef, queueState: "queued", persistence: result.outcome, authority: AUTHORITY }, { status: result.outcome === "inserted" ? 201 : 200, headers: HEADERS });
    } catch (reason) { if (reason instanceof SliceRuleBudgetActionUnitMaterializerError) return response(reason.code, "Senaryo insan onay kuyruğuna güvenli biçimde gönderilemedi.", reason.code === "role_denied" || reason.code === "membership_required" ? 403 : 409); if (reason instanceof SyntaxError || reason instanceof Error && reason.message === "invalid_input") return response("invalid_input", "İnsan onay kuyruğu isteği geçersiz.", 400); return response("unavailable", "İnsan onay kuyruğu şu anda kullanılamıyor.", 503); }
    },
  });
}
