import { NextResponse } from "next/server";

import {
  BudgetPoolHierarchyRevisionError,
  BudgetPoolHierarchyService,
  type CreateBudgetPoolHierarchyRevisionInput,
  type BudgetPoolHierarchyRevision,
} from "@/application/budget-pool-hierarchy-service";
import {
  BudgetPoolHierarchyRepositoryError,
  type DrizzleBudgetPoolHierarchyRepository,
} from "@/connectors/budget/budget-pool-hierarchy-drizzle-repository";
import { can, type WorkspaceRole } from "@/security/authorization";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "budget-pool-recommendation-only",
  "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Write": "disabled",
});
const CLOSED = Object.freeze({ recommendationOnly: true as const, canPublish: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const, canEnableAutomation: false as const });
type Actor = Readonly<{ principal: TrustedDecisionRoomPrincipal; role: WorkspaceRole }>;

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: CLOSED }, { status, headers: HEADERS });
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) throw new BudgetPoolHierarchyRevisionError("invalid_input");
}
function shape(request: Request, method: "GET" | "POST", intent: string) {
  const origin = request.headers.get("origin"); const url = new URL(request.url);
  if (request.method !== method || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
    || request.headers.get("sec-fetch-site") !== "same-origin" || request.headers.get("x-reklamzeka-intent") !== intent
    || method === "POST" && (!origin || new URL(origin).origin !== url.origin || request.headers.get("content-type")?.toLowerCase() !== "application/json")) {
    throw new BudgetPoolHierarchyRevisionError("invalid_input");
  }
}
async function command(request: Request): Promise<Omit<CreateBudgetPoolHierarchyRevisionInput, "workspaceId">> {
  const raw = await request.text(); if (Buffer.byteLength(raw) > 64_000) throw new BudgetPoolHierarchyRevisionError("invalid_input");
  const value = JSON.parse(raw) as unknown; exact(value, ["command"]); exact(value.command, ["revision", "previousHierarchyHash", "idempotencyKey", "nodes"]);
  return value.command as unknown as Omit<CreateBudgetPoolHierarchyRevisionInput, "workspaceId">;
}
function publicRevision(value: BudgetPoolHierarchyRevision | null) {
  if (!value) return null;
  return Object.freeze({ revision: value.revision, hierarchyHash: value.hierarchy.hierarchyHash, nodes: value.hierarchy.nodes,
    authority: value.hierarchy.authority });
}
function failure(reason: unknown) {
  if (reason instanceof BudgetPoolHierarchyRepositoryError) {
    if (["membership_required", "role_denied", "workspace_scope_mismatch"].includes(reason.code)) return error("forbidden", "Bu bütçe havuzu çalışma alanına erişim yetkiniz yok.", 403);
    if (["revision_conflict", "idempotency_conflict"].includes(reason.code)) return error("conflict", "Bütçe havuzu siz çalışırken değişti; güncel revizyonu alın.", 409);
  }
  if (reason instanceof BudgetPoolHierarchyRevisionError || reason instanceof SyntaxError) return error("invalid_input", "Bütçe havuzu isteği geçersiz.", 400);
  return error("unavailable", "Bütçe havuzu kayıt defteri şu anda kullanılamıyor.", 503);
}
export function budgetPoolHierarchyNotConfiguredResponse() { return error("source_not_configured", "Bütçe havuzu çalışma alanı yerel kaynağa bağlı değil.", 503); }
export function budgetPoolHierarchySessionRequiredResponse() { return error("local_session_required", "Bütçe havuzu için yerel dashboard oturumunu bağlayın.", 401); }

export function createBudgetPoolHierarchyHttpHandlers(input: Readonly<{
  repository: Pick<DrizzleBudgetPoolHierarchyRepository, "loadCurrent">;
  service: Pick<BudgetPoolHierarchyService, "save">;
  resolveActor(request: Request, operation: "read" | "draft"): Promise<Actor>;
}>) {
  return Object.freeze({
    GET: async (request: Request) => {
      try { shape(request, "GET", "budget-pool-hierarchy-read"); const actor = await input.resolveActor(request, "read");
        return NextResponse.json({ contractVersion: "budget-pool-hierarchy-http/1.0.0", item: publicRevision(await input.repository.loadCurrent({ workspaceId: actor.principal.workspaceId, actorId: actor.principal.actor.userId })),
          authority: { canRead: true, canSaveDraft: can(actor.role, "budget:draft"), ...CLOSED } }, { headers: HEADERS });
      } catch (reason) { return failure(reason); }
    },
    POST: async (request: Request) => {
      try { shape(request, "POST", "budget-pool-hierarchy-save"); const actor = await input.resolveActor(request, "draft");
        if (!can(actor.role, "budget:draft")) return error("forbidden", "Viewer rolü bütçe havuzu taslağı kaydedemez.", 403);
        const result = await input.service.save(actor.principal.actor.userId, { ...(await command(request)), workspaceId: actor.principal.workspaceId });
        return NextResponse.json({ contractVersion: "budget-pool-hierarchy-save/1.0.0", item: publicRevision(result.revision), persistence: result.persistence, auditAppended: result.auditAppended,
          authority: { canRead: true, canSaveDraft: true, ...CLOSED } }, { status: result.persistence === "inserted" ? 201 : 200, headers: HEADERS });
      } catch (reason) { return failure(reason); }
    },
  });
}
