import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { GuideRunTrustedDataHealthPort } from "@/application/guide-run-orchestration-service";
import * as schema from "@/db/schema";
import { DrizzleMetaDataHealthAdapter } from "@/connectors/meta/data-health-drizzle-adapter";
import { organizationCampaignPublicRef } from "@/domain/campaigns/organization-campaign";
import { metaPublicReference } from "@/domain/meta/public-reference";
import { canonicalGuideWorkspaceRef } from "@/domain/guides/guide-revision";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Row = Readonly<Record<string, unknown>>;
type HealthPort = Pick<DrizzleMetaDataHealthAdapter, "evaluate">;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_ENTITIES = 20_000;

export class GuideRunTrustedDataHealthError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "corrupt_store") {
    super(`guide run data health rejected: ${code}`);
    this.name = "GuideRunTrustedDataHealthError";
  }
}
function fail(code: GuideRunTrustedDataHealthError["code"]): never {
  throw new GuideRunTrustedDataHealthError(code);
}
function rows(value: unknown): readonly Row[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("rows" in value) ||
    !Array.isArray(value.rows)
  )
    fail("corrupt_store");
  return value.rows as readonly Row[];
}
function exact(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail("corrupt_store");
}
function stable(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => [key, stable(child)]),
        )
      : value;
}
function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

/**
 * Server-owned run health boundary. It derives tenant/accounts exclusively
 * from the immutable run + frozen-scope artifact and evaluates the current
 * canonical Meta mirror in the same RR/read-only transaction.
 */
export class DrizzleGuideRunTrustedDataHealthRepository implements GuideRunTrustedDataHealthPort {
  constructor(
    private readonly database: Pick<Database, "transaction">,
    private readonly healthForTransaction: (tx: Transaction) => HealthPort = (
      tx,
    ) => new DrizzleMetaDataHealthAdapter(tx as never),
  ) {}

