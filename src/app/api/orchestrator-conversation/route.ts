import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { OrchestratorConversationService } from "@/application/orchestrator-conversation";
import { DrizzleOrchestratorConversationRepository } from
  "@/connectors/agents/orchestrator-conversation-drizzle-repository";
import { DrizzleWorkspaceSkillCatalogBindingRepository } from
  "@/connectors/orchestrator/workspace-skill-catalog-binding-drizzle-repository";
import { ReadOnlyEvidenceContextService } from "@/application/orchestrator-readonly-evidence-context";
import { DrizzleCanonicalPerformanceReadRepository } from "@/connectors/meta/canonical-performance-read-drizzle-repository";
import { DrizzleOperationalTimelineRepository } from "@/connectors/decisions/operational-timeline-drizzle-repository";
import { DrizzleTemporalCohortAvailabilityRepository } from "@/connectors/analyses/temporal-cohort-availability-drizzle-repository";
import * as schema from "@/db/schema";
import { LocalCodexExecAdapter, localCodexExecConfig } from "@/server/local-codex-exec-adapter";
import { localDecisionRoomConfig, resolveTrustedLocalSessionIdentity } from
  "@/server/local-decision-room-runtime";
import { createOrchestratorConversationHttpHandlers,
  orchestratorConversationNotConfiguredResponse } from "@/server/orchestrator-conversation-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let database: ReturnType<typeof drizzle<typeof schema>> | null = null;

function handlers() {
  try {
    const localEnvironment = {
      DATABASE_URL: process.env.DATABASE_URL,
      REKLAMZEKA_LOCAL_SESSION_ENABLED: process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
      REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN,
      REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
      REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF,
      REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
      REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF,
      REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY,
    };
    const config = localDecisionRoomConfig(localEnvironment);
    const codexConfig = localCodexExecConfig(process.env);
    if (!config || !codexConfig) return null;
    if (!database) {
      const pool = new Pool({ connectionString: localEnvironment.DATABASE_URL, max: 2,
        connectionTimeoutMillis: 5_000, statement_timeout: 130_000, idleTimeoutMillis: 30_000,
        allowExitOnIdle: true });
      pool.on("error", () => undefined);
      database = drizzle(pool, { schema });
    }
    const repository = new DrizzleOrchestratorConversationRepository(database as never);
    const skillCatalog = new DrizzleWorkspaceSkillCatalogBindingRepository(database as never);
    const evidence = new ReadOnlyEvidenceContextService(new DrizzleCanonicalPerformanceReadRepository(database as never),
      new DrizzleOperationalTimelineRepository(database as never), new DrizzleTemporalCohortAvailabilityRepository(database as never));
    const service = new OrchestratorConversationService(repository, new LocalCodexExecAdapter(codexConfig), skillCatalog,
      undefined, undefined, evidence);
    return createOrchestratorConversationHttpHandlers({ service, config,
      resolveIdentity: (request) => resolveTrustedLocalSessionIdentity({ request,
        database: database!, config, credential: "cookie" }) });
  } catch { return null; }
}

export function GET(request?: Request) {
  const found = handlers();
  return found && request ? found.GET(request) : orchestratorConversationNotConfiguredResponse();
}

export function POST(request?: Request) {
  const found = handlers();
  return found && request ? found.POST(request) : orchestratorConversationNotConfiguredResponse();
}
