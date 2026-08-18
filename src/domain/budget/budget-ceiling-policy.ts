import { createHash } from "node:crypto";

export const BUDGET_CEILING_POLICY_VERSION = "budget-ceiling-policy/1.0.0" as const;
export const BUDGET_CEILING_LAYERS = Object.freeze([
  "market",
  "organization_campaign",
  "geo_targeting_platform",
  "campaign_ad_set",
] as const);

export type BudgetCeilingLayer = (typeof BUDGET_CEILING_LAYERS)[number];
export type BudgetCeilingPolicyDraft = Readonly<{
  workspaceRef: string;
  limitRef: string;
  revision: number;
  previousPolicyHash: string | null;
  poolRef: string;
  parentLimitRef: string | null;
  layer: BudgetCeilingLayer;
  targetScopeRef: string;
  market: "yerli" | "yabanci";
  currency: string;
  ceilingDecimal: string;
  effectiveFrom: string;
  effectiveTo: string;
  state: "published" | "disabled";
  publishedByActorRef: string;
  publishedAt: string;
}>;
export type BudgetCeilingPolicy = Readonly<BudgetCeilingPolicyDraft & {
  schemaVersion: typeof BUDGET_CEILING_POLICY_VERSION;
  authority: Readonly<{
    constraintAuthority: "published_human_policy";
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canEnableAutomation: false;
  }>;
  policyHash: string;
}>;
export type BudgetCeilingResolution = Readonly<{
  status: "ready" | "held";
  effectiveParentCeilingDecimal: string | null;
  policyHashes: readonly string[];
  limitRefs: readonly string[];
  holdReasons: readonly string[];
  resolutionHash: string;
  authority: Readonly<{ canApprove: false; canExecute: false; canWriteMeta: false }>;
}>;

export class BudgetCeilingPolicyError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_chain") {
    super(`Bütçe ceiling politikası reddedildi: ${code}`);
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const AMOUNT = /^(0|[1-9]\d{0,29})(?:\.(\d{1,12}))?$/;
const CURRENCY = /^[A-Z]{3}$/;
const AUTHORITY = Object.freeze({
  constraintAuthority: "published_human_policy" as const,
  canApprove: false as const,
  canExecute: false as const,
  canWriteMeta: false as const,
  canEnableAutomation: false as const,
});
const RESOLUTION_AUTHORITY = Object.freeze({ canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });

