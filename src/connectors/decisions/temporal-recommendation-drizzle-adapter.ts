import type { TemporalRecommendationPort } from "@/application/temporal-recommendation-service";
import { verifyDecisionLedger, type DecisionLedger } from "@/domain/decisions/ledger";
import type { DecisionLedgerSuffixRepository } from "./decision-room-drizzle-adapter";

/** Binds the temporal evaluator to the same server-private append-only decision ledger. */
export class TemporalRecommendationDrizzleAdapter implements TemporalRecommendationPort {
  constructor(
    private readonly repository: DecisionLedgerSuffixRepository,
    private readonly binding: Readonly<{ workspaceId: string; workspaceRef: string }>,
  ) {
    if (!binding.workspaceId.trim() || !binding.workspaceRef.trim()) throw new Error("Temporal recommendation invalid binding");
  }

  async readLedger(input: Readonly<{ workspaceRef: string }>): Promise<DecisionLedger> {
    if (input.workspaceRef !== this.binding.workspaceRef) throw new Error("Temporal recommendation workspace scope mismatch");
    const ledger = await this.repository.load(this.binding.workspaceId);
    if (!verifyDecisionLedger(ledger) || ledger.some((record) => record.workspaceRef !== input.workspaceRef)) {
      throw new Error("Temporal recommendation corrupt ledger");
    }
    return ledger;
  }

  async appendSuffix(input: Readonly<{ workspaceRef: string; expectedHeadHash: string; ledger: DecisionLedger }>): Promise<void> {
    if (input.workspaceRef !== this.binding.workspaceRef || !verifyDecisionLedger(input.ledger)) {
      throw new Error("Temporal recommendation invalid ledger suffix");
    }
    const stored = await this.repository.appendSuffix({ workspaceId: this.binding.workspaceId,
      workspaceRef: this.binding.workspaceRef, expectedHeadHash: input.expectedHeadHash, ledger: input.ledger });
    if (!verifyDecisionLedger(stored) || JSON.stringify(stored) !== JSON.stringify(input.ledger)) {
      throw new Error("Temporal recommendation persistence failure");
    }
  }
}
