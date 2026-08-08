import { NextResponse } from "next/server";
import {
  LocalAgentSessionLifecycleError,
  type LocalAgentSessionLifecycleService,
} from "@/application/local-agent-session-contract";
import {
  LocalAgentClientError,
  createLocalAgentSessionDescriptor,
  type LocalAgentSessionDescriptor,
  type LocalAgentToolName,
  type LocalAgentTransport,
} from "@/application/local-agent-client";
import type { LocalSessionClaims } from "@/security/local-session-capability";
import { hasTrustedFrameworkForwarding, LocalDecisionRoomBoundaryError } from
  "@/server/local-decision-room-runtime";

const MAX_BODY_BYTES = 2_048;
const FORBIDDEN_HEADERS = ["x-workspace-id", "x-workspace-ref", "x-user-id", "x-session-ref"] as const;
const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "local-session-coordination",
  "X-ReklamZeka-Action-Authority": "none",
});

export type LocalAgentSessionIdentity = Readonly<{ claims: LocalSessionClaims }>;
export type LocalAgentSessionIdentityResolver = (
  request: Request,
  credential: "cookie" | "bearer",
) => Promise<LocalAgentSessionIdentity>;

type DescriptorInput = Readonly<{
  clientRef: string;
  transport: LocalAgentTransport;
  allowedTools: readonly LocalAgentToolName[];
}>;

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error("invalid_input");
  }
}

function boundary(request: Request, origin: string): void {
  const url = new URL(request.url);
  if (url.search || !hasTrustedFrameworkForwarding(request, origin)
    || FORBIDDEN_HEADERS.some((header) => request.headers.has(header))) throw new Error("invalid_input");
}

function credential(request: Request): "cookie" | "bearer" {
  const cookie = request.headers.has("cookie");
  const bearer = request.headers.has("authorization");
  if (cookie === bearer) throw new Error("invalid_input");
  return cookie ? "cookie" : "bearer";
}

