import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";

type Database = Pick<NodePgDatabase<typeof schema>, "execute">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const UNIT_REF = /^action_unit_[a-f0-9]{20}$/;
const CODE = /^[a-z][a-z0-9_.:-]{0,127}$/;

export const SLICE_RULE_DECISION_TRACE_VERSION = "slice-rule-decision-trace/1.0.0" as const;

export type SliceRuleDecisionTraceItem = Readonly<{
  ruleSeriesRef: string;
  ruleRevision: number;
  selectionRef: string;
  selectedAt: string;
  actionUnit: Readonly<{ presence: boolean; status: "not_materialized" | "awaiting_approval" | "approved" | "rejected" | "deferred" | "changes_requested" }>;
  decisionHistory: readonly Readonly<{ decision: "proposed" | "approved" | "rejected" | "deferred" | "changes_requested"; occurredAt: string; reasonCode: string | null }>[];
  execution: Readonly<{ safetyState: "server_disabled"; closure: "not_admitted" | "admission_closed" }>;
}>;

type SourceRow = Readonly<{
  rule_series_ref: unknown;
  rule_revision: unknown;
  selection_id: unknown;
  selection_evidence_hash: unknown;
  selected_at: unknown;
  binding_id: unknown;
  action_proposal_unit_id: unknown;
  action_unit_id: unknown;
  bundle_id: unknown;
  unit_ref: unknown;
  proposed_at: unknown;
  decision_events: unknown;
  execution_attempt_count: unknown;
  execution_safe_count: unknown;
}>;

function resultRows(value: unknown): readonly SourceRow[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new Error("corrupt_store");
  }
  return value.rows as readonly SourceRow[];
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

function instant(value: unknown): string | null {
  const candidate = value instanceof Date ? value.toISOString() : value;
  if (typeof candidate !== "string" || !Number.isFinite(Date.parse(candidate))) return null;
  return new Date(candidate).toISOString();
}

