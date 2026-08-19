import { createHash } from "node:crypto";
import { CLOSED_SKILL_AUTHORITY, coreSkillManifest, type CoreSkillManifest,
  type WorkspaceSkillCatalogBinding } from "@/domain/orchestrator/skill-catalog";
import type { OrchestratorReadOnlyEvidenceContext,
  UnavailableOrchestratorReadOnlyEvidenceContextSnapshot } from "@/application/orchestrator-readonly-evidence-context";

export const ORCHESTRATOR_SKILL_RUN_VERSION = "orchestrator-skill-run/1.0.0" as const;
export const EVIDENCE_INTEGRITY_OUTPUT_CONTRACT = "evidence-integrity-facts/1.0.0" as const;

export type OrchestratorSkillIntent = "read" | "explain" | "compare" | "question";
export type SkillRunEvidenceAvailability = "available" | "partial" | "unavailable";

type BoundEvidence = OrchestratorReadOnlyEvidenceContext;
type Evidence = BoundEvidence | UnavailableOrchestratorReadOnlyEvidenceContextSnapshot;
type SkillReceipt = Readonly<{ ref: string; version: string; hash: string; outputContract: string }>;
type SkillRunFacts = Readonly<{
  availability: SkillRunEvidenceAvailability;
  performance: Readonly<{ state: "ready" | "partial" | "unavailable"; accountCount: number; campaignCount: number;
    windows: readonly Readonly<{ days: 7 | 30; readyCount: number; partialCount: number; unavailableCount: number; latestFreshnessAt: string | null }>[] }> | null;
  timeline: Readonly<{ state: "ready" | "unavailable"; eventCount: number; latestOccurredAt: string | null }> | null;
  temporalCohort: Readonly<{ state: "ready" | "insufficient" | "unavailable"; equivalence: "equivalent" | "mixed_market" | "unproven";
    delivery: "clear" | "open_alert" | "unavailable"; freshness: "fresh" | "stale" | "unavailable" }> | null;
}>;

export type OrchestratorSkillRunReceipt = Readonly<{
  version: typeof ORCHESTRATOR_SKILL_RUN_VERSION;
  receiptRef: string;
  receiptHash: string;
  evidenceContextHash: string;
  intent: OrchestratorSkillIntent;
  selectedSkills: readonly SkillReceipt[];
  evidence: SkillRunFacts;
  handler: Readonly<{ ref: "evidence_integrity_auditor"; outputContract: typeof EVIDENCE_INTEGRITY_OUTPUT_CONTRACT;
    facts: SkillRunFacts }>;
  authority: typeof CLOSED_SKILL_AUTHORITY;
}>;
export type UnavailableOrchestratorSkillRunReceipt = Readonly<{ version: "unavailable_not_bound" }>;

const HASH = /^[a-f0-9]{64}$/;
const RECEIPT_REF = /^skillrun_[a-f0-9]{32}$/;
const INTENTS: readonly OrchestratorSkillIntent[] = ["read", "explain", "compare", "question"];

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function canonicalHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function unavailable(): never { throw new Error("invalid_orchestrator_skill_run"); }

/** Only classifies a bounded operator utterance. It never extracts entities, rules, policies, or action instructions. */
export function safeOrchestratorSkillIntent(message: string): OrchestratorSkillIntent {
  const text = message.normalize("NFKC").trim().toLocaleLowerCase("tr-TR");
  if (/\b(kıyas|karsılastır|karşılaştır|compare)\b/.test(text)) return "compare";
  if (/\?$/.test(text) || /^(ne|nedir|hangi|nasıl|kim|nerede|neden)\b/.test(text)) return "question";
  if (/\b(açıkla|acıkla|anlat|özet|ozet|durum)\b/.test(text)) return "explain";
  return "read";
}

