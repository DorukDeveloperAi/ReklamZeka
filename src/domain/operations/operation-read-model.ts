import { metaPublicReference } from "@/domain/meta/public-reference";
import { organizationCampaignPublicRef } from "@/domain/campaigns/organization-campaign";

export type OperationPeriod = Readonly<{ startDate: string; endDate: string }>;
export type OperationRowFact = Readonly<{
  workspaceId: string; market: "yerli" | "yabanci" | null; accountId: string; accountName: string; campaignId: string; campaignName: string;
  organizationCampaignId: string | null; organizationCampaignName: string | null; adSetId: string | null; adSetName: string | null;
  /** Canonical Meta identity for the exact insight grain; never exposed as a public ref. */
  insightExternalEntityId?: string;
  cbo: boolean | null; campaignBudgetMinor: number | null; adSetBudgetMinor: number | null; spendMinor: number | null;
  observedDays: readonly string[]; missingDays: readonly string[]; reasonCodes: readonly string[];
  primaryResultBinding: Readonly<{ state: "unbound" } | { state: "bound"; actionType: string; bindingRef: string }>;
  primaryResult: string | null; primaryResultCostMinor: string | null;
  primaryResultSource?: "slice_binding" | "organization_campaign_fallback" | "unbound" | "unavailable";
}>;
export type OperationReadProjection = Readonly<{ version: "operation-read/2.0.0"; period: OperationPeriod; state: "ready" | "partial" | "empty" | "unavailable"; rows: readonly Readonly<{
  market: "yerli" | "yabanci" | "unknown"; accountRef: string; organizationCampaignRef: string | null; organizationCampaignName: string; campaignRef: string; adSetRef: string | null;
  accountName: string; campaignName: string; adSetName: string | null; currentBudgetMinor: number | null; budgetOwner: "campaign" | "ad_set" | "unknown"; budgetOwnerRef: string | null; spendMinor: number | null;
  primaryResultState: "bound" | "unbound"; primaryResult: string | null; primaryResultCostMinor: string | null; primaryResultSource: "slice_binding" | "organization_campaign_fallback" | "unbound" | "unavailable";
  sourceState: "ready" | "partial" | "empty" | "unavailable"; missingDays: readonly string[]; reasonCodes: readonly string[];
}>[]; budgetOwners: readonly Readonly<{ ref: string; currentBudgetMinor: number }>[]; authority: Readonly<{ canWriteMeta: false; canExecute: false; canApprove: false }> }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9_]{1,64}_[a-zA-Z0-9_.:-]{1,190}$/;
const ACTION_TYPE = /^[a-z][a-z0-9_:-]{0,120}$/;
const REASON = /^[a-z][a-z0-9_:-]{0,80}$/;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const text = (value: unknown, max = 320) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const money = (value: unknown) => value === null || typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** Canonical non-negative decimal: no padded integer, no redundant scale. */
const decimal = (value: unknown) => {
  if (value === null || typeof value !== "string") return value === null;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/.exec(value);
  return Boolean(match) && match![1]!.length + (match![2]?.length ?? 0) <= 38 && (match![2] === undefined || !match![2]!.endsWith("0"));
};
const day = (value: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [year, month, date] = value.split("-").map(Number); const parsed = new Date(Date.UTC(year!, month! - 1, date!)); return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === date; };
const offset = (value: string, days: number) => new Date(new Date(`${value}T00:00:00Z`).valueOf() + days * 86_400_000).toISOString().slice(0, 10);
const calendar = (startDate: string, endDate: string) => Array.from({ length: Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1 }, (_, index) => offset(startDate, index));
function zonedDay(value: Date, timeZone: string) { try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value); } catch { throw new Error("operation read rejected: period"); } }
export function operationPeriod(input: Readonly<{ kind?: "today" | "7d" | "30d" | "custom"; startDate?: string; endDate?: string; now?: Date; workspaceTimeZone?: string }> = {}): OperationPeriod {
  if (!input || typeof input !== "object" || Object.keys(input).some((key) => !["kind", "startDate", "endDate", "now", "workspaceTimeZone"].includes(key))) throw new Error("operation read rejected: period");
  const kind = input.kind ?? "7d"; const now = input.now ?? new Date(); if (!(now instanceof Date) || Number.isNaN(now.valueOf()) || !["today", "7d", "30d", "custom"].includes(kind)) throw new Error("operation read rejected: period");
  if (kind === "custom") { if (!input.startDate || !input.endDate || !day(input.startDate) || !day(input.endDate) || input.startDate > input.endDate || calendar(input.startDate, input.endDate).length > 366) throw new Error("operation read rejected: period"); return Object.freeze({ startDate: input.startDate, endDate: input.endDate }); }
  const endDate = zonedDay(now, input.workspaceTimeZone ?? "UTC"); const days = kind === "today" ? 1 : kind === "30d" ? 30 : 7; return Object.freeze({ startDate: offset(endDate, -(days - 1)), endDate });
}
export function buildOperationReadModel(input: Readonly<{ workspaceId: string; period: OperationPeriod; facts: readonly OperationRowFact[]; unavailable?: boolean }>): OperationReadProjection {
  const primaryCoherent = (fact: OperationRowFact) => fact.primaryResultBinding.state === "unbound"
    ? fact.primaryResult === null && fact.primaryResultCostMinor === null && (fact.primaryResultSource ?? "unbound") === "unbound"
    : ["slice_binding", "organization_campaign_fallback", "unavailable"].includes(fact.primaryResultSource ?? "unavailable")
      && ((fact.primaryResultSource ?? "unavailable") === "unavailable"
        ? fact.primaryResult === null && fact.primaryResultCostMinor === null
        : fact.primaryResult !== null && (fact.primaryResult === "0" ? fact.primaryResultCostMinor === null : fact.primaryResultCostMinor !== null));
  if (!UUID.test(input.workspaceId) || !day(input.period.startDate) || !day(input.period.endDate) || input.period.startDate > input.period.endDate || calendar(input.period.startDate, input.period.endDate).length > 366 || input.facts.length > 20_000 || input.facts.some((fact) => fact.workspaceId !== input.workspaceId || !UUID.test(fact.accountId) || !UUID.test(fact.campaignId) || fact.adSetId !== null && !UUID.test(fact.adSetId) || fact.organizationCampaignId !== null && !UUID.test(fact.organizationCampaignId) || !text(fact.accountName) || !text(fact.campaignName) || fact.adSetName !== null && !text(fact.adSetName) || fact.organizationCampaignName !== null && !text(fact.organizationCampaignName) || !money(fact.campaignBudgetMinor) || !money(fact.adSetBudgetMinor) || !money(fact.spendMinor) || !decimal(fact.primaryResultCostMinor) || !decimal(fact.primaryResult) || !primaryCoherent(fact) || fact.reasonCodes.some((reason) => !REASON.test(reason)) || new Set(fact.reasonCodes).size !== fact.reasonCodes.length || fact.primaryResultBinding.state === "bound" && (!ACTION_TYPE.test(fact.primaryResultBinding.actionType) || !REF.test(fact.primaryResultBinding.bindingRef)))) throw new Error("operation read rejected: tenant");
  if (input.unavailable) return Object.freeze({ version: "operation-read/2.0.0", period: input.period, state: "unavailable", rows: [], budgetOwners: [], authority: Object.freeze({ canWriteMeta: false, canExecute: false, canApprove: false }) });
  const expectedDays = calendar(input.period.startDate, input.period.endDate);
  const rows = input.facts.map((fact) => { const owner = fact.cbo === true ? "campaign" : fact.cbo === false ? "ad_set" : "unknown" as const; const currentBudgetMinor = owner === "campaign" ? fact.campaignBudgetMinor : owner === "ad_set" ? fact.adSetBudgetMinor : null; const budgetOwnerRef = owner === "campaign" ? metaPublicReference("campaign", input.workspaceId, fact.campaignId) : owner === "ad_set" && fact.adSetId ? metaPublicReference("ad_set", input.workspaceId, fact.adSetId) : null; const observed = [...new Set(fact.observedDays)].sort(compare), missing = [...new Set(fact.missingDays)].sort(compare); if (observed.some((date) => !day(date) || !expectedDays.includes(date)) || missing.some((date) => !day(date) || !expectedDays.includes(date)) || observed.some((date) => missing.includes(date)) || [...observed, ...missing].sort(compare).join() !== expectedDays.join()) throw new Error("operation read rejected: coverage"); const sourceState = fact.market === null || missing.length || fact.reasonCodes.includes("spend_unavailable") ? "partial" : observed.length ? "ready" : "empty"; const bound = fact.primaryResultBinding.state === "bound";
    return Object.freeze({ market: fact.market ?? "unknown", accountRef: metaPublicReference("account", input.workspaceId, fact.accountId), accountName: fact.accountName, organizationCampaignRef: fact.organizationCampaignId ? organizationCampaignPublicRef(input.workspaceId, fact.organizationCampaignId) : null, organizationCampaignName: fact.organizationCampaignName ?? "Kurum Kampanyası atanmadı", campaignRef: metaPublicReference("campaign", input.workspaceId, fact.campaignId), campaignName: fact.campaignName, adSetRef: fact.adSetId ? metaPublicReference("ad_set", input.workspaceId, fact.adSetId) : null, adSetName: fact.adSetName, currentBudgetMinor, budgetOwner: owner, budgetOwnerRef, spendMinor: fact.spendMinor, primaryResultState: bound ? "bound" : "unbound", primaryResult: bound ? fact.primaryResult : null, primaryResultCostMinor: bound ? fact.primaryResultCostMinor : null, primaryResultSource: bound ? fact.primaryResultSource ?? "unavailable" : "unbound", sourceState, missingDays: Object.freeze(missing), reasonCodes: Object.freeze([...fact.reasonCodes].sort(compare)) }); }).sort((a, b) => compare(a.market, b.market) || compare(a.accountRef, b.accountRef) || compare(a.campaignRef, b.campaignRef) || compare(a.adSetRef ?? "", b.adSetRef ?? ""));
  const state = !rows.length ? "empty" : rows.some((row) => row.sourceState !== "ready") ? "partial" : "ready";
  const owners = new Map<string, number>(); for (const row of rows) if (row.budgetOwnerRef && row.currentBudgetMinor !== null) owners.set(row.budgetOwnerRef, row.currentBudgetMinor);
  const budgetOwners = Object.freeze([...owners.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([ref, currentBudgetMinor]) => Object.freeze({ ref, currentBudgetMinor })));
  return Object.freeze({ version: "operation-read/2.0.0", period: input.period, state, rows: Object.freeze(rows), budgetOwners, authority: Object.freeze({ canWriteMeta: false, canExecute: false, canApprove: false }) });
}
