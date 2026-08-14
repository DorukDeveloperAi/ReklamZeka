import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const OPERATIONAL_TIMELINE_VERSION = "operational-timeline/1.0.0" as const;

export type OperationalTimelineEvent = Readonly<{
  kind: "slice_rule_draft" | "budget_proposal" | "delivery_alert" | "approval_proposed" | "approval_decision" | "temporal_evaluation";
  occurredAt: string;
  title: string;
  detail: string;
}>;

export interface OperationalTimelineRepository {
  /**
   * `campaignRef` is a UI-safe alias only. Implementations must resolve it
   * inside the tenant boundary and must never use it as a private identifier.
   */
  list(input: Readonly<{ workspaceId: string; limit: number; campaignRef?: string }>): Promise<readonly OperationalTimelineEvent[]>;
}

export class OperationalTimelineReadError extends Error {
  constructor(readonly code: "invalid_input" | "unsafe_source" | "source_unavailable") {
    super("Operasyon izi güvenli biçimde okunamadı");
    this.name = "OperationalTimelineReadError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTHORITY = Object.freeze({ readOnly: true as const, canPublish: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const, canEnableAutomation: false as const });

function safe(event: OperationalTimelineEvent): OperationalTimelineEvent {
  if (!event || typeof event !== "object" || !["slice_rule_draft", "budget_proposal", "delivery_alert", "approval_proposed", "approval_decision", "temporal_evaluation"].includes(event.kind)
    || typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt))
    || typeof event.title !== "string" || event.title.length < 1 || event.title.length > 180
    || typeof event.detail !== "string" || event.detail.length < 1 || event.detail.length > 300
    || /(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{13,}|[a-f0-9]{64}|EA[A-Za-z0-9]{30,}|Bearer\s+)/i.test(`${event.title} ${event.detail}`)) {
    throw new OperationalTimelineReadError("unsafe_source");
  }
  return Object.freeze({ ...event, occurredAt: new Date(event.occurredAt).toISOString() });
}

/** Read-only cross-ledger projection; it neither creates nor changes any decision record. */
export class OperationalTimelineReadService {
  constructor(private readonly repository: OperationalTimelineRepository, private readonly memberships: readonly WorkspaceMembership[]) {}

  async list(principal: TrustedDecisionRoomPrincipal, input: Readonly<{ limit?: number; campaignRef?: string }> = {}) {
    const limit = input.limit ?? 50;
    if (!UUID.test(principal.workspaceId) || !Number.isInteger(limit) || limit < 1 || limit > 100
      || input.campaignRef !== undefined && !/^ref_[a-f0-9]{12}$/.test(input.campaignRef)) {
      throw new OperationalTimelineReadError("invalid_input");
    }
    authorizeWorkspace(principal.actor, principal.workspaceId, "data:read", this.memberships);
    let items: readonly OperationalTimelineEvent[];
    try { items = await this.repository.list({ workspaceId: principal.workspaceId, limit, campaignRef: input.campaignRef }); }
    catch (reason) { if (reason instanceof OperationalTimelineReadError) throw reason; throw new OperationalTimelineReadError("source_unavailable"); }
    if (!Array.isArray(items) || items.length > limit) throw new OperationalTimelineReadError("unsafe_source");
    const normalized = items.map(safe);
    if (normalized.some((event, index) => index > 0 && Date.parse(event.occurredAt) > Date.parse(normalized[index - 1]!.occurredAt))) {
      throw new OperationalTimelineReadError("unsafe_source");
    }
    return Object.freeze({ contractVersion: OPERATIONAL_TIMELINE_VERSION, items: Object.freeze(normalized), authority: AUTHORITY });
  }
}
