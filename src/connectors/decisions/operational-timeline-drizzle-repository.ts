import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { OperationalTimelineEvent, OperationalTimelineRepository } from "@/application/operational-timeline-read-service";
import { verifyBudgetProposal, type BudgetProposal } from "@/application/budget-proposal-service";
import * as schema from "@/db/schema";

type Database = Pick<NodePgDatabase<typeof schema>, "execute">;

type SourceRow = Readonly<{ event_kind: unknown; occurred_at: unknown; one: unknown; two: unknown; three: unknown; four?: unknown }>;
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
    return Object.freeze({ kind, occurredAt, title: "Bütçe önerisi taslağı kaydedildi",
      detail: `Revizyon ${revision} · ${proposal.alternatives.length} senaryo · uygulama yetkisi yok` });
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
  throw new Error("corrupt_store");
}

/** Server-private, capped union over existing append-only ledgers. */
export class DrizzleOperationalTimelineRepository implements OperationalTimelineRepository {
  constructor(private readonly database: Database) {}
  async list(input: Readonly<{ workspaceId: string; limit: number }>): Promise<readonly OperationalTimelineEvent[]> {
    if (!UUID.test(input.workspaceId) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("invalid_input");
    const result = await this.database.execute(sql`
      select event_kind, occurred_at, one, two, three, four from (
        select 'slice_rule_draft'::text as event_kind, drafted_at as occurred_at, market as one,
          lifecycle_state as two, revision::text as three, null::jsonb as four
        from public.slice_rule_workspace_drafts where workspace_id = ${input.workspaceId}::uuid
        union all
        select 'budget_proposal'::text, proposed_at, proposal_hash, series_ref, revision::text, proposal_payload
        from public.budget_proposal_versions where workspace_id = ${input.workspaceId}::uuid
        union all
        select 'delivery_alert'::text, occurred_at, evidence_level, status, sequence::text, null::jsonb
        from public.delivery_health_alert_ledger_records where workspace_id = ${input.workspaceId}::uuid
        union all
        select 'approval_proposed'::text, proposed_at, action_type, risk, initial_state, null::jsonb
        from public.action_proposal_units where workspace_id = ${input.workspaceId}::uuid
        union all
        select 'approval_decision'::text, decided_at, command_kind, reason_code, actor_role, null::jsonb
        from public.action_approval_decision_events where workspace_id = ${input.workspaceId}::uuid
      ) timeline order by occurred_at desc limit ${input.limit}
    `);
    return Object.freeze(rows(result).map(event));
  }
}
