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
      // Exact empty body. Next's Route Handler adapter can expose a readable
      // stream even when a browser sends POST with Content-Length: 0, so a
      // non-null stream alone is not evidence of a payload. We still reject
      // unknown-length/chunked streams before reading them, and consume only
      // an explicitly zero-length stream to prove it is empty.
      if (request.body !== null) {
        if (contentLength !== "0" || (await request.text()).length !== 0) {
          throw new LocalDecisionRoomBoundaryError("untrusted_request");
        }
      }
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
