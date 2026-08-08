import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleActionGuardrailPolicyRepository } from "@/connectors/actions/action-guardrail-policy-drizzle-repository";
import * as schema from "@/db/schema";
import { createActionGuardrailPolicyDraft, publishActionGuardrailPolicy } from "@/domain/actions/action-guardrail-policy";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("Supabase PostgreSQL bağlantısı yapılandırılmadı");

const workspaceId = randomUUID();
const workspaceRef = `workspace_guardrail_${workspaceId.replaceAll("-", "").slice(0, 16)}`;
const rollback = Symbol("rollback");
const hash = (character: string) => character.repeat(64);
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
let draftInserted = false;
let publishedInserted = false;
let restartDurable = false;
let appendOnlyUpdateRejected = false;
let rollbackClean = false;

try {
  await database.transaction(async (transaction) => {
    await transaction.insert(schema.workspaces).values({ id: workspaceId, name: "Guardrail acceptance workspace" });
    const repository = new DrizzleActionGuardrailPolicyRepository(transaction as never, workspaceId, workspaceRef);
    const draft = createActionGuardrailPolicyDraft({
      workspaceRef,
      policyRef: "guardrail_acceptance",
      revision: 1,
      previousHash: null,
      effectiveFrom: "2026-08-08T00:00:00.000Z",
      expiresAt: null,
      selector: { actionTypes: ["existing_post_promotion"], accountRefs: [], campaignRefs: [], entities: [],
        internalCategoryRefs: [], geoRefs: [] },
      clauses: [],
      normalizedBy: { actorRef: "actor_acceptance_analyst", role: "analyst" },
      sourceGuidanceRefs: [],
    });
    const published = publishActionGuardrailPolicy({
      draft,
      actor: { actorRef: "actor_acceptance_owner", role: "owner" },
      decisionRef: "decision_acceptance_publish",
      reasonRef: "reason_acceptance_verified",
      publishedAt: "2026-08-08T00:01:00.000Z",
    });
    draftInserted = (await repository.append(draft)).outcome === "inserted";
    publishedInserted = (await repository.append(published)).outcome === "inserted";

    const restarted = new DrizzleActionGuardrailPolicyRepository(transaction as never, workspaceId, workspaceRef);
    const resolution = await restarted.resolve({
      evaluatedAt: "2026-08-08T00:02:00.000Z",
      action: { actionHash: hash("a"), actionType: "existing_post_promotion", accountRef: "account_acceptance",
        campaignRef: "campaign_acceptance", entity: { level: "adset", ref: "adset_acceptance" }, budgetChange: null },
      categoryEvidence: { status: "known", refs: ["category_acceptance"], evidenceHash: hash("b") },
      affectedGeoEvidence: { status: "known", refs: ["geo_acceptance"], evidenceHash: hash("c") },
    });
    restartDurable = resolution.disposition === "allowed"
      && resolution.policyEvidence.length === 1
      && resolution.policyEvidence[0]?.canonicalHash === published.canonicalHash;

    await transaction.execute(sql.raw("savepoint action_guardrail_append_only_check"));
    try {
      await transaction.execute(sql`
        update action_guardrail_policy_revisions
        set workspace_ref = workspace_ref
        where workspace_id = ${workspaceId}::uuid
      `);
    } catch {
      appendOnlyUpdateRejected = true;
      await transaction.execute(sql.raw("rollback to savepoint action_guardrail_append_only_check"));
    }
    await transaction.execute(sql.raw("release savepoint action_guardrail_append_only_check"));

    if (!draftInserted || !publishedInserted || !restartDurable || !appendOnlyUpdateRejected) {
      throw new Error("ActionGuardrailPolicy PostgreSQL acceptance failed");
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
}

try {
  const workspaces = await database.select({ id: schema.workspaces.id }).from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  const policies = await database.select({ id: schema.actionGuardrailPolicyRevisions.id })
    .from(schema.actionGuardrailPolicyRevisions).where(eq(schema.actionGuardrailPolicyRevisions.workspaceId, workspaceId));
  rollbackClean = workspaces.length === 0 && policies.length === 0;
  if (!rollbackClean) throw new Error("ActionGuardrailPolicy acceptance rollback cleanup failed");
} finally {
  await pool.end();
}

console.log(JSON.stringify({
  draftInserted,
  publishedInserted,
  restartDurable,
  appendOnlyUpdateRejected,
  rollbackClean,
  temporaryRowsCommitted: false,
  metaNetworkCalls: 0,
  metaWriteCalls: 0,
}));
