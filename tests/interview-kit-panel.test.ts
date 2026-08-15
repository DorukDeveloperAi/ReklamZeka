import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseInterviewKitSnapshot } from "@/app/dashboard/interview-kit-panel";

const authority = { canPersist: false, canCreateRule: false, canDraftPolicy: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false };
const source = { optionId: "source_option_meta_docs", title: "Meta resmi kaynak", url: "https://developers.facebook.com/docs/marketing-apis", freshness: "fresh" };
const kit = { kitRef: "interview_kit_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", revision: 1, state: "active", name: "Kapsam denetimi", explanation: "Eksikleri görünür kılar.", questions: ["Kapsam kanıtı yeterli mi?"], applicability: { pages: ["agent"], intents: ["question"] }, source };

describe("Interview Kit panel", () => {
  it("accepts only a closed-authority, source-bound public snapshot", () => {
    expect(parseInterviewKitSnapshot({ contractVersion: "orchestrator-interview-kit/1.0.0", kits: [kit], sources: [source], authority })).toMatchObject({ kits: [{ name: "Kapsam denetimi" }], authority });
    expect(parseInterviewKitSnapshot({ contractVersion: "orchestrator-interview-kit/1.0.0", kits: [kit], sources: [source], authority: { ...authority, canDraftPolicy: true } })).toBeNull();
    expect(parseInterviewKitSnapshot({ contractVersion: "orchestrator-interview-kit/1.0.0", kits: [{ ...kit, source: { ...source, url: "http://example.invalid" } }], sources: [source], authority })).toBeNull();
  });

  it("keeps create, revision, and archive user-confirmed and rule-free", () => {
    const panel = readFileSync("src/app/dashboard/interview-kit-panel.tsx", "utf8");
    expect(panel).toContain('"interview-kit-revise"');
    expect(panel).toContain('"interview-kit-archive"');
    expect(panel).toContain("Mevcut set değişmez");
    expect(panel).toContain("Agent bunları rule metnine dönüştürmez");
    expect(panel).toContain("Kural, policy, onay, action veya Meta write yetkisi vermez");
  });
});