function availability(context: Evidence): SkillRunFacts {
  if (context.version === "unavailable_not_bound") return Object.freeze({ availability: "unavailable", performance: null, timeline: null, temporalCohort: null });
  const result: SkillRunEvidenceAvailability = context.performance.state === "ready" && context.timeline.state === "ready"
    ? "available" : context.performance.state === "unavailable" && context.timeline.state === "unavailable" ? "unavailable" : "partial";
  return Object.freeze({ availability: result,
    performance: Object.freeze({ state: context.performance.state, accountCount: context.performance.accountCount,
      campaignCount: context.performance.campaignCount, windows: Object.freeze(context.performance.windows.map((window) => Object.freeze({ ...window }))) }),
    timeline: Object.freeze({ state: context.timeline.state, eventCount: context.timeline.eventCount,
      latestOccurredAt: context.timeline.latestOccurredAt }),
    temporalCohort: Object.freeze({ ...context.temporalCohort }) });
}

function selectedRefs(pageId: string, intent: OrchestratorSkillIntent): readonly string[] {
  const selected = ["evidence_integrity_auditor"];
  if (intent === "compare") selected.push("cohort_comparator");
  else if (["analysis", "decision-room", "timeline", "today", "campaigns", "alerts", "meta"].includes(pageId)
    && (intent === "explain" || intent === "question")) selected.push("analysis_director");
  else if (["budgets"].includes(pageId)) selected.push("budget_steward");
  else if (["rules", "strict-policies", "practice-lab", "autonomy"].includes(pageId)) selected.push("rule_coach");
  return Object.freeze(selected.slice(0, 3));
}

function manifest(binding: WorkspaceSkillCatalogBinding, ref: string, intent: OrchestratorSkillIntent): CoreSkillManifest {
  const entry = binding.manifests.find((candidate) => candidate.ref === ref);
  if (!entry) unavailable();
  const resolved = coreSkillManifest(entry.ref, entry.version, entry.hash);
  if (!resolved.allowedIntents.includes(intent) || resolved.negativeCapabilities.some((capability) => ![
    "persist", "create_rule", "draft_policy", "alter_scope", "publish", "approve", "execute", "meta_write", "raw_meta", "raw_sql",
  ].includes(capability))) unavailable();
  return resolved;
}

function receiptHash(value: Omit<OrchestratorSkillRunReceipt, "receiptHash" | "receiptRef">): string { return canonicalHash(value); }

/**
 * Deterministic, server-side skill selection. It deliberately has no model,
 * Meta connector, policy parser, write port, or mutable catalog lookup.
 */
export class OrchestratorSkillRouter {
  route(input: Readonly<{ pageId: string; message: string; binding: WorkspaceSkillCatalogBinding; evidence: Evidence; evidenceContextHash: string }>): OrchestratorSkillRunReceipt {
    const intent = safeOrchestratorSkillIntent(input.message);
    const skills = selectedRefs(input.pageId, intent).map((ref) => manifest(input.binding, ref, intent));
    if (skills.length < 1 || skills.length > 3 || skills[0]?.ref !== "evidence_integrity_auditor") unavailable();
    const facts = availability(input.evidence);
    const unsigned = Object.freeze({ version: ORCHESTRATOR_SKILL_RUN_VERSION, evidenceContextHash: input.evidenceContextHash,
      intent, selectedSkills: Object.freeze(skills.map((skill) => Object.freeze({ ref: skill.ref, version: skill.version,
        hash: skill.hash, outputContract: skill.outputContract }))), evidence: facts,
      handler: Object.freeze({ ref: "evidence_integrity_auditor" as const, outputContract: EVIDENCE_INTEGRITY_OUTPUT_CONTRACT, facts }),
      authority: CLOSED_SKILL_AUTHORITY });
    const hash = receiptHash(unsigned);
    return Object.freeze({ receiptRef: `skillrun_${hash.slice(0, 32)}`, receiptHash: hash, ...unsigned });
  }
}

export function unavailableOrchestratorSkillRunReceipt(): UnavailableOrchestratorSkillRunReceipt {
  return Object.freeze({ version: "unavailable_not_bound" });
}

