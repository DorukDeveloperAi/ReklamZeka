import { describe, expect, it, vi } from "vitest";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { createSliceRuleBudgetImpactHttpHandler } from "@/server/slice-rule-budget-impact-http";

const principal = { workspaceId: "11111111-1111-4111-8111-111111111111",
  workspaceRef: "workspace_local", readerRef: "reader_local",
  actor: { userId: "22222222-2222-4222-8222-222222222222" } } satisfies TrustedDecisionRoomPrincipal;
const command = { seriesRef: "slice_rule.ftr.ar", candidateRef: `budget_impact_context_${"a".repeat(24)}`,
  budgetCommand: { label: "keep", mode: "keep", requestedBudgetDecimal: "100.00", startDate: "2026-08-01", endDate: "2026-08-31" } };
const resolved = { workspaceId: principal.workspaceId, actorId: principal.actor.userId, seriesRef: command.seriesRef,
  expectedDraftRef: `slice_rule_draft_${"a".repeat(20)}`, expectedDraftHash: "a".repeat(64),
  expectedScope: { market: "international", serviceRef: "service_ftr", campaignFamilyRef: "campaign_family_intensive_ftr" },
  budgetCommand: { scope: { adAccountId: "33333333-3333-4333-8333-333333333333", campaignId: "44444444-4444-4444-8444-444444444444", contextHash: "a".repeat(64) }, seriesRef: "budget.impact.slice_rule.ftr.ar", revision: 1, previousProposalHash: "GENESIS", idempotencyKey: "budget.impact.one", createdAt: "2026-08-13T10:00:00.000Z", scenarios: [], outcomeProxy: null } } as const;

function request(body: unknown, intent = "slice-rule-budget-impact-preview") {
  return new Request("http://localhost:3000/api/slice-rule-workspace", { method: "POST",
    headers: { cookie: "session=bound", origin: "http://localhost:3000", "sec-fetch-site": "same-origin",
      "content-type": "application/json", "x-reklamzeka-intent": intent }, body: JSON.stringify(body) });
}

describe("Slice Rule Budget impact HTTP boundary", () => {
  it("derives tenant and actor server-side and preserves closed authority headers", async () => {
    const preview = vi.fn(async () => ({ contractVersion: "slice-rule-budget-impact/1.0.0" }));
    const resolveCandidateCommand = vi.fn(async () => resolved);
    const response = await createSliceRuleBudgetImpactHttpHandler({ service: { preview } as never,
      resolvePrincipal: async () => principal, resolveCandidateCommand })(request({ command }));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-ReklamZeka-Action-Authority")).toBe("none");
    expect(response.headers.get("X-ReklamZeka-Meta-Write")).toBe("disabled");
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: principal.workspaceId,
      actorId: principal.actor.userId, expectedDraftHash: resolved.expectedDraftHash }));
    expect(resolveCandidateCommand).toHaveBeenCalledWith(principal, command);
  });

  it("rejects non same-origin or wrong-intent requests before service invocation", async () => {
    const preview = vi.fn();
    const handler = createSliceRuleBudgetImpactHttpHandler({ service: { preview } as never,
      resolvePrincipal: async () => principal, resolveCandidateCommand: async () => resolved });
    expect((await handler(request({ command }, "slice-rule-workspace-save"))).status).toBe(400);
    expect(preview).not.toHaveBeenCalled();
  });

  it("rejects browser-supplied frozen identifiers before candidate resolution", async () => {
    const preview = vi.fn(); const resolveCandidateCommand = vi.fn(async () => resolved);
    const handler = createSliceRuleBudgetImpactHttpHandler({ service: { preview } as never,
      resolvePrincipal: async () => principal, resolveCandidateCommand });
    const leaked = { ...command, budgetCommand: { ...command.budgetCommand, contextHash: "a".repeat(64) } };
    expect((await handler(request({ command: leaked }))).status).toBe(400);
    expect(resolveCandidateCommand).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
  });

  it("routes an explicit advisory save through the server clock while retaining no action authority", async () => {
    const save = vi.fn(async () => ({ contractVersion: "slice-rule-budget-impact/1.0.0", mode: "saved_advisory_draft" }));
    const response = await createSliceRuleBudgetImpactHttpHandler({ service: { preview: vi.fn(), save } as never,
      resolvePrincipal: async () => principal, resolveCandidateCommand: async () => resolved })(request({ command }, "slice-rule-budget-impact-save"));
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: principal.workspaceId }), expect.any(String));
    expect(response.headers.get("X-ReklamZeka-Action-Authority")).toBe("none");
  });
});
