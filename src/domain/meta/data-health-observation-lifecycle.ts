import { createHash } from "node:crypto";

import { META_DATA_HEALTH_MAX_CURRENT_OBSERVATIONS, META_DATA_HEALTH_MAX_RETAINED_FINDING_HEADS, type MetaDataHealthObservation, type MetaDataHealthReport } from "@/domain/meta/data-health";

export const META_DATA_HEALTH_OBSERVATION_EVENT_VERSION = "meta-data-health-observation-event/1.0.0" as const;
export type MetaDataHealthObservationHead = Readonly<{
  workspaceRef: string; fingerprint: string; sequence: number; state: "open" | "resolved";
  evidenceHash: string; eventHash: string;
}>;
export type MetaDataHealthObservationEvent = Readonly<{
  version: typeof META_DATA_HEALTH_OBSERVATION_EVENT_VERSION; workspaceRef: string; fingerprint: string;
  sequence: number; event: "opened" | "observed" | "resolved" | "reopened"; state: "open" | "resolved";
  evidenceHash: string; previousEventHash: string; occurredAt: string;
  observation: MetaDataHealthObservation | null;
  developmentLog: Readonly<{ category: "data"; state: "proposed"; canTriage: false; canCreateTask: false }>;
  eventHash: string;
}>;
export type MetaDataHealthObservationSink = Readonly<{ append(input: Readonly<{
  workspaceId: string; events: readonly MetaDataHealthObservationEvent[];
}>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; eventHashes: readonly string[] }>> }>;

export class MetaDataHealthObservationLifecycleError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "corrupt_history") {
    super(`Meta data health observation lifecycle rejected: ${code}`); this.name = "MetaDataHealthObservationLifecycleError";
  }
}
const HASH = /^[a-f0-9]{64}$/; const WORKSPACE = /^workspace_[a-f0-9]{24}$/; const FINGERPRINT = /^data_quality_[a-f0-9]{32}$/;
const ACCOUNT = /^account_[a-f0-9]{24}$/;
function fail(code: MetaDataHealthObservationLifecycleError["code"]): never { throw new MetaDataHealthObservationLifecycleError(code); }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => compare(a, b)).map(([key, child]) => [key, stable(child)])); return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

/** Projects append-only observations; a storage adapter must enforce tenant scope and event-hash idempotency. */
export function projectMetaDataHealthObservationEvents(input: Readonly<{
  workspaceRef: string; report: MetaDataHealthReport; previousHeads: readonly MetaDataHealthObservationHead[]; occurredAt: string;
}>): readonly MetaDataHealthObservationEvent[] {
  const occurred = Date.parse(input.occurredAt);
  const { reportHash, ...reportCore } = input.report;
  if (!WORKSPACE.test(input.workspaceRef) || input.report.workspaceRef !== input.workspaceRef
    || input.report.version !== "meta-data-health/1.0.0" || !HASH.test(reportHash) || digest(reportCore) !== reportHash
    || !Number.isFinite(occurred) || new Date(occurred).toISOString() !== input.occurredAt
    || !Array.isArray(input.previousHeads) || input.previousHeads.length > META_DATA_HEALTH_MAX_RETAINED_FINDING_HEADS) fail("invalid_input");
  if (input.report.accounts.some((account) => !ACCOUNT.test(account.accountRef))
    || input.report.observations.length > META_DATA_HEALTH_MAX_CURRENT_OBSERVATIONS || input.report.observations.some((observation) =>
      !FINGERPRINT.test(observation.fingerprint) || !HASH.test(observation.evidenceHash)
      || observation.accountRef !== null && !ACCOUNT.test(observation.accountRef))) fail("invalid_input");
  const heads = new Map<string, MetaDataHealthObservationHead>();
  for (const head of input.previousHeads) {
    if (head.workspaceRef !== input.workspaceRef) fail("workspace_scope_mismatch");
    if (!FINGERPRINT.test(head.fingerprint) || heads.has(head.fingerprint) || !Number.isSafeInteger(head.sequence)
      || head.sequence < 1 || !["open", "resolved"].includes(head.state) || !HASH.test(head.evidenceHash) || !HASH.test(head.eventHash)) fail("corrupt_history");
    heads.set(head.fingerprint, head);
  }
  const current = new Map(input.report.observations.map((observation) => [observation.fingerprint, observation]));
  if (current.size !== input.report.observations.length) fail("invalid_input");
  const fingerprints = [...new Set([...heads.keys(), ...current.keys()])].sort(compare);
  return Object.freeze(fingerprints.flatMap((fingerprint) => {
    const previous = heads.get(fingerprint); const observation = current.get(fingerprint);
    if (!observation && (!previous || previous.state === "resolved")) return [];
    const event = observation ? !previous ? "opened" : previous.state === "resolved" ? "reopened" : "observed" : "resolved";
    const state = observation ? "open" : "resolved"; const sequence = (previous?.sequence ?? 0) + 1;
    const evidenceHash = observation?.evidenceHash ?? previous!.evidenceHash; const previousEventHash = previous?.eventHash ?? "0".repeat(64);
    const core = Object.freeze({ version: META_DATA_HEALTH_OBSERVATION_EVENT_VERSION, workspaceRef: input.workspaceRef,
      fingerprint, sequence, event, state, evidenceHash, previousEventHash, occurredAt: input.occurredAt,
      observation: observation ?? null, developmentLog: Object.freeze({ category: "data" as const, state: "proposed" as const,
        canTriage: false as const, canCreateTask: false as const }) });
    return [Object.freeze({ ...core, eventHash: digest(core) })];
  }));
}
