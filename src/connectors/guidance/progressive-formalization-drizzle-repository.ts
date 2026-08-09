import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type {
  FormalizationBlocker,
  ProgressiveFormalizationFlow,
  ProgressiveFormalizationPreview,
  ProgressiveFormalizationRepository,
  ProgressiveFormalizationState,
} from "@/application/progressive-formalization-service";
import { PROGRESSIVE_FORMALIZATION_STUDIO_VERSION,
  ProgressiveFormalizationStudioError } from "@/application/progressive-formalization-service";
import * as schema from "@/db/schema";
import {
  advanceProgressiveFormalization,
  createNormalizedPolicyDraft,
  NORMALIZED_POLICY_DRAFT_VERSION,
  PROGRESSIVE_FORMALIZATION_VERSION,
  replayProgressiveFormalization,
  type FormalizationScope,
  type ProgressiveFormalizationRevision,
  type ProgressiveFormalizationTransitionInput,
} from "@/domain/guidance/progressive-formalization";
import { assertStrictInstructionPolicyArtifact } from "@/domain/policies/instruction-policy-dsl";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rows<T extends Row = Row>(result: unknown): readonly T[] {
  return result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)
    ? result.rows as readonly T[] : [];
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

async function load(database: Executor, workspaceId: string): Promise<ProgressiveFormalizationState> {
  const persisted = rows(await database.execute(sql`select formalization_ref, sequence, revision_payload
    from progressive_formalization_revisions where workspace_id = ${workspaceId}::uuid
    order by formalization_ref, sequence`));
  if (persisted.length > 5_000) throw new ProgressiveFormalizationStudioError("conflict");
  const grouped = new Map<string, ProgressiveFormalizationRevision[]>();
  for (const row of persisted) {
    if (typeof row.formalization_ref !== "string" || !Number.isSafeInteger(Number(row.sequence))) {
      throw new ProgressiveFormalizationStudioError("conflict");
    }
    const collection = grouped.get(row.formalization_ref) ?? [];
    collection.push(row.revision_payload as ProgressiveFormalizationRevision);
    grouped.set(row.formalization_ref, collection);
  }
  const flows: ProgressiveFormalizationFlow[] = [];
  for (const [formalizationRef, revisions] of grouped) {
    let replayed;
    try { replayed = replayProgressiveFormalization(revisions); }
    catch { throw new ProgressiveFormalizationStudioError("conflict"); }
    flows.push(Object.freeze({ formalizationRef, level: replayed.level, headHash: replayed.headHash,
      revisions: replayed.revisions }));
  }
  flows.sort((left, right) => left.formalizationRef.localeCompare(right.formalizationRef));
  return Object.freeze({ registryHash: digest(flows.map((flow) => ({ formalizationRef: flow.formalizationRef,
    level: flow.level, headHash: flow.headHash }))), flows: Object.freeze(flows) });
}

function findFlow(state: ProgressiveFormalizationState, formalizationRef: string): ProgressiveFormalizationFlow {
  const found = state.flows.find((flow) => flow.formalizationRef === formalizationRef);
  if (!found) throw new ProgressiveFormalizationStudioError("not_found");
  return found;
}

function basePreview(input: Readonly<{ target: "G3" | "G4"; formalizationRef: string; headHash: string;
  blockers: readonly FormalizationBlocker[]; normalizedDraft: ProgressiveFormalizationPreview["normalizedDraft"];
  g4Payload: ProgressiveFormalizationPreview["g4Payload"]; historicalRunsEvaluated: number;
  productionAuthoritySourceBound: boolean }>): ProgressiveFormalizationPreview {
  const core = Object.freeze({ target: input.target, formalizationRef: input.formalizationRef,
    headHash: input.headHash, blockers: Object.freeze([...input.blockers].sort()),
    normalizedDraftHash: input.normalizedDraft?.draftHash ?? null, g4Payload: input.g4Payload,
    evidence: { persistedGuidance: true as const, persistedPolicy: true as const,
      productionAuthoritySourceBound: input.productionAuthoritySourceBound,
      historicalRunsEvaluated: input.historicalRunsEvaluated } });
  return Object.freeze({ contractVersion: PROGRESSIVE_FORMALIZATION_STUDIO_VERSION, target: input.target,
    formalizationRef: input.formalizationRef, headHash: input.headHash, previewHash: digest(core),
    disposition: input.blockers.length === 0 ? "ready" : "blocked", blockers: core.blockers,
    normalizedDraft: input.normalizedDraft, g4Payload: input.g4Payload, evidence: Object.freeze(core.evidence),
    authority: Object.freeze({ canApprove: false as const, canExecute: false as const, canWriteMeta: false as const,
      canSchedule: false as const, canCallTool: false as const }) });
}

