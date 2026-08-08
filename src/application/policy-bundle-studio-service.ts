import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { validateExistingPostPromotionCatalog, type ExistingPostPromotionCatalog,
  type ExistingPostPromotionCatalogRepository, type PromotionCatalogOption } from "@/application/existing-post-promotion-catalog";
import { createActionGuardrailPolicyDraft, reviseActionGuardrailPolicyDraft,
  type ActionGuardrailPolicyRevision } from "@/domain/actions/action-guardrail-policy";
import { ACTION_APPROVAL_POLICY_VERSION, type ApprovalPolicy, type ActionActorRole,
  type ActionApprovalRole } from "@/domain/actions/approval-lifecycle";
import { createApprovalPolicyDraft, reviseApprovalPolicyDraft,
  type ApprovalPolicyDefinitionRevision } from "@/domain/actions/approval-policy-registry";
import type { AutonomyRule } from "@/domain/actions/autonomy-valve";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const POLICY_BUNDLE_STUDIO_VERSION = "policy-bundle-studio/1.1.0" as const;

export type ApprovalPolicyDraftRequest = Readonly<{
  kind: "approval_policy";
  policyRef: string;
  requesterRoles: readonly Extract<ActionActorRole, "owner" | "admin" | "analyst">[];
  approverRoles: readonly Extract<ActionApprovalRole, "owner" | "admin">[];
  grantConsumerRoles: readonly Extract<ActionApprovalRole, "owner" | "admin">[];
  separationOfDuties: boolean;
  maximumProtectionEvidenceAgeSeconds: number;
  maximumProposalLifetimeSeconds: number;
  maximumGrantLifetimeSeconds: number;
  effectiveFrom: string;
  expiresAt: string | null;
}>;
export type GuardrailPolicyDraftRequest = Readonly<{
  kind: "guardrail_policy";
  policyRef: string;
  accountRef: string;
  campaignRef: string;
  adSetRef: string;
  internalCategoryRefs: readonly string[];
  denyAction: boolean;
  denyClauseRef: string | null;
  effectiveFrom: string;
  expiresAt: string | null;
  sourceGuidanceRefs: readonly string[];
}>;
export type PolicyBundleDraftRequest = ApprovalPolicyDraftRequest | GuardrailPolicyDraftRequest;

export type PublicApprovalPolicyRevision = Readonly<{
  kind: "approval_policy";
  policyRef: string;
  revision: number;
  state: ApprovalPolicyDefinitionRevision["state"];
  effectiveFrom: string;
  expiresAt: string | null;
  requesterRoles: readonly ActionActorRole[];
  approverRoles: readonly ActionApprovalRole[];
  grantConsumerRoles: readonly ActionApprovalRole[];
  separationOfDuties: boolean;
  maximumProtectionEvidenceAgeSeconds: number;
  maximumProposalLifetimeSeconds: number;
  maximumGrantLifetimeSeconds: number;
  normalizedByRole: string;
  publishedByRole: string | null;
}>;
export type PublicGuardrailPolicyRevision = Readonly<{
  kind: "guardrail_policy";
  policyRef: string;
  revision: number;
  state: ActionGuardrailPolicyRevision["state"];
  effectiveFrom: string;
  expiresAt: string | null;
  accountRefs: readonly string[];
  campaignRefs: readonly string[];
  entities: readonly Readonly<{ level: "campaign" | "adset" | "ad"; ref: string }>[];
  internalCategoryRefs: readonly string[];
  geoRefs: readonly string[];
  denyAction: boolean;
  sourceGuidanceRefs: readonly string[];
  normalizedByRole: string;
  publishedByRole: string | null;
}>;

export type PolicyBundleScopeCatalog = Readonly<{
  accounts: readonly PromotionCatalogOption[];
  adSets: readonly Readonly<PromotionCatalogOption & { accountRef: string; campaignRef: string }>[];
  internalCategories: readonly PromotionCatalogOption[];
}>;
export type PolicyBundleStudioAuthority = Readonly<{ canDraft: boolean; canStartPublicationCeremony: boolean;
  canPublish: false; canDisable: false;
  canApproveAction: false; canGrant: false; canExecute: false; canWriteMeta: false }>;
