import { describe, expect, it, vi } from "vitest";

import {
  META_DATA_LIFECYCLE_POLICY,
  MetaPersistencePolicyError,
  RawMaterialPurgeBoundary,
  RawMaterialPurgeBoundaryError,
  assertHashOnlyMetaPersistence,
  buildWorkspaceTombstonePlan,
  inspectMetaPersistenceWrite,
  pseudonymizeWorkspaceValue,
  type RawMaterialInventory,
  type RawMaterialPurgeApprovalPort,
  type RawMaterialPurgePort,
} from "@/domain/meta/data-lifecycle";

describe("Meta hash-only data lifecycle policy", () => {
  it("fixes raw retention at hash-only / zero days", () => {
    expect(META_DATA_LIFECYCLE_POLICY).toMatchObject({
      rawRetentionMode: "hash_only",
      rawRetentionDays: 0,
      hardWorkspaceDeleteAllowed: false,
      auditMutationAllowed: false,
    });
  });

  it("allows canonical copy and provenance hashes but rejects raw payloads and secrets", () => {
    expect(inspectMetaPersistenceWrite({
      sourceMessage: "canonical copy",
      sourceCaption: "canonical caption",
      body: "canonical body",
      rawPayloadHash: "a".repeat(64),
      provenance: { sourcePayloadHash: "b".repeat(64) },
    }).compliant).toBe(true);

    const report = inspectMetaPersistenceWrite({
      rawPayload: { id: "upstream-id" },
      nested: { access_token: "secret" },
      rawResponse: new Uint8Array([1, 2, 3]),
    });
    expect(report.compliant).toBe(false);
    expect(report.violationCodes).toEqual(["RAW_PAYLOAD_FIELD", "SECRET_FIELD"]);
    expect(JSON.stringify(report)).not.toContain("upstream-id");
    expect(JSON.stringify(report)).not.toContain("secret");
    expect(() => assertHashOnlyMetaPersistence({ graphPayload: {} })).toThrow(MetaPersistencePolicyError);
  });
});

