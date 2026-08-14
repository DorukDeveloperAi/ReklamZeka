import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { OperationalTimelineEvent, OperationalTimelineRepository } from "@/application/operational-timeline-read-service";
import { verifyBudgetProposal, type BudgetProposal } from "@/application/budget-proposal-service";
import * as schema from "@/db/schema";

type Database = Pick<NodePgDatabase<typeof schema>, "execute">;

type SourceRow = Readonly<{ event_kind: unknown; occurred_at: unknown; one: unknown; two: unknown; three: unknown; four?: unknown; five?: unknown }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rows(value: unknown): readonly SourceRow[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) throw new Error("corrupt_store");
  return value.rows as readonly SourceRow[];
}
function text(value: unknown, maximum = 128): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) throw new Error("corrupt_store");
  return value;
}
function at(value: unknown): string {
  const result = value instanceof Date ? value.toISOString() : value;
  if (typeof result !== "string" || !Number.isFinite(Date.parse(result))) throw new Error("corrupt_store");
  return new Date(result).toISOString();
}
function event(row: SourceRow): OperationalTimelineEvent {
  const kind = text(row.event_kind, 40) as OperationalTimelineEvent["kind"];
  const occurredAt = at(row.occurred_at);
  if (kind === "slice_rule_draft") {
    const market = text(row.one, 16); const revision = Number(row.three);
    if (!Number.isInteger(revision) || revision < 1 || !["domestic", "international"].includes(market)) throw new Error("corrupt_store");
    return Object.freeze({ kind, occurredAt, title: "Slice rule taslağı kaydedildi",
      detail: `${market === "domestic" ? "Yerli" : "Yabancı"} kapsam · revizyon ${revision}` });
  }
  if (kind === "budget_proposal") {
    const proposalHash = text(row.one, 64); const revision = Number(row.three);
    const proposal = row.four as BudgetProposal;
    if (!/^[a-f0-9]{64}$/.test(proposalHash) || !Number.isInteger(revision) || revision < 1
      || !proposal || !verifyBudgetProposal(proposal) || proposal.proposalHash !== proposalHash
      || proposal.revision !== revision || typeof row.two !== "string" || proposal.seriesRef !== row.two) {
      throw new Error("corrupt_store");
    }
    if (row.five !== null && row.five !== undefined && row.five !== "rule_linked") throw new Error("corrupt_store");
    return Object.freeze({ kind, occurredAt, title: "Bütçe önerisi taslağı kaydedildi",
      detail: `Revizyon ${revision} · ${proposal.alternatives.length} senaryo${row.five === "rule_linked"
        ? " · exact kural kaynağı bağlı" : ""} · uygulama yetkisi yok` });
  }
  if (kind === "delivery_alert") {
    const level = text(row.one, 16); const status = text(row.two, 24);
    if (!["confirmed", "suspected"].includes(level) || !["open", "investigating", "resolved"].includes(status)) throw new Error("corrupt_store");
    return Object.freeze({ kind, occurredAt, title: level === "confirmed" ? "Doğrulanmış delivery/payment alarmı" : "Şüpheli teslimat kesintisi",
      detail: `Alarm durumu: ${status === "open" ? "açık" : status === "investigating" ? "inceleniyor" : "çözüldü"}` });
  }
  if (kind === "approval_proposed") {
    const action = text(row.one, 32); const risk = text(row.two, 4);
    if (!["status_pause", "status_activate", "budget_decrease", "budget_increase"].includes(action) || !/^K[0-4]$/.test(risk)) throw new Error("corrupt_store");
    return Object.freeze({ kind, occurredAt, title: "İnsan onayı için hareket adayı oluşturuldu", detail: `${action.replaceAll("_", " ")} · ${risk}` });
  }
  if (kind === "approval_decision") {
    const decision = text(row.one, 32); const reason = text(row.two, 128);
    if (!["approve", "reject", "request_changes"].includes(decision) || !/^[a-z][a-z0-9_.:-]{0,127}$/.test(reason)) throw new Error("corrupt_store");
    return Object.freeze({ kind, occurredAt, title: "İnsan kararı kaydedildi", detail: `${decision.replaceAll("_", " ")} · ${reason.replaceAll("_", " ")}` });
  }
  if (kind === "temporal_evaluation") {
    const outcome = text(row.one, 24); const reason = text(row.two, 48);
    if (!["recommendation", "no_change"].includes(outcome) || !["window_ready", "window_unsettled", "window_too_short", "open_delivery_alert"].includes(reason)) throw new Error("corrupt_store");
    return Object.freeze({ kind, occurredAt, title: "Zamansal kural değerlendirmesi kaydedildi",
      detail: `${outcome === "recommendation" ? "Öneri üretildi" : "Değişiklik önerilmedi"} · ${reason.replaceAll("_", " ")} · uygulama yetkisi yok` });
  }
  throw new Error("corrupt_store");
}