function authority(canDraft: boolean, canStartPublicationCeremony = false): PolicyBundleStudioAuthority {
  return Object.freeze({ canDraft, canStartPublicationCeremony, canPublish: false, canDisable: false,
    canApproveAction: false, canGrant: false, canExecute: false, canWriteMeta: false });
}
export type PolicyBundleStudioResult = Readonly<{
  contractVersion: typeof POLICY_BUNDLE_STUDIO_VERSION;
  approvalPolicies: readonly PublicApprovalPolicyRevision[];
  guardrails: readonly PublicGuardrailPolicyRevision[];
  scopeCatalog: PolicyBundleScopeCatalog;
  readiness: Readonly<{
    approvalPolicy: "missing" | "draft" | "published" | "disabled" | "inactive" | "ambiguous";
    guardrail: "missing" | "draft" | "published" | "disabled" | "inactive" | "ambiguous";
    workspaceAutonomy: "missing" | "published_approval_only";
    authenticEvidence: "evaluated_per_proposal";
    compatibility: "evaluated_per_selection";
    policyBundleReady: boolean;
    /** Always false in the scope-free studio; only a concrete selection can prove this. */
    proposalReady: false;
  }>;
  authority: PolicyBundleStudioAuthority;
}>;

export type PolicyBundleStudioRepository<T> = Readonly<{
  listArtifacts(): Promise<readonly T[]>;
  latestArtifact(policyRef: string): Promise<T | null>;
  append(artifact: T): Promise<unknown>;
}>;
type AutonomyPort = Readonly<{ resolve(): Promise<readonly AutonomyRule[]> }>;

