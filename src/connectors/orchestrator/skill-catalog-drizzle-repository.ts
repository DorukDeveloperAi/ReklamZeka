import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { catalogHash, newRef, type CatalogItem, type SkillCatalogRepository } from "@/application/skill-catalog-service";
import type { OfficialSourceOption } from "@/application/interview-kit-service";
import * as schema from "@/db/schema";

type DB = NodePgDatabase<typeof schema>;
type Executor = Pick<DB, "execute">;
type TransactionalDB = Pick<DB, "execute" | "transaction">;
const HASH = /^[a-f0-9]{64}$/;
const PLAYBOOK_REF = /^playbook_[a-z0-9][a-z0-9_-]{0,86}$/;

const rows = <T>(value: unknown): readonly T[] => {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) throw new Error("corrupt_store");
  return value.rows as readonly T[];
};
const one = <T>(value: readonly T[], code: string): T => { if (value.length !== 1) throw new Error(code); return value[0]!; };

type Head = Readonly<{ revision: number; playbook_hash: string; source_id: string; state: string; payload: unknown }>;
type Source = Readonly<{ id: string; option_id?: string; title?: string; url?: string }>;
type Inserted = Readonly<{ revision: number }>;

function item(input: Readonly<{ ref: string; revision: number; state: string; title: string; body: string; sourceOptionId: string }>): CatalogItem {
  return Object.freeze({ kind: "playbook", ref: input.ref, revision: input.revision, state: input.state,
    title: input.title, body: input.body, sourceOptionId: input.sourceOptionId });
}

async function source(executor: Executor, workspaceId: string, sourceOptionId: string): Promise<Source> {
  return one(rows<Source>(await executor.execute(sql`
    select id from guidance_sources
    where workspace_id = ${workspaceId}::uuid and id::text = ${sourceOptionId} and source_type = 'official_meta_guidance'
      and status = 'published' and review_by > now() and source_url is not null
    limit 2
  `)), "source_not_found");
}

async function head(executor: Executor, workspaceId: string, playbookRef: string): Promise<Head> {
  const current = one(rows<Head>(await executor.execute(sql`
    select revision, playbook_hash, source_id, state, payload
    from orchestrator_playbook_revisions
    where workspace_id = ${workspaceId}::uuid and playbook_ref = ${playbookRef}
    order by revision desc
    limit 1 for update
  `)), "playbook_not_found");
  if (!Number.isSafeInteger(current.revision) || current.revision < 1 || !HASH.test(current.playbook_hash)
    || current.state !== "active" || !PLAYBOOK_REF.test(playbookRef)) throw new Error("stale_head");
  return current;
}

/** Private, append-only catalog writer; content is user-authored and has no authority semantics. */
export class DrizzleSkillCatalogRepository implements SkillCatalogRepository {
  constructor(private readonly db: TransactionalDB) {}

  async list(workspaceId: string) {
    const profile = rows<CatalogItem>(await this.db.execute(sql`
      select 'profile' kind, profile_ref ref, revision, state
      from orchestrator_profile_revisions
      where workspace_id = ${workspaceId}::uuid and state = 'active'
      order by revision desc limit 1
    `));
    const playbooks = rows<CatalogItem>(await this.db.execute(sql`
      select 'playbook' kind, current.playbook_ref ref, current.revision, current.state,
        current.payload ->> 'title' title, current.payload ->> 'body' body, source.id::text "sourceOptionId",
        source.source_url url, case when source.review_by is null then 'not_scheduled'
          when source.review_by <= now() then 'stale' else 'current' end freshness
      from (
        select distinct on (playbook_ref) playbook_ref, revision, state, source_id, payload
        from orchestrator_playbook_revisions
        where workspace_id = ${workspaceId}::uuid
        order by playbook_ref, revision desc
      ) current
      join guidance_sources source on source.workspace_id = ${workspaceId}::uuid and source.id = current.source_id
      where current.state = 'active'
      order by current.revision desc, current.playbook_ref
    `));
    return Object.freeze([...profile, ...playbooks]);
  }

  async sources(workspaceId: string): Promise<readonly OfficialSourceOption[]> {
    const result = rows<Required<Source>>(await this.db.execute(sql`
      select id::text option_id, title, source_url url
      from (select distinct on (source_key) * from guidance_sources where workspace_id = ${workspaceId}::uuid
        order by source_key, version desc) source
      where source_type = 'official_meta_guidance' and status = 'published' and review_by > now() and source_url is not null
      order by title limit 50
    `));
    return Object.freeze(result.map((source) => Object.freeze({ optionId: source.option_id, title: source.title,
      url: source.url, freshness: "fresh" as const })));
  }

