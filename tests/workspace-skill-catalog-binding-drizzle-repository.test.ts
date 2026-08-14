import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { CORE_SKILL_MANIFESTS, WorkspaceSkillCatalogBindingError } from "@/domain/orchestrator/skill-catalog";
import { DrizzleWorkspaceSkillCatalogBindingRepository } from "@/connectors/orchestrator/workspace-skill-catalog-binding-drizzle-repository";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const corePack = CORE_SKILL_MANIFESTS.map(({ ref, version }) => ({ ref, version }));
const profilePayload = { corePack };
const profile = { profile_ref: "profile_default", revision: 1, profile_hash: digest(profilePayload), payload: profilePayload };
const playbookPayload = { title: "Dönüşüm notu", body: "İki varyantı kanıtla karşılaştır." };
const playbook = { playbook_ref: "playbook_alpha", revision: 2, playbook_hash: digest(playbookPayload), payload: playbookPayload,
  source_ref: "source_guidance", source_status: "published", review_by: "2050-01-01T00:00:00.000Z",
  source_title: "Meta yardım", source_type: "official_meta_guidance", source_url: "https://www.facebook.com/business/help/learning" };

function database(results: readonly unknown[][]) {
  const dialect = new PgDialect(); const queue = [...results]; const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  return { queries, db: { execute: vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    queries.push(dialect.sqlToQuery(query)); return { rows: queue.shift() ?? [] };
  }) } };
}

describe("workspace skill catalog turn binding loader", () => {
  it("loads only the active workspace profile and every active published playbook head", async () => {
    const fixture = database([[profile], [playbook]]);
    const binding = await new DrizzleWorkspaceSkillCatalogBindingRepository(fixture.db as never).loadActive({ workspaceId });
    expect(binding).toMatchObject({ profile: { profileRef: "profile_default", revision: 1, profileHash: profile.profile_hash },
      playbooks: [{ playbookRef: "playbook_alpha", revision: 2, playbookHash: playbook.playbook_hash, sourceRef: "source_guidance",
        citation: { sourceTitle: "Meta yardım", sourceType: "official_meta_guidance", sourceUrl: "https://www.facebook.com/business/help/learning", freshness: "fresh" } }] });
    expect(binding.bindingHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.queries.map((query) => query.sql).join("\n")).toContain("where workspace_id = $1::uuid and state = 'active'");
    expect(fixture.queries[1]!.sql).toContain("select distinct on (playbook_ref)");
    expect(fixture.queries[1]!.sql).toContain("source.workspace_id = $2::uuid");
  });

  it("never takes profile or playbook scope from a caller and keeps both reads tenant-bound", async () => {
    const foreignWorkspaceId = "00000000-0000-4000-8000-000000000099";
    const fixture = database([[profile], [playbook]]);
    await new DrizzleWorkspaceSkillCatalogBindingRepository(fixture.db as never).loadActive({ workspaceId: foreignWorkspaceId });
    for (const query of fixture.queries) expect(query.params).toEqual(expect.arrayContaining([foreignWorkspaceId]));
    expect(fixture.queries.flatMap((query) => query.params).join(" ")).not.toContain("playbook_alpha");
  });

  it.each([
    ["missing profile", [[], []]],
    ["ambiguous active profile", [[profile, profile], []]],
    ["unpublished source", [[profile], [{ ...playbook, source_status: "archived" }]]],
    ["stale source", [[profile], [{ ...playbook, review_by: "2020-01-01T00:00:00.000Z" }]]],
    ["corrupt playbook", [[profile], [{ ...playbook, playbook_hash: "f".repeat(64) }]]],
  ])("fails closed for %s", async (_label, results) => {
    const fixture = database(results as readonly unknown[][]);
    await expect(new DrizzleWorkspaceSkillCatalogBindingRepository(fixture.db as never).loadActive({ workspaceId }))
      .rejects.toBeInstanceOf(WorkspaceSkillCatalogBindingError);
  });
});
