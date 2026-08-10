import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CampaignPlanningBriefPanel } from "@/app/dashboard/campaign-planning-brief-panel";

describe("campaign planning brief panel", () => {
  it("surfaces the taxonomy-driven, proposal-only interactive brief without any action control", () => {
    const html = renderToStaticMarkup(createElement(CampaignPlanningBriefPanel));
    expect(html).toContain("Taslak kampanya briefi");
    expect(html).toContain("pazar → dil → hizmet → iş amacı → dönüşüm yolu → kapasite/kreatif");
    expect(html).toContain("Nitelikli form talebi");
    expect(html).toContain("campaign create / publish / approval / execute / Meta write: kapalı");
    expect(html).not.toMatch(/Meta.{0,30}(yaz|write).{0,30}(başlat|çalıştır|onayla)/i);
  });
});