/** Server-private, capped union over existing append-only ledgers. */
export class DrizzleOperationalTimelineRepository implements OperationalTimelineRepository {
  constructor(private readonly database: Database) {}
  async list(input: Readonly<{ workspaceId: string; limit: number; campaignRef?: string }>): Promise<readonly OperationalTimelineEvent[]> {
    if (!UUID.test(input.workspaceId) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100
      || input.campaignRef !== undefined && !/^ref_[a-f0-9]{12}$/.test(input.campaignRef)) throw new Error("invalid_input");
    const result = await this.database.execute(sql`
      with scoped_campaign as (
        select campaign.id as campaign_id from public.ad_campaigns campaign
        where campaign.workspace_id = ${input.workspaceId}::uuid
          and ${input.campaignRef ?? null}::text is not null
          and concat('ref_', substring(encode(digest(campaign.external_campaign_id, 'sha256'), 'hex') from 1 for 12)) = ${input.campaignRef ?? null}
      ), exact_campaign as (
        /* A hash-alias collision or duplicate source is never guessed. */
        select campaign_id from scoped_campaign where (select count(*) from scoped_campaign) = 1
      )
      select event_kind, occurred_at, one, two, three, four, five from (
        select 'slice_rule_draft'::text as event_kind, drafted_at as occurred_at, market as one,
          lifecycle_state as two, revision::text as three, null::jsonb as four, null::text as five
        from public.slice_rule_workspace_drafts where workspace_id = ${input.workspaceId}::uuid
          /* Slice drafts are intentionally workspace-scoped; they have no exact campaign evidence. */
          and ${input.campaignRef ?? null}::text is null
        union all
        select 'budget_proposal'::text, proposal.proposed_at, proposal.proposal_hash, proposal.series_ref,
          proposal.revision::text, proposal.proposal_payload,
          case when exists (
            select 1 from public.slice_rule_budget_proposal_bindings binding
            where binding.workspace_id = proposal.workspace_id and binding.proposal_hash = proposal.proposal_hash
          ) then 'rule_linked' else null end
        from public.budget_proposal_versions proposal
        join public.effective_campaign_contexts context on context.workspace_id = proposal.workspace_id
          and context.id = proposal.context_id and context.campaign_id = proposal.campaign_id
        where proposal.workspace_id = ${input.workspaceId}::uuid
          and (${input.campaignRef ?? null}::text is null or proposal.campaign_id = (select campaign_id from exact_campaign))
        union all
        select 'delivery_alert'::text, occurred_at, evidence_level, status, sequence::text, null::jsonb, null::text
        from public.delivery_health_alert_ledger_records where workspace_id = ${input.workspaceId}::uuid
          /* Account-only alarms must not be attributed to an arbitrary campaign. */
          and ${input.campaignRef ?? null}::text is null
        union all
        select 'approval_proposed'::text, proposed_at, action_type, risk, initial_state, null::jsonb, null::text
        from public.action_proposal_units unit where workspace_id = ${input.workspaceId}::uuid
          and (${input.campaignRef ?? null}::text is null or unit.campaign_id = (select campaign_id from exact_campaign)
            or exists (select 1 from public.meta_ad_sets ad_set where ad_set.workspace_id = unit.workspace_id and ad_set.id = unit.ad_set_id and ad_set.campaign_id = (select campaign_id from exact_campaign))
            or exists (select 1 from public.meta_ads ad where ad.workspace_id = unit.workspace_id and ad.id = unit.ad_id and ad.campaign_id = (select campaign_id from exact_campaign)))
        union all
        select 'approval_decision'::text, decided_at, command_kind, reason_code, actor_role, null::jsonb, null::text
        from public.action_approval_decision_events decision
        join public.action_proposal_units unit on unit.workspace_id = decision.workspace_id and unit.id = decision.unit_id
        where decision.workspace_id = ${input.workspaceId}::uuid
          and (${input.campaignRef ?? null}::text is null or unit.campaign_id = (select campaign_id from exact_campaign)
            or exists (select 1 from public.meta_ad_sets ad_set where ad_set.workspace_id = unit.workspace_id and ad_set.id = unit.ad_set_id and ad_set.campaign_id = (select campaign_id from exact_campaign))
            or exists (select 1 from public.meta_ads ad where ad.workspace_id = unit.workspace_id and ad.id = unit.ad_id and ad.campaign_id = (select campaign_id from exact_campaign)))
        union all
        select 'temporal_evaluation'::text, analysis.occurred_at,
          case when decision.disposition = 'act' then 'recommendation' else 'no_change' end,
          substring(decision.cadence_result_ref from '^temporal:(.+)$'), null::text, null::jsonb, null::text
        from public.decision_ledger_records analysis
        join public.effective_campaign_contexts context on context.workspace_id = analysis.workspace_id and context.id = analysis.effective_context_id
        join public.decision_ledger_records decision on decision.workspace_id = analysis.workspace_id
          and decision.analysis_record_ref = analysis.record_id
        where analysis.workspace_id = ${input.workspaceId}::uuid
          and analysis.record_type = 'analysis' and analysis.analysis_definition_ref = 'temporal-recommendation'
          and decision.record_type = 'decision' and decision.cadence_result_ref like 'temporal:%'
          and (${input.campaignRef ?? null}::text is null or context.campaign_id = (select campaign_id from exact_campaign))
      ) timeline order by occurred_at desc limit ${input.limit}
    `);
    return Object.freeze(rows(result).map(event));
  }
}