/** Validate only previously frozen receipts; no current catalog is consulted during historical projection. */
export function parseOrchestratorSkillRunReceipt(value: unknown, expectedHash: unknown): OrchestratorSkillRunReceipt | null {
  try {
    if (!exact(value, ["version", "receiptRef", "receiptHash", "evidenceContextHash", "intent", "selectedSkills", "evidence", "handler", "authority"])
      || value.version !== ORCHESTRATOR_SKILL_RUN_VERSION || typeof value.receiptRef !== "string" || !RECEIPT_REF.test(value.receiptRef)
      || typeof value.receiptHash !== "string" || !HASH.test(value.receiptHash) || value.receiptHash !== expectedHash
      || !(typeof value.evidenceContextHash === "string" && (HASH.test(value.evidenceContextHash) || value.evidenceContextHash === "UNAVAILABLE_NOT_BOUND"))
      || typeof value.intent !== "string" || !INTENTS.includes(value.intent as OrchestratorSkillIntent) || !Array.isArray(value.selectedSkills)
      || value.selectedSkills.length < 1 || value.selectedSkills.length > 3 || !exact(value.handler, ["ref", "outputContract", "facts"])
      || value.handler.ref !== "evidence_integrity_auditor" || value.handler.outputContract !== EVIDENCE_INTEGRITY_OUTPUT_CONTRACT
      || !exact(value.authority, Object.keys(CLOSED_SKILL_AUTHORITY)) || Object.values(value.authority).some((allowed) => allowed !== false)) unavailable();
    const selectedSkills = value.selectedSkills.map((candidate) => {
      if (!exact(candidate, ["ref", "version", "hash", "outputContract"]) || typeof candidate.ref !== "string"
        || typeof candidate.version !== "string" || typeof candidate.hash !== "string" || typeof candidate.outputContract !== "string") unavailable();
      const resolved = coreSkillManifest(candidate.ref, candidate.version, candidate.hash);
      if (resolved.outputContract !== candidate.outputContract) unavailable();
      return Object.freeze({ ref: resolved.ref, version: resolved.version, hash: resolved.hash, outputContract: resolved.outputContract });
    });
    if (new Set(selectedSkills.map((skill) => skill.ref)).size !== selectedSkills.length || selectedSkills[0]?.ref !== "evidence_integrity_auditor") unavailable();
    const facts = parseFacts(value.evidence);
    if (JSON.stringify(value.handler.facts) !== JSON.stringify(facts)) unavailable();
    const unsigned = { version: ORCHESTRATOR_SKILL_RUN_VERSION, evidenceContextHash: value.evidenceContextHash,
      intent: value.intent as OrchestratorSkillIntent, selectedSkills, evidence: facts,
      handler: Object.freeze({ ref: "evidence_integrity_auditor" as const, outputContract: EVIDENCE_INTEGRITY_OUTPUT_CONTRACT, facts }), authority: CLOSED_SKILL_AUTHORITY };
    const hash = receiptHash(unsigned);
    if (hash !== value.receiptHash || value.receiptRef !== `skillrun_${hash.slice(0, 32)}`) unavailable();
    return Object.freeze({ receiptRef: value.receiptRef, receiptHash: hash, ...unsigned });
  } catch { return null; }
}

