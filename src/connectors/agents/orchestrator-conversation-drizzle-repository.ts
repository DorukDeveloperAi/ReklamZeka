import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  orchestratorPageGuide,
  type OrchestratorConversationRepository,
  type OrchestratorConversationSnapshot,
  type OrchestratorMessage,
  type OrchestratorPageGuide,
  type OrchestratorTurnEvidence,
} from "@/application/orchestrator-conversation";
import { CORE_SKILL_MANIFESTS, coreSkillManifest, SKILL_CATALOG_VERSION } from "@/domain/orchestrator/skill-catalog";
import { isOfficialGuidanceSourceUrl } from "@/domain/guidance/registry";
import { orchestratorReadOnlyEvidenceContextHash } from "@/application/orchestrator-readonly-evidence-context";
import { parseOrchestratorSkillRunReceipt } from "@/application/orchestrator-skill-run";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type ConversationDatabase = Pick<Database, "execute" | "transaction">;

type ConversationRow = Readonly<{ conversation_ref: string; created_at: Date | string }>;
type TurnRow = Readonly<{ provider_thread_ref: string | null; page_guide: unknown }>;
type EvidenceTurnRow = Readonly<{ turn_ref: string; page_guide: unknown; profile_snapshot: unknown;
  manifest_snapshots: unknown; playbook_snapshots: unknown; skill_catalog_binding_hash: unknown;
  evidence_context_snapshot?: unknown; evidence_context_hash?: unknown;
  skill_run_snapshot?: unknown; skill_run_hash?: unknown }>;
type MessageRow = Readonly<{ message_ref: string; turn_ref: string; message_number: number;
  role: string; content: string; created_at: Date | string }>;

const CONVERSATION = /^conversation_[a-f0-9]{32}$/;
const TURN = /^turn_[a-f0-9]{32}$/;
const MESSAGE = /^message_[a-f0-9]{32}$/;
const PROVIDER_THREAD = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_REF = /^profile_[a-z0-9][a-z0-9_-]{0,86}$/;
const PLAYBOOK_REF = /^playbook_[a-z0-9][a-z0-9_-]{0,86}$/;
const SOURCE_REF = /^source_[a-z0-9_.:-]{1,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const EVIDENCE_SCOPE = "page_guidance_and_verified_workspace_playbooks" as const;
const UNCERTAINTY = "agent_inference_no_meta_or_action_authority" as const;
const SOURCE_TYPES = new Set(["owner_statement", "official_meta_guidance", "business_strategy", "observed_result", "experiment_outcome", "operating_note"]);

export class OrchestratorConversationRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "corrupt_store" | "conversation_unavailable") {
    super("Orchestrator conversation repository rejected");
    this.name = "OrchestratorConversationRepositoryError";
  }
}

function fail(code: OrchestratorConversationRepositoryError["code"]): never {
  throw new OrchestratorConversationRepositoryError(code);
}

function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly T[];
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail("corrupt_store");
  return parsed.toISOString();
}

function pageGuide(value: unknown): OrchestratorPageGuide {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("corrupt_store");
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 6 || typeof candidate.pageId !== "string") fail("corrupt_store");
  const canonical = orchestratorPageGuide(candidate.pageId);
  if (Object.entries(canonical).some(([key, expected]) => candidate[key] !== expected)) fail("corrupt_store");
  return canonical;
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).length === keys.length
    && Object.keys(value as Record<string, unknown>).every((key) => keys.includes(key));
}

function unavailableEvidence(state: Exclude<OrchestratorTurnEvidence["state"], "bound">): OrchestratorTurnEvidence {
  return Object.freeze({ state, pageGuide: null, profileLabel: null, skills: Object.freeze([]), playbooks: Object.freeze([]),
    historicalSourceState: "not_applicable", evidenceScope: EVIDENCE_SCOPE, uncertainty: UNCERTAINTY,
    readOnlyEvidence: Object.freeze({ state: "missing_or_invalid", performance: null, timeline: null }),
    skillRun: Object.freeze({ state: "missing_or_invalid", receipt: null }) });
}

