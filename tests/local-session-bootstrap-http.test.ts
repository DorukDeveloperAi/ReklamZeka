import { describe, expect, it, vi } from "vitest";
import { mintLocalSessionCapability } from "@/security/local-session-capability";
import { createLocalSessionBootstrapHandler } from "@/server/local-session-bootstrap-http";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const key = Buffer.alloc(32, 9);
const now = 1_786_100_000;
const config = localDecisionRoomConfig({
  DATABASE_URL: "postgresql://server-only.invalid/database",
  REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
  REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
  REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId,
  REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
  REKLAMZEKA_LOCAL_USER_ID: userId,
  REKLAMZEKA_LOCAL_READER_REF: "reader_local_owner",
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: key.toString("base64"),
})!;

function bootstrapToken() {
  return mintLocalSessionCapability({
    kind: "bootstrap", workspaceId, workspaceRef: "workspace_local", userId,
    readerRef: "reader_local_owner", osUid: process.getuid!(), issuedAt: now, expiresAt: now + 90,
  }, key).token;
}

function request(token: string, overrides: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/local-session", {
    method: "POST",
    headers: {
      Host: "localhost:3000",
      Origin: "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin",
      "X-ReklamZeka-Intent": "bootstrap-local-session",
      Authorization: `Bearer ${token}`,
      ...overrides,
    },
  });
}

function zeroLengthStreamRequest(token: string, contentLength: string | null = "0") {
  return new Request("http://localhost:3000/api/local-session", {
    method: "POST",
    headers: {
      Host: "localhost:3000",
      Origin: "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin",
      "X-ReklamZeka-Intent": "bootstrap-local-session",
      Authorization: `Bearer ${token}`,
      ...(contentLength === null ? {} : { "Content-Length": contentLength }),
    },
    body: "",
  });
}

describe("local session bootstrap HTTP boundary", () => {
  it("consumes a short-lived proof and mints a hardened, scoped HttpOnly cookie", async () => {
    const consume = vi.fn(async () => undefined);
    const token = bootstrapToken();
    const response = await createLocalSessionBootstrapHandler({ config, clock: () => now + 1, consume })(request(token));
    expect(response.status).toBe(204);
    expect(consume).toHaveBeenCalledTimes(1);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("__Host-rzka_local_session=rzs1.");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain(token);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("fails closed on replay, expiry, cross-site bootstrap, or a non-bootstrap scope", async () => {
    let consumed = false;
    const consume = vi.fn(async () => {
      if (consumed) throw new Error("replayed");
      consumed = true;
    });
    const handler = createLocalSessionBootstrapHandler({ config, clock: () => now + 1, consume });
    const token = bootstrapToken();
    expect((await handler(request(token))).status).toBe(204);
    expect((await handler(request(token))).status).toBe(403);

    const expiredHandler = createLocalSessionBootstrapHandler({ config, clock: () => now + 91, consume: async () => undefined });
    expect((await expiredHandler(request(bootstrapToken()))).status).toBe(403);
    expect((await handler(request(bootstrapToken(), {
      Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site",
    }))).status).toBe(403);

    const session = mintLocalSessionCapability({
      kind: "session", workspaceId, workspaceRef: "workspace_local", userId,
      readerRef: "reader_local_owner", osUid: process.getuid!(), issuedAt: now, expiresAt: now + 300,
    }, key).token;
    expect((await handler(request(session))).status).toBe(403);
  });

  it("classifies an authentic proof missing from this server's checkout without minting a cookie", async () => {
    const response = await createLocalSessionBootstrapHandler({ config, clock: () => now + 1 })(request(bootstrapToken()));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: {
      code: "local_session_proof_not_registered",
      message: expect.any(String),
    } });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("accepts an explicitly zero-length body stream from a real route adapter", async () => {
    const consume = vi.fn(async () => undefined);
    const response = await createLocalSessionBootstrapHandler({ config, clock: () => now + 1, consume })(zeroLengthStreamRequest(bootstrapToken()));
    expect(response.status).toBe(204);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it("keeps an unknown-length stream out of the bootstrap boundary", async () => {
    const consume = vi.fn(async () => undefined);
    const response = await createLocalSessionBootstrapHandler({ config, clock: () => now + 1, consume })(zeroLengthStreamRequest(bootstrapToken(), null));
    expect(response.status).toBe(403);
    expect(consume).not.toHaveBeenCalled();
  });
});
