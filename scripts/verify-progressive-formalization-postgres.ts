import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import { ProgressiveFormalizationService } from "@/application/progressive-formalization-service";
import { DrizzleProgressiveFormalizationRepository } from "@/connectors/guidance/progressive-formalization-drizzle-repository";
import { advanceProgressiveFormalization, createNormalizedPolicyDraft,
  NORMALIZED_POLICY_DRAFT_VERSION, PROGRESSIVE_FORMALIZATION_VERSION } from
  "@/domain/guidance/progressive-formalization";
import type { ProgressiveFormalizationRevision } from "@/domain/guidance/progressive-formalization";
import { parseStrictInstructionPolicy } from "@/domain/policies/instruction-policy-dsl";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"],
    continuation: "npm run verify:progressive-formalization-live" }));
  process.exit(2);
}
const h = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const workspaceId = randomUUID(); const workspaceRef = "workspace_progressive_verify";
const actorRef = "actor_progressive_verify"; const formalizationRef = "formalization_progressive_verify";
const at = (hour: number) => `2026-08-10T${String(hour).padStart(2, "0")}:00:00.000Z`;
const strictPolicy = parseStrictInstructionPolicy({ dslVersion: "strict-instruction-policy/1.0.0", workspaceRef,
  policyRef: "policy_progressive_verify", policyVersion: 1, previousVersionHash: null, policyType: "prohibition",
  owner: { actorRef, role: "owner" }, status: "draft", reasonCode: "owner_verified", priority: 800,
  effectiveDates: { from: at(0), until: null }, scope: { global: true, accountGroupRefs: [], accountRefs: [],
    objectiveRefs: [], internalCategoryRefs: [], entities: [], topicRefs: [] }, source: {
    rawProvenanceRef: "provenance_progressive_verify", rawTextHash: h("Do not transfer budget"),
    promotedFromGuidanceRefs: ["guidance_progressive_verify"] },
  clause: { kind: "prohibition", operations: ["budget_transfer"] } });
const draft = createNormalizedPolicyDraft({ schemaVersion: NORMALIZED_POLICY_DRAFT_VERSION, workspaceRef,
  formalizationRef, guidanceSetRef: "guidance_set_progressive_verify", strictPolicy, assumptions: [], questions: [],
  semanticDiff: { status: "resolved", items: [{ meaningRef: "meaning_progressive_verify", sourceStatementHash: h("meaning"),
    normalizedClauseRef: "policy_clause_progressive_verify", disposition: "preserved", reasonCode: "exact_mapping" }],
    diffHash: h("diff") }, historicalReplay: { status: "no_history", evaluatedRevisionRefs: [], changedOutcomeRefs: [],
    unknownOutcomeRefs: [], replayHash: h("replay") }, conflictPreview: { status: "clear", conflictRefs: [],
    previewHash: h("conflict") }, impactPreview: { status: "complete", affectedScopeRefs: ["scope_global"],
    affectedEntityCount: 0, affectedPolicyCount: 0, affectedBudgetCount: 0, affectedAutomationCount: 0,
    unresolvedDependencyRefs: [], previewHash: h("impact") } });
const transition = (previous: Parameters<typeof advanceProgressiveFormalization>[0], input: Parameters<typeof advanceProgressiveFormalization>[1]) =>
  advanceProgressiveFormalization(previous, input);
const g0 = transition(null, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, transition: "capture_g0", workspaceRef,
  formalizationRef, occurredAt: at(1), actor: { actorRef, role: "owner" }, payload: {
    rawProvenanceRef: "source_progressive_verify", rawTextHash: h("raw") } });
const g1 = transition(g0, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, transition: "scope_g1", workspaceRef,
  formalizationRef, occurredAt: at(2), actor: { actorRef, role: "owner" }, payload: {
    guidanceCardRefs: ["guidance_progressive_verify"], scope: { global: true, accountGroupRefs: [], accountRefs: [],
      objectiveRefs: [], internalCategoryRefs: [], entityRefs: [], promotionTemplateRefs: [], topicRefs: [] } } });
