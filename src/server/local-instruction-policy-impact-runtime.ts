import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { InstructionPolicyImpactService } from "@/application/instruction-policy-impact-service";
import { DrizzleInstructionPolicyImpactRepository } from
  "@/connectors/policies/instruction-policy-impact-drizzle-repository";
import * as schema from "@/db/schema";
import { createInstructionPolicyImpactHttpHandler, instructionPolicyImpactNotConfiguredResponse,
  instructionPolicyImpactSessionRequiredResponse } from "@/server/instruction-policy-impact-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalInstructionPolicyPrincipal,
  type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
export function createLocalInstructionPolicyImpactHandler(input: Readonly<{
  database: Pick<Database, "execute">; config: LocalDecisionRoomConfig;
}>) {
  return async (request: Request) => { try {
    const bound = await resolveTrustedLocalInstructionPolicyPrincipal({ request, database: input.database,
      config: input.config, requiredScope: "instruction_policy:read" });
    return createInstructionPolicyImpactHttpHandler({ service: new InstructionPolicyImpactService(
      new DrizzleInstructionPolicyImpactRepository(input.database), [bound.membership]),
    resolvePrincipal: async () => bound.principal })(request);
  } catch (reason) {
    return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
      ? instructionPolicyImpactSessionRequiredResponse() : instructionPolicyImpactNotConfiguredResponse();
  } };
}
