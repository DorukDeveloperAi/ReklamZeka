import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { operationalTimelineFromResponse } from "@/app/dashboard/operational-timeline-panel";

const authority = { readOnly: true, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false } as const;
const temporal = { kind: "temporal_evaluation", occurredAt: "2026-08-13T12:00:00.000Z", title: "Zamansal kural değerlendirmesi kaydedildi",
  detail: "Öneri üretildi · window ready · uygulama yetkisi yok" } as const;
const preparation = { kind: "action_preparation", occurredAt: "2026-08-13T12:00:00.000Z", title: "Seçilen tahsis için ActionUnit hazırlandı",
  detail: "budget increase · K3 · insan onayı bekliyor · Meta uygulaması kapalı" } as const;

describe("operational timeline panel contract", () => {
  it("renders temporal evaluation only from the canonical authority-closed feed", () => {
    expect(operationalTimelineFromResponse({ contractVersion: "operational-timeline/1.0.0", items: [temporal], authority }))
      .toMatchObject({ items: [expect.objectContaining({ kind: "temporal_evaluation" })], authority });
  });
  it("admits the selected-allocation to ActionUnit preparation trace but no new authority", () => {
    expect(operationalTimelineFromResponse({ contractVersion: "operational-timeline/1.0.0", items: [preparation], authority }))
      .toMatchObject({ items: [expect.objectContaining({ kind: "action_preparation" })], authority });
  });
  it("fails closed for private material, extra fields, authority changes, and unordered events", () => {
    const base = { contractVersion: "operational-timeline/1.0.0", items: [temporal], authority };
    expect(operationalTimelineFromResponse({ ...base, items: [{ ...temporal, detail: `${temporal.detail} · ${"a".repeat(64)}` }] })).toBeNull();
    expect(operationalTimelineFromResponse({ ...base, items: [{ ...temporal, privateRef: "x" }] })).toBeNull();
    expect(operationalTimelineFromResponse({ ...base, authority: { ...authority, canExecute: true } })).toBeNull();
    expect(operationalTimelineFromResponse({ ...base, items: [temporal, { ...temporal, occurredAt: "2026-08-14T12:00:00.000Z" }] })).toBeNull();
  });
  it("does not request or render a second temporal feed", () => {
    const source = readFileSync("src/app/dashboard/operational-timeline-panel.tsx", "utf8");
    expect(source).not.toContain("/api/temporal-recommendations");
    expect(source).not.toContain("TemporalRecord");
  });
});
