import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { AppendOnlyAuditLog } from "@/security/audit";
import { DrizzleMetaConnectionRepository } from "@/connectors/meta/connection-drizzle-repository";
import { MetaConnectionNotFoundError } from "@/connectors/meta/connection-repository";
import { MetaConnectionService } from "@/connectors/meta/connection-service";
import { DrizzleEnvironmentMetaSecretRepository } from "@/connectors/meta/environment-secret-drizzle-repository";
import { MetaSecretAccessError } from "@/connectors/meta/secret-repository";
import type { MetaFetch } from "@/connectors/meta/graph-client";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const rollback = Symbol("rollback");
const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const connectionId = randomUUID();
const invalidConnectionId = randomUUID();
const adminId = randomUUID();
const fixtureToken = `e2e-${randomUUID()}`;
const timestamp = new Date("2026-08-07T12:30:00.000Z");
const environment: Record<string, string | undefined> = { META_ACCESS_TOKEN: fixtureToken };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const doctorFetch: MetaFetch = async (input, init) => {
  const url = new URL(input);
  if (init?.method !== "GET") throw new Error("write method rejected");
  if (new Headers(init.headers).get("authorization") !== `Bearer ${fixtureToken}`) {
    throw new Error("unexpected credential");
  }
  if (url.pathname.endsWith("/debug_token")) {
    return json({ data: { is_valid: true, scopes: ["ads_read"], expires_at: 1_800_000_000 } });
  }
  if (url.pathname.endsWith("/me/adaccounts")) return json({ data: [], summary: { total_count: 0 } });
  if (url.pathname.endsWith("/me")) return json({ id: "fixture-principal", name: "Fixture" });
  return json({ error: {} }, 404);
};

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
});
const database = drizzle(pool, { schema });

let restartDurable = false;
let workspaceIsolated = false;
let disconnectDisabled = false;
let revokeDestroyed = false;
let invalidPersisted = false;
let upstreamTokenInvalidated = true;

