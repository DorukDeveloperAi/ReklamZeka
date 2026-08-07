import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type {
  ApprovalActionType,
  ApprovalBeforeAfter,
  ApprovalQueueRecord,
  ApprovalQueueRepository,
} from "@/application/approval-queue-read-service";
import type { ActionPlan, AutonomyMode, AutonomyTraceItem, TypedActionIntent } from "@/domain/actions/autonomy-valve";
import * as schema from "@/db/schema";

type Database = Pick<NodePgDatabase<typeof schema>, "execute">;

export class ApprovalQueueDrizzleReadError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "corrupt_store") {
    super("Onay kuyruğu kalıcı kaynaktan güvenli biçimde okunamadı");
    this.name = "ApprovalQueueDrizzleReadError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIT_REF = /^action_unit_[a-f0-9]{20}$/;
const BUNDLE_REF = /^action_bundle_[a-f0-9]{20}$/;
const HASH = /^[a-f0-9]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DECIMAL = /^(0|[1-9]\d{0,29})(?:\.(\d{1,12}))?$/;
const CODE = /^[a-z][a-z0-9_.:-]{0,127}$/;
const PRIVATE_REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const ACTION_TYPES: readonly ApprovalActionType[] = ["status_pause", "status_activate", "budget_decrease", "budget_increase"];

type SourceRow = Readonly<{
  unit_ref: unknown;
  bundle_ref: unknown;
  initial_state: unknown;
  risk: unknown;
  action_type: unknown;
  ad_account_id: unknown;
  campaign_id: unknown;
  ad_set_id: unknown;
  ad_id: unknown;
  policy_snapshot_id: unknown;
  proposed_at: unknown;
  expires_at: unknown;
  action_plan_payload: unknown;
  dependencies: unknown;
}>;

type DependencySource = Readonly<{ unit_ref: unknown; status: unknown }>;

function fail(code: ApprovalQueueDrizzleReadError["code"]): never {
  throw new ApprovalQueueDrizzleReadError(code);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    fail("corrupt_store");
  }
}

function rows(result: unknown): readonly SourceRow[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly SourceRow[];
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) fail("corrupt_store");
  return value.toLowerCase();
}

function instant(value: unknown): string {
  const candidate = value instanceof Date ? value.toISOString() : value;
  if (typeof candidate !== "string" || !Number.isFinite(Date.parse(candidate))) fail("corrupt_store");
  return new Date(candidate).toISOString();
}

function publicRef(kind: "account" | "entity" | "autonomy", workspaceId: string, internalId: unknown): string {
  return `${kind}_${createHash("sha256").update(`${workspaceId}:${kind}:${uuid(internalId)}`).digest("hex").slice(0, 16)}`;
}

function minorUnitScale(currency: string): number {
  try {
    const scale = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    if (scale === undefined || !Number.isInteger(scale) || scale < 0 || scale > 12) fail("corrupt_store");
    return scale;
  } catch {
    fail("corrupt_store");
  }
}

function decimalToMinor(value: unknown, currency: string): number {
  if (typeof value !== "string") fail("corrupt_store");
  const match = DECIMAL.exec(value);
  if (!match) fail("corrupt_store");
  const scale = minorUnitScale(currency);
  const fraction = match[2] ?? "";
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) fail("corrupt_store");
  const padded = fraction.slice(0, scale).padEnd(scale, "0");
  const minor = BigInt(match[1]!) * 10n ** BigInt(scale) + BigInt(padded || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) fail("corrupt_store");
  return Number(minor);
}

function decision(mode: AutonomyMode): "manual" | "approval_required" | "policy_limited" {
  if (mode === "approval_only") return "approval_required";
  if (mode === "policy_limited") return "policy_limited";
  return "manual";
}

function traceScope(value: string): "workspace" | "account" | "category" | "entity" | "risk" {
  const prefix = value.split(":", 1)[0];
  if (prefix === "workspace") return "workspace";
  if (prefix === "account" || prefix === "account_group") return "account";
  if (prefix === "internal_category") return "category";
  if (prefix === "campaign" || prefix === "entity") return "entity";
  if (prefix === "action_type") return "risk";
  fail("corrupt_store");
}

