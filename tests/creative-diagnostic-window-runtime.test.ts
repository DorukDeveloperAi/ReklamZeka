import { describe, expect, it, vi } from "vitest";
import type { MetaConnection } from "@/connectors/meta/connection-types";
import { CreativeDiagnosticWindowInsightSnapshotRepositoryError } from "@/connectors/analyses/creative-diagnostic-window-insight-snapshot-drizzle-repository";
import { ProductionCreativeDiagnosticWindowError, ProductionCreativeDiagnosticWindowService } from "@/server/creative-diagnostic-window-runtime";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const configSnapshotId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const scope = Object.freeze({ workspaceId, configSnapshotId, windowKind: "baseline" as const, startDate: "2026-08-01", endDate: "2026-08-07", settlementPolicyRef: "creative_settlement_1234567890abcdef12345678", observedAt: "2026-08-10T00:00:00.000Z" });
const connection: MetaConnection = Object.freeze({ id: connectionId, workspaceId, displayName: "Meta", graphApiVersion: "v23.0", accessMode: "read_only", status: "active", lifecycleGeneration: 1, secretReference: Object.freeze({ id: "secret", provider: "environment", keyVersion: 1, bindingName: "META_ACCESS_TOKEN" }), capabilitySnapshot: null, createdAt: scope.observedAt, updatedAt: scope.observedAt, disconnectedAt: null, revokedAt: null });

function fixture(overrides: Readonly<{ scope?: unknown; writerError?: unknown }> = {}) {
  const connectionScope = vi.fn(async () => connectionId);
  const connectionFind = vi.fn(async () => connection);
  const secretResolve = vi.fn(async () => "private-token");
  const materializeAllDays = vi.fn(async () => ({ snapshotHash: "a".repeat(64), sourceRef: "creative_window_1234567890abcdef12345678", inserted: true }));
  if (overrides.writerError) materializeAllDays.mockRejectedValue(overrides.writerError);
  const createWriter = vi.fn(() => ({ materializeAllDays }));
  const scopeResolve = vi.fn(async () => overrides.scope ?? scope);
  const service = new ProductionCreativeDiagnosticWindowService({ scopeResolver: { resolve: scopeResolve as never }, connectionScope: { resolve: connectionScope }, connections: { find: connectionFind, list: vi.fn(), save: vi.fn() }, secrets: { resolve: secretResolve, assertUsable: vi.fn(), disable: vi.fn(), destroy: vi.fn() }, createWriter: createWriter as never });
  return { service, connectionScope, connectionFind, secretResolve, materializeAllDays, createWriter };
}

describe("production creative diagnostic window runtime", () => {
  it("derives connection and token server-side and exposes only a redacted, non-authoritative result", async () => {
    const subject = fixture();
    await expect(subject.service.materialize()).resolves.toEqual({ snapshotHash: "a".repeat(64), sourceRef: "creative_window_1234567890abcdef12345678", inserted: true, readOnlyGraphGet: true, canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false });
    expect(subject.connectionScope).toHaveBeenCalledWith(workspaceId, configSnapshotId);
    expect(subject.connectionFind).toHaveBeenCalledWith(workspaceId, connectionId);
    expect(subject.secretResolve).toHaveBeenCalledWith(connection.secretReference, { workspaceId, connectionId });
    expect(subject.createWriter).toHaveBeenCalledWith("private-token", "v23.0");
    expect(subject.materializeAllDays).toHaveBeenCalledWith(scope);
  });

  it("fails closed before a secret or source call for invalid derived scope", async () => {
    const subject = fixture({ scope: { ...scope, startDate: "bad" } });
    await expect(subject.service.materialize()).rejects.toEqual(new ProductionCreativeDiagnosticWindowError("scope_unavailable"));
    expect(subject.secretResolve).not.toHaveBeenCalled();
    expect(subject.materializeAllDays).not.toHaveBeenCalled();
  });

  it("redacts typed source insufficiency without leaking its internal cause", async () => {
    const subject = fixture({ writerError: new CreativeDiagnosticWindowInsightSnapshotRepositoryError("insufficient_evidence") });
    await expect(subject.service.materialize()).rejects.toEqual(new ProductionCreativeDiagnosticWindowError("insufficient_evidence"));
  });
});
