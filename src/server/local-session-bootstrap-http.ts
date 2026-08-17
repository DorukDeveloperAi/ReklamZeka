import { NextResponse } from "next/server";
import {
  LOCAL_SESSION_COOKIE,
  bearerToken,
  mintLocalSessionCapability,
  verifyLocalSessionCapability,
  type LocalSessionClaims,
} from "@/security/local-session-capability";
import {
  LocalSessionBootstrapStoreError,
  consumeLocalSessionBootstrap,
} from "@/security/local-session-bootstrap-store";
import {
  LocalDecisionRoomBoundaryError,
  assertTrustedLocalDecisionRoomRequest,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});
const EMPTY_BODY_CHUNK_LIMIT = 8;
const EMPTY_BODY_DEADLINE_MS = 250;

async function assertExactEmptyBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (body === null) return;
  const reader = body.getReader();
  const deadline = Date.now() + EMPTY_BODY_DEADLINE_MS;
  try {
    for (let chunks = 0; chunks < EMPTY_BODY_CHUNK_LIMIT; chunks += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new LocalDecisionRoomBoundaryError("untrusted_request");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const next = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
          timeout = setTimeout(() => reject(new LocalDecisionRoomBoundaryError("untrusted_request")), remaining);
          void reader.read().then(resolve, reject);
        });
        if (next.done) return;
        if (next.value.byteLength !== 0) throw new LocalDecisionRoomBoundaryError("untrusted_request");
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    }
    throw new LocalDecisionRoomBoundaryError("untrusted_request");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function rejected() {
  return NextResponse.json({ error: { code: "local_session_rejected", message: "Yerel oturum kanıtı reddedildi." } }, {
    status: 403, headers: HEADERS,
  });
}

function proofNotRegistered() {
  return NextResponse.json({ error: {
    code: "local_session_proof_not_registered",
    message: "Proof bu yerel serverda bulunamadı. Kullanılmış olabilir veya dashboard ile proof farklı proje köklerinde çalışıyor. Dashboard’u yapılandırmanın uygulandığı proje kökünden yeniden başlatın; ardından yeni bir proof üretin.",
  } }, { status: 409, headers: HEADERS });
}

export function createLocalSessionBootstrapHandler(input: Readonly<{
  config: LocalDecisionRoomConfig;
  clock?: () => number;
  consume?: (claims: LocalSessionClaims, token: string, now: number) => Promise<void>;
}>) {
  return async function POST(request: Request) {
    try {
      assertTrustedLocalDecisionRoomRequest(request, input.config, "read", "bearer");
      const contentLength = request.headers.get("content-length");
      if (request.method !== "POST" || request.headers.get("origin") !== input.config.origin
        || request.headers.get("sec-fetch-site") !== "same-origin"
        || request.headers.get("x-reklamzeka-intent") !== "bootstrap-local-session"
        || (contentLength !== null && contentLength !== "0")) {
        throw new LocalDecisionRoomBoundaryError("untrusted_request");
      }
      // A Next route can expose an empty fetch POST as a readable stream with
      // no Content-Length. It is accepted only after a bounded, zero-byte-only
      // read; payloads are neither accumulated nor parsed.
      await assertExactEmptyBody(request.body);
      const token = bearerToken(request);
      if (!token) throw new LocalDecisionRoomBoundaryError("untrusted_request");
      const osUid = typeof process.getuid === "function" ? process.getuid() : -1;
      if (osUid < 0) throw new LocalDecisionRoomBoundaryError("untrusted_request");
      const now = input.clock?.() ?? Math.floor(Date.now() / 1000);
      const bootstrap = verifyLocalSessionCapability({
        token, key: input.config.signingKey, now, osUid,
        requiredScope: "local_session:bootstrap", expected: input.config,
      });
      await (input.consume ?? consumeLocalSessionBootstrap)(bootstrap, token, now);
      const session = mintLocalSessionCapability({
        kind: "session",
        workspaceId: input.config.workspaceId,
        workspaceRef: input.config.workspaceRef,
        userId: input.config.userId,
        readerRef: input.config.readerRef,
        osUid,
        issuedAt: now,
        expiresAt: now + 28_800,
      }, input.config.signingKey);
      const response = new NextResponse(null, { status: 204, headers: HEADERS });
      response.headers.set("X-ReklamZeka-Session-Bootstrapped", "cookie");
      response.cookies.set({
        name: LOCAL_SESSION_COOKIE,
        value: session.token,
        httpOnly: true,
        sameSite: "strict",
        secure: true,
        path: "/",
        maxAge: 28_800,
      });
      return response;
    } catch (error) {
      if (error instanceof LocalSessionBootstrapStoreError && error.code === "proof_not_registered") {
        return proofNotRegistered();
      }
      return rejected();
    }
  };
}

export function localSessionBootstrapNotConfiguredResponse() {
  return NextResponse.json({ error: { code: "local_session_not_configured", message: "Yerel oturum henüz etkin değil." } }, {
    status: 503, headers: HEADERS,
  });
}
