import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_SESSION_COOKIE,
  mintLocalSessionCapability,
} from "@/security/local-session-capability";
import {
  consumeLocalSessionBootstrap,
  registerLocalSessionBootstrap,
} from "@/security/local-session-bootstrap-store";
import { createLocalSessionBootstrapHandler } from "@/server/local-session-bootstrap-http";
import {
  createLocalDecisionRoomRouteHandlers,
  localDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const adAccountId = "33333333-3333-4333-a333-333333333333";
const campaignId = "44444444-4444-4444-a444-444444444444";
const signingKey = Buffer.alloc(32, 13);
const roots: string[] = [];

const config = localDecisionRoomConfig({
  DATABASE_URL: "postgresql://private.invalid/reklamzeka",
  REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
  REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
  REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId,
  REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
  REKLAMZEKA_LOCAL_USER_ID: userId,
  REKLAMZEKA_LOCAL_READER_REF: "reader_local_owner",
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64"),
})!;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const path = await mkdtemp(join(tmpdir(), "reklamzeka-local-conformance-"));
  roots.push(path);
  return path;
}

function mint(kind: "bootstrap" | "session", issuedAt: number, expiresAt: number) {
  return mintLocalSessionCapability({
    kind,
    workspaceId,
    workspaceRef: "workspace_local",
    userId,
    readerRef: "reader_local_owner",
    osUid: process.getuid!(),
    issuedAt,
    expiresAt,
  }, signingKey);
}

function bootstrapRequest(token: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/local-session", {
    method: "POST",
    headers: {
      Host: "localhost:3000",
      Origin: "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin",
      "X-ReklamZeka-Intent": "bootstrap-local-session",
      Authorization: `Bearer ${token}`,
      ...headers,
    },
  });
}