function parseFacts(value: unknown): SkillRunFacts {
  if (!exact(value, ["availability", "performance", "timeline", "temporalCohort"])
    || !["available", "partial", "unavailable"].includes(value.availability as string)) unavailable();
  const performance = value.performance;
  const timeline = value.timeline;
  const temporalCohort = value.temporalCohort;
  if (value.availability === "unavailable" && (performance !== null || timeline !== null || temporalCohort !== null)) unavailable();
  if (value.availability !== "unavailable" && (!exact(performance, ["state", "accountCount", "campaignCount", "windows"])
    || !["ready", "partial", "unavailable"].includes(performance.state as string) || !Number.isSafeInteger(performance.accountCount)
    || !Number.isSafeInteger(performance.campaignCount) || (performance.accountCount as number) < 0 || (performance.accountCount as number) > 100
    || (performance.campaignCount as number) < 0 || (performance.campaignCount as number) > 200_000 || !Array.isArray(performance.windows)
    || performance.windows.length !== 2 || !exact(timeline, ["state", "eventCount", "latestOccurredAt"])
    || !["ready", "unavailable"].includes(timeline.state as string) || !Number.isSafeInteger(timeline.eventCount)
    || (timeline.eventCount as number) < 0 || (timeline.eventCount as number) > 12
    || !(timeline.latestOccurredAt === null || typeof timeline.latestOccurredAt === "string" && Number.isFinite(Date.parse(timeline.latestOccurredAt))))) unavailable();
  if (value.availability === "unavailable") return Object.freeze({ availability: "unavailable", performance: null, timeline: null, temporalCohort: null });
  const validPerformance = performance as Record<string, unknown>;
  const validTimeline = timeline as Record<string, unknown>;
  if (!exact(temporalCohort, ["state", "equivalence", "delivery", "freshness"])
    || !["ready", "insufficient", "unavailable"].includes(temporalCohort.state as string)
    || !["equivalent", "mixed_market", "unproven"].includes(temporalCohort.equivalence as string)
    || !["clear", "open_alert", "unavailable"].includes(temporalCohort.delivery as string)
    || !["fresh", "stale", "unavailable"].includes(temporalCohort.freshness as string)
    || (temporalCohort.state === "ready" && (temporalCohort.equivalence !== "equivalent" || temporalCohort.delivery !== "clear" || temporalCohort.freshness !== "fresh"))
    || (temporalCohort.state === "unavailable" && (temporalCohort.equivalence !== "unproven" || temporalCohort.delivery !== "unavailable" || temporalCohort.freshness !== "unavailable"))) unavailable();
  const windows = (validPerformance.windows as unknown[]).map((window) => {
    if (!exact(window, ["days", "readyCount", "partialCount", "unavailableCount", "latestFreshnessAt"])
      || (window.days !== 7 && window.days !== 30) || !Number.isSafeInteger(window.readyCount) || !Number.isSafeInteger(window.partialCount)
      || !Number.isSafeInteger(window.unavailableCount) || (window.readyCount as number) < 0 || (window.partialCount as number) < 0
      || (window.unavailableCount as number) < 0 || !(window.latestFreshnessAt === null || typeof window.latestFreshnessAt === "string"
        && Number.isFinite(Date.parse(window.latestFreshnessAt)))) unavailable();
    return Object.freeze({ days: window.days as 7 | 30, readyCount: window.readyCount as number,
      partialCount: window.partialCount as number, unavailableCount: window.unavailableCount as number,
      latestFreshnessAt: window.latestFreshnessAt as string | null });
  });
  if (new Set(windows.map((window) => window.days)).size !== 2) unavailable();
  return Object.freeze({ availability: value.availability as "available" | "partial", performance: Object.freeze({
    state: validPerformance.state as "ready" | "partial" | "unavailable", accountCount: validPerformance.accountCount as number,
    campaignCount: validPerformance.campaignCount as number, windows: Object.freeze(windows) }), timeline: Object.freeze({
    state: validTimeline.state as "ready" | "unavailable", eventCount: validTimeline.eventCount as number,
    latestOccurredAt: validTimeline.latestOccurredAt as string | null }), temporalCohort: Object.freeze({
      state: temporalCohort.state as "ready" | "insufficient" | "unavailable",
      equivalence: temporalCohort.equivalence as "equivalent" | "mixed_market" | "unproven",
      delivery: temporalCohort.delivery as "clear" | "open_alert" | "unavailable",
      freshness: temporalCohort.freshness as "fresh" | "stale" | "unavailable" }) });
}
