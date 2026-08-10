import { createHash } from "node:crypto";

import type { InstructionPolicyImpact } from "@/application/instruction-policy-impact-service";
import type { RepositoryVerifiedPolicyAuthoritySnapshot } from "@/domain/policies/trusted-policy-authority";
import type { PolicyPrecedenceResolution } from "@/domain/policies/policy-precedence-resolver";

export const AUTHORITATIVE_G3_REPLAY_PREVIEW_VERSION = "authoritative-g3-replay-preview/1.0.0" as const;

export type AuthoritativeG3ReplayBlocker =
  | "candidate_not_in_authority_catalog"
  | "impact_coverage_incomplete";

export type AuthoritativeG3ReplayPreview = Readonly<{
  contractVersion: typeof AUTHORITATIVE_G3_REPLAY_PREVIEW_VERSION;
  formalizationRef: string;
  policyRef: string;
  contextHash: string;
  previewHash: string;
  disposition: "blocked" | "review_required";
  blockers: readonly AuthoritativeG3ReplayBlocker[];
  replay: Readonly<{
    sourceBound: boolean;
    historicalContextInvalidated: boolean;
    authoritySnapshot: Readonly<{
      snapshotRef: string;
      snapshotHash: string;
      catalogHash: string;
      scopeHash: string;
      repositoryRef: string;
      repositoryRevision: string;
    }>;
    composedContextHash: string;
    resolutionState: PolicyPrecedenceResolution["state"];
    appliedPolicyRefs: readonly string[];
    suppressedPolicyRefs: readonly string[];
    parkedPolicyRefs: readonly string[];
  }>;
  impact: Readonly<{
    impactHash: string;
    coverageExact: boolean;
    exactRelational: readonly string[];
    partialOrUnknown: readonly string[];
  }>;
  /** G3 replay cannot qualify or unlock the G4 automation lane. */
  g4: Readonly<{ eligible: false; canApprove: false; canExecute: false; canWriteMeta: false }>;
  authority: Readonly<{
    canPublish: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canSchedule: false;
    canCallTool: false;
  }>;
}>;

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const AUTHORITY = Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canSchedule: false as const, canCallTool: false as const });
const G4 = Object.freeze({ eligible: false as const, canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const });

export class AuthoritativeG3ReplayPreviewError extends Error {
  constructor(readonly code: "invalid_input" | "unverified_source") {
    super(`Authoritative G3 replay preview rejected: ${code}`);
    this.name = "AuthoritativeG3ReplayPreviewError";
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function hash(value: string): string {
  if (!HASH.test(value)) throw new AuthoritativeG3ReplayPreviewError("invalid_input");
  return value;
}
function ref(value: string): string {
  if (!REF.test(value)) throw new AuthoritativeG3ReplayPreviewError("invalid_input");
  return value;
}
function sorted<T extends string>(values: readonly T[]): readonly T[] {
  const result = [...values].sort();
  if (new Set(result).size !== result.length) throw new AuthoritativeG3ReplayPreviewError("invalid_input");
  return Object.freeze(result);
}

/** The impact is exact only when it is complete, has no unknown family, and has no integrity fault. */
export function hasExactAuthoritativeImpact(impact: InstructionPolicyImpact): boolean {
  return impact.coverage.complete === true && impact.coverage.partialOrUnknown.length === 0
    && Object.values(impact.coverage.integrity).every((value) => value === 0);
}

/**
 * Redacted, replayable result for the server-private G3 review path.  It accepts
 * only already-validated repository facts; it never carries raw guidance or a
 * mutation grant.
 */
export function buildAuthoritativeG3ReplayPreview(input: Readonly<{
  formalizationRef: string;
  policyRef: string;
  contextHash: string;
  historicalContextInvalidated: boolean;
  authoritySnapshot: RepositoryVerifiedPolicyAuthoritySnapshot;
  sourceBound: boolean;
  composedContextHash: string;
  resolution: PolicyPrecedenceResolution;
  candidateAuthorityBound: boolean;
  impact: InstructionPolicyImpact;
}>): AuthoritativeG3ReplayPreview {
  const formalizationRef = ref(input.formalizationRef); const policyRef = ref(input.policyRef);
  const contextHash = hash(input.contextHash); const composedContextHash = hash(input.composedContextHash);
  if (input.sourceBound !== true || input.authoritySnapshot.schemaVersion !== "tenant-authority-snapshot/1.0.0") {
    throw new AuthoritativeG3ReplayPreviewError("unverified_source");
  }
  const snapshot = input.authoritySnapshot;
  const snapshotFields = [snapshot.snapshotRef, snapshot.repositoryRef].map(ref);
  const snapshotHashes = [snapshot.snapshotHash, snapshot.catalogHash, snapshot.scopeHash].map(hash);
  if (input.impact.target.policyRef !== policyRef || !HASH.test(input.impact.impactHash)) {
    throw new AuthoritativeG3ReplayPreviewError("invalid_input");
  }
  const coverageExact = hasExactAuthoritativeImpact(input.impact);
  const blockers = sorted([
    ...(input.candidateAuthorityBound ? [] : ["candidate_not_in_authority_catalog" as const]),
    ...(coverageExact ? [] : ["impact_coverage_incomplete" as const]),
  ]);
  const replay = Object.freeze({ sourceBound: true as const, historicalContextInvalidated: input.historicalContextInvalidated,
    authoritySnapshot: Object.freeze({ snapshotRef: snapshotFields[0]!, snapshotHash: snapshotHashes[0]!,
      catalogHash: snapshotHashes[1]!, scopeHash: snapshotHashes[2]!, repositoryRef: snapshotFields[1]!,
      repositoryRevision: snapshot.repositoryRevision }), composedContextHash, resolutionState: input.resolution.state,
    appliedPolicyRefs: sorted(input.resolution.applied.map((entry) => entry.policyRef)),
    suppressedPolicyRefs: sorted(input.resolution.suppressed.map((entry) => entry.policyRef)),
    parkedPolicyRefs: sorted(input.resolution.parked.map((entry) => entry.policyRef)) });
  const impact = Object.freeze({ impactHash: input.impact.impactHash, coverageExact,
    exactRelational: sorted(input.impact.coverage.exactRelational),
    partialOrUnknown: sorted(input.impact.coverage.partialOrUnknown) });
  const core = Object.freeze({ formalizationRef, policyRef, contextHash, blockers, replay, impact });
  return Object.freeze({ contractVersion: AUTHORITATIVE_G3_REPLAY_PREVIEW_VERSION, formalizationRef, policyRef, contextHash,
    previewHash: digest(core), disposition: blockers.length === 0 ? "review_required" : "blocked", blockers,
    replay, impact, g4: G4, authority: AUTHORITY });
}
