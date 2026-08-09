import { createHash } from "node:crypto";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { PublishedPromotionTemplateCatalog } from "@/application/promotion-template-selector-service";
import {
  PROMOTION_TEMPLATE_SELECTOR_VERSION,
  PromotionTemplateSelectorError,
  dryRunPromotionTemplateSelection,
  type PromotionTemplateSelectionDryRun,
  type PromotionTemplateSelectorCandidate,
} from "@/domain/meta/promotion/promotion-template-selector";
import {
  authorizeWorkspace,
  can,
  type WorkspaceMembership,
  type WorkspaceRole,
} from "@/security/authorization";

export const PROMOTION_TEMPLATE_AUTHORING_VERSION = "promotion-template-authoring/1.0.0" as const;

type PostType = "image" | "video" | "carousel" | "reel";

export type PromotionTemplateAuthoringSelection = Readonly<{
  scopeRef: string | null;
  postType: PostType | null;
  instruction: string | null;
}>;

export type PromotionTemplateAuthoringScope = Readonly<{
  scopeRef: string;
  label: string;
  actorType: "page" | "instagram";
  categoryCount: number;
  postTypes: readonly PostType[];
  instructionAliases: readonly string[];
}>;

export type PromotionTemplateAuthoringCatalog = Readonly<{
  scopes: readonly PromotionTemplateAuthoringScope[];
}>;

export type PromotionTemplateAuthoringCapabilities = Readonly<{
  canRead: true;
  canDryRun: boolean;
  canPersistDraft: false;
  canPublish: false;
  canWriteMeta: false;
  canChangeTargeting: false;
  canGenerateCreative: false;
  canProposeAction: false;
  canGrantApproval: false;
}>;

export type PromotionTemplateAuthoringLifecycle = Readonly<{
  draftPersistence: "unavailable";
  publishMutation: "unavailable";
  blocker: "immutable_registry_has_no_authoring_occ_audit_lifecycle";
}>;

export type PromotionTemplateAuthoringInspection = Readonly<{
  contractVersion: typeof PROMOTION_TEMPLATE_AUTHORING_VERSION;
  catalog: PromotionTemplateAuthoringCatalog;
  role: WorkspaceRole;
  capabilities: PromotionTemplateAuthoringCapabilities;
  lifecycle: PromotionTemplateAuthoringLifecycle;
}>;

export type PromotionTemplateAuthoringDryRunEnvelope = Readonly<{
  contractVersion: typeof PROMOTION_TEMPLATE_AUTHORING_VERSION;
  result: PromotionTemplateSelectionDryRun;
  role: WorkspaceRole;
  capabilities: PromotionTemplateAuthoringCapabilities;
  lifecycle: PromotionTemplateAuthoringLifecycle;
}>;

export class PromotionTemplateAuthoringError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "catalog_integrity_rejected") {
    super(`PromotionTemplate authoring reddedildi: ${code}`);
    this.name = "PromotionTemplateAuthoringError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const PROMOTION_SCOPE_REF = /^promotion_scope_[a-f0-9]{24}$/;
const INSTRUCTION = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]{1,500}$/u;
const POST_TYPES = new Set<PostType>(["image", "video", "carousel", "reel"]);

const LIFECYCLE = Object.freeze({
  draftPersistence: "unavailable" as const,
  publishMutation: "unavailable" as const,
  blocker: "immutable_registry_has_no_authoring_occ_audit_lifecycle" as const,
});

