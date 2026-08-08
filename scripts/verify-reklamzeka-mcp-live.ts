import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { loadPrivateLocalMcpRuntime } from "@/mcp/private-local-environment";
import { LOCAL_SESSION_COOKIE } from "@/security/local-session-capability";

const root = resolve(import.meta.dirname, "..");
const dashboard = loadPrivateLocalMcpRuntime({ path: resolve(root, ".env.local") });
const cookie = `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(dashboard.token)}`;

async function dashboardRequest(path: string, input: Readonly<{
  method?: "GET" | "POST";
  intent: string;
  body?: unknown;
}>) {
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  const response = await fetch(new URL(path, dashboard.origin), {
    method: input.method ?? "GET",
    headers: {
      Cookie: cookie,
      Origin: dashboard.origin,
      "Sec-Fetch-Site": "same-origin",
      "X-ReklamZeka-Intent": input.intent,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body,
  });
  return { status: response.status, value: await response.json() as Record<string, unknown> };
}

await dashboardRequest("/api/local-agent-sessions", {
  method: "POST", intent: "local-agent-session-create", body: {},
});
const before = await dashboardRequest("/api/local-agent-sessions", { intent: "local-agent-sessions-read" });
const prior = new Set(((before.value.sessions ?? []) as Array<{ sessionRef: string }>).map((item) => item.sessionRef));

const child = spawn("node", ["--import", "tsx", "scripts/reklamzeka-mcp.ts"], {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
});
let buffer = "";
let stderr = "";
let handoffRef = "";
let complete = false;

function send(message: unknown) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

const result = await new Promise<Readonly<Record<string, unknown>>>((resolveResult) => {
  const timer = setTimeout(() => finish({ ok: false, stage: "timeout" }), 15_000);
  function finish(value: Readonly<Record<string, unknown>>) {
    if (complete) return;
    complete = true;
    clearTimeout(timer);
    child.stdin.end();
    setTimeout(() => child.kill("SIGTERM"), 250).unref();
    resolveResult(value);
  }
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let boundary = buffer.indexOf("\n");
    while (!complete && boundary >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      boundary = buffer.indexOf("\n");
      if (!line) continue;
      void (async () => {
        try {
          const message = JSON.parse(line) as { id?: number; result?: { isError?: boolean } };
          if (message.id === 1) {
            send({ jsonrpc: "2.0", method: "notifications/initialized" });
            send({ jsonrpc: "2.0", id: 2, method: "tools/call",
              params: { name: "register_agent_session", arguments: {} } });
          } else if (message.id === 2) {
            if (message.result?.isError) throw new Error("register");
            const after = await dashboardRequest("/api/local-agent-sessions", { intent: "local-agent-sessions-read" });
            const target = ((after.value.sessions ?? []) as Array<{ clientRef: string; sessionRef: string }>).find(
              (item) => item.clientRef === "client_reklamzeka_mcp" && !prior.has(item.sessionRef),
            );
            if (!target) throw new Error("discovery");
            const handoff = await dashboardRequest("/api/local-agent-handoffs", {
              method: "POST", intent: "local-agent-handoff-create",
              body: {
                targetSessionRef: target.sessionRef,
                context: {
                  intent: "analysis", entityRef: "campaign_acceptance", timeframeRef: "timeframe_last_7d",
                  contextRef: "context_acceptance", contextVersion: 1, templateRef: null,
                  correlationRef: `correlation_${randomBytes(16).toString("hex")}`,
                },
                ttlSeconds: 60,
              },
            });
            handoffRef = ((handoff.value.handoff ?? {}) as { handoffRef?: string }).handoffRef ?? "";
            if (handoff.status !== 201 || !handoffRef) throw new Error("handoff");
            send({ jsonrpc: "2.0", id: 3, method: "tools/call",
              params: { name: "get_handoff_context", arguments: { handoffRef } } });
          } else if (message.id === 3) {
            if (message.result?.isError) throw new Error("consume");
            send({ jsonrpc: "2.0", id: 4, method: "tools/call",
              params: { name: "get_handoff_context", arguments: { handoffRef } } });
          } else if (message.id === 4) {
            finish({ ok: message.result?.isError === true, registered: true, dashboardDiscovered: true,
              handoffConsumed: true, replayRejected: message.result?.isError === true, stderrEmpty: stderr.length === 0 });
          }
        } catch (reason) {
          finish({ ok: false, stage: reason instanceof Error ? reason.message : "unknown" });
        }
      })();
    }
  });
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "live-acceptance", version: "1" },
  } });
});

process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.ok !== true) process.exitCode = 1;
