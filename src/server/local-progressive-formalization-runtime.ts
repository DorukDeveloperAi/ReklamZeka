import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ProgressiveFormalizationService } from "@/application/progressive-formalization-service";
import { DrizzleProgressiveFormalizationRepository } from
  "@/connectors/guidance/progressive-formalization-drizzle-repository";
import * as schema from "@/db/schema";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalInstructionPolicyPrincipal,
  type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createProgressiveFormalizationHttpHandlers, progressiveFormalizationNotConfiguredResponse,
  progressiveFormalizationSessionRequiredResponse } from "@/server/progressive-formalization-http";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
export function createLocalProgressiveFormalizationHandlers(input: Readonly<{
  database: Pick<Database, "execute" | "transaction">; config: LocalDecisionRoomConfig;
}>) {
  const execute = async (request: Request, method: "GET" | "POST", operation: "read" | "draft" | "publish") => { try {
    const requiredScope = operation === "read" ? "instruction_policy:read" as const
      : operation === "draft" ? "instruction_policy:draft" as const : "instruction_policy:publish" as const;
    const bound = await resolveTrustedLocalInstructionPolicyPrincipal({ request, database: input.database,
      config: input.config, requiredScope });
    const service = new ProgressiveFormalizationService(
      new DrizzleProgressiveFormalizationRepository(input.database as Database), [bound.membership]);
    const handlers = createProgressiveFormalizationHttpHandlers({ service, resolvePrincipal: async () => bound.principal });
    return method === "GET" ? handlers.GET(request) : handlers.POST(request);
  } catch (reason) {
    return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
      ? progressiveFormalizationSessionRequiredResponse() : progressiveFormalizationNotConfiguredResponse();
  } };
  return Object.freeze({ GET: (request: Request) => execute(request, "GET", "read"),
    POST: async (request: Request) => {
      let operation: "draft" | "publish" = "publish";
      try { const body = await request.clone().json() as { command?: { operation?: string } };
        operation = body.command?.operation === "capture_g0" || body.command?.operation === "scope_g1" ? "draft" : "publish";
      } catch { /* HTTP parser owns exact public error. */ }
      return execute(request, "POST", operation);
    } });
}
