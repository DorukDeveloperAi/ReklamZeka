import { describe, expect, it } from "vitest";
import { canonicalOrchestratorFacilitationResponse, parseOrchestratorFacilitationResponse,
  ORCHESTRATOR_FACILITATION_RESPONSE_VERSION } from "@/application/orchestrator-facilitation-response";

function response(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ version: ORCHESTRATOR_FACILITATION_RESPONSE_VERSION, summary: "Veri kapsamı kısmi.",
    evidence: ["Yedi günlük kapsama kısmi görünüyor."], gaps: ["Eşdeğer kohort bilgisi yok."],
    questions: ["Kıyas kapsamını kullanıcı belirlemek ister mi?"], risks: ["Yetersiz veri yanlış kıyas riskini artırır."],
    uncertainty: ["Sonucun nedeni bu kanıtla belirlenemez."], ...overrides });
}

describe("Orchestrator facilitation response envelope", () => {
  it("accepts only the versioned exact shape and renders a canonical durable message", () => {
    const parsed = parseOrchestratorFacilitationResponse(response());
    expect(parsed.version).toBe(ORCHESTRATOR_FACILITATION_RESPONSE_VERSION);
    expect(canonicalOrchestratorFacilitationResponse(response())).toBe([
      "Veri kapsamı kısmi.", "", "Kanıt:", "- Yedi günlük kapsama kısmi görünüyor.", "", "Eksikler:",
      "- Eşdeğer kohort bilgisi yok.", "", "Sorular:", "- Kıyas kapsamını kullanıcı belirlemek ister mi?", "", "Riskler:",
      "- Yetersiz veri yanlış kıyas riskini artırır.", "", "Belirsizlik:", "- Sonucun nedeni bu kanıtla belirlenemez.",
    ].join("\n"));
  });

  it("rejects prose, extra fields, malformed questions, and rule/policy/action/DSL-like text", () => {
    expect(() => parseOrchestratorFacilitationResponse("Sadece metin")).toThrow();
    expect(() => parseOrchestratorFacilitationResponse(response({ extra: true }))).toThrow();
    expect(() => parseOrchestratorFacilitationResponse(response({ questions: ["Kapsam belirsiz."] }))).toThrow();
    expect(() => parseOrchestratorFacilitationResponse(response({ summary: "Kural: bütçeyi artır" }))).toThrow();
    expect(() => parseOrchestratorFacilitationResponse(response({ risks: ["Eğer sonuç düşerse bütçeyi azalt."] }))).toThrow();
  });
});
