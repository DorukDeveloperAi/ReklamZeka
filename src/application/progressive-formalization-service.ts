import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type {
  FormalizationLevel,
  ProgressiveFormalizationRevision,
} from "@/domain/guidance/progressive-formalization";
import type { NormalizedPolicyDraft } from "@/domain/guidance/progressive-formalization";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const PROGRESSIVE_FORMALIZATION_STUDIO_VERSION = "progressive-formalization-studio/1.0.0" as const;

export type ProgressiveFormalizationFlow = Readonly<{
  formalizationRef: string;
  level: FormalizationLevel;
  headHash: string;
  revisions: readonly ProgressiveFormalizationRevision[];
}>;

export type ProgressiveFormalizationState = Readonly<{
  registryHash: string;
  flows: readonly ProgressiveFormalizationFlow[];
}>;

export type FormalizationBlocker =
  | "formalization_not_found"
  | "wrong_maturity_level"
  | "guidance_source_not_found"
  | "guidance_card_not_published"
  | "guidance_scope_not_representable"
  | "reviewed_guidance_set_not_found"
  | "guidance_set_card_mismatch"
  | "strict_policy_draft_not_found"
  | "published_policy_missing"
  | "semantic_diff_unresolved"
  | "historical_replay_incomplete"
  | "conflict_preview_unknown"
  | "impact_preview_incomplete"
  | "production_policy_authority_catalog_unavailable"
  | "g4_risk_evidence_unavailable"
  | "g4_cap_policy_unavailable"
  | "g4_approval_policy_unavailable"
  | "g4_rollout_evidence_unavailable"
  | "g4_action_valve_unavailable";

export type ProgressiveFormalizationPreview = Readonly<{
  contractVersion: typeof PROGRESSIVE_FORMALIZATION_STUDIO_VERSION;
  target: "G3" | "G4";
  formalizationRef: string;
  headHash: string;
  previewHash: string;
  disposition: "ready" | "blocked";
  blockers: readonly FormalizationBlocker[];
  normalizedDraft: NormalizedPolicyDraft | null;
  g4Payload: Readonly<{
    publishedPolicyRef: string;
    publishedPolicyHash: string;
    riskAssessmentRef: string;
    capPolicyRef: string;
    approvalPolicyRef: string;
    rolloutEvidenceRefs: readonly string[];
    actionValveRef: string;
    approvalMode: "approval_only";
  }> | null;
  evidence: Readonly<{
    persistedGuidance: boolean;
    persistedPolicy: boolean;
    productionAuthoritySourceBound: boolean;
    historicalRunsEvaluated: number;
  }>;
  authority: Readonly<{
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canSchedule: false;
    canCallTool: false;
  }>;
}>;

export type OwnerConfirmation = Readonly<{ confirmed: true; confirmationRef: string }>;

export type ProgressiveFormalizationCommand =
  | Readonly<{ operation: "capture_g0"; expectedRegistryHash: string; rawProvenanceRef: string }>
  | Readonly<{ operation: "scope_g1"; expectedRegistryHash: string; formalizationRef: string;
      expectedHeadHash: string; guidanceCardRefs: readonly string[] }>
  | Readonly<{ operation: "review_g2"; expectedRegistryHash: string; formalizationRef: string;
      expectedHeadHash: string; guidanceSetRef: string; ownerConfirmation: OwnerConfirmation }>
  | Readonly<{ operation: "promote_g3"; expectedRegistryHash: string; formalizationRef: string;
      expectedHeadHash: string; policyRef: string; expectedPreviewHash: string;
      ownerConfirmation: OwnerConfirmation }>
  | Readonly<{ operation: "qualify_g4"; expectedRegistryHash: string; formalizationRef: string;
      expectedHeadHash: string; expectedPreviewHash: string; ownerConfirmation: OwnerConfirmation }>;

export type ProgressiveFormalizationRepository = Readonly<{
  inspect(workspaceId: string): Promise<ProgressiveFormalizationState>;
  preview(input: Readonly<{ workspaceId: string; workspaceRef: string; formalizationRef: string;
    target: "G3" | "G4"; policyRef: string | null }>): Promise<ProgressiveFormalizationPreview>;
  mutate(input: Readonly<{
    workspaceId: string;
    workspaceRef: string;
    actorId: string;
    actorRef: string;
    role: "owner" | "admin" | "analyst";
    occurredAt: string;
    command: ProgressiveFormalizationCommand;
  }>): Promise<Readonly<{ state: ProgressiveFormalizationState; auditAppended: true }>>;
}>;

export class ProgressiveFormalizationStudioError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "conflict" | "invalid_transition"
    | "forbidden" | "preview_blocked") {
    super(`Progressive formalization işlemi reddedildi: ${code}`);
    this.name = "ProgressiveFormalizationStudioError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const CONFIRMATION_REF = /^confirmation_[a-z0-9][a-z0-9_.:-]{0,126}$/;

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) throw new ProgressiveFormalizationStudioError("invalid_input");
  return value;
}

function ref(value: unknown, pattern = REF): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new ProgressiveFormalizationStudioError("invalid_input");
  return value;
}

