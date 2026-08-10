import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CurrentReviewedGuidanceReader } from "@/connectors/guidance/current-reviewed-guidance-reader";
import { GUIDANCE_CAMPAIGN_SELECTION_VERSION, type GuidanceCampaignSelection } from "@/connectors/guidance/guidance-campaign-selection-drizzle-repository";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^guidance_selection_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const ACTOR_REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const TOPIC = /^[a-z][a-z0-9_.:-]{0,63}$/;

export class CurrentGuidanceCampaignSelectionReaderError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "ambiguous" | "future" | "corrupt_store") {
    super(`Current guidance campaign selection rejected: ${code}`); this.name = "CurrentGuidanceCampaignSelectionReaderError";
  }
}
function fail(code: CurrentGuidanceCampaignSelectionReaderError["code"]): never { throw new CurrentGuidanceCampaignSelectionReaderError(code); }
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
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("corrupt_store");
  return value;
}
function topicArray(value: unknown, minimum: number): readonly string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 50 || value.some((topic) => typeof topic !== "string" || !TOPIC.test(topic))) fail("corrupt_store");
  const sorted = [...value].sort();
  if (new Set(sorted).size !== sorted.length || sorted.some((topic, index) => topic !== value[index])) fail("corrupt_store");
  return Object.freeze(sorted);
}
function parseBudget(value: unknown): GuidanceCampaignSelection["budget"] {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3) fail("corrupt_store");
  const v = value as Record<string, unknown>;
  const maxCards = v.maxCards; const maxSources = v.maxSources; const maxCharacters = v.maxCharacters;
  if (typeof maxCards !== "number" || typeof maxSources !== "number" || typeof maxCharacters !== "number"
    || !Number.isSafeInteger(maxCards) || !Number.isSafeInteger(maxSources) || !Number.isSafeInteger(maxCharacters)
    || maxCards < 1 || maxCards > 100 || maxSources < 1 || maxSources > 500 || maxCharacters < 256 || maxCharacters > 200_000) fail("corrupt_store");
  return Object.freeze({ maxCards, maxSources, maxCharacters });
}

export type CurrentGuidanceCampaignSelectionInput = Readonly<{ workspaceId: string; accountRef: string; campaignRef: string }>;
function validInput(value: unknown): value is CurrentGuidanceCampaignSelectionInput {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 3
    && UUID.test((value as CurrentGuidanceCampaignSelectionInput).workspaceId)
    && typeof (value as CurrentGuidanceCampaignSelectionInput).accountRef === "string" && (value as CurrentGuidanceCampaignSelectionInput).accountRef.trim().length > 0
    && typeof (value as CurrentGuidanceCampaignSelectionInput).campaignRef === "string" && (value as CurrentGuidanceCampaignSelectionInput).campaignRef.trim().length > 0;
}

/** Transaction-local selection evidence reader; it validates selection plus its exact reviewed manifest. */
export class CurrentGuidanceCampaignSelectionReader {
  constructor(private readonly guidanceReader: Pick<CurrentReviewedGuidanceReader, "readCurrentInTransaction"> = new CurrentReviewedGuidanceReader()) {}

