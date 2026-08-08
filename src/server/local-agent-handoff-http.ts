import { NextResponse } from "next/server";
import {
  LocalAgentSessionLifecycleError,
  type LocalAgentHandoffContext,
  type LocalAgentSessionLifecycleService,
} from "@/application/local-agent-session-contract";
import {
  LocalAgentClientError,
  createLocalAgentSessionDescriptor,
  type LocalAgentToolName,
  type LocalAgentTransport,
} from "@/application/local-agent-client";
import type { LocalSessionClaims } from "@/security/local-session-capability";
import { hasTrustedFrameworkForwarding, LocalDecisionRoomBoundaryError } from
  "@/server/local-decision-room-runtime";
import {
  createDashboardLocalAgentSessionDescriptor,
  type LocalAgentSessionIdentityResolver,
} from "@/server/local-agent-session-http";

const MAX_BODY_BYTES = 2_048;
const FORBIDDEN_HEADERS = ["x-workspace-id", "x-workspace-ref", "x-user-id", "x-session-ref"] as const;
const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "local-handoff-coordination",
  "X-ReklamZeka-Action-Authority": "none",
});

type ConsumerInput = Readonly<{
  clientRef: string;
  transport: LocalAgentTransport;
  allowedTools: readonly LocalAgentToolName[];
  handoffRef: string;
}>;

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error("invalid_input");
  }
}

async function json(request: Request, keys: readonly string[]): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.toLowerCase() !== "application/json") throw new Error("invalid_input");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new Error("invalid_input");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new Error("invalid_input");
  const value = JSON.parse(text) as unknown;
  exact(value, keys);
  return value;
}

function boundary(request: Request, origin: string): "cookie" | "bearer" {
  const url = new URL(request.url);
  if (url.search || !hasTrustedFrameworkForwarding(request, origin)
    || FORBIDDEN_HEADERS.some((header) => request.headers.has(header))) throw new Error("invalid_input");
  const cookie = request.headers.has("cookie");
  const bearer = request.headers.has("authorization");
  if (cookie === bearer) throw new Error("invalid_input");
  return cookie ? "cookie" : "bearer";
}

function consumerDescriptor(claims: LocalSessionClaims, value: ConsumerInput) {
  return createLocalAgentSessionDescriptor({
    clientRef: value.clientRef,
    sessionRef: claims.sessionRef,
    transport: value.transport,
    workspaceRef: claims.workspaceRef,
    sessionScopes: claims.scopes,
    allowedTools: value.allowedTools,
  });
}

function failure(reason: unknown) {
  if (reason instanceof SyntaxError || reason instanceof Error && reason.message === "invalid_input"
    || reason instanceof LocalAgentClientError
    || reason instanceof LocalAgentSessionLifecycleError && reason.code === "invalid_input") {
    return NextResponse.json({ error: { code: "invalid_input", message: "Yerel agent handoff isteği geçersiz." } },
      { status: 400, headers: HEADERS });
  }
  if (reason instanceof LocalDecisionRoomBoundaryError) {
    return NextResponse.json({ error: { code: "local_session_rejected", message: "Yerel session kanıtı reddedildi." } },
      { status: 403, headers: HEADERS });
  }
  if (reason instanceof LocalAgentSessionLifecycleError) {
    const status = reason.code === "handoff_missing" || reason.code === "session_missing" ? 404
      : reason.code === "handoff_conflict" || reason.code === "handoff_consumed" || reason.code === "session_conflict" ? 409 : 403;
    return NextResponse.json({ error: { code: "handoff_unavailable", message: "Yerel agent handoff kullanılamıyor." } },
      { status, headers: HEADERS });
  }
  return NextResponse.json({ error: { code: "unavailable", message: "Yerel agent handoff şu anda kullanılamıyor." } },
    { status: 503, headers: HEADERS });
}

export function createLocalAgentHandoffHttpHandlers(input: Readonly<{
  service: Pick<LocalAgentSessionLifecycleService, "createHandoff" | "consumeHandoff">;
  origin: string;
  resolveIdentity: LocalAgentSessionIdentityResolver;
}>) {
  return Object.freeze({
    POST: async (request: Request) => {
      try {
        if (request.method !== "POST" || boundary(request, input.origin) !== "cookie"
          || request.headers.get("origin") !== input.origin
          || request.headers.get("sec-fetch-site") !== "same-origin"
          || request.headers.get("x-reklamzeka-intent") !== "local-agent-handoff-create") {
          throw new Error("invalid_input");
        }
        const body = await json(request, ["targetSessionRef", "context", "ttlSeconds"]);
        exact(body.context, ["intent", "entityRef", "timeframeRef", "contextRef", "contextVersion", "templateRef", "correlationRef"]);
        const identity = await input.resolveIdentity(request, "cookie");
        const result = await input.service.createHandoff({
          claims: identity.claims,
          descriptor: createDashboardLocalAgentSessionDescriptor(identity.claims),
          targetSessionRef: body.targetSessionRef as string,
          context: body.context as unknown as LocalAgentHandoffContext,
          ttlSeconds: body.ttlSeconds as number,
        });
        return NextResponse.json(result, { status: 201, headers: HEADERS });
      } catch (reason) { return failure(reason); }
    },
    PATCH: async (request: Request) => {
      try {
        if (request.method !== "PATCH" || boundary(request, input.origin) !== "bearer"
          || request.headers.get("x-reklamzeka-intent") !== "local-agent-handoff-consume") {
          throw new Error("invalid_input");
        }
        const body = await json(request, ["clientRef", "transport", "allowedTools", "handoffRef"]);
        const identity = await input.resolveIdentity(request, "bearer");
        const value = body as unknown as ConsumerInput;
        const result = await input.service.consumeHandoff({ claims: identity.claims,
          descriptor: consumerDescriptor(identity.claims, value), handoffRef: value.handoffRef });
        return NextResponse.json(result, { headers: HEADERS });
      } catch (reason) { return failure(reason); }
    },
  });
}

export function localAgentHandoffNotConfiguredResponse() {
  return NextResponse.json({ error: { code: "source_not_configured", message: "Yerel agent handoff henüz yapılandırılmadı." } },
    { status: 503, headers: HEADERS });
}
