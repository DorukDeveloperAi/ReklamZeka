import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sources = [
  "src/app/dashboard/operating-dashboard.tsx",
  "src/app/dashboard/canonical-campaign-portfolio-panel.tsx",
  "src/app/dashboard/instruction-policy-studio-panel.tsx",
  "src/app/dashboard/practice-lab-panel.tsx",
].map((path) => readFileSync(path, "utf8")).join("\n");

describe("dashboard user-facing language", () => {
  it("removes the audited technical-English shell and recovery phrases", () => {
    for (const phrase of [
      "Strict policy Studio kullanılamıyor",
      "Strict policy registry yükleniyor",
      "Practice çalışma alanını bağlayın",
      "ADVISORY ONLY · GUARDED EVENTS",
      "CANONICAL META PORTFÖYÜ",
      "CANONICAL CAMPAIGN CONTEXT",
      "Agent ile aç",
      "Draft-only",
      "Human-gated",
      "GET-only connector",
      "delivery health alert ledger",
    ]) expect(sources, phrase).not.toContain(phrase);
  });

  it("keeps the same capability limits in plain user language", () => {
    for (const phrase of [
      "Bağlayıcı politika alanı kullanılamıyor",
      "Öğrenim çalışma alanını bağlayın",
      "KANONİK META PORTFÖYÜ",
      "Asistanla aç",
      "Yalnız taslak",
      "İnsan onaylı",
      "Yalnız okuma",
      "Meta değişikliği yok",
    ]) expect(sources, phrase).toContain(phrase);
  });
});
