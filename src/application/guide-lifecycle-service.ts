import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { DrizzleGuideLifecycleRepository, GuideLifecycleRepositoryError } from "@/connectors/guides/guide-lifecycle-drizzle-repository";
import { createGuideRevision, GuideRevisionError, GUIDE_MODES, validateGuideSchedule, type GuideAction, type GuideMarket, type GuideMode, type GuideSchedule } from "@/domain/guides/guide-revision";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

export class GuideLifecycleServiceError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "conflict" | "forbidden" | "unavailable") {
    super(`guide lifecycle service rejected: ${code}`); this.name = "GuideLifecycleServiceError";
  }
}

function rows(value: unknown): readonly Row[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) throw new GuideLifecycleServiceError("unavailable");
  return value.rows as readonly Row[];
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw new GuideLifecycleServiceError("invalid_input");
}
function ref(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !REF.test(value) || !value.startsWith(prefix)) throw new GuideLifecycleServiceError("invalid_input"); return value;
}
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) throw new GuideLifecycleServiceError("invalid_input"); return value; }
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new GuideLifecycleServiceError("invalid_input"); return Number(value); }
function schedule(value: unknown): GuideSchedule { try { return validateGuideSchedule(value as GuideSchedule); } catch { throw new GuideLifecycleServiceError("unavailable"); } }
function mapError(reason: unknown): never {
  if (reason instanceof GuideLifecycleServiceError) throw reason;
  if (reason instanceof GuideRevisionError) throw new GuideLifecycleServiceError("invalid_input");
  if (reason instanceof GuideLifecycleRepositoryError) throw new GuideLifecycleServiceError(reason.code === "corrupt_store" ? "unavailable" : reason.code);
  throw reason;
}

export type GuideDraftRequest = Readonly<{
  label: string; sliceRef: string; market: GuideMarket; freeText: string;
  schedule: GuideSchedule; mode: GuideMode; actionAllowlist: readonly GuideAction[];
  budgetRefs: readonly Readonly<{ limitRef: string; scopeKind: "market" | "organization_campaign" | "geo_targeting_platform" | "campaign_ad_set" }>[];
  rollbackConditions: readonly string[];
}>;

export class GuideLifecycleService {
  private readonly repository: DrizzleGuideLifecycleRepository;
  constructor(private readonly database: Pick<Database, "execute" | "transaction">, private readonly memberships: readonly WorkspaceMembership[]) {
    this.repository = new DrizzleGuideLifecycleRepository(database);
  }

  async list(principal: TrustedDecisionRoomPrincipal) {
    authorizeWorkspace(principal.actor, principal.workspaceId, "guide_lifecycle:read", this.memberships);
    const found = rows(await this.database.execute(sql`select g.id::text guide_id,g.guide_ref,g.label,h.latest_revision_id::text,h.current_active_revision_id::text,h.version,
      r.revision_number,r.revision_hash,r.interpretation_hash,r.slice_ref,r.market_key,r.mode,r.free_text,r.schedule_payload,r.created_at::text,
      exists(select 1 from guide_interpretation_acceptances a where a.workspace_id=g.workspace_id and a.guide_revision_id=r.id and a.interpretation_hash=r.interpretation_hash) interpretation_accepted
      from guides g join guide_heads h on h.workspace_id=g.workspace_id and h.guide_id=g.id
      join guide_revisions r on r.workspace_id=g.workspace_id and r.id=h.latest_revision_id and r.guide_id=g.id
      where g.workspace_id=${principal.workspaceId}::uuid and g.tombstoned_at is null order by r.created_at desc,g.guide_ref limit 101`));
    if (found.length > 100) throw new GuideLifecycleServiceError("unavailable");
    const items = found.map((row) => {
      const guideId = uuid(row.guide_id); const revisionId = uuid(row.latest_revision_id);
      if (typeof row.label !== "string" || !row.label.trim() || row.label.length > 160 || typeof row.revision_hash !== "string" || !HASH.test(row.revision_hash)
        || typeof row.interpretation_hash !== "string" || !HASH.test(row.interpretation_hash) || (row.market_key !== "yerli" && row.market_key !== "yabanci")
        || typeof row.mode !== "string" || !GUIDE_MODES.includes(row.mode as GuideMode) || typeof row.free_text !== "string" || row.free_text.length > 10_000
        || !row.schedule_payload || typeof row.schedule_payload !== "object" || Array.isArray(row.schedule_payload)) throw new GuideLifecycleServiceError("unavailable");
      return Object.freeze({ guideId, guideRef: ref(row.guide_ref, "guide_"), label: row.label, revisionId,
        activeRevisionId: row.current_active_revision_id === null ? null : uuid(row.current_active_revision_id), headVersion: integer(row.version), revision: integer(row.revision_number),
        revisionHash: row.revision_hash, interpretationHash: row.interpretation_hash, interpretationAccepted: row.interpretation_accepted === true,
        sliceRef: ref(row.slice_ref, "slice_"), market: row.market_key, mode: row.mode, freeText: row.free_text,
        schedule: schedule(row.schedule_payload), createdAt: new Date(String(row.created_at)).toISOString() });
    });
    return Object.freeze({ contractVersion: "guide-lifecycle-workspace/1.0.0" as const, items: Object.freeze(items), authority: Object.freeze({ canWriteMeta: false as const, canExecute: false as const, canDraft: this.can(principal, "guide_lifecycle:draft"), canActivate: this.can(principal, "guide_lifecycle:activate") }) });
  }

