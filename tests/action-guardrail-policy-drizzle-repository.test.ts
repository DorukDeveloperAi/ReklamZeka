import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  ActionGuardrailPolicyRepositoryError,
  DrizzleActionGuardrailPolicyRepository,
} from "@/connectors/actions/action-guardrail-policy-drizzle-repository";
import {
  createActionGuardrailPolicyDraft,
  disableActionGuardrailPolicy,
  publishActionGuardrailPolicy,
  type ActionGuardrailPolicyRevision,
} from "@/domain/actions/action-guardrail-policy";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const workspaceRef = "workspace_alpha";
const h = (value: string) => value.repeat(64);
function draft(policyRef = "guardrail_workspace", expiresAt: string | null = null) {
  return createActionGuardrailPolicyDraft({ workspaceRef, policyRef, revision: 1, previousHash: null,
    effectiveFrom: "2026-08-07T20:00:00.000Z", expiresAt,
    selector: { actionTypes: ["existing_post_promotion"], accountRefs: [], campaignRefs: [], entities: [],
      internalCategoryRefs: [], geoRefs: [] }, clauses: [], normalizedBy: { actorRef: "actor_analyst", role: "analyst" },
    sourceGuidanceRefs: ["guidance_owner_rule"] });
}
function publish(source = draft()) {
  return publishActionGuardrailPolicy({ draft: source, actor: { actorRef: "actor_owner", role: "owner" },
    decisionRef: "decision_publish_guardrail", reasonRef: "reason_owner_confirmed", publishedAt: "2026-08-07T20:01:00.000Z" });
}
function row(revision: ActionGuardrailPolicyRevision, id = "22222222-2222-4222-a222-222222222222") {
  return { id, workspace_ref: revision.workspaceRef, policy_ref: revision.policyRef, revision: revision.revision,
    previous_hash: revision.previousHash, state: revision.state, canonical_hash: revision.canonicalHash,
    artifact_payload: revision };
}
function database(results: readonly unknown[]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }));
  return { execute, transaction };
}
const resolveInput = Object.freeze({ evaluatedAt: "2026-08-07T21:00:00.000Z",
  action: { actionHash: h("a"), actionType: "existing_post_promotion" as const, accountRef: "account_doruk",
    campaignRef: "campaign_leads", entity: { level: "adset" as const, ref: "adset_leads" }, budgetChange: null },
  categoryEvidence: { status: "known" as const, refs: ["category_health"], evidenceHash: h("b") },
  affectedGeoEvidence: { status: "known" as const, refs: ["geo_turkey"], evidenceHash: h("c") } });

