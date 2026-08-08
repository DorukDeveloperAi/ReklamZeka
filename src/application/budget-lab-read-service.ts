import type { PublicBudgetProposal } from "@/connectors/budget/budget-proposal-drizzle-repository";

export const BUDGET_LAB_READ_MODEL_VERSION = "budget-lab-read-model/1.0.0" as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERIES_REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const PROPOSAL_REF = /^budget_proposal_[a-f0-9]{20}$/;
const FULL_HASH = /\b[a-f0-9]{64}\b/i;
const META_REF = /\b(?:act_|campaign_|adset_|ad_)[0-9]{5,}\b/i;
const CREDENTIAL = /\b(?:rzs1\.|EA[A-Za-z0-9]{30,}|Bearer\s+)[A-Za-z0-9._-]*/i;

export class BudgetLabReadError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "unsafe_source" | "source_unavailable") {
    super("Budget Lab kaynağı güvenli biçimde okunamadı");
    this.name = "BudgetLabReadError";
  }
}

export type BudgetLabRepository = Readonly<{
  listPublic(input: Readonly<{
    workspaceId: string;
    before: Readonly<{ createdAt: string; proposalRef: string }> | null;
    limit: number;
  }>): Promise<readonly PublicBudgetProposal[]>;
  loadPublic(input: Readonly<{ workspaceId: string; seriesRef: string; revision?: number }>): Promise<PublicBudgetProposal>;
}>;

export type BudgetLabAuthority = Readonly<{
  canDraft: false;
  canApprove: false;
  canExecute: false;
  canWriteMeta: false;
}>;

export type BudgetLabSummary = Readonly<{
  proposalRef: string;
  seriesRef: string;
  revision: number;
  createdAt: string;
  scope: PublicBudgetProposal["scope"];
  alternativeCount: number;
  composedCount: number;
  suppressedCount: number;
  mappingStatus: "not_requested" | "ready" | "suppressed";
  authority: BudgetLabAuthority;
}>;

export type BudgetLabListResult = Readonly<{
  contractVersion: typeof BUDGET_LAB_READ_MODEL_VERSION;
  view: "list";
  items: readonly BudgetLabSummary[];
  nextCursor: string | null;
  authority: BudgetLabAuthority;
}>;

export type BudgetLabDetailResult = Readonly<{
  contractVersion: typeof BUDGET_LAB_READ_MODEL_VERSION;
  view: "detail";
  item: PublicBudgetProposal;
  authority: BudgetLabAuthority;
}>;

const AUTHORITY: BudgetLabAuthority = Object.freeze({
  canDraft: false, canApprove: false, canExecute: false, canWriteMeta: false,
});

function safe(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (serialized.length > 250_000 || FULL_HASH.test(serialized) || META_REF.test(serialized) || CREDENTIAL.test(serialized)
    || /"(?:workspaceId|adAccountId|campaignId|contextHash|proposalHash|previousProposalHash|idempotencyKey|raw[^" ]*)"/i.test(serialized)) {
    throw new BudgetLabReadError("unsafe_source");
  }
}

function encodeCursor(item: PublicBudgetProposal): string {
  return Buffer.from(JSON.stringify({ v: 1, createdAt: item.createdAt, proposalRef: item.proposalRef }), "utf8").toString("base64url");
}

function decodeCursor(value: unknown): Readonly<{ createdAt: string; proposalRef: string }> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 512) throw new BudgetLabReadError("invalid_input");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (!parsed || Object.keys(parsed).sort().join("|") !== "createdAt|proposalRef|v"
      || parsed.v !== 1 || typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt))
      || typeof parsed.proposalRef !== "string" || !PROPOSAL_REF.test(parsed.proposalRef)) throw new Error("invalid");
    return Object.freeze({ createdAt: new Date(parsed.createdAt).toISOString(), proposalRef: parsed.proposalRef });
  } catch {
    throw new BudgetLabReadError("invalid_input");
  }
}

function summary(item: PublicBudgetProposal): BudgetLabSummary {
  const result = Object.freeze({
    proposalRef: item.proposalRef,
    seriesRef: item.seriesRef,
    revision: item.revision,
    createdAt: item.createdAt,
    scope: item.scope,
    alternativeCount: item.alternatives.length,
    composedCount: item.alternatives.filter((alternative) => alternative.status === "composed").length,
    suppressedCount: item.alternatives.filter((alternative) => alternative.status === "suppressed").length,
    mappingStatus: item.mapping === null ? "not_requested" as const : item.mapping.status,
    authority: AUTHORITY,
  });
  safe(result);
  return result;
}

export class BudgetLabReadService {
  constructor(private readonly repository: BudgetLabRepository) {}

  async list(input: Readonly<{ workspaceId: string; limit?: number; cursor?: string | null }>): Promise<BudgetLabListResult> {
    const limit = input.limit ?? 25;
    if (!UUID.test(input.workspaceId) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BudgetLabReadError("invalid_input");
    }
    let records: readonly PublicBudgetProposal[];
    try {
      records = await this.repository.listPublic({ workspaceId: input.workspaceId, before: decodeCursor(input.cursor), limit: limit + 1 });
    } catch (reason) {
      if (reason instanceof BudgetLabReadError) throw reason;
      throw new BudgetLabReadError("source_unavailable");
    }
    if (!Array.isArray(records) || records.length > limit + 1 || records.some((item, index) =>
      !PROPOSAL_REF.test(item.proposalRef) || !SERIES_REF.test(item.seriesRef)
      || index > 0 && (records[index - 1]!.createdAt < item.createdAt
        || records[index - 1]!.createdAt === item.createdAt && records[index - 1]!.proposalRef <= item.proposalRef))) {
      throw new BudgetLabReadError("unsafe_source");
    }
    records.forEach(safe);
    const page = records.slice(0, limit);
    const result = Object.freeze({
      contractVersion: BUDGET_LAB_READ_MODEL_VERSION,
      view: "list" as const,
      items: Object.freeze(page.map(summary)),
      nextCursor: records.length > limit ? encodeCursor(page.at(-1)!) : null,
      authority: AUTHORITY,
    });
    safe(result);
    return result;
  }

  async get(input: Readonly<{ workspaceId: string; seriesRef: string; revision?: number }>): Promise<BudgetLabDetailResult> {
    if (!UUID.test(input.workspaceId) || !SERIES_REF.test(input.seriesRef)
      || input.revision !== undefined && (!Number.isInteger(input.revision) || input.revision < 1)) {
      throw new BudgetLabReadError("invalid_input");
    }
    let item: PublicBudgetProposal;
    try {
      item = await this.repository.loadPublic(input);
    } catch (reason) {
      if (reason && typeof reason === "object" && "code" in reason && reason.code === "not_found") {
        throw new BudgetLabReadError("not_found");
      }
      throw new BudgetLabReadError("source_unavailable");
    }
    if (item.seriesRef !== input.seriesRef || input.revision !== undefined && item.revision !== input.revision) {
      throw new BudgetLabReadError("unsafe_source");
    }
    const result = Object.freeze({ contractVersion: BUDGET_LAB_READ_MODEL_VERSION, view: "detail" as const, item, authority: AUTHORITY });
    safe(result);
    return result;
  }
}
