import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { CategoryProfileBindings, CategoryProfileRevision } from "@/domain/categories/category-profile";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const CATEGORY_PROFILE_LIFECYCLE_VERSION = "category-profile-lifecycle/1.0.0" as const;

export type CategoryProfileDefinition = Readonly<{
  dimensionRef: string;
  dimensionKey: string;
  definitionRef: string;
  label: string;
  description: string | null;
  currentProfile: CategoryProfileRevision | null;
}>;

export type CategoryProfileLifecycleState = Readonly<{
  registryHash: string;
  definitions: readonly CategoryProfileDefinition[];
}>;

type EditableProfile = Readonly<{
  parentDefinitionRef: string | null;
  label: string;
  description: string;
  color: string;
  bindings: CategoryProfileBindings;
}>;

export type CategoryProfileLifecycleCommand =
  | (EditableProfile & Readonly<{ operation: "create_draft"; definitionRef: string; expectedRegistryHash: string }>)
  | (EditableProfile & Readonly<{ operation: "revise_draft"; profileRef: string; expectedVersion: number;
      expectedProfileHash: string; expectedRegistryHash: string }>)
  | Readonly<{ operation: "publish" | "pause" | "archive"; profileRef: string; expectedVersion: number;
      expectedProfileHash: string; expectedRegistryHash: string; reasonCode: string }>;

export type CategoryProfileLifecycleRepository = Readonly<{
  inspect(workspaceId: string, workspaceRef: string): Promise<CategoryProfileLifecycleState>;
  mutate(input: Readonly<{ workspaceId: string; workspaceRef: string; actorId: string; actorRef: string;
    role: "owner" | "admin"; occurredAt: string; command: CategoryProfileLifecycleCommand }>): Promise<Readonly<{
      state: CategoryProfileLifecycleState; profile: CategoryProfileRevision; auditAppended: true;
      invalidationsAppended: number;
    }>>;
}>;

export class CategoryProfileLifecycleError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "conflict" | "invalid_transition" | "forbidden") {
    super(`Kategori profili lifecycle işlemi reddedildi: ${code}`);
    this.name = "CategoryProfileLifecycleError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const PUBLIC_DEFINITION_REF = /^category_[a-f0-9]{24}$/;
const PROFILE_REF = /^category_profile_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const REASON = /^[a-z][a-z0-9_]{1,63}$/;
const COLOR = /^#[0-9A-F]{6}$/;
const BINDING_PREFIXES = Object.freeze({
  analysisPlaybookRefs: ["analysis_playbook_"],
  ruleInstructionBundleRefs: ["instruction_bundle_", "rule_bundle_"],
  budgetPolicyRefs: ["budget_policy_", "budget_envelope_"],
  transferPolicyRefs: ["transfer_policy_"],
  schedulePolicyRefs: ["schedule_policy_", "cadence_profile_"],
  actionPolicyRefs: ["action_policy_", "approval_policy_", "guardrail_", "autonomy_rule_"],
  creativePolicyRefs: ["creative_policy_"],
} satisfies Readonly<Record<keyof CategoryProfileBindings, readonly string[]>>);

function fail(): never { throw new CategoryProfileLifecycleError("invalid_input"); }
function hash(value: unknown): string { return typeof value === "string" && HASH.test(value) ? value : fail(); }
function version(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 1_000_000 ? Number(value) : fail();
}
function definitionRef(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  return typeof value === "string" && PUBLIC_DEFINITION_REF.test(value) ? value : fail();
}
function profileRef(value: unknown): string {
  return typeof value === "string" && PROFILE_REF.test(value) ? value : fail();
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string") return fail();
  const normalized = value.trim();
  return normalized && normalized.length <= maximum
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized) ? normalized : fail();
}
function bindings(value: unknown): CategoryProfileBindings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const candidate = value as Record<string, unknown>; const keys = Object.keys(BINDING_PREFIXES);
  if (Object.keys(candidate).length !== keys.length || Object.keys(candidate).some((key) => !keys.includes(key))) return fail();
  const normalized = Object.fromEntries(Object.entries(BINDING_PREFIXES).map(([key, prefixes]) => {
    const entries = candidate[key];
    if (!Array.isArray(entries) || entries.length > 64 || key === "analysisPlaybookRefs" && entries.length === 0) return fail();
    const refs = entries.map((entry) => typeof entry === "string" && entry.length <= 159
      && /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(entry)
      && prefixes.some((prefix) => entry.startsWith(prefix)) ? entry : fail()).sort();
    if (new Set(refs).size !== refs.length) return fail();
    return [key, Object.freeze(refs)];
  }));
  return Object.freeze(normalized) as CategoryProfileBindings;
}
function editable(command: EditableProfile): EditableProfile {
  return Object.freeze({ parentDefinitionRef: definitionRef(command.parentDefinitionRef, true),
    label: text(command.label, 200), description: text(command.description, 2_000),
    color: typeof command.color === "string" && COLOR.test(command.color) ? command.color : fail(),
    bindings: bindings(command.bindings) });
}
function normalize(command: CategoryProfileLifecycleCommand): CategoryProfileLifecycleCommand {
  hash(command.expectedRegistryHash);
  if (command.operation === "create_draft") return Object.freeze({ operation: command.operation,
    definitionRef: definitionRef(command.definitionRef)!, expectedRegistryHash: command.expectedRegistryHash,
    ...editable(command) });
  if (command.operation === "revise_draft") return Object.freeze({ operation: command.operation,
    profileRef: profileRef(command.profileRef), expectedVersion: version(command.expectedVersion),
    expectedProfileHash: hash(command.expectedProfileHash), expectedRegistryHash: command.expectedRegistryHash,
    ...editable(command) });
  if (!REASON.test(command.reasonCode)) return fail();
  return Object.freeze({ ...command, profileRef: profileRef(command.profileRef),
    expectedVersion: version(command.expectedVersion), expectedProfileHash: hash(command.expectedProfileHash) });
}

function authority(role: WorkspaceMembership["role"]) {
  const canMutate = role === "owner" || role === "admin";
  return Object.freeze({ canRead: true as const, canCreate: canMutate, canRevise: canMutate,
    canPublish: canMutate, canPause: canMutate, canArchive: canMutate,
    canPublishPolicy: false as const, canAuthorizeAction: false as const, canExecute: false as const,
    canWriteMeta: false as const });
}

export class CategoryProfileLifecycleService {
  constructor(private readonly repository: CategoryProfileLifecycleRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async inspect(principal: TrustedDecisionRoomPrincipal) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:read", this.memberships);
    return Object.freeze({ contractVersion: CATEGORY_PROFILE_LIFECYCLE_VERSION,
      ...await this.repository.inspect(principal.workspaceId, principal.workspaceRef), authority: authority(membership.role) });
  }

  async mutate(principal: TrustedDecisionRoomPrincipal, command: CategoryProfileLifecycleCommand) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:publish", this.memberships);
    if (membership.role !== "owner" && membership.role !== "admin") throw new CategoryProfileLifecycleError("invalid_input");
    const result = await this.repository.mutate({ workspaceId: principal.workspaceId, workspaceRef: principal.workspaceRef,
      actorId: principal.actor.userId, actorRef: principal.readerRef, role: membership.role,
      occurredAt: new Date().toISOString(), command: normalize(command) });
    return Object.freeze({ contractVersion: CATEGORY_PROFILE_LIFECYCLE_VERSION, ...result,
      authority: authority(membership.role), canPublishPolicy: false as const, canAuthorizeAction: false as const,
      canExecute: false as const, canWriteMeta: false as const });
  }
}
