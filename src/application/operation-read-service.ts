import { buildOperationReadModel, operationPeriod, type OperationPeriod, type OperationReadProjection, type OperationRowFact } from "@/domain/operations/operation-read-model";
export type OperationReadRepository = Readonly<{ load(input: Readonly<{ workspaceId: string; period: OperationPeriod; sliceRef: string | null; limit: number; cursor: string | null }>): Promise<Readonly<{ facts: readonly OperationRowFact[]; unavailable: boolean; nextCursor: string | null }>>; workspaceTimeZone?(workspaceId: string): Promise<string | null> }>;
export type OperationReadRequest = Readonly<{ period?: "today" | "7d" | "30d" | "custom"; start?: string; end?: string; slice?: string; limit?: string; cursor?: string }>;
const SLICE = /^slice_[a-z0-9][a-z0-9_.:-]{0,190}$/;
export class OperationReadService {
  constructor(private readonly repository: OperationReadRepository, private readonly now: () => Date = () => new Date()) {}
  async read(workspaceId: string, input: OperationReadRequest = {}): Promise<OperationReadProjection & Readonly<{ nextCursor: string | null }>> {
    const keys = Object.keys(input); if (keys.some((key) => !["period", "start", "end", "slice", "limit", "cursor"].includes(key))) throw new Error("operation read rejected: input");
    const workspaceTimeZone = this.repository.workspaceTimeZone ? await this.repository.workspaceTimeZone(workspaceId) : "UTC";
    if (!workspaceTimeZone) throw new Error("operation read unavailable: workspace timezone");
    const period = operationPeriod({ kind: input.period, startDate: input.start, endDate: input.end, now: this.now(), workspaceTimeZone });
    if (input.slice !== undefined && !SLICE.test(input.slice)) throw new Error("operation read rejected: input");
    const limit = input.limit === undefined ? 100 : Number(input.limit); if (!Number.isInteger(limit) || limit < 1 || limit > 200 || input.cursor !== undefined && !/^operation_cursor_[A-Za-z0-9_-]{1,512}$/.test(input.cursor)) throw new Error("operation read rejected: input");
    const loaded = await this.repository.load({ workspaceId, period, sliceRef: input.slice ?? null, limit, cursor: input.cursor ?? null });
    return Object.freeze({ ...buildOperationReadModel({ workspaceId, period, facts: loaded.facts, unavailable: loaded.unavailable }), nextCursor: loaded.nextCursor });
  }
}
