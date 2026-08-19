import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { canonicalGuideWorkspaceRef } from "@/domain/guides/guide-revision";
import { DrizzleGuideRunEffectiveOverlapRepository } from "@/connectors/guides/guide-run-effective-overlap-drizzle";
import {
  resolvePublishedApprovalPolicy,
  type ApprovalPolicyDefinitionRevision,
} from "@/domain/actions/approval-policy-registry";
import type { ApprovalPolicy } from "@/domain/actions/approval-lifecycle";
import { DrizzleAutonomyRuleRegistryRepository } from "@/connectors/actions/autonomy-rule-registry-drizzle-repository";
import { DrizzleMetaDataHealthAdapter } from "@/connectors/meta/data-health-drizzle-adapter";
import { ExistingPostPromotionProtectionEvidenceMaterializer } from "@/application/existing-post-promotion-protection-evidence-materializer";
import { createDrizzleAuthenticCategoryEvidenceAdapter } from "@/connectors/actions/authentic-category-evidence-adapter";
import { createDrizzleAuthenticAffectedGeoEvidenceAdapter } from "@/connectors/actions/authentic-affected-geo-evidence-adapter";
import { DrizzleActionGuardrailPolicyRepository } from "@/connectors/actions/action-guardrail-policy-drizzle-repository";
import { resolveSliceRuleBudgetActionGuardrails } from "@/connectors/campaigns/slice-rule-budget-action-unit-materializer";
import { resolveProtection } from "@/domain/actions/action-guardrail-policy";
import { createHash } from "node:crypto";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Record<string, unknown>;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;

/** Read-only, server-owned staging context. Unsupported actions, missing current
 * evidence, ambiguous policy, stale slice membership, and non-agent policies
 * all fail closed before any queue write can be attempted. */
