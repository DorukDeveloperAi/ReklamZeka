import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  CORE_SKILL_MANIFESTS,
  WorkspaceSkillCatalogBindingError,
  createWorkspaceSkillCatalogBinding,
  type WorkspacePlaybookSourceCitation,
  type WorkspaceSkillCatalogBinding,
} from "@/domain/orchestrator/skill-catalog";
import { isOfficialGuidanceSourceUrl } from "@/domain/guidance/registry";
import type { WorkspaceSkillCatalogBindingLoader } from "@/application/orchestrator-conversation";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type ProfileRow = Readonly<{ profile_ref: unknown; revision: unknown; profile_hash: unknown; payload: unknown }>;
type PlaybookRow = Readonly<{
  playbook_ref: unknown; revision: unknown; playbook_hash: unknown; payload: unknown;
  source_ref: unknown; source_status: unknown; review_by: Date | string | null;
  source_title: unknown; source_type: unknown; source_url: unknown;
}>;
type KitRow = Readonly<{ kit_ref: unknown; revision: unknown; kit_hash: unknown; payload: unknown; source_snapshot: unknown }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

function unavailable(): never { throw new WorkspaceSkillCatalogBindingError(); }
function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) unavailable();
  return result.rows as readonly T[];
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fresh(value: Date | string | null, evaluatedAt: number) {
  if (value === null) return true;
  const reviewBy = value instanceof Date ? value.valueOf() : Date.parse(value);
  return Number.isFinite(reviewBy) && reviewBy > evaluatedAt;
}
function freshness(value: Date | string | null, evaluatedAt: number): "fresh" | "stale" | "not_scheduled" {
  if (value === null) return "not_scheduled";
  const reviewBy = value instanceof Date ? value.valueOf() : Date.parse(value);
  if (!Number.isFinite(reviewBy)) unavailable();
  return reviewBy > evaluatedAt ? "fresh" : "stale";
}
const SOURCE_TYPES = new Set<WorkspacePlaybookSourceCitation["sourceType"]>(["owner_statement", "official_meta_guidance", "business_strategy", "observed_result", "experiment_outcome", "operating_note"]);
function sourceType(value: unknown): WorkspacePlaybookSourceCitation["sourceType"] {
  if (typeof value !== "string" || !SOURCE_TYPES.has(value as WorkspacePlaybookSourceCitation["sourceType"])) unavailable();
  return value as WorkspacePlaybookSourceCitation["sourceType"];
}
function sourceTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) unavailable();
  return value;
}

/** Server-private loader. It never accepts caller-selected refs or exposes bodies outside the model prompt. */
export class DrizzleWorkspaceSkillCatalogBindingRepository implements WorkspaceSkillCatalogBindingLoader {
  constructor(private readonly database: Executor, private readonly now: () => Date = () => new Date()) {}

