import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CurrentReviewedGuidanceReader, type CurrentReviewedGuidanceManifest } from "@/connectors/guidance/current-reviewed-guidance-reader";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;

export const GUIDANCE_CAMPAIGN_SELECTION_VERSION = "guidance-campaign-selection/1.0.0" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^guidance_selection_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const ACTOR_REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const TOPIC = /^[a-z][a-z0-9_.:-]{0,63}$/;

export class GuidanceCampaignSelectionRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "corrupt_store") {
    super(`Guidance campaign selection rejected: ${code}`); this.name = "GuidanceCampaignSelectionRepositoryError";
  }
}

function fail(code: GuidanceCampaignSelectionRepositoryError["code"]): never { throw new GuidanceCampaignSelectionRepositoryError(code); }
function rows<T extends Row = Row>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}
function text(value: unknown, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail("invalid_input");
  return value.trim();
}
function topics(value: unknown, minimum: number): readonly string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 50 || value.some((entry) => typeof entry !== "string" || !TOPIC.test(entry))) fail("invalid_input");
  const sorted = [...value].sort();
  if (new Set(sorted).size !== sorted.length || sorted.some((entry, index) => entry !== value[index])) fail("invalid_input");
  return Object.freeze(sorted);
}
function budget(value: unknown): Readonly<{ maxCards: number; maxSources: number; maxCharacters: number }> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3
    || !["maxCards", "maxSources", "maxCharacters"].every((key) => key in value)) fail("invalid_input");
  const candidate = value as Record<string, unknown>;
  const maxCards = candidate.maxCards; const maxSources = candidate.maxSources; const maxCharacters = candidate.maxCharacters;
  if (typeof maxCards !== "number" || typeof maxSources !== "number" || typeof maxCharacters !== "number"
    || !Number.isSafeInteger(maxCards) || !Number.isSafeInteger(maxSources) || !Number.isSafeInteger(maxCharacters)
    || maxCards < 1 || maxCards > 100 || maxSources < 1 || maxSources > 500
    || maxCharacters < 256 || maxCharacters > 200_000) fail("invalid_input");
  return Object.freeze({ maxCards, maxSources, maxCharacters });
}

export type GuidanceCampaignSelection = Readonly<{
  selectionRef: string;
  revision: number;
  selectedSetRef: string;
  selectedSetVersion: number;
  selectedSetHash: string;
  topics: readonly string[];
  requiredTopics: readonly string[];
  budget: Readonly<{ maxCards: number; maxSources: number; maxCharacters: number }>;
  sourceSelectionHash: string;
  effectiveAt: string;
  previousSelectionHash: "GENESIS" | string;
  selectionHash: string;
}>;

export type GuidanceCampaignSelectionPublishInput = Readonly<{
  workspaceId: string;
  workspaceRef: string;
  actorId: string;
  actorRef: string;
  role: "owner" | "admin";
  accountRef: string;
  campaignRef: string;
  selectionRef: string;
  revision: number;
  expectedCurrentHash: "GENESIS" | string;
  selectedSetRef: string;
  selectedSetVersion: number;
  selectedSetHash: string;
  topics: readonly string[];
  requiredTopics: readonly string[];
  budget: Readonly<{ maxCards: number; maxSources: number; maxCharacters: number }>;
  effectiveAt: string;
  occurredAt: string;
}>;

function selectionPayload(input: GuidanceCampaignSelectionPublishInput): Omit<GuidanceCampaignSelection, "selectionHash" | "previousSelectionHash"> {
  const selectedSetRef = text(input.selectedSetRef);
  if (!REF.test(input.selectionRef) || !HASH.test(input.selectedSetHash) || !Number.isSafeInteger(input.selectedSetVersion)
    || input.selectedSetVersion < 1) fail("invalid_input");
  const selectedTopics = topics(input.topics, 1);
  const requiredTopics = topics(input.requiredTopics, 0);
  if (requiredTopics.some((topic) => !selectedTopics.includes(topic))) fail("invalid_input");
  const selectedBudget = budget(input.budget);
  const effectiveAt = iso(input.effectiveAt);
  const sourceSelectionHash = digest({ selectionVersion: GUIDANCE_CAMPAIGN_SELECTION_VERSION, selectedSetRef,
    selectedSetVersion: input.selectedSetVersion, selectedSetHash: input.selectedSetHash, topics: selectedTopics,
    requiredTopics, budget: selectedBudget, effectiveAt });
  return Object.freeze({ selectionRef: input.selectionRef, revision: input.revision, selectedSetRef, selectedSetVersion: input.selectedSetVersion,
    selectedSetHash: input.selectedSetHash, topics: selectedTopics, requiredTopics, budget: selectedBudget, sourceSelectionHash, effectiveAt });
}

