import { describe,expect,it,vi } from "vitest";
import { BudgetCeilingPolicyService,budgetCeilingPublisherRef,type BudgetCeilingPolicyRevisionPort } from "@/application/budget-ceiling-policy-service";

const actor="00000000-0000-4000-8000-000000000002", now="2026-08-18T07:00:00.000Z";
const input={workspaceId:"00000000-0000-4000-8000-000000000001",limitRef:"limit_market",revision:1,previousPolicyHash:null,poolRef:"budget_pool_market",parentLimitRef:null,layer:"market" as const,targetScopeRef:"ad_set_public_123",market:"yerli" as const,currency:"TRY",ceilingDecimal:"1000",effectiveFrom:"2026-08-18T08:00:00.000Z",effectiveTo:"2026-09-18T08:00:00.000Z",state:"published" as const};
describe("budget ceiling publication",()=>{
 it("derives actor/time server-side and exposes no action authority",async()=>{const append=vi.fn(async()=>({outcome:"inserted" as const,auditAppended:true}));const result=await new BudgetCeilingPolicyService({append} satisfies BudgetCeilingPolicyRevisionPort,()=>now).publish(actor,input);expect(result.policy).toMatchObject({publishedByActorRef:budgetCeilingPublisherRef(actor),publishedAt:now});expect(result.authority).toEqual({canApprove:false,canExecute:false,canWriteMeta:false});expect(append).toHaveBeenCalledOnce();});
 it("rejects caller-invalid time and maps persistence denial closed",async()=>{const append=vi.fn(async()=>{throw new Error("denied")});await expect(new BudgetCeilingPolicyService({append},()=>"2026-08-19T00:00:00.000Z").publish(actor,input)).rejects.toMatchObject({code:"invalid_input"});await expect(new BudgetCeilingPolicyService({append},()=>now).publish(actor,input)).rejects.toMatchObject({code:"persistence_rejected"});});
});
