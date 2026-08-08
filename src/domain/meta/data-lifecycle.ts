import { createHash, createHmac, randomUUID } from "node:crypto";

export const META_DATA_LIFECYCLE_POLICY_VERSION = "meta-data-lifecycle/v1" as const;

export const META_DATA_LIFECYCLE_POLICY = Object.freeze({
  version: META_DATA_LIFECYCLE_POLICY_VERSION,
  rawRetentionMode: "hash_only" as const,
  rawRetentionDays: 0 as const,
  canonicalContentAllowed: true as const,
  hardWorkspaceDeleteAllowed: false as const,
  auditMutationAllowed: false as const,
});

export type MetaPersistencePolicyViolationCode =
  | "RAW_PAYLOAD_FIELD"
  | "SECRET_FIELD"
  | "NON_HASH_RAW_MATERIAL";

export type MetaPersistencePolicyViolation = Readonly<{
  code: MetaPersistencePolicyViolationCode;
  path: string;
}>;

export type MetaPersistencePolicyReport = Readonly<{
  policyVersion: typeof META_DATA_LIFECYCLE_POLICY_VERSION;
  compliant: boolean;
  violationCodes: readonly MetaPersistencePolicyViolationCode[];
  violations: readonly MetaPersistencePolicyViolation[];
}>;

const FORBIDDEN_RAW_KEYS = new Set([
  "apipayload",
  "graphpayload",
  "metapayload",
  "rawjson",
  "rawpayload",
  "rawrequest",
  "rawresponse",
  "sourcepayload",
  "upstreamrequest",
  "upstreamresponse",
]);

const FORBIDDEN_SECRET_KEYS = new Set([
  "accesstoken",
  "authorization",
  "clientsecret",
  "metacesstoken",
  "metaaccesstoken",
  "refreshtoken",
]);

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isHashKey(key: string): boolean {
  return normalizedKey(key).endsWith("hash");
}

/**
 * Checks a proposed canonical persistence object before it reaches a repository.
 * Extracted fields such as ad body/caption are allowed; opaque Meta/Graph payloads
 * and credentials are not. Hash-only provenance fields remain allowed.
 */
export function inspectMetaPersistenceWrite(value: unknown): MetaPersistencePolicyReport {
  const violations: MetaPersistencePolicyViolation[] = [];
  const visited = new WeakSet<object>();

  const visit = (candidate: unknown, path: string): void => {
    if (candidate === null || candidate === undefined || typeof candidate !== "object") return;
    if (visited.has(candidate)) return;
    visited.add(candidate);

    if (candidate instanceof Uint8Array || candidate instanceof ArrayBuffer) {
      violations.push({ code: "NON_HASH_RAW_MATERIAL", path });
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(candidate as Record<string, unknown>)) {
      const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
      const normalized = normalizedKey(key);
      if (FORBIDDEN_SECRET_KEYS.has(normalized) || normalized.endsWith("token")) {
        violations.push({ code: "SECRET_FIELD", path: childPath });
        continue;
      }
      if (FORBIDDEN_RAW_KEYS.has(normalized) && !isHashKey(key)) {
        violations.push({ code: "RAW_PAYLOAD_FIELD", path: childPath });
        continue;
      }
      visit(child, childPath);
    }
  };

  visit(value, "$");
  const sorted = violations.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze({
    policyVersion: META_DATA_LIFECYCLE_POLICY_VERSION,
    compliant: sorted.length === 0,
    violationCodes: Object.freeze([...new Set(sorted.map((item) => item.code))].sort()),
    violations: Object.freeze(sorted.map((item) => Object.freeze({ ...item }))),
  });
}

export class MetaPersistencePolicyError extends Error {
  constructor(readonly report: MetaPersistencePolicyReport) {
    super("Meta kalıcılık girdisi hash-only politikasını ihlal ediyor");
    this.name = "MetaPersistencePolicyError";
  }
}

export function assertHashOnlyMetaPersistence(value: unknown): void {
  const report = inspectMetaPersistenceWrite(value);
  if (!report.compliant) throw new MetaPersistencePolicyError(report);
}

export type RawMaterialKind = "graph_response" | "request_capture" | "debug_capture" | "temporary_export";

export type RawMaterialCandidate = Readonly<{
  /** Repository-private identity. Never return this value from the service. */
  internalRef: string;
  kind: RawMaterialKind;
  capturedAt: string;
}>;

export type RawMaterialInventory = Readonly<{
  revision: string;
  candidates: readonly RawMaterialCandidate[];
}>;

