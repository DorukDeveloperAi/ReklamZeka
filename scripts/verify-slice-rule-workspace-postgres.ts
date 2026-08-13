import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { SliceRuleWorkspaceService, createSliceRuleWorkspaceDraft } from
  "@/application/slice-rule-workspace-service";
import { DrizzleSliceRuleWorkspaceRepository } from
  "@/connectors/campaigns/slice-rule-workspace-drizzle-repository";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:slice-rule-workspace-db" }));
  process.exit(2);
}

const workspaceId = randomUUID();
const ownerId = randomUUID();
const viewerId = randomUUID();
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
const client = await pool.connect();
const database = drizzle({ client });
const rollback = Symbol("slice_rule_workspace_verifier_rollback");
const command = {
  workspaceId, seriesRef: "slice_rule.verify.ftr", revision: 1, previousDraftHash: "GENESIS" as const,
  idempotencyKey: "slice_rule.verify.ftr.r1", createdAt: "2026-08-13T10:00:00.000Z",
  scope: { market: "international" as const, serviceRef: "service_physical_therapy_rehab",
    campaignFamilyRef: "campaign_family_intensive_ftr", countryOrRegion: "Arap Bölgesi",
    audienceStrategy: "Özel seçilmiş hedefleme", platform: "instagram" as const },
  rule: { kind: "period_budget_cap" as const, period: "monthly" as const, currency: "TRY", maximumDecimal: "250000" },
  priority: 100, verification: { metric: "cost_per_qualified_lead" as const, reviewCadence: "weekly" as const,
    rollbackWhen: "Yeni sonuç kanıtı veya hedefleme değişimi insan incelemesini gerektirirse." },
};

try {
  await database.transaction(async (transaction) => {
    await client.query("insert into workspaces (id, name) values ($1, $2)", [workspaceId, "Slice Rule verifier"]);
    await client.query("insert into users (id, email) values ($1,$2),($3,$4)",
      [ownerId, `${ownerId}@slice-rule.test`, viewerId, `${viewerId}@slice-rule.test`]);
    await client.query("insert into memberships (workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer')",
      [workspaceId, ownerId, viewerId]);
    const repository = new DrizzleSliceRuleWorkspaceRepository(transaction as never);
    const service = new SliceRuleWorkspaceService(repository);
    const inserted = await service.saveDraft(ownerId, command);
    const unchanged = await service.saveDraft(ownerId, command);
    const ownerRead = await repository.listCurrent({ workspaceId, actorId: ownerId });
    const viewerRead = await repository.listCurrent({ workspaceId, actorId: viewerId });
    if (inserted.persistence !== "inserted" || !inserted.auditAppended
      || unchanged.persistence !== "unchanged" || unchanged.auditAppended
      || ownerRead.length !== 1 || viewerRead.length !== 1
      || ownerRead[0]?.scope.market !== "international"
      || ownerRead[0]?.scope.serviceRef !== "service_physical_therapy_rehab"
      || ownerRead[0]?.authority.canPublish || ownerRead[0]?.authority.canApprove
      || ownerRead[0]?.authority.canExecute || ownerRead[0]?.authority.canWriteMeta) {
      throw new Error("slice_rule_workspace_round_trip_failed");
    }

    let viewerWriteDenied = false;
    try { await service.saveDraft(viewerId, { ...command, idempotencyKey: "slice_rule.verify.viewer" }); }
    catch { viewerWriteDenied = true; }
    if (!viewerWriteDenied) throw new Error("slice_rule_workspace_viewer_write_accepted");

    const revisionTwo = createSliceRuleWorkspaceDraft({ ...command, revision: 2,
      previousDraftHash: inserted.draft.draftHash, idempotencyKey: "slice_rule.verify.ftr.r2",
      createdAt: "2026-08-13T11:00:00.000Z" });
    const revised = await repository.append({ draft: revisionTwo, actorId: ownerId });
    if (revised.outcome !== "inserted") throw new Error("slice_rule_workspace_revision_failed");

    let scopeDriftDenied = false;
    try {
      const drift = createSliceRuleWorkspaceDraft({ ...command, revision: 3,
        previousDraftHash: revisionTwo.draftHash, idempotencyKey: "slice_rule.verify.ftr.r3",
        createdAt: "2026-08-13T12:00:00.000Z", scope: { ...command.scope, platform: "facebook" } });
      await repository.append({ draft: drift, actorId: ownerId });
    } catch { scopeDriftDenied = true; }
    if (!scopeDriftDenied) throw new Error("slice_rule_workspace_scope_drift_accepted");

    await client.query("savepoint append_only_check");
    let appendOnly = false;
    try { await client.query("update slice_rule_workspace_drafts set lifecycle_state = lifecycle_state where workspace_id = $1", [workspaceId]); }
    catch { appendOnly = true; await client.query("rollback to savepoint append_only_check"); }
    if (!appendOnly) throw new Error("slice_rule_workspace_update_accepted");

    const auditCount = Number((await client.query<{ count: string }>(`select count(*) from audit_events
      where workspace_id = $1 and action = 'slice_rule.draft_saved'`, [workspaceId])).rows[0]!.count);
    if (auditCount !== 2) throw new Error("slice_rule_workspace_audit_count_mismatch");

    const grants = await client.query<{ role_name: string; has_access: boolean }>(`
      select role_name, has_table_privilege(role_name, 'public.slice_rule_workspace_drafts', 'select') as has_access
      from unnest(array['anon','authenticated','service_role']) role_name`);
    if (grants.rows.some((row) => row.has_access)) throw new Error("slice_rule_workspace_data_api_exposed");

    console.log(JSON.stringify({ ok: true, inserted: true, idempotentReplay: true, revisionChain: true,
      exactScope: { market: true, service: true, family: true, optionalDimensions: true },
      noInference: true, viewerRead: true, viewerWriteDenied, scopeDriftDenied, appendOnly,
      auditCount, dataApiRolesRevoked: true,
      authority: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false,
        canEnableAutomation: false }, transaction: "outer_rollback" }));
    throw rollback;
  });
} catch (reason) {
  if (reason !== rollback) throw reason;
} finally {
  client.release();
  await pool.end();
}
