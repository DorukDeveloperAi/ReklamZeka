import type { BudgetProposalInput, BudgetFrozenContextPort, BudgetProposal } from "@/application/budget-proposal-service";
import { BudgetProposalService } from "@/application/budget-proposal-service";
import { projectBudgetProposal, type PublicBudgetProposal } from "@/connectors/budget/budget-proposal-drizzle-repository";

export type BudgetLabDraftCommand = Readonly<Omit<BudgetProposalInput, "scope"> & {
  scope: Readonly<Omit<BudgetProposalInput["scope"], "workspaceId">>;
}>;

export interface BudgetDraftPersistencePort {
  appendDraft(input: Readonly<{ proposal: BudgetProposal; actorId: string; occurredAt: string }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    auditAppended: boolean;
  }>>;
}

export type BudgetLabDraftResult = Readonly<{
  contractVersion: "budget-lab-draft/1.0.0";
  mode: "dry_run" | "saved_draft";
  proposal: PublicBudgetProposal;
  persistence: "none" | "inserted" | "unchanged";
  auditAppended: boolean;
  authority: Readonly<{ draftOnly: true; canApprove: false; canExecute: false; canWriteMeta: false }>;
}>;

const AUTHORITY = Object.freeze({ draftOnly: true as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });

function input(workspaceId: string, command: BudgetLabDraftCommand): BudgetProposalInput {
  return Object.freeze({ ...command, scope: Object.freeze({ workspaceId, ...command.scope }) });
}

export class BudgetLabDraftService {
  constructor(private readonly contexts: BudgetFrozenContextPort, private readonly persistence: BudgetDraftPersistencePort) {}

  private async compose(workspaceId: string, command: BudgetLabDraftCommand): Promise<BudgetProposal> {
    let proposal: BudgetProposal | null = null;
    const result = await new BudgetProposalService(this.contexts, {
      append: async (candidate) => { proposal = candidate; return Object.freeze({ outcome: "inserted" as const }); },
    }).create(input(workspaceId, command));
    if (!proposal || result.proposal !== proposal) throw new Error("budget_draft_compose_failed");
    return proposal;
  }

  async dryRun(workspaceId: string, command: BudgetLabDraftCommand): Promise<BudgetLabDraftResult> {
    const proposal = await this.compose(workspaceId, command);
    return Object.freeze({ contractVersion: "budget-lab-draft/1.0.0", mode: "dry_run", proposal: projectBudgetProposal(proposal),
      persistence: "none", auditAppended: false, authority: AUTHORITY });
  }

  async saveDraft(workspaceId: string, actorId: string, occurredAt: string, command: BudgetLabDraftCommand): Promise<BudgetLabDraftResult> {
    const proposal = await this.compose(workspaceId, command);
    const persisted = await this.persistence.appendDraft({ proposal, actorId, occurredAt });
    return Object.freeze({ contractVersion: "budget-lab-draft/1.0.0", mode: "saved_draft", proposal: projectBudgetProposal(proposal),
      persistence: persisted.outcome, auditAppended: persisted.auditAppended, authority: AUTHORITY });
  }
}
