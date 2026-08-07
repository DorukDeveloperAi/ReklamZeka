import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DecisionRoomReadSurface } from "@/app/dashboard/decision-room-panel";

const callbacks = {
  onView: vi.fn(), onRetry: vi.fn(), onMarkRead: vi.fn(),
};

describe("Decision Room dashboard surface", () => {
  it("labels an unavailable production source without rendering demo records", () => {
    const html = renderToStaticMarkup(createElement(DecisionRoomReadSurface, {
      ...callbacks,
      view: "inbox",
      state: { status: "unavailable", message: "Decision Room çalışma alanı henüz etkin değil." },
    }));
    expect(html).toContain("Kaynak henüz bağlı değil");
    expect(html).toContain("Demo verisi canlı sonuç gibi gösterilmez");
    expect(html).toContain("READ ONLY · AUTHORITY NONE");
    expect(html).not.toContain("Günlük portföy kontrolü");
    expect(html).not.toContain("Onayla");
  });

  it("offers an explicit password-style capability bootstrap without embedding a token", () => {
    const html = renderToStaticMarkup(createElement(DecisionRoomReadSurface, {
      ...callbacks,
      onConnect: vi.fn(),
      view: "inbox",
      state: { status: "unavailable", message: "Yerel oturum gerekli." },
    }));
    expect(html).toContain("Tek kullanımlık yerel oturum capability");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).not.toContain("rzs1.");
  });

  it("renders an explicitly empty live read response as empty, not unavailable", () => {
    const html = renderToStaticMarkup(createElement(DecisionRoomReadSurface, {
      ...callbacks,
      view: "runs",
      state: {
        status: "ready",
        result: {
          contractVersion: "decision-room-read-model/1.0.0", view: "runs", items: [], nextCursor: null,
          capabilities: {
            modelAgnostic: true, containsInternalIds: false, containsRawData: false,
            canAuthorizeAction: false, canExecuteWrite: false,
          },
        },
      },
    }));
    expect(html).toContain("Kaynak bağlı · kayıt yok");
    expect(html).toContain("gerçek salt okunur yanıtıdır");
    expect(html).not.toContain("Kaynak henüz bağlı değil");
  });
});