export class DrizzleGuideRunCandidateStagingContextRepository {
  constructor(
    private readonly database: Pick<Database, "execute" | "transaction">,
    private readonly overlap: DrizzleGuideRunEffectiveOverlapRepository,
  ) {}
  async load(
    input: Readonly<{
      workspaceId: string;
      guideRevisionId: string;
      entityRef: string;
      actionHash: string;
      sliceRef: string;
      market: "yerli" | "yabanci";
      action:
        | "budget_decrease"
        | "budget_increase"
        | "status_pause"
        | "status_activate";
      at: string;
      authority?: "human_approval" | "limited_autonomy";
    }>,
  ) {
    return this.database.transaction(async (tx) =>
      this.loadInTransaction(tx, input),
    );
  }
  async loadInTransaction(
    tx: Pick<Database, "execute">,
    input: Readonly<{
      workspaceId: string;
      guideRevisionId: string;
      entityRef: string;
      actionHash: string;
      sliceRef: string;
      market: "yerli" | "yabanci";
      action:
        | "budget_decrease"
        | "budget_increase"
        | "status_pause"
        | "status_activate";
      at: string;
      authority?: "human_approval" | "limited_autonomy";
    }>,
  ) {
    if (
      !UUID.test(input.workspaceId) ||
      !UUID.test(input.guideRevisionId) ||
      !REF.test(input.entityRef) ||
      !HASH.test(input.actionHash) ||
      !REF.test(input.sliceRef) ||
      !/^\d{4}-\d\d-\d\dT/.test(input.at)
    )
      throw new Error("candidate context invalid");
    const result =
      await tx.execute(sql`select c.id::text context_id,c.context_hash,c.account_ref,c.entity_ref,c.entity_type,a.id::text account_id,cam.external_campaign_id campaign_ref,ad.external_ad_set_id adset_ref,coalesce(ad.effective_status,ad.configured_status) entity_status
        from effective_campaign_contexts c join workspaces w on w.id=c.workspace_id and w.lifecycle_state='active' and w.tombstoned_at is null
        join ad_accounts a on a.workspace_id=c.workspace_id and a.id=c.ad_account_id and a.disappeared_at is null
        join ad_campaigns cam on cam.workspace_id=c.workspace_id and cam.id=c.campaign_id and cam.disappeared_at is null
        left join meta_ad_sets ad on ad.workspace_id=c.workspace_id and ad.ad_account_id=a.id and ad.external_ad_set_id=c.entity_ref and ad.disappeared_at is null
        where c.workspace_id=${input.workspaceId}::uuid and c.entity_ref=${input.entityRef} and c.entity_type in ('campaign','ad_set') and c.captured_at<=${input.at}::timestamptz
          and not exists (
            select 1 from effective_campaign_context_components component
            join effective_campaign_context_invalidations invalidation
              on invalidation.workspace_id=component.workspace_id
             and invalidation.component_type=component.component_type
             and invalidation.component_ref=component.component_ref
             and invalidation.component_version=component.component_version
            where component.workspace_id=c.workspace_id and component.context_id=c.id
              and (invalidation.entity_type is null or (invalidation.entity_type=c.entity_type and invalidation.entity_ref=c.entity_ref))
          )
        order by c.captured_at desc,c.created_at desc,c.id desc limit 1 for share of c,w`);
    const rows = result.rows as Row[];
    if (rows.length !== 1) throw new Error("candidate context ambiguous");
    const row = rows[0]!;
    if (
      typeof row.context_id !== "string" ||
      !UUID.test(row.context_id) ||
      typeof row.context_hash !== "string" ||
      !HASH.test(row.context_hash) ||
      typeof row.account_ref !== "string" ||
      !REF.test(row.account_ref) ||
      typeof row.account_id !== "string" ||
      !UUID.test(row.account_id) ||
      typeof row.campaign_ref !== "string" ||
      !REF.test(row.campaign_ref) ||
      row.entity_ref !== input.entityRef
    )
      throw new Error("candidate context corrupt");
    let resolved: ReturnType<typeof resolvePublishedApprovalPolicy>;
    const applicability =
      input.action === "status_pause"
        ? { actionType: "status_pause" as const, risk: "K2" as const }
        : input.action === "status_activate"
          ? { actionType: "status_activate" as const, risk: "K3" as const }
          : null;
    if (!applicability) throw new Error("unsupported candidate action");
    try {
      const policyRows = (
        await tx.execute(
          sql`select artifact_payload from approval_policy_definition_revisions where workspace_id=${input.workspaceId}::uuid and action_type=${input.action} order by policy_ref,revision limit 1001`,
        )
      ).rows as Row[];
      if (policyRows.length === 0 || policyRows.length > 1000)
        throw new Error();
      resolved = resolvePublishedApprovalPolicy({
        workspaceRef: canonicalGuideWorkspaceRef(input.workspaceId),
        evaluatedAt: input.at,
        applicability,
        definitions: policyRows.map(
          (x) => x.artifact_payload as ApprovalPolicyDefinitionRevision,
        ),
      });
    } catch {
      throw new Error("policy artifact invalid");
    }
    if (!resolved.policy.requesterRoles.includes("agent"))
      throw new Error("agent requester denied");
    const effective = await this.overlap.resolveInTransaction(tx, {
      workspaceId: input.workspaceId,
      workspaceRef: canonicalGuideWorkspaceRef(input.workspaceId),
      guideRevisionId: input.guideRevisionId,
      entityRef: input.entityRef,
      sliceRef: input.sliceRef,
      market: input.market,
      action: input.action,
      at: input.at,
    });
    const expectedAuthority = input.authority ?? "human_approval";
    if (
      effective.hold.state !== "clear" ||
      (expectedAuthority === "human_approval"
        ? !effective.humanApprovalActions.includes(input.action)
        : effective.effectiveMode !== "limited_autonomy" || !effective.autonomousActions.includes(input.action))
    )
      throw new Error("guide overlap denied");
    if (
      row.entity_type !== "ad_set" ||
      typeof row.adset_ref !== "string" ||
      row.adset_ref !== input.entityRef
    )
      throw new Error("aggregate geo protection unavailable");
    let health;
    try {
      health = await new DrizzleMetaDataHealthAdapter(tx as never).evaluate({
        workspaceId: input.workspaceId,
        targetAdAccountId: row.account_id as string,
        evaluatedAt: input.at,
      });
    } catch {
      throw new Error("data health unavailable");
    }
    if (
      health.report.state !== "ready" ||
      !HASH.test(health.report.reportHash) ||
      !health.report.monetaryAggregationAccountRefs.includes(
        health.targetAccountRef,
      )
    )
      throw new Error("data health hold");
    let rules;
    try {
      rules = await new DrizzleAutonomyRuleRegistryRepository(
        { transaction: async (work: any) => work(tx) } as never,
        input.workspaceId,
        canonicalGuideWorkspaceRef(input.workspaceId),
      ).resolve();
    } catch {
      throw new Error("autonomy unavailable");
    }
    const guardrailRepository = new DrizzleActionGuardrailPolicyRepository(
      { transaction: async (work: any) => work(tx) } as never,
      input.workspaceId,
      canonicalGuideWorkspaceRef(input.workspaceId),
    );
    let guardrails;
    try {
      guardrails = await guardrailRepository.listArtifacts();
    } catch {
      throw new Error("protection unavailable");
    }
    let protection;
    if (guardrails.length === 0) {
      // An exact empty registry has no category/geo selector to evaluate.
      // Keep this distinct from an unavailable registry, which is rejected
      // above, and from any non-empty registry, which still requires full
      // canonical category + affected-geo evidence below.
      protection = Object.freeze({
        disposition: "allowed" as const,
        protectedInternalCategoryRefs: Object.freeze([] as string[]),
        affectedGeoRefs: Object.freeze([] as string[]),
        protectedGeoRefs: Object.freeze([] as string[]),
        resolutionHash: createHash("sha256")
          .update(
            JSON.stringify({
              workspaceRef: canonicalGuideWorkspaceRef(input.workspaceId),
              evaluatedAt: input.at,
              actionHash: input.actionHash,
              policySet: [],
            }),
          )
          .digest("hex"),
        policyEvidence: Object.freeze([] as Array<{ policyRef: string }>),
      });
    } else {
      const notBefore = new Date(
        Date.parse(input.at) -
          resolved.policy.maximumProtectionEvidenceAgeSeconds * 1000,
      ).toISOString();
      let evidence;
      try {
        evidence =
          await new ExistingPostPromotionProtectionEvidenceMaterializer(
            createDrizzleAuthenticCategoryEvidenceAdapter({
              database: tx as never,
              workspaceId: input.workspaceId,
              workspaceRef: canonicalGuideWorkspaceRef(input.workspaceId),
            }),
            createDrizzleAuthenticAffectedGeoEvidenceAdapter({
              database: tx as never,
              workspaceId: input.workspaceId,
              workspaceRef: canonicalGuideWorkspaceRef(input.workspaceId),
              readOnlyTransaction: true,
            }),
          ).resolve({
            workspaceId: input.workspaceId,
            workspaceRef: canonicalGuideWorkspaceRef(input.workspaceId),
            accountRef: row.account_ref as string,
            campaignRef: row.campaign_ref as string,
            entity: { level: "adset", ref: input.entityRef },
            evaluatedAt: input.at,
            notBefore,
          });
      } catch {
        throw new Error("protection unavailable");
      }
      if (
        evidence.categoryEvidence.status !== "known" ||
        evidence.affectedGeoEvidence.status !== "known"
      ) {
        throw new Error("protection unavailable");
      }
      try {
        protection = resolveProtection({
          workspaceRef: canonicalGuideWorkspaceRef(input.workspaceId),
          evaluatedAt: input.at,
          action: {
            actionHash: input.actionHash,
            actionType: input.action,
            accountRef: row.account_ref as string,
            campaignRef: row.campaign_ref as string,
            entity: { level: "adset", ref: input.entityRef },
            budgetChange: null,
          },
          categoryEvidence: evidence.categoryEvidence,
          affectedGeoEvidence: evidence.affectedGeoEvidence,
          revisions: guardrails,
        });
      } catch {
        throw new Error("protection unavailable");
      }
    }
    if (protection.disposition !== "allowed")
      throw new Error("protection hold");
    const approvalPolicy: ApprovalPolicy = Object.freeze({
      ...resolved.policy,
    });
    const protectionContext = Object.freeze({
      protectedInternalCategoryRefs: Object.freeze([
        ...protection.protectedInternalCategoryRefs,
      ]),
      affectedGeoRefs: Object.freeze([...protection.affectedGeoRefs]),
      protectedGeoRefs: Object.freeze([...protection.protectedGeoRefs]),
      changeDisposition: protection.disposition,
      policyRefs: Object.freeze(
        [
          `protection_resolution_${protection.resolutionHash.slice(0, 24)}`,
          ...protection.policyEvidence.map((x) => x.policyRef),
        ].sort(),
      ),
    });
    if (row.entity_status !== "ACTIVE" && row.entity_status !== "PAUSED")
      throw new Error("current status unavailable");
    return Object.freeze({
      workspaceRef: canonicalGuideWorkspaceRef(input.workspaceId),
      accountRef: row.account_ref as string,
      campaignRef: row.campaign_ref as string,
      entityRef: input.entityRef,
      currentStatus: row.entity_status as "ACTIVE" | "PAUSED",
      contextId: row.context_id as string,
      contextHash: row.context_hash as string,
      approvalPolicy,
      approvalPolicyHash: resolved.policyHash,
      rules,
      protection: protectionContext,
      dataHealthReportHash: health.report.reportHash,
      effectiveGuideSetHash: effective.effectiveGuideSetHash,
      resolutionHash: effective.resolutionHash,
      authority: Object.freeze({
        canApprove: false as const,
        canExecute: false as const,
        canWriteMeta: false as const,
      }),
    });
  }
}