export type RawMaterialScope = Readonly<{
  workspaceId: string;
  connectionId?: string;
}>;

export type RawMaterialPurgePort = Readonly<{
  inspect(scope: RawMaterialScope): Promise<RawMaterialInventory>;
  /** Must compare expectedRevision and delete atomically in a short transaction. */
  purge(input: Readonly<{
    scope: RawMaterialScope;
    expectedRevision: string;
    internalRefs: readonly string[];
  }>): Promise<Readonly<{ deleted: number; revision: string }>>;
}>;

export type RawMaterialPurgeApprovalPort = Readonly<{
  /** Application-owned verifier; an agent cannot self-assert authorization. */
  authorize(input: Readonly<{
    approvalRef: string;
    planRef: string;
    scopeRef: string;
    expectedRevision: string;
    candidateCount: number;
  }>): Promise<boolean>;
}>;

export type PublicRawMaterialPurgePreview = Readonly<{
  policyVersion: typeof META_DATA_LIFECYCLE_POLICY_VERSION;
  planRef: string;
  scopeRef: string;
  mode: "dry_run";
  candidateCount: number;
  candidatesByKind: Readonly<Record<RawMaterialKind, number>>;
  issuedAt: string;
  expiresAt: string;
}>;

export type PublicRawMaterialPurgeResult = Readonly<{
  policyVersion: typeof META_DATA_LIFECYCLE_POLICY_VERSION;
  planRef: string;
  scopeRef: string;
  mode: "execute";
  deletedCount: number;
  executedAt: string;
}>;

type InternalPurgePlan = Readonly<{
  planRef: string;
  scope: RawMaterialScope;
  scopeRef: string;
  expectedRevision: string;
  internalRefs: readonly string[];
  issuedAt: string;
  expiresAt: string;
  consumed: boolean;
}>;

export class RawMaterialPurgeBoundaryError extends Error {
  constructor(readonly code: "invalid_scope" | "approval_required" | "plan_missing" | "plan_expired" | "plan_consumed" | "revision_changed") {
    super(`Raw material purge reddedildi: ${code}`);
    this.name = "RawMaterialPurgeBoundaryError";
  }
}

function validTime(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RawMaterialPurgeBoundaryError("invalid_scope");
  return parsed;
}

