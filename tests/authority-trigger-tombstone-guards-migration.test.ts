import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "drizzle/20260810195500_authority_trigger_tombstone_guards.sql"), "utf8");

describe("authority trigger tombstone-guard forward migration", () => {
  it("repairs every wrapper that previously invoked a trigger function directly", () => {
    expect(migration).toContain("authority_substrate_tombstone_delete_allowed");
    for (const name of [
      "account_group_revision_chain_guard",
      "account_group_head_guard",
      "policy_manual_lock_chain_guard",
      "action_unit_frozen_context_guard",
      "policy_authority_catalog_revision_chain_guard",
      "policy_authority_catalog_head_guard",
      "tenant_authority_snapshot_head_guard",
      "authority_topic_revision_chain_guard",
      "authority_topic_head_guard",
      "authority_semantic_binding_chain_guard",
    ]) expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${name}()`);
    expect(migration).not.toContain("RETURN public.authority_substrate_append_only()");
    expect(migration).toContain("TG_OP = 'DELETE' AND public.authority_substrate_tombstone_delete_allowed(OLD.workspace_id)");
    expect(migration).toContain("RAISE EXCEPTION 'authority_substrate_append_only'");
  });
});
