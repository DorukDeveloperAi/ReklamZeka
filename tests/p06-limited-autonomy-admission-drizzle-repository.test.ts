import { describe, expect, it, vi } from "vitest";

import { DrizzleP06LimitedAutonomyAdmissionRepository } from "@/connectors/actions/p06-limited-autonomy-admission-drizzle-repository";
import { guideRunMembershipEvidenceHash } from "@/domain/guides/guide-run-membership-evidence";
import { metaPublicReference } from "@/domain/meta/public-reference";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12,"0")}`;
function sqlText(value: unknown): string { if (!value || typeof value !== "object" || !("queryChunks" in value) || !Array.isArray(value.queryChunks)) return "";
  return value.queryChunks.flatMap((chunk) => chunk && typeof chunk === "object" && "value" in chunk && Array.isArray(chunk.value)
    ? chunk.value.filter((part: unknown): part is string => typeof part === "string") : []).join(""); }

describe("DrizzleP06LimitedAutonomyAdmissionRepository", () => {
  it("materializes one authority-none status-pause reservation without decision, grant, execution, or network access", async () => {
    const workspaceId=id("1"), runId=id("2"), revisionId=id("3"), artifactId=id("4"), adSetId=id("5");
    const memberRef=metaPublicReference("ad_set",workspaceId,adSetId), hash="a".repeat(64);
    const membership={entityLevel:"ad_set" as const,entityId:adSetId,entityRef:memberRef,market:"yerli" as const,
      included:true as const,reason:"dynamic_filter" as const,marketEvidenceRefs:[],matchedDimensionIds:[],matchedDimensionEvidenceRefs:[]};
    const scope={sliceRef:"slice_main",revisionRef:"slice_revision_main",definitionHash:"b".repeat(64),market:{key:"yerli"},adSetIds:[adSetId],campaignIds:[],
      resolution:{included:[membership],excluded:[]}};
    const membershipHash=guideRunMembershipEvidenceHash({sliceRef:"slice_main",revisionRef:"slice_revision_main",definitionHash:"b".repeat(64),membership});
    const execute=vi.fn()
      .mockResolvedValueOnce({rows:[{run_id:runId,guide_revision_id:revisionId,artifact_id:artifactId,candidate_hash:"c".repeat(64),action:"status_pause",
        member_ref:memberRef,membership_hash:membershipHash,typed_action:{kind:"status_change",entity:{level:"adset",ref:memberRef},fromStatus:"ACTIVE",toStatus:"PAUSED"},slice_ref:"slice_main",market_key:"yerli"}]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{entity_ref:"adset_external"}]})
      .mockResolvedValueOnce({rows:[{now:"2026-08-18T10:00:00.000Z"}]})
      .mockResolvedValueOnce({rows:[{canonical_hash:"1".repeat(64)},{canonical_hash:"2".repeat(64)}]})
      .mockResolvedValueOnce({rows:[{reserved:0}]})
      .mockResolvedValueOnce({rows:[{id:id("6"),admission_hash:"9".repeat(64),quota_ordinal:1}]});
    const tx={execute};
    const database={execute,transaction:async(work:(value:typeof tx)=>Promise<unknown>)=>work(tx)};
    const contexts={loadInTransaction:vi.fn().mockResolvedValue({workspaceRef:"workspace_main",accountRef:"account_external",campaignRef:"campaign_external",
      entityRef:"adset_external",currentStatus:"ACTIVE",contextHash:hash,effectiveGuideSetHash:"d".repeat(64),resolutionHash:"e".repeat(64),
      dataHealthReportHash:"f".repeat(64),approvalPolicy:{},approvalPolicyHash:"0".repeat(64),
      rules:[{ruleRef:"rule_workspace",workspaceRef:"workspace_main",scope:{level:"workspace",ref:"workspace_main"},mode:"policy_limited",state:"published",effectiveFrom:"2026-08-18T00:00:00.000Z",expiresAt:null,killSwitch:false,maximumActionsPerRun:1},
        {ruleRef:"rule_action",workspaceRef:"workspace_main",scope:{level:"action_type",actionType:"status_pause"},mode:"policy_limited",state:"published",effectiveFrom:"2026-08-18T00:00:00.000Z",expiresAt:null,killSwitch:false,maximumActionsPerRun:1}],
      protection:{protectedInternalCategoryRefs:[],affectedGeoRefs:[],protectedGeoRefs:[],changeDisposition:"allowed",policyRefs:[]},
      authority:{canApprove:false,canExecute:false,canWriteMeta:false}})};
    const scopes={currentSliceEvidenceInTransaction:vi.fn().mockResolvedValue(scope)};
    const saved=await new DrizzleP06LimitedAutonomyAdmissionRepository(database as never,contexts as never,scopes as never)
      .reserve({workspaceId,runRef:"guide_run_"+"1".repeat(24)});
    expect(saved).toMatchObject({admissionId:id("6"),quotaOrdinal:1,replay:false});
    expect(contexts.loadInTransaction).toHaveBeenCalledWith(tx,expect.objectContaining({authority:"limited_autonomy",action:"status_pause",entityRef:"adset_external"}));
    const rendered=execute.mock.calls.map(([query])=>sqlText(query)).join("\n");
    expect(rendered).toContain("insert into p06_limited_autonomy_admissions");
    expect(rendered).not.toMatch(/action_approval_decision|approval_evidence_grant|p06_execution_runs|fetch\(|authorization/i);
  });
});