function fail(code: PromotionTemplateAuthoringError["code"]): never {
  throw new PromotionTemplateAuthoringError(code);
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail("invalid_input");
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function scopeSignature(candidate: PromotionTemplateSelectorCandidate): string {
  return JSON.stringify({
    workspaceRef: candidate.binding.workspaceRef,
    accountRef: candidate.binding.accountRef,
    actor: candidate.binding.actor,
    internalCategoryRefs: [...candidate.binding.internalCategoryRefs].sort(),
  });
}

function scopeRef(signature: string): string {
  return `promotion_scope_${createHash("sha256").update(signature).digest("hex").slice(0, 24)}`;
}

type ScopeGroup = Readonly<{
  signature: string;
  ref: string;
  candidates: readonly PromotionTemplateSelectorCandidate[];
}>;

function groupScopes(candidates: readonly PromotionTemplateSelectorCandidate[]): readonly ScopeGroup[] {
  if (!Array.isArray(candidates) || candidates.length > 100) fail("catalog_integrity_rejected");
  const groups = new Map<string, PromotionTemplateSelectorCandidate[]>();
  const refs = new Map<string, string>();
  for (const candidate of candidates) {
    if (candidate.binding.internalCategoryRefs.length === 0) continue;
    const signature = scopeSignature(candidate);
    const ref = scopeRef(signature);
    const prior = refs.get(ref);
    if (prior && prior !== signature) fail("catalog_integrity_rejected");
    refs.set(ref, signature);
    const group = groups.get(signature) ?? [];
    group.push(candidate);
    groups.set(signature, group);
  }
  return Object.freeze([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([signature, group]) =>
    Object.freeze({ signature, ref: scopeRef(signature), candidates: Object.freeze(group) })));
}

function publicCatalog(candidates: readonly PromotionTemplateSelectorCandidate[]): PromotionTemplateAuthoringCatalog {
  const scopes = groupScopes(candidates).map((group, index) => {
    const first = group.candidates[0]!;
    const postTypes = [...new Set(group.candidates.flatMap((candidate) => candidate.template.postTypes))].sort() as PostType[];
    const instructionAliases = [...new Set(group.candidates.flatMap((candidate) => [
      ...candidate.template.aliases,
      ...candidate.preset.aliases,
    ]))].sort((left, right) => left.localeCompare(right, "tr-TR"));
    return Object.freeze({
      scopeRef: group.ref,
      label: `Kapsam ${index + 1} · ${first.binding.actor.type === "page" ? "Page" : "Instagram"} · ${first.binding.internalCategoryRefs.length} kategori`,
      actorType: first.binding.actor.type,
      categoryCount: first.binding.internalCategoryRefs.length,
      postTypes: Object.freeze(postTypes),
      instructionAliases: Object.freeze(instructionAliases),
    });
  });
  return deepFreeze({ scopes });
}

function capabilities(role: WorkspaceRole): PromotionTemplateAuthoringCapabilities {
  return Object.freeze({
    canRead: true as const,
    canDryRun: can(role, "promotion:draft"),
    canPersistDraft: false as const,
    canPublish: false as const,
    canWriteMeta: false as const,
    canChangeTargeting: false as const,
    canGenerateCreative: false as const,
    canProposeAction: false as const,
    canGrantApproval: false as const,
  });
}

function verifyPublishedCandidates(
  candidates: readonly PromotionTemplateSelectorCandidate[],
  workspaceRef: string,
  evaluatedAt: string,
): void {
  try {
    // The all-null request is intentionally unresolved, but the selector still
    // reconstructs and verifies every published candidate before asking questions.
    dryRunPromotionTemplateSelection({ version: PROMOTION_TEMPLATE_SELECTOR_VERSION, workspaceRef, evaluatedAt,
      accountRef: null, actor: null, internalCategoryRefs: null, postType: null, instruction: null }, candidates);
  } catch {
    fail("catalog_integrity_rejected");
  }
}

function selection(value: unknown): PromotionTemplateAuthoringSelection {
  exact(value, ["scopeRef", "postType", "instruction"]);
  if (value.scopeRef !== null && (typeof value.scopeRef !== "string" || !PROMOTION_SCOPE_REF.test(value.scopeRef))) fail("invalid_input");
  if (value.postType !== null && (typeof value.postType !== "string" || !POST_TYPES.has(value.postType as PostType))) {
    fail("invalid_input");
  }
  if (value.instruction !== null && (typeof value.instruction !== "string" || !INSTRUCTION.test(value.instruction)
    || value.instruction.trim() !== value.instruction)) fail("invalid_input");
  return Object.freeze(value as unknown as PromotionTemplateAuthoringSelection);
}

/**
 * Role-aware, read-only authoring preview over immutable published documents.
 * The caller supplies only an opaque server-issued scope ref; account, actor,
 * categories, workspace and evaluated time are resolved on the server.
 */
export class PromotionTemplateAuthoringService {
  constructor(
    private readonly catalog: PublishedPromotionTemplateCatalog,
    private readonly workspaceRef: string,
    private readonly memberships: readonly WorkspaceMembership[],
  ) {
    if (!REF.test(workspaceRef)) fail("invalid_input");
  }

  async inspect(principal: TrustedDecisionRoomPrincipal, evaluatedAtValue: string): Promise<PromotionTemplateAuthoringInspection> {
    if (principal.workspaceRef !== this.workspaceRef) fail("workspace_scope_mismatch");
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "data:read", this.memberships);
    const evaluatedAt = instant(evaluatedAtValue);
    const candidates = await this.catalog.listPublished({ workspaceRef: this.workspaceRef, evaluatedAt });
    verifyPublishedCandidates(candidates, this.workspaceRef, evaluatedAt);
    return deepFreeze({ contractVersion: PROMOTION_TEMPLATE_AUTHORING_VERSION, catalog: publicCatalog(candidates),
      role: membership.role, capabilities: capabilities(membership.role), lifecycle: LIFECYCLE });
  }

  async dryRun(
    principal: TrustedDecisionRoomPrincipal,
    selectionValue: PromotionTemplateAuthoringSelection,
    evaluatedAtValue: string,
  ): Promise<PromotionTemplateAuthoringDryRunEnvelope> {
    if (principal.workspaceRef !== this.workspaceRef) fail("workspace_scope_mismatch");
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "promotion:draft", this.memberships);
    const command = selection(selectionValue);
    const evaluatedAt = instant(evaluatedAtValue);
    const candidates = await this.catalog.listPublished({ workspaceRef: this.workspaceRef, evaluatedAt });
    const groups = groupScopes(candidates);
    const group = command.scopeRef === null ? null : groups.find((candidate) => candidate.ref === command.scopeRef);
    if (command.scopeRef !== null && !group) fail("invalid_input");
    const first = group?.candidates[0] ?? null;
    let result: PromotionTemplateSelectionDryRun;
    try {
      result = dryRunPromotionTemplateSelection({
        version: PROMOTION_TEMPLATE_SELECTOR_VERSION,
        workspaceRef: this.workspaceRef,
        evaluatedAt,
        accountRef: first?.binding.accountRef ?? null,
        actor: first?.binding.actor ?? null,
        internalCategoryRefs: first?.binding.internalCategoryRefs ?? null,
        postType: command.postType,
        instruction: command.instruction,
      }, candidates);
    } catch (reason) {
      if (reason instanceof PromotionTemplateSelectorError && reason.code === "invalid_input") fail("invalid_input");
      fail("catalog_integrity_rejected");
    }
    return deepFreeze({ contractVersion: PROMOTION_TEMPLATE_AUTHORING_VERSION, result, role: membership.role,
      capabilities: capabilities(membership.role), lifecycle: LIFECYCLE });
  }
}
