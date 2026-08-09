import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  RAW_INSTRUCTION_PROVENANCE_VERSION,
  STRICT_INSTRUCTION_POLICY_DSL_VERSION,
  InstructionPolicyDslError,
  assertStrictInstructionPolicyArtifact,
  parseRawInstructionProvenance,
  parseStrictInstructionPolicy,
  type StrictInstructionPolicyClause,
  type StrictInstructionPolicyInput,
} from "@/domain/policies/instruction-policy-dsl";

const rawText = "İstanbul bütçesini koru. SQL/tool metni yalnız kullanıcı sözü olarak kalmalı.";
const rawTextHash = createHash("sha256").update(rawText, "utf8").digest("hex");
const window = { kind: "rolling" as const, duration: 7, unit: "day" as const, timezone: "Europe/Istanbul" };

function policy(clause: StrictInstructionPolicyClause, overrides: Partial<StrictInstructionPolicyInput> = {}) {
  return {
    dslVersion: STRICT_INSTRUCTION_POLICY_DSL_VERSION,
    workspaceRef: "workspace_alpha",
    policyRef: `policy_${clause.kind}`,
    policyVersion: 1,
    previousVersionHash: null,
    policyType: clause.kind,
    owner: { actorRef: "actor_owner", role: "owner" as const },
    status: "draft" as const,
    reasonCode: "owner_strategy",
    priority: 500,
    effectiveDates: { from: "2026-08-09T00:00:00.000Z", until: null },
    scope: {
      global: false,
      accountGroupRefs: [],
      accountRefs: ["account_primary"],
      objectiveRefs: [],
      internalCategoryRefs: ["category_istanbul"],
      entities: [],
      topicRefs: [],
    },
    source: {
      rawProvenanceRef: "provenance_owner_statement",
      rawTextHash,
      promotedFromGuidanceRefs: ["guidance_budget_strategy"],
    },
    clause,
    ...overrides,
  } satisfies StrictInstructionPolicyInput;
}

const clauses: readonly StrictInstructionPolicyClause[] = [
  { kind: "hard_constraint", constraint: { kind: "metric_bound", metricRef: "metric_cost_per_result",
    operator: "lte", valueDecimal: "250.00", unit: "TRY", window } },
  { kind: "target", metricRef: "metric_leads", targetDecimal: "120", unit: "count", window,
    toleranceBasisPoints: 500 },
  { kind: "preference", subjectRef: "subject_budget_priority", preferredRefs: ["category_istanbul", "category_ankara"],
    weightBasisPoints: 6500 },
  { kind: "exception", policyRefs: ["policy_general_budget"], effect: "suppress", justificationReasonCode: "protected_region" },
  { kind: "prohibition", operations: ["budget_transfer", "budget_decrease"] },
  { kind: "approval", operations: ["budget_increase", "existing_post_promotion"], requiredRoles: ["owner", "admin"],
    minimumApprovals: 2, threshold: { currency: "TRY", amountDecimal: "1000" } },
  { kind: "schedule", routineRef: "routine_portfolio_review", cadence: { frequency: "weekly", interval: 1,
    atLocalTime: "09:30", dayOfWeek: 1, dayOfMonth: null, timezone: "Europe/Istanbul" }, misfirePolicy: "run_once" },
];

