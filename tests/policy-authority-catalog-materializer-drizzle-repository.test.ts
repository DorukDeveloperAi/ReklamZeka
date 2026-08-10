import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createPolicyScopeSnapshot, createTrustedPolicyCatalog } from "@/application/trusted-policy-composition";
import { DrizzlePolicyAuthorityCatalogMaterializerRepository } from "@/connectors/policies/policy-authority-catalog-materializer-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const policyId = "33333333-3333-4333-8333-333333333333";
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

describe("DrizzlePolicyAuthorityCatalogMaterializerRepository", () => {
  it("invalidates persisted policy-authority component versions, not a fabricated catalog/snapshot target", async () => {
    const registry = [{ policyRef: "policy_primary", policyVersion: 1, canonicalHash: "a".repeat(64), status: "published" }];
    const registryHash = digest(registry);
    const catalog = createTrustedPolicyCatalog({ workspaceRef: "workspace_primary", catalogRef: "authority_catalog_primary", catalogVersion: 1,
      instructionPolicyRegistryHash: registryHash, bindings: [{ policyRef: "policy_primary", policyVersion: 1, policyHash: "a".repeat(64),
        authorityTier: "metric_rule", decision: { decisionKey: "budget", positionKey: "hold" }, categoryProfileRef: null,
        categoryProfileVersion: null, categoryProfileHash: null, manualLockRef: null }] });
    const scope = createPolicyScopeSnapshot({ workspaceRef: "workspace_primary", evaluatedAt: "2026-08-10T10:00:00.000Z",
      accountGroupRefs: [], objectiveRefs: [], topicRefs: [], canonicalObjective: "lead_generation" });
    const execute = vi.fn(async (query: unknown) => {
      const statement = new PgDialect().sqlToQuery(query as never).sql;
      if (statement.includes("from workspaces")) return { rows: [{ id: workspaceId }] };
      if (statement.includes("from memberships")) return { rows: [{ role: "owner" }] };
      if (statement.includes("from strict_instruction_policy_revisions policy")) return { rows: [{ id: policyId, policy_ref: "policy_primary", policy_version: 1, canonical_hash: "a".repeat(64) }] };
      if (statement.includes("from policy_semantic_binding_revisions semantic")) return { rows: [{ semantic_ref: "semantic_budget", revision: 1, revision_hash: "b".repeat(64) }] };
      if (statement.includes("from effective_campaign_context_components")) return { rows: [{ component_version: "c".repeat(64) }] };
      return { rows: [] };
    });
    const database = { execute, transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ execute }) };
    const result = await new DrizzlePolicyAuthorityCatalogMaterializerRepository(database as never).materialize({ workspaceId, workspaceRef: "workspace_primary",
      actorId, actorRef: "actor_owner", role: "owner", occurredAt: "2026-08-10T10:00:00.000Z", expiresAt: "2026-08-11T10:00:00.000Z",
      repositoryRef: "repository_policy_authority", repositoryRevision: "42", expectedCatalogHeadHash: "GENESIS",
      expectedSnapshotHeadHash: "GENESIS", expectedPolicyRegistryHash: registryHash, catalog, scope, manualLocks: [] });
    expect(result.capabilities).toEqual({ productionAuthoritySourceBound: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false });
    const queries = (execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never));
    expect(queries.some((query) => query.sql.includes("from effective_campaign_context_components"))).toBe(true);
    const invalidation = queries.find((query) => query.sql.includes("effective_campaign_context_invalidations"));
    expect(invalidation?.params).toContain("c".repeat(64));
    expect(invalidation?.params).not.toContain(result.snapshotHash);
    expect(queries.map((query) => query.sql).join("\n")).not.toContain("'policy_authority_catalog'");
  });
});