async function persistedPreview(database: Executor, input: Readonly<{ workspaceId: string; workspaceRef: string;
  formalizationRef: string; target: "G3" | "G4"; policyRef: string | null }>): Promise<ProgressiveFormalizationPreview> {
  const state = await load(database, input.workspaceId); const flow = findFlow(state, input.formalizationRef);
  if (input.target === "G3") {
    if (flow.level !== "G2" || input.policyRef === null) throw new ProgressiveFormalizationStudioError("invalid_transition");
    const g2 = flow.revisions[2]!;
    const guidanceSetRef = (g2.payload as { guidanceSetRef: string }).guidanceSetRef;
    const policyRows = rows(await database.execute(sql`select policy_payload from strict_instruction_policy_revisions
      where workspace_id = ${input.workspaceId}::uuid and policy_ref = ${input.policyRef}
      order by policy_version desc limit 2`));
    if (policyRows.length === 0) throw new ProgressiveFormalizationStudioError("not_found");
    let strictPolicy;
    try { strictPolicy = assertStrictInstructionPolicyArtifact(policyRows[0]!.policy_payload); }
    catch { throw new ProgressiveFormalizationStudioError("conflict"); }
    if (strictPolicy.status !== "draft" || strictPolicy.workspaceRef !== input.workspaceRef) {
      throw new ProgressiveFormalizationStudioError("invalid_transition");
    }
    const setRows = rows(await database.execute(sql`select version, ordered_card_ids, record_hash
      from guidance_sets where workspace_id = ${input.workspaceId}::uuid and set_key = ${guidanceSetRef}
      order by version desc limit 2`));
    if (setRows.length === 0 || !Array.isArray(setRows[0]!.ordered_card_ids)) {
      throw new ProgressiveFormalizationStudioError("conflict");
    }
    const orderedCardRefs = setRows[0]!.ordered_card_ids as readonly string[];
    const cardRows = rows(await database.execute(sql`select distinct on (card_key) card_key, version, record_hash
      from guidance_cards where workspace_id = ${input.workspaceId}::uuid and card_key = any(${orderedCardRefs}::text[])
      order by card_key, version desc`));
    const byRef = new Map(cardRows.map((row) => [String(row.card_key), row] as const));
    const promoted = new Set(strictPolicy.source.promotedFromGuidanceRefs);
    const exactMatch = orderedCardRefs.length > 0 && orderedCardRefs.length === promoted.size
      && orderedCardRefs.every((cardRef) => promoted.has(cardRef) && byRef.has(cardRef));
    const semanticItems = orderedCardRefs.map((cardRef) => ({ meaningRef: `meaning_${digest(cardRef).slice(0, 24)}`,
      sourceStatementHash: String(byRef.get(cardRef)?.record_hash ?? digest({ missing: cardRef })),
      normalizedClauseRef: promoted.has(cardRef) ? `policy_clause_${digest(strictPolicy.clause).slice(0, 24)}` : null,
      disposition: promoted.has(cardRef) ? "preserved" as const : "excluded" as const,
      reasonCode: promoted.has(cardRef) ? "exact_promoted_guidance_ref" : "not_promoted_into_policy" }));
    const bindingRows = rows(await database.execute(sql`select binding_hash, selected_set_refs
      from guidance_analysis_run_bindings where workspace_id = ${input.workspaceId}::uuid limit 1001`));
    if (bindingRows.length > 1_000) throw new ProgressiveFormalizationStudioError("conflict");
    const matchingRuns = bindingRows.filter((row) => Array.isArray(row.selected_set_refs)
      && (row.selected_set_refs as readonly Row[]).some((set) => set.setRef === guidanceSetRef
        && Number(set.version) === Number(setRows[0]!.version) && set.recordHash === setRows[0]!.record_hash));
    const evaluatedRevisionRefs = matchingRuns.map((row) => `analysis_revision_${String(row.binding_hash).slice(0, 24)}`).sort();
    const unknownOutcomeRefs = matchingRuns.map((row) => `outcome_unknown_${String(row.binding_hash).slice(0, 24)}`).sort();
    const replayStatus = matchingRuns.length === 0 ? "no_history" as const : "incomplete" as const;
    const policyCount = Number(rows(await database.execute(sql`select count(*)::int as count
      from strict_instruction_policy_revisions where workspace_id = ${input.workspaceId}::uuid
        and status = 'published'`))[0]?.count ?? 0);
    const affectedScopeRefs = strictPolicy.scope.global ? ["scope_global"] : [
      ...strictPolicy.scope.accountGroupRefs, ...strictPolicy.scope.accountRefs, ...strictPolicy.scope.objectiveRefs,
      ...strictPolicy.scope.internalCategoryRefs, ...strictPolicy.scope.entities.map((entity) => entity.ref),
      ...strictPolicy.scope.topicRefs,
    ].sort();
    const unresolved = ["dependency_production_policy_authority_catalog"];
    const normalizedDraft = createNormalizedPolicyDraft({ schemaVersion: NORMALIZED_POLICY_DRAFT_VERSION,
      workspaceRef: input.workspaceRef, formalizationRef: input.formalizationRef, guidanceSetRef, strictPolicy,
      assumptions: [], questions: [], semanticDiff: { status: exactMatch ? "resolved" : "ambiguous",
        items: semanticItems, diffHash: digest(semanticItems) },
      historicalReplay: { status: replayStatus, evaluatedRevisionRefs, changedOutcomeRefs: [], unknownOutcomeRefs,
        replayHash: digest({ guidanceSetRef, evaluatedRevisionRefs, unknownOutcomeRefs }) },
      conflictPreview: { status: "unknown", conflictRefs: [],
        previewHash: digest({ policyRef: strictPolicy.policyRef, productionAuthoritySourceBound: false }) },
      impactPreview: { status: "partial", affectedScopeRefs, affectedEntityCount: 0,
        affectedPolicyCount: policyCount, affectedBudgetCount: 0, affectedAutomationCount: 0,
        unresolvedDependencyRefs: unresolved, previewHash: digest({ affectedScopeRefs, policyCount, unresolved }) } });
    const blockers: FormalizationBlocker[] = ["production_policy_authority_catalog_unavailable",
      "conflict_preview_unknown", "impact_preview_incomplete"];
    if (!exactMatch) blockers.push("semantic_diff_unresolved");
    if (matchingRuns.length > 0) blockers.push("historical_replay_incomplete");
    return basePreview({ target: "G3", formalizationRef: input.formalizationRef, headHash: flow.headHash,
      blockers, normalizedDraft, g4Payload: null, historicalRunsEvaluated: matchingRuns.length,
      productionAuthoritySourceBound: false });
  }
  if (flow.level !== "G3") throw new ProgressiveFormalizationStudioError("invalid_transition");
  const draft = (flow.revisions[3]!.payload as { normalizedDraft: { strictPolicy: { policyRef: string } } }).normalizedDraft;
  const published = rows(await database.execute(sql`select policy_payload from strict_instruction_policy_revisions
    where workspace_id = ${input.workspaceId}::uuid and policy_ref = ${draft.strictPolicy.policyRef}
      and status = 'published' order by policy_version desc limit 2`));
  const blockers: FormalizationBlocker[] = ["production_policy_authority_catalog_unavailable",
    "g4_risk_evidence_unavailable", "g4_cap_policy_unavailable", "g4_approval_policy_unavailable",
    "g4_rollout_evidence_unavailable", "g4_action_valve_unavailable"];
  if (published.length === 0) blockers.unshift("strict_policy_draft_not_found");
  return basePreview({ target: "G4", formalizationRef: input.formalizationRef, headHash: flow.headHash,
    blockers, normalizedDraft: null, g4Payload: null, historicalRunsEvaluated: 0,
    productionAuthoritySourceBound: false });
}

