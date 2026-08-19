import type { GuideBudgetActionPrepareInput, GuideBudgetActionPreparation, GuideBudgetActionPreparationService } from "@/application/guide-budget-action-preparation-service";
export interface GuideBudgetActionProposalQueuePort { appendInitial(candidate: unknown): Promise<Readonly<{outcome:"inserted"|"unchanged";lifecycleHash:string}>>; }
export type GuideBudgetActionProposalSubmission=Readonly<{preparation:GuideBudgetActionPreparation;persistence:"not_requested"|"inserted"|"unchanged";lifecycleHash:string|null;authority:Readonly<{canApprove:false;canExecute:false;canWriteMeta:false}>}>;
export class GuideBudgetActionProposalSubmitterError extends Error{constructor(readonly code:"preparation_unavailable"|"queue_rejected"){super(code);}}
const AUTHORITY=Object.freeze({canApprove:false as const,canExecute:false as const,canWriteMeta:false as const});
export class GuideBudgetActionProposalSubmitter{
 constructor(private readonly preparation:Pick<GuideBudgetActionPreparationService,"prepare">,private readonly queue:GuideBudgetActionProposalQueuePort){}
 async submit(input:GuideBudgetActionPrepareInput):Promise<GuideBudgetActionProposalSubmission>{let prepared:GuideBudgetActionPreparation;try{prepared=await this.preparation.prepare(input);}catch{throw new GuideBudgetActionProposalSubmitterError("preparation_unavailable");}if(prepared.disposition==="held")return Object.freeze({preparation:prepared,persistence:"not_requested" as const,lifecycleHash:null,authority:AUTHORITY});try{const result=await this.queue.appendInitial(prepared.staged);return Object.freeze({preparation:prepared,persistence:result.outcome,lifecycleHash:result.lifecycleHash,authority:AUTHORITY});}catch{throw new GuideBudgetActionProposalSubmitterError("queue_rejected");}}
}