  async appendProfile(input: Readonly<{ workspaceId: string; actorId: string; pack: unknown }>) {
    const payload = { corePack: input.pack };
    return one(rows<CatalogItem>(await this.db.execute(sql`
      insert into orchestrator_profile_revisions(workspace_id, profile_ref, revision, previous_hash, profile_hash, state, payload, created_by_actor_id)
      values(${input.workspaceId}::uuid, 'profile_default', 1, 'GENESIS', ${catalogHash(payload)}, 'active', ${JSON.stringify(payload)}::jsonb, ${input.actorId}::uuid)
      returning 'profile' kind, profile_ref ref, revision, state
    `)), "write_conflict");
  }

  async appendPlaybook(input: Readonly<{ workspaceId: string; actorId: string; title: string; body: string; sourceOptionId: string }>) {
    return this.db.transaction(async (transaction) => {
      const linkedSource = await source(transaction, input.workspaceId, input.sourceOptionId);
      const payload = { title: input.title, body: input.body };
      const ref = newRef();
      const inserted = one(rows<Inserted>(await transaction.execute(sql`
        insert into orchestrator_playbook_revisions(workspace_id, playbook_ref, revision, previous_hash, playbook_hash, state, source_id, payload, created_by_actor_id)
        values(${input.workspaceId}::uuid, ${ref}, 1, 'GENESIS', ${catalogHash(payload)}, 'active', ${linkedSource.id}::uuid, ${JSON.stringify(payload)}::jsonb, ${input.actorId}::uuid)
        returning revision
      `)), "write_conflict");
      return item({ ref, revision: inserted.revision, state: "active", title: input.title, body: input.body, sourceOptionId: input.sourceOptionId });
    });
  }

  async appendPlaybookRevision(input: Readonly<{ workspaceId: string; actorId: string; playbookRef: string; expectedRevision: number; title: string; body: string; sourceOptionId: string }>) {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`playbook:${input.workspaceId}:${input.playbookRef}`}, 0))`);
      const current = await head(transaction, input.workspaceId, input.playbookRef);
      if (current.revision !== input.expectedRevision) throw new Error("stale_head");
      const linkedSource = await source(transaction, input.workspaceId, input.sourceOptionId);
      if (linkedSource.id !== current.source_id) throw new Error("source_mismatch");
      const payload = { title: input.title, body: input.body };
      if (catalogHash(payload) === current.playbook_hash) throw new Error("duplicate_revision");
      const inserted = one(rows<Inserted>(await transaction.execute(sql`
        insert into orchestrator_playbook_revisions(workspace_id, playbook_ref, revision, previous_hash, playbook_hash, state, source_id, payload, created_by_actor_id)
        values(${input.workspaceId}::uuid, ${input.playbookRef}, ${current.revision + 1}, ${current.playbook_hash}, ${catalogHash(payload)}, 'active', ${linkedSource.id}::uuid, ${JSON.stringify(payload)}::jsonb, ${input.actorId}::uuid)
        returning revision
      `)), "write_conflict");
      return item({ ref: input.playbookRef, revision: inserted.revision, state: "active", title: input.title, body: input.body, sourceOptionId: input.sourceOptionId });
    });
  }

  async tombstone(input: Readonly<{ workspaceId: string; actorId: string; ref: string }>) {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`playbook:${input.workspaceId}:${input.ref}`}, 0))`);
      const current = await head(transaction, input.workspaceId, input.ref);
      const inserted = one(rows<Inserted>(await transaction.execute(sql`
        insert into orchestrator_playbook_revisions(workspace_id, playbook_ref, revision, previous_hash, playbook_hash, state, source_id, payload, created_by_actor_id)
        values(${input.workspaceId}::uuid, ${input.ref}, ${current.revision + 1}, ${current.playbook_hash},
          ${catalogHash({ state: "tombstoned", previousHash: current.playbook_hash, payload: current.payload })}, 'tombstoned', ${current.source_id}::uuid, ${JSON.stringify(current.payload)}::jsonb, ${input.actorId}::uuid)
        returning revision
      `)), "write_conflict");
      return Object.freeze({ kind: "playbook" as const, ref: input.ref, revision: inserted.revision, state: "tombstoned" });
    });
  }
}
