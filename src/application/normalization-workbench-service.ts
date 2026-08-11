import { randomBytes } from "node:crypto";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type {
  NormalizationWorkbenchAnswers,
  NormalizationWorkbenchPreview,
  NormalizationWorkbenchRevision,
  NormalizationWorkbenchSelection,
} from "@/connectors/guidance/normalization-workbench-drizzle-repository";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const NORMALIZATION_WORKBENCH_SERVICE_VERSION = "normalization-workbench-service/1.0.0" as const;

export type NormalizationWorkbenchRepository = Readonly<{
  inspect(workspaceId: string): Promise<readonly NormalizationWorkbenchRevision[]>;
  preview(input: Readonly<{ workspaceId: string; selection: Partial<NormalizationWorkbenchSelection> }>): Promise<NormalizationWorkbenchPreview>;
  create(input: Readonly<{
    workspaceId: string;
    workspaceRef: string;
    actorId: string;
    actorRef: string;
    role: "owner" | "admin" | "analyst";
    occurredAt: string;
    normalizationRef: string;
    expectedHeadHash: "GENESIS" | string;
    expectedSelectionHash: string;
    selection: NormalizationWorkbenchSelection;
    answers: NormalizationWorkbenchAnswers;
  }>): Promise<NormalizationWorkbenchRevision>;
}>;

export class NormalizationWorkbenchServiceError extends Error {
  constructor(readonly code: "invalid_input" | "forbidden") {
    super("Normalizasyon çalışma alanı isteği işlenemedi");
    this.name = "NormalizationWorkbenchServiceError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;

function selection(value: unknown): NormalizationWorkbenchSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 3 || Object.keys(value).some((key) => !["sourceRef", "cardRef", "setRef"].includes(key))) {
    throw new NormalizationWorkbenchServiceError("invalid_input");
  }
  const candidate = value as Record<string, unknown>;
  if (![candidate.sourceRef, candidate.cardRef, candidate.setRef].every((item) => typeof item === "string" && REF.test(item))) {
    throw new NormalizationWorkbenchServiceError("invalid_input");
  }
  return Object.freeze({ sourceRef: candidate.sourceRef as string, cardRef: candidate.cardRef as string, setRef: candidate.setRef as string });
}

function expected(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) throw new NormalizationWorkbenchServiceError("invalid_input");
  return value;
}

function normalizationRef(): string {
  return `normalization_${randomBytes(12).toString("hex")}`;
}

function authority(role: WorkspaceMembership["role"]) {
  return Object.freeze({ canRead: true as const, canDraft: role !== "viewer", canPublish: false as const,
    canPromotePolicy: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });
}

/**
 * Server-side orchestration for the draft-only workbench. It intentionally
 * issues a new immutable normalization chain; policy lifecycle and G3/G4 are
 * outside this service and cannot be selected by the client.
 */
export class NormalizationWorkbenchService {
  constructor(private readonly repository: NormalizationWorkbenchRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async inspect(principal: TrustedDecisionRoomPrincipal) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "instruction_policy:read", this.memberships);
    return Object.freeze({ contractVersion: NORMALIZATION_WORKBENCH_SERVICE_VERSION,
      revisions: await this.repository.inspect(principal.workspaceId), authority: authority(membership.role) });
  }

  async preview(principal: TrustedDecisionRoomPrincipal, candidate: Partial<NormalizationWorkbenchSelection>) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "instruction_policy:read", this.memberships);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
      || Object.keys(candidate).some((key) => !["sourceRef", "cardRef", "setRef"].includes(key))) {
      throw new NormalizationWorkbenchServiceError("invalid_input");
    }
    return Object.freeze({ ...await this.repository.preview({ workspaceId: principal.workspaceId, selection: candidate }),
      authority: authority(membership.role) });
  }

  async create(principal: TrustedDecisionRoomPrincipal, input: Readonly<{
    expectedSelectionHash: string;
    selection: unknown;
    answers: NormalizationWorkbenchAnswers;
  }>) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "instruction_policy:draft", this.memberships);
    if (membership.role === "viewer") throw new NormalizationWorkbenchServiceError("forbidden");
    const result = await this.repository.create({ workspaceId: principal.workspaceId, workspaceRef: principal.workspaceRef,
      actorId: principal.actor.userId, actorRef: principal.readerRef, role: membership.role as "owner" | "admin" | "analyst",
      occurredAt: new Date().toISOString(), normalizationRef: normalizationRef(), expectedHeadHash: "GENESIS",
      expectedSelectionHash: expected(input.expectedSelectionHash), selection: selection(input.selection), answers: input.answers });
    return Object.freeze({ contractVersion: NORMALIZATION_WORKBENCH_SERVICE_VERSION, ...result, authority: authority(membership.role) });
  }
}