function publicRef(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function candidateCounts(candidates: readonly RawMaterialCandidate[]): Record<RawMaterialKind, number> {
  const counts: Record<RawMaterialKind, number> = {
    graph_response: 0,
    request_capture: 0,
    debug_capture: 0,
    temporary_export: 0,
  };
  for (const candidate of candidates) counts[candidate.kind] += 1;
  return counts;
}

/**
 * Keeps repository identities inside the process. Execution requires a prior,
 * unexpired dry-run plus a separately supplied approval reference.
 */
export class RawMaterialPurgeBoundary {
  private readonly plans = new Map<string, InternalPurgePlan>();

  constructor(
    private readonly port: RawMaterialPurgePort,
    private readonly approvals: RawMaterialPurgeApprovalPort,
    private readonly planTtlMs = 15 * 60 * 1000,
  ) {}

  async dryRun(scope: RawMaterialScope, now: string): Promise<PublicRawMaterialPurgePreview> {
    if (!scope.workspaceId || (scope.connectionId !== undefined && !scope.connectionId)) {
      throw new RawMaterialPurgeBoundaryError("invalid_scope");
    }
    const nowMs = validTime(now);
    const inventory = await this.port.inspect(scope);
    for (const candidate of inventory.candidates) validTime(candidate.capturedAt);
    const planRef = `purge_${randomUUID()}`;
    const scopeRef = publicRef("scope", `${scope.workspaceId}:${scope.connectionId ?? "all"}`);
    const expiresAt = new Date(nowMs + this.planTtlMs).toISOString();
    this.plans.set(planRef, Object.freeze({
      planRef,
      scope: Object.freeze({ ...scope }),
      scopeRef,
      expectedRevision: inventory.revision,
      internalRefs: Object.freeze(inventory.candidates.map((item) => item.internalRef)),
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt,
      consumed: false,
    }));
    return Object.freeze({
      policyVersion: META_DATA_LIFECYCLE_POLICY_VERSION,
      planRef,
      scopeRef,
      mode: "dry_run",
      candidateCount: inventory.candidates.length,
      candidatesByKind: Object.freeze(candidateCounts(inventory.candidates)),
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt,
    });
  }

  async execute(input: Readonly<{
    planRef: string;
    approvalRef: string;
    now: string;
  }>): Promise<PublicRawMaterialPurgeResult> {
    if (!input.approvalRef) throw new RawMaterialPurgeBoundaryError("approval_required");
    const plan = this.plans.get(input.planRef);
    if (!plan) throw new RawMaterialPurgeBoundaryError("plan_missing");
    if (plan.consumed) throw new RawMaterialPurgeBoundaryError("plan_consumed");
    const nowMs = validTime(input.now);
    if (nowMs > Date.parse(plan.expiresAt)) throw new RawMaterialPurgeBoundaryError("plan_expired");
    if (!await this.approvals.authorize({
      approvalRef: input.approvalRef,
      planRef: plan.planRef,
      scopeRef: plan.scopeRef,
      expectedRevision: plan.expectedRevision,
      candidateCount: plan.internalRefs.length,
    })) throw new RawMaterialPurgeBoundaryError("approval_required");

    const latest = await this.port.inspect(plan.scope);
    if (latest.revision !== plan.expectedRevision) throw new RawMaterialPurgeBoundaryError("revision_changed");
    const result = await this.port.purge({
      scope: plan.scope,
      expectedRevision: plan.expectedRevision,
      internalRefs: plan.internalRefs,
    });
    this.plans.set(plan.planRef, Object.freeze({ ...plan, consumed: true }));
    return Object.freeze({
      policyVersion: META_DATA_LIFECYCLE_POLICY_VERSION,
      planRef: plan.planRef,
      scopeRef: plan.scopeRef,
      mode: "execute",
      deletedCount: result.deleted,
      executedAt: new Date(nowMs).toISOString(),
    });
  }
}

export type WorkspaceLifecycleState = "active" | "tombstoning" | "tombstoned";

export type WorkspaceTombstonePlan = Readonly<{
  policyVersion: typeof META_DATA_LIFECYCLE_POLICY_VERSION;
  workspaceRef: string;
  currentState: WorkspaceLifecycleState;
  targetState: "tombstoned";
  hardDelete: false;
  steps: readonly Readonly<{
    order: number;
    action: "append_request_audit" | "disable_connections" | "destroy_secrets" | "pseudonymize_canonical_data" | "append_completion_audit" | "mark_tombstoned";
  }>[];
  schemaPrerequisites: readonly (
    | "workspace_lifecycle_state"
    | "workspace_tombstoned_at"
    | "audit_workspace_fk_restrict"
    | "dedicated_lifecycle_actor"
  )[];
}>;

export function pseudonymizeWorkspaceValue(input: Readonly<{
  workspaceId: string;
  namespace: string;
  value: string;
  key: Uint8Array;
  keyVersion: number;
}>): string {
  if (!input.workspaceId || !input.namespace || !input.value || input.key.byteLength < 32 || input.keyVersion < 1) {
    throw new Error("Pseudonymization girdisi geçersiz");
  }
  const digest = createHmac("sha256", input.key)
    .update(`${input.workspaceId}\u0000${input.namespace}\u0000${input.value}`)
    .digest("hex")
    .slice(0, 24);
  return `anon_v${input.keyVersion}_${digest}`;
}

/** Pure plan only: it never mutates audit rows or deletes a workspace. */
export function buildWorkspaceTombstonePlan(input: Readonly<{
  workspaceId: string;
  currentState: WorkspaceLifecycleState;
}>): WorkspaceTombstonePlan {
  if (!input.workspaceId) throw new Error("Workspace kapsamı gerekli");
  return Object.freeze({
    policyVersion: META_DATA_LIFECYCLE_POLICY_VERSION,
    workspaceRef: publicRef("workspace", input.workspaceId),
    currentState: input.currentState,
    targetState: "tombstoned",
    hardDelete: false,
    steps: Object.freeze([
      Object.freeze({ order: 1, action: "append_request_audit" as const }),
      Object.freeze({ order: 2, action: "disable_connections" as const }),
      Object.freeze({ order: 3, action: "destroy_secrets" as const }),
      Object.freeze({ order: 4, action: "pseudonymize_canonical_data" as const }),
      Object.freeze({ order: 5, action: "append_completion_audit" as const }),
      Object.freeze({ order: 6, action: "mark_tombstoned" as const }),
    ]),
    schemaPrerequisites: Object.freeze([
      "workspace_lifecycle_state" as const,
      "workspace_tombstoned_at" as const,
      "audit_workspace_fk_restrict" as const,
      "dedicated_lifecycle_actor" as const,
    ]),
  });
}
