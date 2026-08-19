/**
 * The provider is untrusted.  This narrow envelope is the only provider output
 * that may become an assistant message in the durable conversation ledger.
 * It deliberately has no field capable of carrying a user-authored rule,
 * policy, action unit, or DSL.
 */
export const ORCHESTRATOR_FACILITATION_RESPONSE_VERSION = "orchestrator-facilitation-response/1.0.0" as const;

export type OrchestratorFacilitationResponse = Readonly<{
  version: typeof ORCHESTRATOR_FACILITATION_RESPONSE_VERSION;
  summary: string;
  evidence: readonly string[];
  gaps: readonly string[];
  questions: readonly string[];
  risks: readonly string[];
  uncertainty: readonly string[];
}>;

export class OrchestratorFacilitationResponseError extends Error {
  constructor() { super("invalid_orchestrator_facilitation_response"); this.name = "OrchestratorFacilitationResponseError"; }
}

const EXPECTED_KEYS = "evidence|gaps|questions|risks|summary|uncertainty|version";
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// These are syntax or imperative markers, rather than ordinary discussion of
// a risk.  A facilitator may say that an approval is missing, but may never
// carry an instruction that could be replayed as a policy or action.
const FORBIDDEN_CONTENT = /```|[{};]|\b(?:kural|rule|policy|bağlayıcı\s+talimat|binding\s+instruction|action(?:\s*unit)?|dsl)\b|\b(?:eğer|if)\b[^.?!]{0,240}\b(?:ise|then)\b|\b(?:uygula|yayımla|onayla|bütçeyi?\s+(?:artır|azalt|değiştir)|(?:kampanyayı?|reklam\s+setini?)\s*(?:aç|kapat))\b|\b\d{1,3}(?:[.,]\d+)?\s*(?:tl|try|usd|eur|₺|%)\b/i;

function fail(): never { throw new OrchestratorFacilitationResponseError(); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, minimum = 1): string {
  if (typeof value !== "string") fail();
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > 1_200 || CONTROL.test(normalized) || FORBIDDEN_CONTENT.test(normalized)) fail();
  if (label === "question" && !/[?？]$/.test(normalized)) fail();
  return normalized;
}
function list(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 8) fail();
  return Object.freeze(value.map((item) => text(item, label)));
}

/** Parses the exact JSON contract. Any prose, extra field or executable-ish text fails closed. */
export function parseOrchestratorFacilitationResponse(value: unknown): OrchestratorFacilitationResponse {
  if (typeof value !== "string" || value.length < 2 || value.length > 16_000) fail();
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { fail(); }
  const input = record(parsed);
  if (Object.keys(input).sort().join("|") !== EXPECTED_KEYS || input.version !== ORCHESTRATOR_FACILITATION_RESPONSE_VERSION) fail();
  return Object.freeze({ version: ORCHESTRATOR_FACILITATION_RESPONSE_VERSION,
    summary: text(input.summary, "summary"), evidence: list(input.evidence, "evidence"), gaps: list(input.gaps, "gap"),
    questions: list(input.questions, "question"), risks: list(input.risks, "risk"), uncertainty: list(input.uncertainty, "uncertainty") });
}

/** Canonical, human-readable projection; only this string is persisted as assistant content. */
export function renderOrchestratorFacilitationResponse(response: OrchestratorFacilitationResponse): string {
  const sections: readonly [string, readonly string[]][] = [
    ["Kanıt", response.evidence], ["Eksikler", response.gaps], ["Sorular", response.questions],
    ["Riskler", response.risks], ["Belirsizlik", response.uncertainty],
  ];
  return [response.summary, ...sections.flatMap(([label, entries]) => entries.length === 0 ? [] : ["", `${label}:`, ...entries.map((entry) => `- ${entry}`)])].join("\n");
}

export function canonicalOrchestratorFacilitationResponse(value: unknown): string {
  return renderOrchestratorFacilitationResponse(parseOrchestratorFacilitationResponse(value));
}
