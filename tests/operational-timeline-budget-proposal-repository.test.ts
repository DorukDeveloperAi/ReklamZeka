import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("operational timeline budget proposal source", () => {
  it("uses the immutable proposal ledger and re-verifies its exact payload/hash before projection", () => {
    const source = readFileSync("src/connectors/decisions/operational-timeline-drizzle-repository.ts", "utf8");
    expect(source).toContain("from public.budget_proposal_versions");
    expect(source).toContain("proposal_payload");
    expect(source).toContain("verifyBudgetProposal(proposal)");
    expect(source).toContain("proposal.proposalHash !== proposalHash");
    expect(source).toContain("slice_rule_budget_proposal_bindings");
    expect(source).toContain("exact kural kaynağı bağlı");
    expect(source).not.toContain("insert into");
    expect(source).not.toContain("update public.");
  });
  it("projects persisted temporal decisions from the append-only ledger without creating actions", () => {
    const source = readFileSync("src/connectors/decisions/operational-timeline-drizzle-repository.ts", "utf8");
    expect(source).toContain("'temporal_evaluation'");
    expect(source).toContain("analysis.analysis_definition_ref = 'temporal-recommendation'");
    expect(source).toContain("decision.cadence_result_ref like 'temporal:%'");
    expect(source).toContain("uygulama yetkisi yok");
    expect(source).not.toContain("insert into");
  });
  it("uses a tenant-local opaque alias resolution and excludes campaign-ambiguous global sources", () => {
    const source = readFileSync("src/connectors/decisions/operational-timeline-drizzle-repository.ts", "utf8");
    expect(source).toContain("with scoped_campaign as");
    expect(source).toContain("campaign.workspace_id");
    expect(source).toContain("count(*) from scoped_campaign) = 1");
    expect(source).toContain("Slice drafts are intentionally workspace-scoped");
    expect(source).toContain("Account-only alarms must not be attributed to an arbitrary campaign");
    expect(source).toContain("context.id = proposal.context_id and context.campaign_id = proposal.campaign_id");
    expect(source).toContain("context.id = analysis.effective_context_id");
  });
});
