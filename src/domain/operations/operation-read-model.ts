import { metaPublicReference } from "@/domain/meta/public-reference";
import { organizationCampaignPublicRef } from "@/domain/campaigns/organization-campaign";

export type OperationPeriod = Readonly<{ startDate: string; endDate: string }>;
export type OperationRowFact = Readonly<{
  workspaceId: string; market: "yerli" | "yabanci" | null; accountId: string; accountName: string; campaignId: string; campaignName: string;
  organizationCampaignId: string | null; organizationCampaignName: string | null; adSetId: string | null; adSetName: string | null;
  cbo: boolean | null; campaignBudgetMinor: number | null; adSetBudgetMinor: number | null; spendMinor: number | null;
  observedDays: readonly string[]; missingDays: readonly string[]; reasonCodes: readonly string[];
  primaryResult: number | null; primaryResultCostMinor: number | null;
}>;
export type OperationReadProjection = Readonly<{ version: "operation-read/1.0.0"; period: OperationPeriod; state: "ready" | "partial" | "empty" | "unavailable"; rows: readonly Readonly<{
  market: "yerli" | "yabanci" | "unknown"; accountRef: string; organizationCampaignRef: string | null; organizationCampaignName: string; campaignRef: string; adSetRef: string | null;
  currentBudgetMinor: number | null; budgetOwner: "campaign" | "ad_set" | "unknown"; spendMinor: number | null;
  primaryResultState: "bound" | "unbound"; primaryResult: number | null; primaryResultCostMinor: number | null;
  sourceState: "ready" | "partial" | "empty" | "unavailable"; missingDays: readonly string[]; reasonCodes: readonly string[];
}>[]; authority: Readonly<{ canWriteMeta: false; canExecute: false; canApprove: false }> }>;
const iso = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
export function operationPeriod(input: Readonly<{ kind?: "today" | "7d" | "30d" | "custom"; startDate?: string; endDate?: string; now?: Date }> = {}): OperationPeriod {
  const now = input.now ?? new Date(); const day = (date: Date) => date.toISOString().slice(0, 10); const shift = (count: number) => day(new Date(now.valueOf() - count * 86_400_000));
  if ((input.kind ?? "7d") === "custom") { if (!input.startDate || !input.endDate || !iso(input.startDate) || !iso(input.endDate) || input.startDate > input.endDate) throw new Error("operation read rejected: period"); return Object.freeze({ startDate: input.startDate, endDate: input.endDate }); }
  const days = input.kind === "today" ? 1 : input.kind === "30d" ? 30 : 7; return Object.freeze({ startDate: shift(days - 1), endDate: day(now) });
}
export function buildOperationReadModel(input: Readonly<{ workspaceId: string; period: OperationPeriod; facts: readonly OperationRowFact[]; unavailable?: boolean }>): OperationReadProjection {
  if (input.facts.some((fact) => fact.workspaceId !== input.workspaceId)) throw new Error("operation read rejected: tenant");
  if (input.unavailable) return Object.freeze({ version: "operation-read/1.0.0", period: input.period, state: "unavailable", rows: [], authority: Object.freeze({ canWriteMeta: false, canExecute: false, canApprove: false }) });
  const rows = input.facts.map((fact) => { const owner = fact.cbo === true ? "campaign" : fact.cbo === false ? "ad_set" : "unknown" as const; const currentBudgetMinor = owner === "campaign" ? fact.campaignBudgetMinor : owner === "ad_set" ? fact.adSetBudgetMinor : null; const sourceState = fact.missingDays.length ? "partial" : fact.observedDays.length ? "ready" : "empty";
    return Object.freeze({ market: fact.market ?? "unknown", accountRef: metaPublicReference("account", input.workspaceId, fact.accountId), organizationCampaignRef: fact.organizationCampaignId ? organizationCampaignPublicRef(input.workspaceId, fact.organizationCampaignId) : null, organizationCampaignName: fact.organizationCampaignName ?? "Kurum Kampanyası atanmadı", campaignRef: metaPublicReference("campaign", input.workspaceId, fact.campaignId), adSetRef: fact.adSetId ? metaPublicReference("ad_set", input.workspaceId, fact.adSetId) : null, currentBudgetMinor, budgetOwner: owner, spendMinor: fact.spendMinor, primaryResultState: fact.primaryResult === null ? "unbound" : "bound", primaryResult: fact.primaryResult, primaryResultCostMinor: fact.primaryResult === null ? null : fact.primaryResultCostMinor, sourceState, missingDays: Object.freeze([...fact.missingDays]), reasonCodes: Object.freeze([...fact.reasonCodes]) }); });
  const state = !rows.length ? "empty" : rows.some((row) => row.sourceState === "partial") ? "partial" : "ready";
  return Object.freeze({ version: "operation-read/1.0.0", period: input.period, state, rows: Object.freeze(rows), authority: Object.freeze({ canWriteMeta: false, canExecute: false, canApprove: false }) });
}
