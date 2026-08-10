import { Buffer } from "node:buffer";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const BUSINESS_OUTCOME_READ_MODEL_VERSION = "business-outcome-read-model/1.0.0" as const;

export type BusinessOutcomeReadRow = Readonly<{
  batchId: string;
  signalRef: string;
  entityRef: string;
  occurredAt: string;
  outcome: string;
  quantity: number;
  valueMinor: number | null;
  currency: string | null;
  metaEntityRef: string | null;
  mappingStatus: string;
  source: Readonly<{ kind: string; sourceRef: string; observedAt: string }>;
}>;

export type BusinessOutcomeReadRepository = Readonly<{
  listPublic(input: Readonly<{
    workspaceId: string;
    entityRef: string | null;
    before: Readonly<{ occurredAt: string; signalRef: string }> | null;
    limit: number;
  }>): Promise<readonly BusinessOutcomeReadRow[]>;
}>;

export type BusinessOutcomeReadResult = Readonly<{
  contractVersion: typeof BUSINESS_OUTCOME_READ_MODEL_VERSION;
  items: readonly BusinessOutcomeReadRow[];
  nextCursor: string | null;
  capabilities: Readonly<{
    containsRawSource: false;
    containsActorOrAuditData: false;
    canAuthorizeAction: false;
    canExecuteWrite: false;
    canWriteMeta: false;
  }>;
}>;

export class BusinessOutcomeReadError extends Error {
  constructor(readonly code: "invalid_input" | "corrupt_source") {
    super(`Business outcome read rejected: ${code}`); this.name = "BusinessOutcomeReadError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const CURSOR = /^outcome_cursor_[A-Za-z0-9_-]{8,512}$/;
function ref(value: unknown, code: BusinessOutcomeReadError["code"] = "invalid_input"): string {
  if (typeof value !== "string" || !REF.test(value)) throw new BusinessOutcomeReadError(code); return value;
}
function timestamp(value: unknown, code: BusinessOutcomeReadError["code"] = "invalid_input"): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new BusinessOutcomeReadError(code); return value;
}
function limit(value: unknown): number {
  if (value === undefined) return 25;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 100) throw new BusinessOutcomeReadError("invalid_input");
  return value;
}
function encode(before: Readonly<{ occurredAt: string; signalRef: string }>): string {
  return `outcome_cursor_${Buffer.from(JSON.stringify({ v: 1, occurredAt: before.occurredAt, signalRef: before.signalRef }), "utf8").toString("base64url")}`;
}
function decode(value: unknown): Readonly<{ occurredAt: string; signalRef: string }> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !CURSOR.test(value)) throw new BusinessOutcomeReadError("invalid_input");
  let payload: unknown; try { payload = JSON.parse(Buffer.from(value.slice("outcome_cursor_".length), "base64url").toString("utf8")); }
  catch { throw new BusinessOutcomeReadError("invalid_input"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 3
    || (payload as Record<string, unknown>).v !== 1) throw new BusinessOutcomeReadError("invalid_input");
  return Object.freeze({ occurredAt: timestamp((payload as Record<string, unknown>).occurredAt), signalRef: ref((payload as Record<string, unknown>).signalRef) });
}

/** Bounded read model: raw imports, content hashes, actor identities and audit-chain fields never leave the repository. */
export class BusinessOutcomeReadService {
  constructor(private readonly repository: BusinessOutcomeReadRepository, private readonly memberships: readonly WorkspaceMembership[]) {}
  async list(principal: TrustedDecisionRoomPrincipal, input: Readonly<{ entityRef?: unknown; limit?: unknown; cursor?: unknown }>): Promise<BusinessOutcomeReadResult> {
    authorizeWorkspace(principal.actor, principal.workspaceId, "business_outcome:read", this.memberships);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["entityRef", "limit", "cursor"].includes(key))) throw new BusinessOutcomeReadError("invalid_input");
    const entityRef = input.entityRef === undefined ? null : ref(input.entityRef);
    const items = await this.repository.listPublic({ workspaceId: principal.workspaceId, entityRef, before: decode(input.cursor), limit: limit(input.limit) });
    for (const item of items) {
      ref(item.batchId, "corrupt_source"); ref(item.signalRef, "corrupt_source"); ref(item.entityRef, "corrupt_source"); timestamp(item.occurredAt, "corrupt_source");
      ref(item.source.sourceRef, "corrupt_source"); timestamp(item.source.observedAt, "corrupt_source");
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 0 || item.valueMinor !== null && !Number.isSafeInteger(item.valueMinor)
        || !["manual", "csv"].includes(item.source.kind) || !["verified", "unmapped", "rejected"].includes(item.mappingStatus)) throw new BusinessOutcomeReadError("corrupt_source");
    }
    const last = items.at(-1);
    return Object.freeze({ contractVersion: BUSINESS_OUTCOME_READ_MODEL_VERSION, items: Object.freeze(items), nextCursor: last ? encode(last) : null,
      capabilities: Object.freeze({ containsRawSource: false as const, containsActorOrAuditData: false as const, canAuthorizeAction: false as const, canExecuteWrite: false as const, canWriteMeta: false as const }) });
  }
}
