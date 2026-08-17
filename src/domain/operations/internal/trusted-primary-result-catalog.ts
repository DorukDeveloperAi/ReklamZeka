import { createHash } from "node:crypto";
import "server-only";
import { META_ACTION_CAPABILITY_CATALOG } from "@/domain/meta/insights/capability-catalog";
import {
  PRIMARY_RESULT_ACTION_CATALOG_VERSION,
  type PrimaryResultActionCatalog,
  type PrimaryResultCanonicalCatalogEvidence,
  type TrustedPrimaryResultActionCatalog,
} from "@/domain/operations/primary-result";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CLOSED_ACTION_TYPES = new Set(META_ACTION_CAPABILITY_CATALOG
  .filter((item) => item.container === "actions" && item.outputKind === "decimal")
  .map((item) => item.actionType));

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, stable(item)]));
  return value;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function evidenceHash(input: Readonly<{ workspaceId: string; actionTypes: readonly string[]; observedThrough: string; sourceSnapshotHash: string; manifestHash: string }>): string { return hash({ workspaceId: input.workspaceId, actionTypes: [...input.actionTypes].sort(), observedThrough: input.observedThrough, sourceSnapshotHash: input.sourceSnapshotHash, manifestHash: input.manifestHash }); }
function fail(): never { throw new Error("primary result rejected: trusted_catalog_artifact"); }

// Identity stays private to this server-only authority. A copied, frozen
// catalog is not trusted merely because it has the same structural hash.
const trustedCatalogIdentities = new WeakSet<object>();

export function isTrustedPrimaryResultActionCatalog(value: unknown): value is TrustedPrimaryResultActionCatalog {
  return Boolean(value && typeof value === "object" && trustedCatalogIdentities.has(value));
}

/** @internal Called solely by the concrete server-side canonical Meta adapter. */
export function materializeTrustedPrimaryResultCatalog(input: Readonly<{
  workspaceId: string;
  observedActionTypes: readonly string[];
  observedThrough: string;
  sourceSnapshotHash: string;
  manifestHash: string;
}>): Readonly<{ catalog: TrustedPrimaryResultActionCatalog; canonicalEvidence: PrimaryResultCanonicalCatalogEvidence }> {
  if (!input || typeof input !== "object" || Object.keys(input).sort().join("|") !== ["workspaceId", "observedActionTypes", "observedThrough", "sourceSnapshotHash", "manifestHash"].sort().join("|") || typeof input.workspaceId !== "string" || !UUID.test(input.workspaceId) || !Array.isArray(input.observedActionTypes) || !input.observedActionTypes.length || typeof input.observedThrough !== "string" || !CANONICAL_ISO.test(input.observedThrough) || new Date(input.observedThrough).toISOString() !== input.observedThrough || typeof input.sourceSnapshotHash !== "string" || !HASH.test(input.sourceSnapshotHash) || typeof input.manifestHash !== "string" || !HASH.test(input.manifestHash)) fail();
  const actionTypes = [...new Set(input.observedActionTypes)].sort();
  if (actionTypes.length !== input.observedActionTypes.length || actionTypes.some((actionType) => typeof actionType !== "string" || !CLOSED_ACTION_TYPES.has(actionType))) fail();
  const material = { workspaceId: input.workspaceId, actionTypes, observedThrough: input.observedThrough, sourceSnapshotHash: input.sourceSnapshotHash, manifestHash: input.manifestHash } as const;
  const canonicalEvidence = Object.freeze({ ...material, canonicalEvidenceHash: evidenceHash(material) });
  const provenance = Object.freeze({ source: "meta_insights" as const, field: "actions" as const, breakdown: "action_type" as const, extraction: "exact_action_type_only" as const, observedThrough: input.observedThrough, sourceSnapshotHash: input.sourceSnapshotHash, manifestHash: input.manifestHash, canonicalEvidenceHash: canonicalEvidence.canonicalEvidenceHash });
  const catalog: PrimaryResultActionCatalog = Object.freeze({ version: PRIMARY_RESULT_ACTION_CATALOG_VERSION, workspaceId: input.workspaceId, actionTypes: Object.freeze(actionTypes), provenance, catalogHash: hash({ version: PRIMARY_RESULT_ACTION_CATALOG_VERSION, workspaceId: input.workspaceId, actionTypes, provenance }) });
  trustedCatalogIdentities.add(catalog);
  return Object.freeze({ catalog: catalog as TrustedPrimaryResultActionCatalog, canonicalEvidence });
}
