import { describe, expect, it } from "vitest";
import {
  createMetaCompatibilityDraft,
  publishMetaCompatibilityArtifact,
  resolveMetaCompatibility,
  reviewMetaCompatibilityArtifact,
  tombstoneMetaCompatibilityArtifact,
  type MetaCompatibilityArtifact,
  type MetaCompatibilityDimension,
} from "@/domain/meta/promotion/compatibility-artifact";

const workspaceRef = "workspace_alpha";
const selectionHash = "a".repeat(64);
const sourceHash = "b".repeat(64);

function draftMapping(dimension: MetaCompatibilityDimension = "destination", artifactRef = `compat_${dimension}_mapping`) {
  return createMetaCompatibilityDraft({
    artifactRef, revision: 1, workspaceRef, dimension,
    content: { kind: "mapping", scopeRef: "scope_workspace", internalRef: `internal_${dimension}`,
      semanticRef: `semantic_${dimension}`, observedValueHash: "c".repeat(64), constraintsHash: "d".repeat(64) },
    normalizedBy: { actorRef: "actor_analyst", role: "analyst" }, sourceRefs: ["source_meta_review"], sourceHashes: [sourceHash],
  });
}

function reviewed<T extends MetaCompatibilityArtifact>(draft: T, reviewBy = "2026-09-07T10:00:00.000Z") {
  return reviewMetaCompatibilityArtifact({ draft, actor: { actorRef: "actor_owner", role: "owner" },
    decisionRef: "decision_review_compatibility", reviewedAt: "2026-08-07T10:00:00.000Z", reviewBy });
}

function published<T extends MetaCompatibilityArtifact>(source: T) {
  return publishMetaCompatibilityArtifact({ reviewed: reviewed(source), actor: { actorRef: "actor_admin", role: "admin" },
    decisionRef: "decision_publish_compatibility", publishedAt: "2026-08-07T11:00:00.000Z" });
}

function draftEvidence(mapping: MetaCompatibilityArtifact, outcome: "confirmed" | "rejected" | "unknown" = "confirmed", artifactRef = "compat_destination_evidence") {
  return createMetaCompatibilityDraft({
    artifactRef, revision: 1, workspaceRef, dimension: mapping.dimension,
    content: { kind: "evidence", selectionHash,
      mapping: outcome === "unknown" ? null : { artifactRef: mapping.artifactRef, revision: mapping.revision, canonicalHash: mapping.canonicalHash },
      mirrorSnapshotHash: "e".repeat(64), fieldCatalogVersion: "meta-inventory-field-catalog/1.0.0",
      outcome, reasonCode: `compatibility.${outcome}`, observedAt: "2026-08-07T09:00:00.000Z", freshUntil: "2026-08-08T09:00:00.000Z" },
    normalizedBy: { actorRef: "actor_analyst", role: "analyst" }, sourceRefs: ["source_snapshot_review"], sourceHashes: [sourceHash],
  });
}

