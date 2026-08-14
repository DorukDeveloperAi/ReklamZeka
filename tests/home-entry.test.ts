import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("home entry", () => {
  it("sends users to the real dashboard instead of a fixture pilot", () => {
    const html = renderToStaticMarkup(createElement(Home));
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("Kanonik kaynak durumu dashboard’da doğrulanır");
    expect(html).not.toContain("Kontrollü saha pilotu");
    expect(html).not.toContain('href="/pilot"');
  });
});
