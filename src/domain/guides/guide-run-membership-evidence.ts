import { createHash } from "node:crypto";
import type { SliceMembershipEvaluation } from "@/domain/slices/slice-resolver";

const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, stable(v)]),
        )
      : value;

/** Canonical membership identity; deliberately excludes the resolver clock. */
export function guideRunMembershipEvidenceHash(
  input: Readonly<{
    sliceRef: string;
    revisionRef: string;
    definitionHash: string;
    membership: SliceMembershipEvaluation;
  }>,
): string {
  const m = input.membership;
  if (!m.included) throw new Error("guide membership must be included");
  return createHash("sha256")
    .update(
      JSON.stringify(
        stable({
          version: "guide-run-membership/1.0.0",
          sliceRef: input.sliceRef,
          revisionRef: input.revisionRef,
          definitionHash: input.definitionHash,
          entityRef: m.entityRef,
          entityLevel: m.entityLevel,
          reason: m.reason,
          marketEvidenceRefs: [...m.marketEvidenceRefs].sort(),
          matchedDimensionIds: [...m.matchedDimensionIds].sort(),
          matchedDimensionEvidenceRefs: [
            ...m.matchedDimensionEvidenceRefs,
          ].sort(),
        }),
      ),
    )
    .digest("hex");
}