function requireCookieMutation(request: Request, origin: string): void {
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") !== "same-origin") {
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

function descriptor(claims: LocalSessionClaims, value: DescriptorInput): LocalAgentSessionDescriptor {
  return createLocalAgentSessionDescriptor({
    clientRef: value.clientRef,
    sessionRef: claims.sessionRef,
    transport: value.transport,
    workspaceRef: claims.workspaceRef,
    sessionScopes: claims.scopes,
    allowedTools: value.allowedTools,
  });
}

export function createDashboardLocalAgentSessionDescriptor(claims: LocalSessionClaims): LocalAgentSessionDescriptor {
  return createLocalAgentSessionDescriptor({
    clientRef: "client_dashboard",
    sessionRef: claims.sessionRef,
    transport: "loopback_http",
    workspaceRef: claims.workspaceRef,
    sessionScopes: claims.scopes,
    allowedTools: ["decision_room_list"],
  });
}

function responseError(reason: unknown) {
  if (reason instanceof SyntaxError || reason instanceof Error && reason.message === "invalid_input"
    || reason instanceof LocalAgentClientError
    || reason instanceof LocalAgentSessionLifecycleError && reason.code === "invalid_input") {
    return NextResponse.json({ error: { code: "invalid_input", message: "Yerel agent oturumu isteği geçersiz." } },
      { status: 400, headers: HEADERS });
  }
  if (reason instanceof LocalDecisionRoomBoundaryError) {
    return NextResponse.json({ error: { code: "local_session_rejected", message: "Yerel session kanıtı reddedildi." } },
      { status: 403, headers: HEADERS });
  }
  if (reason instanceof LocalAgentSessionLifecycleError) {
    const conflict = ["session_conflict", "clock_regression"].includes(reason.code);
    const missing = reason.code === "session_missing";
    return NextResponse.json({ error: { code: conflict ? "session_conflict" : missing ? "session_missing" : "session_expired",
      message: "Yerel agent oturumu kullanılamıyor." } }, { status: conflict ? 409 : missing ? 404 : 403, headers: HEADERS });
  }
  return NextResponse.json({ error: { code: "unavailable", message: "Yerel agent oturumları şu anda kullanılamıyor." } },
    { status: 503, headers: HEADERS });
}

/** HTTP boundary shared by the Next route and direct tests; it never accepts authority or tenant identity. */
export function createLocalAgentSessionHttpHandlers(input: Readonly<{
  service: Pick<LocalAgentSessionLifecycleService, "register" | "heartbeat" | "listActiveSessions">;
  origin: string;
  resolveIdentity: LocalAgentSessionIdentityResolver;
}>) {
  return Object.freeze({
    GET: async (request: Request) => {
      try {
        boundary(request, input.origin);
        if (request.method !== "GET" || credential(request) !== "cookie"
          || request.headers.get("sec-fetch-site") !== "same-origin"
          || request.headers.get("x-reklamzeka-intent") !== "local-agent-sessions-read"
          || request.body !== null) throw new Error("invalid_input");
        const identity = await input.resolveIdentity(request, "cookie");
        const result = await input.service.listActiveSessions({ claims: identity.claims,
          descriptor: createDashboardLocalAgentSessionDescriptor(identity.claims) });
        return NextResponse.json(result, { headers: HEADERS });
      } catch (reason) { return responseError(reason); }
    },
    POST: async (request: Request) => {
      try {
        boundary(request, input.origin);
        if (request.method !== "POST") throw new Error("invalid_input");
        const mode = credential(request);
        const intent = request.headers.get("x-reklamzeka-intent");
        if (mode === "cookie") {
          if (intent !== "local-agent-session-create") throw new Error("invalid_input");
          requireCookieMutation(request, input.origin);
          await json(request, []);
          const identity = await input.resolveIdentity(request, "cookie");
          const dashboard = createDashboardLocalAgentSessionDescriptor(identity.claims);
          try {
            const current = await input.service.heartbeat({ claims: identity.claims, descriptor: dashboard });
            return NextResponse.json(current, { headers: HEADERS });
          } catch (reason) {
            if (!(reason instanceof LocalAgentSessionLifecycleError) || reason.code !== "session_missing") throw reason;
          }
          try {
            const created = await input.service.register({ claims: identity.claims, descriptor: dashboard });
            return NextResponse.json(created, { status: 201, headers: HEADERS });
          } catch (reason) {
            if (!(reason instanceof LocalAgentSessionLifecycleError) || reason.code !== "session_conflict") throw reason;
            const current = await input.service.heartbeat({ claims: identity.claims, descriptor: dashboard });
            return NextResponse.json(current, { headers: HEADERS });
          }
        }
        if (intent !== "local-agent-session-register") throw new Error("invalid_input");
        const body = await json(request, ["clientRef", "transport", "allowedTools"]);
        const identity = await input.resolveIdentity(request, "bearer");
        const result = await input.service.register({ claims: identity.claims,
          descriptor: descriptor(identity.claims, body as unknown as DescriptorInput) });
        return NextResponse.json(result, { status: 201, headers: HEADERS });
      } catch (reason) { return responseError(reason); }
    },
    PATCH: async (request: Request) => {
      try {
        boundary(request, input.origin);
        if (request.method !== "PATCH" || credential(request) !== "bearer"
          || request.headers.get("x-reklamzeka-intent") !== "local-agent-session-heartbeat") {
          throw new Error("invalid_input");
        }
        const body = await json(request, ["clientRef", "transport", "allowedTools"]);
        const identity = await input.resolveIdentity(request, "bearer");
        const result = await input.service.heartbeat({ claims: identity.claims,
          descriptor: descriptor(identity.claims, body as unknown as DescriptorInput) });
        return NextResponse.json(result, { headers: HEADERS });
      } catch (reason) { return responseError(reason); }
    },
  });
}

export function localAgentSessionNotConfiguredResponse() {
  return NextResponse.json({ error: { code: "source_not_configured", message: "Yerel agent oturumları henüz yapılandırılmadı." } },
    { status: 503, headers: HEADERS });
}
