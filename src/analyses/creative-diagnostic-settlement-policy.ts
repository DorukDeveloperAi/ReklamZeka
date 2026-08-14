import { createHash } from "node:crypto";

export const CREATIVE_DIAGNOSTIC_SETTLEMENT_POLICY_VERSION = "creative-diagnostic-settlement-policy/1.0.0" as const;

export type CreativeDiagnosticSettlementPolicy = Readonly<{
  contractVersion: typeof CREATIVE_DIAGNOSTIC_SETTLEMENT_POLICY_VERSION;
  policyRef: string;
  revision: number;
  previousHash: string | null;
  state: "draft" | "published" | "retired";
  settlementLagDays: number;
  policyHash: string;
}>;

export class CreativeDiagnosticSettlementPolicyError extends Error {
  constructor(message: string) { super(message); this.name = "CreativeDiagnosticSettlementPolicyError"; }
}

const REF = /^creative_settlement_[a-f0-9]{24}$/;
const HASH = /^[a-f0-9]{64}$/;
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

export function createCreativeDiagnosticSettlementPolicy(input: Readonly<{
  policyRef: string; revision: number; previousHash: string | null; state: "draft" | "published" | "retired"; settlementLagDays: number;
}>): CreativeDiagnosticSettlementPolicy {
  if (!input || Object.keys(input).sort().join(",") !== "policyRef,previousHash,revision,settlementLagDays,state") {
    throw new CreativeDiagnosticSettlementPolicyError("policy exact shape olmalıdır");
  }
  if (!REF.test(input.policyRef) || !Number.isSafeInteger(input.revision) || input.revision < 1
    || !["draft", "published", "retired"].includes(input.state)
    || (input.previousHash !== null && !HASH.test(input.previousHash))
    || !Number.isSafeInteger(input.settlementLagDays) || input.settlementLagDays < 0 || input.settlementLagDays > 90) {
    throw new CreativeDiagnosticSettlementPolicyError("policy kimliği veya settlement lag geçersizdir");
  }
  const core = Object.freeze({ contractVersion: CREATIVE_DIAGNOSTIC_SETTLEMENT_POLICY_VERSION,
    policyRef: input.policyRef, revision: input.revision, previousHash: input.previousHash,
    state: input.state, settlementLagDays: input.settlementLagDays });
  return Object.freeze({ ...core, policyHash: digest(core) });
}

/** Returns the last eligible calendar day without inventing a timezone or a default lag. */
export function settledThroughDate(policy: CreativeDiagnosticSettlementPolicy, evaluatedAt: string, timezone: string): string {
  if (policy.state !== "published") throw new CreativeDiagnosticSettlementPolicyError("published policy zorunludur");
  if (typeof evaluatedAt !== "string" || !Number.isFinite(Date.parse(evaluatedAt)) || new Date(evaluatedAt).toISOString() !== evaluatedAt) {
    throw new CreativeDiagnosticSettlementPolicyError("evaluatedAt canonical ISO olmalıdır");
  }
  if (typeof timezone !== "string" || !timezone.trim()) throw new CreativeDiagnosticSettlementPolicyError("timezone zorunludur");
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(evaluatedAt));
  } catch { throw new CreativeDiagnosticSettlementPolicyError("timezone geçersizdir"); }
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new CreativeDiagnosticSettlementPolicyError("timezone tarihi çözülemedi");
  const result = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() - policy.settlementLagDays);
  return result.toISOString().slice(0, 10);
}
