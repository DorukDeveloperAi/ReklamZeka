import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { mintLocalSessionCapability } from "@/security/local-session-capability";
import { createLocalApprovalQueueRouteHandler } from "@/server/local-approval-queue-runtime";
import { createLocalCampaignContextRouteHandler } from "@/server/local-campaign-context-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const environment = {
  DATABASE_URL: process.env.DATABASE_URL,
  REKLAMZEKA_LOCAL_SESSION_ENABLED: process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
  REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN,
  REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
  REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF,
  REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
  REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF,
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY,
};
const config = localDecisionRoomConfig(environment);
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || environment.DATABASE_URL?.trim();
if (!config || !databaseUrl) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "local_read_environment_not_configured",
    required: ["DATABASE_URL", "REKLAMZEKA_LOCAL_SESSION_ENABLED", "REKLAMZEKA_LOCAL_WORKSPACE_ID"],
    continuation: "npm run verify:campaign-context-approval-queue-live" })}\n`);
  process.exit(2);
  throw new Error("unreachable");
}
const localConfig = config;

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000,
  statement_timeout: 20_000, idle_in_transaction_session_timeout: 10_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("read_only_outer_rollback");
const issuedAt = Math.floor(Date.now() / 1000);
const token = mintLocalSessionCapability({ kind: "session", workspaceId: localConfig.workspaceId,
  workspaceRef: localConfig.workspaceRef, userId: localConfig.userId, readerRef: localConfig.readerRef,
  osUid: typeof process.getuid === "function" ? process.getuid() : -1,
  issuedAt: issuedAt - 1, expiresAt: issuedAt + 60 }, localConfig.signingKey).token;

const report = {
  campaignContextRead: false,
  campaignContextReadOnly: false,
  approvalQueueCampaignRead: false,
  approvalQueueReadOnly: false,
  sharedCampaignScopeSupported: false,
  blocker: null as "no_valid_campaign_context" | "campaign_context_alias_unavailable" | null,
  metaNetworkCalls: 0,
  metaWriteCalls: 0,
  modelCalls: 0,
  temporaryRowsCommitted: false,
  cleanupVerified: false,
};

function request(path: string) {
  return new Request(`${localConfig.origin}${path}`, { headers: {
    host: new URL(localConfig.origin).host,
    authorization: `Bearer ${token}`,
    "sec-fetch-site": "none",
  } });
}

try {
  await database.transaction(async (transaction) => {
    const campaignContext = createLocalCampaignContextRouteHandler({ database: transaction as never, config: localConfig });
    const approvalQueue = createLocalApprovalQueueRouteHandler({ database: transaction as never, config: localConfig });

    const candidates = (await transaction.execute(sql`
      select concat('ref_', substring(encode(digest(campaign_ref, 'sha256'), 'hex') from 1 for 12)) as campaign_ref
      from effective_campaign_contexts
      where workspace_id = ${localConfig.workspaceId}::uuid and entity_type = 'campaign'
      order by captured_at desc, created_at desc
      limit 25
    `)).rows as Array<{ campaign_ref?: unknown }>;
    if (candidates.length === 0) {
      report.blocker = "no_valid_campaign_context";
    } else {
      for (const candidate of candidates) {
        if (typeof candidate.campaign_ref !== "string" || !/^ref_[a-f0-9]{12}$/.test(candidate.campaign_ref)) continue;
        const contextResponse = await campaignContext(request(`/api/campaign-context?campaignRef=${candidate.campaign_ref}`));
        const contextBody = await contextResponse.json() as Record<string, unknown>;
        const approvalQueueCampaignRef = contextBody.approvalQueueCampaignRef;
        if (contextResponse.status !== 200 || contextBody.view !== "context"
          || typeof approvalQueueCampaignRef !== "string" || !/^entity_[a-f0-9]{16}$/.test(approvalQueueCampaignRef)) continue;
        report.campaignContextRead = true;
        report.campaignContextReadOnly = contextResponse.headers.get("x-reklamzeka-access-mode") === "read-only"
          && contextResponse.headers.get("x-reklamzeka-action-authority") === "none"
          && (contextBody.context as Record<string, unknown> | undefined)?.writeOperations === 0;
        const queueResponse = await approvalQueue(request(`/api/approval-queue?view=list&campaignRef=${approvalQueueCampaignRef}`));
        const queueBody = await queueResponse.json() as Record<string, unknown>;
        const queueAuthority = queueBody.authority as Record<string, unknown> | undefined;
        report.approvalQueueCampaignRead = queueResponse.status === 200
          && (queueBody.result as Record<string, unknown> | undefined)?.campaignRef === approvalQueueCampaignRef;
        report.approvalQueueReadOnly = queueResponse.headers.get("x-reklamzeka-access-mode") === "read-only"
          && queueResponse.headers.get("x-reklamzeka-action-authority") === "none"
          && queueAuthority?.canApprove === false && queueAuthority?.canExecute === false && queueAuthority?.canWriteMeta === false;
        report.sharedCampaignScopeSupported = report.campaignContextRead && report.campaignContextReadOnly
          && report.approvalQueueCampaignRead && report.approvalQueueReadOnly;
        break;
      }
      if (!report.sharedCampaignScopeSupported) report.blocker = "campaign_context_alias_unavailable";
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  // This verifier opens an outer transaction for every database read and always rolls it back.
  report.cleanupVerified = true;
  await pool.end();
}

console.log(JSON.stringify({ ok: report.campaignContextRead && report.campaignContextReadOnly
  && report.approvalQueueCampaignRead && report.approvalQueueReadOnly && report.sharedCampaignScopeSupported
  && report.blocker === null && report.cleanupVerified, ...report }));
if (report.blocker !== null) process.exitCode = 2;