function autonomyTrace(value: unknown): ApprovalQueueRecord["autonomy"]["trace"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) fail("corrupt_store");
  return Object.freeze(value.map((raw) => {
    exact(raw, ["ruleRef", "scopeKey", "outcome", "resultingMode", "maximumActionsPerRun"]);
    if (typeof raw.ruleRef !== "string" || !PRIVATE_REF.test(raw.ruleRef)
      || typeof raw.scopeKey !== "string" || raw.scopeKey.length > 260 || !raw.scopeKey.includes(":")
      || typeof raw.outcome !== "string" || !["workspace_default", "applied", "ignored_disabled", "ignored_not_effective",
        "expired_fail_closed", "widening_conflict", "scope_conflict", "kill_switch"].includes(raw.outcome)
      || !["denied", "approval_only", "policy_limited"].includes(raw.resultingMode as string)
      || raw.maximumActionsPerRun !== null
        && (!Number.isSafeInteger(raw.maximumActionsPerRun) || (raw.maximumActionsPerRun as number) < 1)) fail("corrupt_store");
    return Object.freeze({
      scope: traceScope(raw.scopeKey),
      decision: decision(raw.resultingMode as AutonomyMode),
      reasonCode: `autonomy.${raw.outcome}`,
    });
  }));
}

function beforeAfter(actionType: ApprovalActionType, action: TypedActionIntent): ApprovalBeforeAfter {
  if (actionType === "status_pause" || actionType === "status_activate") {
    exact(action, ["kind", "entity", "fromStatus", "toStatus"]);
    exact(action.entity, ["level", "ref"]);
    if (action.kind !== "status_change") fail("corrupt_store");
    if (!PRIVATE_REF.test(action.entity.ref) || !["campaign", "adset", "ad"].includes(action.entity.level)
      || !["ACTIVE", "PAUSED"].includes(action.fromStatus) || !["ACTIVE", "PAUSED"].includes(action.toStatus)
      || action.fromStatus === action.toStatus
      || actionType === "status_pause" && action.toStatus !== "PAUSED"
      || actionType === "status_activate" && action.toStatus !== "ACTIVE") fail("corrupt_store");
    return Object.freeze({ field: "configured_status", before: action.fromStatus, after: action.toStatus });
  }
  exact(action, ["kind", "entity", "budgetKind", "currency", "beforeDecimal", "afterDecimal", "budgetOwnerRef"]);
  exact(action.entity, ["level", "ref"]);
  if (action.kind !== "budget_change" || !CURRENCY.test(action.currency)
    || !["daily", "lifetime"].includes(action.budgetKind) || !["campaign", "adset"].includes(action.entity.level)
    || !PRIVATE_REF.test(action.entity.ref) || !PRIVATE_REF.test(action.budgetOwnerRef)) fail("corrupt_store");
  return Object.freeze({
    field: action.budgetKind === "daily" ? "daily_budget_minor" : "lifetime_budget_minor",
    beforeMinor: decimalToMinor(action.beforeDecimal, action.currency),
    afterMinor: decimalToMinor(action.afterDecimal, action.currency),
    currency: action.currency,
  });
}

function entityBinding(row: SourceRow, plan: ActionPlan): Readonly<{ type: "campaign" | "ad_set" | "ad"; id: string }> {
  if (!plan.action || typeof plan.action !== "object" || !plan.action.entity) fail("corrupt_store");
  const populated = [row.campaign_id, row.ad_set_id, row.ad_id].filter((value) => value !== null);
  if (populated.length !== 1) fail("corrupt_store");
  if (plan.action.entity.level === "campaign" && row.campaign_id !== null && row.ad_set_id === null && row.ad_id === null) {
    return Object.freeze({ type: "campaign", id: uuid(row.campaign_id) });
  }
  if (plan.action.entity.level === "adset" && row.campaign_id === null && row.ad_set_id !== null && row.ad_id === null) {
    return Object.freeze({ type: "ad_set", id: uuid(row.ad_set_id) });
  }
  if (plan.action.entity.level === "ad" && row.campaign_id === null && row.ad_set_id === null && row.ad_id !== null) {
    return Object.freeze({ type: "ad", id: uuid(row.ad_id) });
  }
  fail("corrupt_store");
}