  async resolve(
    input: Parameters<GuideRunTrustedDataHealthPort["resolve"]>[0],
  ) {
    if (
      !input ||
      typeof input !== "object" ||
      Object.keys(input).length !== 5 ||
      !REF.test(input.runRef) ||
      !REF.test(input.workspaceRef) ||
      !HASH.test(input.guideRevisionHash) ||
      !REF.test(input.sliceRef) ||
      !HASH.test(input.sliceSnapshotHash)
    )
      fail("invalid_input");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read`);
      await tx.execute(sql`set transaction read only`);
      const target = rows(
        await tx.execute(sql`select r.workspace_id::text workspace_id,a.payload,transaction_timestamp()::text evaluated_at
        from guide_runs r join guide_run_heads h on h.workspace_id=r.workspace_id and h.run_id=r.id
        join guide_heads gh on gh.workspace_id=r.workspace_id and gh.guide_id=r.guide_id and gh.current_active_revision_id=r.guide_revision_id
        join guides g on g.workspace_id=r.workspace_id and g.id=r.guide_id and g.tombstoned_at is null
        join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active'
        join guide_run_artifacts a on a.workspace_id=r.workspace_id and a.run_id=r.id and a.kind='scope_snapshot'
        where r.run_ref=${input.runRef} and r.guide_revision_hash=${input.guideRevisionHash} and h.run_payload->>'workspaceRef'=${input.workspaceRef} limit 2`),
      );
      if (target.length !== 1)
        fail(target.length ? "corrupt_store" : "not_found");
      const row = target[0]!;
      if (
        typeof row.workspace_id !== "string" ||
        !UUID.test(row.workspace_id) ||
        canonicalGuideWorkspaceRef(row.workspace_id) !== input.workspaceRef ||
        typeof row.evaluated_at !== "string"
      )
        fail("corrupt_store");
      exact(row.payload, [
        "runRef",
        "guideRevisionHash",
        "sliceRef",
        "sliceDefinitionHash",
        "sliceSnapshotHash",
        "members",
      ]);
      if (
        row.payload.runRef !== input.runRef ||
        row.payload.guideRevisionHash !== input.guideRevisionHash ||
        row.payload.sliceRef !== input.sliceRef ||
        row.payload.sliceSnapshotHash !== input.sliceSnapshotHash ||
        !Array.isArray(row.payload.members) ||
        row.payload.members.length > 10_000
      )
        fail("corrupt_store");
      const memberRefs = row.payload.members.map((member) => {
        exact(member, ["memberRef", "membershipHash"]);
        if (
          typeof member.memberRef !== "string" ||
          !REF.test(member.memberRef) ||
          typeof member.membershipHash !== "string" ||
          !HASH.test(member.membershipHash)
        )
          fail("corrupt_store");
        return member.memberRef;
      });
      if (new Set(memberRefs).size !== memberRefs.length) fail("corrupt_store");
      const entities = rows(
        await tx.execute(sql`select c.id::text campaign_id,c.ad_account_id::text account_id,s.id::text ad_set_id,o.id::text organization_campaign_id
        from ad_campaigns c left join meta_ad_sets s on s.workspace_id=c.workspace_id and s.campaign_id=c.id and s.disappeared_at is null
        left join organization_campaign_meta_memberships m on m.workspace_id=c.workspace_id and m.campaign_id=c.id and m.effective_from<=transaction_timestamp() and (m.effective_to is null or m.effective_to>transaction_timestamp())
        left join organization_campaigns o on o.workspace_id=m.workspace_id and o.id=m.organization_campaign_id and o.tombstoned_at is null
        where c.workspace_id=${row.workspace_id}::uuid and c.disappeared_at is null order by c.id,s.id limit ${MAX_ENTITIES + 1}`),
      );
      if (entities.length > MAX_ENTITIES) fail("corrupt_store");
      const accountByMember = new Map<string, Set<string>>();
      const bind = (memberRef: string, accountId: string) => {
        const found = accountByMember.get(memberRef) ?? new Set<string>();
        found.add(accountId);
        accountByMember.set(memberRef, found);
      };
      for (const entity of entities) {
        if (
          typeof entity.campaign_id !== "string" ||
          !UUID.test(entity.campaign_id) ||
          typeof entity.account_id !== "string" ||
          !UUID.test(entity.account_id)
        )
          fail("corrupt_store");
        bind(
          metaPublicReference("campaign", row.workspace_id, entity.campaign_id),
          entity.account_id,
        );
        if (typeof entity.ad_set_id === "string" && UUID.test(entity.ad_set_id))
          bind(
            metaPublicReference("ad_set", row.workspace_id, entity.ad_set_id),
            entity.account_id,
          );
        if (
          typeof entity.organization_campaign_id === "string" &&
          UUID.test(entity.organization_campaign_id)
        )
          bind(
            organizationCampaignPublicRef(
              row.workspace_id,
              entity.organization_campaign_id,
            ),
            entity.account_id,
          );
      }
      const unmatched = memberRefs.filter(
        (memberRef) => !accountByMember.has(memberRef),
      );
      const accountIds = [
        ...new Set(
          memberRefs.flatMap((memberRef) => [
            ...(accountByMember.get(memberRef) ?? []),
          ]),
        ),
      ].sort();
      const evaluatedAt = new Date(row.evaluated_at).toISOString();
      if (accountIds.length === 0)
        return Object.freeze({
          dataQuality: "missing" as const,
          evidenceHash: digest({
            version: "guide-run-data-health/1.0.0",
            ...input,
            evaluatedAt,
            accountRefs: [],
            unmatched,
          }),
        });
      const evaluated = await this.healthForTransaction(tx).evaluate({
        workspaceId: row.workspace_id,
        targetAdAccountId: accountIds[0]!,
        evaluatedAt,
      });
      const accountRefs = accountIds
        .map((id) =>
          metaPublicReference("account", row.workspace_id as string, id),
        )
        .sort();
      const selected = evaluated.report.accounts.filter((account) =>
        accountRefs.includes(account.accountRef),
      );
      if (selected.length !== accountRefs.length) fail("corrupt_store");
      const stale = selected.some((account) =>
        account.reasonCodes.includes("source_stale"),
      );
      const ready =
        unmatched.length === 0 &&
        evaluated.report.workspaceCurrency !== null &&
        selected.every(
          (account) =>
            account.state === "ready" && account.monetaryAggregationIncluded,
        );
      return Object.freeze({
        dataQuality: ready
          ? ("ready" as const)
          : stale
            ? ("stale" as const)
            : ("missing" as const),
        evidenceHash: digest({
          version: "guide-run-data-health/1.0.0",
          ...input,
          evaluatedAt,
          accountRefs,
          unmatched,
          reportHash: evaluated.report.reportHash,
        }),
      });
    });
  }
}