export type ProgressiveFormalizationPreviewResolver = (database: Executor, input: Readonly<{
  workspaceId: string; workspaceRef: string; formalizationRef: string; target: "G3" | "G4";
  policyRef: string | null }>) => Promise<ProgressiveFormalizationPreview>;

function appendInput(input: Parameters<ProgressiveFormalizationRepository["mutate"]>[0], state: ProgressiveFormalizationState,
  payload: ProgressiveFormalizationTransitionInput["payload"], formalizationRef: string): ProgressiveFormalizationTransitionInput {
  return { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, transition: input.command.operation,
    workspaceRef: input.workspaceRef, formalizationRef, occurredAt: input.occurredAt,
    actor: { actorRef: input.actorRef, role: input.role }, payload } as ProgressiveFormalizationTransitionInput;
}

export class DrizzleProgressiveFormalizationRepository implements ProgressiveFormalizationRepository {
  constructor(private readonly database: Database,
    private readonly resolvePreview: ProgressiveFormalizationPreviewResolver = persistedPreview) {}

  async inspect(workspaceId: string) {
    if (!UUID.test(workspaceId)) throw new ProgressiveFormalizationStudioError("invalid_input");
    return load(this.database, workspaceId);
  }

  async preview(input: Readonly<{ workspaceId: string; workspaceRef: string; formalizationRef: string;
    target: "G3" | "G4"; policyRef: string | null }>) {
    if (!UUID.test(input.workspaceId)) throw new ProgressiveFormalizationStudioError("invalid_input");
    return this.resolvePreview(this.database, input);
  }

