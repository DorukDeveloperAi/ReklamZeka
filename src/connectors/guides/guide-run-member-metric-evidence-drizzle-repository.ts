import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  DrizzleOperationReadRepository,
  type OperationReadTransaction,
} from "@/connectors/operations/operation-read-drizzle-repository";
import * as schema from "@/db/schema";
import { guideRunMembershipEvidenceHash } from "@/domain/guides/guide-run-membership-evidence";
import { metaPublicReference } from "@/domain/meta/public-reference";
import type {
  GuideRunMemberMetricEvidence,
  GuideRunMemberMetricEvidencePort,
} from "@/server/guide-run-codex-agent-adapter";

type Database = NodePgDatabase<typeof schema>;
type Row = Record<string, unknown>;
const MAX_METRICS = 1_024;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const stable = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, stable(x)]),
        )
      : v;
const digest = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(stable(v)))
    .digest("hex");
const day = (v: Date) => v.toISOString().slice(0, 10);
function text(row: Row, key: string) {
  const value = row[key];
  if (typeof value !== "string" || !value)
    throw new Error("guide run metric evidence corrupt");
  return value;
}

/** Re-authenticates the immutable frozen member against the exact current
 * Slice revision before returning bounded, public-reference-only metrics. */
export class DrizzleGuideRunMemberMetricEvidenceRepository implements GuideRunMemberMetricEvidencePort {
  constructor(private readonly database: Pick<Database, "transaction">) {}
  async load(
    input: Parameters<GuideRunMemberMetricEvidencePort["load"]>[0],
  ): Promise<GuideRunMemberMetricEvidence> {
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`set local transaction isolation level repeatable read`,
      );
      await tx.execute(sql`set local transaction read only`);
      const stored =
        await tx.execute(sql`select r.workspace_id::text workspace_id,r.created_at::text created_at,r.trigger_payload,gr.slice_ref,gr.free_text,gr.mode,
        array(select x.action from guide_revision_actions x where x.workspace_id=gr.workspace_id and x.guide_revision_id=gr.id order by x.action) action_allowlist,a.payload scope_payload
        from guide_runs r join guide_revisions gr on gr.workspace_id=r.workspace_id and gr.id=r.guide_revision_id and gr.guide_id=r.guide_id
        join guide_heads gh on gh.workspace_id=r.workspace_id and gh.guide_id=r.guide_id and gh.current_active_revision_id=r.guide_revision_id
        join guides g on g.workspace_id=r.workspace_id and g.id=r.guide_id and g.tombstoned_at is null join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active'
        join guide_run_artifacts a on a.workspace_id=r.workspace_id and a.run_id=r.id and a.kind='scope_snapshot'
        where r.run_ref=${input.runRef} and r.guide_revision_hash=${input.guideRevisionHash} limit 2`);
      const rows = stored.rows as Row[],
        row = rows[0];
      if (rows.length !== 1 || !row)
        throw new Error("guide run metric evidence unavailable");
      const scope = row.scope_payload as Record<string, unknown>,
        members = scope?.members;
      if (
        scope?.sliceSnapshotHash !== input.sliceSnapshotHash ||
        !Array.isArray(members) ||
        members.filter(
          (member) =>
            member &&
            typeof member === "object" &&
            (member as Row).memberRef === input.member.memberRef &&
            (member as Row).membershipHash === input.member.membershipHash,
        ).length !== 1
      )
        throw new Error("guide run metric evidence unavailable");
      const workspaceId = text(row, "workspace_id"),
        sliceRef = text(row, "slice_ref");
      const actions = row.action_allowlist;
      if (
        !Array.isArray(actions) ||
        actions.some((action) => typeof action !== "string") ||
        actions.length > 7
      )
        throw new Error("guide run metric evidence corrupt");
      const mode = text(row, "mode");
      if (
        ![
          "observe_analyze",
          "recommend",
          "prepare_human_approval",
          "limited_autonomy",
        ].includes(mode)
      )
        throw new Error("guide run metric evidence corrupt");
      const guide = Object.freeze({
        freeText: text(row, "free_text"),
        mode: mode as GuideRunMemberMetricEvidence["guide"]["mode"],
        actionAllowlist: Object.freeze(actions as string[]),
      });
      const operation = new DrizzleOperationReadRepository({
        transaction: async (
          work: (inner: OperationReadTransaction) => Promise<unknown>,
        ) => work(tx as OperationReadTransaction),
      } as never);
      const current = await operation.currentSliceEvidenceInTransaction(
        tx as OperationReadTransaction,
        workspaceId,
        sliceRef,
      );
      const membership = current.resolution?.included.filter(
        (item) => item.entityRef === input.member.memberRef,
      );
      if (
        current.definitionHash !== scope.sliceDefinitionHash ||
        !current.revisionRef ||
        membership?.length !== 1 ||
        guideRunMembershipEvidenceHash({
          sliceRef,
          revisionRef: current.revisionRef,
          definitionHash: current.definitionHash!,
          membership: membership[0]!,
        }) !== input.member.membershipHash
      )
        throw new Error("guide run metric evidence unavailable");
      const level = membership[0]!.entityLevel,
        ids =
          level === "campaign"
            ? current.campaignIds
            : level === "ad_set"
              ? current.adSetIds
              : [];
      const kind = level === "campaign" ? "campaign" : "ad_set";
      const matches = ids.filter(
        (id) =>
          metaPublicReference(kind, workspaceId, id) === input.member.memberRef,
      );
      const trigger = row.trigger_payload as Row,
        anchorValue =
          trigger?.kind === "scheduled" &&
          typeof trigger.scheduledFor === "string"
            ? trigger.scheduledFor
            : text(row, "created_at");
      const anchor = new Date(anchorValue);
      if (!Number.isFinite(anchor.getTime()))
        throw new Error("guide run metric evidence corrupt");
      const end = new Date(
          Date.UTC(
            anchor.getUTCFullYear(),
            anchor.getUTCMonth(),
            anchor.getUTCDate() - 1,
          ),
        ),
        start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 13);
      const period = Object.freeze({
        startDate: day(start),
        endDate: day(end),
      });
      let metrics: GuideRunMemberMetricEvidence["metrics"] = Object.freeze([]);
      if (
        matches.length === 1 &&
        (level === "campaign" || level === "ad_set")
      ) {
        const external = await tx.execute(
          level === "campaign"
            ? sql`select external_campaign_id external_id from ad_campaigns where workspace_id=${workspaceId}::uuid and id=${matches[0]}::uuid and disappeared_at is null limit 2`
            : sql`select external_ad_set_id external_id from meta_ad_sets where workspace_id=${workspaceId}::uuid and id=${matches[0]}::uuid and disappeared_at is null limit 2`,
        );
        const externalRows = external.rows as Row[];
        if (externalRows.length !== 1)
          throw new Error("guide run metric evidence unavailable");
        const result = await tx.execute(sql`select i.date_start::text date,
          case when octet_length(i.attribution_label)<=640 then i.attribution_label else '' end attribution,
          case when octet_length(m.metric_key)<=324 then m.metric_key else '' end metric_key,
          case when m.action_type is null or octet_length(m.action_type)<=324 then m.action_type else 'INVALID' end action_type,
          case when m.value_decimal is null or octet_length(m.value_decimal::text)<=128 then m.value_decimal::text else 'INVALID' end value_decimal,
          case when m.value_minor is null or octet_length(m.value_minor::text)<=128 then m.value_minor::text else 'INVALID' end value_minor,
          case when m.currency is null or octet_length(m.currency)<=3 then m.currency else 'INVALID' end currency,
          case when m.availability->>'state'='available' then 'available' else 'unavailable' end availability
          from meta_daily_insights i join meta_daily_insight_metrics m on m.daily_insight_id=i.id where i.workspace_id=${workspaceId}::uuid and i.entity_level=${level}::meta_insight_entity_level and i.external_entity_id=${text(externalRows[0]!, "external_id")} and i.date_start>=${period.startDate}::date and i.date_stop<=${period.endDate}::date order by i.date_start,i.attribution_label,m.metric_key,m.action_type,m.id limit ${MAX_METRICS + 1}`);
        const metricRows = result.rows as Row[];
        if (metricRows.length > MAX_METRICS)
          throw new Error("guide run metric evidence unavailable");
        metrics = Object.freeze(
          metricRows.map((item) => {
            const valueDecimal =
                item.value_decimal === null
                  ? null
                  : text(item, "value_decimal"),
              valueMinor =
                item.value_minor === null ? null : text(item, "value_minor");
            if (
              (valueDecimal !== null && !DECIMAL.test(valueDecimal)) ||
              (valueMinor !== null && !DECIMAL.test(valueMinor)) ||
              (item.availability !== "available" &&
                item.availability !== "unavailable")
            )
              throw new Error("guide run metric evidence corrupt");
            return Object.freeze({
              date: text(item, "date"),
              attribution: text(item, "attribution"),
              metricKey: text(item, "metric_key"),
              actionType:
                typeof item.action_type === "string" && item.action_type
                  ? item.action_type
                  : null,
              valueDecimal,
              valueMinor,
              currency:
                typeof item.currency === "string" && item.currency
                  ? item.currency
                  : null,
              availability: item.availability as "available" | "unavailable",
            });
          }),
        );
      }
      const observedDays = new Set(metrics.map((metric) => metric.date));
      const sourceState: GuideRunMemberMetricEvidence["sourceState"] =
        metrics.length === 0
          ? "unavailable"
          : metrics.some((metric) => metric.availability === "unavailable") ||
              observedDays.size !== 14
            ? "partial"
            : "ready";
      const core = {
        version: "guide-run-member-metrics/1.0.0" as const,
        runRef: input.runRef,
        guideRevisionHash: input.guideRevisionHash,
        sliceSnapshotHash: input.sliceSnapshotHash,
        member: input.member,
        guide,
        period,
        sourceState,
        metrics,
      };
      return Object.freeze({ ...core, evidenceHash: digest(core) });
    });
  }
}
