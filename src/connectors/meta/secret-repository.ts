import { randomUUID } from "node:crypto";
import type { MetaSecretReference } from "./connection-types";

type SecretScope = Readonly<{ workspaceId: string; connectionId: string }>;

type SecretRecord = Readonly<SecretScope & {
  reference: MetaSecretReference;
  value: string;
  enabled: boolean;
}>;

export class MetaSecretAccessError extends Error {
  readonly publicMessage = "Meta bağlantı sırrına erişilemiyor";

  constructor() {
    super("Meta secret reference denied");
    this.name = "MetaSecretAccessError";
  }
}

export interface MetaSecretRepository {
  assertUsable(reference: MetaSecretReference, scope: SecretScope): Promise<void>;
  resolve(reference: MetaSecretReference, scope: SecretScope): Promise<string>;
  disable(reference: MetaSecretReference, scope: SecretScope): Promise<void>;
  destroy(reference: MetaSecretReference, scope: SecretScope): Promise<void>;
}

export class InMemoryMetaSecretRepository implements MetaSecretRepository {
  private readonly records = new Map<string, SecretRecord>();

  store(scope: SecretScope, value: string): MetaSecretReference {
    if (!value.trim()) throw new MetaSecretAccessError();
    const reference: MetaSecretReference = Object.freeze({ id: randomUUID(), provider: "memory", keyVersion: 1 });
    this.records.set(reference.id, Object.freeze({ ...scope, reference, value, enabled: true }));
    return reference;
  }

  async assertUsable(reference: MetaSecretReference, scope: SecretScope): Promise<void> {
    const record = this.scoped(reference, scope);
    if (!record.enabled || !record.value.trim()) throw new MetaSecretAccessError();
  }

  async resolve(reference: MetaSecretReference, scope: SecretScope): Promise<string> {
    const record = this.scoped(reference, scope);
    if (!record.enabled) throw new MetaSecretAccessError();
    return record.value;
  }

  async disable(reference: MetaSecretReference, scope: SecretScope): Promise<void> {
    const record = this.scoped(reference, scope);
    this.records.set(reference.id, Object.freeze({ ...record, enabled: false }));
  }

  async destroy(reference: MetaSecretReference, scope: SecretScope): Promise<void> {
    this.scoped(reference, scope);
    this.records.delete(reference.id);
  }

  private scoped(reference: MetaSecretReference, scope: SecretScope): SecretRecord {
    const record = this.records.get(reference.id);
    if (!record || record.reference.provider !== reference.provider || record.workspaceId !== scope.workspaceId || record.connectionId !== scope.connectionId) {
      throw new MetaSecretAccessError();
    }
    return record;
  }
}

type EnvironmentBinding = Readonly<SecretScope & {
  reference: MetaSecretReference;
  variableName: string;
  enabled: boolean;
}>;

/**
 * Transitional adapter: the reference binds to an environment variable and reads its
 * current value on demand. The token is never copied into the repository.
 */
export class EnvironmentMetaSecretRepository implements MetaSecretRepository {
  private readonly bindings = new Map<string, EnvironmentBinding>();

  constructor(private readonly environment: Record<string, string | undefined> = process.env) {}

  reference(scope: SecretScope, variableName = "META_ACCESS_TOKEN"): MetaSecretReference {
    const reference: MetaSecretReference = Object.freeze({ id: randomUUID(), provider: "environment", keyVersion: 1 });
    this.bindings.set(reference.id, Object.freeze({ ...scope, reference, variableName, enabled: true }));
    return reference;
  }

  async assertUsable(reference: MetaSecretReference, scope: SecretScope): Promise<void> {
    const binding = this.scoped(reference, scope);
    if (!binding.enabled || !this.environment[binding.variableName]?.trim()) throw new MetaSecretAccessError();
  }

  async resolve(reference: MetaSecretReference, scope: SecretScope): Promise<string> {
    const binding = this.scoped(reference, scope);
    const value = this.environment[binding.variableName]?.trim();
    if (!binding.enabled || !value) throw new MetaSecretAccessError();
    return value;
  }

  async disable(reference: MetaSecretReference, scope: SecretScope): Promise<void> {
    const binding = this.scoped(reference, scope);
    this.bindings.set(reference.id, Object.freeze({ ...binding, enabled: false }));
  }

  async destroy(reference: MetaSecretReference, scope: SecretScope): Promise<void> {
    this.scoped(reference, scope);
    this.bindings.delete(reference.id);
  }

  private scoped(reference: MetaSecretReference, scope: SecretScope): EnvironmentBinding {
    const binding = this.bindings.get(reference.id);
    if (!binding || binding.reference.provider !== reference.provider || binding.workspaceId !== scope.workspaceId || binding.connectionId !== scope.connectionId) {
      throw new MetaSecretAccessError();
    }
    return binding;
  }
}
