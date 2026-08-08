import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PracticeLabReadSurface } from "@/app/dashboard/practice-lab-panel";

const callbacks = { onRetry: vi.fn(), onSelect: vi.fn(), onPrepareDraft: vi.fn() };

describe("Practice Lab dashboard", () => {
  it("distinguishes unavailable, error, and real empty states without demo fallback", () => {
    const unavailable = renderToStaticMarkup(createElement(PracticeLabReadSurface, {
      ...callbacks, state: { status: "unavailable", message: "Yerel oturum gerekli." },
    }));
    const error = renderToStaticMarkup(createElement(PracticeLabReadSurface, {
      ...callbacks, state: { status: "error", message: "Güvenli kaynak okunamadı." },
    }));
    const empty = renderToStaticMarkup(createElement(PracticeLabReadSurface, {
      ...callbacks,
      state: {
        status: "ready",
        result: { contractVersion: "practice-lab-read-model/1.0.0", view: "list", items: [], nextCursor: null, authority: {} as never },
        selected: null, draft: null,
      },
    }));
    expect(unavailable).toContain("Kaynak henüz bağlı değil");
    expect(unavailable).toContain("Demo practice gösterilmez");
    expect(error).toContain("Practice Lab okunamadı");
    expect(empty).toContain("Kaynak bağlı · practice yok");
    expect(empty).toContain("fixture veya demo fallback değildir");
    expect(empty).not.toContain("Yerel oturum gerekli");
  });

  it("renders authority boundaries before any record is selected", () => {
    const html = renderToStaticMarkup(createElement(PracticeLabReadSurface, {
      ...callbacks, state: { status: "loading" },
    }));
    expect(html).toContain("ADVISORY ONLY · NO PERSIST");
    expect(html).toContain("guidance, policy, otomasyon veya eylem üretemez");
    expect(html).not.toContain("Onayla");
  });
});
