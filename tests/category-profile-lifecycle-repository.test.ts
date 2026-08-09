import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { DrizzleCategoryProfileLifecycleRepository } from
  "@/connectors/categories/category-profile-lifecycle-drizzle-repository";
import { DrizzleCategoryProfileRepository } from "@/connectors/categories/category-profile-drizzle-repository";
import { createCategoryProfile, type CategoryProfileRevision } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const definitionId = "33333333-3333-4333-8333-333333333333";
const dimensionId = "44444444-4444-4444-8444-444444444444";
const definitionRef = `category_${"1".repeat(24)}`;
const bindings = { analysisPlaybookRefs: ["analysis_playbook_health"], ruleInstructionBundleRefs: [],
  budgetPolicyRefs: [], transferPolicyRefs: [], schedulePolicyRefs: [], actionPolicyRefs: [], creativePolicyRefs: [] } as const;
function storedProfile(workspaceRef = "workspace_test") {
  return createCategoryProfile({ workspaceRef, profileRef: "category_profile_cardiology",
    categoryRef: categoryDefinitionPublicRef("service_line", "cardiology"), parentCategoryRef: null,
    label: "Kardiyoloji", description: "Kalp sağlığı", color: "#A31F34", ownerRef: "actor_owner",
    status: "draft", bindings });
}

function database(options: Readonly<{ membershipRole?: string; auditFails?: boolean }> = {}) {
  let appended: CategoryProfileRevision | null = null;
  let auditMetadata: Readonly<Record<string, unknown>> | null = null;
  const statements: string[] = [];
  const execute = vi.fn(async (statement: never) => {
    const query = new PgDialect().sqlToQuery(statement); statements.push(query.sql);
    if (query.sql.includes("select definition.id::text as definition_id")) return { rows: [{ definition_id: definitionId,
      dimension_id: dimensionId, dimension_key: "service_line", definition_key: "cardiology",
      label: "Kardiyoloji", description: "Kategori tanımı" }] };
    if (query.sql.includes("with ranked as")) return { rows: appended ? [{ category_definition_id: definitionId,
      profile_ref: appended.profileRef, profile_payload: appended }] : [] };
    if (query.sql.includes("select id from workspaces")) return { rows: [{ id: workspaceId }] };
    if (query.sql.includes("select role::text from memberships")) return { rows: options.membershipRole === "missing"
      ? [] : [{ role: options.membershipRole ?? "owner" }] };
    if (query.sql.includes("select event_hash from audit_events")) return { rows: [] };
    if (options.auditFails && query.sql.includes("insert into audit_events")) throw new Error("audit_failed");
    if (query.sql.includes("insert into audit_events")) {
      const encoded = query.params.find((value) => typeof value === "string" && value.includes('"profileVersion"'));
      auditMetadata = JSON.parse(String(encoded)) as Readonly<Record<string, unknown>>;
    }
    return { rows: [] };
  });
  const tx = { execute, transaction: vi.fn(async (callback: (input: unknown) => Promise<unknown>) => callback(tx)) };
  let rolledBack = false;
  const db = { execute, transaction: vi.fn(async (callback: (input: typeof tx) => Promise<unknown>) => {
    try { return await callback(tx); } catch (reason) { rolledBack = true; throw reason; }
  }) };
  return { db, statements, setAppended(value: CategoryProfileRevision) { appended = value; },
    get auditMetadata() { return auditMetadata; },
    get rolledBack() { return rolledBack; } };
}

