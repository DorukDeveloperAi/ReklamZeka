import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DecisionRoomDryRunService } from "@/application/decision-room-dry-run-service";
import { createDrizzleDecisionRoomAnalysisExecutor } from "@/connectors/analyses/decision-room-analysis-registry-drizzle";
import { DrizzleFindingObservationReadPort, FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION } from "@/connectors/analyses/finding-observation-drizzle-read-port";
import { DecisionRoomDrizzleDraftAdapter } from "@/connectors/decisions/decision-room-drizzle-adapter";
import { DrizzleDecisionLedgerRepository } from "@/connectors/decisions/decision-ledger-drizzle-repository";
import * as schema from "@/db/schema";
import { createDecisionRoomDryRunHttpHandler, decisionRoomDryRunNotConfiguredResponse } from "@/server/decision-room-dry-run-http";
import { localDecisionRoomConfig, resolveTrustedLocalDecisionRoomDryRunPrincipal, type LocalDecisionRoomConfig, type LocalDecisionRoomEnvironment } from "@/server/local-decision-room-runtime";

type Database = NodePgDatabase<typeof schema>;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type LocalDecisionRoomDryRunEnvironment = LocalDecisionRoomEnvironment & Readonly<{
  REKLAMZEKA_ANALYSIS_SETTLEMENT_POLICY_REF?: string;
  REKLAMZEKA_ANALYSIS_SETTLED_THROUGH_DATE?: string;
}>;

export type LocalDecisionRoomDryRunConfig = Readonly<{
  local: LocalDecisionRoomConfig;
  settlementPolicyRef: string;
  settledThroughDate: string;
}>;

/** The policy is explicit operator configuration; no request parameter or inferred delay can claim finality. */
export function localDecisionRoomDryRunConfig(environment: LocalDecisionRoomDryRunEnvironment): LocalDecisionRoomDryRunConfig | null {
  const local = localDecisionRoomConfig({
    DATABASE_URL: environment.DATABASE_URL, REKLAMZEKA_LOCAL_SESSION_ENABLED: environment.REKLAMZEKA_LOCAL_SESSION_ENABLED,
    REKLAMZEKA_LOCAL_ORIGIN: environment.REKLAMZEKA_LOCAL_ORIGIN, REKLAMZEKA_LOCAL_WORKSPACE_ID: environment.REKLAMZEKA_LOCAL_WORKSPACE_ID,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: environment.REKLAMZEKA_LOCAL_WORKSPACE_REF, REKLAMZEKA_LOCAL_USER_ID: environment.REKLAMZEKA_LOCAL_USER_ID,
    REKLAMZEKA_LOCAL_READER_REF: environment.REKLAMZEKA_LOCAL_READER_REF, REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: environment.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY,
  });
  if (!local) return null;
  const policyRef = environment.REKLAMZEKA_ANALYSIS_SETTLEMENT_POLICY_REF;
  const settledThroughDate = environment.REKLAMZEKA_ANALYSIS_SETTLED_THROUGH_DATE;
  const parsedDate = typeof settledThroughDate === "string" && DAY.test(settledThroughDate)
    ? new Date(`${settledThroughDate}T00:00:00.000Z`) : null;
  if (typeof policyRef !== "string" || !REF.test(policyRef) || typeof settledThroughDate !== "string"
    || !parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== settledThroughDate) {
    return null;
  }
  return Object.freeze({ local, settlementPolicyRef: policyRef, settledThroughDate });
}

export function createLocalDecisionRoomDryRunHandler(input: Readonly<{
  database: Pick<Database, "execute" | "transaction">;
  config: LocalDecisionRoomDryRunConfig;
}>) {
  return async function POST(request: Request) {
    try {
      const bound = await resolveTrustedLocalDecisionRoomDryRunPrincipal({ request, database: input.database, config: input.config.local });
      const observationReader = new DrizzleFindingObservationReadPort(input.database as never, {
        resolve: async () => Object.freeze({ policyVersion: FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION,
          policyRef: input.config.settlementPolicyRef, evaluatedAsOf: new Date().toISOString(),
          settledThroughDate: input.config.settledThroughDate }),
      });
      const drafts = new DecisionRoomDrizzleDraftAdapter(new DrizzleDecisionLedgerRepository(input.database as never), {
        workspaceId: input.config.local.workspaceId, workspaceRef: input.config.local.workspaceRef,
      });
      const executor = createDrizzleDecisionRoomAnalysisExecutor({ database: input.database, workspaceId: input.config.local.workspaceId,
        observations: observationReader, drafts });
      return createDecisionRoomDryRunHttpHandler({
        service: new DecisionRoomDryRunService(executor, [bound.membership]), resolvePrincipal: async () => bound.principal,
      })(request);
    } catch {
      return decisionRoomDryRunNotConfiguredResponse();
    }
  };
}

export { decisionRoomDryRunNotConfiguredResponse };
