import { PgDialect } from "drizzle-orm/pg-core";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createPolicyScopeSnapshot, createTrustedPolicyCatalog } from "@/application/trusted-policy-composition";
import { DrizzleTrustedPolicyAuthorityRepository } from
  "@/connectors/policies/trusted-policy-authority-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value; }
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

describe("DrizzleTrustedPolicyAuthorityRepository", () => {
  it("uses protected current heads and requires an exact immutable ref/hash pair for replay", async () => {
    const migration = readFileSync("drizzle/20260810080038_chubby_deadpool.sql", "utf8");
    for (const table of ["policy_authority_catalogs", "tenant_authority_snapshot_heads"]) {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("policy_authority_catalog_head_occ_conflict");
    expect(migration).toContain("tenant_authority_snapshot_head_occ_conflict");
    expect(migration).toContain("policy_authority_catalog_revisions_chain_trigger");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
    const execute = vi.fn();
    await expect(new DrizzleTrustedPolicyAuthorityRepository({ execute } as never).load({ workspaceId,
      accountRef: "account_primary", evaluatedAt: "2026-08-09T12:00:00.000Z", snapshotRef: "authority_snapshot_primary" }))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps topic/category/semantic authority evidence tenant-scoped, revoked, and append-only", () => {
    const migration = readFileSync("drizzle/20260810073556_lean_inertia.sql", "utf8");
    for (const table of ["authority_topics", "authority_topic_revisions", "category_topic_bindings", "policy_semantic_binding_revisions"]) {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("authority_topics_head_trigger");
    for (const table of ["authority_topic_revisions", "category_topic_bindings", "policy_semantic_binding_revisions"]) {
      expect(migration).toContain(`${table}_append_only_trigger`);
    }
    expect(migration).toContain("authority_topic_revisions_topic_scope_fk");
    expect(migration).toContain("category_topic_bindings_category_scope_fk");
    expect(migration).toContain("category_topic_bindings_topic_scope_fk");
    expect(migration).toContain("policy_semantic_binding_revisions_policy_scope_fk");
    expect(migration).toContain("authority_topic_head_occ_conflict");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  });

  it("fails closed when no current repository-verified tenant snapshot exists", async () => {
    const execute = vi.fn(async () => execute.mock.calls.length === 1 ? { rows: [{ id: workspaceId }] } : { rows: [] });
    await expect(new DrizzleTrustedPolicyAuthorityRepository({ execute } as never).load({ workspaceId,
      accountRef: "account_primary", evaluatedAt: "2026-08-09T12:00:00.000Z" }))
      .rejects.toMatchObject({ code: "not_found" });
    const rendered = new PgDialect().sqlToQuery((execute.mock.calls as unknown[][])[1]![0] as never).sql;
    for (const family of ["tenant_authority_snapshots", "policy_authority_catalog_revisions", "policy_authority_bindings",
      "policy_manual_lock_revisions", "account_group_account_bindings", "account_groups", "authority_topics",
      "authority_topic_revisions", "policy_semantic_binding_revisions", "ad_accounts", "tenant_authority_snapshot_heads",
      "policy_authority_catalogs"]) expect(rendered).toContain(family);
  });

  it("rejects malformed scope before reading tenant records", async () => {
    const execute = vi.fn();
    await expect(new DrizzleTrustedPolicyAuthorityRepository({ execute } as never).load({ workspaceId: "bad",
      accountRef: "account_primary", evaluatedAt: "2026-08-09T12:00:00.000Z" }))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("binds the repository composition closure to the loaded account", async () => {
    const catalog = createTrustedPolicyCatalog({ workspaceRef: "workspace_primary", catalogRef: "authority_catalog_primary",
      catalogVersion: 1, instructionPolicyRegistryHash: "a".repeat(64), bindings: [{ policyRef: "policy_primary", policyVersion: 1,
        policyHash: "b".repeat(64), authorityTier: "metric_rule", decision: { decisionKey: "budget", positionKey: "hold" },
        categoryProfileRef: null, categoryProfileVersion: null, categoryProfileHash: null, manualLockRef: null }] });
    const scope = createPolicyScopeSnapshot({ workspaceRef: "workspace_primary", evaluatedAt: "2026-08-09T12:00:00.000Z",
      accountGroupRefs: ["account_group_primary"], objectiveRefs: [], topicRefs: ["topic_budget"], canonicalObjective: "lead_generation" });
    const core = { schemaVersion: "tenant-authority-snapshot/1.0.0", snapshotRef: "authority_snapshot_primary",
      repository: { ref: "repository_policy_authority", revision: "42", verified: true },
      authority: { productionAuthoritySourceBound: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false },
      policyAuthority: { catalogHash: catalog.catalogHash, scope, manualLocks: [] } };
    const snapshotHash = digest(core); const row = { snapshot_id: "22222222-2222-4222-8222-222222222222",
      snapshot_ref: core.snapshotRef, snapshot_hash: snapshotHash, repository_ref: core.repository.ref, repository_revision: "42",
      verified_at: "2026-08-09T00:00:00.000Z", expires_at: "2026-08-10T00:00:00.000Z", snapshot_payload: { ...core, snapshotHash },
      catalog_id: "33333333-3333-4333-8333-333333333333", catalog_revision_hash: catalog.catalogHash, catalog_payload: catalog,
      binding_rows: [{ policyRef: "policy_primary", policyVersion: 1, policyHash: "b".repeat(64), bindingKind: "semantic", bindingRef: "semantic_budget",
        bindingVersion: "1", bindingHash: "c".repeat(64), authorityTierRef: "authority_tier_metric", decisionRef: "decision_budget" },
        { policyRef: "policy_primary", policyVersion: 1, policyHash: "b".repeat(64), bindingKind: "topic", bindingRef: "topic_budget",
          bindingVersion: "1", bindingHash: "d".repeat(64), authorityTierRef: "authority_tier_metric", decisionRef: "decision_budget" }],
      account_group_refs: ["account_group_primary"], manual_lock_rows: [], current_snapshot_count: 1 };
    const execute = vi.fn(async () => execute.mock.calls.length === 1 ? { rows: [{ id: workspaceId }] } : { rows: [row] });
    const loaded = await new DrizzleTrustedPolicyAuthorityRepository({ execute } as never).load({ workspaceId,
      accountRef: "account_primary", evaluatedAt: "2026-08-09T12:00:00.000Z" });
    expect(() => loaded.compose({ workspaceId, capturedAt: "2026-08-09T12:00:00.000Z",
      identity: { accountRef: "account_other" } } as never, {} as never)).toThrowError(expect.objectContaining({ code: "workspace_scope_mismatch" }));
  });
});