function readOnlyEvidence(snapshot: unknown, hash: unknown): OrchestratorTurnEvidence["readOnlyEvidence"] {
  if (snapshot === undefined && hash === undefined) return Object.freeze({ state: "legacy_not_recorded", performance: null, timeline: null });
  if (typeof hash !== "string") throw new Error("invalid_evidence_context");
  if (exact(snapshot, ["version"]) && snapshot.version === "legacy_not_recorded" && hash === "LEGACY_NOT_RECORDED") {
    return Object.freeze({ state: "legacy_not_recorded", performance: null, timeline: null });
  }
  if (exact(snapshot, ["version"]) && snapshot.version === "unavailable_not_bound" && hash === "UNAVAILABLE_NOT_BOUND") {
    return Object.freeze({ state: "unavailable_not_bound", performance: null, timeline: null });
  }
  if (!exact(snapshot, ["version", "performance", "timeline"]) || snapshot.version !== "orchestrator-readonly-evidence-context/1.0.0"
    || !HASH.test(hash) || orchestratorReadOnlyEvidenceContextHash(snapshot as never) !== hash
    || !exact(snapshot.performance, ["state", "accountCount", "campaignCount", "windows"])
    || !["ready", "partial", "unavailable"].includes(snapshot.performance.state as string)
    || !Number.isSafeInteger(snapshot.performance.accountCount) || !Number.isSafeInteger(snapshot.performance.campaignCount)
    || (snapshot.performance.accountCount as number) < 0 || (snapshot.performance.accountCount as number) > 100
    || (snapshot.performance.campaignCount as number) < 0 || (snapshot.performance.campaignCount as number) > 200_000
    || !Array.isArray(snapshot.performance.windows) || snapshot.performance.windows.length !== 2
    || !exact(snapshot.timeline, ["state", "eventCount", "latestOccurredAt", "kinds"])
    || !["ready", "unavailable"].includes(snapshot.timeline.state as string)
    || !Number.isSafeInteger(snapshot.timeline.eventCount) || (snapshot.timeline.eventCount as number) < 0 || (snapshot.timeline.eventCount as number) > 12
    || !(snapshot.timeline.latestOccurredAt === null || typeof snapshot.timeline.latestOccurredAt === "string" && Number.isFinite(Date.parse(snapshot.timeline.latestOccurredAt)))
    || !Array.isArray(snapshot.timeline.kinds) || snapshot.timeline.kinds.length > 8) throw new Error("invalid_evidence_context");
  const windows = snapshot.performance.windows.map((window) => {
    if (!exact(window, ["days", "readyCount", "partialCount", "unavailableCount", "latestFreshnessAt"])
      || (window.days !== 7 && window.days !== 30) || !Number.isSafeInteger(window.readyCount) || !Number.isSafeInteger(window.partialCount)
      || !Number.isSafeInteger(window.unavailableCount) || (window.readyCount as number) < 0 || (window.partialCount as number) < 0
      || (window.unavailableCount as number) < 0 || !(window.latestFreshnessAt === null || typeof window.latestFreshnessAt === "string"
        && Number.isFinite(Date.parse(window.latestFreshnessAt)))) throw new Error("invalid_evidence_context");
    return window;
  });
  if (new Set(windows.map((window) => window.days)).size !== 2) throw new Error("invalid_evidence_context");
  const kinds = snapshot.timeline.kinds.map((item) => {
    if (!exact(item, ["kind", "count"]) || typeof item.kind !== "string" || !["slice_rule_draft", "budget_proposal", "budget_selection", "action_preparation", "delivery_alert", "approval_proposed", "approval_decision", "temporal_evaluation"].includes(item.kind)
      || !Number.isSafeInteger(item.count) || (item.count as number) < 1 || (item.count as number) > 12) throw new Error("invalid_evidence_context");
    return item;
  });
  if (new Set(kinds.map((item) => item.kind)).size !== kinds.length) throw new Error("invalid_evidence_context");
  if (kinds.reduce((total, item) => total + (item.count as number), 0) !== snapshot.timeline.eventCount) throw new Error("invalid_evidence_context");
  return Object.freeze({ state: "bound", performance: Object.freeze({ state: snapshot.performance.state as "ready" | "partial" | "unavailable",
    accountCount: snapshot.performance.accountCount as number, campaignCount: snapshot.performance.campaignCount as number }),
  timeline: Object.freeze({ state: snapshot.timeline.state as "ready" | "unavailable", eventCount: snapshot.timeline.eventCount as number,
    latestOccurredAt: snapshot.timeline.latestOccurredAt as string | null }) });
}

