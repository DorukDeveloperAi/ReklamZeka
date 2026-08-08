import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import type { MetaSecretReference } from "./connection-types";
import {
  MetaSecretAccessError,
  type MetaSecretRepository,
} from "./secret-repository";

type ReklamZekaDatabase = NodePgDatabase<typeof schema>;
type SecretScope = Readonly<{ workspaceId: string; connectionId: string }>;

function validBindingName(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{1,127}$/.test(value) && !value.startsWith("NEXT_PUBLIC_");
}

function referenceId(scope: SecretScope, bindingName: string, keyVersion: number): string {
  return createHash("sha256")
    .update(`reklamzeka:meta-environment:${keyVersion}:${scope.workspaceId}:${scope.connectionId}:${bindingName}`)
    .digest("hex");
}

/**
 * Restart-durable environment binding adapter. Only the variable name and an
 * opaque deterministic reference are stored; the environment value is read on
 * demand and never written to Postgres.
 */
export class DrizzleEnvironmentMetaSecretRepository implements MetaSecretRepository {
  constructor(
    private readonly database: ReklamZekaDatabase,
    private readonly environment: Record<string, string | undefined> = process.env,
    private readonly now: () => Date = () => new Date(),
    private readonly allowedBindingNames: ReadonlySet<string> = new Set(["META_ACCESS_TOKEN"]),
  ) {}

  reference(scope: SecretScope, bindingName = "META_ACCESS_TOKEN", keyVersion = 1): MetaSecretReference {
    if (
      !validBindingName(bindingName)
      || !this.allowedBindingNames.has(bindingName)
      || keyVersion < 1
      || !Number.isSafeInteger(keyVersion)
    ) {
      throw new MetaSecretAccessError();
    }
    return Object.freeze({
      id: referenceId(scope, bindingName, keyVersion),
      provider: "environment",
      keyVersion,
      bindingName,
    });
  }

  async assertUsable(reference: MetaSecretReference, scope: SecretScope): Promise<void> {
    this.assertReference(reference, scope);
    const rows = await this.binding(reference, scope);
    if (rows.length > 0 && !this.rowUsable(rows[0]!)) throw new MetaSecretAccessError();
    if (!this.environment[reference.bindingName!]?.trim()) throw new MetaSecretAccessError();
  }

  async resolve(reference: MetaSecretReference, scope: SecretScope): Promise<string> {
    this.assertReference(reference, scope);
    const rows = await this.binding(reference, scope);
    if (rows.length !== 1 || !this.rowUsable(rows[0]!)) throw new MetaSecretAccessError();
    const value = this.environment[reference.bindingName!]?.trim();
    if (!value) throw new MetaSecretAccessError();
    return value;
  }

  async disable(reference: MetaSecretReference, scope: SecretScope): Promise<void> {
    this.assertReference(reference, scope);
    const timestamp = this.now();
    const changed = await this.database.update(schema.metaConnections).set({
      secretDisabledAt: timestamp,
      updatedAt: timestamp,
    }).where(and(
      this.scopePredicate(reference, scope),
      isNull(schema.metaConnections.secretDisabledAt),
      isNull(schema.metaConnections.secretDestroyedAt),
    )).returning({ id: schema.metaConnections.id });
    if (changed.length !== 1) throw new MetaSecretAccessError();
  }

  async destroy(reference: MetaSecretReference, scope: SecretScope): Promise<void> {
    this.assertReference(reference, scope);
    const timestamp = this.now();
    const changed = await this.database.update(schema.metaConnections).set({
      secretDisabledAt: sql`coalesce(${schema.metaConnections.secretDisabledAt}, ${timestamp})`,
      secretDestroyedAt: timestamp,
      updatedAt: timestamp,
    }).where(and(
      this.scopePredicate(reference, scope),
      isNull(schema.metaConnections.secretDestroyedAt),
    )).returning({ id: schema.metaConnections.id });
    if (changed.length !== 1) throw new MetaSecretAccessError();
  }

  private assertReference(reference: MetaSecretReference, scope: SecretScope): void {
    if (
      reference.provider !== "environment"
      || !reference.bindingName
      || !validBindingName(reference.bindingName)
      || !this.allowedBindingNames.has(reference.bindingName)
      || reference.keyVersion < 1
      || reference.id !== referenceId(scope, reference.bindingName, reference.keyVersion)
    ) {
      throw new MetaSecretAccessError();
    }
  }

  private scopePredicate(reference: MetaSecretReference, scope: SecretScope) {
    return and(
      eq(schema.metaConnections.id, scope.connectionId),
      eq(schema.metaConnections.workspaceId, scope.workspaceId),
      eq(schema.metaConnections.secretReferenceId, reference.id),
      eq(schema.metaConnections.secretProvider, "environment"),
      eq(schema.metaConnections.secretKeyVersion, reference.keyVersion),
      eq(schema.metaConnections.secretBindingName, reference.bindingName!),
    )!;
  }

  private binding(reference: MetaSecretReference, scope: SecretScope) {
    return this.database.select({
      status: schema.metaConnections.status,
      secretDisabledAt: schema.metaConnections.secretDisabledAt,
      secretDestroyedAt: schema.metaConnections.secretDestroyedAt,
    }).from(schema.metaConnections).where(this.scopePredicate(reference, scope)).limit(1);
  }

  private rowUsable(row: Readonly<{
    status: string;
    secretDisabledAt: Date | null;
    secretDestroyedAt: Date | null;
  }>): boolean {
    return row.status === "active" && !row.secretDisabledAt && !row.secretDestroyedAt;
  }
}
