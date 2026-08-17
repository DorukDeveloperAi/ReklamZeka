import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportUnavailable } from "@/app/reports/report-view";

describe("report accessibility boundaries", () => {
  it("keeps an unavailable report keyboard-skippable and announces its source-state failure", () => {
    const html = renderToStaticMarkup(createElement(ReportUnavailable, { reason: "expired" }));
    expect(html).toContain('href="#report-content"');
    expect(html).toContain('id="report-content"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Bu rapor bağlantısının süresi doldu.");
  });

  it("ships reduced-motion and visible-focus fallbacks for report surfaces", () => {
    const source = require("node:fs").readFileSync("src/app/styles.css", "utf8");
    expect(source).toContain(".skip-link:focus");
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("makes both available and unavailable skip targets programmatically focusable", () => {
    const source = require("node:fs").readFileSync("src/app/reports/report-view.tsx", "utf8");
    expect((source.match(/<main id="report-content" tabIndex=\{-1\}/g) ?? []).length).toBe(2);
  });
});
