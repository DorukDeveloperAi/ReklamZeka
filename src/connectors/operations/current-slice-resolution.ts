import { createSliceRevision, type SliceRevision } from "@/domain/slices/slice-definition";
import { resolveSlice, type SliceEntityCandidate } from "@/domain/slices/slice-resolver";

/**
 * Boundary adapter for an Operasyon *current* slice read.  It deliberately
 * accepts relational facts, rebuilds the public immutable definition, and
 * delegates precedence to the one P03 resolver. Frozen run receipts are not
 * an input here.
 */
export function resolveCurrentOperationSlice(input: Readonly<{
  revision: Omit<SliceRevision, "version" | "definitionHash"> & Readonly<{ definitionHash: string }>;
  candidates: readonly SliceEntityCandidate[];
  resolvedAt: string;
}>): readonly string[] {
  const revision = createSliceRevision({
    sliceRef: input.revision.sliceRef,
    revisionRef: input.revision.revisionRef,
    revisionNumber: input.revision.revisionNumber,
    market: input.revision.market,
    predicates: input.revision.predicates,
    explicitIncludeEntityRefs: input.revision.explicitIncludeEntityRefs,
    explicitExcludeEntityRefs: input.revision.explicitExcludeEntityRefs,
  });
  if (revision.definitionHash !== input.revision.definitionHash) throw new Error("operation read rejected: slice definition");
  return Object.freeze(resolveSlice({ revision, candidates: input.candidates, resolvedAt: input.resolvedAt }).included.map((member) => member.entityRef));
}
