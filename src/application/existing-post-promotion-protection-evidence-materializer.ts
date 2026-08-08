import { createHash } from "node:crypto";
import type { ActionEntity } from "@/domain/actions/autonomy-valve";

export const PROTECTION_EVIDENCE_MATERIAL_VERSION = "protection-evidence-material/1.0.0" as const;

export type ScopedProtectionEvidence =
  | Readonly<{ status: "known"; refs: readonly string[]; evidenceHash: string }>
  | Readonly<{ status: "unknown"; reasonRef: string }>;

export type ProtectionEvidenceScope = Readonly<{
  workspaceId: string;
  workspaceRef: string;
  accountRef: string;
  campaignRef: string;
  entity: ActionEntity;
  evaluatedAt: string;
  notBefore: string;
}>;

type SourceRevision = Readonly<{ sourceRef: string; revision: number; sourceHash: string }>;

export type AuthenticCategoryEvidenceCandidate = Readonly<{
  sourceKind: "effective_category_context";
  workspaceId: string;
  workspaceRef: string;
  accountRef: string;
  campaignRef: string;
  entity: ActionEntity;
  capturedAt: string;
  contextHash: string;
  categoryRefs: readonly string[];
  sourceRevisions: readonly SourceRevision[];
}>;

export type AuthenticAffectedGeoEvidenceCandidate = Readonly<{
  sourceKind: "canonical_meta_affected_geo_snapshot";
  workspaceId: string;
  workspaceRef: string;
  accountRef: string;
  campaignRef: string;
  entity: ActionEntity;
  capturedAt: string;
  geoRefs: readonly string[];
  sourceRevisions: readonly SourceRevision[];
}>;

export type AuthenticCategoryEvidencePort = Readonly<{
  resolveCandidates(scope: ProtectionEvidenceScope): Promise<readonly unknown[]>;
}>;

/** No production adapter exists until the mirror persists an authoritative affected-geo fact. */
export type AuthenticAffectedGeoEvidencePort = Readonly<{
  resolveCandidates(scope: ProtectionEvidenceScope): Promise<readonly unknown[]>;
}>;

export type ExistingPostPromotionProtectionEvidenceMaterial = Readonly<{
  version: typeof PROTECTION_EVIDENCE_MATERIAL_VERSION;
  scopeHash: string;
  categoryEvidenceRef: string | null;
  categoryEvidence: ScopedProtectionEvidence;
  affectedGeoEvidenceRef: string | null;
  affectedGeoEvidence: ScopedProtectionEvidence;
  capabilities: Readonly<{ canApprove: false; canExecute: false; canWriteMeta: false; canGrantApproval: false }>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const LEVELS = ["campaign", "adset", "ad"] as const;
const CATEGORY_KEYS = ["sourceKind", "workspaceId", "workspaceRef", "accountRef", "campaignRef", "entity",
  "capturedAt", "contextHash", "categoryRefs", "sourceRevisions"] as const;
const GEO_KEYS = ["sourceKind", "workspaceId", "workspaceRef", "accountRef", "campaignRef", "entity",
  "capturedAt", "geoRefs", "sourceRevisions"] as const;
const REVISION_KEYS = ["sourceRef", "revision", "sourceHash"] as const;
const SCOPE_KEYS = ["workspaceId", "workspaceRef", "accountRef", "campaignRef", "entity", "evaluatedAt", "notBefore"] as const;
const CAPABILITIES = Object.freeze({ canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canGrantApproval: false as const });

function codePointCompare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => codePointCompare(left, right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value as object).length === keys.length
    && Object.keys(value as object).every((key) => keys.includes(key));
}
function instant(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  const normalized = new Date(value).toISOString(); return normalized === value ? normalized : null;
}
function entity(value: unknown): ActionEntity | null {
  if (!exact(value, ["level", "ref"]) || !LEVELS.includes(value.level as ActionEntity["level"])
    || typeof value.ref !== "string" || !REF.test(value.ref)) return null;
  return Object.freeze({ level: value.level as ActionEntity["level"], ref: value.ref });
}
function refs(value: unknown, prefix: "category_" | "geo_"): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500
    || value.some((item) => typeof item !== "string" || !REF.test(item) || !item.startsWith(prefix))) return null;
  const normalized = [...value].sort(codePointCompare); return new Set(normalized).size === normalized.length ? Object.freeze(normalized) : null;
}
function revisions(value: unknown): readonly SourceRevision[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return null;
  const normalized: SourceRevision[] = [];
  for (const raw of value) {
    if (!exact(raw, REVISION_KEYS) || typeof raw.sourceRef !== "string" || !REF.test(raw.sourceRef)
      || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1
      || typeof raw.sourceHash !== "string" || !HASH.test(raw.sourceHash)) return null;
    normalized.push(Object.freeze({ sourceRef: raw.sourceRef, revision: raw.revision as number, sourceHash: raw.sourceHash }));
  }
  normalized.sort((left, right) => codePointCompare(left.sourceRef, right.sourceRef) || left.revision - right.revision);
  if (new Set(normalized.map((item) => item.sourceRef)).size !== normalized.length) return null;
  return Object.freeze(normalized);
}
function validScope(scope: ProtectionEvidenceScope): boolean {
  if (!exact(scope, SCOPE_KEYS)) return false;
  const evaluatedAt = instant(scope.evaluatedAt); const notBefore = instant(scope.notBefore); const target = entity(scope.entity);
  return UUID.test(scope.workspaceId) && REF.test(scope.workspaceRef) && REF.test(scope.accountRef) && REF.test(scope.campaignRef)
    && target !== null && evaluatedAt !== null && notBefore !== null && notBefore <= evaluatedAt;
}
function scopeMatches(candidate: Record<string, unknown>, scope: ProtectionEvidenceScope): boolean {
  const target = entity(candidate.entity); return candidate.workspaceId === scope.workspaceId && candidate.workspaceRef === scope.workspaceRef
    && candidate.accountRef === scope.accountRef && candidate.campaignRef === scope.campaignRef
    && target?.level === scope.entity.level && target.ref === scope.entity.ref;
}
function capturedInWindow(value: unknown, scope: ProtectionEvidenceScope): value is string {
  const capturedAt = instant(value); return capturedAt !== null && capturedAt >= scope.notBefore && capturedAt <= scope.evaluatedAt;
}
function unknown(reasonRef: string): ScopedProtectionEvidence { return Object.freeze({ status: "unknown", reasonRef }); }
function known(refValues: readonly string[], envelope: unknown): Readonly<{ evidenceRef: string; evidence: ScopedProtectionEvidence }> {
  const evidenceHash = digest(envelope); return Object.freeze({ evidenceRef: `protection_evidence_${evidenceHash.slice(0, 24)}`,
    evidence: Object.freeze({ status: "known", refs: refValues, evidenceHash }) });
}