function decisionRoomRequest(credential: Readonly<{ cookie?: string; bearer?: string }>, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/decision-room?view=runs&limit=10", {
    headers: {
      Host: "localhost:3000",
      "Sec-Fetch-Site": credential.cookie ? "same-origin" : "none",
      ...(credential.cookie ? { Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(credential.cookie)}` } : {}),
      ...(credential.bearer ? { Authorization: `Bearer ${credential.bearer}` } : {}),
      ...headers,
    },
  });
}

function readDatabase() {
  let call = 0;
  return {
    execute: vi.fn(async () => {
      const phase = call++ % 3;
      if (phase === 0) {
        return { rows: [{
          workspace_id: workspaceId,
          user_id: userId,
          role: "owner",
          lifecycle_state: "active",
        }] };
      }
      if (phase === 1) return { rows: [{ id: workspaceId }] };
      return { rows: [{
        run_ref: "run_conformance",
        state: "completed",
        trigger_kind: "manual",
        trigger_ref: "trigger_conformance",
        schedule_ref: null,
        schedule_definition_hash: null,
        ad_account_id: adAccountId,
        campaign_id: campaignId,
        account_ref: "act_private_meta_identifier",
        campaign_ref: "private_meta_campaign_identifier",
        timeframe_ref: "timeframe_last_7d",
        template_ref: "template_conformance",
        attempt: 1,
        started_at: "2026-08-07T08:00:00.000Z",
        completed_at: "2026-08-07T08:01:00.000Z",
        failed_at: null,
      }] };
    }),
    transaction: vi.fn(),
  };
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  expect(setCookie.startsWith(`${LOCAL_SESSION_COOKIE}=rzs1.`)).toBe(true);
  expect(setCookie.includes("HttpOnly")).toBe(true);
  expect(setCookie.includes("Secure")).toBe(true);
  expect(setCookie.includes("SameSite=strict")).toBe(true);
  const match = new RegExp(`${LOCAL_SESSION_COOKIE}=([^;]+)`).exec(setCookie);
  expect(Boolean(match)).toBe(true);
  return decodeURIComponent(match![1]!);
}

describe("local session operational conformance", () => {
  it("projects identical safe Decision Room refs for dashboard cookie and CLI bearer", async () => {
    const base = await temporaryRoot();
    const now = Math.floor(Date.now() / 1000);
    const proof = mint("bootstrap", now - 1, now + 90);
    await registerLocalSessionBootstrap(proof.claims, proof.token, base);
    const bootstrap = createLocalSessionBootstrapHandler({
      config,
      clock: () => now,
      consume: (claims, token, consumedAt) => consumeLocalSessionBootstrap(claims, token, consumedAt, base),
    });

    const bootstrapResponse = await bootstrap(bootstrapRequest(proof.token));
    expect(bootstrapResponse.status).toBe(204);
    const cookie = sessionCookie(bootstrapResponse);
    const cli = mint("session", now - 1, now + 28_799);
    const database = readDatabase();
    const handlers = createLocalDecisionRoomRouteHandlers({ database: database as never, config });

    const dashboardResponse = await handlers.GET(decisionRoomRequest({ cookie }));
    const cliResponse = await handlers.GET(decisionRoomRequest({ bearer: cli.token }));
    expect(dashboardResponse.status).toBe(200);
    expect(cliResponse.status).toBe(200);
    const dashboard = await dashboardResponse.json();
    const commandLine = await cliResponse.json();
    expect(commandLine).toEqual(dashboard);
    expect(dashboard.result.items).toHaveLength(1);
    expect(dashboard.result.items[0]).toMatchObject({
      runRef: "run_conformance",
      accountRef: expect.stringMatching(/^account_[a-f0-9]{20}$/),
      campaignRef: expect.stringMatching(/^campaign_[a-f0-9]{20}$/),
    });
    expect(dashboard.authority).toEqual({
      source: "server_bound_workspace",
      metaWrite: false,
      budgetWrite: false,
      actionExecution: false,
    });

    const publicPayload = JSON.stringify(dashboard);
    const containsPrivateMaterial = [
      proof.token,
      cookie,
      cli.token,
      signingKey.toString("base64"),
      workspaceId,
      userId,
      adAccountId,
      campaignId,
      "act_private_meta_identifier",
      "private_meta_campaign_identifier",
      "private.invalid",
    ].some((privateValue) => publicPayload.includes(privateValue));
    expect(containsPrivateMaterial).toBe(false);
    expect(database.execute).toHaveBeenCalledTimes(6);
  });

  it("keeps bootstrap replay, expiry, host, origin, proxy, and bearer expiry fail-closed", async () => {
    const base = await temporaryRoot();
    const now = Math.floor(Date.now() / 1000);
    const proof = mint("bootstrap", now - 1, now + 90);
    await registerLocalSessionBootstrap(proof.claims, proof.token, base);
    const bootstrap = createLocalSessionBootstrapHandler({
      config,
      clock: () => now,
      consume: (claims, token, consumedAt) => consumeLocalSessionBootstrap(claims, token, consumedAt, base),
    });
    expect((await bootstrap(bootstrapRequest(proof.token))).status).toBe(204);
    expect((await bootstrap(bootstrapRequest(proof.token))).status).toBe(403);

    const expiredProof = mint("bootstrap", now - 100, now - 10);
    expect((await bootstrap(bootstrapRequest(expiredProof.token))).status).toBe(403);
    const crossSiteProof = mint("bootstrap", now - 1, now + 90);
    expect((await bootstrap(bootstrapRequest(crossSiteProof.token, {
      Origin: "https://attacker.invalid",
      "Sec-Fetch-Site": "cross-site",
    }))).status).toBe(403);

    const validSession = mint("session", now - 1, now + 300).token;
    const database = readDatabase();
    const handlers = createLocalDecisionRoomRouteHandlers({ database: database as never, config });
    expect((await handlers.GET(decisionRoomRequest({ bearer: validSession }, { Host: "attacker.invalid" }))).status).toBe(503);
    expect((await handlers.GET(decisionRoomRequest({ bearer: validSession }, {
      Origin: "https://attacker.invalid",
      "Sec-Fetch-Site": "cross-site",
    }))).status).toBe(503);
    expect((await handlers.GET(decisionRoomRequest({ bearer: validSession }, {
      "X-Forwarded-For": "127.0.0.1",
    }))).status).toBe(503);
    const expiredSession = mint("session", now - 400, now - 100).token;
    expect((await handlers.GET(decisionRoomRequest({ bearer: expiredSession }))).status).toBe(503);
    expect(database.execute).not.toHaveBeenCalled();
  });
});