function skillRunEvidence(snapshot: unknown, hash: unknown, evidenceContextHash: unknown): OrchestratorTurnEvidence["skillRun"] {
  if (snapshot === undefined && hash === undefined) return Object.freeze({ state: "legacy_not_recorded", receipt: null });
  if (exact(snapshot, ["version"]) && snapshot.version === "unavailable_not_bound" && hash === "UNAVAILABLE_NOT_BOUND") {
    return Object.freeze({ state: "unavailable_not_bound", receipt: null });
  }
  const receipt = parseOrchestratorSkillRunReceipt(snapshot, hash);
  if (!receipt || receipt.evidenceContextHash !== evidenceContextHash) return Object.freeze({ state: "missing_or_invalid", receipt: null });
  const selectedSkills = receipt.selectedSkills.map((skill) => {
    const manifest = coreSkillManifest(skill.ref, skill.version, skill.hash);
    return Object.freeze({ name: manifest.name, version: manifest.version, outputContract: manifest.outputContract });
  });
  return Object.freeze({ state: "bound", receipt: Object.freeze({ receiptRef: receipt.receiptRef, receiptHash: receipt.receiptHash,
    intent: receipt.intent, selectedSkills: Object.freeze(selectedSkills), evidenceAvailability: receipt.evidence.availability,
    outputContract: receipt.handler.outputContract, authority: receipt.authority }) });
}

type HistoricalSourceCitation = Readonly<{ title: string; type: string; url: string | null;
  freshness: "fresh" | "stale" | "not_scheduled" }>;
function historicalSourceCitation(value: unknown): HistoricalSourceCitation {
  if (!exact(value, ["sourceTitle", "sourceType", "sourceUrl", "freshness"])
    || typeof value.sourceTitle !== "string" || !value.sourceTitle.trim() || value.sourceTitle.length > 160
    || /[\u0000-\u001f\u007f]/.test(value.sourceTitle) || typeof value.sourceType !== "string"
    || !SOURCE_TYPES.has(value.sourceType) || !["fresh", "stale", "not_scheduled"].includes(value.freshness as string)
    || !(value.sourceUrl === null || typeof value.sourceUrl === "string"
      && value.sourceType === "official_meta_guidance" && isOfficialGuidanceSourceUrl(value.sourceUrl))) throw new Error("invalid_citation");
  return Object.freeze({ title: value.sourceTitle.trim(), type: value.sourceType, url: value.sourceUrl,
    freshness: value.freshness as HistoricalSourceCitation["freshness"] });
}

