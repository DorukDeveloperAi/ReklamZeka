import {
  createCreativeDiagnosticSettlementPolicy,
  type CreativeDiagnosticSettlementPolicy,
  CreativeDiagnosticSettlementPolicyError,
} from "@/analyses/creative-diagnostic-settlement-policy";

export class CreativeDiagnosticSettlementPolicyLifecycleError extends Error {
  constructor(readonly code: "invalid_transition" | "revision_conflict") {
    super(`Creative diagnostic settlement policy lifecycle rejected: ${code}`);
    this.name = "CreativeDiagnosticSettlementPolicyLifecycleError";
  }
}

/** Pure transition gate for the private append-only settlement-policy writer. */
export function advanceCreativeDiagnosticSettlementPolicy(input: Readonly<{
  previous: CreativeDiagnosticSettlementPolicy | null;
  next: Omit<CreativeDiagnosticSettlementPolicy, "contractVersion" | "policyHash">;
}>): CreativeDiagnosticSettlementPolicy {
  const previous = input.previous;
  if (previous && input.next.policyRef !== previous.policyRef) {
    throw new CreativeDiagnosticSettlementPolicyLifecycleError("revision_conflict");
  }
  if (input.next.revision !== (previous?.revision ?? 0) + 1 || input.next.previousHash !== (previous?.policyHash ?? null)) {
    throw new CreativeDiagnosticSettlementPolicyLifecycleError("revision_conflict");
  }
  if (previous?.state === "retired" || (previous?.state === "published" && input.next.state === "draft")) {
    throw new CreativeDiagnosticSettlementPolicyLifecycleError("invalid_transition");
  }
  try { return createCreativeDiagnosticSettlementPolicy(input.next); }
  catch (error) {
    if (error instanceof CreativeDiagnosticSettlementPolicyError) throw error;
    throw error;
  }
}
