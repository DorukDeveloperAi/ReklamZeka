import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  AutonomyRuleRegistryRepositoryError,
  DrizzleAutonomyRuleRegistryRepository,
} from "@/connectors/actions/autonomy-rule-registry-drizzle-repository";
import {
  createAutonomyRuleDraft,
  publishAutonomyRule,
  type AutonomyRuleArtifact,
} from "@/domain/actions/autonomy-rule-registry";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const workspaceRef = "workspace_alpha";

function draft(patch: Record<string, unknown> = {}): AutonomyRuleArtifact {
  return createAutonomyRuleDraft({
    ruleRef: "autonomy_workspace_default", revision: 1, workspaceRef,
    scope: { level: "workspace", ref: workspaceRef }, mode: "approval_only",
    effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
    killSwitch: false, maximumActionsPerRun: null,
    normalizedBy: { actorRef: "actor_analyst", role: "analyst" }, sourceGuidanceRefs: [],
    ...patch,
  } as never);
}

function published(source = draft()): AutonomyRuleArtifact {
  return publishAutonomyRule({
    draft: source, actor: { actorRef: "actor_owner", role: "owner" },
    decisionRef: "decision_publish_rule", reasonRef: "reason_reviewed",
    publishedAt: "2026-08-07T12:00:00.000Z",
  });
}

function row(artifact: AutonomyRuleArtifact) {
  return {
    revision: artifact.revision,
    state: artifact.state,
    canonical_hash: artifact.canonicalHash,
    artifact_payload: artifact,
  };
}

function database(results: readonly unknown[]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }));
  return { execute, transaction };
}

describe("Drizzle Autonomy Rule Registry", () => {
  it("appends a first normalized draft inside an active tenant lock", async () => {
    const artifact = draft();
    const db = database([
      { rows: [{ id: workspaceId, lifecycle_state: "active" }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ canonical_hash: artifact.canonicalHash }] },
    ]);
    const repository = new DrizzleAutonomyRuleRegistryRepository(db as never, workspaceId, workspaceRef);
    await expect(repository.append(artifact)).resolves.toEqual({ outcome: "inserted", canonicalHash: artifact.canonicalHash });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(4);
    expect(new PgDialect().sqlToQuery(db.execute.mock.calls[0]![0]).sql).toContain("for update");
  });

  it("treats exact publish replay as unchanged and rejects same-revision conflict", async () => {
    const artifact = published();
    const replayDb = database([
      { rows: [{ id: workspaceId, lifecycle_state: "active" }] },
      { rows: [row(artifact)] },
    ]);
    await expect(new DrizzleAutonomyRuleRegistryRepository(replayDb as never, workspaceId, workspaceRef).append(artifact))
      .resolves.toEqual({ outcome: "unchanged", canonicalHash: artifact.canonicalHash });
    expect(replayDb.execute).toHaveBeenCalledTimes(2);

    const alternative = published(draft({ mode: "denied", killSwitch: true }));
    const conflictDb = database([
      { rows: [{ id: workspaceId, lifecycle_state: "active" }] },
      { rows: [row(artifact)] },
    ]);
    await expect(new DrizzleAutonomyRuleRegistryRepository(conflictDb as never, workspaceId, workspaceRef).append(alternative))
      .rejects.toEqual(expect.objectContaining({ code: "revision_conflict" }));
  });

  it("requires continuous transitions and explicit draft before published", async () => {
    const artifact = published();
    const noDraft = database([
      { rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }, { rows: [] },
    ]);
    await expect(new DrizzleAutonomyRuleRegistryRepository(noDraft as never, workspaceId, workspaceRef).append(artifact))
      .rejects.toEqual(expect.objectContaining({ code: "revision_conflict" }));

    const source = draft();
    const valid = database([
      { rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }, { rows: [row(source)] },
      { rows: [{ canonical_hash: artifact.canonicalHash }] },
    ]);
    await expect(new DrizzleAutonomyRuleRegistryRepository(valid as never, workspaceId, workspaceRef).append(artifact))
      .resolves.toMatchObject({ outcome: "inserted" });
  });

  it("fails closed for cross-tenant artifacts and inactive workspaces", async () => {
    const crossTenant = draft({ workspaceRef: "workspace_other", scope: { level: "workspace", ref: "workspace_other" } });
    const untouched = database([]);
    await expect(new DrizzleAutonomyRuleRegistryRepository(untouched as never, workspaceId, workspaceRef).append(crossTenant))
      .rejects.toEqual(expect.objectContaining({ code: "workspace_scope_mismatch" }));
    expect(untouched.execute).not.toHaveBeenCalled();

    for (const lifecycle_state of ["tombstoning", "tombstoned"] as const) {
      const inactive = database([{ rows: [{ id: workspaceId, lifecycle_state }] }]);
      await expect(new DrizzleAutonomyRuleRegistryRepository(inactive as never, workspaceId, workspaceRef).append(draft()))
        .rejects.toEqual(expect.objectContaining({ code: "inactive_workspace" }));
      expect(inactive.execute).toHaveBeenCalledTimes(1);
    }
  });

  it("resolves only public action-valve rules and strips publication/guidance metadata", async () => {
    const artifact = published(draft({ sourceGuidanceRefs: ["guidance_safety"] }));
    const db = database([
      { rows: [{ id: workspaceId, lifecycle_state: "active" }] },
      { rows: [{ artifact_payload: artifact }] },
    ]);
    const result = await new DrizzleAutonomyRuleRegistryRepository(db as never, workspaceId, workspaceRef).resolve();
    expect(result).toEqual([{
      ruleRef: artifact.ruleRef, workspaceRef, scope: artifact.scope, mode: "approval_only", state: "published",
      effectiveFrom: artifact.effectiveFrom, expiresAt: null, killSwitch: false, maximumActionsPerRun: null,
    }]);
    expect(JSON.stringify(result)).not.toMatch(/guidance|publishedBy|decision|reason|canonicalHash/);
    expect(new PgDialect().sqlToQuery(db.execute.mock.calls[0]![0]).sql).toContain("for share");
  });

  it("exposes no approval grant, execution, guidance promotion, or Meta transport method", () => {
    expect(Object.getOwnPropertyNames(DrizzleAutonomyRuleRegistryRepository.prototype).sort())
      .toEqual(["append", "constructor", "resolve"]);
    expect(() => new DrizzleAutonomyRuleRegistryRepository({} as never, "foreign", workspaceRef))
      .toThrow(AutonomyRuleRegistryRepositoryError);
  });
});
