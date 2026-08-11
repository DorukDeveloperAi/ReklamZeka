import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { hasExactAuthoritativeImpact } from "@/domain/guidance/authoritative-g3-replay-preview";
import type { StrictInstructionPolicy } from "@/domain/policies/instruction-policy-dsl";
import { buildEffectiveCampaignContext, EFFECTIVE_CAMPAIGN_CONTEXT_VERSION,
  type EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import * as schema from "@/db/schema";
import { DrizzleInstructionPolicyImpactRepository } from "@/connectors/policies/instruction-policy-impact-drizzle-repository";
import { DrizzleTrustedPolicyAuthorityRepository } from "@/connectors/policies/trusted-policy-authority-drizzle-repository";

type Database = Pick<NodePgDatabase<typeof schema>, "execute">;
type Row = Readonly<Record<string, unknown>>;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const MAX_HISTORY = 100;

export type AuthoritativeG3EvidenceBridgeResult = Readonly<{
  sourceBound: boolean;
  candidateTierDecisionBound: boolean;
  exactImpact: boolean;
  historicalRunsEvaluated: number;
  evaluatedRevisionRefs: readonly string[];
  historicalContextHashes: readonly string[];
  outcomeEvidenceRefs: readonly string[];
}>;

/**
 * Server-private, read-only bridge used by the progressive repository both for
 * GET preview and for the promote_g3 transaction.  The caller supplies its
 * transaction executor, so no nested transaction can make the proof drift.
 */
export type AuthoritativeG3EvidenceBridge = Readonly<{
  resolve(database: Database, input: Readonly<{
    workspaceId: string;
    formalizationRef?: string;
    g2RevisionHash?: string;
    policy: StrictInstructionPolicy;
    guidanceSetRef: string;
    guidanceSetVersion: number;
    guidanceSetHash: string;
  }>): Promise<AuthoritativeG3EvidenceBridgeResult>;
}>;

function rows(value: unknown): readonly Row[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) throw new Error("corrupt_store");
  return value.rows as readonly Row[];
}
function iso(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  const normalized = new Date(value).toISOString(); return normalized === value ? normalized : null;
}
function empty(exactImpact = false): AuthoritativeG3EvidenceBridgeResult {
  return Object.freeze({ sourceBound: false, candidateTierDecisionBound: false, exactImpact,
    historicalRunsEvaluated: 0, evaluatedRevisionRefs: Object.freeze([]), historicalContextHashes: Object.freeze([]),
    outcomeEvidenceRefs: Object.freeze([]) });
}
function unavailable(exactImpact: boolean, parsed: readonly Readonly<{
  bindingHash: string; contextHash: string; outcomeEvidence: readonly Readonly<{ evidenceRef: string; evidenceHash: string }>[];
}>[]): AuthoritativeG3EvidenceBridgeResult {
  const evaluatedRevisionRefs = [...new Set(parsed.map((entry) => `analysis_revision_${entry.bindingHash.slice(0, 24)}`))].sort();
  const historicalContextHashes = [...new Set(parsed.map((entry) => entry.contextHash))].sort();
  const outcomeEvidenceRefs = [...new Set(parsed.flatMap((entry) => entry.outcomeEvidence.map((evidence) => evidence.evidenceRef)))].sort();
  return Object.freeze({ sourceBound: false, candidateTierDecisionBound: false, exactImpact,
    historicalRunsEvaluated: parsed.length, evaluatedRevisionRefs: Object.freeze(evaluatedRevisionRefs),
    historicalContextHashes: Object.freeze(historicalContextHashes), outcomeEvidenceRefs: Object.freeze(outcomeEvidenceRefs) });
}
function authenticFrozenContext(value: unknown, input: Readonly<{ workspaceId: string; contextHash: string;
  accountRef: string; capturedAt: string }>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (payload.schemaVersion !== EFFECTIVE_CAMPAIGN_CONTEXT_VERSION || payload.contextHash !== input.contextHash
    || !payload.capabilities || typeof payload.capabilities !== "object" || Array.isArray(payload.capabilities)) return false;
  const { schemaVersion: _schemaVersion, contextHash: _contextHash, capabilities: _capabilities, ...base } = payload;
  try {
    const rebuilt = buildEffectiveCampaignContext(base as EffectiveCampaignContextInput);
    return rebuilt.contextHash === input.contextHash && rebuilt.workspaceId === input.workspaceId
      && rebuilt.identity.accountRef === input.accountRef && rebuilt.capturedAt === input.capturedAt;
  } catch { return false; }
}
function frozenAuthoritySnapshot(value: unknown): Readonly<{ snapshotRef: string; snapshotHash: string }> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const evidence = (value as Record<string, unknown>).policyAuthorityEvidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const payload = evidence as Record<string, unknown>;
  return typeof payload.snapshotRef === "string" && REF.test(payload.snapshotRef)
    && typeof payload.snapshotHash === "string" && HASH.test(payload.snapshotHash)
    ? Object.freeze({ snapshotRef: payload.snapshotRef, snapshotHash: payload.snapshotHash }) : null;
}

