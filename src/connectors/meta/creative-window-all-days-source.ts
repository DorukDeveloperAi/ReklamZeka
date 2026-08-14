import { createHash } from "node:crypto";
import type { MetaReadTransport } from "@/connectors/meta/sync/types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXTERNAL = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export class CreativeWindowAllDaysSourceError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "ambiguous" | "malformed") {
    super(`Creative all-days source rejected: ${code}`);
    this.name = "CreativeWindowAllDaysSourceError";
  }
}
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function day(value: unknown): string { if (typeof value !== "string" || !DATE.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new CreativeWindowAllDaysSourceError("invalid_input"); return value; }
function decimal(value: unknown): string { if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new CreativeWindowAllDaysSourceError("malformed"); return value; }

export type CreativeWindowAllDaysSource = Readonly<{
  read(input: Readonly<{ accountRef: string; adRef: string; startDate: string; endDate: string }>): Promise<Readonly<{
    startDate: string; endDate: string; frequency: string; clicks: string; impressions: string;
    sourceRef: string; sourceHash: string;
  }>>;
}>;

/**
 * Private GET-only all-days source. The exact ad edge avoids scanning account
 * pages, and the planner supplies `time_increment=all_days`, so non-additive
 * frequency arrives as one direct source-grain value rather than a daily rollup.
 */
export class MetaGraphCreativeWindowAllDaysSource implements CreativeWindowAllDaysSource {
  constructor(private readonly transport: MetaReadTransport) {}

  async read(input: Readonly<{ accountRef: string; adRef: string; startDate: string; endDate: string }>) {
    if (!EXTERNAL.test(input.accountRef) || !EXTERNAL.test(input.adRef)) throw new CreativeWindowAllDaysSourceError("invalid_input");
    const startDate = day(input.startDate); const endDate = day(input.endDate); if (startDate > endDate) throw new CreativeWindowAllDaysSourceError("invalid_input");
    const correlationSeed = digest(Object.freeze({ accountRef: input.accountRef, adRef: input.adRef, startDate, endDate }));
    const page = await this.transport.get({ method: "GET", stream: "insights", accountId: input.accountRef, entityLevel: "ad",
      dateStart: startDate, dateStop: endDate, cursor: null, limit: 2, insightTimeIncrement: "all_days", insightSubjectId: input.adRef,
      correlation: Object.freeze({ parentRunId: `creative-window-${correlationSeed.slice(0, 16)}`, streamRunId: `creative-window-${correlationSeed.slice(16, 32)}`,
        accountId: input.accountRef, sliceId: `creative-window-${correlationSeed.slice(32, 48)}`, cursorId: `creative-window-${correlationSeed.slice(48, 64)}` }) });
    if (page.nextCursor !== null) throw new CreativeWindowAllDaysSourceError("ambiguous");
    const exact = page.records.filter((record) => record.ad_id === input.adRef && record.account_id === input.accountRef
      && record.date_start === startDate && record.date_stop === endDate);
    if (exact.length === 0) throw new CreativeWindowAllDaysSourceError("not_found");
    if (exact.length !== 1) throw new CreativeWindowAllDaysSourceError("ambiguous");
    const record = exact[0]!;
    const frequency = decimal(record.frequency); const clicks = decimal(record.clicks); const impressions = decimal(record.impressions);
    const sourceHash = digest(Object.freeze({ record, graphVersion: page.sourceGraphVersion ?? null, catalogVersion: page.fieldCatalogVersion ?? null }));
    return Object.freeze({ startDate, endDate, frequency, clicks, impressions, sourceRef: `creative_window_${sourceHash.slice(0, 24)}`, sourceHash });
  }
}