  async loadActive(scope: Readonly<{ workspaceId: string }>): Promise<WorkspaceSkillCatalogBinding> {
    if (!UUID.test(scope.workspaceId)) unavailable();
    const profileRows = rows<ProfileRow>(await this.database.execute(sql`
      select profile_ref, revision, profile_hash, payload
      from orchestrator_profile_revisions
      where workspace_id = ${scope.workspaceId}::uuid and state = 'active'
      order by revision desc, profile_ref asc
      limit 2
    `));
    if (profileRows.length !== 1) unavailable();
    const profile = profileRows[0]!;
    if (typeof profile.profile_ref !== "string" || typeof profile.revision !== "number" || !Number.isSafeInteger(profile.revision)
      || typeof profile.profile_hash !== "string" || !HASH.test(profile.profile_hash)
      || !exact(profile.payload, ["corePack"]) || !Array.isArray(profile.payload.corePack)
      || digest(profile.payload) !== profile.profile_hash) unavailable();
    const manifests = profile.payload.corePack.map((candidate) => {
      if (!exact(candidate, ["ref", "version"]) || typeof candidate.ref !== "string" || typeof candidate.version !== "string") unavailable();
      const manifest = CORE_SKILL_MANIFESTS.find((item) => item.ref === candidate.ref && item.version === candidate.version);
      if (!manifest) unavailable();
      return Object.freeze({ ref: manifest.ref, version: manifest.version, hash: manifest.hash });
    });
    const playbookRows = rows<PlaybookRow>(await this.database.execute(sql`
      select current.playbook_ref, current.revision, current.playbook_hash, current.payload,
        source.source_ref, source.status source_status, source.review_by, source.title source_title,
        source.source_type, source.source_url
      from (
        select distinct on (playbook_ref) playbook_ref, revision, playbook_hash, state, source_id, payload
        from orchestrator_playbook_revisions
        where workspace_id = ${scope.workspaceId}::uuid
        order by playbook_ref, revision desc
      ) current
      left join guidance_sources source on source.workspace_id = ${scope.workspaceId}::uuid and source.id = current.source_id
      where current.state = 'active'
      order by current.playbook_ref asc
      limit 13
    `));
    const evaluatedAt = this.now().valueOf();
    if (!Number.isFinite(evaluatedAt)) unavailable();
    const playbooks = playbookRows.map((playbook) => {
      const evaluatedFreshness = freshness(playbook.review_by, evaluatedAt);
      if (typeof playbook.playbook_ref !== "string" || typeof playbook.revision !== "number" || !Number.isSafeInteger(playbook.revision)
        || typeof playbook.playbook_hash !== "string" || !HASH.test(playbook.playbook_hash)
        || typeof playbook.source_ref !== "string" || playbook.source_status !== "published" || !fresh(playbook.review_by, evaluatedAt)
        || !exact(playbook.payload, ["title", "body"]) || typeof playbook.payload.title !== "string"
        || typeof playbook.payload.body !== "string" || digest(playbook.payload) !== playbook.playbook_hash) unavailable();
      const title = sourceTitle(playbook.source_title); const type = sourceType(playbook.source_type);
      const sourceUrl = type === "official_meta_guidance" && typeof playbook.source_url === "string"
        && isOfficialGuidanceSourceUrl(playbook.source_url) ? playbook.source_url : null;
      return Object.freeze({ playbookRef: playbook.playbook_ref, revision: playbook.revision,
        playbookHash: playbook.playbook_hash, sourceRef: playbook.source_ref,
        citation: Object.freeze({ sourceTitle: title, sourceType: type, sourceUrl, freshness: evaluatedFreshness }),
        title: playbook.payload.title, body: playbook.payload.body });
    });
    const kitRows = rows<KitRow>(await this.database.execute(sql`
      select current.kit_ref,current.revision,current.kit_hash,current.payload,current.source_snapshot
      from (select distinct on(kit_ref) kit_ref,revision,kit_hash,state,payload,source_snapshot from orchestrator_interview_kit_revisions
        where workspace_id=${scope.workspaceId}::uuid order by kit_ref,revision desc) current where current.state='active' order by current.kit_ref limit 13
    `));
    const interviewKits = kitRows.map((kit) => {
      if (typeof kit.kit_ref !== "string" || typeof kit.revision !== "number" || typeof kit.kit_hash !== "string" || !HASH.test(kit.kit_hash)
        || !exact(kit.payload,["name","explanation","questions","applicability"]) || typeof kit.payload.name !== "string" || typeof kit.payload.explanation !== "string"
        || !Array.isArray(kit.payload.questions) || !exact(kit.payload.applicability,["pages","intents"]) || !Array.isArray(kit.payload.applicability.pages) || !Array.isArray(kit.payload.applicability.intents)
        || !exact(kit.source_snapshot,["optionId","title","url","version","recordHash","reviewBy"]) || typeof kit.source_snapshot.title !== "string" || typeof kit.source_snapshot.url !== "string" || !isOfficialGuidanceSourceUrl(kit.source_snapshot.url)
        || typeof kit.source_snapshot.version !== "number" || typeof kit.source_snapshot.recordHash !== "string" || !HASH.test(kit.source_snapshot.recordHash) || typeof kit.source_snapshot.reviewBy !== "string" || Date.parse(kit.source_snapshot.reviewBy) <= evaluatedAt) unavailable();
      return Object.freeze({kitRef:kit.kit_ref,revision:kit.revision,kitHash:kit.kit_hash,name:kit.payload.name,explanation:kit.payload.explanation,questions:Object.freeze(kit.payload.questions as string[]),pages:Object.freeze(kit.payload.applicability.pages as string[]),intents:Object.freeze(kit.payload.applicability.intents as string[]),source:Object.freeze({title:kit.source_snapshot.title,url:kit.source_snapshot.url,version:kit.source_snapshot.version,recordHash:kit.source_snapshot.recordHash,reviewBy:kit.source_snapshot.reviewBy})});
    });
    return createWorkspaceSkillCatalogBinding({ profile: { profileRef: profile.profile_ref,
      revision: profile.revision, profileHash: profile.profile_hash }, manifests, playbooks, interviewKits });
  }
}