try {
  await database.transaction(async (transaction) => {
    await transaction.insert(schema.workspaces).values([
      { id: workspaceId, name: "S1.5 connection E2E" },
      { id: foreignWorkspaceId, name: "S1.5 foreign E2E" },
    ]);

    const memberships = [{ userId: adminId, workspaceId, role: "admin" as const }];
    const audit = new AppendOnlyAuditLog();
    const connections = new DrizzleMetaConnectionRepository(transaction);
    const secrets = new DrizzleEnvironmentMetaSecretRepository(
      transaction,
      environment,
      () => timestamp,
    );
    const service = new MetaConnectionService({
      memberships,
      connections,
      secrets,
      audit,
      fetchImpl: doctorFetch,
      now: () => timestamp,
      // This verifier uses an in-memory fixture secret and a GET-only fixture
      // transport; it must not inherit the real environment's rotation gate.
      tokenSecurityStatus: () => "rotated",
    });
    const scope = { workspaceId, connectionId };
    const reference = secrets.reference(scope);
    if (JSON.stringify(reference).includes(fixtureToken)) throw new Error("secret leaked into reference");
    await service.register({
      actor: { userId: adminId },
      workspaceId,
      connectionId,
      displayName: "S1.5 durable connection",
      secretReference: reference,
    });

    // Recreate both adapters to prove no process-local binding map is required.
    const restartedConnections = new DrizzleMetaConnectionRepository(transaction);
    const restartedSecrets = new DrizzleEnvironmentMetaSecretRepository(transaction, environment);
    const restarted = new MetaConnectionService({
      memberships,
      connections: restartedConnections,
      secrets: restartedSecrets,
      audit,
      fetchImpl: doctorFetch,
      now: () => timestamp,
      tokenSecurityStatus: () => "rotated",
    });
    const checked = await restarted.doctor({ userId: adminId }, workspaceId, connectionId);
    restartDurable = checked.status === "active" && checked.secretConfigured;

    workspaceIsolated = await restartedConnections.find(foreignWorkspaceId, connectionId)
      .then(() => false, (error) => error instanceof MetaConnectionNotFoundError);
    const wrongScopeDenied = await restartedSecrets.resolve(reference, {
      workspaceId: foreignWorkspaceId,
      connectionId,
    }).then(() => false, (error) => error instanceof MetaSecretAccessError);
    workspaceIsolated &&= wrongScopeDenied;

    await restarted.disconnect({ userId: adminId }, workspaceId, connectionId);
    const disconnectedRows = await transaction.select({
      status: schema.metaConnections.status,
      secretDisabledAt: schema.metaConnections.secretDisabledAt,
      lifecycleGeneration: schema.metaConnections.lifecycleGeneration,
    }).from(schema.metaConnections).where(and(
      eq(schema.metaConnections.workspaceId, workspaceId),
      eq(schema.metaConnections.id, connectionId),
    ));
    const disabledAfterRestart = await new DrizzleEnvironmentMetaSecretRepository(transaction, environment)
      .resolve(reference, scope).then(() => false, (error) => error instanceof MetaSecretAccessError);
    disconnectDisabled = disconnectedRows[0]?.status === "disconnected"
      && disconnectedRows[0].secretDisabledAt !== null
      && disconnectedRows[0].lifecycleGeneration === 2
      && disabledAfterRestart;

    const revokeResult = await restarted.revoke({ userId: adminId }, workspaceId, connectionId);
    upstreamTokenInvalidated = revokeResult.upstreamTokenInvalidated;
    const revokedRows = await transaction.select({
      status: schema.metaConnections.status,
      revokedAt: schema.metaConnections.revokedAt,
      secretDestroyedAt: schema.metaConnections.secretDestroyedAt,
      lifecycleGeneration: schema.metaConnections.lifecycleGeneration,
    }).from(schema.metaConnections).where(eq(schema.metaConnections.id, connectionId));
    revokeDestroyed = revokedRows[0]?.status === "revoked"
      && revokedRows[0].revokedAt !== null
      && revokedRows[0].secretDestroyedAt !== null
      && revokedRows[0].lifecycleGeneration === 3;

    const invalidScope = { workspaceId, connectionId: invalidConnectionId };
    const invalidReference = restartedSecrets.reference(invalidScope);
    const invalidService = new MetaConnectionService({
      memberships,
      connections: restartedConnections,
      secrets: restartedSecrets,
      audit,
      fetchImpl: async () => json({ data: { is_valid: false } }),
      now: () => timestamp,
      tokenSecurityStatus: () => "rotated",
    });
    await invalidService.register({
      actor: { userId: adminId },
      workspaceId,
      connectionId: invalidConnectionId,
      displayName: "S1.5 invalid connection",
      secretReference: invalidReference,
    });
    await invalidService.doctor({ userId: adminId }, workspaceId, invalidConnectionId).catch(() => undefined);
    const invalid = await restartedConnections.find(workspaceId, invalidConnectionId);
    invalidPersisted = invalid.status === "invalid" && invalid.lifecycleGeneration === 2;

    const serializedMetadata = JSON.stringify(await transaction.select({
      secretReferenceId: schema.metaConnections.secretReferenceId,
      secretProvider: schema.metaConnections.secretProvider,
      secretKeyVersion: schema.metaConnections.secretKeyVersion,
      secretBindingName: schema.metaConnections.secretBindingName,
    }).from(schema.metaConnections).where(eq(schema.metaConnections.workspaceId, workspaceId)));
    if (serializedMetadata.includes(fixtureToken)) throw new Error("secret leaked into Postgres metadata");

    if (!restartDurable || !workspaceIsolated || !disconnectDisabled || !revokeDestroyed || !invalidPersisted || upstreamTokenInvalidated) {
      throw new Error("S1.5 Meta connection persistence acceptance failed");
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await pool.end();
}

console.log(JSON.stringify({
  restartDurable,
  workspaceIsolated,
  disconnectDisabled,
  revokeDestroyed,
  invalidPersisted,
  upstreamTokenInvalidated,
  persistedSecretValues: 0,
  writeNetworkCalls: 0,
  temporaryWorkspaceCommitted: false,
}));