function count(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function decisionHistory(value: unknown, proposedAt: string): readonly SliceRuleDecisionTraceItem["decisionHistory"][number][] | null {
  if (!Array.isArray(value) || value.length > 1) return null;
  const history: SliceRuleDecisionTraceItem["decisionHistory"][number][] = [Object.freeze({ decision: "proposed", occurredAt: proposedAt, reasonCode: null })];
  let previousAt = Date.parse(proposedAt);
  for (const raw of value) {
    if (!exact(raw, ["command_kind", "decided_at", "reason_code", "execution_authority", "execution_performed"])
      || raw.execution_authority !== "none" || raw.execution_performed !== false
      || typeof raw.command_kind !== "string" || !["approve", "reject", "defer", "request_changes"].includes(raw.command_kind)
      || typeof raw.reason_code !== "string" || !CODE.test(raw.reason_code)) return null;
    const occurredAt = instant(raw.decided_at);
    if (!occurredAt || Date.parse(occurredAt) < previousAt) return null;
    previousAt = Date.parse(occurredAt);
    const decision = raw.command_kind === "approve" ? "approved" : raw.command_kind === "reject" ? "rejected"
      : raw.command_kind === "defer" ? "deferred" : "changes_requested";
    history.push(Object.freeze({ decision, occurredAt, reasonCode: raw.reason_code }));
  }
  return Object.freeze(history);
}

function project(row: SourceRow): Readonly<{ selectionId: string; item: SliceRuleDecisionTraceItem }> | null {
  const ruleSeriesRef = typeof row.rule_series_ref === "string" && CODE.test(row.rule_series_ref) ? row.rule_series_ref : null;
  const ruleRevision = Number(row.rule_revision);
  const selectionId = uuid(row.selection_id);
  const selectedAt = instant(row.selected_at);
  if (!ruleSeriesRef || !Number.isInteger(ruleRevision) || ruleRevision < 1 || !selectionId || typeof row.selection_evidence_hash !== "string" || !HASH.test(row.selection_evidence_hash) || !selectedAt) return null;
  const selectionRef = `selection_${row.selection_evidence_hash}`;
  const bindingId = row.binding_id === null ? null : uuid(row.binding_id);
  const bindingUnitId = row.action_proposal_unit_id === null ? null : uuid(row.action_proposal_unit_id);
  const unitId = row.action_unit_id === null ? null : uuid(row.action_unit_id);
  const bundleId = row.bundle_id === null ? null : uuid(row.bundle_id);
  const attemptCount = count(row.execution_attempt_count);
  const safeAttemptCount = count(row.execution_safe_count);
  if (attemptCount === null || safeAttemptCount === null || safeAttemptCount > attemptCount) return null;

  if (bindingId === null && bindingUnitId === null && unitId === null && bundleId === null && row.unit_ref === null && row.proposed_at === null) {
    if (!Array.isArray(row.decision_events) || row.decision_events.length !== 0 || attemptCount !== 0) return null;
    return Object.freeze({ selectionId, item: Object.freeze({ ruleSeriesRef, ruleRevision, selectionRef, selectedAt,
      actionUnit: Object.freeze({ presence: false, status: "not_materialized" }), decisionHistory: Object.freeze([]),
      execution: Object.freeze({ safetyState: "server_disabled", closure: "not_admitted" }),
    }) });
  }

  if (!bindingId || !bindingUnitId || !unitId || !bundleId || bindingUnitId !== unitId
    || typeof row.unit_ref !== "string" || !UNIT_REF.test(row.unit_ref)) return null;
  const proposedAt = instant(row.proposed_at);
  const history = proposedAt ? decisionHistory(row.decision_events, proposedAt) : null;
  if (!history || safeAttemptCount !== attemptCount || attemptCount > 1) return null;
  const last = history.at(-1);
  const status = last?.decision === "proposed" ? "awaiting_approval" : last?.decision;
  if (!status) return null;
  return Object.freeze({ selectionId, item: Object.freeze({ ruleSeriesRef, ruleRevision, selectionRef, selectedAt,
    actionUnit: Object.freeze({ presence: true, status }), decisionHistory: history,
    execution: Object.freeze({ safetyState: "server_disabled", closure: attemptCount === 0 ? "not_admitted" : "admission_closed" }),
  }) });
}

/** Server-private, tenant-bound canonical read of the immutable selection decision chain. */
export class DrizzleSliceRuleDecisionTraceReadRepository {
  constructor(private readonly database: Database) {}

  async list(workspaceId: string): Promise<readonly SliceRuleDecisionTraceItem[]> {
    if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) throw new Error("invalid_input");
    const rows = resultRows(await this.database.execute(sql`
      select draft.series_ref as rule_series_ref, draft.revision as rule_revision,
        selection.id as selection_id, selection.selection_evidence_hash, selection.selected_at,
        binding.id as binding_id, binding.action_proposal_unit_id,
        unit.id as action_unit_id, unit.bundle_id, unit.unit_ref, unit.proposed_at,
        coalesce(decisions.events, '[]'::jsonb) as decision_events,
        coalesce(execution.attempt_count, 0)::int as execution_attempt_count,
        coalesce(execution.safe_count, 0)::int as execution_safe_count
      from slice_rule_scenario_allocation_selections selection
      join slice_rule_workspace_drafts draft
        on draft.workspace_id = selection.workspace_id and draft.draft_hash = selection.draft_hash
      left join slice_rule_budget_action_unit_bindings binding
        on binding.workspace_id = selection.workspace_id and binding.selection_id = selection.id
      left join action_proposal_units unit
        on unit.workspace_id = binding.workspace_id and unit.id = binding.action_proposal_unit_id
      left join lateral (
        select jsonb_agg(jsonb_build_object('command_kind', decision.command_kind, 'decided_at', decision.decided_at,
          'reason_code', decision.reason_code, 'execution_authority', decision.execution_authority,
          'execution_performed', decision.execution_performed) order by decision.ordinal) as events
        from action_approval_decision_events decision
        where decision.workspace_id = unit.workspace_id and decision.bundle_id = unit.bundle_id
          and decision.unit_id = unit.id and decision.unit_ref = unit.unit_ref
      ) decisions on unit.id is not null
      left join lateral (
        select count(*) as attempt_count,
          count(*) filter (where attempt.admission_payload #>> '{disposition}' = 'admitted_for_disabled_executor'
            and attempt.admission_payload #>> '{capabilities,canExecute}' = 'false'
            and attempt.admission_payload #>> '{capabilities,canWriteMeta}' = 'false'
            and attempt.admission_payload #>> '{capabilities,canDispatchNetwork}' = 'false') as safe_count
        from action_execution_attempts attempt
        where attempt.workspace_id = unit.workspace_id and attempt.bundle_id = unit.bundle_id
          and attempt.unit_id = unit.id and attempt.unit_ref = unit.unit_ref
      ) execution on unit.id is not null
      where selection.workspace_id = ${workspaceId}::uuid
      order by selection.selected_at desc, selection.selection_evidence_hash desc
      limit 101
    `));
    if (rows.length > 100) throw new Error("corrupt_store");
    const projected = rows.map(project);
    const seen = new Map<string, number>();
    for (const entry of projected) if (entry) seen.set(entry.selectionId, (seen.get(entry.selectionId) ?? 0) + 1);
    return Object.freeze(projected.filter((entry): entry is Readonly<{ selectionId: string; item: SliceRuleDecisionTraceItem }> => !!entry && seen.get(entry.selectionId) === 1)
      .map((entry) => entry.item));
  }
}