describe("strict instruction policy DSL", () => {
  it.each(clauses.map((clause) => [clause.kind, clause] as const))(
    "parses the bounded %s policy type without granting runtime authority",
    (_kind, clause) => {
      const parsed = parseStrictInstructionPolicy(policy(clause));
      expect(parsed).toMatchObject({ dslVersion: STRICT_INSTRUCTION_POLICY_DSL_VERSION, policyType: clause.kind,
        clause: { kind: clause.kind }, authority: { canExecute: false, canWriteMeta: false, canApprove: false,
          canSchedule: false, canCallTool: false, canAccessNetwork: false, canQuerySql: false } });
      expect(parsed.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.clause)).toBe(true);
    },
  );

  it("normalizes unordered set-like refs into a replay-stable artifact", () => {
    const clause = clauses[2]! as Extract<StrictInstructionPolicyClause, { kind: "preference" }>;
    const first = parseStrictInstructionPolicy(policy(clause, { scope: { ...policy(clause).scope,
      accountRefs: ["account_secondary", "account_primary"] } }));
    const replay = parseStrictInstructionPolicy(JSON.stringify(policy({ ...clause,
      preferredRefs: ["category_ankara", "category_istanbul"] }, { scope: { ...policy(clause).scope,
      accountRefs: ["account_primary", "account_secondary"] } })));
    expect(replay).toEqual(first);
    expect(assertStrictInstructionPolicyArtifact(first)).toEqual(first);
  });

  it("keeps raw user text in a separate hash-bound, non-authoritative provenance artifact", () => {
    const provenance = parseRawInstructionProvenance({
      version: RAW_INSTRUCTION_PROVENANCE_VERSION,
      workspaceRef: "workspace_alpha",
      provenanceRef: "provenance_owner_statement",
      capturedAt: "2026-08-09T00:00:00.000Z",
      capturedByRef: "actor_owner",
      rawText,
    });
    const normalized = parseStrictInstructionPolicy(policy(clauses[0]!));
    expect(provenance).toMatchObject({ rawText, rawTextHash, authority: {
      canCreatePolicy: false, canExecute: false, canWriteMeta: false, canCallTool: false,
    } });
    expect(normalized.source.rawTextHash).toBe(provenance.rawTextHash);
    expect(normalized).not.toHaveProperty("rawText");
    expect(normalized.clause).not.toHaveProperty("rawText");
  });

  it("supports typed allocation floor/cap/fixed and budget protection without executable expressions", () => {
    const allocation = parseStrictInstructionPolicy(policy({ kind: "hard_constraint", constraint: {
      kind: "allocation_bound", budgetPoolRef: "budget_pool_primary", mode: "floor", valueDecimal: "10000",
      currency: "TRY", window,
    } }));
    const protection = parseStrictInstructionPolicy(policy({ kind: "hard_constraint", constraint: {
      kind: "budget_protection", budgetPoolRefs: ["budget_pool_istanbul"], behavior: "no_outflow",
    } }));
    expect(allocation.clause).toMatchObject({ constraint: { kind: "allocation_bound", mode: "floor" } });
    expect(protection.clause).toMatchObject({ constraint: { kind: "budget_protection", behavior: "no_outflow" } });
  });

  const invalidCases: readonly [string, () => unknown, InstructionPolicyDslError["code"]][] = [
    ["invalid JSON", () => "{", "invalid_json"],
    ["unsupported DSL version", () => ({ ...policy(clauses[0]!), dslVersion: "strict-instruction-policy/9" }), "unsupported_version"],
    ["unknown top-level SQL field", () => ({ ...policy(clauses[0]!), sql: "select * from policies" }), "invalid_contract"],
    ["unknown tool field", () => ({ ...policy(clauses[0]!), tool: "execute" }), "invalid_contract"],
    ["unknown network URL field", () => ({ ...policy(clauses[0]!), url: "https://example.test" }), "invalid_contract"],
    ["forged action authority", () => ({ ...policy(clauses[0]!), canExecute: true }), "invalid_contract"],
    ["policy/clause mismatch", () => ({ ...policy(clauses[0]!), policyType: "target" }), "type_clause_mismatch"],
    ["missing version predecessor", () => ({ ...policy(clauses[0]!), policyVersion: 2 }), "invalid_contract"],
    ["unexpected first-version predecessor", () => ({ ...policy(clauses[0]!), previousVersionHash: "a".repeat(64) }), "invalid_contract"],
    ["invalid predecessor hash", () => ({ ...policy(clauses[0]!), policyVersion: 2, previousVersionHash: "not-a-hash" }), "invalid_hash"],
    ["non-exact owner", () => ({ ...policy(clauses[0]!), owner: { ...policy(clauses[0]!).owner, email: "owner@example.test" } }), "invalid_contract"],
    ["non-canonical date", () => ({ ...policy(clauses[0]!), effectiveDates: { from: "2026-08-09", until: null } }), "invalid_contract"],
    ["reversed effective dates", () => ({ ...policy(clauses[0]!), effectiveDates: {
      from: "2026-08-09T00:00:00.000Z", until: "2026-08-08T00:00:00.000Z" } }), "invalid_contract"],
    ["global plus narrowed scope", () => ({ ...policy(clauses[0]!), scope: { ...policy(clauses[0]!).scope, global: true } }), "invalid_contract"],
    ["empty non-global scope", () => ({ ...policy(clauses[0]!), scope: { global: false, accountGroupRefs: [], accountRefs: [],
      objectiveRefs: [], internalCategoryRefs: [], entities: [], topicRefs: [] } }), "invalid_contract"],
    ["duplicate scope refs", () => ({ ...policy(clauses[0]!), scope: { ...policy(clauses[0]!).scope,
      accountRefs: ["account_primary", "account_primary"] } }), "invalid_contract"],
    ["raw regex-like scope ref", () => ({ ...policy(clauses[0]!), scope: { ...policy(clauses[0]!).scope,
      accountRefs: ["account_.*"] } }), "invalid_contract"],
    ["unknown nested metric expression", () => policy({ kind: "target", metricRef: "metric_leads", targetDecimal: "10",
      unit: "count", window, toleranceBasisPoints: 0, expression: "process.exit()" } as never), "invalid_contract"],
    ["unknown nested SQL", () => policy({ kind: "hard_constraint", constraint: { kind: "metric_bound",
      metricRef: "metric_leads", operator: "gte", valueDecimal: "10", unit: "count", window,
      sql: "select 1" } } as never), "invalid_contract"],
    ["unknown raw cron", () => policy({ kind: "schedule", routineRef: "routine_review", cadence: {
      frequency: "daily", interval: 1, atLocalTime: "09:00", dayOfWeek: null, dayOfMonth: null,
      timezone: "Europe/Istanbul", cron: "0 9 * * *" }, misfirePolicy: "skip" } as never), "invalid_contract"],
    ["invalid schedule shape", () => policy({ kind: "schedule", routineRef: "routine_review", cadence: {
      frequency: "weekly", interval: 1, atLocalTime: "09:00", dayOfWeek: null, dayOfMonth: null,
      timezone: "Europe/Istanbul" }, misfirePolicy: "skip" }), "invalid_contract"],
    ["invalid timezone", () => policy({ kind: "schedule", routineRef: "routine_review", cadence: {
      frequency: "daily", interval: 1, atLocalTime: "09:00", dayOfWeek: null, dayOfMonth: null,
      timezone: "Mars/Olympus" }, misfirePolicy: "skip" }), "invalid_contract"],
    ["unknown operation", () => policy({ kind: "prohibition", operations: ["raw_meta_write"] } as never), "invalid_contract"],
    ["duplicate operation", () => policy({ kind: "prohibition", operations: ["budget_transfer", "budget_transfer"] }), "invalid_contract"],
    ["approval quorum exceeds roles", () => policy({ kind: "approval", operations: ["budget_increase"],
      requiredRoles: ["owner"], minimumApprovals: 2, threshold: null }), "invalid_contract"],
    ["unknown approval threshold field", () => policy({ kind: "approval", operations: ["budget_increase"],
      requiredRoles: ["owner"], minimumApprovals: 1, threshold: { currency: "TRY", amountDecimal: "10", code: "run" } } as never), "invalid_contract"],
    ["unbounded priority", () => ({ ...policy(clauses[0]!), priority: 1001 }), "invalid_contract"],
  ];

  it.each(invalidCases)("fails closed for %s", (_label, candidate, code) => {
    expect(() => parseStrictInstructionPolicy(candidate())).toThrowError(expect.objectContaining({ code }));
  });

  it("rejects extended raw provenance contracts and forged canonical artifacts", () => {
    expect(() => parseRawInstructionProvenance({ version: RAW_INSTRUCTION_PROVENANCE_VERSION,
      workspaceRef: "workspace_alpha", provenanceRef: "provenance_owner_statement",
      capturedAt: "2026-08-09T00:00:00.000Z", capturedByRef: "actor_owner", rawText, policy: {} }))
      .toThrowError(expect.objectContaining({ code: "invalid_contract" }));
    const valid = parseStrictInstructionPolicy(policy(clauses[0]!));
    expect(() => assertStrictInstructionPolicyArtifact({ ...valid, canonicalHash: "b".repeat(64) }))
      .toThrowError(expect.objectContaining({ code: "invalid_hash" }));
    expect(() => assertStrictInstructionPolicyArtifact({ ...valid, authority: { ...valid.authority, canExecute: true } }))
      .toThrowError(expect.objectContaining({ code: "invalid_contract" }));
  });
});