/** Never joins mutable sources: this read projection reports only ledger-frozen evidence. */
export function orchestratorTurnEvidenceFromLedger(row: EvidenceTurnRow): OrchestratorTurnEvidence {
  if (!TURN.test(row.turn_ref)) return unavailableEvidence("missing_or_invalid");
  const legacy = exact(row.profile_snapshot, ["version"]) && row.profile_snapshot.version === "legacy_not_recorded"
    && Array.isArray(row.manifest_snapshots) && row.manifest_snapshots.length === 0
    && Array.isArray(row.playbook_snapshots) && row.playbook_snapshots.length === 0
    && row.skill_catalog_binding_hash === "LEGACY_NOT_BOUND";
  if (legacy) return Object.freeze({ ...unavailableEvidence("legacy_not_recorded"), readOnlyEvidence: readOnlyEvidence(row.evidence_context_snapshot, row.evidence_context_hash),
    skillRun: skillRunEvidence(row.skill_run_snapshot, row.skill_run_hash, row.evidence_context_hash) });
  const unavailable = exact(row.profile_snapshot, ["version"]) && row.profile_snapshot.version === "unavailable_not_bound"
    && Array.isArray(row.manifest_snapshots) && row.manifest_snapshots.length === 0
    && Array.isArray(row.playbook_snapshots) && row.playbook_snapshots.length === 0
    && row.skill_catalog_binding_hash === "UNAVAILABLE_NOT_BOUND";
  if (unavailable) return Object.freeze({ ...unavailableEvidence("unavailable_not_bound"), readOnlyEvidence: readOnlyEvidence(row.evidence_context_snapshot, row.evidence_context_hash),
    skillRun: skillRunEvidence(row.skill_run_snapshot, row.skill_run_hash, row.evidence_context_hash) });
  try {
    const guide = pageGuide(row.page_guide);
    if (!exact(row.profile_snapshot, ["version", "profileRef", "revision", "profileHash"])
      || row.profile_snapshot.version !== SKILL_CATALOG_VERSION || typeof row.profile_snapshot.profileRef !== "string"
      || !PROFILE_REF.test(row.profile_snapshot.profileRef) || !Number.isSafeInteger(row.profile_snapshot.revision)
      || (row.profile_snapshot.revision as number) < 1 || typeof row.profile_snapshot.profileHash !== "string"
      || !HASH.test(row.profile_snapshot.profileHash) || !Array.isArray(row.manifest_snapshots)
      || row.manifest_snapshots.length !== CORE_SKILL_MANIFESTS.length || !Array.isArray(row.playbook_snapshots)
      || row.playbook_snapshots.length > 12 || typeof row.skill_catalog_binding_hash !== "string"
      || !HASH.test(row.skill_catalog_binding_hash)) throw new Error("invalid_binding");
    const manifests = row.manifest_snapshots.map((manifest) => {
      if (!exact(manifest, ["ref", "version", "hash"]) || typeof manifest.ref !== "string"
        || typeof manifest.version !== "string" || typeof manifest.hash !== "string") throw new Error("invalid_manifest");
      const found = coreSkillManifest(manifest.ref, manifest.version, manifest.hash);
      return Object.freeze({ ref: found.ref, version: found.version, hash: found.hash, name: found.name });
    }).sort((left, right) => left.ref.localeCompare(right.ref));
    if (new Set(manifests.map((manifest) => manifest.ref)).size !== CORE_SKILL_MANIFESTS.length) throw new Error("duplicate_manifest");
    const sourceDetailRecorded = row.playbook_snapshots.every((playbook) => exact(playbook,
      ["playbookRef", "revision", "playbookHash", "sourceRef", "citation"]));
    const legacySourceDetail = row.playbook_snapshots.every((playbook) => exact(playbook,
      ["playbookRef", "revision", "playbookHash", "sourceRef"]));
    if (!sourceDetailRecorded && !legacySourceDetail) throw new Error("mixed_or_invalid_citations");
    const playbooks = row.playbook_snapshots.map((playbook) => {
      if (!exact(playbook, sourceDetailRecorded
        ? ["playbookRef", "revision", "playbookHash", "sourceRef", "citation"]
        : ["playbookRef", "revision", "playbookHash", "sourceRef"])
        || typeof playbook.playbookRef !== "string" || !PLAYBOOK_REF.test(playbook.playbookRef)
        || !Number.isSafeInteger(playbook.revision) || (playbook.revision as number) < 1
        || typeof playbook.playbookHash !== "string" || !HASH.test(playbook.playbookHash)
        || typeof playbook.sourceRef !== "string" || !SOURCE_REF.test(playbook.sourceRef)) throw new Error("invalid_playbook");
      const citation = sourceDetailRecorded ? historicalSourceCitation(playbook.citation) : null;
      return Object.freeze({ playbookRef: playbook.playbookRef, revision: playbook.revision as number,
        playbookHash: playbook.playbookHash, sourceRef: playbook.sourceRef,
        citation });
    }).sort((left, right) => left.playbookRef.localeCompare(right.playbookRef));
    if (new Set(playbooks.map((playbook) => playbook.playbookRef)).size !== playbooks.length) throw new Error("duplicate_playbook");
    return Object.freeze({ state: "bound", pageGuide: Object.freeze({ pageLabel: guide.pageLabel, purpose: guide.purpose,
      scope: guide.recordPath }), profileLabel: `Workspace skill profili · revizyon ${row.profile_snapshot.revision}`,
    skills: Object.freeze(manifests.map(({ name, version }) => Object.freeze({ name, version }))),
    playbooks: Object.freeze(playbooks.map((playbook) => Object.freeze({ label: `Doğrulanmış çalışma notu · revizyon ${playbook.revision}`,
      source: playbook.citation }))), historicalSourceState: playbooks.length === 0 ? "not_applicable"
      : sourceDetailRecorded ? "available" : "detail_not_recorded", evidenceScope: EVIDENCE_SCOPE, uncertainty: UNCERTAINTY,
      readOnlyEvidence: readOnlyEvidence(row.evidence_context_snapshot, row.evidence_context_hash),
      skillRun: skillRunEvidence(row.skill_run_snapshot, row.skill_run_hash, row.evidence_context_hash) });
  } catch { return unavailableEvidence("missing_or_invalid"); }
}