describe("raw material purge boundary", () => {
  function fixture(): {
    port: RawMaterialPurgePort;
    approvals: RawMaterialPurgeApprovalPort & { authorize: ReturnType<typeof vi.fn<(input: unknown) => Promise<boolean>>> };
    setInventory(value: RawMaterialInventory): void;
  } {
    let inventory: RawMaterialInventory = {
      revision: "revision-a",
      candidates: [
        { internalRef: "private-row-1", kind: "graph_response", capturedAt: "2026-08-07T10:00:00Z" },
        { internalRef: "private-row-2", kind: "debug_capture", capturedAt: "2026-08-07T10:01:00Z" },
      ],
    };
    const inspect = vi.fn(async () => inventory);
    const purge = vi.fn(async (input: { internalRefs: readonly string[] }) => ({
      deleted: input.internalRefs.length,
      revision: "revision-b",
    }));
    return {
      port: { inspect, purge },
      approvals: { authorize: vi.fn(async (_input: unknown) => true) },
      setInventory(value) { inventory = value; },
    };
  }

  it("returns only aggregate, masked dry-run evidence and requires explicit approval", async () => {
    const { port, approvals } = fixture();
    const boundary = new RawMaterialPurgeBoundary(port, approvals);
    const preview = await boundary.dryRun({ workspaceId: "workspace-private" }, "2026-08-07T11:00:00Z");

    expect(preview).toMatchObject({ mode: "dry_run", candidateCount: 2 });
    expect(preview.candidatesByKind).toMatchObject({ graph_response: 1, debug_capture: 1 });
    expect(JSON.stringify(preview)).not.toContain("workspace-private");
    expect(JSON.stringify(preview)).not.toContain("private-row");
    await expect(boundary.execute({
      planRef: preview.planRef,
      approvalRef: "",
      now: "2026-08-07T11:01:00Z",
    })).rejects.toMatchObject({ code: "approval_required" });
    expect(approvals.authorize).not.toHaveBeenCalled();
    expect(port.purge).not.toHaveBeenCalled();
  });

  it("requires an application-owned approval verifier instead of trusting a caller boolean", async () => {
    const { port, approvals } = fixture();
    approvals.authorize.mockResolvedValue(false);
    const boundary = new RawMaterialPurgeBoundary(port, approvals);
    const preview = await boundary.dryRun({ workspaceId: "workspace-private" }, "2026-08-07T11:00:00Z");

    await expect(boundary.execute({
      planRef: preview.planRef,
      approvalRef: "untrusted-agent-claim",
      now: "2026-08-07T11:01:00Z",
    })).rejects.toMatchObject({ code: "approval_required" });
    expect(port.purge).not.toHaveBeenCalled();
  });

  it("executes an unchanged plan once and keeps private row references out of the result", async () => {
    const { port, approvals } = fixture();
    const boundary = new RawMaterialPurgeBoundary(port, approvals);
    const preview = await boundary.dryRun({ workspaceId: "workspace-private" }, "2026-08-07T11:00:00Z");
    const result = await boundary.execute({
      planRef: preview.planRef,
      approvalRef: "approved-action",
      now: "2026-08-07T11:01:00Z",
    });

    expect(result).toMatchObject({ mode: "execute", deletedCount: 2, scopeRef: preview.scopeRef });
    expect(JSON.stringify(result)).not.toContain("workspace-private");
    expect(JSON.stringify(result)).not.toContain("private-row");
    await expect(boundary.execute({
      planRef: preview.planRef,
      approvalRef: "approved-action",
      now: "2026-08-07T11:02:00Z",
    })).rejects.toMatchObject({ code: "plan_consumed" });
  });

  it("fails closed when the inventory changes after dry-run", async () => {
    const { port, approvals, setInventory } = fixture();
    const boundary = new RawMaterialPurgeBoundary(port, approvals);
    const preview = await boundary.dryRun({ workspaceId: "workspace-private" }, "2026-08-07T11:00:00Z");
    setInventory({ revision: "revision-changed", candidates: [] });

    await expect(boundary.execute({
      planRef: preview.planRef,
      approvalRef: "approved-action",
      now: "2026-08-07T11:01:00Z",
    })).rejects.toBeInstanceOf(RawMaterialPurgeBoundaryError);
    expect(port.purge).not.toHaveBeenCalled();
  });
});

describe("workspace anonymized tombstone", () => {
  it("keeps the workspace and audit chain while planning secret destruction and pseudonymization", () => {
    const plan = buildWorkspaceTombstonePlan({ workspaceId: "workspace-private", currentState: "active" });
    expect(plan.hardDelete).toBe(false);
    expect(plan.steps.map((step) => step.action)).toEqual([
      "append_request_audit",
      "disable_connections",
      "destroy_secrets",
      "pseudonymize_canonical_data",
      "append_completion_audit",
      "mark_tombstoned",
    ]);
    expect(plan.schemaPrerequisites).toContain("audit_workspace_fk_restrict");
    expect(JSON.stringify(plan)).not.toContain("workspace-private");
  });

  it("uses keyed, workspace-scoped stable pseudonyms", () => {
    const key = new Uint8Array(32).fill(7);
    const first = pseudonymizeWorkspaceValue({
      workspaceId: "workspace-a",
      namespace: "meta-account",
      value: "external-value",
      key,
      keyVersion: 1,
    });
    const same = pseudonymizeWorkspaceValue({
      workspaceId: "workspace-a",
      namespace: "meta-account",
      value: "external-value",
      key,
      keyVersion: 1,
    });
    const otherWorkspace = pseudonymizeWorkspaceValue({
      workspaceId: "workspace-b",
      namespace: "meta-account",
      value: "external-value",
      key,
      keyVersion: 1,
    });
    expect(first).toBe(same);
    expect(first).not.toBe(otherWorkspace);
    expect(first).not.toContain("external-value");
  });
});