  async mutate(input: Parameters<ProgressiveFormalizationRepository["mutate"]>[0]) {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId)) {
      throw new ProgressiveFormalizationStudioError("invalid_input");
    }
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const workspace = rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid
        and lifecycle_state = 'active' for update`));
      if (workspace.length !== 1) throw new ProgressiveFormalizationStudioError("not_found");
      const memberships = rows(await tx.execute(sql`select role::text from memberships
        where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid limit 2`));
      if (memberships.length !== 1 || memberships[0]!.role !== input.role) {
        throw new ProgressiveFormalizationStudioError("forbidden");
      }
      const before = await load(tx, input.workspaceId);
      if (before.registryHash !== input.command.expectedRegistryHash) {
        throw new ProgressiveFormalizationStudioError("conflict");
      }
      let formalizationRef: string; let previous: ProgressiveFormalizationRevision | null; let payload;
      const command = input.command;
      if (command.operation === "capture_g0") {
        formalizationRef = `formalization_${randomBytes(12).toString("hex")}`; previous = null;
        const provenance = rows(await tx.execute(sql`select source_ref, version, status, content, record_hash from guidance_sources
          where workspace_id = ${input.workspaceId}::uuid and source_ref = ${command.rawProvenanceRef}
          order by version desc limit 2`));
        if (provenance.length === 0 || provenance.length > 2 || provenance[0]!.source_ref !== command.rawProvenanceRef
          || provenance[0]!.status === "archived" || typeof provenance[0]!.content !== "string"
          || !/^[a-f0-9]{64}$/.test(String(provenance[0]!.record_hash))) {
          throw new ProgressiveFormalizationStudioError("not_found");
        }
        payload = { rawProvenanceRef: command.rawProvenanceRef,
          rawTextHash: createHash("sha256").update(provenance[0]!.content).digest("hex") };
      } else {
        formalizationRef = command.formalizationRef; const flow = findFlow(before, formalizationRef);
        if (flow.headHash !== command.expectedHeadHash) throw new ProgressiveFormalizationStudioError("conflict");
        previous = flow.revisions.at(-1)!;
        if (command.operation === "scope_g1") {
          const cards = rows(await tx.execute(sql`select distinct on (card_key) card_key, version, status, record_hash
            from guidance_cards where workspace_id = ${input.workspaceId}::uuid
              and card_key = any(${command.guidanceCardRefs}::text[]) order by card_key, version desc`));
          if (cards.length !== command.guidanceCardRefs.length || cards.some((card) => card.status !== "published"
            || !/^[a-f0-9]{64}$/.test(String(card.record_hash)))) {
            throw new ProgressiveFormalizationStudioError("invalid_transition");
          }
          const bindings = rows(await tx.execute(sql`select distinct on (binding_key) binding_key, card_key, facet, value
            from guidance_bindings where workspace_id = ${input.workspaceId}::uuid
              and card_key = any(${command.guidanceCardRefs}::text[]) order by binding_key, version desc`));
          const allowed = new Set(["global", "account_group", "account", "objective", "internal_category",
            "entity", "promotion_template", "topic"]);
          if (bindings.length === 0 || bindings.some((binding) => !allowed.has(String(binding.facet)))
            || command.guidanceCardRefs.some((cardRef) => !bindings.some((binding) => binding.card_key === cardRef))) {
            throw new ProgressiveFormalizationStudioError("invalid_transition");
          }
          const refs = (facet: string) => [...new Set(bindings.filter((binding) => binding.facet === facet
            && typeof binding.value === "string").map((binding) => binding.value as string))].sort();
          const scope: FormalizationScope = { global: bindings.some((binding) => binding.facet === "global"),
            accountGroupRefs: refs("account_group"), accountRefs: refs("account"), objectiveRefs: refs("objective"),
            internalCategoryRefs: refs("internal_category"), entityRefs: refs("entity"),
            promotionTemplateRefs: refs("promotion_template"), topicRefs: refs("topic") };
          if (scope.global && bindings.some((binding) => binding.facet !== "global")) {
            throw new ProgressiveFormalizationStudioError("invalid_transition");
          }
          payload = { guidanceCardRefs: command.guidanceCardRefs, scope };
        } else if (command.operation === "review_g2") {
          const sets = rows(await tx.execute(sql`select set_key, version, ordered_card_ids, record_hash, review_status
            from guidance_sets where workspace_id = ${input.workspaceId}::uuid and set_key = ${command.guidanceSetRef}
            order by version desc limit 2`));
          const scoped = (previous.payload as { guidanceCardRefs: readonly string[] }).guidanceCardRefs;
          if (sets.length === 0 || sets.length > 2 || sets[0]!.set_key !== command.guidanceSetRef
            || sets[0]!.review_status !== "reviewed" || !/^[a-f0-9]{64}$/.test(String(sets[0]!.record_hash))
            || !Array.isArray(sets[0]!.ordered_card_ids)
            || JSON.stringify(sets[0]!.ordered_card_ids) !== JSON.stringify(scoped)) {
            throw new ProgressiveFormalizationStudioError("invalid_transition");
          }
          payload = { guidanceSetRef: command.guidanceSetRef, reviewedGuidanceHash: String(sets[0]!.record_hash),
            confirmation: { ...command.ownerConfirmation, confirmedAt: input.occurredAt } };
        } else if (command.operation === "promote_g3") {
          const preview = await this.resolvePreview(tx, { workspaceId: input.workspaceId, workspaceRef: input.workspaceRef,
            formalizationRef, target: "G3", policyRef: command.policyRef });
          if (preview.previewHash !== command.expectedPreviewHash) throw new ProgressiveFormalizationStudioError("conflict");
          if (preview.disposition !== "ready" || preview.blockers.length !== 0 || !preview.normalizedDraft) {
            throw new ProgressiveFormalizationStudioError("preview_blocked");
          }
          payload = { normalizedDraft: preview.normalizedDraft,
            confirmation: { ...command.ownerConfirmation, confirmedAt: input.occurredAt } };
        } else {
          const preview = await this.resolvePreview(tx, { workspaceId: input.workspaceId, workspaceRef: input.workspaceRef,
            formalizationRef, target: "G4", policyRef: null });
          if (preview.previewHash !== command.expectedPreviewHash) throw new ProgressiveFormalizationStudioError("conflict");
          if (preview.disposition !== "ready" || preview.blockers.length !== 0 || !preview.g4Payload) {
            throw new ProgressiveFormalizationStudioError("preview_blocked");
          }
          payload = { ...preview.g4Payload, confirmation: { ...command.ownerConfirmation, confirmedAt: input.occurredAt } };
        }
      }
      let revision;
      try { revision = advanceProgressiveFormalization(previous,
        appendInput(input, before, payload, formalizationRef)); }
      catch { throw new ProgressiveFormalizationStudioError("invalid_transition"); }
      await tx.execute(sql`insert into progressive_formalization_revisions (
        id, workspace_id, workspace_ref, formalization_ref, sequence, previous_revision_hash, from_level, to_level,
        transition, actor_ref, actor_role, revision_hash, revision_payload, occurred_at
      ) values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${revision.workspaceRef}, ${revision.formalizationRef},
        ${revision.sequence}, ${revision.previousRevisionHash}, ${revision.fromLevel}, ${revision.toLevel}, ${revision.transition},
        ${revision.actor.actorRef}, ${revision.actor.role}, ${revision.revisionHash},
        ${JSON.stringify(revision)}::jsonb, ${revision.occurredAt}::timestamptz)`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousAuditHash = String(rows(await tx.execute(sql`select event_hash from audit_events
        where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`
      ))[0]?.event_hash ?? "GENESIS");
      const event = Object.freeze({ id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId,
        action: `progressive_formalization.${command.operation}`, resourceType: "progressive_formalization",
        resourceId: revision.formalizationRef, occurredAt: input.occurredAt, previousHash: previousAuditHash,
        metadata: Object.freeze({ role: input.role, sequence: revision.sequence, toLevel: revision.toLevel,
          revisionHash: revision.revisionHash, expectedRegistryHash: command.expectedRegistryHash,
          expectedHeadHash: "expectedHeadHash" in command ? command.expectedHeadHash : null,
          expectedPreviewHash: "expectedPreviewHash" in command ? command.expectedPreviewHash : null,
          ownerConfirmationRef: "ownerConfirmation" in command ? command.ownerConfirmation.confirmationRef : null,
          authorityGranted: false }) });
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
        metadata, previous_hash, event_hash, occurred_at) values (${event.id}::uuid, ${event.workspaceId}::uuid,
        ${event.actorId}::uuid, ${event.action}, ${event.resourceType}, ${event.resourceId},
        ${JSON.stringify(event.metadata)}::jsonb, ${event.previousHash}, ${digest(event)}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ state: await load(tx, input.workspaceId), auditAppended: true as const });
    });
  }
}