function materializeCategory(candidates: readonly unknown[], scope: ProtectionEvidenceScope) {
  if (candidates.length !== 1) return { evidenceRef: null, evidence: unknown(candidates.length === 0
    ? "category_evidence_missing" : "category_evidence_ambiguous") } as const;
  const candidate = candidates[0];
  if (!exact(candidate, CATEGORY_KEYS) || candidate.sourceKind !== "effective_category_context"
    || !scopeMatches(candidate, scope) || !capturedInWindow(candidate.capturedAt, scope)
    || typeof candidate.contextHash !== "string" || !HASH.test(candidate.contextHash)) {
    return { evidenceRef: null, evidence: unknown("category_evidence_untrusted") } as const;
  }
  const categoryRefs = refs(candidate.categoryRefs, "category_"); const sourceRevisions = revisions(candidate.sourceRevisions);
  if (!categoryRefs || !sourceRevisions) return { evidenceRef: null, evidence: unknown("category_evidence_untrusted") } as const;
  return known(categoryRefs, { version: PROTECTION_EVIDENCE_MATERIAL_VERSION, kind: "category", scope,
    capturedAt: candidate.capturedAt, contextHash: candidate.contextHash, categoryRefs, sourceRevisions });
}

function materializeGeo(candidates: readonly unknown[], scope: ProtectionEvidenceScope) {
  if (candidates.length !== 1) return { evidenceRef: null, evidence: unknown(candidates.length === 0
    ? "affected_geo_evidence_missing" : "affected_geo_evidence_ambiguous") } as const;
  const candidate = candidates[0];
  if (!exact(candidate, GEO_KEYS) || candidate.sourceKind !== "canonical_meta_affected_geo_snapshot"
    || !scopeMatches(candidate, scope) || !capturedInWindow(candidate.capturedAt, scope)) {
    return { evidenceRef: null, evidence: unknown("affected_geo_evidence_untrusted") } as const;
  }
  const geoRefs = refs(candidate.geoRefs, "geo_"); const sourceRevisions = revisions(candidate.sourceRevisions);
  if (!geoRefs || !sourceRevisions) return { evidenceRef: null, evidence: unknown("affected_geo_evidence_untrusted") } as const;
  return known(geoRefs, { version: PROTECTION_EVIDENCE_MATERIAL_VERSION, kind: "affected_geo", scope,
    capturedAt: candidate.capturedAt, geoRefs, sourceRevisions });
}

/** Read-only materializer. It grants no authority and writes no policy, queue, or Meta state. */
export class ExistingPostPromotionProtectionEvidenceMaterializer {
  constructor(private readonly categories: AuthenticCategoryEvidencePort, private readonly affectedGeos: AuthenticAffectedGeoEvidencePort) {}

  async resolve(scope: ProtectionEvidenceScope): Promise<ExistingPostPromotionProtectionEvidenceMaterial> {
    if (!validScope(scope)) throw new Error("invalid_protection_evidence_scope");
    let categoryCandidates: readonly unknown[] = []; let geoCandidates: readonly unknown[] = [];
    let categoryUnavailable = false; let geoUnavailable = false;
    try { categoryCandidates = await this.categories.resolveCandidates(scope); } catch { categoryUnavailable = true; }
    try { geoCandidates = await this.affectedGeos.resolveCandidates(scope); } catch { geoUnavailable = true; }
    const category = categoryUnavailable
      ? { evidenceRef: null, evidence: unknown("category_evidence_source_unavailable") } as const
      : materializeCategory(Array.isArray(categoryCandidates) ? categoryCandidates : [], scope);
    const geo = geoUnavailable
      ? { evidenceRef: null, evidence: unknown("affected_geo_evidence_source_unavailable") } as const
      : materializeGeo(Array.isArray(geoCandidates) ? geoCandidates : [], scope);
    return Object.freeze({ version: PROTECTION_EVIDENCE_MATERIAL_VERSION, scopeHash: digest(scope),
      categoryEvidenceRef: category.evidenceRef, categoryEvidence: category.evidence,
      affectedGeoEvidenceRef: geo.evidenceRef, affectedGeoEvidence: geo.evidence, capabilities: CAPABILITIES });
  }
}