describe("CategoryProfile lifecycle Drizzle adapter", () => {
  it("locks workspace, binds opaque definition refs, appends through the guarded repository and audits atomically", async () => {
    const fixture = database();
    const repository = new DrizzleCategoryProfileLifecycleRepository(fixture.db as never);
    const before = await repository.inspect(workspaceId, "workspace_test");
    expect(before.definitions[0]).toMatchObject({ definitionRef: expect.stringMatching(/^category_[a-f0-9]{24}$/),
      dimensionRef: expect.stringMatching(/^dimension_[a-f0-9]{24}$/), currentProfile: null });
    const append = vi.spyOn(DrizzleCategoryProfileRepository.prototype, "append")
      .mockImplementation(async (artifact, binding) => {
        const profile = artifact as CategoryProfileRevision; fixture.setAppended(profile);
        expect(binding).toMatchObject({ categoryDefinitionId: definitionId, parentCategoryDefinitionId: null });
        return { outcome: "inserted", profileHash: profile.profileHash, invalidationsAppended: 0 };
      });
    try {
      const result = await repository.mutate({ workspaceId, workspaceRef: "workspace_test", actorId,
        actorRef: "actor_owner", role: "owner", occurredAt: "2026-08-09T21:00:00.000Z",
        command: { operation: "create_draft", definitionRef: before.definitions[0]!.definitionRef,
          parentDefinitionRef: null, label: "Kardiyoloji", description: "Kalp sağlığı hizmetleri", color: "#A31F34",
          bindings, expectedRegistryHash: before.registryHash } });
      expect(result).toMatchObject({ auditAppended: true, invalidationsAppended: 0,
        profile: { ownerRef: "actor_owner", status: "draft", version: 1,
          profileRef: expect.stringMatching(/^category_profile_[a-f0-9]{24}$/) } });
      expect(result.state.definitions[0]!.currentProfile?.profileHash).toBe(result.profile.profileHash);
      expect(fixture.statements.find((statement) => statement.includes("select id from workspaces"))).toContain("for update");
      expect(fixture.statements.some((statement) => statement.includes("insert into audit_events"))).toBe(true);
      expect(fixture.auditMetadata).toMatchObject({ reasonCode: null, profileVersion: 1 });
      expect(fixture.db.transaction).toHaveBeenCalledTimes(1);
    } finally { append.mockRestore(); }
  });

  it("persists the normalized lifecycle reason code in canonical audit metadata", async () => {
    const fixture = database(); const current = storedProfile(); fixture.setAppended(current);
    const repository = new DrizzleCategoryProfileLifecycleRepository(fixture.db as never);
    const before = await repository.inspect(workspaceId, "workspace_test");
    const append = vi.spyOn(DrizzleCategoryProfileRepository.prototype, "append")
      .mockImplementation(async (artifact) => {
        const next = artifact as CategoryProfileRevision; fixture.setAppended(next);
        return { outcome: "inserted", profileHash: next.profileHash, invalidationsAppended: 1 };
      });
    try {
      await repository.mutate({ workspaceId, workspaceRef: "workspace_test", actorId,
        actorRef: "actor_owner", role: "owner", occurredAt: "2026-08-09T21:00:00.000Z",
        command: { operation: "publish", profileRef: current.profileRef, expectedVersion: current.version,
          expectedProfileHash: current.profileHash, expectedRegistryHash: before.registryHash,
          reasonCode: "owner_publish" } });
      expect(fixture.auditMetadata).toMatchObject({ reasonCode: "owner_publish",
        expectedVersion: current.version, expectedProfileHash: current.profileHash });
    } finally { append.mockRestore(); }
  });

  it("fails stale registry OCC before append or audit", async () => {
    const fixture = database(); const append = vi.spyOn(DrizzleCategoryProfileRepository.prototype, "append");
    try {
      await expect(new DrizzleCategoryProfileLifecycleRepository(fixture.db as never).mutate({ workspaceId,
        workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
        occurredAt: "2026-08-09T21:00:00.000Z", command: { operation: "create_draft", definitionRef,
          parentDefinitionRef: null, label: "Kardiyoloji", description: "Kalp sağlığı", color: "#A31F34",
          bindings, expectedRegistryHash: "f".repeat(64) } })).rejects.toMatchObject({ code: "conflict" });
      expect(append).not.toHaveBeenCalled();
      expect(fixture.statements.some((statement) => statement.includes("insert into audit_events"))).toBe(false);
    } finally { append.mockRestore(); }
  });

  it("rejects stale profile OCC and cross-workspace stored profile scope", async () => {
    const fixture = database(); const current = storedProfile(); fixture.setAppended(current);
    const state = await new DrizzleCategoryProfileLifecycleRepository(fixture.db as never)
      .inspect(workspaceId, "workspace_test");
    const append = vi.spyOn(DrizzleCategoryProfileRepository.prototype, "append");
    try {
      await expect(new DrizzleCategoryProfileLifecycleRepository(fixture.db as never).mutate({ workspaceId,
        workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
        occurredAt: "2026-08-09T21:00:00.000Z", command: { operation: "publish",
          profileRef: current.profileRef, expectedVersion: current.version + 1, expectedProfileHash: current.profileHash,
          expectedRegistryHash: state.registryHash, reasonCode: "owner_publish" } })).rejects.toMatchObject({ code: "conflict" });
      expect(append).not.toHaveBeenCalled();
    } finally { append.mockRestore(); }

    const crossTenant = database(); crossTenant.setAppended(storedProfile("workspace_other"));
    await expect(new DrizzleCategoryProfileLifecycleRepository(crossTenant.db as never)
      .inspect(workspaceId, "workspace_test")).rejects.toMatchObject({ code: "conflict" });
  });

  it("rechecks active membership in the locked transaction and rolls profile/invalidation back when audit fails", async () => {
    const revoked = database({ membershipRole: "missing" });
    const append = vi.spyOn(DrizzleCategoryProfileRepository.prototype, "append");
    try {
      await expect(new DrizzleCategoryProfileLifecycleRepository(revoked.db as never).mutate({ workspaceId,
        workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
        occurredAt: "2026-08-09T21:00:00.000Z", command: { operation: "create_draft", definitionRef,
          parentDefinitionRef: null, label: "Kardiyoloji", description: "Kalp sağlığı", color: "#A31F34",
          bindings, expectedRegistryHash: "f".repeat(64) } })).rejects.toMatchObject({ code: "forbidden" });
      expect(append).not.toHaveBeenCalled();
    } finally { append.mockRestore(); }

    const failing = database({ auditFails: true });
    const repository = new DrizzleCategoryProfileLifecycleRepository(failing.db as never);
    const before = await repository.inspect(workspaceId, "workspace_test");
    const guardedAppend = vi.spyOn(DrizzleCategoryProfileRepository.prototype, "append")
      .mockResolvedValue({ outcome: "inserted", profileHash: "e".repeat(64), invalidationsAppended: 1 });
    try {
      await expect(repository.mutate({ workspaceId, workspaceRef: "workspace_test", actorId,
        actorRef: "actor_owner", role: "owner", occurredAt: "2026-08-09T21:00:00.000Z",
        command: { operation: "create_draft", definitionRef: before.definitions[0]!.definitionRef,
          parentDefinitionRef: null, label: "Kardiyoloji", description: "Kalp sağlığı", color: "#A31F34",
          bindings, expectedRegistryHash: before.registryHash } })).rejects.toThrow("audit_failed");
      expect(guardedAppend).toHaveBeenCalledTimes(1);
      expect(failing.rolledBack).toBe(true);
    } finally { guardedAppend.mockRestore(); }
  });
});
