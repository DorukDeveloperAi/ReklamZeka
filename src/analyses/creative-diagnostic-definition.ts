import { createHash } from "node:crypto";

export const CREATIVE_DIAGNOSTIC_DEFINITION_VERSION = "creative-diagnostic-definition/1.0.0" as const;
export type CreativeDiagnosticDefinition = Readonly<{
  contractVersion: typeof CREATIVE_DIAGNOSTIC_DEFINITION_VERSION;
  definitionRef: string;
  revision: number;
  previousHash: string | null;
  state: "draft" | "published" | "retired";
  minimumImpressions: number;
  minimumFrequencyIncreaseFraction: number;
  minimumCtrDeclineFraction: number;
  maximumCoverageGapDays: number;
  definitionHash: string;
}>;
export class CreativeDiagnosticDefinitionError extends Error {
  constructor(message: string) { super(message); this.name = "CreativeDiagnosticDefinitionError"; }
}
const REF = /^creative_definition_[a-f0-9]{24}$/; const HASH = /^[a-f0-9]{64}$/;
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function positive(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new CreativeDiagnosticDefinitionError(`${label} pozitif sonlu sayı olmalıdır`); return value; }

export function createCreativeDiagnosticDefinition(input: Readonly<{
  definitionRef: string; revision: number; previousHash: string | null; state: "draft" | "published" | "retired";
  minimumImpressions: number; minimumFrequencyIncreaseFraction: number; minimumCtrDeclineFraction: number; maximumCoverageGapDays: number;
}>): CreativeDiagnosticDefinition {
  if (!input || Object.keys(input).sort().join(",") !== "definitionRef,maximumCoverageGapDays,minimumCtrDeclineFraction,minimumFrequencyIncreaseFraction,minimumImpressions,previousHash,revision,state") throw new CreativeDiagnosticDefinitionError("definition exact shape olmalıdır");
  if (!REF.test(input.definitionRef) || !Number.isSafeInteger(input.revision) || input.revision < 1 || !["draft", "published", "retired"].includes(input.state) || (input.previousHash !== null && !HASH.test(input.previousHash))) throw new CreativeDiagnosticDefinitionError("definition kimliği geçersizdir");
  if (!Number.isSafeInteger(input.maximumCoverageGapDays) || input.maximumCoverageGapDays < 0 || input.maximumCoverageGapDays > 31) throw new CreativeDiagnosticDefinitionError("maximumCoverageGapDays 0–31 aralığında olmalıdır");
  const core = Object.freeze({ contractVersion: CREATIVE_DIAGNOSTIC_DEFINITION_VERSION, definitionRef: input.definitionRef, revision: input.revision, previousHash: input.previousHash, state: input.state, minimumImpressions: positive(input.minimumImpressions, "minimumImpressions"), minimumFrequencyIncreaseFraction: positive(input.minimumFrequencyIncreaseFraction, "minimumFrequencyIncreaseFraction"), minimumCtrDeclineFraction: positive(input.minimumCtrDeclineFraction, "minimumCtrDeclineFraction"), maximumCoverageGapDays: input.maximumCoverageGapDays });
  return Object.freeze({ ...core, definitionHash: digest(core) });
}
