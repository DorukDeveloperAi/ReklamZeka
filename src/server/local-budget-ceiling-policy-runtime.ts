import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { BudgetCeilingPolicyService } from "@/application/budget-ceiling-policy-service";
import { DrizzleBudgetCeilingPolicyRepository } from "@/connectors/budget/budget-ceiling-policy-drizzle-repository";
import * as schema from "@/db/schema";
import { createBudgetCeilingPolicyHttpHandler,budgetCeilingPolicyNotConfiguredResponse,budgetCeilingPolicySessionRequiredResponse } from "@/server/budget-ceiling-policy-http";
import { LocalDecisionRoomBoundaryError,resolveTrustedLocalInstructionPolicyPrincipal,type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";
type Database=NodePgDatabase<typeof schema>;
export function createLocalBudgetCeilingPolicyHandler(input:Readonly<{database:Pick<Database,"select"|"insert"|"execute"|"transaction">;config:LocalDecisionRoomConfig;now?:()=>string}>){return async(request:Request)=>{try{const bound=await resolveTrustedLocalInstructionPolicyPrincipal({request,database:input.database,config:input.config,requiredScope:"instruction_policy:publish"});const repository=new DrizzleBudgetCeilingPolicyRepository(input.database as never);return createBudgetCeilingPolicyHttpHandler({service:new BudgetCeilingPolicyService(repository,input.now),resolveActor:async()=>({principal:bound.principal,role:bound.membership.role})})(request);}catch(reason){return reason instanceof LocalDecisionRoomBoundaryError||reason instanceof LocalSessionCapabilityError?budgetCeilingPolicySessionRequiredResponse():budgetCeilingPolicyNotConfiguredResponse();}};}
