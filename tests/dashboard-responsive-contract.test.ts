import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/dashboard/operating-dashboard.module.css", "utf8");
const portfolio = readFileSync("src/app/dashboard/canonical-campaign-portfolio-panel.tsx", "utf8");
const decisionRoom = readFileSync("src/app/dashboard/decision-room-panel.tsx", "utf8");

describe("dashboard responsive critical-path contract", () => {
  it("keeps the campaign-to-decision action group usable on narrow viewports", () => {
    expect(portfolio).toContain("Kararlarda incele");
    expect(css).toContain(".detailHeader { display: grid; gap: 13px; }");
    expect(css).toContain(".detailHeader .agentActions { flex-wrap: wrap; }");
    expect(css).toContain(".detailHeader .agentActions { display: grid; grid-template-columns: 1fr; }");
  });

  it("uses stack-or-scroll behavior instead of a fixed narrow-screen workspace", () => {
    expect(css).toContain(".splitWorkspace, .guidanceWorkspace { grid-template-columns: 1fr; }");
    expect(css).toContain(".approvalQueueWorkspace { grid-template-columns: 1fr; }");
    expect(css).toContain(".decisionRoomList { grid-template-columns: 1fr; }");
    expect(css).toContain(".mobileNav { position: sticky;");
    expect(decisionRoom).toContain("Tüm çalışma alanına dön");
  });
});
