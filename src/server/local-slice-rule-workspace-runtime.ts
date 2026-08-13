import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { SliceRuleWorkspaceService } from "@/application/slice-rule-workspace-service";
import { DrizzleSliceRuleWorkspaceRepository } from "@/connectors/campaigns/slice-rule-workspace-drizzle-repository";
import * as schema from "@/db/schema";
import {
  LocalDecisionRoomBoundaryError,
  resolveTrustedLocalInstructionPolicyPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";
import {
  createSliceRuleWorkspaceHttpHandlers,
  sliceRuleWorkspaceNotConfiguredResponse,
  sliceRuleWorkspaceSessionRequiredResponse,
} from "@/server/slice-rule-workspace-http";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;

export function createLocalSliceRuleWorkspaceHandlers(input: Readonly<{
  database: Pick<Database, "select" | "insert" | "execute" | "transaction">;
  config: LocalDecisionRoomConfig;
  now?: () => string;
}>) {
  const execute = async (request: Request, operation: "read" | "draft") => {
    try {
      const bound = await resolveTrustedLocalInstructionPolicyPrincipal({ request, database: input.database,
        config: input.config, requiredScope: operation === "read" ? "instruction_policy:read" : "instruction_policy:draft" });
      const repository = new DrizzleSliceRuleWorkspaceRepository(input.database as never);
      const service = new SliceRuleWorkspaceService(repository);
      const handlers = createSliceRuleWorkspaceHttpHandlers({ repository, service,
        resolveActor: async () => ({ principal: bound.principal, role: bound.membership.role }),
        now: input.now ?? (() => new Date().toISOString()) });
      return operation === "read" ? handlers.GET(request) : handlers.POST(request);
    } catch (reason) {
      return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
        ? sliceRuleWorkspaceSessionRequiredResponse() : sliceRuleWorkspaceNotConfiguredResponse();
    }
  };
  return Object.freeze({ GET: (request: Request) => execute(request, "read"),
    POST: (request: Request) => execute(request, "draft") });
}
