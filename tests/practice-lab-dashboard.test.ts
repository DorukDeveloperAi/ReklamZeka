import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PracticeLabReadSurface } from "@/app/dashboard/practice-lab-panel";
import type { PracticeLabDetail } from "@/application/practice-lab-read-service";

const callbacks = { onRetry: vi.fn(), onSelect: vi.fn(), onPrepareDraft: vi.fn() };

describe("Practice Lab dashboard", () => {
  it("distinguishes session, unavailable, error, and real empty states", () => {
    const sessionRequired = renderToStaticMarkup(createElement(PracticeLabReadSurface, {
      ...callbacks, onConnect: vi.fn(async () => false),
      state: { status: "session_required", message: "Yerel oturum gerekli." },
    }));
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
    expect(unavailable).toContain("kaynağı yapılandırılana kadar");
    expect(sessionRequired).toContain("Practice çalışma alanını bağlayın");
    expect(sessionRequired).toContain("local-session-capability");
    expect(error).toContain("Practice Lab okunamadı");
    expect(empty).toContain("Kaynak bağlı · practice yok");
    expect(empty).toContain("Kaynak başarıyla okundu");
    expect(empty).not.toMatch(/demo|fixture/i);
    expect(empty).not.toContain("Yerel oturum gerekli");
  });

  it("renders authority boundaries before any record is selected", () => {
    const html = renderToStaticMarkup(createElement(PracticeLabReadSurface, {
      ...callbacks, state: { status: "loading" },
    }));
    expect(html).toContain("ADVISORY ONLY · GUARDED EVENTS");
    expect(html).toContain("guidance, policy, otomasyon veya eylem üretmez");
    expect(html).not.toContain("Onayla");
  });

  it("renders standardized-candidate confirmation as an explicit human-gated action", () => {
    const authority = { advisoryOnly: true, canPersistDraft: false, canCreateGuidance: false,
      canPromotePolicy: false, canEnableAutomation: false, canAuthorizeAction: false, canExecuteWrite: false } as const;
    const item: PracticeLabDetail = { practiceRef: "practice_safe", version: 1, problem: "Güvenli yöntemi doğrula",
      confidence: 0.8, state: "standardization_candidate", outcomeStatus: "validated",
      standardizationReviewStatus: "reviewed", standardizationStatus: "candidate", updatedAt: "2026-08-09T00:00:00.000Z",
      revision: { definitionVersion: 1, lastSequence: 7, revisionRef: `practice_revision_${"a".repeat(64)}` },
      scope: { kind: "bounded", objectives: [], internalCategories: ["category_safe"], topics: [], accountCount: 1, entityCount: 0 },
      sources: { ownerStatementPresent: true, officialMetaSourceCount: 1, evidenceCount: 2, alignment: "aligned" }, authority,
      requiredInputs: ["metric_cost"], steps: ["Kontrol et"], rationale: "Kanıt gerekli", cadence: "Yedi gün", exceptions: [],
      sourceReview: { ownerCapturedAt: "2026-08-01T00:00:00.000Z", officialMetaSources: [{ host: "facebook.com",
        capturedAt: "2026-08-01T00:00:00.000Z", reviewedAt: "2026-08-02T00:00:00.000Z", reviewBy: "2026-12-01T00:00:00.000Z" }],
        deliberation: { alignment: "aligned", rationale: "Uyumlu", conflictCount: 0 } },
      timeline: [{ sequence: 7, eventType: "standardization_candidate", occurredAt: "2026-08-09T00:00:00.000Z",
        stateAfter: "standardization_candidate", note: "İnsan teyidine hazır", evidenceCount: 0 }] };
    const html = renderToStaticMarkup(createElement(PracticeLabReadSurface, { ...callbacks, onMutate: vi.fn(),
      state: { status: "ready", result: { contractVersion: "practice-lab-read-model/1.0.0", view: "list",
        items: [item], nextCursor: null, authority }, selected: item, draft: null } }));
    expect(html).toContain("HUMAN-GATED STANDARDIZATION");
    expect(html).toContain("İnsan kararıyla standardize et");
    expect(html).toContain("yalnız owner/admin oturumunda kabul edilir");
  });
});
