import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { GuideBudgetActionTrustedContextReadPort } from "@/application/guide-budget-action-preparation-service";
import { ExistingPostPromotionProtectionEvidenceMaterializer } from "@/application/existing-post-promotion-protection-evidence-materializer";
import { createDrizzleAuthenticAffectedGeoEvidenceAdapter } from "@/connectors/actions/authentic-affected-geo-evidence-adapter";
import { createDrizzleAuthenticCategoryEvidenceAdapter } from "@/connectors/actions/authentic-category-evidence-adapter";
import { DrizzleMetaDataHealthAdapter } from "@/connectors/meta/data-health-drizzle-adapter";
import { assertValidActionGuardrailPolicyRevision, resolveProtection } from "@/domain/actions/action-guardrail-policy";
import type { ProtectionContext } from "@/domain/actions/autonomy-valve";
import { assertValidApprovalPolicyDefinition, resolvePublishedApprovalPolicy } from "@/domain/actions/approval-policy-registry";
import { assertValidAutonomyRuleArtifact, resolveAutonomyRules } from "@/domain/actions/autonomy-rule-registry";
import { metaPublicReference } from "@/domain/meta/public-reference";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type ReadDatabase = Pick<Database, "transaction">;
type Row = Readonly<Record<string, unknown>>;

/** No client-provided runtime context can cross this server-only resolver. */
export class GuideBudgetActionTrustedContextRepositoryError extends Error {
  constructor(readonly code: "owner_missing" | "owner_ambiguous" | "parent_ceiling_unavailable" | "data_health_hold" | "context_unavailable" | "policy_unavailable" | "autonomy_unavailable" | "protection_unavailable") { super(code); }
}
const rows = (value: unknown): readonly Row[] => value && typeof value === "object" && "rows" in value && Array.isArray(value.rows) ? value.rows as readonly Row[] : [];
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
function fail(code: GuideBudgetActionTrustedContextRepositoryError["code"]): never { throw new GuideBudgetActionTrustedContextRepositoryError(code); }
function protection(resolution: ReturnType<typeof resolveProtection>): ProtectionContext {
  return Object.freeze({ protectedInternalCategoryRefs: Object.freeze([...resolution.protectedInternalCategoryRefs]), affectedGeoRefs: Object.freeze([...resolution.affectedGeoRefs]), protectedGeoRefs: Object.freeze([...resolution.protectedGeoRefs]), changeDisposition: resolution.disposition, policyRefs: Object.freeze([...new Set([`protection_resolution_${resolution.resolutionHash.slice(0, 24)}`, ...resolution.policyEvidence.map((item) => item.policyRef)])].sort()) });
}

/**
 * Resolves a public evidence alias only to a tenant-bound canonical mirror
 * row. The alias never becomes an ActionUnit ref; all action inputs below are
 * private, current, repeatable-read evidence. No queue or Meta capability is
 * present here.
 */