  async readCurrentInTransaction(transaction: Database, input: CurrentGuidanceCampaignSelectionInput,
    capturedAt: string): Promise<GuidanceCampaignSelection> {
    if (!validInput(input) || !Number.isFinite(Date.parse(capturedAt)) || new Date(capturedAt).toISOString() !== capturedAt) fail("invalid_input");
    const candidates = rows(await transaction.execute(sql`
      select revision.selection_ref, revision.revision, revision.selection_version, revision.selected_set_ref,
        revision.selected_set_version, revision.selected_set_hash, revision.topics, revision.required_topics, revision.budget,
        revision.source_selection_hash, to_char(revision.effective_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as effective_at,
        revision.previous_selection_hash, revision.selection_hash, revision.actor_ref, revision.actor_role,
        to_char(revision.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_at,
        to_char(revision.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
        to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as database_now
      from workspaces workspace join ad_accounts account on account.workspace_id = workspace.id
        and account.external_account_id = ${input.accountRef}
      join ad_campaigns campaign on campaign.workspace_id = workspace.id and campaign.ad_account_id = account.id
        and campaign.external_campaign_id = ${input.campaignRef}
      join guidance_campaign_selection_heads head on head.workspace_id = workspace.id and head.ad_account_id = account.id
        and head.campaign_id = campaign.id
      join guidance_campaign_selection_revisions revision on revision.workspace_id = head.workspace_id and revision.id = head.revision_id
        and revision.ad_account_id = account.id and revision.campaign_id = campaign.id and revision.selection_ref = head.selection_ref
        and revision.revision = head.revision and revision.selection_hash = head.selection_hash
      where workspace.id = ${input.workspaceId}::uuid and workspace.lifecycle_state = 'active' limit 2`));
    if (candidates.length === 0) fail("not_found");
    if (candidates.length !== 1) fail("ambiguous");
    const row = candidates[0]!;
    const databaseNow = iso(row.database_now);
    if (databaseNow !== capturedAt) fail("corrupt_store");
    if (typeof row.selection_ref !== "string" || !REF.test(row.selection_ref) || typeof row.revision !== "number"
      || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.selection_version !== GUIDANCE_CAMPAIGN_SELECTION_VERSION
      || typeof row.selected_set_ref !== "string" || !row.selected_set_ref.trim() || typeof row.selected_set_version !== "number"
      || !Number.isSafeInteger(row.selected_set_version) || row.selected_set_version < 1 || typeof row.selected_set_hash !== "string"
      || !HASH.test(row.selected_set_hash) || typeof row.source_selection_hash !== "string" || !HASH.test(row.source_selection_hash)
      || typeof row.selection_hash !== "string" || !HASH.test(row.selection_hash) || typeof row.previous_selection_hash !== "string"
      || (row.revision === 1 ? row.previous_selection_hash !== "GENESIS" : !HASH.test(row.previous_selection_hash))
      || typeof row.actor_ref !== "string" || !ACTOR_REF.test(row.actor_ref) || !["owner", "admin"].includes(String(row.actor_role))) fail("corrupt_store");
    const effectiveAt = iso(row.effective_at); const occurredAt = iso(row.occurred_at); const createdAt = iso(row.created_at);
    if (Date.parse(effectiveAt) > Date.parse(occurredAt) || Date.parse(occurredAt) > Date.parse(databaseNow)
      || Date.parse(createdAt) > Date.parse(databaseNow)) fail("future");
    const selectedTopics = topicArray(row.topics, 1); const requiredTopics = topicArray(row.required_topics, 0);
    if (requiredTopics.some((topic) => !selectedTopics.includes(topic))) fail("corrupt_store");
    const selectedBudget = parseBudget(row.budget);
    const selection = Object.freeze({ selectionRef: row.selection_ref, revision: row.revision, selectedSetRef: row.selected_set_ref,
      selectedSetVersion: row.selected_set_version, selectedSetHash: row.selected_set_hash, topics: selectedTopics,
      requiredTopics, budget: selectedBudget, sourceSelectionHash: row.source_selection_hash, effectiveAt,
      previousSelectionHash: row.previous_selection_hash as "GENESIS" | string, selectionHash: row.selection_hash });
    const expectedSourceHash = digest({ selectionVersion: GUIDANCE_CAMPAIGN_SELECTION_VERSION, selectedSetRef: selection.selectedSetRef,
      selectedSetVersion: selection.selectedSetVersion, selectedSetHash: selection.selectedSetHash, topics: selection.topics,
      requiredTopics: selection.requiredTopics, budget: selection.budget, effectiveAt: selection.effectiveAt });
    const expectedSelectionHash = digest({ ...selection, selectionHash: undefined, actorRef: row.actor_ref,
      actorRole: row.actor_role, occurredAt });
    if (expectedSourceHash !== selection.sourceSelectionHash || expectedSelectionHash !== selection.selectionHash) fail("corrupt_store");
    const manifest = await this.guidanceReader.readCurrentInTransaction(transaction, input.workspaceId, capturedAt);
    if (!manifest.reviewedSets.some((set) => set.setRef === selection.selectedSetRef && set.setVersion === selection.selectedSetVersion
      && set.setHash === selection.selectedSetHash)) fail("not_found");
    return selection;
  }
}
