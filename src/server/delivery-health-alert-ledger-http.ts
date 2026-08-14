import { NextResponse } from "next/server";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  DeliveryHealthAlertLedgerService,
  projectDeliveryHealthAlert,
} from "@/application/delivery-health-alert-ledger-service";
import { DeliveryHealthAlertLedgerRepositoryError } from
  "@/connectors/meta/delivery-health-alert-ledger-drizzle-repository";
import {
  DELIVERY_HEALTH_CHECKLIST_ITEMS,
  type DeliveryHealthAlertCommand,
} from "@/domain/meta/delivery-health-alert-ledger";
import type { WorkspaceRole } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff", "X-ReklamZeka-Access-Mode": "delivery-alert-human-workflow-only",
  "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const AUTHORITY = Object.freeze({ canRead: true as const, canManageWorkflow: true as const,
  canApprove: false as const, canExecute: false as const, canWriteMeta: false as const,
  canEnableAutomation: false as const });
type ActorContext = Readonly<{ principal: TrustedDecisionRoomPrincipal; role: WorkspaceRole }>;

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: { ...AUTHORITY, canManageWorkflow: false } },
    { status, headers: HEADERS });
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error("invalid_input");
  }
}
function requestShape(request: Request, method: "GET" | "POST") {
  const url = new URL(request.url);
  const intent = method === "GET" ? "delivery-health-alert-read" : "delivery-health-alert-transition";
  const origin = request.headers.get("origin");
  if (request.method !== method || url.search || !request.headers.get("cookie")
    || request.headers.has("authorization") || request.headers.has("x-workspace-id")
    || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("x-reklamzeka-intent") !== intent
    || (method === "POST" && (request.headers.get("content-type")?.toLowerCase() !== "application/json"
      || !origin || new URL(origin).origin !== url.origin))) throw new Error("invalid_input");
}
async function parseCommand(request: Request): Promise<Readonly<{ alertRef: string; expectedRecordHash: string;
  command: DeliveryHealthAlertCommand }>> {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 4_000) throw new Error("invalid_input");
  const body = JSON.parse(raw) as unknown;
  exact(body, ["alertRef", "expectedRecordHash", "command"]);
  if (!body.command || typeof body.command !== "object" || Array.isArray(body.command)) throw new Error("invalid_input");
  const command = body.command as Record<string, unknown>;
  if (command.kind === "assign") exact(command, ["kind", "assignedActorRef"]);
  else if (command.kind === "set_checklist_item") {
    exact(command, ["kind", "item", "completed"]);
    if (!DELIVERY_HEALTH_CHECKLIST_ITEMS.includes(command.item as never) || typeof command.completed !== "boolean") {
      throw new Error("invalid_input");
    }
  } else if (["start_investigation", "resolve", "reopen"].includes(String(command.kind))) exact(command, ["kind"]);
  else throw new Error("invalid_input");
  return { alertRef: body.alertRef as string, expectedRecordHash: body.expectedRecordHash as string,
    command: command as unknown as DeliveryHealthAlertCommand };
}
function failure(reason: unknown) {
  if (reason instanceof DeliveryHealthAlertLedgerRepositoryError) {
    if (["membership_required", "role_denied", "workspace_unavailable"].includes(reason.code)) {
      return error("forbidden", "Bu alarm iş akışı için çalışma alanı yetkiniz yok.", 403);
    }
    if (reason.code === "not_found") return error("not_found", "Alarm bulunamadı.", 404);
    if (reason.code === "conflict") return error("conflict", "Alarm siz çalışırken değişti; listeyi yenileyin.", 409);
    return error(reason.code === "invalid_input" ? "invalid_input" : "unavailable",
      reason.code === "invalid_input" ? "Alarm iş akışı isteği geçersiz." : "Alarm kayıt defteri güvenle okunamadı.",
      reason.code === "invalid_input" ? 400 : 503);
  }
  return error(reason instanceof SyntaxError || reason instanceof Error && reason.message === "invalid_input"
    ? "invalid_input" : "unavailable", "Alarm iş akışı isteği tamamlanamadı.",
  reason instanceof SyntaxError || reason instanceof Error && reason.message === "invalid_input" ? 400 : 503);
}

export function deliveryHealthAlertNotConfiguredResponse() {
  return error("source_not_configured", "Delivery alarm kayıt defteri yerel veri kaynağına bağlanmadı.", 503);
}
export function deliveryHealthAlertSessionRequiredResponse() {
  return error("local_session_required", "Delivery alarm kayıt defteri için yerel dashboard oturumunu bağlayın.", 401);
}

export function createDeliveryHealthAlertLedgerHttpHandlers(input: Readonly<{
  service: Pick<DeliveryHealthAlertLedgerService, "listCurrent" | "transition">;
  resolveActor(request: Request, operation: "read" | "workflow"): Promise<ActorContext>;
}>) {
  return Object.freeze({
    GET: async (request: Request) => {
      try {
        requestShape(request, "GET");
        const actor = await input.resolveActor(request, "read");
        const items = await input.service.listCurrent({ workspaceId: actor.principal.workspaceId,
          actorId: actor.principal.actor.userId, limit: 100 });
        return NextResponse.json({ contractVersion: "delivery-health-alert-http/1.0.0", items,
          authority: { ...AUTHORITY, canManageWorkflow: actor.role !== "viewer" } }, { headers: HEADERS });
      } catch (reason) { return failure(reason); }
    },
    POST: async (request: Request) => {
      try {
        requestShape(request, "POST");
        const parsed = await parseCommand(request);
        const actor = await input.resolveActor(request, "workflow");
        if (actor.role === "viewer") return error("forbidden", "Viewer alarm iş akışını değiştiremez.", 403);
        const record = await input.service.transition({ workspaceId: actor.principal.workspaceId,
          actorId: actor.principal.actor.userId, actorRef: actor.principal.readerRef, role: actor.role,
          alertRef: parsed.alertRef, expectedRecordHash: parsed.expectedRecordHash, command: parsed.command });
        return NextResponse.json({ contractVersion: "delivery-health-alert-transition/1.0.0",
          item: projectDeliveryHealthAlert(record), authority: AUTHORITY }, { headers: HEADERS });
      } catch (reason) { return failure(reason); }
    },
  });
}
