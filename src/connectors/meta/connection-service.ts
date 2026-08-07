import { AppendOnlyAuditLog } from "@/security/audit";
import { ConnectorError } from "@/connectors/contract";
import {
  authorizeWorkspace,
  type Actor,
  type WorkspaceMembership,
} from "@/security/authorization";
import { META_GRAPH_API_VERSION, type MetaFetch } from "./graph-client";
import {
  publicMetaConnection,
  type MetaCapabilitySnapshot,
  type MetaConnection,
  type MetaSecretReference,
  type PublicMetaConnection,
} from "./connection-types";
import { MetaConnectionNotFoundError, type MetaConnectionRepository } from "./connection-repository";
import { inspectMetaConnection } from "./doctor";
import type { MetaSecretRepository } from "./secret-repository";

export class MetaConnectionLifecycleError extends Error {
  readonly publicMessage: string;

  constructor(message: string, publicMessage = "Meta bağlantısı bu işlem için etkin değil") {
    super(message);
    this.name = "MetaConnectionLifecycleError";
    this.publicMessage = publicMessage;
  }
}

export type MetaConnectionServiceOptions = Readonly<{
  memberships: readonly WorkspaceMembership[];
  connections: MetaConnectionRepository;
  secrets: MetaSecretRepository;
  audit: AppendOnlyAuditLog;
  fetchImpl?: MetaFetch;
  now?: () => Date;
}>;

export class MetaConnectionService {
  private readonly now: () => Date;