const g2 = transition(g1, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, transition: "review_g2", workspaceRef,
  formalizationRef, occurredAt: at(3), actor: { actorRef, role: "owner" }, payload: {
    guidanceSetRef: "guidance_set_progressive_verify", reviewedGuidanceHash: h("reviewed"), confirmation: {
      confirmed: true, confirmationRef: "confirmation_progressive_g2", confirmedAt: at(3) } } });
const g3 = transition(g2, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, transition: "promote_g3", workspaceRef,
  formalizationRef, occurredAt: at(4), actor: { actorRef, role: "owner" }, payload: { normalizedDraft: draft,
    confirmation: { confirmed: true, confirmationRef: "confirmation_progressive_g3", confirmedAt: at(4) } } });
const g4 = transition(g3, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, transition: "qualify_g4", workspaceRef,
  formalizationRef, occurredAt: at(5), actor: { actorRef, role: "owner" }, payload: {
    publishedPolicyRef: "policy_progressive_verify", publishedPolicyHash: h("published"),
    riskAssessmentRef: "risk_assessment_progressive_verify", capPolicyRef: "cap_policy_progressive_verify",
    approvalPolicyRef: "approval_policy_progressive_verify", rolloutEvidenceRefs: ["rollout_evidence_progressive_verify"],
    actionValveRef: "action_valve_progressive_verify", approvalMode: "approval_only", confirmation: {
      confirmed: true, confirmationRef: "confirmation_progressive_g4", confirmedAt: at(5) } } });

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
const client = await pool.connect();
const database = drizzle({ client });
const rollback = Symbol("progressive_formalization_verifier_rollback");
try {
  await database.transaction(async (transaction) => {
  await client.query("insert into workspaces (id, name) values ($1, $2)", [workspaceId, "Progressive verifier"]);
  const serviceActorId = randomUUID(); const serviceSourceKey = "source_progressive_stream";
  const serviceSourceRef = "source_progressive_persisted"; const serviceText = "Persisted owner source";
  await client.query("insert into users (id, email) values ($1, $2)", [serviceActorId, `${serviceActorId}@progressive.test`]);
  await client.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, serviceActorId]);
  await client.query(`insert into guidance_sources (
    workspace_id, source_key, version, source_type, title, source_ref, content, status, record_hash
  ) values ($1,$2,1,'owner_statement','Progressive verifier source',$3,$4,'draft',$5)`,
  [workspaceId, serviceSourceKey, serviceSourceRef, serviceText, h("service-source-record")]);
  const insertRevision = async (revision: ProgressiveFormalizationRevision, payload: unknown = revision) => client.query(`insert into progressive_formalization_revisions (
    workspace_id, workspace_ref, formalization_ref, sequence, previous_revision_hash, from_level, to_level, transition,
    actor_ref, actor_role, revision_hash, revision_payload, occurred_at) values
    ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::timestamptz)`, [workspaceId, revision.workspaceRef,
    revision.formalizationRef, revision.sequence, revision.previousRevisionHash, revision.fromLevel, revision.toLevel,
    revision.transition, revision.actor.actorRef, revision.actor.role, revision.revisionHash, JSON.stringify(payload), revision.occurredAt]);
  const expectRejected = async (name: string, revision: ProgressiveFormalizationRevision, payload: unknown) => {
    await client.query(`savepoint ${name}`); let rejected = false;
    try { await insertRevision(revision, payload); }
    catch { rejected = true; await client.query(`rollback to savepoint ${name}`); }
    if (!rejected) { await client.query(`rollback to savepoint ${name}`); throw new Error(`${name}_accepted`); }
  };
  await expectRejected("extra_top_level", g0, { ...g0, extra: "malicious" });
  await expectRejected("extra_nested", g0, { ...g0, payload: { ...g0.payload, extra: "malicious" } });
  await expectRejected("authority_open", g0, { ...g0, authority: { ...g0.authority, canExecute: true } });
  await expectRejected("secret_material", g0, { ...g0, payload: { ...g0.payload, secret: "redacted" } });
  await insertRevision(g0);
  await expectRejected("broken_chain", { ...g1, previousRevisionHash: h("forged") },
    { ...g1, previousRevisionHash: h("forged") });
  for (const revision of [g1, g2, g3, g4]) await insertRevision(revision);
  const g3FormalizationRef = "formalization_progressive_g3_verify";
  const g3g0 = transition(null, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, transition: "capture_g0", workspaceRef,
    formalizationRef: g3FormalizationRef, occurredAt: at(6), actor: { actorRef, role: "owner" }, payload: {
      rawProvenanceRef: "source_progressive_verify", rawTextHash: h("raw") } });
  const g3g1 = transition(g3g0, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, transition: "scope_g1", workspaceRef,
    formalizationRef: g3FormalizationRef, occurredAt: at(7), actor: { actorRef, role: "owner" }, payload: {
      guidanceCardRefs: ["guidance_progressive_verify"], scope: { global: true, accountGroupRefs: [], accountRefs: [],
        objectiveRefs: [], internalCategoryRefs: [], entityRefs: [], promotionTemplateRefs: [], topicRefs: [] } } });
  const g3g2 = transition(g3g1, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, transition: "review_g2", workspaceRef,
    formalizationRef: g3FormalizationRef, occurredAt: at(8), actor: { actorRef, role: "owner" }, payload: {
      guidanceSetRef: "guidance_set_progressive_verify", reviewedGuidanceHash: h("reviewed"), confirmation: {
        confirmed: true, confirmationRef: "confirmation_progressive_g3_preview", confirmedAt: at(8) } } });
  const g3Draft = createNormalizedPolicyDraft({ schemaVersion: NORMALIZED_POLICY_DRAFT_VERSION, workspaceRef,
    formalizationRef: g3FormalizationRef, guidanceSetRef: "guidance_set_progressive_verify", strictPolicy,
    assumptions: [], questions: [], semanticDiff: { status: "resolved", items: [{
      meaningRef: "meaning_progressive_g3_preview", sourceStatementHash: h("meaning-g3-preview"),
      normalizedClauseRef: "policy_clause_progressive_g3_preview", disposition: "preserved", reasonCode: "exact_mapping" }],
    diffHash: h("diff-g3-preview") }, historicalReplay: { status: "no_history", evaluatedRevisionRefs: [],
    changedOutcomeRefs: [], unknownOutcomeRefs: [], replayHash: h("replay-g3-preview") },
    conflictPreview: { status: "clear", conflictRefs: [], previewHash: h("conflict-g3-preview") },
    impactPreview: { status: "complete", affectedScopeRefs: ["scope_global"], affectedEntityCount: 0,
      affectedPolicyCount: 0, affectedBudgetCount: 0, affectedAutomationCount: 0,
      unresolvedDependencyRefs: [], previewHash: h("impact-g3-preview") } });
  const g3g3 = transition(g3g2, { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, transition: "promote_g3", workspaceRef,
    formalizationRef: g3FormalizationRef, occurredAt: at(9), actor: { actorRef, role: "owner" }, payload: {
      normalizedDraft: g3Draft, confirmation: { confirmed: true,
        confirmationRef: "confirmation_progressive_g4_preview", confirmedAt: at(9) } } });
  for (const revision of [g3g0, g3g1, g3g2]) await insertRevision(revision);
  const repository = new DrizzleProgressiveFormalizationRepository(transaction as never);
  const service = new ProgressiveFormalizationService(repository, [{ workspaceId, userId: serviceActorId, role: "owner" }]);
  const servicePrincipal = { actor: { userId: serviceActorId }, workspaceId, workspaceRef,
    readerRef: actorRef } as const;
  const beforeService = await service.inspect(servicePrincipal);
  const captured = await service.mutate(servicePrincipal, { operation: "capture_g0",
    expectedRegistryHash: beforeService.registryHash, rawProvenanceRef: serviceSourceKey });
  const capturedFlow = captured.state.flows.find((flow) => flow.formalizationRef !== formalizationRef);
  const capturedPayload = capturedFlow?.revisions[0]?.payload as { rawProvenanceRef?: string; rawTextHash?: string } | undefined;
  if (!capturedFlow || capturedPayload?.rawProvenanceRef !== serviceSourceRef
    || capturedPayload.rawTextHash !== h(serviceText) || !captured.auditAppended) {
    throw new Error("repository_service_capture_or_audit_failed");
  }
  const auditCount = Number((await client.query<{ count: string }>(`select count(*) from audit_events
    where workspace_id = $1 and resource_id = $2 and action = 'progressive_formalization.capture_g0'`,
  [workspaceId, capturedFlow.formalizationRef])).rows[0]!.count);
  if (auditCount !== 1) throw new Error("repository_service_audit_not_atomic");
  await service.mutate(servicePrincipal, { operation: "capture_g0", expectedRegistryHash: beforeService.registryHash,
    rawProvenanceRef: serviceSourceKey }).then(() => { throw new Error("repository_occ_not_enforced"); }, () => undefined);
  const g3Preview = await repository.preview({ workspaceId, workspaceRef, formalizationRef: g3FormalizationRef, target: "G3",
    policyRef: "policy_progressive_verify" });
  await insertRevision(g3g3);
  const g4Preview = await repository.preview({ workspaceId, workspaceRef, formalizationRef: g3FormalizationRef,
    target: "G4", policyRef: null });
  if (g3Preview.disposition !== "blocked" || g4Preview.disposition !== "blocked"
    || g4Preview.evidence.persistedPolicy !== false || !g4Preview.blockers.includes("published_policy_missing")) {
    throw new Error("default_g3_g4_blocking_failed");
  }
  const count = Number((await client.query<{ count: string }>("select count(*) from progressive_formalization_revisions where workspace_id = $1", [workspaceId])).rows[0]!.count);
  if (count !== 10) throw new Error("progressive_revision_count_mismatch");
  await client.query("savepoint immutable_check");
  let immutable = false;
  try { await client.query("update progressive_formalization_revisions set actor_role = actor_role where workspace_id = $1", [workspaceId]); }
  catch { immutable = true; await client.query("rollback to savepoint immutable_check"); }
  if (!immutable) throw new Error("progressive_revision_update_not_blocked");
  await client.query("savepoint active_delete_check"); let activeDeleteBlocked = false;
  try { await client.query("delete from progressive_formalization_revisions where workspace_id = $1", [workspaceId]); }
  catch { activeDeleteBlocked = true; await client.query("rollback to savepoint active_delete_check"); }
  if (!activeDeleteBlocked) throw new Error("progressive_revision_active_delete_not_blocked");
  await client.query("update workspaces set lifecycle_state = 'tombstoning' where id = $1", [workspaceId]);
  const deleted = (await client.query("delete from progressive_formalization_revisions where workspace_id = $1", [workspaceId])).rowCount;
  if (deleted !== 10) throw new Error("progressive_revision_tombstone_delete_failed");
  console.log(JSON.stringify({ ok: true, chainLength: 5, headHash: g4.revisionHash, immutable,
    activeDeleteBlocked, tombstoneDeleteCount: deleted,
    rejectedCorruptRows: ["extra_top_level", "extra_nested", "authority_open", "secret_material", "broken_chain"],
    repositoryService: { sourceKeyOpaque: true, membershipChecked: true, occChecked: true, auditAtomic: true,
      defaultG3G4Blocked: true },
    authority: { canApprove: false, canExecute: false, canWriteMeta: false, canSchedule: false, canCallTool: false },
    transaction: "outer_rollback" }));
  throw rollback;
  });
} catch (reason) {
  if (reason !== rollback) throw reason;
} finally { client.release(); await pool.end(); }
