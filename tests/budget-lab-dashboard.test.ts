import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BudgetLabReadSurface } from "@/app/dashboard/budget-lab-panel";

const callbacks = { onRetry: vi.fn(), onSelect: vi.fn() };

describe("Budget Lab dashboard", () => {
  it("distinguishes source unavailable, error, and true empty without fixture fallback", () => {
    const unavailable = renderToStaticMarkup(createElement(BudgetLabReadSurface, { ...callbacks, state: { status: "unavailable", message: "Yerel oturum gerekli." } }));
    const error = renderToStaticMarkup(createElement(BudgetLabReadSurface, { ...callbacks, state: { status: "error", message: "Kaynak güvenli değil." } }));
    const empty = renderToStaticMarkup(createElement(BudgetLabReadSurface, { ...callbacks, state: { status: "ready", result: { contractVersion: "budget-lab-read-model/1.0.0", view: "list", items: [], nextCursor: null, authority: { canDraft: false, canApprove: false, canExecute: false, canWriteMeta: false } }, selected: null } }));
    expect(unavailable).toContain("Kaynak henüz bağlı değil");
    expect(unavailable).toContain("Demo bütçe kayıtları canlı sonuç gibi gösterilmez");
    expect(error).toContain("Budget Lab okunamadı");
    expect(empty).toContain("Kaynak bağlı · öneri yok");
    expect(empty).toContain("fixture veya demo fallback değildir");
  });

  it("renders read-only boundaries before any source result", () => {
    const html = renderToStaticMarkup(createElement(BudgetLabReadSurface, { ...callbacks, state: { status: "loading" } }));
    expect(html).toContain("READ ONLY · AUTHORITY NONE");
    expect(html).toContain("onaylamaz, execute etmez ve Meta’ya yazmaz");
    expect(html).not.toContain("Onayla");
  });
});
