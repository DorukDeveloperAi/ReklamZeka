import { createHash } from "node:crypto";

import type { InstructionPolicyOperation } from "@/domain/policies/instruction-policy-dsl";

export const INSTRUCTION_POLICY_NORMALIZATION_VERSION = "instruction-policy-normalization/1.0.0" as const;

export type NormalizationIntent = "prohibit_operation" | "require_approval" | "protect_budget" | "prefer_option";
export type NormalizationScope = "global" | "specific";

export type NormalizationAnswers = Readonly<{
  intent: NormalizationIntent | null;
  scope: NormalizationScope | null;
  scopeRef: string | null;
  operation: InstructionPolicyOperation | null;
  budgetPoolRef: string | null;
  preferenceSubjectRef: string | null;
  preferredRefs: readonly string[];
}>;

export type NormalizationQuestion = Readonly<{
  questionRef: string;
  prompt: string;
  field: keyof NormalizationAnswers;
}>;

export type NormalizedOwnerInstruction = Readonly<{
  contractVersion: typeof INSTRUCTION_POLICY_NORMALIZATION_VERSION;
  status: "needs_input" | "ready_for_draft";
  answers: NormalizationAnswers;
  questions: readonly NormalizationQuestion[];
  clauses: readonly Readonly<{
    clauseRef: string;
    kind: "prohibition" | "approval" | "budget_protection" | "preference";
    summary: string;
  }> [];
  authority: Readonly<{
    canPublish: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canSchedule: false;
    canCallTool: false;
    canAccessNetwork: false;
  }>;
  normalizationHash: string;
}>;

export class InstructionPolicyNormalizationError extends Error {
  constructor(readonly code: "invalid_input") {
    super("Talimat normalizasyon girdisi güvenli biçimde işlenemedi");
    this.name = "InstructionPolicyNormalizationError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const OPERATIONS = new Set<InstructionPolicyOperation>([
  "status_pause", "status_activate", "budget_decrease", "budget_increase", "budget_transfer", "existing_post_promotion",
]);
const INTENTS = new Set<NormalizationIntent>(["prohibit_operation", "require_approval", "protect_budget", "prefer_option"]);
const AUTHORITY = Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canSchedule: false as const, canCallTool: false as const, canAccessNetwork: false as const });

function fail(): never { throw new InstructionPolicyNormalizationError("invalid_input"); }
function ref(value: unknown): string { if (typeof value !== "string" || !REF.test(value)) fail(); return value; }
function nullableRef(value: unknown): string | null { return value === null ? null : ref(value); }
function exact(value: unknown): asserts value is Record<string, unknown> {
  const keys = ["intent", "scope", "scopeRef", "operation", "budgetPoolRef", "preferenceSubjectRef", "preferredRefs"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) fail();
}
function stable(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") fail();
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, stable(entry)]));
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

export function normalizeInstructionAnswers(value: unknown): NormalizationAnswers {
  exact(value);
  const intent = value.intent === null ? null : typeof value.intent === "string" && INTENTS.has(value.intent as NormalizationIntent)
    ? value.intent as NormalizationIntent : fail();
  const scope = value.scope === null ? null : value.scope === "global" || value.scope === "specific" ? value.scope : fail();
  const scopeRef = nullableRef(value.scopeRef);
  const operation = value.operation === null ? null : typeof value.operation === "string" && OPERATIONS.has(value.operation as InstructionPolicyOperation)
    ? value.operation as InstructionPolicyOperation : fail();
  const budgetPoolRef = nullableRef(value.budgetPoolRef);
  const preferenceSubjectRef = nullableRef(value.preferenceSubjectRef);
  if (!Array.isArray(value.preferredRefs) || value.preferredRefs.length > 20) fail();
  const preferredRefs = Object.freeze(value.preferredRefs.map(ref).sort());
  if (new Set(preferredRefs).size !== preferredRefs.length) fail();
  if (scope === "global" && scopeRef !== null || scope === "specific" && scopeRef === null) fail();
  return Object.freeze({ intent, scope, scopeRef, operation, budgetPoolRef, preferenceSubjectRef, preferredRefs });
}

function question(questionRef: string, prompt: string, field: keyof NormalizationAnswers): NormalizationQuestion {
  return Object.freeze({ questionRef, prompt, field });
}

export function createInstructionPolicyNormalization(value: unknown): NormalizedOwnerInstruction {
  const answers = normalizeInstructionAnswers(value);
  const questions: NormalizationQuestion[] = [];
  if (answers.intent === null) questions.push(question("question_intent", "Bu talimat hangi bağlayıcı niyeti ifade ediyor?", "intent"));
  if (answers.scope === null) questions.push(question("question_scope", "Talimat tüm çalışma alanına mı, belirli bir kapsama mı uygulanır?", "scope"));
  if (answers.intent === "prohibit_operation" || answers.intent === "require_approval") {
    if (answers.operation === null) questions.push(question("question_operation", "Hangi operasyon kapsama giriyor?", "operation"));
  }
  if (answers.intent === "protect_budget" && answers.budgetPoolRef === null) {
    questions.push(question("question_budget_pool", "Hangi bütçe havuzu korunmalı?", "budgetPoolRef"));
  }
  if (answers.intent === "prefer_option" && answers.preferenceSubjectRef === null) {
    questions.push(question("question_preference_subject", "Tercih hangi konu/varlık için geçerli?", "preferenceSubjectRef"));
  }
  if (answers.intent === "prefer_option" && answers.preferredRefs.length === 0) {
    questions.push(question("question_preferred_options", "Hangi seçenekler tercih edilmeli?", "preferredRefs"));
  }
  const clauses = questions.length ? [] : answers.intent === "prohibit_operation"
    ? [Object.freeze({ clauseRef: "clause_prohibition", kind: "prohibition" as const,
      summary: `${answers.operation} operasyonu yasaklanır.` })]
    : answers.intent === "require_approval"
      ? [Object.freeze({ clauseRef: "clause_approval", kind: "approval" as const,
        summary: `${answers.operation} operasyonu için insan onayı gerekir.` })]
      : answers.intent === "protect_budget"
        ? [Object.freeze({ clauseRef: "clause_budget_protection", kind: "budget_protection" as const,
          summary: `${answers.budgetPoolRef} bütçe havuzu dışarı aktarıma kapatılır.` })]
        : [Object.freeze({ clauseRef: "clause_preference", kind: "preference" as const,
          summary: `${answers.preferenceSubjectRef} için seçilen seçenekler tercih edilir.` })];
  const core = { contractVersion: INSTRUCTION_POLICY_NORMALIZATION_VERSION, status: questions.length ? "needs_input" as const : "ready_for_draft" as const,
    answers, questions: Object.freeze(questions), clauses: Object.freeze(clauses), authority: AUTHORITY };
  return Object.freeze({ ...core, normalizationHash: digest(core) });
}