function dependencies(value: unknown): ApprovalQueueRecord["dependencies"] {
  if (!Array.isArray(value) || value.length > 50) fail("corrupt_store");
  const seen = new Set<string>();
  return Object.freeze(value.map((raw) => {
    exact(raw, ["unit_ref", "status"]);
    const dependency = raw as DependencySource;
    if (typeof dependency.unit_ref !== "string" || !UNIT_REF.test(dependency.unit_ref) || seen.has(dependency.unit_ref)
      || dependency.status !== "awaiting_approval") fail("corrupt_store");
    seen.add(dependency.unit_ref);
    return Object.freeze({ unitRef: dependency.unit_ref, status: "awaiting_approval" as const });
  }));
}

function mapRow(row: SourceRow, workspaceId: string): ApprovalQueueRecord {
  exact(row, ["unit_ref", "bundle_ref", "initial_state", "risk", "action_type", "ad_account_id", "campaign_id",
    "ad_set_id", "ad_id", "policy_snapshot_id", "proposed_at", "expires_at", "action_plan_payload", "dependencies"]);
  if (typeof row.unit_ref !== "string" || !UNIT_REF.test(row.unit_ref)
    || typeof row.bundle_ref !== "string" || !BUNDLE_REF.test(row.bundle_ref)
    || row.initial_state !== "awaiting_approval" || typeof row.risk !== "string"
    || !["K2", "K3"].includes(row.risk) || typeof row.action_type !== "string"
    || !ACTION_TYPES.includes(row.action_type as ApprovalActionType)) fail("corrupt_store");
  const plan = row.action_plan_payload as ActionPlan;
  exact(plan, ["schemaVersion", "actionType", "risk", "action", "effectiveAutonomy", "disposition", "reasonCodes",
    "trace", "budgetDelta", "capabilities", "contextHash", "planHash"]);
  exact(plan.capabilities, ["canExecute", "canWriteMeta", "canGrantApproval", "canAccessRawGraph"]);
  const { planHash, ...planCore } = plan;
  if (plan.schemaVersion !== "action-plan/1.0.0" || plan.actionType !== row.action_type || plan.risk !== row.risk
    || plan.disposition !== "approval_required" || plan.effectiveAutonomy !== "approval_only"
    || typeof planHash !== "string" || !HASH.test(planHash) || digest(planCore) !== planHash
    || !Array.isArray(plan.trace) || !Array.isArray(plan.reasonCodes)
    || plan.reasonCodes.some((reason) => typeof reason !== "string" || !CODE.test(reason))
    || plan.capabilities.canExecute !== false || plan.capabilities.canWriteMeta !== false
    || plan.capabilities.canGrantApproval !== false || plan.capabilities.canAccessRawGraph !== false
    || typeof plan.contextHash !== "string" || !HASH.test(plan.contextHash)) fail("corrupt_store");
  const binding = entityBinding(row, plan);
  const createdAt = instant(row.proposed_at);
  const expiresAt = instant(row.expires_at);
  if (expiresAt <= createdAt) fail("corrupt_store");
  const actionType = row.action_type as ApprovalActionType;
  return Object.freeze({
    unitRef: row.unit_ref,
    bundleRef: row.bundle_ref,
    status: "awaiting_approval",
    risk: row.risk as "K2" | "K3",
    actionType,
    accountRef: publicRef("account", workspaceId, row.ad_account_id),
    entity: Object.freeze({ type: binding.type, ref: publicRef("entity", workspaceId, binding.id), label: null }),
    beforeAfter: beforeAfter(actionType, plan.action),
    autonomy: Object.freeze({
      profileRef: publicRef("autonomy", workspaceId, row.policy_snapshot_id),
      decision: "approval_required",
      trace: autonomyTrace(plan.trace as readonly AutonomyTraceItem[]),
    }),
    expiresAt,
    createdAt,
    dependencies: dependencies(row.dependencies),
    summaryCode: `approval.${actionType}`,
  });
}

function validateInput(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}

/** Server-private, tenant-bound and strictly read-only approval queue adapter. */
export class DrizzleApprovalQueueReadRepository implements ApprovalQueueRepository {
  private readonly workspaceId: string;