export class DrizzleGuideBudgetActionTrustedContextRepository implements GuideBudgetActionTrustedContextReadPort {
  constructor(private readonly database: ReadDatabase) {}
  async load(input: Parameters<GuideBudgetActionTrustedContextReadPort["load"]>[0]) {
    const owner = input.dryRun.effectiveBudgetOwner;
    if (!owner || !UUID.test(input.workspaceId) || !iso(input.evaluatedAt)) fail("owner_missing");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`set local transaction isolation level repeatable read`);
      await tx.execute(sql`set local transaction read only`);
      const candidates = rows(await tx.execute(sql`
        select ctx.account_ref,ctx.campaign_ref,ctx.context_hash,
          to_char(ctx.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') context_captured_at,
          a.id::text account_id,a.external_account_id account_external_ref,c.id::text campaign_id,c.external_campaign_id campaign_external_ref,
          s.id::text adset_id,s.external_ad_set_id adset_external_ref
        from effective_campaign_contexts ctx
        join workspaces w on w.id=ctx.workspace_id and w.lifecycle_state='active' and w.tombstoned_at is null
        join ad_accounts a on a.workspace_id=ctx.workspace_id and a.id=ctx.ad_account_id and a.disappeared_at is null
        join ad_campaigns c on c.workspace_id=ctx.workspace_id and c.id=ctx.campaign_id and c.ad_account_id=a.id and c.disappeared_at is null
        left join meta_ad_sets s on s.workspace_id=ctx.workspace_id and s.campaign_id=c.id and s.ad_account_id=a.id
          and s.external_ad_set_id=ctx.entity_ref and s.disappeared_at is null
        where ctx.workspace_id=${input.workspaceId}::uuid and ctx.entity_type=${owner.budgetOwnerKind === "campaign" ? "campaign" : "ad_set"}
          and ctx.captured_at <= ${input.evaluatedAt}::timestamptz
          and not exists (
            select 1 from effective_campaign_context_components component
            join effective_campaign_context_invalidations invalidation
              on invalidation.workspace_id=component.workspace_id
             and invalidation.component_type=component.component_type
             and invalidation.component_ref=component.component_ref
             and invalidation.component_version=component.component_version
            where component.workspace_id=ctx.workspace_id and component.context_id=ctx.id
              and (invalidation.entity_type is null or (invalidation.entity_type=ctx.entity_type and invalidation.entity_ref=ctx.entity_ref))
          )
        order by ctx.captured_at desc,ctx.created_at desc limit 1001
      `));
      if (candidates.length > 1000) throw new GuideBudgetActionTrustedContextRepositoryError("owner_ambiguous");
      const matches = candidates.filter((row) => {
        const id = owner.budgetOwnerKind === "campaign" ? row.campaign_id : row.adset_id;
        return typeof id === "string" && metaPublicReference(owner.budgetOwnerKind === "campaign" ? "campaign" : "ad_set", input.workspaceId, id) === owner.budgetOwnerRef;
      });
      if (matches.length === 0) throw new GuideBudgetActionTrustedContextRepositoryError("owner_missing");
      if (matches.length !== 1) throw new GuideBudgetActionTrustedContextRepositoryError("owner_ambiguous");
      const row = matches[0]! as Row;
      const accountId = row.account_id, accountRef = row.account_external_ref, campaignRef = row.campaign_external_ref;
      const entityRef = owner.budgetOwnerKind === "campaign" ? campaignRef : row.adset_external_ref;
      const workspaceRef = `workspace_${createHash("sha256").update(input.workspaceId).digest("hex").slice(0, 24)}`;
      if (typeof accountId !== "string" || !UUID.test(accountId) || typeof accountRef !== "string" || !REF.test(accountRef)
        || typeof campaignRef !== "string" || !REF.test(campaignRef) || typeof entityRef !== "string" || !REF.test(entityRef)
        || typeof row.context_hash !== "string" || !HASH.test(row.context_hash) || !iso(row.context_captured_at)) fail("context_unavailable");
      let health;
      try { health = await new DrizzleMetaDataHealthAdapter(tx as never).evaluate({ workspaceId: input.workspaceId, targetAdAccountId: accountId, evaluatedAt: input.evaluatedAt }); }
      catch { fail("data_health_hold"); }
      if (health.report.state !== "ready" || !HASH.test(health.report.reportHash) || !health.report.monetaryAggregationAccountRefs.includes(health.targetAccountRef)) fail("data_health_hold");
      const applicability = input.dryRun.requestedDeltaDecimal?.startsWith("-")
        ? Object.freeze({ actionType: "budget_decrease" as const, risk: "K2" as const })
        : Object.freeze({ actionType: "budget_increase" as const, risk: "K3" as const });
      const actionType = applicability.actionType;
      let approvalPolicy; let rules;
      try {
        const policyRows = rows(await tx.execute(sql`select artifact_payload from approval_policy_definition_revisions where workspace_id=${input.workspaceId}::uuid and action_type=${applicability.actionType} and risk=${applicability.risk} order by policy_ref,revision limit 1001`));
        if (policyRows.length > 1000) fail("policy_unavailable");
        approvalPolicy = resolvePublishedApprovalPolicy({ workspaceRef, evaluatedAt: input.evaluatedAt, applicability,
          definitions: policyRows.map((item) => assertValidApprovalPolicyDefinition(item.artifact_payload)) }).policy;
      } catch { fail("policy_unavailable"); }
      try {
        const ruleRows = rows(await tx.execute(sql`select artifact_payload from autonomy_rule_revisions where workspace_id=${input.workspaceId}::uuid and state in ('published','disabled') order by rule_ref,revision limit 10001`));
        if (ruleRows.length > 10_000) fail("autonomy_unavailable");
        const artifacts = ruleRows.map((item) => assertValidAutonomyRuleArtifact(item.artifact_payload));
        const groupRefs = [...new Set(artifacts.flatMap((artifact) => artifact.scope.level === "account_group" ? [artifact.scope.ref] : []))];
        const activeGroupRows = groupRefs.length === 0 ? [] : rows(await tx.execute(sql`
          select h.group_ref from account_groups h join account_group_revisions r
            on r.workspace_id=h.workspace_id and r.account_group_id=h.id and r.revision=h.current_revision
            and r.revision_hash=h.current_revision_hash and r.status='active'
          where h.workspace_id=${input.workspaceId}::uuid and h.group_ref=any(${groupRefs}::text[]) limit 10001
        `));
        const activeGroups = new Set(activeGroupRows.map((item) => item.group_ref).filter((item): item is string => typeof item === "string" && groupRefs.includes(item)));
        if (activeGroupRows.length > groupRefs.length) fail("autonomy_unavailable");
        rules = resolveAutonomyRules({ workspaceRef, artifacts: artifacts.filter((artifact) => artifact.scope.level !== "account_group" || activeGroups.has(artifact.scope.ref)) });
      } catch { fail("autonomy_unavailable"); }
      // A CBO campaign cannot reuse one ad set's geo snapshot as aggregate proof.
      if (owner.budgetOwnerKind === "campaign") fail("protection_unavailable");
      const notBefore = new Date(Date.parse(input.evaluatedAt) - approvalPolicy.maximumProtectionEvidenceAgeSeconds * 1_000).toISOString();
      let evidence;
      try { evidence = await new ExistingPostPromotionProtectionEvidenceMaterializer(
        createDrizzleAuthenticCategoryEvidenceAdapter({ database: tx as never, workspaceId: input.workspaceId, workspaceRef }),
        createDrizzleAuthenticAffectedGeoEvidenceAdapter({ database: tx as never, workspaceId: input.workspaceId, workspaceRef, readOnlyTransaction: true }),
      ).resolve(Object.freeze({ workspaceId: input.workspaceId, workspaceRef, accountRef, campaignRef,
        entity: Object.freeze({ level: "adset" as const, ref: entityRef }), evaluatedAt: input.evaluatedAt, notBefore })); }
      catch { fail("protection_unavailable"); }
      if (evidence.categoryEvidence.status !== "known" || evidence.affectedGeoEvidence.status !== "known") fail("protection_unavailable");
      let resolved; let guardrailRevisions;
      try {
        const guardrailRows = rows(await tx.execute(sql`select artifact_payload from action_guardrail_policy_revisions where workspace_id=${input.workspaceId}::uuid order by policy_ref,revision limit 10001`));
        if (guardrailRows.length > 10_000) fail("protection_unavailable");
        guardrailRevisions = guardrailRows.map((item) => assertValidActionGuardrailPolicyRevision(item.artifact_payload));
      } catch { fail("protection_unavailable"); }
      try { resolved = resolveProtection({ workspaceRef, evaluatedAt: input.evaluatedAt,
        action: Object.freeze({ actionHash: digest({ actionType, accountRef, campaignRef, entityRef, dryRunHash: input.dryRun.dryRunHash }), actionType, accountRef, campaignRef,
          entity: Object.freeze({ level: "adset" as const, ref: entityRef }), budgetChange: Object.freeze({ currency: input.dryRun.currency, absoluteDeltaDecimal: input.dryRun.requestedDeltaDecimal!.replace("-", ""), relativeDeltaBasisPoints: input.dryRun.effectiveMaximumRelativeDeltaBasisPoints }) }),
        categoryEvidence: evidence.categoryEvidence, affectedGeoEvidence: evidence.affectedGeoEvidence,
        // Plain SELECT stays inside this outer RR/READ ONLY transaction.
        // Registry writer APIs take FOR SHARE locks and are not legal here.
        revisions: guardrailRevisions }); }
      catch { fail("protection_unavailable"); }
      if (resolved.disposition !== "allowed") fail("protection_unavailable");
      // Preserve a fully authenticated runtime shape for the future ceiling source.
      void Object.freeze({ runtime: Object.freeze({ workspaceRef, accountGroupRef: null, accountRef, accountExternalRef: accountRef,
        ownerPublicRef: owner.budgetOwnerRef, ownerEntityExternalRef: entityRef, internalCategoryRefs: resolved.protectedInternalCategoryRefs,
        campaignRef, rules, protection: protection(resolved), frozenContextHash: row.context_hash, dataHealthReady: true, dataHealthReportHash: health.report.reportHash }), approvalPolicy });
      // No canonical parent/pool ceiling exists yet. Never treat this as unlimited.
      fail("parent_ceiling_unavailable");
    });
  }
}
