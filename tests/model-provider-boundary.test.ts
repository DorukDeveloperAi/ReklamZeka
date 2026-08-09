import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const checker = resolve("scripts/check-model-provider-boundary.mjs");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(input: Readonly<{
  packageJson?: Record<string, unknown>;
  packageLock?: Record<string, unknown>;
  runtimeSource?: string;
  pythonRuntimeSource?: string;
}>) {
  const root = await mkdtemp(join(tmpdir(), "reklamzeka-model-boundary-"));
  roots.push(root);
  await Promise.all([
    mkdir(join(root, "src"), { recursive: true }),
    mkdir(join(root, "scripts"), { recursive: true }),
    mkdir(join(root, "docs"), { recursive: true }),
  ]);
  if (input.pythonRuntimeSource !== undefined) {
    await writeFile(join(root, "src/legacy_runtime.py"), input.pythonRuntimeSource);
  }
  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify(input.packageJson ?? {
      name: "safe-fixture", private: true, dependencies: { pg: "1.0.0" },
    })),
    writeFile(join(root, "package-lock.json"), JSON.stringify(input.packageLock ?? {
      name: "safe-fixture", lockfileVersion: 3,
      packages: { "": { name: "safe-fixture", dependencies: { pg: "1.0.0" } }, "node_modules/pg": { version: "1.0.0" } },
    })),
    writeFile(join(root, "src/index.ts"), input.runtimeSource ?? "export const graphOrigin = 'https://graph.facebook.com';\n"),
    writeFile(join(root, "scripts/configure-local-cli.ts"), "export const clients = ['Codex CLI', 'Claude Code'];\n"),
    writeFile(join(root, "docs/model-boundary.md"), [
      "Provider docs may mention openai and @anthropic-ai/sdk.",
      "Documentation may name OPENAI_API_KEY, ANTHROPIC_API_KEY, api.openai.com and api.anthropic.com.",
    ].join("\n")),
  ]);
  return root;
}

async function run(root: string) {
  try {
    const result = await execute(process.execPath, [checker, "--root", root], { encoding: "utf8" });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { status: failure.code ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe("no-model-API boundary checker", () => {
  it("allows Meta Graph runtime code, CLI client names, and provider references in documentation", async () => {
    const root = await fixture({});
    const result = await run(root);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("MODEL PROVIDER BOUNDARY PASS");
  });

  it.each([
    ["OpenAI import", "import OpenAI from 'openai';\nexport default OpenAI;", "yasak model-provider import'u (openai)"],
    ["Anthropic import", "const sdk = await import('@anthropic-ai/sdk');\nexport { sdk };", "yasak model-provider import'u (@anthropic-ai/sdk)"],
    ["OpenAI scoped import", "import { Agent } from '@openai/agents';\nexport { Agent };", "yasak model-provider import'u (@openai)"],
    ["OpenAI environment", "export const key = process.env.OPENAI_API_KEY;\n", "yasak model-provider environment anahtarı (OPENAI_API_KEY)"],
    ["Anthropic environment", "export const key = process.env['ANTHROPIC_API_KEY'];\n", "yasak model-provider environment anahtarı (ANTHROPIC_API_KEY)"],
    ["OpenAI API", "export const endpoint = 'https://api.openai.com/v1/responses';\n", "doğrudan model-provider API host'u (api.openai.com)"],
    ["Anthropic API", "export const endpoint = 'https://api.anthropic.com/v1/messages';\n", "doğrudan model-provider API host'u (api.anthropic.com)"],
  ])("rejects %s in runtime source", async (_name, runtimeSource, reason) => {
    const root = await fixture({ runtimeSource });
    const result = await run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MODEL PROVIDER BOUNDARY FAIL");
    expect(result.stderr).toContain(reason);
  });

  it("rejects forbidden packages declared by the manifest", async () => {
    const root = await fixture({
      packageJson: { name: "unsafe-fixture", dependencies: { "@ai-sdk/openai": "1.0.0" } },
    });
    const result = await run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("yasak model-provider paketi (@ai-sdk/openai)");
  });

  it("also rejects model-provider authority introduced through Python runtime source", async () => {
    const root = await fixture({ pythonRuntimeSource: "from openai import OpenAI\nkey = OPENAI_API_KEY\n" });
    const result = await run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/legacy_runtime.py: yasak model-provider environment anahtarı (OPENAI_API_KEY)");
  });

  it("rejects a direct model-provider endpoint hidden in a package script", async () => {
    const root = await fixture({ packageJson: { name: "unsafe-fixture",
      scripts: { unsafe: "curl https://api.openai.com/v1/models" } } });
    const result = await run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("package.json#scripts.unsafe: doğrudan model-provider API host'u (api.openai.com)");
  });

  it("rejects forbidden transitive packages found only in the lockfile", async () => {
    const root = await fixture({
      packageLock: {
        name: "unsafe-fixture", lockfileVersion: 3,
        packages: { "": { name: "unsafe-fixture" }, "node_modules/@ai-sdk/anthropic": { version: "1.0.0" } },
      },
    });
    const result = await run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("yasak model-provider paketi (@ai-sdk/anthropic)");
  });

  it("fails closed when the supplied root is not a complete package root", async () => {
    const root = await mkdtemp(join(tmpdir(), "reklamzeka-model-boundary-empty-"));
    roots.push(root);
    const result = await run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("package.json: bulunamadı");
    expect(result.stderr).toContain("package-lock.json: bulunamadı");
  });
});