describe("reviewed Meta compatibility artifacts", () => {
  it("keeps an empty catalog and reviewed-but-unpublished artifacts fully unknown", () => {
    const empty = resolveMetaCompatibility({ workspaceRef, selectionHash, evaluatedAt: "2026-08-07T12:00:00.000Z", artifacts: [] });
    expect(empty.overallStatus).toBe("unknown");
    expect(empty.dimensions).toHaveLength(5);
    expect(empty.dimensions.every((item) => item.status === "unknown" && item.evidenceHash === null)).toBe(true);

    const mapping = published(draftMapping());
    const evidence = reviewed(draftEvidence(mapping));
    const unpublished = resolveMetaCompatibility({ workspaceRef, selectionHash, evaluatedAt: "2026-08-07T12:00:00.000Z", artifacts: [mapping, evidence] });
    expect(unpublished.dimensions.find((item) => item.dimension === "destination")?.status).toBe("unknown");
  });

  it("uses only exact published mapping-backed fresh evidence and never turns partial protection into overall confirmed", () => {
    const mapping = published(draftMapping());
    const evidence = published(draftEvidence(mapping));
    const result = resolveMetaCompatibility({ workspaceRef, selectionHash, evaluatedAt: "2026-08-07T12:00:00.000Z", artifacts: [mapping, evidence] });
    expect(result.dimensions.find((item) => item.dimension === "destination")).toMatchObject({ status: "confirmed", evidenceHash: evidence.canonicalHash });
    expect(result.overallStatus).toBe("unknown");
    expect(Object.values(result.authority).every((value) => value === false)).toBe(true);
  });

  it("fails closed for stale, conflicting, missing-mapping and tombstoned evidence", () => {
    const mapping = published(draftMapping());
    const evidence = published(draftEvidence(mapping));
    const stale = resolveMetaCompatibility({ workspaceRef, selectionHash, evaluatedAt: "2026-08-09T12:00:00.000Z", artifacts: [mapping, evidence] });
    expect(stale.dimensions[0]).toMatchObject({ status: "unknown", reasonCode: "compatibility.evidence_missing_or_stale" });

    const conflict = published(draftEvidence(mapping, "rejected", "compat_destination_evidence_conflict"));
    expect(resolveMetaCompatibility({ workspaceRef, selectionHash, evaluatedAt: "2026-08-07T12:00:00.000Z", artifacts: [mapping, evidence, conflict] })
      .dimensions[0]).toMatchObject({ status: "unknown", reasonCode: "compatibility.evidence_conflict" });

    const missing = resolveMetaCompatibility({ workspaceRef, selectionHash, evaluatedAt: "2026-08-07T12:00:00.000Z", artifacts: [evidence] });
    expect(missing.dimensions[0]).toMatchObject({ status: "unknown", reasonCode: "compatibility.mapping_unavailable" });

    const tombstone = tombstoneMetaCompatibilityArtifact({ published: mapping, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_tombstone_mapping", tombstonedAt: "2026-08-07T13:00:00.000Z" });
    expect(resolveMetaCompatibility({ workspaceRef, selectionHash, evaluatedAt: "2026-08-07T14:00:00.000Z", artifacts: [mapping, tombstone, evidence] })
      .dimensions[0]).toMatchObject({ status: "unknown", reasonCode: "compatibility.mapping_unavailable" });
  });

  it("treats expired mapping or evidence review as unknown even while mirror evidence is otherwise fresh", () => {
    const mappingReview = reviewed(draftMapping(), "2026-08-07T11:30:00.000Z");
    const expiredMapping = publishMetaCompatibilityArtifact({ reviewed: mappingReview, actor: { actorRef: "actor_admin", role: "admin" },
      decisionRef: "decision_publish_expiring_mapping", publishedAt: "2026-08-07T11:00:00.000Z" });
    const validEvidence = published(draftEvidence(expiredMapping));
    expect(resolveMetaCompatibility({ workspaceRef, selectionHash, evaluatedAt: "2026-08-07T12:00:00.000Z", artifacts: [expiredMapping, validEvidence] })
      .dimensions[0]).toMatchObject({ status: "unknown", reasonCode: "compatibility.mapping_unavailable" });

    const mapping = published(draftMapping());
    const evidenceReview = reviewed(draftEvidence(mapping), "2026-08-07T11:30:00.000Z");
    const expiredEvidence = publishMetaCompatibilityArtifact({ reviewed: evidenceReview, actor: { actorRef: "actor_admin", role: "admin" },
      decisionRef: "decision_publish_expiring_evidence", publishedAt: "2026-08-07T11:00:00.000Z" });
    expect(resolveMetaCompatibility({ workspaceRef, selectionHash, evaluatedAt: "2026-08-07T12:00:00.000Z", artifacts: [mapping, expiredEvidence] })
      .dimensions[0]).toMatchObject({ status: "unknown", reasonCode: "compatibility.evidence_missing_or_stale" });
  });

  it("requires a mapping for confirmed/rejected evidence and creates immutable hash-linked lifecycle revisions", () => {
    expect(() => createMetaCompatibilityDraft({
      artifactRef: "compat_invalid_evidence", revision: 1, workspaceRef, dimension: "tracking",
      content: { kind: "evidence", selectionHash, mapping: null, mirrorSnapshotHash: "e".repeat(64),
        fieldCatalogVersion: "catalog/1", outcome: "confirmed", reasonCode: "compatibility.confirmed",
        observedAt: "2026-08-07T09:00:00.000Z", freshUntil: "2026-08-08T09:00:00.000Z" },
      normalizedBy: { actorRef: "actor_analyst", role: "analyst" }, sourceRefs: ["source_review"], sourceHashes: [sourceHash],
    })).toThrow();
    const draft = draftMapping(); const review = reviewed(draft); const publish = publishMetaCompatibilityArtifact({ reviewed: review,
      actor: { actorRef: "actor_owner", role: "owner" }, decisionRef: "decision_publish_mapping", publishedAt: "2026-08-07T11:00:00.000Z" });
    expect([draft, review, publish].map((item) => item.revision)).toEqual([1, 2, 3]);
    expect(review.previousHash).toBe(draft.canonicalHash); expect(publish.previousHash).toBe(review.canonicalHash);
    expect(Object.isFrozen(publish)).toBe(true);
  });
});
