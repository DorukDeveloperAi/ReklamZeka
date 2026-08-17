import { describe, expect, it } from "vitest";
import { DrizzleGuideRunCandidateStagingContextRepository } from "@/connectors/guides/guide-run-candidate-staging-context-drizzle-repository";

const id="123e4567-e89b-42d3-a456-426614174000";
const base={context_id:id,context_hash:"a".repeat(64),account_ref:"account_main",entity_ref:"campaign_main",entity_type:"campaign",policy_id:id,policy_ref:"policy_main",revision:1,policy_hash:"b".repeat(64),policy_payload:{requesterRoles:["agent"]}};
const input={workspaceId:id,guideRevisionId:id,entityRef:"campaign_main",sliceRef:"slice_main",market:"yerli" as const,action:"budget_decrease" as const,at:"2026-08-18T00:00:00.000Z"};
const overlap={resolve:async()=>({hold:{state:"clear" as const},humanApprovalActions:["budget_decrease"],effectiveGuideSetHash:"c".repeat(64),resolutionHash:"d".repeat(64)})};
function repo(rows: unknown[]){const db:any={transaction:async(w:any)=>w({execute:async()=>({rows})})};return new DrizzleGuideRunCandidateStagingContextRepository(db,overlap as never);}
describe("P06 candidate staging context",()=>{
 it("fails closed on missing or ambiguous current context",async()=>{await expect(repo([]).load(input)).rejects.toThrow("ambiguous");await expect(repo([base,base]).load(input)).rejects.toThrow("ambiguous");});
 it("requires explicit agent policy and a canonical policy artifact",async()=>{await expect(repo([{...base,policy_payload:{requesterRoles:["operator"]}}]).load(input)).rejects.toThrow("agent requester denied");await expect(repo([base]).load(input)).rejects.toThrow("policy artifact invalid");});
});
