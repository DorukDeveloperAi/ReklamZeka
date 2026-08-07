import type { MetaConnection } from "./connection-types";

export class MetaConnectionNotFoundError extends Error {
  constructor() {
    super("Meta connection not found in workspace");
    this.name = "MetaConnectionNotFoundError";
  }
}

export interface MetaConnectionRepository {
  save(connection: MetaConnection): Promise<void>;
  find(workspaceId: string, connectionId: string): Promise<MetaConnection>;
  list(workspaceId: string): Promise<readonly MetaConnection[]>;
}

export class InMemoryMetaConnectionRepository implements MetaConnectionRepository {
  private readonly connections = new Map<string, MetaConnection>();

  async save(connection: MetaConnection): Promise<void> {
    const existing = this.connections.get(connection.id);
    if (existing && existing.workspaceId !== connection.workspaceId) throw new MetaConnectionNotFoundError();
    this.connections.set(connection.id, structuredClone(connection));
  }

  async find(workspaceId: string, connectionId: string): Promise<MetaConnection> {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.workspaceId !== workspaceId) throw new MetaConnectionNotFoundError();
    return structuredClone(connection);
  }

  async list(workspaceId: string): Promise<readonly MetaConnection[]> {
    return [...this.connections.values()]
      .filter((connection) => connection.workspaceId === workspaceId)
      .map((connection) => structuredClone(connection));
  }
}