  constructor(private readonly database: Database, workspaceId: string) {
    if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) fail("invalid_input");
    this.workspaceId = workspaceId.toLowerCase();
  }

  private assertBoundWorkspace(value: unknown): void {
    if (typeof value !== "string" || !UUID.test(value)) fail("invalid_input");
    if (value.toLowerCase() !== this.workspaceId) fail("workspace_scope_mismatch");
  }

  async list(input: Parameters<ApprovalQueueRepository["list"]>[0]): Promise<readonly ApprovalQueueRecord[]> {
    validateInput(input, ["workspaceId", "before", "limit"]);
    this.assertBoundWorkspace(input.workspaceId);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 101) fail("invalid_input");
    if (input.before !== null && (!input.before || typeof input.before !== "object"
      || Object.keys(input.before).sort().join("|") !== "createdAt|unitRef"
      || !Number.isFinite(Date.parse(input.before.createdAt)) || !UNIT_REF.test(input.before.unitRef))) fail("invalid_input");
    const beforeAt = input.before === null ? null : new Date(input.before.createdAt).toISOString();
    const beforeRef = input.before?.unitRef ?? null;
    const result = rows(await this.database.execute(sql`
      select unit.unit_ref, bundle.bundle_ref, unit.initial_state, unit.risk, unit.action_type,
        unit.ad_account_id, unit.campaign_id, unit.ad_set_id, unit.ad_id,
        bundle.policy_snapshot_id, unit.proposed_at, unit.expires_at, unit.action_plan_payload,
        coalesce((
          select jsonb_agg(jsonb_build_object('unit_ref', edge.dependency_unit_ref, 'status', dependency.initial_state)
            order by edge.dependency_unit_ref)
          from action_proposal_dependencies edge
          join action_proposal_units dependency
            on dependency.workspace_id = edge.workspace_id and dependency.bundle_id = edge.bundle_id
            and dependency.id = edge.dependency_unit_id and dependency.unit_ref = edge.dependency_unit_ref
          where edge.workspace_id = unit.workspace_id and edge.bundle_id = unit.bundle_id and edge.unit_id = unit.id
        ), '[]'::jsonb) as dependencies
      from action_proposal_units unit
      join action_proposal_bundles bundle
        on bundle.workspace_id = unit.workspace_id and bundle.id = unit.bundle_id
      where unit.workspace_id = ${this.workspaceId}::uuid
        and (${beforeAt}::timestamptz is null
          or (unit.proposed_at, unit.unit_ref) < (${beforeAt}::timestamptz, ${beforeRef}::text))
      order by unit.proposed_at desc, unit.unit_ref desc
      limit ${input.limit}
    `));
    return Object.freeze(result.map((row) => mapRow(row, this.workspaceId)));
  }

  async get(input: Parameters<ApprovalQueueRepository["get"]>[0]): Promise<ApprovalQueueRecord | null> {
    validateInput(input, ["workspaceId", "unitRef"]);
    this.assertBoundWorkspace(input.workspaceId);
    if (!UNIT_REF.test(input.unitRef)) fail("invalid_input");
    const result = rows(await this.database.execute(sql`
      select unit.unit_ref, bundle.bundle_ref, unit.initial_state, unit.risk, unit.action_type,
        unit.ad_account_id, unit.campaign_id, unit.ad_set_id, unit.ad_id,
        bundle.policy_snapshot_id, unit.proposed_at, unit.expires_at, unit.action_plan_payload,
        coalesce((
          select jsonb_agg(jsonb_build_object('unit_ref', edge.dependency_unit_ref, 'status', dependency.initial_state)
            order by edge.dependency_unit_ref)
          from action_proposal_dependencies edge
          join action_proposal_units dependency
            on dependency.workspace_id = edge.workspace_id and dependency.bundle_id = edge.bundle_id
            and dependency.id = edge.dependency_unit_id and dependency.unit_ref = edge.dependency_unit_ref
          where edge.workspace_id = unit.workspace_id and edge.bundle_id = unit.bundle_id and edge.unit_id = unit.id
        ), '[]'::jsonb) as dependencies
      from action_proposal_units unit
      join action_proposal_bundles bundle
        on bundle.workspace_id = unit.workspace_id and bundle.id = unit.bundle_id
      where unit.workspace_id = ${this.workspaceId}::uuid and unit.unit_ref = ${input.unitRef}
      limit 2
    `));
    if (result.length > 1) fail("corrupt_store");
    return result[0] ? mapRow(result[0], this.workspaceId) : null;
  }
}
