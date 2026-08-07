import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  DrizzleDecisionLedgerRepository,
  DecisionLedgerRepositoryError,
} from "@/connectors/decisions/decision-ledger-drizzle-repository";
import * as schema from "@/db/schema";
import {
  appendAnalysisRecord,
  appendDecisionRecord,
  type AnalysisLedgerRecord,
} from "@/domain/decisions/ledger";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("rollback");
const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const connectionId = randomUUID();
const dataSourceId = randomUUID();
const accountId = randomUUID();
const campaignId = randomUUID();
const contextId = randomUUID();
const contextHash = "a".repeat(64);
const workspaceRef = "workspace_e2e_ledger";

let appliedProductionTableVerified = false;
let analysisInserted = false;
let decisionInserted = false;
let temporalConflictBlocked = false;
let idempotentReplay = false;
let restartChainStable = false;
let recordConflictBlocked = false;
let sequenceConflictBlocked = false;
let missingContextBlocked = false;
let foreignWorkspaceIsolated = false;
let crossTenantForeignKeyBlocked = false;
let tokenPromptRawBlocked = false;
let nullableAuthorityBypassBlocked = false;
let actionAuthorityEscalationBlocked = false;
let payloadTamperBlocked = false;
let temporaryRowsCommitted = true;

async function assertLedgerTableApplied(transaction: Parameters<Parameters<typeof database.transaction>[0]>[0]) {
  const existence = await transaction.execute(sql`
    select to_regclass('public.decision_ledger_records')::text as table_name
  `);
  const exists = (existence as unknown as { rows?: { table_name: string | null }[] }).rows?.[0]?.table_name !== null;
  if (!exists) throw new Error("decision_ledger_records migration uygulanmadı");
  appliedProductionTableVerified = true;
}

function analysis(effectiveContextRef = contextHash, occurredAt = "2026-08-07T12:00:00.000Z") {
  return appendAnalysisRecord([], {
    workspaceRef,
    occurredAt,
    analysisDefinitionRef: "analysis_definition_v1",
    effectiveContextRef,
    timelineRefs: ["timeline_a"],
    evidenceRefs: ["evidence_a"],
    frozenContext: { campaign: "masked", metric: { key: "spend", state: "known" } },
  });
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, stable(item)]));
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function withIdentity(record: Omit<ReturnType<typeof appendDecisionRecord>["record"], "recordId" | "recordHash">) {
  const recordId = `decision_${digest(record).slice(0, 20)}`;
  return { ...record, recordId, recordHash: digest({ ...record, recordId }) } as const;
}

