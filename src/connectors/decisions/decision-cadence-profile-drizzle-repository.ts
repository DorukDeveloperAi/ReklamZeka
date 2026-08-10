import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DECISION_CADENCE_VERSION, evaluateDecisionCadence, type DecisionCadenceProfile } from "@/domain/decisions/cadence";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^cadence_[a-z0-9][a-z0-9_.:-]{0,126}$/;

export class DecisionCadenceProfileRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "corrupt_store") {
    super(`Decision cadence profile rejected: ${code}`); this.name = "DecisionCadenceProfileRepositoryError";
  }
}

function fail(code: DecisionCadenceProfileRepositoryError["code"]): never { throw new DecisionCadenceProfileRepositoryError(code); }
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

/** Server-private owner/admin publisher. It only records advisory cadence configuration. */
export class DrizzleDecisionCadenceProfileRepository {
  constructor(private readonly database: Database) {}

  async publish(input: Readonly<{
    workspaceId: string; workspaceRef: string; actorId: string; actorRef: string; role: "owner" | "admin";
    accountRef: string; campaignRef: string; profileRef: string; revision: number;
    expectedCurrentHash: "GENESIS" | string; profile: DecisionCadenceProfile; occurredAt: string;
  }>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; profileHash: string; capabilities: Readonly<{
    canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false;
  }> }>> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !input.workspaceRef.trim() || !input.actorRef.trim()
      || !["owner", "admin"].includes(input.role) || !REF.test(input.profileRef)
      || !Number.isSafeInteger(input.revision) || input.revision < 1 || !input.accountRef.trim() || !input.campaignRef.trim()) fail("invalid_input");
    if (input.expectedCurrentHash !== "GENESIS" && !HASH.test(input.expectedCurrentHash)) fail("invalid_input");
    const occurredAt = iso(input.occurredAt);
    try {
      evaluateDecisionCadence({ profile: input.profile, now: occurredAt, observationStartedAt: occurredAt,
        lastMaterialChangeAt: null, learning: { state: "not_applicable", startedAt: null }, lastDecision: null,
        recentDecisions: [], evidence: { refs: ["cadence_profile_validation"], score: 1 }, requestedDisposition: "test",
        recommendationSource: "deterministic_policy", emergencyGuardrail: { breached: false, evidenceRef: null } });
    } catch { fail("invalid_input"); }
    const profileHash = digest(input.profile);
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid
        and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const membership = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships
        where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid limit 2`));
      if (membership.length !== 1 || membership[0]!.role !== input.role) fail("forbidden");
      const scope = rows<{ account_id: unknown; campaign_id: unknown }>(await tx.execute(sql`
        select account.id::text as account_id, campaign.id::text as campaign_id from ad_accounts account
        join ad_campaigns campaign on campaign.workspace_id = account.workspace_id and campaign.ad_account_id = account.id
        where account.workspace_id = ${input.workspaceId}::uuid and account.external_account_id = ${input.accountRef}
          and campaign.external_campaign_id = ${input.campaignRef} limit 2 for update`));
      if (scope.length !== 1 || typeof scope[0]!.account_id !== "string" || typeof scope[0]!.campaign_id !== "string") fail(scope.length ? "corrupt_store" : "not_found");
      const current = rows<{ revision: unknown; profile_hash: unknown }>(await tx.execute(sql`
        select revision, profile_hash from decision_cadence_profile_revisions where workspace_id = ${input.workspaceId}::uuid
          and profile_ref = ${input.profileRef} and superseded_at is null limit 2 for update`));
      if (current.length > 1) fail("corrupt_store");
      const currentHash = current[0] ? String(current[0]!.profile_hash) : "GENESIS";
      if (currentHash !== input.expectedCurrentHash) fail("conflict");
      if (current[0]?.profile_hash === profileHash) return Object.freeze({ outcome: "unchanged" as const, profileHash, capabilities: Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
      if (input.revision !== (current[0] ? Number(current[0]!.revision) : 0) + 1) fail("conflict");
      if (current[0]) await tx.execute(sql`update decision_cadence_profile_revisions set superseded_at = ${occurredAt}::timestamptz
        where workspace_id = ${input.workspaceId}::uuid and profile_ref = ${input.profileRef} and superseded_at is null`);
      await tx.execute(sql`insert into decision_cadence_profile_revisions (workspace_id, ad_account_id, campaign_id, profile_ref,
        revision, profile_version, profile_hash, profile_payload) values (${input.workspaceId}::uuid, ${scope[0]!.account_id}::uuid,
        ${scope[0]!.campaign_id}::uuid, ${input.profileRef}, ${input.revision}, ${DECISION_CADENCE_VERSION}, ${profileHash}, ${JSON.stringify(input.profile)}::jsonb)`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events where workspace_id = ${input.workspaceId}::uuid
        order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const event = Object.freeze({ workspaceId: input.workspaceId, actorId: input.actorId, action: "decision_cadence_profile.published",
        resourceType: "decision_cadence_profile", resourceId: input.profileRef, metadata: { profileHash, revision: input.revision, accountRef: input.accountRef, campaignRef: input.campaignRef }, previousHash, occurredAt });
      await tx.execute(sql`insert into audit_events (workspace_id, actor_id, action, resource_type, resource_id, metadata, previous_hash, event_hash, occurred_at)
        values (${event.workspaceId}::uuid, ${event.actorId}::uuid, ${event.action}, ${event.resourceType}, ${event.resourceId},
          ${JSON.stringify(event.metadata)}::jsonb, ${event.previousHash}, ${digest(event)}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ outcome: "inserted" as const, profileHash, capabilities: Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
    });
  }
}
