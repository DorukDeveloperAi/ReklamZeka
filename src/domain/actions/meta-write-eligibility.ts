import { createHash } from "node:crypto";

import { type MetaWriteSpec } from "@/domain/actions/meta-write-spec";

export const META_WRITE_ELIGIBILITY_VERSION = "meta-write-eligibility/1.0.0" as const;

type EntityLevel = "campaign" | "adset" | "ad";
type MetaStatus = "ACTIVE" | "PAUSED" | "UNKNOWN";

export type MetaWriteEligibilitySnapshot = Readonly<{
  workspaceRef: string;
  accountRef: string;
  capturedAt: string;
  target: Readonly<{
    entityLevel: EntityLevel;
    entityRef: string;
    configuredStatus: MetaStatus;
    effectiveStatus: MetaStatus;
    budgetOwnerRef: string | null;
    currentName: string;
  }>;
  ancestors: readonly Readonly<{
    entityLevel: Exclude<EntityLevel, "ad"> | "adset";
    entityRef: string;
    configuredStatus: MetaStatus;
    effectiveStatus: MetaStatus;
  }>[];
  sourceSnapshotHash: string;
}>;

export type MetaWriteEligibility = Readonly<{
  version: typeof META_WRITE_ELIGIBILITY_VERSION;
  writeSpecHash: string;
  snapshotHash: string;
  eligibilityHash: string;
  disposition: "eligible_for_separate_human_execution" | "blocked";
  reasons: readonly (
    | "target_mismatch"
    | "target_state_unknown"
    | "target_not_effective_active"
    | "target_not_configured_paused"
    | "parent_state_unknown"
    | "parent_not_effective_active"
    | "budget_owner_mismatch"
    | "budget_target_not_active"
    | "rename_before_mismatch"
  )[];
  capabilities: Readonly<{ canExecute: false; canWriteMeta: false; canDispatchNetwork: false }>;
}>;

export class MetaWriteEligibilityError extends Error {
  constructor(readonly code: "invalid_input") {
    super(`Meta write eligibility reddedildi: ${code}`);
    this.name = "MetaWriteEligibilityError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const levels: readonly EntityLevel[] = ["campaign", "adset", "ad"];
const statuses: readonly MetaStatus[] = ["ACTIVE", "PAUSED", "UNKNOWN"];

function invalid(): never { throw new MetaWriteEligibilityError("invalid_input"); }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) invalid();
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function ref(value: unknown): string { if (typeof value !== "string" || !REF.test(value) || value.includes("*")) invalid(); return value; }
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) invalid(); return value; }
function status(value: unknown): MetaStatus { if (typeof value !== "string" || !statuses.includes(value as MetaStatus)) invalid(); return value as MetaStatus; }

function validatedSnapshot(value: MetaWriteEligibilitySnapshot): MetaWriteEligibilitySnapshot {
  exact(value, ["workspaceRef", "accountRef", "capturedAt", "target", "ancestors", "sourceSnapshotHash"]);
  ref(value.workspaceRef); ref(value.accountRef); hash(value.sourceSnapshotHash);
  if (typeof value.capturedAt !== "string" || !ISO.test(value.capturedAt) || new Date(value.capturedAt).toISOString() !== value.capturedAt) invalid();
  exact(value.target, ["entityLevel", "entityRef", "configuredStatus", "effectiveStatus", "budgetOwnerRef", "currentName"]);
  if (!levels.includes(value.target.entityLevel)) invalid(); ref(value.target.entityRef); status(value.target.configuredStatus); status(value.target.effectiveStatus);
  if (value.target.budgetOwnerRef !== null) ref(value.target.budgetOwnerRef);
  if (typeof value.target.currentName !== "string" || value.target.currentName !== value.target.currentName.trim()
    || value.target.currentName.length < 1 || value.target.currentName.length > 255
    || /[\u0000-\u001f\u007f]/.test(value.target.currentName)) invalid();
  if (!Array.isArray(value.ancestors) || value.ancestors.length > 2) invalid();
  const seen = new Set<string>(); let previousRank = -1;
  for (const ancestor of value.ancestors) {
    exact(ancestor, ["entityLevel", "entityRef", "configuredStatus", "effectiveStatus"]);
    const level = ancestor.entityLevel;
    const entityRef = ancestor.entityRef;
    if (level !== "campaign" && level !== "adset") invalid();
    if (typeof entityRef !== "string") invalid();
    const rank = level === "campaign" ? 0 : 1;
    if (rank <= previousRank || seen.has(entityRef)) invalid();
    previousRank = rank; seen.add(entityRef); ref(entityRef); status(ancestor.configuredStatus); status(ancestor.effectiveStatus);
  }
  return value;
}

/**
 * Rechecks the status-parent and budget-owner matrix before a future, separate
 * executor can even request human execution confirmation. It is advisory-only
 * and cannot turn an approved action into a network or Meta capability.
 */
export function assessMetaWriteEligibility(input: Readonly<{ writeSpec: MetaWriteSpec; snapshot: MetaWriteEligibilitySnapshot }>): MetaWriteEligibility {
  exact(input, ["writeSpec", "snapshot"]);
  const snapshot = validatedSnapshot(input.snapshot);
  const spec = input.writeSpec;
  if (!spec || typeof spec !== "object" || !HASH.test(spec.specHash) || !levels.includes(spec.target.entityLevel)) invalid();
  const reasons: MetaWriteEligibility["reasons"][number][] = [];
  if (spec.target.entityLevel !== snapshot.target.entityLevel || spec.target.entityRef !== snapshot.target.entityRef) reasons.push("target_mismatch");
  if (snapshot.target.configuredStatus === "UNKNOWN" || snapshot.target.effectiveStatus === "UNKNOWN") reasons.push("target_state_unknown");
  const statusAction = spec.mutation.kind === "status";
  if (statusAction && spec.mutation.desiredStatus === "PAUSED" && snapshot.target.effectiveStatus !== "ACTIVE") reasons.push("target_not_effective_active");
  if (statusAction && spec.mutation.desiredStatus === "ACTIVE" && snapshot.target.configuredStatus !== "PAUSED") reasons.push("target_not_configured_paused");
  if (statusAction && spec.mutation.desiredStatus === "ACTIVE") {
    for (const ancestor of snapshot.ancestors) {
      if (ancestor.configuredStatus === "UNKNOWN" || ancestor.effectiveStatus === "UNKNOWN") reasons.push("parent_state_unknown");
      else if (ancestor.effectiveStatus !== "ACTIVE") reasons.push("parent_not_effective_active");
    }
  }
  if (spec.mutation.kind === "budget") {
    if (snapshot.target.budgetOwnerRef !== snapshot.target.entityRef) reasons.push("budget_owner_mismatch");
    if (snapshot.target.effectiveStatus !== "ACTIVE") reasons.push("budget_target_not_active");
  }
  if (spec.mutation.kind === "rename" && snapshot.target.currentName !== spec.mutation.previousName)
    reasons.push("rename_before_mismatch");
  const uniqueReasons = Object.freeze([...new Set(reasons)]);
  const core = Object.freeze({ version: META_WRITE_ELIGIBILITY_VERSION, writeSpecHash: spec.specHash,
    snapshotHash: snapshot.sourceSnapshotHash, disposition: uniqueReasons.length ? "blocked" as const : "eligible_for_separate_human_execution" as const,
    reasons: uniqueReasons, capabilities: Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canDispatchNetwork: false as const }) });
  return Object.freeze({ ...core, eligibilityHash: digest(core) });
}