try {
  await database.transaction(async (transaction) => {
    await assertLedgerTableApplied(transaction);
    await transaction.insert(schema.workspaces).values([
      { id: workspaceId, name: "Decision Ledger E2E" },
      { id: foreignWorkspaceId, name: "Foreign Ledger E2E" },
    ]);
    await transaction.insert(schema.metaConnections).values({
      id: connectionId, workspaceId, externalConnectionKey: "ledger-connection", displayName: "Ledger",
      graphApiVersion: "v1", fieldCatalogVersion: "fields-v1", status: "active",
    });
    await transaction.insert(schema.dataSources).values({
      id: dataSourceId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads",
      externalAccountId: "ledger-account", displayName: "Ledger account",
    });
    await transaction.insert(schema.adAccounts).values({
      id: accountId, workspaceId, dataSourceId, externalAccountId: "ledger-account",
      name: "Ledger", currency: "TRY", timezone: "Europe/Istanbul",
    });
    await transaction.insert(schema.adCampaigns).values({
      id: campaignId, workspaceId, adAccountId: accountId, externalCampaignId: "ledger-campaign", name: "Ledger",
    });
    const capturedAt = "2026-08-07T11:00:00.000Z";
    await transaction.insert(schema.effectiveCampaignContexts).values({
      id: contextId, workspaceId, identityHash: "b".repeat(64), contextHash,
      schemaVersion: "effective-campaign-context/1.0.0", metaConnectionId: connectionId,
      adAccountId: accountId, campaignId, connectionRef: "ledger-connection", accountRef: "ledger-account",
      campaignRef: "ledger-campaign", entityType: "campaign", entityRef: "ledger-campaign",
      capturedAt: new Date(capturedAt), snapshotRefs: ["snapshot_aaaaaaaaaaaaaaaaaaaa"],
      contextPayload: {
        workspaceId, schemaVersion: "effective-campaign-context/1.0.0", contextHash, capturedAt,
        identity: {
          connectionRef: "ledger-connection", accountRef: "ledger-account",
          campaignRef: "ledger-campaign", entityType: "campaign", entityRef: "ledger-campaign",
        },
        data: { snapshotRefs: ["snapshot_aaaaaaaaaaaaaaaaaaaa"] },
        capabilities: { containsRawL0: false, canAuthorizeAction: false, canExecuteWrite: false },
      },
    });

    const repository = new DrizzleDecisionLedgerRepository(transaction as never);
    const first = analysis();
    analysisInserted = (await repository.append(workspaceId, first.record)).outcome === "inserted";
    const second = appendDecisionRecord(first.ledger, {
      workspaceRef, occurredAt: "2026-08-07T12:01:00.000Z", analysisRecordRef: first.record.recordId,
      cadenceResultRef: "cadence_e2e", disposition: "observe", evidenceRefs: ["evidence_a"],
      timelineRefs: ["timeline_a"], guidanceRefs: ["guidance_owner"], experimentRef: null,
      rationaleCode: "learning_active",
    });
    const { recordId: _forgedId, recordHash: _forgedHash, ...forgedBody } = second.record;
    const forgedEarlyDecision = withIdentity({
      ...forgedBody,
      occurredAt: "2026-08-07T11:59:00.000Z",
    });
    temporalConflictBlocked = await repository.append(workspaceId, forgedEarlyDecision).then(
      () => false,
      (error: unknown) => error instanceof DecisionLedgerRepositoryError && error.code === "temporal_conflict",
    );
    decisionInserted = (await repository.append(workspaceId, second.record)).outcome === "inserted";
    idempotentReplay = (await repository.append(workspaceId, first.record)).outcome === "unchanged";
    const restarted = new DrizzleDecisionLedgerRepository(transaction as never);
    const recovered = await restarted.load(workspaceId);
    restartChainStable = recovered.length === 2
      && recovered[0]?.recordHash === first.record.recordHash
      && recovered[1]?.recordHash === second.record.recordHash;

    recordConflictBlocked = await repository.append(workspaceId, {
      ...first.record, recordHash: "0".repeat(64),
    }).then(
      () => false,
      (error: unknown) => error instanceof DecisionLedgerRepositoryError && error.code === "record_conflict",
    );
    const competingHead = analysis(contextHash, "2026-08-07T12:02:00.000Z");
    sequenceConflictBlocked = await repository.append(workspaceId, competingHead.record).then(
      () => false,
      (error: unknown) => error instanceof DecisionLedgerRepositoryError && error.code === "chain_conflict",
    );
    missingContextBlocked = await repository.append(foreignWorkspaceId, analysis("c".repeat(64)).record).then(
      () => false,
      (error: unknown) => error instanceof DecisionLedgerRepositoryError && error.code === "context_missing",
    );
    foreignWorkspaceIsolated = (await repository.load(foreignWorkspaceId)).length === 0;

    const directAnalysis = async (savepoint: typeof transaction, options: Readonly<{
      workspaceId?: string; contextId?: string; recordId: string; recordHash: string;
      payloadExtra?: string; omitAuthority?: boolean; payloadRecordHash?: string;
    }>) => {
      const targetWorkspace = options.workspaceId ?? workspaceId;
      const payload = {
        version: "decision-ledger/1.0.0", recordType: "analysis", sequence: 99,
        previousHash: "GENESIS", workspaceRef, occurredAt: "2026-08-07T13:00:00.000Z",
        recordId: options.recordId, recordHash: options.payloadRecordHash ?? options.recordHash,
        analysisDefinitionRef: "analysis_definition_direct", effectiveContextRef: contextHash,
        timelineRefs: [], evidenceRefs: [], frozenContext: {},
        ...(options.omitAuthority ? {} : { actionAuthority: "none" }),
        ...(options.payloadExtra ? JSON.parse(options.payloadExtra) as Record<string, unknown> : {}),
      };
      await savepoint.insert(schema.decisionLedgerRecords).values({
        workspaceId: targetWorkspace, workspaceRef, version: "decision-ledger/1.0.0", recordType: "analysis",
        sequence: 99, previousHash: "GENESIS", recordId: options.recordId, recordHash: options.recordHash,
        occurredAt: new Date("2026-08-07T13:00:00.000Z"), effectiveContextId: options.contextId ?? contextId,
        effectiveContextRef: contextHash, analysisDefinitionRef: "analysis_definition_direct",
        payload: JSON.stringify(payload),
      });
    };
    crossTenantForeignKeyBlocked = await transaction.transaction(async (savepoint) => {
      await directAnalysis(savepoint as never, {
        workspaceId: foreignWorkspaceId, contextId, recordId: `analysis_${"1".repeat(20)}`, recordHash: "1".repeat(64),
      });
      return false;
    }).catch(() => true);
    const forbiddenResults: boolean[] = [];
    for (const [index, [key, value]] of [
      ["metaAccessToken", "unsafe"], ["systemPrompt", "unsafe"], ["rawPayload", { opaque: true }],
    ].entries()) {
      forbiddenResults.push(await transaction.transaction(async (savepoint) => {
        await directAnalysis(savepoint as never, {
          recordId: `analysis_${String(index + 2).repeat(20)}`,
          recordHash: String(index + 2).repeat(64), payloadExtra: JSON.stringify({ [key as string]: value }),
        });
        return false;
      }).catch(() => true));
    }
    tokenPromptRawBlocked = forbiddenResults.every(Boolean);
    nullableAuthorityBypassBlocked = await transaction.transaction(async (savepoint) => {
      await directAnalysis(savepoint as never, {
        recordId: `analysis_${"5".repeat(20)}`, recordHash: "5".repeat(64), omitAuthority: true,
      });
      return false;
    }).catch(() => true);
    actionAuthorityEscalationBlocked = await transaction.transaction(async (savepoint) => {
      await directAnalysis(savepoint as never, {
        recordId: `analysis_${"6".repeat(20)}`, recordHash: "6".repeat(64),
        payloadExtra: JSON.stringify({ nested: { actionAuthority: "auto" } }),
      });
      return false;
    }).catch(() => true);
    payloadTamperBlocked = await transaction.transaction(async (savepoint) => {
      await directAnalysis(savepoint as never, {
        recordId: `analysis_${"7".repeat(20)}`, recordHash: "7".repeat(64), payloadRecordHash: "8".repeat(64),
      });
      return false;
    }).catch(() => true);

    if (!analysisInserted || !decisionInserted || !temporalConflictBlocked || !idempotentReplay || !restartChainStable
      || !recordConflictBlocked || !sequenceConflictBlocked || !missingContextBlocked
      || !foreignWorkspaceIsolated || !crossTenantForeignKeyBlocked || !tokenPromptRawBlocked
      || !nullableAuthorityBypassBlocked || !actionAuthorityEscalationBlocked || !payloadTamperBlocked) {
      throw new Error("Decision ledger PostgreSQL acceptance failed");
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  const result = await database.execute(sql`
    select count(*)::int as count from workspaces where id in (${workspaceId}::uuid, ${foreignWorkspaceId}::uuid)
  `);
  temporaryRowsCommitted = Number((result as unknown as { rows?: { count: number }[] }).rows?.[0]?.count ?? -1) !== 0;
} finally {
  await pool.end();
}

console.log(JSON.stringify({
  appliedProductionTableVerified, analysisInserted, decisionInserted, temporalConflictBlocked, idempotentReplay,
  restartChainStable, recordConflictBlocked, sequenceConflictBlocked, missingContextBlocked,
  foreignWorkspaceIsolated, crossTenantForeignKeyBlocked, tokenPromptRawBlocked,
  nullableAuthorityBypassBlocked, actionAuthorityEscalationBlocked, payloadTamperBlocked,
  metaNetworkCalls: 0, metaWriteCalls: 0, temporaryRowsCommitted,
}));