export class PolicyBundleStudioError extends Error {
  constructor(readonly code: "invalid_input" | "source_unavailable" | "draft_exists" | "scope_unavailable") {
    super("K4 policy bundle güvenli biçimde işlenemedi");
    this.name = "PolicyBundleStudioError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new PolicyBundleStudioError("invalid_input");
  }
}
function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) throw new PolicyBundleStudioError("invalid_input");
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new PolicyBundleStudioError("invalid_input");
  }
  return value;
}
function refs(value: unknown, allowed?: ReadonlySet<string>): readonly string[] {
  if (!Array.isArray(value) || value.length > 100 || new Set(value).size !== value.length
    || value.some((item) => typeof item !== "string" || !REF.test(item) || allowed && !allowed.has(item))) {
    throw new PolicyBundleStudioError("invalid_input");
  }
  return Object.freeze([...(value as string[])].sort());
}
function enumValues<T extends string>(value: unknown, allowed: ReadonlySet<T>): readonly T[] {
  if (!Array.isArray(value) || value.length > 20 || new Set(value).size !== value.length
    || value.some((item) => typeof item !== "string" || !allowed.has(item as T))) {
    throw new PolicyBundleStudioError("invalid_input");
  }
  return Object.freeze([...(value as T[])].sort());
}
function authorRole(value: WorkspaceMembership["role"]): "owner" | "admin" | "analyst" {
  if (value === "owner" || value === "admin" || value === "analyst") return value;
  throw new PolicyBundleStudioError("invalid_input");
}
function approvalProjection(value: ApprovalPolicyDefinitionRevision): PublicApprovalPolicyRevision {
  const approvers = value.policy.approverRoles.find((item) => item.risk === "K4")?.roles ?? [];
  return Object.freeze({ kind: "approval_policy", policyRef: value.policyRef, revision: value.revision, state: value.state,
    effectiveFrom: value.effectiveFrom, expiresAt: value.expiresAt,
    requesterRoles: Object.freeze([...value.policy.requesterRoles]), approverRoles: Object.freeze([...approvers]),
    grantConsumerRoles: Object.freeze([...value.policy.grantConsumerRoles]),
    separationOfDuties: value.policy.separationOfDutiesRisks.includes("K4"),
    maximumProtectionEvidenceAgeSeconds: value.policy.maximumProtectionEvidenceAgeSeconds,
    maximumProposalLifetimeSeconds: value.policy.maximumProposalLifetimeSeconds,
    maximumGrantLifetimeSeconds: value.policy.maximumGrantLifetimeSeconds,
    normalizedByRole: value.provenance.normalizedByRole,
    publishedByRole: value.provenance.publishedByRole });
}
function guardrailProjection(value: ActionGuardrailPolicyRevision): PublicGuardrailPolicyRevision {
  return Object.freeze({ kind: "guardrail_policy", policyRef: value.policyRef, revision: value.revision, state: value.state,
    effectiveFrom: value.effectiveFrom, expiresAt: value.expiresAt,
    accountRefs: Object.freeze([...value.selector.accountRefs]), campaignRefs: Object.freeze([...value.selector.campaignRefs]),
    entities: Object.freeze(value.selector.entities.map((item) => Object.freeze({ ...item }))),
    internalCategoryRefs: Object.freeze([...value.selector.internalCategoryRefs]), geoRefs: Object.freeze([...value.selector.geoRefs]),
    denyAction: value.clauses.some((clause) => clause.kind === "deny_action"),
    sourceGuidanceRefs: Object.freeze([...value.provenance.sourceGuidanceRefs]),
    normalizedByRole: value.provenance.normalizedByRole, publishedByRole: value.provenance.publishedByRole });
}
function latestState<T extends { policyRef: string; revision: number; state: "draft" | "published" | "disabled";
  effectiveFrom: string; expiresAt: string | null }>(values: readonly T[], evaluatedAt: string):
  "missing" | "draft" | "published" | "disabled" | "inactive" | "ambiguous" {
  if (values.length === 0) return "missing";
  const latestByPolicy = new Map<string, T>();
  for (const value of values) {
    const current = latestByPolicy.get(value.policyRef);
    if (!current || value.revision > current.revision) latestByPolicy.set(value.policyRef, value);
  }
  const latest = [...latestByPolicy.values()];
  const activePublished = latest.filter((item) => item.state === "published"
    && item.effectiveFrom <= evaluatedAt && (item.expiresAt === null || item.expiresAt > evaluatedAt));
  if (activePublished.length > 1) return "ambiguous";
  if (activePublished.length === 1) return "published";
  if (latest.some((item) => item.state === "draft")) return "draft";
  if (latest.some((item) => item.state === "published")) return "inactive";
  return "disabled";
}
function publicCatalog(catalog: ExistingPostPromotionCatalog): PolicyBundleScopeCatalog {
  return Object.freeze({ accounts: Object.freeze(catalog.accounts.map((item) => Object.freeze({ ...item }))),
    adSets: Object.freeze(catalog.adSets.map((item) => Object.freeze({ ...item }))),
    internalCategories: Object.freeze(catalog.internalCategories.map((item) => Object.freeze({ ...item }))) });
}

export class PolicyBundleStudioService {
  constructor(private readonly approvals: PolicyBundleStudioRepository<ApprovalPolicyDefinitionRevision>,
    private readonly guardrails: PolicyBundleStudioRepository<ActionGuardrailPolicyRevision>,
    private readonly autonomy: AutonomyPort, private readonly catalog: ExistingPostPromotionCatalogRepository,
    private readonly memberships: readonly WorkspaceMembership[], private readonly clock: () => string = () => new Date().toISOString()) {}

  private async sources(principal: TrustedDecisionRoomPrincipal) {
    try {
      const [approvalPolicies, guardrails, autonomyRules, catalog] = await Promise.all([
        this.approvals.listArtifacts(), this.guardrails.listArtifacts(), this.autonomy.resolve(),
        this.catalog.list({ workspaceId: principal.workspaceId }),
      ]);
      return { approvalPolicies, guardrails, autonomyRules, catalog: validateExistingPostPromotionCatalog(catalog) };
    } catch { throw new PolicyBundleStudioError("source_unavailable"); }
  }

