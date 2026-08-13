export type SliceRuleBudgetPoolBinding = Readonly<{
  workspaceId: string; draftHash: string; hierarchyHash: string; poolRef: string;
  market: "domestic" | "international"; idempotencyKey: string; boundAt: string;
  authority: Readonly<{ canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false; canEnableAutomation: false }>;
}>;
export interface SliceRuleBudgetPoolBindingPort { bind(input: Readonly<{ binding: SliceRuleBudgetPoolBinding; actorId: string }>): Promise<Readonly<{ outcome: "inserted" | "unchanged" }>>; }
const HASH=/^[a-f0-9]{64}$/; const REF=/^[a-z][a-z0-9_.:-]{0,127}$/; const AUTH=Object.freeze({canPublish:false as const,canApprove:false as const,canExecute:false as const,canWriteMeta:false as const,canEnableAutomation:false as const});
export function createSliceRuleBudgetPoolBinding(input: Omit<SliceRuleBudgetPoolBinding,"authority">): SliceRuleBudgetPoolBinding {
  if (!HASH.test(input.draftHash)||!HASH.test(input.hierarchyHash)||!/^budget_pool_[a-z0-9][a-z0-9_.:-]{0,119}$/.test(input.poolRef)||!REF.test(input.idempotencyKey)||!["domestic","international"].includes(input.market)||Number.isNaN(new Date(input.boundAt).valueOf())) throw new Error("invalid_input");
  return Object.freeze({...input,authority:AUTH});
}
export class SliceRuleBudgetPoolBindingService { constructor(private readonly bindings: SliceRuleBudgetPoolBindingPort) {} async bind(actorId:string,input:Omit<SliceRuleBudgetPoolBinding,"authority">){ const binding=createSliceRuleBudgetPoolBinding(input); return this.bindings.bind({binding,actorId}); } }
