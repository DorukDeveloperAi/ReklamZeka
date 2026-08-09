import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const child = spawn("node", ["--import", "tsx", "scripts/reklamzeka-mcp.ts"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
let stdout = ""; let stderr = ""; let finished = false;
let catalogHash = ""; let accountRef = ""; let accountGroupUnavailable = false;
function send(value: unknown) { child.stdin.write(`${JSON.stringify(value)}\n`); }
const result = await new Promise<Record<string, unknown>>((resolveResult) => {
  const timer = setTimeout(() => finish({ ok: false, stage: "timeout", blocker: "local_mcp_session_unavailable",
    continuation: "npm run verify:guidance-agent-live" }), 15_000);
  function finish(value: Record<string, unknown>) { if (finished) return; finished = true; clearTimeout(timer);
    child.stdin.end(); setTimeout(() => child.kill("SIGTERM"), 250).unref(); resolveResult(value); }
  child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => {
    stdout += chunk; let boundary = stdout.indexOf("\n");
    while (!finished && boundary >= 0) { const line = stdout.slice(0, boundary); stdout = stdout.slice(boundary + 1);
      boundary = stdout.indexOf("\n"); if (!line) continue;
      try {
        const message = JSON.parse(line) as { id?: number; result?: { isError?: boolean; structuredContent?: Record<string, unknown> } };
        if (message.id === 1) { send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "register_agent_session", arguments: {} } }); }
        else if (message.id === 2) { if (message.result?.isError) return finish({ ok: false, stage: "register" });
          send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "guidance_registry_list", arguments: {} } }); }
        else if (message.id === 3) { if (message.result?.isError) return finish({ ok: false, stage: "list" });
          const listAuthority = message.result?.structuredContent?.authority as Record<string, unknown> | undefined;
          if (listAuthority?.canWriteMeta !== false || listAuthority.canPublish !== false) return finish({ ok: false, stage: "list_authority" });
          const listed = message.result?.structuredContent?.result as Record<string, unknown> | undefined;
          const catalog = listed?.scopeCatalog as Record<string, unknown> | undefined;
          const facets = Array.isArray(catalog?.facets) ? catalog.facets as Record<string, unknown>[] : [];
          const accountFacet = facets.find((facet) => facet.facet === "account");
          const accountGroupFacet = facets.find((facet) => facet.facet === "account_group");
          const accountOptions = Array.isArray(accountFacet?.options) ? accountFacet.options as Record<string, unknown>[] : [];
          const catalogEvidence = catalog?.evidence as Record<string, unknown> | undefined;
          accountRef = typeof accountOptions[0]?.ref === "string" ? accountOptions[0].ref : "";
          catalogHash = typeof catalog?.catalogHash === "string" ? catalog.catalogHash : "";
          accountGroupUnavailable = accountGroupFacet?.status === "partial"
            && accountGroupFacet.reasonCode === "account_group_catalog_unavailable";
          if (!/^account_[a-f0-9]{24}$/.test(accountRef) || !/^[a-f0-9]{64}$/.test(catalogHash)
            || catalog?.version !== "guidance-facet-scope-catalog/1.0.0"
            || catalogEvidence?.objectiveMappingVersion !== "meta-objective-mapping/1.0.0" || !accountGroupUnavailable) {
            return finish({ ok: false, stage: accountRef ? "scope_catalog" : "account_catalog_empty",
              accountGroupUnavailable });
          }
          send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "guidance_effective_preview", arguments: {
            contractVersion: "guidance-agent-tools/1.2.0", expectedCatalogHash: catalogHash,
            accountRef, accountGroupRefs: [], objective: null,
            funnel: null, optimization: null, internalCategoryRefs: [], lifecycle: null,
            promotionTemplateRefs: [], entity: null,
            topics: [], requiredTopics: [], evaluatedAt: new Date().toISOString(),
            timeframe: { ref: "timeframe_last_7d", kind: "rolling" },
          } } }); }
        else if (message.id === 4) { if (message.result?.isError) return finish({ ok: false, stage: "preview" });
          const authority = message.result?.structuredContent?.authority as Record<string, unknown> | undefined;
          const preview = message.result?.structuredContent?.result as Record<string, unknown> | undefined;
          const scopeCapture = preview?.scopeCapture as Record<string, unknown> | undefined;
          const exactCapture = scopeCapture?.catalogHash === catalogHash
            && scopeCapture.version === "guidance-facet-scope-catalog/1.0.0";
          finish({ ok: authority?.canWriteMeta === false && authority.canAuthorizeAction === false
              && exactCapture && stderr.length === 0,
            registered: true, registryRead: true, effectivePreview: true, authorityClosed: authority?.canWriteMeta === false,
            tenantScopeResolved: exactCapture, accountGroupUnavailable, stderrEmpty: stderr.length === 0 }); }
      } catch { finish({ ok: false, stage: "protocol" }); }
    }
  });
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {},
    clientInfo: { name: "guidance-live-acceptance", version: "1" } } });
});
process.stdout.write(`${JSON.stringify(result)}\n`); if (result.ok !== true) process.exitCode = result.blocker ? 2 : 1;
