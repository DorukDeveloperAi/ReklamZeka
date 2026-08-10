import { NextResponse } from "next/server";
import { DecisionRoomDryRunError, type DecisionRoomDryRunService } from "@/application/decision-room-dry-run-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "analysis-dry-run", "X-ReklamZeka-Action-Authority": "none",
});

function failure(error: unknown) {
  const code = error instanceof DecisionRoomDryRunError ? error.code : "unavailable";
  const status = code === "invalid_input" ? 400 : code === "forbidden" ? 403 : 503;
  return NextResponse.json({ error: { code } }, { status, headers: HEADERS });
}

export function decisionRoomDryRunNotConfiguredResponse() {
  return NextResponse.json({ error: { code: "source_not_configured" } }, { status: 503, headers: HEADERS });
}

export function createDecisionRoomDryRunHttpHandler(input: Readonly<{
  service: DecisionRoomDryRunService;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return async function POST(request: Request) {
    try {
      if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
        throw new DecisionRoomDryRunError("invalid_input");
      }
      const length = request.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 2_048)) {
        throw new DecisionRoomDryRunError("invalid_input");
      }
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > 2_048) throw new DecisionRoomDryRunError("invalid_input");
      let body: unknown;
      try { body = JSON.parse(text); } catch { throw new DecisionRoomDryRunError("invalid_input"); }
      if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).length !== 1 || !("request" in body)) throw new DecisionRoomDryRunError("invalid_input");
      const principal = await input.resolvePrincipal(request);
      if (!principal) throw new DecisionRoomDryRunError("forbidden");
      return NextResponse.json(await input.service.execute(principal, (body as { request: never }).request), { headers: HEADERS });
    } catch (error) {
      return failure(error);
    }
  };
}
