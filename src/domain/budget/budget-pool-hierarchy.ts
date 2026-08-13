import { createHash } from "node:crypto";

export const BUDGET_POOL_HIERARCHY_VERSION = "budget-pool-hierarchy/1.0.0" as const;
export type BudgetPoolLayer = "market" | "service_family" | "targeting" | "entity" | "named";
export type BudgetPoolMarket = "domestic" | "international";
export type BudgetPoolNode = Readonly<{
  poolRef: string;
  parentPoolRef: string | null;
  layer: BudgetPoolLayer;
  market: BudgetPoolMarket;
  currency: string;
  hardCapDecimal: string;
  effectiveFrom: string;
  effectiveTo: string;
}>;
export type BudgetPoolHierarchy = Readonly<{
  schemaVersion: typeof BUDGET_POOL_HIERARCHY_VERSION;
  nodes: readonly BudgetPoolNode[];
  hierarchyHash: string;
  authority: Readonly<{ recommendationOnly: true; canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false; canEnableAutomation: false }>;
}>;
export class BudgetPoolHierarchyError extends Error {
  constructor(readonly code: "invalid_input" | "duplicate_pool" | "invalid_root" | "missing_parent" | "market_boundary" | "currency_mismatch" | "cap_exceeded" | "cycle") { super(`Bütçe havuzu hiyerarşisi reddedildi: ${code}`); }
}
const REF = /^budget_pool_[a-z0-9][a-z0-9_.:-]{0,119}$/;
const CURRENCY = /^[A-Z]{3}$/;
const AMOUNT = /^(0|[1-9]\d{0,29})(?:\.(\d{1,12}))?$/;
const LAYERS: readonly BudgetPoolLayer[] = ["market", "service_family", "targeting", "entity", "named"];
const AUTHORITY = Object.freeze({ recommendationOnly: true as const, canPublish: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const, canEnableAutomation: false as const });
function fail(code: BudgetPoolHierarchyError["code"]): never { throw new BudgetPoolHierarchyError(code); }
function amount(value: string): bigint { const match = AMOUNT.exec(value); if (!match || value === "0") fail("invalid_input"); return BigInt(`${match[1]}${(match[2] ?? "").padEnd(12, "0")}`); }
function iso(value: string): string { const date = new Date(value); if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) || !Number.isFinite(date.valueOf()) || date.toISOString() !== value) fail("invalid_input"); return value; }
function stable(value: unknown): unknown { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])); return value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

/**
 * Validates a recommendation-only pool tree.  Every child stays under one
 * market root, its own cap and its direct parent's cap; sibling caps may be
 * alternatives, so no false aggregate claim is made before a dated allocation
 * proposal supplies those amounts.
 */
export function createBudgetPoolHierarchy(input: Readonly<{ nodes: readonly BudgetPoolNode[] }>): BudgetPoolHierarchy {
  if (!input || typeof input !== "object" || !Array.isArray(input.nodes) || input.nodes.length < 2 || input.nodes.length > 200) fail("invalid_input");
  const nodes = input.nodes.map((node) => {
    if (!node || typeof node !== "object" || Object.keys(node).length !== 8 || Object.keys(node).some((key) => !["poolRef", "parentPoolRef", "layer", "market", "currency", "hardCapDecimal", "effectiveFrom", "effectiveTo"].includes(key))
      || !REF.test(node.poolRef) || node.parentPoolRef !== null && !REF.test(node.parentPoolRef) || !LAYERS.includes(node.layer)
      || !["domestic", "international"].includes(node.market) || !CURRENCY.test(node.currency) || !AMOUNT.test(node.hardCapDecimal) || amount(node.hardCapDecimal) <= 0n) fail("invalid_input");
    const effectiveFrom = iso(node.effectiveFrom); const effectiveTo = iso(node.effectiveTo); if (effectiveTo <= effectiveFrom) fail("invalid_input");
    return Object.freeze({ ...node, effectiveFrom, effectiveTo });
  }).sort((a, b) => a.poolRef.localeCompare(b.poolRef));
  if (new Set(nodes.map((node) => node.poolRef)).size !== nodes.length) fail("duplicate_pool");
  const index = new Map(nodes.map((node) => [node.poolRef, node]));
  const roots = nodes.filter((node) => node.parentPoolRef === null);
  if (roots.length !== 2 || new Set(roots.map((node) => node.market)).size !== 2 || roots.some((node) => node.layer !== "market")) fail("invalid_root");
  for (const node of nodes) {
    if (node.parentPoolRef === null) continue;
    const parent = index.get(node.parentPoolRef); if (!parent) fail("missing_parent");
    if (parent.market !== node.market) fail("market_boundary");
    if (parent.currency !== node.currency) fail("currency_mismatch");
    if (amount(node.hardCapDecimal) > amount(parent.hardCapDecimal)) fail("cap_exceeded");
    const visited = new Set<string>([node.poolRef]); let cursor: BudgetPoolNode | undefined = parent;
    while (cursor) { if (visited.has(cursor.poolRef)) fail("cycle"); visited.add(cursor.poolRef); cursor = cursor.parentPoolRef === null ? undefined : index.get(cursor.parentPoolRef); }
  }
  const core = Object.freeze({ schemaVersion: BUDGET_POOL_HIERARCHY_VERSION, nodes: Object.freeze(nodes), authority: AUTHORITY });
  return Object.freeze({ ...core, hierarchyHash: digest(core) });
}
