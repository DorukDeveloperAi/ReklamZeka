import { createCreativeDiagnosticDefinition, type CreativeDiagnosticDefinition, CreativeDiagnosticDefinitionError } from "@/analyses/creative-diagnostic-definition";

export class CreativeDiagnosticDefinitionLifecycleError extends Error {
  constructor(readonly code: "invalid_transition" | "revision_conflict") { super(`Creative diagnostic definition lifecycle rejected: ${code}`); this.name = "CreativeDiagnosticDefinitionLifecycleError"; }
}

/** Pure transition gate used by the private repository before append-only insert. */
export function advanceCreativeDiagnosticDefinition(input: Readonly<{
  previous: CreativeDiagnosticDefinition | null;
  next: Omit<CreativeDiagnosticDefinition, "contractVersion" | "definitionHash">;
}>): CreativeDiagnosticDefinition {
  const previous = input.previous;
  if (previous && input.next.definitionRef !== previous.definitionRef) throw new CreativeDiagnosticDefinitionLifecycleError("revision_conflict");
  if (input.next.revision !== (previous?.revision ?? 0) + 1 || input.next.previousHash !== (previous?.definitionHash ?? null)) throw new CreativeDiagnosticDefinitionLifecycleError("revision_conflict");
  if (previous?.state === "retired" || (previous?.state === "published" && input.next.state === "draft")) throw new CreativeDiagnosticDefinitionLifecycleError("invalid_transition");
  try { return createCreativeDiagnosticDefinition(input.next); } catch (error) { if (error instanceof CreativeDiagnosticDefinitionError) throw error; throw error; }
}
