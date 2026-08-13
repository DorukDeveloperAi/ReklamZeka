import { NextResponse } from "next/server";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  SliceRuleWorkspaceError,
  type CreateSliceRuleWorkspaceDraftInput,
  type SliceRuleWorkspaceService,
} from "@/application/slice-rule-workspace-service";
import {
  SliceRuleWorkspaceRepositoryError,
  projectSliceRuleWorkspaceDraft,
  type DrizzleSliceRuleWorkspaceRepository,
} from "@/connectors/campaigns/slice-rule-workspace-drizzle-repository";
import type { SliceRule } from "@/domain/campaigns/slice-operating-rule";
import { can, type WorkspaceRole } from "@/security/authorization";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "slice-rule-recommendation-only",
  "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Write": "disabled",
});
const CLOSED_AUTHORITY = Object.freeze({
  canPublish: false as const,
  canApprove: false as const,
  canExecute: false as const,
  canWriteMeta: false as const,
  canEnableAutomation: false as const,
});
const ALLOWED_SCOPE_KEYS = ["market", "serviceRef", "campaignFamilyRef", "countryOrRegion", "audienceStrategy", "platform"] as const;

type ActorContext = Readonly<{ principal: TrustedDecisionRoomPrincipal; role: WorkspaceRole }>;
type SaveCommand = Readonly<{
  operation: "save_draft";
  seriesRef: string;
  revision: number;
  previousDraftHash: "GENESIS" | string;
  idempotencyKey: string;
  scope: CreateSliceRuleWorkspaceDraftInput["scope"];
  rule: SliceRule;
  priority: number;
  verification: CreateSliceRuleWorkspaceDraftInput["verification"];
}>;

function authority(role: WorkspaceRole) {
  return Object.freeze({ canRead: true as const, canSaveDraft: can(role, "budget:draft"), ...CLOSED_AUTHORITY });
}

function responseError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: CLOSED_AUTHORITY }, { status, headers: HEADERS });
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new SliceRuleWorkspaceError("invalid_input");
  }
}

function requestShape(request: Request, method: "GET" | "POST", intent: string): void {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  let sameOrigin = method === "GET";
  if (origin && method === "POST") {
    try { sameOrigin = new URL(origin).origin === url.origin; } catch { sameOrigin = false; }
  }
  if (request.method !== method || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
    || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("x-reklamzeka-intent") !== intent
    || method === "POST" && (!sameOrigin || request.headers.get("content-type")?.toLowerCase() !== "application/json")) {
    throw new SliceRuleWorkspaceError("invalid_input");
  }
}

async function command(request: Request): Promise<SaveCommand> {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 24_000) throw new SliceRuleWorkspaceError("invalid_input");
  const value = JSON.parse(raw) as unknown;
  exact(value, ["command"]);
  const candidate = value.command;
  exact(candidate, ["operation", "seriesRef", "revision", "previousDraftHash", "idempotencyKey", "scope", "rule", "priority", "verification"]);
  if (candidate.operation !== "save_draft") throw new SliceRuleWorkspaceError("invalid_input");
  const candidateScope = candidate.scope;
  exact(candidateScope, ALLOWED_SCOPE_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(candidateScope, key)));
  for (const mandatory of ["market", "serviceRef", "campaignFamilyRef"]) {
    if (!Object.prototype.hasOwnProperty.call(candidateScope, mandatory)) throw new SliceRuleWorkspaceError("invalid_scope");
  }
  return candidate as unknown as SaveCommand;
}

function failure(reason: unknown) {
  if (reason instanceof SliceRuleWorkspaceRepositoryError) {
    if (["membership_required", "role_denied", "workspace_scope_mismatch"].includes(reason.code)) {
      return responseError("forbidden", "Bu çalışma alanında taslak kaydetme yetkiniz yok.", 403);
    }
    if (["revision_conflict", "idempotency_conflict"].includes(reason.code)) {
      return responseError("conflict", "Taslak serisi siz çalışırken değişti; listeyi yenileyin.", 409);
    }
    return responseError(reason.code === "invalid_input" ? "invalid_input" : "unavailable",
      reason.code === "invalid_input" ? "Slice Rule Workspace isteği geçersiz." : "Taslak kayıt defteri güvenli biçimde okunamadı.",
      reason.code === "invalid_input" ? 400 : 503);
  }
  if (reason instanceof SliceRuleWorkspaceError || reason instanceof SyntaxError) {
    return responseError("invalid_input", "Slice Rule Workspace isteği geçersiz.", 400);
  }
  return responseError("unavailable", "Slice Rule Workspace şu anda kullanılamıyor.", 503);
}

export function sliceRuleWorkspaceNotConfiguredResponse() {
  return responseError("source_not_configured", "Slice Rule Workspace yerel veri kaynağına henüz bağlanmadı.", 503);
}

export function sliceRuleWorkspaceSessionRequiredResponse() {
  return responseError("local_session_required", "Slice Rule Workspace için yerel dashboard oturumunu bağlayın.", 401);
}

export function createSliceRuleWorkspaceHttpHandlers(input: Readonly<{
  repository: Pick<DrizzleSliceRuleWorkspaceRepository, "listCurrent">;
  service: Pick<SliceRuleWorkspaceService, "saveDraft">;
  resolveActor(request: Request, operation: "read" | "draft"): Promise<ActorContext>;
  now(): string;
}>) {
  return Object.freeze({
    GET: async (request: Request) => {
      try {
        requestShape(request, "GET", "slice-rule-workspace-read");
        const actor = await input.resolveActor(request, "read");
        const items = await input.repository.listCurrent({ workspaceId: actor.principal.workspaceId,
          actorId: actor.principal.actor.userId, limit: 100 });
        return NextResponse.json({ contractVersion: "slice-rule-workspace-http/1.0.0", items,
          authority: authority(actor.role) }, { headers: HEADERS });
      } catch (reason) { return failure(reason); }
    },
    POST: async (request: Request) => {
      try {
        requestShape(request, "POST", "slice-rule-workspace-save");
        const parsed = await command(request);
        const actor = await input.resolveActor(request, "draft");
        if (!can(actor.role, "budget:draft")) {
          return responseError("forbidden", "Viewer rolü Slice Rule taslağı kaydedemez.", 403);
        }
        const result = await input.service.saveDraft(actor.principal.actor.userId, {
          workspaceId: actor.principal.workspaceId,
          seriesRef: parsed.seriesRef,
          revision: parsed.revision,
          previousDraftHash: parsed.previousDraftHash,
          idempotencyKey: parsed.idempotencyKey,
          createdAt: input.now(),
          scope: parsed.scope,
          rule: parsed.rule,
          priority: parsed.priority,
          verification: parsed.verification,
        });
        return NextResponse.json({ contractVersion: "slice-rule-workspace-save/1.0.0",
          item: projectSliceRuleWorkspaceDraft(result.draft), persistence: result.persistence, auditAppended: result.auditAppended,
          authority: authority(actor.role) }, { status: result.persistence === "inserted" ? 201 : 200, headers: HEADERS });
      } catch (reason) { return failure(reason); }
    },
  });
}
