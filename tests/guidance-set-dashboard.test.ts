import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GuidanceSetStudio, moveGuidanceSetCard,
  parseGuidanceStudioSnapshot } from "@/app/dashboard/guidance-studio-panel";

const cardRef = `guidance_${"a".repeat(24)}`;
const setRef = `guidance_set_${"b".repeat(24)}`;
const snapshot = {
  contractVersion: "guidance-studio/1.3.0",
  registryHash: "c".repeat(64),
  items: [{ cardRef, version: 3, title: "Bütçeyi koru", body: "Bölgesel bütçeyi koru.",
    strength: "must", topic: "budget", status: "published", sources: [{ type: "owner_statement",
      ref: "owner_statement_budget", url: null, capturedAt: "2026-08-09T18:00:00.000Z",
      reviewedAt: null, reviewBy: null }], scopes: [{ facet: "global",
      value: null, entityType: null, mode: "default", priority: 80 }], updatedAt: null }],
  sets: [{ setRef, version: 2, name: "Bütçe sırası", reviewStatus: "draft",
    orderedCards: [{ cardRef, title: "Bütçeyi koru", version: 3, status: "published" }] }],
  categories: [],
  authority: { canDraft: true, canPublish: true, canReview: true, canArchive: true,
    canWriteMeta: false, canAuthorizeAction: false, canEnforcePolicy: false },
} as const;

describe("Guidance set dashboard", () => {
  it("exposes the complete facet and provenance selectors without action authority", () => {
    const source = readFileSync("src/app/dashboard/guidance-studio-panel.tsx", "utf8");
    for (const label of ["Hesap grubu", "Funnel aşaması", "Optimizasyon olayı", "Yaşam döngüsü",
      "Promotion template", "Resmî Meta kaynağı", "İş stratejisi", "Gözlemlenen sonuç",
      "Deney sonucu", "Operasyon notu"]) expect(source).toContain(label);
    expect(source).toContain("selected.sources.map");
    expect(source).not.toMatch(/canWriteMeta:\s*true|canAuthorizeAction:\s*true|canEnforcePolicy:\s*true/);
  });

  it("accepts only the no-authority set contract and preserves ordered card movement", () => {
    expect(parseGuidanceStudioSnapshot(snapshot).sets[0]).toMatchObject({ setRef, reviewStatus: "draft" });
    expect(moveGuidanceSetCard(["first", "second", "third"], "second", -1))
      .toEqual(["second", "first", "third"]);
    expect(moveGuidanceSetCard(["first", "second"], "first", -1)).toEqual(["first", "second"]);
    expect(() => parseGuidanceStudioSnapshot({ ...snapshot,
      authority: { ...snapshot.authority, canAuthorizeAction: true } })).toThrow("güvenli sözleşmeyi");
  });

  it("shows owner review/archive authoring while keeping action and Meta authority absent", () => {
    const html = renderToStaticMarkup(createElement(GuidanceSetStudio, {
      snapshot: parseGuidanceStudioSnapshot(snapshot), onRefresh: vi.fn(async () => undefined),
    }));
    expect(html).toContain("SIRALI GUIDANCE SETLERİ");
    expect(html).toContain("Bütçe sırası");
    expect(html).toContain("İncelendi olarak işaretle");
    expect(html).toContain("Set action, approval veya Meta write yetkisi taşımaz");
    expect(html).not.toContain("Meta&#x27;ya yaz");
  });

  it("renders the same set read-only for a viewer", () => {
    const viewer = parseGuidanceStudioSnapshot({ ...snapshot, authority: { ...snapshot.authority,
      canDraft: false, canPublish: false, canReview: false, canArchive: false } });
    const html = renderToStaticMarkup(createElement(GuidanceSetStudio,
      { snapshot: viewer, onRefresh: vi.fn(async () => undefined) }));
    expect(html).toContain("Bütçe sırası");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>İncelendi olarak işaretle<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Arşivle<\/button>/);
  });
});
