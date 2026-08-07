import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ApprovalQueueAgentContract } from "@/application/approval-queue-agent-contract";
import { ApprovalQueueReadService } from "@/application/approval-queue-read-service";
import { DrizzleApprovalQueueReadRepository } from "@/connectors/actions/approval-queue-drizzle-read-repository";
import * as schema from "@/db/schema";
import {
  approvalQueueNotConfiguredResponse,
  createApprovalQueueHttpHandler,
} from "@/server/approval-queue-http";
import {
  resolveTrustedLocalReadPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";

type Database = NodePgDatabase<typeof schema>;

export function createLocalApprovalQueueRouteHandler(input: Readonly<{
  database: Pick<Database, "execute">;
  config: LocalDecisionRoomConfig;
}>) {
  return async function GET(request: Request) {
    try {
      const bound = await resolveTrustedLocalReadPrincipal({
        request,
        database: input.database,
        config: input.config,
        requiredScope: "approval_queue:read",
      });
      const contract = new ApprovalQueueAgentContract(
        new ApprovalQueueReadService(
          new DrizzleApprovalQueueReadRepository(input.database, input.config.workspaceId),
        ),
        [bound.membership],
      );
      return createApprovalQueueHttpHandler({
        contract,
        resolvePrincipal: async () => bound.principal,
      })(request);
    } catch {
      return approvalQueueNotConfiguredResponse();
    }
  };
}

export { approvalQueueNotConfiguredResponse };
