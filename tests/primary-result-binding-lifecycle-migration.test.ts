import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const migration = readFileSync("drizzle/20260817162000_primary_result_binding_lifecycle.sql", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const repository = readFileSync("src/connectors/operations/primary-result-binding-lifecycle-drizzle-repository.ts", "utf8");
const verifier = readFileSync("scripts/verify-primary-result-binding-postgres.ts", "utf8");
const packageJson = readFileSync("package.json", "utf8");

describe("P03-Cb primary-result binding persistence preflight", () => {
  it("uses immutable revisions, a subject-XOR OCC head, and tenant/market composite FKs", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.primary_result_binding_revisions");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.primary_result_binding_heads");
    expect(migration).toContain("primary_result_binding_revisions_org_market_scope_fk");
    expect(migration).toContain("primary_result_binding_revisions_slice_market_scope_fk");
    expect(migration).toContain("primary_result_binding_revisions_actor_scope_fk");
    expect(migration).toContain("primary_result_binding_heads_latest_revision_scope_fk");
    expect(migration).toContain("NULLS NOT DISTINCT");
    expect(schema).toContain(".nullsNotDistinct()");
    expect(migration).toContain("ADD CONSTRAINT primary_result_binding_revisions_subject_number_uq UNIQUE NULLS NOT DISTINCT");
    expect(migration).toContain("ADD CONSTRAINT primary_result_binding_revisions_workspace_subject_row_unique UNIQUE NULLS NOT DISTINCT");
    expect(migration).toContain("ADD CONSTRAINT primary_result_binding_heads_workspace_subject_unique UNIQUE NULLS NOT DISTINCT");
    for (const index of [
      "primary_result_binding_revisions_workspace_org_market_fk_idx",
      "primary_result_binding_revisions_workspace_slice_market_fk_idx",
      "primary_result_binding_revisions_workspace_market_fk_idx",
      "primary_result_binding_heads_workspace_org_market_fk_idx",
      "primary_result_binding_heads_workspace_slice_market_fk_idx",
      "primary_result_binding_heads_workspace_market_fk_idx",
    ]) expect(migration).toContain(index);
    expect(migration).toContain("subject_kind='organization_campaign'");
    expect(migration).toContain("subject_kind='slice'");
    expect(migration).toContain("state='bound'");
    expect(migration).toContain("state='unbound'");
    expect(schema).toContain("export const primaryResultBindingRevisions");
    expect(schema).toContain("export const primaryResultBindingHeads");
  });

  it("forces RLS, keeps revisions append-only, and permits only tombstone purge", () => {
    for (const table of ["primary_result_binding_revisions", "primary_result_binding_heads"]) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("primary_result_binding_revision_append_only_guard");
    expect(migration).toContain("primary_result_binding_head_exact_advance_guard");
    expect(migration).toContain("lifecycle_state='tombstoning'");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE public.primary_result_binding_revisions,public.primary_result_binding_heads FROM PUBLIC,anon,authenticated,service_role");
    const head = WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("primary_result_binding_heads");
    const revisions = WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("primary_result_binding_revisions");
    expect(head).toBeGreaterThanOrEqual(0);
    expect(revisions).toBe(head + 1);
  });

  it("has server-only exact-idempotent CAS persistence and a bounded current-head reader", () => {
    expect(repository).toContain('import "server-only"');
    expect(repository).toContain("set local transaction isolation level serializable");
    expect(repository).toContain("expectedHeadVersion");
    expect(repository).toContain("expectedRevisionHash");
    expect(repository).toContain("isTrustedPrimaryResultActionCatalog");
    expect(repository).toContain("revision_hash=${input.revision.revisionHash}");
    expect(repository).toContain("version=${input.expectedHeadVersion}");
    expect(repository).toContain("MAX_TARGETS = 200");
    expect(repository).toContain("set local transaction read only");
    expect(repository).toContain("lifecycle_state !== \"active\"");
    expect(repository).toContain("membership[0]!.role !== \"owner\"");
    expect(repository).toContain("tombstoned_at is null");
  });

  it("keeps its live verifier outer-rollback based and covers its authority boundary", () => {
    expect(verifier).toContain('await client.query("begin")');
    expect(verifier).toContain('await client.query("rollback")');
    expect(verifier).toContain("idempotent");
    expect(verifier).toContain("staleRejected");
    expect(verifier).toContain("analystRejected");
    expect(verifier).toContain("tombstoneWriteRejected");
    expect(verifier).toContain("directHeadUpdateRejected");
    expect(verifier).toContain("requiredIndexesPresent");
    expect(verifier).toContain("uniqueConstraintsPresent");
    expect(verifier).toContain("directMutationRejected");
    expect(verifier).toContain("zeroResidue");
    expect(packageJson).toContain('"verify:primary-result-binding-db": "node --conditions react-server --import tsx scripts/verify-primary-result-binding-postgres.ts"');
    expect(packageJson).toContain('"verify:primary-result-binding-db:post": "PRIMARY_RESULT_BINDING_VERIFY_MODE=post node --conditions react-server --import tsx scripts/verify-primary-result-binding-postgres.ts"');
    expect(verifier).toContain('PRIMARY_RESULT_BINDING_VERIFY_MODE === "post"');
  });
});
