import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/connectors/guides/guide-budget-action-trusted-context-drizzle-repository.ts"), "utf8");

describe("Guide budget trusted context SQL", () => {
  it("uses the canonical effective-context entity and component invalidation relations", () => {
    expect(source).not.toContain("ctx.ad_set_id");
    expect(source).not.toContain("invalidation.context_id");
    expect(source).toContain("s.external_ad_set_id=ctx.entity_ref");
    expect(source).toContain("effective_campaign_context_components component");
    expect(source).toContain("component.context_id=ctx.id");
    expect(source).toContain("invalidation.component_type=component.component_type");
  });

  it("keeps aliases out of action refs and binds health report identity into the runtime", () => {
    expect(source).toContain("a.external_account_id account_external_ref");
    expect(source).toContain("dataHealthReportHash: health.report.reportHash");
    expect(source).toContain('if (owner.budgetOwnerKind === "campaign") fail("protection_unavailable")');
    expect(source).toContain('fail("parent_ceiling_unavailable")');
  });

  it("keeps the complete evidence chain legal under the outer RR/read-only snapshot", () => {
    expect(source).toContain("set local transaction isolation level repeatable read");
    expect(source).toContain("set local transaction read only");
    expect(source).toContain("select artifact_payload from approval_policy_definition_revisions");
    expect(source).toContain("select artifact_payload from autonomy_rule_revisions");
    expect(source).toContain("select artifact_payload from action_guardrail_policy_revisions");
    expect(source).not.toContain("DrizzleApprovalPolicyRegistryRepository");
    expect(source).not.toContain("DrizzleAutonomyRuleRegistryRepository");
    expect(source).not.toContain("DrizzleActionGuardrailPolicyRepository");
    expect(source).toContain("readOnlyTransaction: true");
  });
});