function validateInput(input: GuidanceCampaignSelectionPublishInput): { occurredAt: string; payload: ReturnType<typeof selectionPayload> } {
  if (!input || typeof input !== "object" || !UUID.test(input.workspaceId) || !UUID.test(input.actorId)
    || !text(input.workspaceRef) || !ACTOR_REF.test(input.actorRef) || !["owner", "admin"].includes(input.role)
    || !text(input.accountRef) || !text(input.campaignRef) || !REF.test(input.selectionRef)
    || !Number.isSafeInteger(input.revision) || input.revision < 1
    || (input.expectedCurrentHash !== "GENESIS" && !HASH.test(input.expectedCurrentHash))) fail("invalid_input");
  const occurredAt = iso(input.occurredAt);
  const payload = selectionPayload(input);
  if (Date.parse(payload.effectiveAt) > Date.parse(occurredAt)) fail("invalid_input");
  return { occurredAt, payload };
}

async function exactReviewedSet(transaction: Database, workspaceId: string, capturedAt: string,
  candidate: Pick<GuidanceCampaignSelection, "selectedSetRef" | "selectedSetVersion" | "selectedSetHash">,
  reader: Pick<CurrentReviewedGuidanceReader, "readCurrentInTransaction">): Promise<CurrentReviewedGuidanceManifest> {
  const manifest = await reader.readCurrentInTransaction(transaction, workspaceId, capturedAt);
  const match = manifest.reviewedSets.filter((set) => set.setRef === candidate.selectedSetRef
    && set.setVersion === candidate.selectedSetVersion && set.setHash === candidate.selectedSetHash);
  if (match.length !== 1) fail("not_found");
  return manifest;
}

/** Server-private publisher for a reviewed, advisory-only campaign selection. */
export class DrizzleGuidanceCampaignSelectionRepository {
  constructor(private readonly database: Database,
    private readonly guidanceReader: Pick<CurrentReviewedGuidanceReader, "readCurrentInTransaction"> = new CurrentReviewedGuidanceReader()) {}

