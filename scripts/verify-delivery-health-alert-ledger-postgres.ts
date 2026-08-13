import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DeliveryHealthAlertLedgerService } from "@/application/delivery-health-alert-ledger-service";
import { DrizzleDeliveryHealthAlertLedgerRepository } from
  "@/connectors/meta/delivery-health-alert-ledger-drizzle-repository";
import { DELIVERY_HEALTH_CHECKLIST_ITEMS } from "@/domain/meta/delivery-health-alert-ledger";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"],
    continuation: "npm run verify:delivery-health-alert-ledger-db" }));
  process.exit(2);
}

const workspaceId = randomUUID();
const ownerId = randomUUID();
const viewerId = randomUUID();
const workspaceRef = `workspace_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
const client = await pool.connect();
const database = drizzle({ client });
const rollback = Symbol("delivery_health_alert_ledger_verifier_rollback");

try {
  await database.transaction(async (transaction) => {
    await client.query("insert into workspaces (id, name) values ($1, $2)", [workspaceId, "Delivery alert verifier"]);
    await client.query("insert into users (id, email) values ($1,$2),($3,$4)",
      [ownerId, `${ownerId}@delivery-alert.test`, viewerId, `${viewerId}@delivery-alert.test`]);
    await client.query("insert into memberships (workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer')",
      [workspaceId, ownerId, viewerId]);
    const repository = new DrizzleDeliveryHealthAlertLedgerRepository(transaction as never);
    let nowIndex = 9;
    const service = new DeliveryHealthAlertLedgerService(repository, () => `2026-08-13T${String(++nowIndex).padStart(2, "0")}:00:00.000Z`);
    const confirmedInput = { workspaceId, workspaceRef, actorId: ownerId, actorRef: "actor_owner", role: "owner" as const,
      alert: { workspaceRef, alertRef: "delivery_alert_verify_confirmed", accountRef: "account_primary",
        assignedActorRef: "actor_owner", detectedAt: "2026-08-13T09:00:00.000Z", policy: null,
        frozenContextHash: null, evidence: { level: "confirmed" as const, officialState: "payment_required" as const,
          sourceRef: "meta_account_state_verify" } } };
    const inserted = await service.materialize(confirmedInput);
    const unchanged = await service.materialize(confirmedInput);
    if (inserted.outcome !== "inserted" || unchanged.outcome !== "unchanged"
      || inserted.record.current.recommendationDisposition !== "hold_recommendations") {
      throw new Error("confirmed_materialization_failed");
    }
    let head = inserted.record;
    head = await service.transition({ workspaceId, actorId: ownerId, actorRef: "actor_owner", role: "owner",
      alertRef: head.alert.alertRef, expectedRecordHash: head.recordHash, command: { kind: "start_investigation" } });
    for (const item of DELIVERY_HEALTH_CHECKLIST_ITEMS) {
      head = await service.transition({ workspaceId, actorId: ownerId, actorRef: "actor_owner", role: "owner",
        alertRef: head.alert.alertRef, expectedRecordHash: head.recordHash,
        command: { kind: "set_checklist_item", item, completed: true } });
    }
    head = await service.transition({ workspaceId, actorId: ownerId, actorRef: "actor_owner", role: "owner",
      alertRef: head.alert.alertRef, expectedRecordHash: head.recordHash, command: { kind: "resolve" } });
    if (head.current.status !== "resolved" || head.current.recommendationDisposition !== "released"
      || head.authority.canExecute || head.authority.canWriteMeta) throw new Error("resolution_failed");

    const suspected = await service.materialize({ ...confirmedInput,
      alert: { ...confirmedInput.alert, alertRef: "delivery_alert_verify_suspected",
        evidence: { level: "suspected" as const, baselineSpendDecimal: "1000", currentSpendDecimal: "0",
          observationWindowHours: 24, sourceRef: "window_delivery_verify" } } });
    if (suspected.record.current.recommendationDisposition !== "needs_human_review"
      || suspected.record.alert.evidence.level !== "suspected") throw new Error("suspected_materialization_failed");

    const publicRows = await service.listCurrent({ workspaceId, actorId: viewerId });
    if (publicRows.length !== 2 || publicRows.some((item) => "sourceRef" in item.evidence
      || item.authority.canExecute || item.authority.canWriteMeta)) throw new Error("public_projection_failed");

    let viewerWriteDenied = false;
    try { await repository.transition({ workspaceId, actorId: viewerId, actorRef: "actor_viewer", role: "owner",
      alertRef: suspected.record.alert.alertRef, expectedRecordHash: suspected.record.recordHash,
      occurredAt: "2026-08-13T18:00:00.000Z", command: { kind: "start_investigation" } }); }
    catch { viewerWriteDenied = true; }
    if (!viewerWriteDenied) throw new Error("viewer_transition_accepted");

    await client.query("savepoint append_only_check");
    let appendOnly = false;
    try { await client.query("update delivery_health_alert_ledger_records set status = status where workspace_id = $1", [workspaceId]); }
    catch { appendOnly = true; await client.query("rollback to savepoint append_only_check"); }
    if (!appendOnly) throw new Error("append_only_update_accepted");
    const grants = await client.query<{ role_name: string; has_access: boolean }>(`
      select role_name, has_table_privilege(role_name, 'public.delivery_health_alert_ledger_records', 'select') as has_access
      from unnest(array['anon','authenticated','service_role']) role_name`);
    if (grants.rows.some((row) => row.has_access)) throw new Error("data_api_exposed");
    const auditCount = Number((await client.query<{ count: string }>(`select count(*) from audit_events
      where workspace_id = $1 and action like 'delivery_health_alert.%'`, [workspaceId])).rows[0]!.count);
    if (auditCount !== 8) throw new Error(`audit_count_mismatch:${auditCount}`);

    console.log(JSON.stringify({ ok: true, confirmedDistinct: true, suspectedDistinct: true,
      idempotentMaterialization: true, lifecycleChain: true, checklistRequired: true,
      recommendationHoldReleased: true, viewerRead: true, viewerWriteDenied, appendOnly,
      dataApiRolesRevoked: true, auditCount, metaWrite: false, execution: false,
      transaction: "outer_rollback" }));
    throw rollback;
  });
} catch (reason) {
  if (reason !== rollback) throw reason;
} finally {
  client.release();
  await pool.end();
}