export function createDrizzleAuthoritativeG3EvidenceBridge(input: Readonly<{
  /** Test seam; production always uses the relational trusted-authority loader. */
  authority?: Pick<DrizzleTrustedPolicyAuthorityRepository, "loadInTransaction">;
  impacts?: Pick<DrizzleInstructionPolicyImpactRepository, "preview">;
}> = {}): AuthoritativeG3EvidenceBridge {
  return Object.freeze({
    async resolve(database, request) {
      if (!HASH.test(request.guidanceSetHash) || !REF.test(request.guidanceSetRef)
        || !Number.isSafeInteger(request.guidanceSetVersion) || request.guidanceSetVersion < 1) throw new Error("invalid_input");
      const impacts = input.impacts ?? new DrizzleInstructionPolicyImpactRepository(database);
      const impact = await impacts.preview(request.workspaceId, request.policy.policyRef, "publish");
      const exactImpact = impact !== null && hasExactAuthoritativeImpact(impact);
      const history = rows(await database.execute(sql`
        with matching_runs as (
          select binding.run_id, binding.binding_hash from guidance_analysis_run_bindings binding
          where binding.workspace_id = ${request.workspaceId}::uuid
            and binding.selected_set_refs @> jsonb_build_array(jsonb_build_object(
              'setRef', ${request.guidanceSetRef}, 'version', ${request.guidanceSetVersion}, 'recordHash', ${request.guidanceSetHash}
            ))
          order by binding.binding_hash asc limit ${MAX_HISTORY + 1}
        ) select matching.binding_hash, context.context_hash, context.context_payload, context.account_ref,
          to_char(context.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as captured_at
        from matching_runs matching join decision_room_run_analysis_assets asset
          on asset.workspace_id = ${request.workspaceId}::uuid and asset.run_id = matching.run_id
        join effective_campaign_contexts context on context.workspace_id = asset.workspace_id and context.id = asset.context_id
        order by matching.binding_hash asc, context.context_hash asc limit ${MAX_HISTORY + 1}
      `));
      if (history.length > MAX_HISTORY) throw new Error("history_cap_exceeded");
      const parsed = history.map((row) => {
        const bindingHash = typeof row.binding_hash === "string" && HASH.test(row.binding_hash) ? row.binding_hash : null;
        const contextHash = typeof row.context_hash === "string" && HASH.test(row.context_hash) ? row.context_hash : null;
        const accountRef = typeof row.account_ref === "string" && REF.test(row.account_ref) ? row.account_ref : null;
        const capturedAt = iso(row.captured_at);
        if (!bindingHash || !contextHash || !accountRef || !capturedAt) return null;
        if (!authenticFrozenContext(row.context_payload, { workspaceId: request.workspaceId, contextHash, accountRef, capturedAt })) return null;
        const authoritySnapshot = frozenAuthoritySnapshot(row.context_payload);
        if (!authoritySnapshot) return null;
        const frozenHistory = (row.context_payload as Record<string, unknown>).history;
        const frozenOutcomeEvidence = frozenHistory && typeof frozenHistory === "object" && !Array.isArray(frozenHistory)
          ? (frozenHistory as Record<string, unknown>).outcomeEvidence : null;
        if (!Array.isArray(frozenOutcomeEvidence)) return null;
        const outcomeEvidence = frozenOutcomeEvidence.map((evidence) => evidence && typeof evidence === "object" && !Array.isArray(evidence)
          && typeof (evidence as Record<string, unknown>).evidenceRef === "string"
          && /^outcome_evidence_[a-f0-9]{24}$/.test((evidence as Record<string, unknown>).evidenceRef as string)
          && typeof (evidence as Record<string, unknown>).evidenceHash === "string"
          && HASH.test((evidence as Record<string, unknown>).evidenceHash as string)
          ? { evidenceRef: (evidence as Record<string, string>).evidenceRef,
            evidenceHash: (evidence as Record<string, string>).evidenceHash } : null);
        if (outcomeEvidence.some((value) => value === null)) return null;
        return { bindingHash, contextHash, accountRef, capturedAt, authoritySnapshot,
          outcomeEvidence: outcomeEvidence as { evidenceRef: string; evidenceHash: string }[] };
      });
      if (parsed.some((entry) => entry === null)) return empty(exactImpact);
      const authenticated = parsed as readonly NonNullable<typeof parsed[number]>[];
      if (authenticated.length === 0) return empty(exactImpact);
      // One snapshot is not proof for a mixed-account replay.  Do not choose an
      // arbitrary account or silently widen authority across the selected rows.
      if (new Set(authenticated.map((entry) => entry.accountRef)).size !== 1) return unavailable(exactImpact, authenticated);
      const authority = input.authority ?? new DrizzleTrustedPolicyAuthorityRepository(database);
      // Every frozen capture names its own immutable snapshot.  Validate each
      // one through the same relational proof used by source composition;
      // accepting only the JSON envelope would make a historical replay forgeable.
      try {
        for (const entry of authenticated) await authority.loadInTransaction(database, {
          workspaceId: request.workspaceId, accountRef: entry.accountRef, evaluatedAt: entry.capturedAt,
          snapshotRef: entry.authoritySnapshot.snapshotRef, snapshotHash: entry.authoritySnapshot.snapshotHash,
        });
      } catch { return unavailable(exactImpact, authenticated); }
      const expectedOutcomeEvidence = [...new Map(authenticated.flatMap((entry) => entry.outcomeEvidence)
        .map((evidence) => [`${evidence.evidenceRef}:${evidence.evidenceHash}`, evidence] as const)).values()]
        .sort((left, right) => left.evidenceRef.localeCompare(right.evidenceRef) || left.evidenceHash.localeCompare(right.evidenceHash));
      // Historical runs without outcome snapshots stay replay-incomplete.  A
      // JSON envelope alone is never accepted as authoritative backing.
      if (expectedOutcomeEvidence.length === 0) return unavailable(exactImpact, authenticated);
      const backed = rows(await database.execute(sql`
        select evidence.evidence_ref, evidence.evidence_hash from business_outcome_evidence_snapshots evidence
        join jsonb_to_recordset(${JSON.stringify(expectedOutcomeEvidence)}::jsonb)
          as expected("evidenceRef" text, "evidenceHash" text)
          on expected."evidenceRef" = evidence.evidence_ref and expected."evidenceHash" = evidence.evidence_hash
        where evidence.workspace_id = ${request.workspaceId}::uuid
        order by evidence.evidence_ref asc, evidence.evidence_hash asc
      `));
      const backedKeys = backed.map((row) => typeof row.evidence_ref === "string" && typeof row.evidence_hash === "string"
        && /^outcome_evidence_[a-f0-9]{24}$/.test(row.evidence_ref) && HASH.test(row.evidence_hash)
        ? `${row.evidence_ref}:${row.evidence_hash}` : null);
      const expectedKeys = expectedOutcomeEvidence.map((evidence) => `${evidence.evidenceRef}:${evidence.evidenceHash}`);
      if (backedKeys.some((value) => value === null) || backedKeys.length !== expectedKeys.length
        || JSON.stringify(backedKeys) !== JSON.stringify(expectedKeys)) return unavailable(exactImpact, authenticated);
      // A draft's tier/decision is deliberately proven only by the private
      // candidate ledger.  Production catalogs and frozen source contexts
      // never elevate a draft to productionAuthoritySourceBound.
      const candidateRows = !request.formalizationRef || !request.g2RevisionHash || !HASH.test(request.g2RevisionHash) || !REF.test(request.formalizationRef)
        ? [] : rows(await database.execute(sql`
        select revision.revision_hash, revision.authority_tier, revision.decision,
          revision.authority_snapshot_ref, revision.authority_snapshot_hash
          from candidate_preview_binding_heads head
          join candidate_preview_binding_revisions revision
            on revision.workspace_id = head.workspace_id and revision.id = head.current_revision_id
              and revision.revision = head.current_revision and revision.revision_hash = head.current_revision_hash
          join progressive_formalization_revisions g2
            on g2.workspace_id = revision.workspace_id and g2.formalization_ref = revision.formalization_ref
              and g2.sequence = 3 and g2.to_level = 'G2' and g2.revision_hash = revision.g2_revision_hash
              and not exists (select 1 from progressive_formalization_revisions later
                where later.workspace_id = g2.workspace_id and later.formalization_ref = g2.formalization_ref and later.sequence > 3)
          join guidance_sets guidance
            on guidance.workspace_id = revision.workspace_id and guidance.id = revision.guidance_set_id
              and guidance.set_key = revision.guidance_set_ref and guidance.version = revision.guidance_set_version
              and guidance.record_hash = revision.guidance_set_hash and guidance.review_status = 'reviewed'
              and not exists (select 1 from guidance_sets later
                where later.workspace_id = guidance.workspace_id and later.set_key = guidance.set_key and later.version > guidance.version)
          join strict_instruction_policy_revisions policy
            on policy.workspace_id = revision.workspace_id and policy.id = revision.policy_revision_id
              and policy.policy_ref = revision.policy_ref and policy.policy_version = revision.policy_version
              and policy.canonical_hash = revision.policy_hash and policy.status = 'draft'
              and not exists (select 1 from strict_instruction_policy_revisions later
                where later.workspace_id = policy.workspace_id and later.policy_ref = policy.policy_ref and later.policy_version > policy.policy_version)
          join ad_accounts account
            on account.workspace_id = revision.workspace_id and account.id = revision.target_account_id
              and account.external_account_id = revision.target_account_ref and account.disappeared_at is null
          join tenant_authority_snapshots snapshot
            on snapshot.workspace_id = revision.workspace_id and snapshot.id = revision.authority_snapshot_id
              and snapshot.snapshot_ref = revision.authority_snapshot_ref and snapshot.snapshot_hash = revision.authority_snapshot_hash
              and snapshot.snapshot_payload #> '{repository,verified}' = 'true'::jsonb
          join tenant_authority_snapshot_heads snapshot_head
            on snapshot_head.workspace_id = snapshot.workspace_id and snapshot_head.current_snapshot_id = snapshot.id
              and snapshot_head.current_snapshot_hash = snapshot.snapshot_hash
          left join candidate_preview_binding_invalidations invalidation
            on invalidation.workspace_id = revision.workspace_id and invalidation.binding_revision_id = revision.id
         where head.workspace_id = ${request.workspaceId}::uuid and head.formalization_ref = ${request.formalizationRef}
           and revision.g2_revision_hash = ${request.g2RevisionHash}
           and revision.guidance_set_ref = ${request.guidanceSetRef} and revision.guidance_set_version = ${request.guidanceSetVersion}
           and revision.guidance_set_hash = ${request.guidanceSetHash}
           and revision.policy_ref = ${request.policy.policyRef} and revision.policy_version = ${request.policy.policyVersion}
           and revision.policy_hash = ${request.policy.canonicalHash}
           and revision.target_account_ref = ${authenticated[0]!.accountRef}
           and invalidation.id is null
         limit 2
      `));
      const candidate = candidateRows[0];
      const decision = candidate?.decision;
      const candidateStructurallyBound = candidate !== undefined && candidateRows.length === 1 && HASH.test(String(candidate.revision_hash))
        && typeof candidate.authority_tier === "string" && candidate.authority_tier.length > 0
        && !!decision && typeof decision === "object" && !Array.isArray(decision)
        && typeof (decision as Record<string, unknown>).decisionKey === "string"
        && typeof (decision as Record<string, unknown>).positionKey === "string";
      // Candidate bindings remain preview-only, but their snapshot must still
      // be valid for the account at this read instant.  The trusted loader
      // proves current relational backing, scope and expiry; the SQL join above
      // is deliberately insufficient on its own.
      let candidateTierDecisionBound = false;
      if (candidateStructurallyBound && typeof candidate!.authority_snapshot_ref === "string"
        && REF.test(candidate!.authority_snapshot_ref) && typeof candidate!.authority_snapshot_hash === "string"
        && HASH.test(candidate!.authority_snapshot_hash)) {
        try {
          await authority.loadInTransaction(database, {
            workspaceId: request.workspaceId, accountRef: authenticated[0]!.accountRef,
            evaluatedAt: new Date().toISOString(), snapshotRef: candidate!.authority_snapshot_ref,
            snapshotHash: candidate!.authority_snapshot_hash,
          });
          candidateTierDecisionBound = true;
        } catch { /* fail closed: stale or unbacked candidate authority is not preview-ready. */ }
      }
      const evaluatedRevisionRefs = [...new Set(authenticated.map((entry) => `analysis_revision_${entry.bindingHash.slice(0, 24)}`))].sort();
      const historicalContextHashes = [...new Set(authenticated.map((entry) => entry.contextHash))].sort();
      const outcomeEvidenceRefs = [...new Set(authenticated.flatMap((entry) => entry.outcomeEvidence.map((evidence) => evidence.evidenceRef)))].sort();
      return Object.freeze({ sourceBound: false, candidateTierDecisionBound, exactImpact,
        historicalRunsEvaluated: authenticated.length, evaluatedRevisionRefs: Object.freeze(evaluatedRevisionRefs),
        historicalContextHashes: Object.freeze(historicalContextHashes),
        outcomeEvidenceRefs: Object.freeze(outcomeEvidenceRefs) });
    },
  });
}