describe("Drizzle ActionGuardrailPolicy registry", () => {
  it("appends a contiguous first draft under the tenant update lock", async () => {
    const revision = draft();
    const db = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }, { rows: [] },
      { rows: [{ canonical_hash: revision.canonicalHash }] }]);
    await expect(new DrizzleActionGuardrailPolicyRepository(db as never, workspaceId, workspaceRef).append(revision))
      .resolves.toEqual({ outcome: "inserted", canonicalHash: revision.canonicalHash });
    expect(new PgDialect().sqlToQuery(db.execute.mock.calls[0]![0]).sql).toContain("for update");
  });

  it("appends the hash-linked draft-to-published transition", async () => {
    const source = draft(); const active = publish(source);
    const db = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }, { rows: [row(source)] },
      { rows: [{ canonical_hash: active.canonicalHash }] }]);
    await expect(new DrizzleActionGuardrailPolicyRepository(db as never, workspaceId, workspaceRef).append(active))
      .resolves.toEqual({ outcome: "inserted", canonicalHash: active.canonicalHash });
  });

  it("rejects omitted predecessors, invalid transitions, and cross-tenant writes", async () => {
    const active = publish();
    const omitted = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }, { rows: [] }]);
    await expect(new DrizzleActionGuardrailPolicyRepository(omitted as never, workspaceId, workspaceRef).append(active))
      .rejects.toMatchObject({ code: "revision_conflict" });
    const invalid = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }, { rows: [row(draft())] }]);
    await expect(new DrizzleActionGuardrailPolicyRepository(invalid as never, workspaceId, workspaceRef).append({
      ...draft(), revision: 2, previousHash: draft().canonicalHash,
    })).rejects.toMatchObject({ code: "invalid_input" });
    const untouched = database([]);
    const otherTenant = createActionGuardrailPolicyDraft({ workspaceRef: "workspace_other", policyRef: "guardrail_workspace",
      revision: 1, previousHash: null, effectiveFrom: "2026-08-07T20:00:00.000Z", expiresAt: null,
      selector: { actionTypes: ["existing_post_promotion"], accountRefs: [], campaignRefs: [], entities: [],
        internalCategoryRefs: [], geoRefs: [] }, clauses: [], normalizedBy: { actorRef: "actor_analyst", role: "analyst" },
      sourceGuidanceRefs: [] });
    await expect(new DrizzleActionGuardrailPolicyRepository(untouched as never, workspaceId, workspaceRef)
      .append(otherTenant)).rejects.toMatchObject({ code: "workspace_scope_mismatch" });
    expect(untouched.execute).not.toHaveBeenCalled();
  });

  it("loads the full chain and resolves successful and missing policy sets", async () => {
    const source = draft(); const active = publish(source);
    const success = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [row(source), row(active)] }]);
    await expect(new DrizzleActionGuardrailPolicyRepository(success as never, workspaceId, workspaceRef).resolve(resolveInput))
      .resolves.toMatchObject({ disposition: "allowed", policyEvidence: [{ revision: 2, canonicalHash: active.canonicalHash }] });
    expect(new PgDialect().sqlToQuery(success.execute.mock.calls[1]![0]).sql).not.toMatch(/state\s*=/);
    const missing = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }]);
    await expect(new DrizzleActionGuardrailPolicyRepository(missing as never, workspaceId, workspaceRef).resolve(resolveInput))
      .resolves.toMatchObject({ disposition: "unresolved", reasonCodes: ["policy_set_missing"] });
  });

  it("fails closed for omitted, corrupt, and cross-tenant stored chains", async () => {
    const source = draft(); const active = publish(source);
    for (const stored of [
      [row(active)],
      [row(source), { ...row(active), canonical_hash: h("0") }],
      [row(source), { ...row(active), workspace_ref: "workspace_other" }],
    ]) {
      const db = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: stored }]);
      await expect(new DrizzleActionGuardrailPolicyRepository(db as never, workspaceId, workspaceRef).resolve(resolveInput))
        .rejects.toMatchObject({ code: "corrupt_store" });
    }
  });

  it("returns unresolved for ambiguous, expired, and disabled latest lifecycle", async () => {
    const oneDraft = draft("guardrail_one"); const one = publish(oneDraft);
    const twoDraft = draft("guardrail_two"); const two = publish(twoDraft);
    const ambiguous = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] },
      { rows: [row(oneDraft), row(one), row(twoDraft), row(two)] }]);
    await expect(new DrizzleActionGuardrailPolicyRepository(ambiguous as never, workspaceId, workspaceRef).resolve(resolveInput))
      .resolves.toMatchObject({ disposition: "unresolved", reasonCodes: ["ambiguous_policy_scope"] });
    const expiredDraft = draft("guardrail_expired", "2026-08-07T20:30:00.000Z"); const expired = publish(expiredDraft);
    const expiredDb = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [row(expiredDraft), row(expired)] }]);
    await expect(new DrizzleActionGuardrailPolicyRepository(expiredDb as never, workspaceId, workspaceRef).resolve(resolveInput))
      .resolves.toMatchObject({ disposition: "unresolved", reasonCodes: ["policy_set_inactive"] });
    const disabled = disableActionGuardrailPolicy({ current: one, actor: { actorRef: "actor_admin", role: "admin" },
      decisionRef: "decision_disable_guardrail", reasonRef: "reason_retired", disabledAt: "2026-08-07T20:30:00.000Z" });
    const disabledDb = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] },
      { rows: [row(oneDraft), row(one), row(disabled)] }]);
    await expect(new DrizzleActionGuardrailPolicyRepository(disabledDb as never, workspaceId, workspaceRef).resolve(resolveInput))
      .resolves.toMatchObject({ disposition: "unresolved", reasonCodes: ["policy_set_inactive"] });
  });

  it("exposes no mutation authority beyond append and no evidence materializer", () => {
    expect(Object.getOwnPropertyNames(DrizzleActionGuardrailPolicyRepository.prototype).sort())
      .toEqual(["append", "constructor", "resolve"]);
    expect(() => new DrizzleActionGuardrailPolicyRepository({} as never, "invalid", workspaceRef))
      .toThrow(ActionGuardrailPolicyRepositoryError);
  });
});