function fail(code: BudgetCeilingPolicyError["code"]): never { throw new BudgetCeilingPolicyError(code); }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function iso(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}
function ref(value: unknown, prefix?: string): string {
  if (typeof value !== "string" || !REF.test(value) || (prefix && !value.startsWith(prefix))) fail("invalid_input");
  return value;
}
function amount(value: string): bigint {
  const match = AMOUNT.exec(value); if (!match) fail("invalid_input");
  return BigInt(`${match[1]}${(match[2] ?? "").padEnd(12, "0")}`);
}
function render(value: bigint): string {
  const whole = value / 1_000_000_000_000n, fraction = String(value % 1_000_000_000_000n).padStart(12, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
function draftOf(policy: BudgetCeilingPolicy): BudgetCeilingPolicyDraft {
  const { schemaVersion: _schemaVersion, authority: _authority, policyHash: _policyHash, ...draft } = policy;
  return draft;
}

export function createBudgetCeilingPolicy(value: BudgetCeilingPolicyDraft): BudgetCeilingPolicy {
  exact(value, ["workspaceRef", "limitRef", "revision", "previousPolicyHash", "poolRef", "parentLimitRef", "layer", "targetScopeRef", "market", "currency", "ceilingDecimal", "effectiveFrom", "effectiveTo", "state", "publishedByActorRef", "publishedAt"]);
  const workspaceRef = ref(value.workspaceRef, "workspace_"), limitRef = ref(value.limitRef, "limit_");
  const poolRef = ref(value.poolRef, "budget_pool_"), targetScopeRef = ref(value.targetScopeRef);
  const publishedByActorRef = ref(value.publishedByActorRef, "user_");
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 1_000_000) fail("invalid_input");
  if (value.revision === 1 ? value.previousPolicyHash !== null : typeof value.previousPolicyHash !== "string" || !HASH.test(value.previousPolicyHash)) fail("invalid_input");
  if (!BUDGET_CEILING_LAYERS.includes(value.layer) || (value.market !== "yerli" && value.market !== "yabanci") || !CURRENCY.test(value.currency) || !AMOUNT.test(value.ceilingDecimal) || amount(value.ceilingDecimal) <= 0n) fail("invalid_input");
  if (value.state !== "published" && value.state !== "disabled") fail("invalid_input");
  const parentLimitRef = value.parentLimitRef === null ? null : ref(value.parentLimitRef, "limit_");
  if ((value.layer === "market") !== (parentLimitRef === null) || parentLimitRef === limitRef) fail("invalid_input");
  const effectiveFrom = iso(value.effectiveFrom), effectiveTo = iso(value.effectiveTo), publishedAt = iso(value.publishedAt);
  if (effectiveTo <= effectiveFrom || publishedAt > effectiveFrom) fail("invalid_input");
  const normalized = Object.freeze({ workspaceRef, limitRef, revision: value.revision, previousPolicyHash: value.previousPolicyHash,
    poolRef, parentLimitRef, layer: value.layer, targetScopeRef, market: value.market, currency: value.currency,
    ceilingDecimal: render(amount(value.ceilingDecimal)), effectiveFrom, effectiveTo, state: value.state,
    publishedByActorRef, publishedAt });
  const core = Object.freeze({ ...normalized, schemaVersion: BUDGET_CEILING_POLICY_VERSION, authority: AUTHORITY });
  return Object.freeze({ ...core, policyHash: digest(core) });
}

export function assertValidBudgetCeilingPolicy(value: unknown): BudgetCeilingPolicy {
  exact(value, ["workspaceRef", "limitRef", "revision", "previousPolicyHash", "poolRef", "parentLimitRef", "layer", "targetScopeRef", "market", "currency", "ceilingDecimal", "effectiveFrom", "effectiveTo", "state", "publishedByActorRef", "publishedAt", "schemaVersion", "authority", "policyHash"]);
  const candidate = value as Record<string, unknown>;
  exact(candidate.authority, ["constraintAuthority", "canApprove", "canExecute", "canWriteMeta", "canEnableAutomation"]);
  const authority = candidate.authority as Record<string, unknown>;
  if (candidate.schemaVersion !== BUDGET_CEILING_POLICY_VERSION || typeof candidate.policyHash !== "string" || !HASH.test(candidate.policyHash)
    || authority.constraintAuthority !== "published_human_policy" || authority.canApprove !== false || authority.canExecute !== false
    || authority.canWriteMeta !== false || authority.canEnableAutomation !== false) fail("invalid_input");
  const { schemaVersion: _schemaVersion, authority: _authority, policyHash, ...draft } = candidate;
  const rebuilt = createBudgetCeilingPolicy(draft as BudgetCeilingPolicyDraft);
  if (rebuilt.policyHash !== policyHash) fail("invalid_chain");
  return rebuilt;
}

export function resolveBudgetCeilingPolicies(input: Readonly<{
  workspaceRef: string;
  targetScopeRef: string;
  market: "yerli" | "yabanci";
  currency: string;
  evaluatedAt: string;
  guideBudgetRefs: readonly Readonly<{ limitRef: string; scopeKind: BudgetCeilingLayer }>[];
  policies: readonly BudgetCeilingPolicy[];
}>): BudgetCeilingResolution {
  const workspaceRef = ref(input.workspaceRef, "workspace_"), targetScopeRef = ref(input.targetScopeRef), evaluatedAt = iso(input.evaluatedAt);
  if ((input.market !== "yerli" && input.market !== "yabanci") || !CURRENCY.test(input.currency) || !Array.isArray(input.guideBudgetRefs) || !Array.isArray(input.policies) || input.guideBudgetRefs.length > 64 || input.policies.length > 256) fail("invalid_input");
  const expected = new Map<BudgetCeilingLayer, string>();
  for (const row of input.guideBudgetRefs) {
    if (!row || typeof row !== "object" || !BUDGET_CEILING_LAYERS.includes(row.scopeKind) || expected.has(row.scopeKind)) fail("invalid_input");
    expected.set(row.scopeKind, ref(row.limitRef, "limit_"));
  }
  const holds = new Set<string>();
  if (expected.size !== BUDGET_CEILING_LAYERS.length) holds.add("ceiling_layers_incomplete");
  const selected: BudgetCeilingPolicy[] = [];
  for (const layer of BUDGET_CEILING_LAYERS) {
    const limitRef = expected.get(layer); if (!limitRef) continue;
    const revisions = input.policies.filter((policy) => policy.limitRef === limitRef).sort((a, b) => a.revision - b.revision);
    if (revisions.length === 0) { holds.add(`ceiling_policy_missing:${limitRef}`); continue; }
    let previous: BudgetCeilingPolicy | undefined;
    for (const revision of revisions) {
      const rebuilt = createBudgetCeilingPolicy(draftOf(revision));
      if (rebuilt.policyHash !== revision.policyHash || rebuilt.workspaceRef !== workspaceRef || rebuilt.layer !== layer || (previous ? revision.revision !== previous.revision + 1 || revision.previousPolicyHash !== previous.policyHash : revision.revision !== 1)) fail("invalid_chain");
      previous = revision;
    }
    const current = revisions.at(-1)!;
    if (current.state !== "published") holds.add(`ceiling_policy_disabled:${limitRef}`);
    if (current.targetScopeRef !== targetScopeRef) holds.add(`ceiling_target_mismatch:${limitRef}`);
    if (current.market !== input.market) holds.add(`ceiling_market_mismatch:${limitRef}`);
    if (current.currency !== input.currency) holds.add(`ceiling_currency_mismatch:${limitRef}`);
    if (current.effectiveFrom > evaluatedAt || current.effectiveTo <= evaluatedAt) holds.add(`ceiling_policy_inactive:${limitRef}`);
    selected.push(current);
  }
  for (let index = 0; index < selected.length; index += 1) {
    const current = selected[index]!, expectedParent = index === 0 ? null : selected[index - 1]!.limitRef;
    if (current.parentLimitRef !== expectedParent) holds.add(`ceiling_parent_mismatch:${current.limitRef}`);
    if (index > 0) {
      const parent = selected[index - 1]!;
      if (amount(current.ceilingDecimal) > amount(parent.ceilingDecimal)) holds.add(`ceiling_exceeds_parent:${current.limitRef}`);
      if (current.effectiveFrom < parent.effectiveFrom || current.effectiveTo > parent.effectiveTo) holds.add(`ceiling_window_exceeds_parent:${current.limitRef}`);
    }
  }
  const ready = holds.size === 0 && selected.length === BUDGET_CEILING_LAYERS.length;
  const ceiling = ready ? selected.reduce((minimum, policy) => amount(policy.ceilingDecimal) < minimum ? amount(policy.ceilingDecimal) : minimum, amount(selected[0]!.ceilingDecimal)) : null;
  const core = Object.freeze({ status: ready ? "ready" as const : "held" as const,
    effectiveParentCeilingDecimal: ceiling === null ? null : render(ceiling),
    policyHashes: Object.freeze(selected.map((policy) => policy.policyHash)), limitRefs: Object.freeze(selected.map((policy) => policy.limitRef)),
    holdReasons: Object.freeze([...holds].sort()), authority: RESOLUTION_AUTHORITY });
  return Object.freeze({ ...core, resolutionHash: digest(core) });
}
