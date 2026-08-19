import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createSliceRuleBudgetActionUnitHttpHandlers } from "@/server/slice-rule-budget-action-unit-http";
import { createSliceRuleScenarioSelectionHttpHandlers } from "@/server/slice-rule-scenario-selection-http";

const principal = Object.freeze({
  actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111",
  workspaceRef: "workspace_primary",
  readerRef: "reader_primary",
});

function source(path: string) { return readFileSync(resolve(process.cwd(), path), "utf8"); }
function apiPaths(path = resolve(process.cwd(), "src/app/api")): readonly string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? apiPaths(child) : entry.isFile() && entry.name === "route.ts" ? [child] : [];
  });
}

function bypassRequest(path: string, intent: string) {
  return new Request(`https://local.test${path}`, { method: "POST", headers: {
    cookie: "rz=local", "authorization": "Bearer forged", "sec-fetch-site": "same-origin",
    "x-reklamzeka-intent": intent, origin: "https://local.test", "content-type": "application/json",
  }, body: "{}" });
}

describe("Meta-write-closed slice-rule approval chain", () => {
  it("keeps each persisted preparation surface explicitly non-executing and non-Meta-writing", () => {
    const surfaces = [
      "src/server/slice-rule-workspace-http.ts",
      "src/server/slice-rule-budget-impact-http.ts",
      "src/server/slice-rule-scenario-selection-http.ts",
      "src/server/slice-rule-budget-action-unit-http.ts",
      "src/server/approval-decision-http.ts",
      "src/server/operational-timeline-http.ts",
    ];
    for (const path of surfaces) {
      const value = source(path);
      expect(value, path).toContain('"X-ReklamZeka-Action-Authority": "none"');
      expect(value, path).toContain('"X-ReklamZeka-Meta-Write": "disabled"');
    }
    const mutablePreparationSurfaces = surfaces.slice(0, 5);
    for (const path of mutablePreparationSurfaces) {
      const value = source(path);
      expect(value, path).toMatch(/canExecute:\s*false/);
      expect(value, path).toMatch(/canWriteMeta:\s*false/);
    }
  });

  it("rejects direct mutation endpoint bypasses before a principal, repository, or materializer can run", async () => {
    const resolveActionPrincipal = vi.fn(async () => principal);
    const actionDatabase = { select: vi.fn(), execute: vi.fn() };
    const action = createSliceRuleBudgetActionUnitHttpHandlers({ database: actionDatabase as never, resolvePrincipal: resolveActionPrincipal });
    expect((await action.POST(bypassRequest("/api/slice-rule-budget-action-units", "slice-rule-budget-action-unit-materialize"))).status).toBe(400);
    expect(resolveActionPrincipal).not.toHaveBeenCalled();
    expect(actionDatabase.select).not.toHaveBeenCalled();

    const repository = { listCandidates: vi.fn(), resolveCandidate: vi.fn(), append: vi.fn() };
    const resolveSelectionPrincipal = vi.fn(async () => principal);
    const selection = createSliceRuleScenarioSelectionHttpHandlers({ repository, resolvePrincipal: resolveSelectionPrincipal, now: () => "2026-08-15T00:00:00.000Z" });
    expect((await selection.POST(bypassRequest("/api/slice-rule-scenario-selections", "slice-rule-scenario-select"))).status).toBe(400);
    expect(resolveSelectionPrincipal).not.toHaveBeenCalled();
    expect(repository.resolveCandidate).not.toHaveBeenCalled();
    expect(repository.append).not.toHaveBeenCalled();
  });

  it("has no public execute route and no Meta transport reachable from the preparation, approval, or timeline chain", () => {
    const routes = apiPaths().map((path) => path.replace(`${resolve(process.cwd(), "src/app/api")}/`, ""));
    expect(routes.some((path) => /(?:^|\/)action-execution(?:\/|$)|(?:^|\/)execute(?:\/|$)/.test(path))).toBe(false);

    const chain = [
      "src/connectors/campaigns/slice-rule-budget-action-unit-materializer.ts",
      "src/connectors/actions/action-approval-decision-drizzle-repository.ts",
      "src/application/action-execution-admission-service.ts",
      "src/server/local-action-execution-admission-runtime.ts",
      "src/connectors/decisions/operational-timeline-drizzle-repository.ts",
    ].map(source).join("\n");
    expect(chain).not.toMatch(/\bfetch\s*\(/);
    expect(chain).not.toMatch(/MetaGraph(?:Client|SyncTransport)/);
    expect(chain).not.toMatch(/canDispatchNetwork:\s*true/);
    expect(source("src/domain/actions/action-preparation-flag.ts")).toContain("enabled: false as const");
  });

  it("labels the UI handoff and history as preparation-only, including the post-approval closed state", () => {
    const ui = source("src/app/dashboard/slice-rule-workspace-panel.tsx");
    expect(ui).toContain("İnsan onayına hazırlık");
    expect(ui).toContain("Meta write ve execute kapalıdır");
    expect(ui).toContain("Karar izi");
    expect(ui).toContain("Salt-okunur · Meta write ve execute kapalı");
  });
});