  async publish(input: GuidanceCampaignSelectionPublishInput): Promise<Readonly<{
    outcome: "inserted" | "unchanged"; selection: GuidanceCampaignSelection;
    capabilities: Readonly<{ canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false }>;
  }>> {
    const { occurredAt, payload } = validateInput(input);
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const workspace = rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid
        and lifecycle_state = 'active' for update`));
      if (workspace.length !== 1) fail("not_found");
      const membership = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships
        where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid limit 2`));
      if (membership.length !== 1 || membership[0]!.role !== input.role) fail("forbidden");
      const scope = rows<{ account_id: unknown; campaign_id: unknown; captured_at: unknown }>(await tx.execute(sql`
        select account.id::text as account_id, campaign.id::text as campaign_id,
          to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as captured_at
        from ad_accounts account join ad_campaigns campaign on campaign.workspace_id = account.workspace_id
          and campaign.ad_account_id = account.id
        where account.workspace_id = ${input.workspaceId}::uuid and account.external_account_id = ${input.accountRef}
          and campaign.external_campaign_id = ${input.campaignRef} limit 2 for update`));
      if (scope.length !== 1 || typeof scope[0]!.account_id !== "string" || typeof scope[0]!.campaign_id !== "string"
        || typeof scope[0]!.captured_at !== "string") fail(scope.length ? "corrupt_store" : "not_found");
      const capturedAt = iso(scope[0]!.captured_at);
      await exactReviewedSet(tx, input.workspaceId, capturedAt, payload, this.guidanceReader);
      const current = rows<{ revision_id: unknown; selection_ref: unknown; revision: unknown; selection_hash: unknown }>(await tx.execute(sql`
        select revision_id::text as revision_id, selection_ref, revision, selection_hash
        from guidance_campaign_selection_heads where workspace_id = ${input.workspaceId}::uuid
          and ad_account_id = ${scope[0]!.account_id}::uuid and campaign_id = ${scope[0]!.campaign_id}::uuid
        limit 2 for update`));
      if (current.length > 1) fail("corrupt_store");
      const head = current[0];
      const previousSelectionHash = head ? (typeof head.selection_hash === "string" && HASH.test(head.selection_hash) ? head.selection_hash : fail("corrupt_store")) : "GENESIS";
      const expectedRevision = head ? Number(head.revision) + 1 : 1;
      if (input.expectedCurrentHash !== previousSelectionHash || input.revision !== expectedRevision) fail("conflict");
      if (head && typeof head.selection_ref !== "string") fail("corrupt_store");
      const selectionHash = digest({ ...payload, previousSelectionHash, actorRef: input.actorRef, actorRole: input.role, occurredAt });
      const selection: GuidanceCampaignSelection = Object.freeze({ ...payload, previousSelectionHash, selectionHash });
      if (head && head.selection_hash === selectionHash) return Object.freeze({ outcome: "unchanged" as const, selection,
        capabilities: Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
      const revisionId = randomUUID();
      await tx.execute(sql`insert into guidance_campaign_selection_revisions (
        id, workspace_id, ad_account_id, campaign_id, selection_ref, revision, selection_version,
        selected_set_ref, selected_set_version, selected_set_hash, topics, required_topics, budget, source_selection_hash,
        effective_at, previous_selection_hash, selection_hash, actor_ref, actor_role, occurred_at
      ) values (${revisionId}::uuid, ${input.workspaceId}::uuid, ${scope[0]!.account_id}::uuid, ${scope[0]!.campaign_id}::uuid,
        ${selection.selectionRef}, ${selection.revision}, ${GUIDANCE_CAMPAIGN_SELECTION_VERSION}, ${selection.selectedSetRef},
        ${selection.selectedSetVersion}, ${selection.selectedSetHash}, ${JSON.stringify(selection.topics)}::jsonb,
        ${JSON.stringify(selection.requiredTopics)}::jsonb, ${JSON.stringify(selection.budget)}::jsonb, ${selection.sourceSelectionHash},
        ${selection.effectiveAt}::timestamptz, ${selection.previousSelectionHash}, ${selection.selectionHash}, ${input.actorRef},
        ${input.role}, ${occurredAt}::timestamptz)`);
      await tx.execute(sql`insert into guidance_campaign_selection_heads (
        workspace_id, ad_account_id, campaign_id, revision_id, selection_ref, revision, selection_hash, updated_at
      ) values (${input.workspaceId}::uuid, ${scope[0]!.account_id}::uuid, ${scope[0]!.campaign_id}::uuid, ${revisionId}::uuid,
        ${selection.selectionRef}, ${selection.revision}, ${selection.selectionHash}, ${occurredAt}::timestamptz)
      on conflict (workspace_id, ad_account_id, campaign_id) do update set revision_id = excluded.revision_id,
        selection_ref = excluded.selection_ref, revision = excluded.revision, selection_hash = excluded.selection_hash,
        updated_at = excluded.updated_at`);
      if (previousSelectionHash !== "GENESIS") {
        const affected = rows<{ component_ref: unknown; component_version: unknown; entity_type: unknown; entity_ref: unknown }>(await tx.execute(sql`
          select distinct component.component_ref, component.component_version, context.entity_type, context.entity_ref
          from effective_campaign_context_components component join effective_campaign_contexts context
            on context.workspace_id = component.workspace_id and context.id = component.context_id
          where component.workspace_id = ${input.workspaceId}::uuid and component.component_type = 'guidance_selection'
            and component.component_ref = ${input.selectionRef} and component.component_version = ${previousSelectionHash}
            and context.campaign_ref = ${input.campaignRef}
          order by component.component_ref, component.component_version, context.entity_type, context.entity_ref`));
        for (const component of affected) {
          if (typeof component.component_ref !== "string" || typeof component.component_version !== "string"
            || !["campaign", "ad_set", "ad", "creative"].includes(String(component.entity_type))
            || typeof component.entity_ref !== "string" || !component.entity_ref.trim()) fail("corrupt_store");
          const invalidation = Object.freeze({ workspaceId: input.workspaceId, componentType: "guidance_selection",
            componentRef: component.component_ref, componentVersion: component.component_version,
            entityType: component.entity_type, entityRef: component.entity_ref, occurredAt });
          await tx.execute(sql`insert into effective_campaign_context_invalidations (workspace_id, event_hash, component_type,
            component_ref, component_version, scope_kind, entity_type, entity_ref, reason_code, observed_at) values (
            ${input.workspaceId}::uuid, ${digest(invalidation)}, 'guidance_selection', ${invalidation.componentRef},
            ${invalidation.componentVersion}, 'exact_entity_component', ${invalidation.entityType}, ${invalidation.entityRef},
            'source_changed', ${occurredAt}::timestamptz) on conflict (workspace_id, event_hash) do nothing`);
        }
      }
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousAuditHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events
        where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const event = Object.freeze({ workspaceId: input.workspaceId, actorId: input.actorId, action: "guidance_campaign_selection.published",
        resourceType: "guidance_campaign_selection", resourceId: selection.selectionRef, previousHash: previousAuditHash, occurredAt,
        metadata: { selectionHash: selection.selectionHash, revision: selection.revision, selectedSetRef: selection.selectedSetRef,
          selectedSetVersion: selection.selectedSetVersion, sourceSelectionHash: selection.sourceSelectionHash, accountRef: input.accountRef,
          campaignRef: input.campaignRef } });
      await tx.execute(sql`insert into audit_events (workspace_id, actor_id, action, resource_type, resource_id, metadata,
        previous_hash, event_hash, occurred_at) values (${event.workspaceId}::uuid, ${event.actorId}::uuid, ${event.action},
        ${event.resourceType}, ${event.resourceId}, ${JSON.stringify(event.metadata)}::jsonb, ${event.previousHash},
        ${digest(event)}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ outcome: "inserted" as const, selection,
        capabilities: Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
    });
  }
}
