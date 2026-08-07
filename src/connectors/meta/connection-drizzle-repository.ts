import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import type {
  MetaCapabilitySnapshot,
  MetaConnection,
  MetaConnectionStatus,
  MetaSecretReference,
} from "./connection-types";
import {
  MetaConnectionConflictError,
  MetaConnectionNotFoundError,
  type MetaConnectionRepository,
} from "./connection-repository";

type ReklamZekaDatabase = NodePgDatabase<typeof schema>;
type ConnectionRow = typeof schema.metaConnections.$inferSelect;

const FIELD_CATALOG_VERSION = "meta-connection-capabilities-v1";

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function requireEnvironmentReference(row: ConnectionRow): MetaSecretReference {
  if (
    row.secretProvider !== "environment"
    || !row.secretReferenceId
    || !row.secretBindingName
    || !row.secretKeyVersion
    || row.secretKeyVersion < 1
  ) {
    throw new MetaConnectionConflictError();
  }
  return Object.freeze({
    id: row.secretReferenceId,
    provider: "environment",
    keyVersion: row.secretKeyVersion,
    bindingName: row.secretBindingName,
  });
}

function capabilitySnapshot(value: Record<string, unknown>): MetaCapabilitySnapshot | null {
  if (Object.keys(value).length === 0) return null;
  if (
    typeof value.capturedAt !== "string"
    || typeof value.graphApiVersion !== "string"
    || (value.tokenStatus !== "valid" && value.tokenStatus !== "invalid")
    || !Array.isArray(value.grantedScopes)
    || !Array.isArray(value.capabilities)
    || typeof value.accessibleAdAccountCount !== "number"
    || typeof value.principal !== "object"
    || value.principal === null
  ) {
    throw new MetaConnectionConflictError();
  }
  return value as MetaCapabilitySnapshot;
}

function mapRow(row: ConnectionRow): MetaConnection {
  if (row.lifecycleGeneration < 1) throw new MetaConnectionConflictError();
  if (
    (row.status === "active" && (row.secretDisabledAt || row.secretDestroyedAt))
    || (row.status === "disconnected" && !row.secretDisabledAt)
    || (row.status === "revoked" && (!row.secretDisabledAt || !row.secretDestroyedAt || !row.revokedAt))
  ) {
    throw new MetaConnectionConflictError();
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    displayName: row.displayName,
    graphApiVersion: row.graphApiVersion,
    accessMode: "read_only",
    status: row.status,
    lifecycleGeneration: row.lifecycleGeneration,
    secretReference: requireEnvironmentReference(row),
    capabilitySnapshot: capabilitySnapshot(row.capabilitySnapshot),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    disconnectedAt: iso(row.disconnectedAt),
    revokedAt: iso(row.revokedAt),
  });
}

/** Server-only connection metadata adapter. Secret values never enter Postgres. */
export class DrizzleMetaConnectionRepository implements MetaConnectionRepository {
  constructor(private readonly database: ReklamZekaDatabase) {}

