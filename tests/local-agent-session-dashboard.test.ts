import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  approvalQueueScopeAfterCampaignSelection,
  OperatingDashboard,
  resolveAgentSessionSelection,
} from "@/app/dashboard/operating-dashboard";

const session = (sessionRef: string, clientRef: string) => ({
  sessionRef, clientRef, transport: "project_stdio" as const, workspaceRef: "workspace_local",
  startedAt: "2026-08-08T00:00:00.000Z", lastSeenAt: "2026-08-08T00:00:30.000Z",
  expiresAt: "2026-08-08T01:00:00.000Z",
});

describe("local agent session dashboard", () => {
  it("does not claim a Codex connection before the live session API verifies one", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { model: {
      periodDays: 7, spend: "₺0", conversions: 0, cpa: "₺0", roas: "0",
      freshnessHours: 0, freshnessLabel: "şimdi", currency: "TRY", timezone: "Europe/Istanbul",
      attribution: "7d_click_1d_view",
    } }));
    expect(html).toContain("Bağlı değil");
    expect(html).toContain("API doğrulaması olmadan bağlı gösterilmez");
    expect(html).not.toContain("Codex CLI bağlı");
  });

  it("selects one session automatically but requires an explicit choice when several are active", () => {
    const first = session("session_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "client_codex");
    const second = session("session_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "client_claude");
    expect(resolveAgentSessionSelection([], "")).toBe("");
    expect(resolveAgentSessionSelection([first], "")).toBe(first.sessionRef);
    expect(resolveAgentSessionSelection([first, second], "")).toBe("");
    expect(resolveAgentSessionSelection([first, second], second.sessionRef)).toBe(second.sessionRef);
  });

  it("clears a resolved approval queue scope before changing campaigns", () => {
    const scope = "entity_1eb4e78c07f9c395";
    expect(approvalQueueScopeAfterCampaignSelection("cmp-istanbul", "cmp-istanbul", scope)).toBe(scope);
    expect(approvalQueueScopeAfterCampaignSelection("cmp-istanbul", "cmp-gcc", scope)).toBeNull();
  });
});
