import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  CORE_SKILL_MANIFESTS,
  WorkspaceSkillCatalogBindingError,
  createWorkspaceSkillCatalogBinding,
  type WorkspaceSkillCatalogBinding,
} from "@/domain/orchestrator/skill-catalog";
import type { WorkspaceSkillCatalogBindingLoader } from "@/application/orchestrator-conversation";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type ProfileRow = Readonly<{ profile_ref: unknown; revision: unknown; profile_hash: unknown; payload: unknown }>;
type PlaybookRow = Readonly<{
  playbook_ref: unknown; revision: unknown; playbook_hash: unknown; payload: unknown;
  source_ref: unknown; source_status: unknown; review_by: Date | string | null;
}>;

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
function fresh(value: Date | string | null) {
  if (value === null) return true;
  const reviewBy = value instanceof Date ? value.valueOf() : Date.parse(value);
  return Number.isFinite(reviewBy) && reviewBy > Date.now();
}

/** Server-private loader. It never accepts caller-selected refs or exposes bodies outside the model prompt. */
export class DrizzleWorkspaceSkillCatalogBindingRepository implements WorkspaceSkillCatalogBindingLoader {
  constructor(private readonly database: Executor) {}

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
        source.source_ref, source.status source_status, source.review_by
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
    const playbooks = playbookRows.map((playbook) => {
      if (typeof playbook.playbook_ref !== "string" || typeof playbook.revision !== "number" || !Number.isSafeInteger(playbook.revision)
        || typeof playbook.playbook_hash !== "string" || !HASH.test(playbook.playbook_hash)
        || typeof playbook.source_ref !== "string" || playbook.source_status !== "published" || !fresh(playbook.review_by)
        || !exact(playbook.payload, ["title", "body"]) || typeof playbook.payload.title !== "string"
        || typeof playbook.payload.body !== "string" || digest(playbook.payload) !== playbook.playbook_hash) unavailable();
      return Object.freeze({ playbookRef: playbook.playbook_ref, revision: playbook.revision,
        playbookHash: playbook.playbook_hash, sourceRef: playbook.source_ref,
        title: playbook.payload.title, body: playbook.payload.body });
    });
    return createWorkspaceSkillCatalogBinding({ profile: { profileRef: profile.profile_ref,
      revision: profile.revision, profileHash: profile.profile_hash }, manifests, playbooks });
  }
}
