import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { InstructionPolicyLifecycleService } from "@/application/instruction-policy-lifecycle-service";
import { DrizzleInstructionPolicyLifecycleRepository } from
  "@/connectors/policies/instruction-policy-lifecycle-drizzle-repository";
import * as schema from "@/db/schema";
import { createInstructionPolicyLifecycleHttpHandlers, instructionPolicyNotConfiguredResponse,
  instructionPolicySessionRequiredResponse } from "@/server/instruction-policy-lifecycle-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalInstructionPolicyPrincipal,
  type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;

export function createLocalInstructionPolicyHandlers(input: Readonly<{
  database: Pick<Database, "execute" | "transaction">;
  config: LocalDecisionRoomConfig;
}>) {
  const execute = async (request: Request, operation: "read" | "draft" | "publish") => { try {
    const requiredScope = operation === "read" ? "instruction_policy:read" as const
      : operation === "draft" ? "instruction_policy:draft" as const : "instruction_policy:publish" as const;
    const bound = await resolveTrustedLocalInstructionPolicyPrincipal({ request, database: input.database,
      config: input.config, requiredScope });
    const service = new InstructionPolicyLifecycleService(
      new DrizzleInstructionPolicyLifecycleRepository(input.database as Database), [bound.membership]);
    const handlers = createInstructionPolicyLifecycleHttpHandlers({ service, resolvePrincipal: async () => bound.principal });
    return operation === "read" ? handlers.GET(request) : handlers.POST(request);
  } catch (reason) {
    return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
      ? instructionPolicySessionRequiredResponse() : instructionPolicyNotConfiguredResponse();
  } };
  return Object.freeze({ GET: (request: Request) => execute(request, "read"),
    POST: async (request: Request) => {
      let operation: "draft" | "publish" = "publish";
      try { const body = await request.clone().json() as { command?: { operation?: string } };
        operation = body.command?.operation === "create_draft" || body.command?.operation === "revise_draft" ? "draft" : "publish";
      } catch { /* exact parser returns the public error */ }
      return execute(request, operation);
    } });
}
