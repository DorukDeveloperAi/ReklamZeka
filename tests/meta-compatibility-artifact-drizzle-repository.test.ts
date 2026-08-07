import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleMetaCompatibilityArtifactRepository,
  MetaCompatibilityArtifactRepositoryError,
} from "@/connectors/meta/promotion/compatibility-artifact-drizzle-repository";
import {
  createMetaCompatibilityDraft,
  publishMetaCompatibilityArtifact,
  reviewMetaCompatibilityArtifact,
  tombstoneMetaCompatibilityArtifact,
  type MetaCompatibilityArtifact,
} from "@/domain/meta/promotion/compatibility-artifact";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const workspaceRef = "workspace_alpha";

function draft(targetWorkspaceRef = workspaceRef, artifactRef = "compat_destination_mapping"): MetaCompatibilityArtifact {
  return createMetaCompatibilityDraft({
    artifactRef, revision: 1, workspaceRef: targetWorkspaceRef, dimension: "destination",
    content: { kind: "mapping", scopeRef: "scope_workspace", internalRef: "destination_lead_form",
      semanticRef: "semantic_destination", observedValueHash: "a".repeat(64), constraintsHash: "b".repeat(64) },
    normalizedBy: { actorRef: "actor_analyst", role: "analyst" }, sourceRefs: ["source_review"], sourceHashes: ["c".repeat(64)],
  });
}
function reviewed(source = draft()): MetaCompatibilityArtifact {
  return reviewMetaCompatibilityArtifact({ draft: source, actor: { actorRef: "actor_owner", role: "owner" },
    decisionRef: "decision_review_mapping", reviewedAt: "2026-08-07T10:00:00.000Z", reviewBy: "2026-09-07T10:00:00.000Z" });
}
function published(source = reviewed()): MetaCompatibilityArtifact {
  return publishMetaCompatibilityArtifact({ reviewed: source, actor: { actorRef: "actor_admin", role: "admin" },
    decisionRef: "decision_publish_mapping", publishedAt: "2026-08-07T11:00:00.000Z" });
}
function row(artifact: MetaCompatibilityArtifact) {
  return { revision: artifact.revision, state: artifact.state, canonical_hash: artifact.canonicalHash, artifact_payload: artifact };
}
function database(results: readonly unknown[]) {
  const execute = vi.fn(); for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }));
  return { execute, transaction };
}

describe("Drizzle Meta compatibility artifact registry", () => {
  it("appends the first draft under an active tenant update lock", async () => {
    const artifact = draft(); const db = database([
      { rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }, { rows: [] },
      { rows: [{ canonical_hash: artifact.canonicalHash }] },
    ]);
    await expect(new DrizzleMetaCompatibilityArtifactRepository(db as never, workspaceId, workspaceRef).append(artifact))
      .resolves.toEqual({ outcome: "inserted", canonicalHash: artifact.canonicalHash });
    expect(new PgDialect().sqlToQuery(db.execute.mock.calls[0]![0]).sql).toContain("for update");
    expect(new PgDialect().sqlToQuery(db.execute.mock.calls[3]![0]).sql).toContain("meta_compatibility_artifact_revisions");
  });

  it("accepts exact replay and rejects revision or lifecycle gaps", async () => {
    const artifact = reviewed();
    const replay = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [row(artifact)] }]);
    await expect(new DrizzleMetaCompatibilityArtifactRepository(replay as never, workspaceId, workspaceRef).append(artifact))
      .resolves.toMatchObject({ outcome: "unchanged" });

    const publish = published(artifact);
    const valid = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }, { rows: [row(artifact)] },
      { rows: [{ canonical_hash: publish.canonicalHash }] }]);
    await expect(new DrizzleMetaCompatibilityArtifactRepository(valid as never, workspaceId, workspaceRef).append(publish))
      .resolves.toMatchObject({ outcome: "inserted" });

    const tombstone = tombstoneMetaCompatibilityArtifact({ published: publish, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_tombstone_mapping", tombstonedAt: "2026-08-07T12:00:00.000Z" });
    const gap = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }, { rows: [row(artifact)] }]);
    await expect(new DrizzleMetaCompatibilityArtifactRepository(gap as never, workspaceId, workspaceRef).append(tombstone))
      .rejects.toEqual(expect.objectContaining({ code: "revision_conflict" }));
  });

  it("returns five unknown dimensions for an empty tenant registry", async () => {
    const db = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }]);
    const result = await new DrizzleMetaCompatibilityArtifactRepository(db as never, workspaceId, workspaceRef)
      .resolve("a".repeat(64), "2026-08-07T12:00:00.000Z");
    expect(result.overallStatus).toBe("unknown");
    expect(result.dimensions).toHaveLength(5);
    expect(result.dimensions.every((entry) => entry.status === "unknown")).toBe(true);
    expect(new PgDialect().sqlToQuery(db.execute.mock.calls[0]![0]).sql).toContain("for share");
  });

  it("blocks cross-tenant/inactive writes and exposes no action, approval, execution or Meta methods", async () => {
    const cross = draft("workspace_other", "compat_cross_mapping");
    const untouched = database([]);
    await expect(new DrizzleMetaCompatibilityArtifactRepository(untouched as never, workspaceId, workspaceRef).append(cross))
      .rejects.toEqual(expect.objectContaining({ code: "workspace_scope_mismatch" }));
    expect(untouched.execute).not.toHaveBeenCalled();
    for (const lifecycle_state of ["tombstoning", "tombstoned"]) {
      const inactive = database([{ rows: [{ id: workspaceId, lifecycle_state }] }]);
      await expect(new DrizzleMetaCompatibilityArtifactRepository(inactive as never, workspaceId, workspaceRef).append(draft()))
        .rejects.toEqual(expect.objectContaining({ code: "inactive_workspace" }));
    }
    expect(Object.getOwnPropertyNames(DrizzleMetaCompatibilityArtifactRepository.prototype).sort())
      .toEqual(["append", "constructor", "listArtifacts", "resolve"]);
    expect(() => new DrizzleMetaCompatibilityArtifactRepository({} as never, "invalid", workspaceRef))
      .toThrow(MetaCompatibilityArtifactRepositoryError);
  });
});
