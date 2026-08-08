import { META_ENTITY_LEVELS, META_SYNC_STREAMS, sliceId, type MetaEntityLevel, type MetaSyncSlice } from "./types";

export type MetaSyncPlanInput = Readonly<{
  accountIds: readonly string[];
  dateStart: string;
  dateStop: string;
  dateSliceDays?: number;
  initialPageSize?: number;
}>;

function dateSlices(start: string, stop: string, days: number): readonly Readonly<{ start: string; stop: string }>[] {
  const result: Array<{ start: string; stop: string }> = [];
  let cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${stop}T00:00:00.000Z`);
  if (Number.isNaN(cursor.valueOf()) || Number.isNaN(last.valueOf()) || cursor > last) throw new Error("Geçerli ve artan insight tarih aralığı zorunludur");
  while (cursor <= last) {
    const end = new Date(Math.min(last.valueOf(), cursor.valueOf() + (days - 1) * 86_400_000));
    result.push({ start: cursor.toISOString().slice(0, 10), stop: end.toISOString().slice(0, 10) });
    cursor = new Date(end.valueOf() + 86_400_000);
  }
  return result;
}

/** Produces stable account/entity/date work units; no network or token is involved. */
export function planMetaReadSync(input: MetaSyncPlanInput): readonly MetaSyncSlice[] {
  const pageSize = input.initialPageSize ?? 100;
  const sliceDays = input.dateSliceDays ?? 7;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error("page size pozitif tam sayı olmalıdır");
  if (!Number.isSafeInteger(sliceDays) || sliceDays < 1) throw new Error("date slice günü pozitif tam sayı olmalıdır");
  const accounts = [...new Set(input.accountIds)].sort();
  if (!accounts.length || accounts.some((id) => !id.trim())) throw new Error("En az bir hesap zorunludur");
  const plan: MetaSyncSlice[] = [];
  for (const accountId of accounts) {
    for (const stream of META_SYNC_STREAMS) {
      const levels: readonly MetaEntityLevel[] = stream === "insights" ? META_ENTITY_LEVELS : stream === "inventory" ? ["account", "campaign", "ad_set", "ad"] : ["ad"];
      for (const entityLevel of levels) {
        const windows = stream === "insights" ? dateSlices(input.dateStart, input.dateStop, sliceDays) : [{ start: null, stop: null }];
        for (const window of windows) plan.push({ id: sliceId(stream, accountId, entityLevel, window.start, window.stop), stream, accountId, entityLevel, dateStart: window.start, dateStop: window.stop, pageSize });
      }
    }
  }
  return plan;
}
