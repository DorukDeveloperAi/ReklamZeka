import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  DECISION_CADENCE_VERSION,
  evaluateDecisionCadence,
  type DecisionCadenceProfile,
  type DecisionCadenceResult,
} from "@/domain/decisions/cadence";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const PROFILE_REF = /^cadence_[a-z0-9][a-z0-9_.:-]{0,126}$/;

export class CurrentDecisionCadenceReaderError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "ambiguous" | "paused" | "future" | "corrupt_store") {
    super(`Current decision cadence rejected: ${code}`);
    this.name = "CurrentDecisionCadenceReaderError";
  }
}

function fail(code: CurrentDecisionCadenceReaderError["code"]): never {
  throw new CurrentDecisionCadenceReaderError(code);
}

function rows<T extends Row = Row>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly T[];
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail("corrupt_store");
  }
  return value;
}

function nullableIso(value: unknown): string | null {
  if (value === null) return null;
  return iso(value);
}

export type CurrentDecisionCadence = Readonly<{
  revisionId: string;
  profileRef: string;
  profileRevision: number;
  profileVersion: typeof DECISION_CADENCE_VERSION;
  profileHash: string;
  profile: DecisionCadenceProfile;
  /** The result is advisory only and cannot authorize an action. */
  decision: DecisionCadenceResult;
}>;

/**
 * Read-only, server-private cadence source. It deliberately accepts only the
 * stable tenant/campaign identity; no route or caller can inject a profile,
 * clock, evidence, learning state, or action request into this boundary.
 */
export class CurrentDecisionCadenceReader {
  constructor(private readonly database: Database) {}

  async readCurrent(input: Readonly<{ workspaceId: string; accountRef: string; campaignRef: string }>): Promise<CurrentDecisionCadence> {
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== 3
      || Object.keys(input).some((key) => !["workspaceId", "accountRef", "campaignRef"].includes(key))
      || !UUID.test(input.workspaceId) || !input.accountRef.trim() || !input.campaignRef.trim()) {
      fail("invalid_input");
    }
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      await tx.execute(sql`set transaction isolation level repeatable read, read only`);
      const candidates = rows<Readonly<{
        revision_id: unknown;
        profile_ref: unknown;
        revision: unknown;
        profile_version: unknown;
        profile_hash: unknown;
        profile_payload: unknown;
        profile_created_at: unknown;
        observed_from: unknown;
        last_material_change_at: unknown;
        campaign_status: unknown;
        database_now: unknown;
      }>>(await tx.execute(sql`
        select cadence.id::text as revision_id,
          cadence.profile_ref, cadence.revision, cadence.profile_version, cadence.profile_hash, cadence.profile_payload,
          cadence.created_at::text as profile_created_at,
          coalesce(campaign.start_at, campaign.first_seen_at)::text as observed_from,
          campaign.source_updated_at::text as last_material_change_at,
          coalesce(campaign.effective_status, campaign.configured_status)::text as campaign_status,
          clock_timestamp()::text as database_now
        from workspaces workspace
        join ad_accounts account
          on account.workspace_id = workspace.id and account.external_account_id = ${input.accountRef}
        join ad_campaigns campaign
          on campaign.workspace_id = workspace.id and campaign.ad_account_id = account.id
         and campaign.external_campaign_id = ${input.campaignRef}
        join decision_cadence_profile_revisions cadence
          on cadence.workspace_id = workspace.id and cadence.ad_account_id = account.id and cadence.campaign_id = campaign.id
         and cadence.superseded_at is null
        where workspace.id = ${input.workspaceId}::uuid and workspace.lifecycle_state = 'active'
        order by cadence.profile_ref asc
        limit 2
      `));
      if (candidates.length === 0) fail("not_found");
      if (candidates.length !== 1) fail("ambiguous");
      const row = candidates[0]!;
      const databaseNow = iso(row.database_now);
      const profileCreatedAt = iso(row.profile_created_at);
      const observedFrom = iso(row.observed_from);
      const lastMaterialChangeAt = nullableIso(row.last_material_change_at);
      if (Date.parse(profileCreatedAt) > Date.parse(databaseNow)
        || Date.parse(observedFrom) > Date.parse(databaseNow)
        || (lastMaterialChangeAt !== null && Date.parse(lastMaterialChangeAt) > Date.parse(databaseNow))) {
        fail("future");
      }
      if (typeof row.campaign_status !== "string" || row.campaign_status.toUpperCase() !== "ACTIVE") {
        fail("paused");
      }
      if (typeof row.revision_id !== "string" || !UUID.test(row.revision_id)
        || typeof row.profile_ref !== "string" || !PROFILE_REF.test(row.profile_ref)
        || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1
        || row.profile_version !== DECISION_CADENCE_VERSION
        || typeof row.profile_hash !== "string" || !HASH.test(row.profile_hash)
        || !row.profile_payload || typeof row.profile_payload !== "object" || Array.isArray(row.profile_payload)) {
        fail("corrupt_store");
      }
      const profileRevision = row.revision;
      const profile = row.profile_payload as DecisionCadenceProfile;
      if (digest(profile) !== row.profile_hash) fail("corrupt_store");
      let decision: DecisionCadenceResult;
      try {
        // The only durable evidence available at this narrow source boundary is
        // the empty set. The domain evaluator therefore keeps the result
        // blocked after observation/settling gates until a later evidence
        // reader can prove stronger repository-owned evidence.
        decision = evaluateDecisionCadence({
          profile,
          now: databaseNow,
          observationStartedAt: observedFrom,
          lastMaterialChangeAt,
          learning: { state: "not_applicable", startedAt: null },
          lastDecision: null,
          recentDecisions: [],
          evidence: { refs: [], score: 0 },
          requestedDisposition: "test",
          recommendationSource: "deterministic_policy",
          emergencyGuardrail: { breached: false, evidenceRef: null },
        });
      } catch {
        fail("corrupt_store");
      }
      return Object.freeze({
        revisionId: row.revision_id,
        profileRef: row.profile_ref,
        profileRevision,
        profileVersion: DECISION_CADENCE_VERSION,
        profileHash: row.profile_hash,
        profile: Object.freeze({ ...profile }),
        decision,
      });
    });
  }
}