  constructor(private readonly options: MetaConnectionServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async register(input: Readonly<{
    actor: Actor;
    workspaceId: string;
    connectionId: string;
    displayName: string;
    graphApiVersion?: string;
    secretReference: MetaSecretReference;
  }>): Promise<PublicMetaConnection> {
    const membership = authorizeWorkspace(input.actor, input.workspaceId, "connection:manage", this.options.memberships);
    try {
      await this.options.connections.find(input.workspaceId, input.connectionId);
      throw new MetaConnectionLifecycleError("Connection identifier already exists", "Meta bağlantı kimliği zaten kullanılıyor");
    } catch (error) {
      if (!(error instanceof MetaConnectionNotFoundError)) throw error;
    }
    await this.options.secrets.assertUsable(input.secretReference, {
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
    });
    const timestamp = this.now().toISOString();
    const connection: MetaConnection = Object.freeze({
      id: input.connectionId,
      workspaceId: input.workspaceId,
      displayName: input.displayName.trim() || "Meta Ads",
      graphApiVersion: input.graphApiVersion ?? META_GRAPH_API_VERSION,
      accessMode: "read_only",
      status: "active",
      secretReference: input.secretReference,
      capabilitySnapshot: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      disconnectedAt: null,
      revokedAt: null,
    });
    await this.options.connections.save(connection);
    this.options.audit.append({
      workspaceId: input.workspaceId,
      actorId: membership.userId,
      action: "connection.created",
      resourceType: "meta_connection",
      resourceId: connection.id,
      occurredAt: timestamp,
      metadata: { accessMode: "read_only", graphApiVersion: connection.graphApiVersion },
    });
    return publicMetaConnection(connection);
  }

  async doctor(actor: Actor, workspaceId: string, connectionId: string): Promise<PublicMetaConnection> {
    const membership = authorizeWorkspace(actor, workspaceId, "connection:manage", this.options.memberships);
    const connection = await this.options.connections.find(workspaceId, connectionId);
    this.assertConnected(connection);
    const token = await this.options.secrets.resolve(connection.secretReference, { workspaceId, connectionId });
    let snapshot: MetaCapabilitySnapshot;
    try {
      snapshot = await inspectMetaConnection({
        token,
        graphApiVersion: connection.graphApiVersion,
        fetchImpl: this.options.fetchImpl,
        now: this.now,
      });
    } catch (error) {
      if (error instanceof ConnectorError && error.code === "authentication") {
        await this.markInvalid(connection, membership.userId);
      }
      throw error;
    }
    const updated: MetaConnection = Object.freeze({
      ...connection,
      capabilitySnapshot: snapshot,
      updatedAt: snapshot.capturedAt,
    });
    await this.options.connections.save(updated);
    this.options.audit.append({
      workspaceId,
      actorId: membership.userId,
      action: "connection.doctor_checked",
      resourceType: "meta_connection",
      resourceId: connectionId,
      occurredAt: snapshot.capturedAt,
      metadata: {
        tokenStatus: snapshot.tokenStatus,
        expiryStatus: snapshot.expiryStatus,
        accessibleAdAccounts: snapshot.accessibleAdAccountCount,
        managementGranted: snapshot.capabilities.some((item) => item.granted && !item.enabled),
        writeOperations: 0,
      },
    });
    return publicMetaConnection(updated);
  }

  async disconnect(actor: Actor, workspaceId: string, connectionId: string): Promise<PublicMetaConnection> {
    return this.close(actor, workspaceId, connectionId, "disconnected");
  }

  async revoke(actor: Actor, workspaceId: string, connectionId: string): Promise<Readonly<{
    connection: PublicMetaConnection;
    upstreamTokenInvalidated: false;
    reason: "read_only_boundary";
  }>> {
    const connection = await this.close(actor, workspaceId, connectionId, "revoked");
    return { connection, upstreamTokenInvalidated: false, reason: "read_only_boundary" };
  }

  async list(actor: Actor, workspaceId: string): Promise<readonly PublicMetaConnection[]> {
    authorizeWorkspace(actor, workspaceId, "data:read", this.options.memberships);
    return (await this.options.connections.list(workspaceId)).map(publicMetaConnection);
  }

  private async close(
    actor: Actor,
    workspaceId: string,
    connectionId: string,
    target: "disconnected" | "revoked",
  ): Promise<PublicMetaConnection> {
    const membership = authorizeWorkspace(actor, workspaceId, "connection:manage", this.options.memberships);
    const connection = await this.options.connections.find(workspaceId, connectionId);
    const closable = connection.status === "active" || connection.status === "invalid" || (target === "revoked" && connection.status === "disconnected");
    if (!closable) {
      if (connection.status === target) return publicMetaConnection(connection);
      throw new MetaConnectionLifecycleError(`Cannot move ${connection.status} connection to ${target}`);
    }
    if (target === "disconnected") {
      await this.options.secrets.disable(connection.secretReference, { workspaceId, connectionId });
    } else {
      await this.options.secrets.destroy(connection.secretReference, { workspaceId, connectionId });
    }
    const timestamp = this.now().toISOString();
    const updated: MetaConnection = Object.freeze({
      ...connection,
      status: target,
      capabilitySnapshot: connection.capabilitySnapshot,
      updatedAt: timestamp,
      disconnectedAt: target === "disconnected" ? timestamp : connection.disconnectedAt,
      revokedAt: target === "revoked" ? timestamp : connection.revokedAt,
    });
    await this.options.connections.save(updated);
    this.options.audit.append({
      workspaceId,
      actorId: membership.userId,
      action: target === "disconnected" ? "connection.disconnected" : "connection.revoked",
      resourceType: "meta_connection",
      resourceId: connectionId,
      occurredAt: timestamp,
      metadata: {
        secretUsable: false,
        upstreamTokenInvalidated: false,
        writeOperations: 0,
      },
    });
    return publicMetaConnection(updated);
  }

  private assertConnected(connection: MetaConnection): void {
    if (connection.status !== "active") throw new MetaConnectionLifecycleError(`Connection is ${connection.status}`);
    if (connection.accessMode !== "read_only") throw new MetaConnectionLifecycleError("Writer access mode is not supported");
  }

  private async markInvalid(connection: MetaConnection, actorId: string): Promise<void> {
    const timestamp = this.now().toISOString();
    await this.options.connections.save(Object.freeze({
      ...connection,
      status: "invalid",
      updatedAt: timestamp,
    }));
    this.options.audit.append({
      workspaceId: connection.workspaceId,
      actorId,
      action: "connection.doctor_checked",
      resourceType: "meta_connection",
      resourceId: connection.id,
      occurredAt: timestamp,
      metadata: { tokenStatus: "invalid", writeOperations: 0 },
    });
  }
}
