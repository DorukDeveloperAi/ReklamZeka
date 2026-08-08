import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadPrivateLocalMcpRuntime } from "@/mcp/private-local-environment";
import { createReklamZekaMcpServer } from "@/mcp/reklamzeka-mcp-server";

try {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const runtime = loadPrivateLocalMcpRuntime({ path: resolve(projectRoot, ".env.local") });
  await serveStdio(() => createReklamZekaMcpServer({ runtime }), {
    onerror: () => { process.exitCode = 1; },
  });
} catch {
  // STDOUT is reserved exclusively for MCP protocol frames.
  process.stderr.write("ReklamZeka yerel MCP sunucusu güvenli biçimde başlatılamadı.\n");
  process.exitCode = 1;
}
