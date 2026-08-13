import { NextResponse } from "next/server";
import {
  OrchestratorConversationError,
  type OrchestratorConversationService,
} from "@/application/orchestrator-conversation";
import { LocalDecisionRoomBoundaryError,
  type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";

const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } as const;

function errorResponse(reason: unknown) {
  if (reason instanceof LocalDecisionRoomBoundaryError) {
    return NextResponse.json({ error: { code: "local_session_required",
      message: "Kalıcı Orchestrator sohbeti için güvenli yerel dashboard oturumunu bağlayın." } },
    { status: 401, headers: HEADERS });
  }
  const code = reason instanceof OrchestratorConversationError ? reason.code : "invalid_input";
  const status = code === "conversation_unavailable" ? 404
    : code === "adapter_unavailable" ? 503
      : code === "adapter_timeout" ? 504
        : code === "adapter_failed" || code === "invalid_provider_output" ? 502 : 400;
  const messages: Record<string, string> = {
    invalid_input: "Sohbet isteği geçersiz veya hassas kimlik bilgisi içeriyor.",
    conversation_unavailable: "Bu operatöre ait aktif konuşma bulunamadı.",
    adapter_unavailable: "Yerel Codex CLI kullanılamıyor; manuel Codex aktarımı kullanılabilir.",
    adapter_timeout: "Codex yanıtı zaman aşımına uğradı; mesaj ledger'a başarısız turn olarak kaydedildi.",
    adapter_failed: "Codex çalışması güvenli biçimde tamamlanamadı.",
    invalid_provider_output: "Codex çıktısı güvenli nihai yanıt sözleşmesine uymadı.",
  };
  return NextResponse.json({ error: { code, message: messages[code] } }, { status, headers: HEADERS });
}

function boundary(request: Request, config: LocalDecisionRoomConfig, method: "GET" | "POST", intent: string) {
  const url = new URL(request.url);
  const configured = new URL(config.origin);
  if (request.method !== method || url.origin !== config.origin || request.headers.get("host") !== configured.host
    || request.headers.get("x-reklamzeka-intent") !== intent
    || (method === "POST" && (request.headers.get("origin") !== config.origin
      || request.headers.get("sec-fetch-site") !== "same-origin"))) {
    throw new OrchestratorConversationError("invalid_input");
  }
}

async function body(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new OrchestratorConversationError("invalid_input");
  }
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length < 2 || length > 13_500) {
    throw new OrchestratorConversationError("invalid_input");
  }
  const value = await request.json() as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OrchestratorConversationError("invalid_input");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !(record.conversationRef === null || typeof record.conversationRef === "string")
    || typeof record.pageId !== "string" || typeof record.message !== "string") {
    throw new OrchestratorConversationError("invalid_input");
  }
  return record as { conversationRef: string | null; pageId: string; message: string };
}

export function createOrchestratorConversationHttpHandlers(input: Readonly<{
  service: OrchestratorConversationService;
  config: LocalDecisionRoomConfig;
  resolveIdentity: (request: Request) => Promise<Readonly<{ claims: Readonly<{ workspaceId: string; userId: string }> }>>;
}>) {
  return Object.freeze({
    GET: async (request: Request) => {
      try {
        boundary(request, input.config, "GET", "orchestrator-conversation-read");
        const identity = await input.resolveIdentity(request);
        return NextResponse.json(await input.service.current({ workspaceId: identity.claims.workspaceId,
          userId: identity.claims.userId }), { headers: HEADERS });
      } catch (reason) { return errorResponse(reason); }
    },
    POST: async (request: Request) => {
      try {
        boundary(request, input.config, "POST", "orchestrator-conversation-send");
        const payload = await body(request);
        const identity = await input.resolveIdentity(request);
        return NextResponse.json(await input.service.send({ workspaceId: identity.claims.workspaceId,
          userId: identity.claims.userId, ...payload }), { status: 201, headers: HEADERS });
      } catch (reason) { return errorResponse(reason); }
    },
  });
}

export function orchestratorConversationNotConfiguredResponse() {
  return NextResponse.json({ error: { code: "source_not_configured",
    message: "Kalıcı Orchestrator sohbeti yapılandırılmadı; manuel Codex aktarımı kullanılabilir." } },
  { status: 503, headers: HEADERS });
}