  async list(principal: TrustedDecisionRoomPrincipal): Promise<PolicyBundleStudioResult> {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "policy_bundle:read", this.memberships);
    const source = await this.sources(principal);
    const evaluatedAt = this.clock();
    const approvalPolicy = latestState(source.approvalPolicies, evaluatedAt);
    const guardrail = latestState(source.guardrails, evaluatedAt);
    const workspaceAutonomy = source.autonomyRules.some((rule) => rule.state === "published"
      && rule.scope.level === "workspace" && rule.scope.ref === principal.workspaceRef
      && rule.mode === "approval_only" && !rule.killSwitch && rule.effectiveFrom <= evaluatedAt
      && (rule.expiresAt === null || rule.expiresAt > evaluatedAt)) ? "published_approval_only" : "missing";
    return Object.freeze({ contractVersion: POLICY_BUNDLE_STUDIO_VERSION,
      approvalPolicies: Object.freeze(source.approvalPolicies.map(approvalProjection)),
      guardrails: Object.freeze(source.guardrails.map(guardrailProjection)), scopeCatalog: publicCatalog(source.catalog),
      readiness: Object.freeze({ approvalPolicy, guardrail, workspaceAutonomy,
        authenticEvidence: "evaluated_per_proposal" as const,
        compatibility: "evaluated_per_selection" as const,
        policyBundleReady: approvalPolicy === "published" && guardrail === "published"
          && workspaceAutonomy === "published_approval_only", proposalReady: false as const }),
      authority: authority(membership.role !== "viewer", membership.role === "owner" || membership.role === "admin") });
  }

  async createDraft(principal: TrustedDecisionRoomPrincipal, request: PolicyBundleDraftRequest) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "policy_bundle:draft", this.memberships);
    if (!(membership.role === "owner" || membership.role === "admin" || membership.role === "analyst")) {
      throw new PolicyBundleStudioError("invalid_input");
    }
    if (request.kind === "approval_policy") return this.createApprovalDraft(principal, membership, request);
    if (request.kind === "guardrail_policy") return this.createGuardrailDraft(principal, membership, request);
    throw new PolicyBundleStudioError("invalid_input");
  }

  private async createApprovalDraft(principal: TrustedDecisionRoomPrincipal, membership: WorkspaceMembership,
    request: ApprovalPolicyDraftRequest) {
    exact(request, ["kind", "policyRef", "requesterRoles", "approverRoles", "grantConsumerRoles",
      "separationOfDuties", "maximumProtectionEvidenceAgeSeconds", "maximumProposalLifetimeSeconds",
      "maximumGrantLifetimeSeconds", "effectiveFrom", "expiresAt"]);
    const policyRef = ref(request.policyRef); const latest = await this.approvals.latestArtifact(policyRef);
    if (latest?.state === "draft") throw new PolicyBundleStudioError("draft_exists");
    const requesterRoles = enumValues(request.requesterRoles, new Set(["owner", "admin", "analyst"] as const)) as ApprovalPolicy["requesterRoles"];
    const approverRoles = enumValues(request.approverRoles, new Set(["owner", "admin"] as const)) as readonly ActionApprovalRole[];
    const grantConsumerRoles = enumValues(request.grantConsumerRoles, new Set(["owner", "admin"] as const)) as readonly ActionApprovalRole[];
    if (requesterRoles.length === 0 || approverRoles.length === 0 || grantConsumerRoles.length === 0) {
      throw new PolicyBundleStudioError("invalid_input");
    }
    const revision = latest ? latest.revision + 1 : 1;
    const policy: ApprovalPolicy = Object.freeze({ version: ACTION_APPROVAL_POLICY_VERSION, policyRef, revision,
      autonomyMode: "approval_only", requesterRoles,
      approverRoles: Object.freeze([{ risk: "K4" as const, roles: approverRoles }]), grantConsumerRoles,
      separationOfDutiesRisks: Object.freeze(request.separationOfDuties ? ["K4" as const] : []),
      maximumProtectionEvidenceAgeSeconds: request.maximumProtectionEvidenceAgeSeconds,
      maximumProposalLifetimeSeconds: request.maximumProposalLifetimeSeconds,
      maximumGrantLifetimeSeconds: request.maximumGrantLifetimeSeconds });
    const normalizedBy = { actorRef: principal.readerRef, role: authorRole(membership.role) } as const;
    const artifact = latest ? reviseApprovalPolicyDraft({ current: latest, policy,
      effectiveFrom: instant(request.effectiveFrom), expiresAt: request.expiresAt === null ? null : instant(request.expiresAt),
      normalizedBy }) : createApprovalPolicyDraft({ workspaceRef: principal.workspaceRef, policy,
      effectiveFrom: instant(request.effectiveFrom), expiresAt: request.expiresAt === null ? null : instant(request.expiresAt),
      normalizedBy });
    await this.approvals.append(artifact);
    return Object.freeze({ contractVersion: POLICY_BUNDLE_STUDIO_VERSION, item: approvalProjection(artifact),
      authority: authority(true, membership.role === "owner" || membership.role === "admin") });
  }

  private async createGuardrailDraft(principal: TrustedDecisionRoomPrincipal, membership: WorkspaceMembership,
    request: GuardrailPolicyDraftRequest) {
    exact(request, ["kind", "policyRef", "accountRef", "campaignRef", "adSetRef", "internalCategoryRefs",
      "denyAction", "denyClauseRef", "effectiveFrom", "expiresAt", "sourceGuidanceRefs"]);
    const policyRef = ref(request.policyRef); const latest = await this.guardrails.latestArtifact(policyRef);
    if (latest?.state === "draft") throw new PolicyBundleStudioError("draft_exists");
    let catalog: ExistingPostPromotionCatalog;
    try { catalog = validateExistingPostPromotionCatalog(await this.catalog.list({ workspaceId: principal.workspaceId })); }
    catch { throw new PolicyBundleStudioError("source_unavailable"); }
    const accountRef = ref(request.accountRef); const campaignRef = ref(request.campaignRef); const adSetRef = ref(request.adSetRef);
    const selectedAdSet = catalog.adSets.find((item) => item.ref === adSetRef);
    if (!catalog.accounts.some((item) => item.ref === accountRef) || !selectedAdSet
      || selectedAdSet.accountRef !== accountRef || selectedAdSet.campaignRef !== campaignRef) {
      throw new PolicyBundleStudioError("scope_unavailable");
    }
    const categoryRefs = refs(request.internalCategoryRefs, new Set(catalog.internalCategories.map((item) => item.ref)));
    const clauses = request.denyAction
      ? [Object.freeze({ clauseRef: ref(request.denyClauseRef), kind: "deny_action" as const })] : [];
    if (!request.denyAction && request.denyClauseRef !== null) throw new PolicyBundleStudioError("invalid_input");
    const selector = Object.freeze({ actionTypes: Object.freeze(["existing_post_promotion" as const]),
      accountRefs: Object.freeze([accountRef]), campaignRefs: Object.freeze([campaignRef]),
      entities: Object.freeze([Object.freeze({ level: "adset" as const, ref: adSetRef })]),
      internalCategoryRefs: categoryRefs, geoRefs: Object.freeze([]) });
    const effectiveFrom = instant(request.effectiveFrom);
    const expiresAt = request.expiresAt === null ? null : instant(request.expiresAt);
    const normalizedBy = { actorRef: principal.readerRef, role: authorRole(membership.role) } as const;
    const sourceGuidanceRefs = refs(request.sourceGuidanceRefs);
    const artifact = latest ? reviseActionGuardrailPolicyDraft({ current: latest, effectiveFrom, expiresAt,
      selector, clauses, normalizedBy, sourceGuidanceRefs }) : createActionGuardrailPolicyDraft({
      workspaceRef: principal.workspaceRef, policyRef, revision: 1, previousHash: null, effectiveFrom, expiresAt,
      selector, clauses, normalizedBy, sourceGuidanceRefs });
    await this.guardrails.append(artifact);
    return Object.freeze({ contractVersion: POLICY_BUNDLE_STUDIO_VERSION, item: guardrailProjection(artifact),
      authority: authority(true, membership.role === "owner" || membership.role === "admin") });
  }
}