function confirmation(value: OwnerConfirmation): OwnerConfirmation {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 2 || value.confirmed !== true) {
    throw new ProgressiveFormalizationStudioError("invalid_input");
  }
  return Object.freeze({ confirmed: true, confirmationRef: ref(value.confirmationRef, CONFIRMATION_REF) });
}

function normalize(command: ProgressiveFormalizationCommand): ProgressiveFormalizationCommand {
  hash(command.expectedRegistryHash);
  if (command.operation === "capture_g0") {
    return Object.freeze({ ...command, rawProvenanceRef: ref(command.rawProvenanceRef) });
  }
  const common = { expectedRegistryHash: command.expectedRegistryHash,
    formalizationRef: ref(command.formalizationRef, /^formalization_[a-z0-9][a-z0-9_.:-]{0,126}$/),
    expectedHeadHash: hash(command.expectedHeadHash) };
  if (command.operation === "scope_g1") {
    if (!Array.isArray(command.guidanceCardRefs) || command.guidanceCardRefs.length < 1
      || command.guidanceCardRefs.length > 100) throw new ProgressiveFormalizationStudioError("invalid_input");
    const guidanceCardRefs = [...command.guidanceCardRefs].map((item) => ref(item)).sort();
    if (new Set(guidanceCardRefs).size !== guidanceCardRefs.length) {
      throw new ProgressiveFormalizationStudioError("invalid_input");
    }
    return Object.freeze({ operation: command.operation, ...common, guidanceCardRefs: Object.freeze(guidanceCardRefs) });
  }
  if (command.operation === "review_g2") return Object.freeze({ operation: command.operation, ...common,
    guidanceSetRef: ref(command.guidanceSetRef), ownerConfirmation: confirmation(command.ownerConfirmation) });
  if (command.operation === "promote_g3") return Object.freeze({ operation: command.operation, ...common,
    policyRef: ref(command.policyRef), expectedPreviewHash: hash(command.expectedPreviewHash),
    ownerConfirmation: confirmation(command.ownerConfirmation) });
  return Object.freeze({ operation: command.operation, ...common,
    expectedPreviewHash: hash(command.expectedPreviewHash), ownerConfirmation: confirmation(command.ownerConfirmation) });
}

function authority(role: WorkspaceMembership["role"]) {
  return Object.freeze({ canRead: true as const, canCapture: role !== "viewer", canScope: role !== "viewer",
    canReview: role === "owner" || role === "admin", canPromote: role === "owner" || role === "admin",
    canQualify: role === "owner" || role === "admin", canApprove: false as const, canExecute: false as const,
    canWriteMeta: false as const, canSchedule: false as const, canCallTool: false as const });
}

export class ProgressiveFormalizationService {
  constructor(private readonly repository: ProgressiveFormalizationRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async inspect(principal: TrustedDecisionRoomPrincipal) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "instruction_policy:read", this.memberships);
    return Object.freeze({ contractVersion: PROGRESSIVE_FORMALIZATION_STUDIO_VERSION,
      ...await this.repository.inspect(principal.workspaceId), authority: authority(membership.role) });
  }

  async preview(principal: TrustedDecisionRoomPrincipal, request: Readonly<{
    formalizationRef: string; target: "G3" | "G4"; policyRef: string | null;
  }>) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "instruction_policy:read", this.memberships);
    if (!request || typeof request !== "object" || !["G3", "G4"].includes(request.target)) {
      throw new ProgressiveFormalizationStudioError("invalid_input");
    }
    const formalizationRef = ref(request.formalizationRef, /^formalization_[a-z0-9][a-z0-9_.:-]{0,126}$/);
    const policyRef = request.target === "G3" ? ref(request.policyRef) : request.policyRef === null ? null : (() => {
      throw new ProgressiveFormalizationStudioError("invalid_input");
    })();
    const result = await this.repository.preview({ workspaceId: principal.workspaceId,
      workspaceRef: principal.workspaceRef, formalizationRef, target: request.target, policyRef });
    return Object.freeze({ ...result, actorAuthority: authority(membership.role) });
  }

  async mutate(principal: TrustedDecisionRoomPrincipal, rawCommand: ProgressiveFormalizationCommand) {
    const command = normalize(rawCommand);
    const ownerGate = command.operation === "review_g2" || command.operation === "promote_g3"
      || command.operation === "qualify_g4";
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId,
      ownerGate ? "instruction_policy:publish" : "instruction_policy:draft", this.memberships);
    if (membership.role === "viewer" || ownerGate && membership.role === "analyst") {
      throw new ProgressiveFormalizationStudioError("forbidden");
    }
    const result = await this.repository.mutate({ workspaceId: principal.workspaceId,
      workspaceRef: principal.workspaceRef, actorId: principal.actor.userId, actorRef: principal.readerRef,
      role: membership.role as "owner" | "admin" | "analyst", occurredAt: new Date().toISOString(), command });
    return Object.freeze({ contractVersion: PROGRESSIVE_FORMALIZATION_STUDIO_VERSION, ...result,
      authority: authority(membership.role) });
  }
}