function message(row: MessageRow, evidence: OrchestratorTurnEvidence | undefined): OrchestratorMessage {
  if (!MESSAGE.test(row.message_ref) || !TURN.test(row.turn_ref)
    || !Number.isSafeInteger(row.message_number) || row.message_number < 1 || row.message_number > 2_000_000
    || (row.role !== "user" && row.role !== "assistant")
    || typeof row.content !== "string" || row.content.length < 1 || row.content.length > 30_000) fail("corrupt_store");
  return Object.freeze({ messageRef: row.message_ref, turnRef: row.turn_ref, messageNumber: row.message_number,
    role: row.role, content: row.content, createdAt: iso(row.created_at),
    ...(row.role === "assistant" ? { evidence: evidence ?? unavailableEvidence("missing_or_invalid") } : {}) });
}

async function snapshot(executor: Executor, scope: Readonly<{ workspaceId: string; userId: string;
  conversationRef: string }>): Promise<OrchestratorConversationSnapshot | null> {
  const conversations = rows<ConversationRow>(await executor.execute(sql`
    select conversation_ref, created_at
    from orchestrator_conversations conversation
    where conversation.workspace_id = ${scope.workspaceId}::uuid
      and conversation.user_id = ${scope.userId}::uuid
      and conversation.conversation_ref = ${scope.conversationRef}
      and not exists (
        select 1 from orchestrator_conversation_tombstones tombstone
        where tombstone.workspace_id = conversation.workspace_id
          and tombstone.conversation_ref = conversation.conversation_ref
      )
    limit 2
  `));
  if (conversations.length > 1) fail("corrupt_store");
  const conversation = conversations[0];
  if (!conversation) return null;
  if (!CONVERSATION.test(conversation.conversation_ref)) fail("corrupt_store");
  const latest = rows<TurnRow>(await executor.execute(sql`
    select provider_thread_ref, page_guide
    from orchestrator_conversation_turns
    where workspace_id = ${scope.workspaceId}::uuid and conversation_ref = ${scope.conversationRef}
    order by turn_number desc limit 1
  `))[0] ?? null;
  const latestCompleted = rows<{ provider_thread_ref: string }>(await executor.execute(sql`
    select provider_thread_ref
    from orchestrator_conversation_turns
    where workspace_id = ${scope.workspaceId}::uuid and conversation_ref = ${scope.conversationRef}
      and outcome = 'completed'
    order by turn_number desc limit 1
  `))[0]?.provider_thread_ref ?? null;
  if (latestCompleted !== null && !PROVIDER_THREAD.test(latestCompleted)) fail("corrupt_store");
  const storedMessages = rows<MessageRow>(await executor.execute(sql`
    select message_ref, turn_ref, message_number, role, content, created_at
    from orchestrator_conversation_messages
    where workspace_id = ${scope.workspaceId}::uuid and conversation_ref = ${scope.conversationRef}
    order by message_number asc limit 200
  `));
  const evidenceRows = rows<EvidenceTurnRow>(await executor.execute(sql`
    select turn.turn_ref, turn.page_guide, turn.profile_snapshot, turn.manifest_snapshots,
      turn.playbook_snapshots, turn.skill_catalog_binding_hash, turn.evidence_context_snapshot, turn.evidence_context_hash,
      turn.skill_run_snapshot, turn.skill_run_hash
    from orchestrator_conversation_turns turn
    join orchestrator_conversations conversation on conversation.workspace_id = turn.workspace_id
      and conversation.conversation_ref = turn.conversation_ref
    where turn.workspace_id = ${scope.workspaceId}::uuid and turn.conversation_ref = ${scope.conversationRef}
      and conversation.user_id = ${scope.userId}::uuid
    order by turn.turn_number asc limit 100
  `));
  const evidenceByTurn = new Map<string, OrchestratorTurnEvidence>();
  for (const row of evidenceRows) {
    if (!TURN.test(row.turn_ref) || evidenceByTurn.has(row.turn_ref)) fail("corrupt_store");
    evidenceByTurn.set(row.turn_ref, orchestratorTurnEvidenceFromLedger(row));
  }
  const publicMessages = storedMessages.map((stored) => message(stored, evidenceByTurn.get(stored.turn_ref)));
  if (publicMessages.some((item, index) => item.messageNumber !== index + 1)) fail("corrupt_store");
  return Object.freeze({ conversationRef: conversation.conversation_ref, createdAt: iso(conversation.created_at),
    pageGuide: latest ? pageGuide(latest.page_guide) : null, providerThreadRef: latestCompleted,
    messages: Object.freeze(publicMessages) });
}