  async create(principal: TrustedDecisionRoomPrincipal, request: GuideDraftRequest) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "guide_lifecycle:draft", this.memberships);
    exact(request, ["label", "sliceRef", "market", "freeText", "schedule", "mode", "actionAllowlist", "budgetRefs", "rollbackConditions"]);
    const sliceRef = ref(request.sliceRef, "slice_");
    const binding = rows(await this.database.execute(sql`select s.id::text slice_id,r.id::text slice_revision_id,r.slice_ref,market.id::text market_definition_id,market.key market_key
      from slices s join slice_revisions r on r.workspace_id=s.workspace_id and r.id=s.current_published_revision_id and r.lifecycle='published'
      join category_definitions market on market.workspace_id=r.workspace_id and market.id=r.market_definition_id and market.archived_at is null
      where s.workspace_id=${principal.workspaceId}::uuid and s.slice_ref=${sliceRef} and s.tombstoned_at is null limit 2`));
    if (binding.length !== 1 || binding[0]!.slice_ref !== sliceRef || binding[0]!.market_key !== request.market) throw new GuideLifecycleServiceError(binding.length ? "conflict" : "not_found");
    try {
      const guide = createGuideRevision({ workspaceRef: principal.workspaceRef, guideRef: `guide_${randomBytes(12).toString("hex")}`, revision: 1, previousRevisionHash: null,
        sliceRef, market: request.market, freeText: request.freeText, strict: { budgetRefs: request.budgetRefs, rollbackConditions: request.rollbackConditions, budgetInterpretation: null },
        schedule: request.schedule, mode: request.mode, actionAllowlist: request.actionAllowlist });
      return await this.repository.createDraft({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, role: membership.role, label: request.label,
        guide, sliceId: uuid(binding[0]!.slice_id), sliceRevisionId: uuid(binding[0]!.slice_revision_id), marketDefinitionId: uuid(binding[0]!.market_definition_id), occurredAt: new Date().toISOString() });
    } catch (reason) { return mapError(reason); }
  }

  async mutate(principal: TrustedDecisionRoomPrincipal, request: Readonly<Record<string, unknown>>) {
    exact(request, request.operation === "accept" ? ["operation", "guideId", "revisionId", "interpretationHash"]
      : request.operation === "activate" ? ["operation", "guideId", "revisionId", "expectedHeadVersion", "expectedCurrentRevisionId"]
        : request.operation === "pause" ? ["operation", "guideId", "expectedHeadVersion", "expectedCurrentRevisionId"] : []);
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, request.operation === "accept" ? "guide_lifecycle:draft" : "guide_lifecycle:activate", this.memberships);
    const common = { workspaceId: principal.workspaceId, actorId: principal.actor.userId, role: membership.role, guideId: uuid(request.guideId), occurredAt: new Date().toISOString() } as const;
    try {
      if (request.operation === "accept") return await this.repository.acceptInterpretation({ ...common, revisionId: uuid(request.revisionId), interpretationHash: String(request.interpretationHash) });
      if (request.operation === "activate") return await this.repository.activate({ ...common, revisionId: uuid(request.revisionId), expectedHeadVersion: integer(request.expectedHeadVersion), expectedCurrentRevisionId: request.expectedCurrentRevisionId === null ? null : uuid(request.expectedCurrentRevisionId) });
      if (request.operation === "pause") return await this.repository.pause({ ...common, expectedHeadVersion: integer(request.expectedHeadVersion), expectedCurrentRevisionId: uuid(request.expectedCurrentRevisionId) });
      throw new GuideLifecycleServiceError("invalid_input");
    } catch (reason) { return mapError(reason); }
  }

  private can(principal: TrustedDecisionRoomPrincipal, action: "guide_lifecycle:draft" | "guide_lifecycle:activate") {
    try { authorizeWorkspace(principal.actor, principal.workspaceId, action, this.memberships); return true; } catch { return false; }
  }
}
