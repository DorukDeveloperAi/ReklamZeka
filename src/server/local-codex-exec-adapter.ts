import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { stat } from "node:fs/promises";
import {
  OrchestratorAdapterError,
  type OrchestratorModelAdapter,
} from "@/application/orchestrator-conversation";

export type LocalCodexExecConfig = Readonly<{
  executable: string;
  workspaceRoot: string;
  timeoutMs: number;
  environment: Readonly<Record<string, string>>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ENV = Object.freeze(["HOME", "CODEX_HOME", "USER", "TMPDIR", "SSL_CERT_FILE"] as const);
const DEFAULT_CODEX_EXECUTABLE = "/Applications/ChatGPT.app/Contents/Resources/codex";
const MAX_STDOUT = 4 * 1024 * 1024;
const MAX_STDERR = 64 * 1024;

export function localCodexExecConfig(environment: Readonly<Record<string, string | undefined>>,
  serverCwd = process.cwd()): LocalCodexExecConfig | null {
  if (environment.REKLAMZEKA_ORCHESTRATOR_CODEX_ENABLED !== "true") return null;
  const executable = environment.REKLAMZEKA_CODEX_EXECUTABLE?.trim() || DEFAULT_CODEX_EXECUTABLE;
  const workspaceRoot = resolve(environment.REKLAMZEKA_CODEX_WORKSPACE_ROOT?.trim() || serverCwd);
  if (!isAbsolute(executable) || !isAbsolute(workspaceRoot)) throw new OrchestratorAdapterError("adapter_unavailable");
  const allowlisted = Object.fromEntries(ALLOWED_ENV.flatMap((key) => {
    const value = environment[key];
    return typeof value === "string" && value.length > 0 ? [[key, value]] : [];
  }));
  return Object.freeze({ executable, workspaceRoot, timeoutMs: 120_000,
    environment: Object.freeze(allowlisted) });
}

export function normalizeCodexJsonl(stdout: string, expectedThreadRef: string | null) {
  if (Buffer.byteLength(stdout) > MAX_STDOUT) throw new OrchestratorAdapterError("invalid_provider_output");
  let threadRef: string | null = null;
  const finalResponses: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: unknown;
    try { event = JSON.parse(line); } catch { throw new OrchestratorAdapterError("invalid_provider_output"); }
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new OrchestratorAdapterError("invalid_provider_output");
    }
    const record = event as Record<string, unknown>;
    if (record.type === "thread.started") {
      if (typeof record.thread_id !== "string" || !UUID.test(record.thread_id)) {
        throw new OrchestratorAdapterError("invalid_provider_output");
      }
      if (threadRef !== null && threadRef !== record.thread_id) throw new OrchestratorAdapterError("invalid_provider_output");
      threadRef = record.thread_id.toLowerCase();
    }
    if (record.type === "item.completed" && record.item && typeof record.item === "object"
      && !Array.isArray(record.item)) {
      const item = record.item as Record<string, unknown>;
      if (item.type === "agent_message") {
        if (typeof item.text !== "string") throw new OrchestratorAdapterError("invalid_provider_output");
        const text = item.text.trim();
        if (text.length < 1 || text.length > 30_000) throw new OrchestratorAdapterError("invalid_provider_output");
        finalResponses.push(text);
      }
    }
  }
  const resolvedThread = threadRef ?? expectedThreadRef;
  if (!resolvedThread || !UUID.test(resolvedThread) || (expectedThreadRef && resolvedThread !== expectedThreadRef.toLowerCase())
    || finalResponses.length < 1) throw new OrchestratorAdapterError("invalid_provider_output");
  return Object.freeze({ providerThreadRef: resolvedThread.toLowerCase(), finalResponse: finalResponses.at(-1)! });
}

type SpawnProcess = (executable: string, args: readonly string[], options: Readonly<{
  cwd: string; env: Readonly<Record<string, string>>; shell: false; stdio: readonly ["pipe", "pipe", "pipe"];
}>) => ChildProcessWithoutNullStreams;

export class LocalCodexExecAdapter implements OrchestratorModelAdapter {
  constructor(private readonly config: LocalCodexExecConfig,
    private readonly spawnProcess: SpawnProcess = spawn as unknown as SpawnProcess) {}

  async execute(input: Readonly<{ providerThreadRef: string | null; prompt: string }>) {
    if (input.providerThreadRef !== null && !UUID.test(input.providerThreadRef)) {
      throw new OrchestratorAdapterError("invalid_provider_output");
    }
    try {
      const executable = await stat(this.config.executable);
      const workspace = await stat(this.config.workspaceRoot);
      if (!executable.isFile() || !workspace.isDirectory()) throw new Error("unavailable");
    } catch { throw new OrchestratorAdapterError("adapter_unavailable"); }
    const common = ["--json", "--ignore-user-config", "-c", "shell_environment_policy.inherit=none"];
    const args = input.providerThreadRef === null
      ? ["exec", ...common, "--sandbox", "read-only", "--cd", this.config.workspaceRoot, "--color", "never", "-"]
      : ["exec", "resume", ...common, "-c", "sandbox_mode=\"read-only\"", input.providerThreadRef, "-"];
    return new Promise<Readonly<{ providerThreadRef: string; finalResponse: string }>>((resolvePromise, reject) => {
      let settled = false;
      let stdout = "";
      let stderr = "";
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnProcess(this.config.executable, args, { cwd: this.config.workspaceRoot,
          env: this.config.environment, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      } catch { reject(new OrchestratorAdapterError("adapter_unavailable")); return; }
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(new OrchestratorAdapterError("adapter_timeout"));
      }, this.config.timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > MAX_STDOUT) child.kill("SIGKILL");
      });
      child.stderr.on("data", (chunk: string) => {
        if (Buffer.byteLength(stderr) < MAX_STDERR) stderr += chunk;
      });
      child.on("error", () => {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(new OrchestratorAdapterError("adapter_unavailable"));
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (code !== 0 || signal !== null || Buffer.byteLength(stdout) > MAX_STDOUT) {
          reject(new OrchestratorAdapterError("adapter_failed")); return;
        }
        try { resolvePromise(normalizeCodexJsonl(stdout, input.providerThreadRef)); }
        catch (reason) { reject(reason); }
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(input.prompt, "utf8");
    });
  }
}