export class DrizzleOrchestratorConversationRepository implements OrchestratorConversationRepository {
  constructor(private readonly database: ConversationDatabase) {}

  async current(scope: Readonly<{ workspaceId: string; userId: string }>) {
    const found = rows<ConversationRow>(await this.database.execute(sql`
      select conversation.conversation_ref, conversation.created_at
      from orchestrator_conversations conversation
      join workspaces workspace on workspace.id = conversation.workspace_id and workspace.lifecycle_state = 'active'
      where conversation.workspace_id = ${scope.workspaceId}::uuid and conversation.user_id = ${scope.userId}::uuid
        and not exists (select 1 from orchestrator_conversation_tombstones tombstone
          where tombstone.workspace_id = conversation.workspace_id
            and tombstone.conversation_ref = conversation.conversation_ref)
      order by conversation.created_at desc, conversation.conversation_ref asc limit 1
    `))[0];
    return found ? snapshot(this.database, { ...scope, conversationRef: found.conversation_ref }) : null;
  }

  async create(scope: Readonly<{ workspaceId: string; userId: string; conversationRef: string; createdAt: string }>) {
    if (!CONVERSATION.test(scope.conversationRef) || !Number.isFinite(Date.parse(scope.createdAt))) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const membership = rows<{ user_id: string }>(await transaction.execute(sql`
        select membership.user_id from memberships membership
        join workspaces workspace on workspace.id = membership.workspace_id
        where membership.workspace_id = ${scope.workspaceId}::uuid and membership.user_id = ${scope.userId}::uuid
          and workspace.lifecycle_state = 'active'
        for update of membership
      `));
      if (membership.length !== 1) fail("conversation_unavailable");
      const existing = rows<ConversationRow>(await transaction.execute(sql`
        select conversation.conversation_ref, conversation.created_at
        from orchestrator_conversations conversation
        where conversation.workspace_id = ${scope.workspaceId}::uuid and conversation.user_id = ${scope.userId}::uuid
          and not exists (select 1 from orchestrator_conversation_tombstones tombstone
            where tombstone.workspace_id = conversation.workspace_id
              and tombstone.conversation_ref = conversation.conversation_ref)
        order by conversation.created_at desc, conversation.conversation_ref asc limit 1
      `))[0];
      const conversationRef = existing?.conversation_ref ?? scope.conversationRef;
      if (!existing) await transaction.execute(sql`
        insert into orchestrator_conversations (workspace_id, user_id, conversation_ref, created_at)
        values (${scope.workspaceId}::uuid, ${scope.userId}::uuid, ${scope.conversationRef}, ${scope.createdAt}::timestamptz)
      `);
      const result = await snapshot(transaction as Executor, { workspaceId: scope.workspaceId,
        userId: scope.userId, conversationRef });
      if (!result) fail("conversation_unavailable");
      return result;
    });
  }

  find(scope: Readonly<{ workspaceId: string; userId: string; conversationRef: string }>) {
    if (!CONVERSATION.test(scope.conversationRef)) fail("invalid_input");
    return snapshot(this.database, scope);
  }

  async appendTurn(input: Parameters<OrchestratorConversationRepository["appendTurn"]>[0]) {
    if (!CONVERSATION.test(input.conversationRef) || !TURN.test(input.turnRef)
      || !MESSAGE.test(input.userMessageRef) || (input.assistantMessageRef !== null && !MESSAGE.test(input.assistantMessageRef))
      || !Number.isFinite(Date.parse(input.createdAt))) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const locked = rows<{ conversation_ref: string }>(await transaction.execute(sql`
        select conversation.conversation_ref from orchestrator_conversations conversation
        join workspaces workspace on workspace.id = conversation.workspace_id and workspace.lifecycle_state = 'active'
        where conversation.workspace_id = ${input.workspaceId}::uuid
          and conversation.user_id = ${input.userId}::uuid
          and conversation.conversation_ref = ${input.conversationRef}
          and not exists (select 1 from orchestrator_conversation_tombstones tombstone
            where tombstone.workspace_id = conversation.workspace_id
              and tombstone.conversation_ref = conversation.conversation_ref)
        for update of conversation
      `));
      if (locked.length !== 1) fail("conversation_unavailable");
      const counters = rows<{ turn_number: number; message_number: number }>(await transaction.execute(sql`
        select
          coalesce((select max(turn_number) from orchestrator_conversation_turns
            where workspace_id = ${input.workspaceId}::uuid and conversation_ref = ${input.conversationRef}), 0)::int + 1 as turn_number,
          coalesce((select max(message_number) from orchestrator_conversation_messages
            where workspace_id = ${input.workspaceId}::uuid and conversation_ref = ${input.conversationRef}), 0)::int + 1 as message_number
      `))[0];
      if (!counters) fail("corrupt_store");
      await transaction.execute(sql`
        insert into orchestrator_conversation_turns (
          workspace_id, conversation_ref, turn_ref, turn_number, provider, provider_thread_ref,
          outcome, failure_code, page_guide, profile_snapshot, manifest_snapshots, playbook_snapshots, skill_catalog_binding_hash,
          evidence_context_snapshot, evidence_context_hash, skill_run_snapshot, skill_run_hash, created_at
        ) values (
          ${input.workspaceId}::uuid, ${input.conversationRef}, ${input.turnRef}, ${counters.turn_number},
          'codex_cli', ${input.providerThreadRef}, ${input.outcome}, ${input.failureCode},
          ${JSON.stringify(input.pageGuide)}::jsonb, ${JSON.stringify(input.skillCatalogSnapshot.profile)}::jsonb,
          ${JSON.stringify(input.skillCatalogSnapshot.manifests)}::jsonb,
          ${JSON.stringify(input.skillCatalogSnapshot.playbooks)}::jsonb,
          ${input.skillCatalogSnapshot.bindingHash}, ${JSON.stringify(input.evidenceContextSnapshot)}::jsonb,
          ${input.evidenceContextHash}, ${JSON.stringify(input.skillRunSnapshot)}::jsonb, ${input.skillRunHash}, ${input.createdAt}::timestamptz
        )
      `);
      await transaction.execute(sql`
        insert into orchestrator_conversation_messages (
          workspace_id, conversation_ref, turn_ref, message_ref, message_number, role, content, created_at
        ) values (${input.workspaceId}::uuid, ${input.conversationRef}, ${input.turnRef},
          ${input.userMessageRef}, ${counters.message_number}, 'user', ${input.userContent}, ${input.createdAt}::timestamptz)
      `);
      if (input.outcome === "completed") {
        if (!input.assistantMessageRef || !input.assistantContent) fail("invalid_input");
        await transaction.execute(sql`
          insert into orchestrator_conversation_messages (
            workspace_id, conversation_ref, turn_ref, message_ref, message_number, role, content, created_at
          ) values (${input.workspaceId}::uuid, ${input.conversationRef}, ${input.turnRef},
            ${input.assistantMessageRef}, ${counters.message_number + 1}, 'assistant', ${input.assistantContent},
            ${input.createdAt}::timestamptz)
        `);
      }
      const result = await snapshot(transaction as Executor, { workspaceId: input.workspaceId,
        userId: input.userId, conversationRef: input.conversationRef });
      if (!result) fail("conversation_unavailable");
      return result;
    });
  }
}
