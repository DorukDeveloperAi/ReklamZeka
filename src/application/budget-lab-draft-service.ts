import type { BudgetProposalInput, BudgetFrozenContextPort, BudgetProposal } from "@/application/budget-proposal-service";
import { BudgetProposalService } from "@/application/budget-proposal-service";
import { projectBudgetProposal, type PublicBudgetProposal } from "@/connectors/budget/budget-proposal-drizzle-repository";
import type { SliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";

export type BudgetLabDraftCommand = Readonly<Omit<BudgetProposalInput, "scope"> & {
  scope: Readonly<Omit<BudgetProposalInput["scope"], "workspaceId">>;
}>;

export interface BudgetDraftPersistencePort {
  appendDraft(input: Readonly<{ proposal: BudgetProposal; actorId: string; occurredAt: string }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    auditAppended: boolean;
  }>>;
  appendRuleLinkedDraft?(input: Readonly<{
    proposal: BudgetProposal;
    actorId: string;
    occurredAt: string;
    draft: SliceRuleWorkspaceDraft;
    bindingIdempotencyKey: string;
  }>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; bindingOutcome: "inserted" | "unchanged"; auditAppended: boolean }>>;
}

export type BudgetLabDraftResult = Readonly<{
  contractVersion: "budget-lab-draft/1.0.0";
  mode: "dry_run" | "saved_draft";
  proposal: PublicBudgetProposal;
  persistence: "none" | "inserted" | "unchanged";
  auditAppended: boolean;
  authority: Readonly<{ draftOnly: true; canApprove: false; canExecute: false; canWriteMeta: false }>;
}>;

/** Server-private result used to bind an explicit source rule without leaking hashes to UI/API. */
export type SavedBudgetLabDraft = Readonly<{ result: BudgetLabDraftResult; proposal: BudgetProposal }>;

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

  async saveDraftWithPrivateProposal(workspaceId: string, actorId: string, occurredAt: string, command: BudgetLabDraftCommand): Promise<SavedBudgetLabDraft> {
    const proposal = await this.compose(workspaceId, command);
    const persisted = await this.persistence.appendDraft({ proposal, actorId, occurredAt });
    const result = Object.freeze({ contractVersion: "budget-lab-draft/1.0.0" as const, mode: "saved_draft" as const, proposal: projectBudgetProposal(proposal),
      persistence: persisted.outcome, auditAppended: persisted.auditAppended, authority: AUTHORITY });
    return Object.freeze({ result, proposal });
  }

  async saveDraft(workspaceId: string, actorId: string, occurredAt: string, command: BudgetLabDraftCommand): Promise<BudgetLabDraftResult> {
    return (await this.saveDraftWithPrivateProposal(workspaceId, actorId, occurredAt, command)).result;
  }

  async saveRuleLinkedDraft(workspaceId: string, actorId: string, occurredAt: string, command: BudgetLabDraftCommand,
    draft: SliceRuleWorkspaceDraft, bindingIdempotencyKey: string): Promise<Readonly<{ result: BudgetLabDraftResult; bindingOutcome: "inserted" | "unchanged" }>> {
    if (!this.persistence.appendRuleLinkedDraft) throw new Error("budget_rule_provenance_not_configured");
    const proposal = await this.compose(workspaceId, command);
    const persisted = await this.persistence.appendRuleLinkedDraft({ proposal, actorId, occurredAt, draft, bindingIdempotencyKey });
    const result = Object.freeze({ contractVersion: "budget-lab-draft/1.0.0" as const, mode: "saved_draft" as const, proposal: projectBudgetProposal(proposal),
      persistence: persisted.outcome, auditAppended: persisted.auditAppended, authority: AUTHORITY });
    return Object.freeze({ result, bindingOutcome: persisted.bindingOutcome });
  }
}
