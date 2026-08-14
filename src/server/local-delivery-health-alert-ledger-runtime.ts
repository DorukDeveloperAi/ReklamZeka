import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { DeliveryHealthAlertLedgerService } from "@/application/delivery-health-alert-ledger-service";
import { DrizzleDeliveryHealthAlertLedgerRepository } from
  "@/connectors/meta/delivery-health-alert-ledger-drizzle-repository";
import * as schema from "@/db/schema";
import {
  LocalDecisionRoomBoundaryError,
  resolveTrustedLocalInstructionPolicyPrincipal,
  type LocalDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";
import {
  createDeliveryHealthAlertLedgerHttpHandlers,
  deliveryHealthAlertNotConfiguredResponse,
  deliveryHealthAlertSessionRequiredResponse,
} from "@/server/delivery-health-alert-ledger-http";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;

export function createLocalDeliveryHealthAlertLedgerHandlers(input: Readonly<{
  database: Pick<Database, "execute" | "transaction">;
  config: LocalDecisionRoomConfig;
  now?: () => string;
}>) {
  const execute = async (request: Request, operation: "read" | "workflow") => {
    try {
      const bound = await resolveTrustedLocalInstructionPolicyPrincipal({ request, database: input.database as never,
        config: input.config, requiredScope: operation === "read" ? "instruction_policy:read" : "instruction_policy:draft" });
      const repository = new DrizzleDeliveryHealthAlertLedgerRepository(input.database);
      const service = new DeliveryHealthAlertLedgerService(repository, input.now);
      const handlers = createDeliveryHealthAlertLedgerHttpHandlers({ service,
        resolveActor: async () => ({ principal: bound.principal, role: bound.membership.role }) });
      return operation === "read" ? handlers.GET(request) : handlers.POST(request);
    } catch (reason) {
      return reason instanceof LocalDecisionRoomBoundaryError || reason instanceof LocalSessionCapabilityError
        ? deliveryHealthAlertSessionRequiredResponse() : deliveryHealthAlertNotConfiguredResponse();
    }
  };
  return Object.freeze({ GET: (request: Request) => execute(request, "read"),
    POST: (request: Request) => execute(request, "workflow") });
}