  async save(connection: MetaConnection, guard?: Readonly<{
    expectedLifecycleGeneration: number;
    expectedStatus: MetaConnectionStatus;
  }>): Promise<void> {
    if (
      connection.secretReference.provider !== "environment"
      || !connection.secretReference.bindingName
      || connection.secretReference.keyVersion < 1
    ) {
      throw new MetaConnectionConflictError();
    }

    await this.database.transaction(async (transaction) => {
      const current = await transaction.select({
        workspaceId: schema.metaConnections.workspaceId,
      }).from(schema.metaConnections).where(eq(schema.metaConnections.id, connection.id)).limit(1);

      if (!current[0]) {
        if (guard) throw new MetaConnectionConflictError();
        await transaction.insert(schema.metaConnections).values({
          id: connection.id,
          workspaceId: connection.workspaceId,
          externalConnectionKey: connection.id,
          displayName: connection.displayName,
          graphApiVersion: connection.graphApiVersion,
          fieldCatalogVersion: FIELD_CATALOG_VERSION,
          status: connection.status,
          grantedScopes: connection.capabilitySnapshot?.grantedScopes ?? [],
          enabledCapabilities: connection.capabilitySnapshot?.capabilities
            .filter((item) => item.enabled).map((item) => item.capability) ?? [],
          capabilitySnapshot: connection.capabilitySnapshot ?? {},
          capabilityCheckedAt: connection.capabilitySnapshot
            ? new Date(connection.capabilitySnapshot.capturedAt) : null,
          tokenExpiresAt: connection.capabilitySnapshot?.expiresAt
            ? new Date(connection.capabilitySnapshot.expiresAt) : null,
          dataAccessExpiresAt: connection.capabilitySnapshot?.dataAccessExpiresAt
            ? new Date(connection.capabilitySnapshot.dataAccessExpiresAt) : null,
          secretReferenceId: connection.secretReference.id,
          secretProvider: connection.secretReference.provider,
          secretKeyVersion: connection.secretReference.keyVersion,
          secretBindingName: connection.secretReference.bindingName,
          lifecycleGeneration: connection.lifecycleGeneration,
          disconnectedAt: connection.disconnectedAt ? new Date(connection.disconnectedAt) : null,
          revokedAt: connection.revokedAt ? new Date(connection.revokedAt) : null,
          createdAt: new Date(connection.createdAt),
          updatedAt: new Date(connection.updatedAt),
        });
        return;
      }

      if (current[0].workspaceId !== connection.workspaceId || !guard) {
        throw new MetaConnectionConflictError();
      }
      const updated = await transaction.update(schema.metaConnections).set({
        displayName: connection.displayName,
        graphApiVersion: connection.graphApiVersion,
        status: connection.status,
        grantedScopes: connection.capabilitySnapshot?.grantedScopes ?? [],
        enabledCapabilities: connection.capabilitySnapshot?.capabilities
          .filter((item) => item.enabled).map((item) => item.capability) ?? [],
        capabilitySnapshot: connection.capabilitySnapshot ?? {},
        capabilityCheckedAt: connection.capabilitySnapshot
          ? new Date(connection.capabilitySnapshot.capturedAt) : null,
        tokenExpiresAt: connection.capabilitySnapshot?.expiresAt
          ? new Date(connection.capabilitySnapshot.expiresAt) : null,
        dataAccessExpiresAt: connection.capabilitySnapshot?.dataAccessExpiresAt
          ? new Date(connection.capabilitySnapshot.dataAccessExpiresAt) : null,
        lifecycleGeneration: connection.lifecycleGeneration,
        disconnectedAt: connection.disconnectedAt ? new Date(connection.disconnectedAt) : null,
        revokedAt: connection.revokedAt ? new Date(connection.revokedAt) : null,
        updatedAt: new Date(connection.updatedAt),
      }).where(and(
        eq(schema.metaConnections.id, connection.id),
        eq(schema.metaConnections.workspaceId, connection.workspaceId),
        eq(schema.metaConnections.lifecycleGeneration, guard.expectedLifecycleGeneration),
        eq(schema.metaConnections.status, guard.expectedStatus),
      )).returning({ id: schema.metaConnections.id });
      if (!updated[0]) throw new MetaConnectionConflictError();
    });
  }

  async find(workspaceId: string, connectionId: string): Promise<MetaConnection> {
    const rows = await this.database.select().from(schema.metaConnections).where(and(
      eq(schema.metaConnections.workspaceId, workspaceId),
      eq(schema.metaConnections.id, connectionId),
    )).limit(1);
    if (!rows[0]) throw new MetaConnectionNotFoundError();
    return mapRow(rows[0]);
  }

  async list(workspaceId: string): Promise<readonly MetaConnection[]> {
    const rows = await this.database.select().from(schema.metaConnections).where(
      eq(schema.metaConnections.workspaceId, workspaceId),
    );
    return rows.map(mapRow);
  }
}
