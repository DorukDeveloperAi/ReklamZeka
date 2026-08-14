import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { NormalizationWorkbenchService } from "@/application/normalization-workbench-service";
import { DrizzleNormalizationWorkbenchRepository } from "@/connectors/guidance/normalization-workbench-drizzle-repository";
import * as schema from "@/db/schema";
import { createNormalizationWorkbenchHttpHandlers, normalizationWorkbenchNotConfiguredResponse,
  normalizationWorkbenchSessionRequiredResponse } from "@/server/normalization-workbench-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalInstructionPolicyPrincipal,
  type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;

export function createLocalNormalizationWorkbenchHandlers(input: Readonly<{
  database: Pick<Database, "execute" | "transaction">;
  config: LocalDecisionRoomConfig;
}>) {
  const execute = async (request: Request, operation: "read" | "draft") => { try {
    const bound = await resolveTrustedLocalInstructionPolicyPrincipal({ request, database: input.database,
      config: input.config, requiredScope: operation === "draft" ? "instruction_policy:draft" : "instruction_policy:read" });
    const service = new NormalizationWorkbenchService(new DrizzleNormalizationWorkbenchRepository(input.database as Database), [bound.membership]);
    const handlers = createNormalizationWorkbenchHttpHandlers({ service, resolvePrincipal: async () => bound.principal });
    return operation === "read" ? handlers.GET(request) : handlers.POST(request);
  } catch (reason) {
    return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
      ? normalizationWorkbenchSessionRequiredResponse() : normalizationWorkbenchNotConfiguredResponse();
  } };
  return Object.freeze({ GET: (request: Request) => execute(request, "read"),
    POST: async (request: Request) => {
      let operation: "read" | "draft" = "draft";
      try { const body = await request.clone().json() as { command?: { operation?: string } };
        operation = body.command?.operation === "preview" || body.command?.operation === "assess" ? "read" : "draft";
      } catch { /* exact parser sends the public error */ }
      return execute(request, operation);
    } });
}
