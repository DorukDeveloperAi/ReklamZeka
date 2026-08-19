import { createHash } from "node:crypto";

import type {
  DailyAgentResult,
  GuideRunDailyAgentPort,
  GuideRunHolisticAgentPort,
  HolisticGuideRunResult,
} from "@/application/guide-run-orchestration-service";
import type { OrchestratorModelAdapter } from "@/application/orchestrator-conversation";
import {
  LocalCodexExecAdapter,
  localCodexExecConfig,
} from "@/server/local-codex-exec-adapter";

const MAX_PROVIDER_RESPONSE_BYTES = 2_048;
const DAILY_VERSION = "guide-run-daily-agent/1.0.0" as const;
const HOLISTIC_VERSION = "guide-run-holistic-agent/1.0.0" as const;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,63}_[a-z0-9][a-z0-9_.:-]{0,190}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

type GuideRunCodexEnvironment = Readonly<Record<string, string | undefined>>;

export type GuideRunMemberMetricEvidence = Readonly<{
  version: "guide-run-member-metrics/1.0.0";
  runRef: string;
  guideRevisionHash: string;
  sliceSnapshotHash: string;
  member: Readonly<{ memberRef: string; membershipHash: string }>;
  guide: Readonly<{
    freeText: string;
    mode:
      | "observe_analyze"
      | "recommend"
      | "prepare_human_approval"
      | "limited_autonomy";
    actionAllowlist: readonly string[];
  }>;
  period: Readonly<{ startDate: string; endDate: string }>;
  sourceState: "ready" | "partial" | "unavailable";
  metrics: readonly Readonly<{
    date: string;
    attribution: string;
    metricKey: string;
    actionType: string | null;
    valueDecimal: string | null;
    valueMinor: string | null;
    currency: string | null;
    availability: "available" | "unavailable";
  }>[];
  evidenceHash: string;
}>;
export interface GuideRunMemberMetricEvidencePort {
  load(
    input: Parameters<GuideRunDailyAgentPort["analyze"]>[0],
  ): Promise<GuideRunMemberMetricEvidence>;
}
export type GuideRunStageableStatusCandidateEvidence = Readonly<{
  action: "status_pause" | "status_activate";
  stageable: Readonly<{
    version: "candidate/1.1";
    entityRef: string;
    entityLevel: "adset";
    membershipHash: string;
    sliceRef: string;
    market: "yerli" | "yabanci";
    typedAction: Record<string, unknown>;
  }>;
}>;
export interface GuideRunStageableStatusCandidatePort {
  load(
    input: Readonly<{
      runRef: string;
      guideRevisionHash: string;
      sliceSnapshotHash: string;
      member: Readonly<{ memberRef: string; membershipHash: string }>;
    }>,
  ): Promise<GuideRunStageableStatusCandidateEvidence | null>;
}

function canonicalCandidateEvidence(
  value: GuideRunStageableStatusCandidateEvidence,
  member: Readonly<{ memberRef: string; membershipHash: string }>,
): GuideRunStageableStatusCandidateEvidence {
  exactObject(value, ["action", "stageable"]);
  const stageable = exactObject(value.stageable, [
      "version",
      "entityRef",
      "entityLevel",
      "membershipHash",
      "sliceRef",
      "market",
      "typedAction",
    ]),
    typed = exactObject(stageable.typedAction, [
      "kind",
      "entity",
      "fromStatus",
      "toStatus",
    ]),
    entity = exactObject(typed.entity, ["level", "ref"]);
  const pause =
      value.action === "status_pause" &&
      typed.fromStatus === "ACTIVE" &&
      typed.toStatus === "PAUSED",
    activate =
      value.action === "status_activate" &&
      typed.fromStatus === "PAUSED" &&
      typed.toStatus === "ACTIVE";
  if (
    (!pause && !activate) ||
    stageable.version !== "candidate/1.1" ||
    stageable.entityRef !== member.memberRef ||
    stageable.membershipHash !== member.membershipHash ||
    stageable.entityLevel !== "adset" ||
    !REF.test(String(stageable.entityRef)) ||
    !HASH.test(String(stageable.membershipHash)) ||
    !REF.test(String(stageable.sliceRef)) ||
    !(stageable.market === "yerli" || stageable.market === "yabanci") ||
    typed.kind !== "status_change" ||
    entity.level !== "adset" ||
    entity.ref !== member.memberRef
  )
    throw new Error("guide run candidate evidence rejected");
  return Object.freeze({
    action: value.action,
    stageable: Object.freeze({
      ...value.stageable,
      typedAction: Object.freeze({
        kind: "status_change",
        entity: Object.freeze({ level: "adset", ref: member.memberRef }),
        fromStatus: typed.fromStatus,
        toStatus: typed.toStatus,
      }),
    }),
  }) as GuideRunStageableStatusCandidateEvidence;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error("guide run Codex response rejected");
  }
  return value as Record<string, unknown>;
}

function parseProviderObject(
  text: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (Buffer.byteLength(text, "utf8") > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("guide run Codex response rejected");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("guide run Codex response rejected");
  }
  return exactObject(parsed, keys);
}

function prompt(kind: "daily" | "holistic", evidence: unknown): string {
  const contract =
    kind === "daily"
      ? `{"version":"${DAILY_VERSION}","outcome":"no_change"|"finding"}`
      : `{"version":"${HOLISTIC_VERSION}","outcome":"no_change"|"finding"}`;
  const evidenceJson = JSON.stringify(stable(evidence));
  if (Buffer.byteLength(evidenceJson, "utf8") > 1024 * 1024)
    throw new Error("guide run metric evidence rejected");
  return [
    "You are a read-only ReklamZeka Guide analysis classifier.",
    "You cannot edit Guides, approve actions, execute actions, or write Meta.",
    "The supplied evidence contains only bounded Guide text, public references, canonical metrics, and hashes.",
    "Never propose or execute an action. If metricEvidence is absent, unavailable, partial, or insufficient for the Guide statement, return no_change. Return finding only when the supplied values directly support the Guide statement.",
    `Return exactly one JSON object with this shape and no markdown: ${contract}`,
    `Evidence: ${evidenceJson}`,
  ].join("\n");
}

function deterministicRef(
  prefix: "finding" | "recommendation",
  core: unknown,
): string {
  return `${prefix}_${digest(core).slice(0, 24)}`;
}

function canonicalMetricEvidence(
  value: GuideRunMemberMetricEvidence,
  input: Parameters<GuideRunDailyAgentPort["analyze"]>[0],
): GuideRunMemberMetricEvidence {
  exactObject(value, [
    "version",
    "runRef",
    "guideRevisionHash",
    "sliceSnapshotHash",
    "member",
    "guide",
    "period",
    "sourceState",
    "metrics",
    "evidenceHash",
  ]);
  const member = exactObject(value.member, ["memberRef", "membershipHash"]);
  const guide = exactObject(value.guide, [
    "freeText",
    "mode",
    "actionAllowlist",
  ]);
  const period = exactObject(value.period, ["startDate", "endDate"]);
  if (
    value.version !== "guide-run-member-metrics/1.0.0" ||
    value.runRef !== input.runRef ||
    value.guideRevisionHash !== input.guideRevisionHash ||
    value.sliceSnapshotHash !== input.sliceSnapshotHash ||
    member.memberRef !== input.member.memberRef ||
    member.membershipHash !== input.member.membershipHash ||
    !REF.test(String(member.memberRef)) ||
    !HASH.test(String(member.membershipHash)) ||
    typeof guide.freeText !== "string" ||
    guide.freeText.trim() !== guide.freeText ||
    guide.freeText.length < 1 ||
    guide.freeText.length > 10_000 ||
    ![
      "observe_analyze",
      "recommend",
      "prepare_human_approval",
      "limited_autonomy",
    ].includes(String(guide.mode)) ||
    !Array.isArray(guide.actionAllowlist) ||
    guide.actionAllowlist.length > 7 ||
    guide.actionAllowlist.some(
      (action) =>
        typeof action !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(action),
    ) ||
    !DATE.test(String(period.startDate)) ||
    !DATE.test(String(period.endDate)) ||
    !Array.isArray(value.metrics) ||
    value.metrics.length > 1_024 ||
    !HASH.test(value.evidenceHash)
  )
    throw new Error("guide run metric evidence rejected");
  const start = new Date(`${period.startDate}T00:00:00.000Z`),
    end = new Date(`${period.endDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    (end.getTime() - start.getTime()) / 86_400_000 !== 13
  )
    throw new Error("guide run metric evidence rejected");
  const metrics = value.metrics.map((metric) => {
    exactObject(metric, [
      "date",
      "attribution",
      "metricKey",
      "actionType",
      "valueDecimal",
      "valueMinor",
      "currency",
      "availability",
    ]);
    if (
      !DATE.test(metric.date) ||
      metric.date < String(period.startDate) ||
      metric.date > String(period.endDate) ||
      !/^[^\u0000-\u001f\u007f]{1,160}$/.test(metric.attribution) ||
      !/^[a-z][a-z0-9_:-]{0,80}$/.test(metric.metricKey) ||
      (metric.actionType !== null &&
        !/^[a-z][a-z0-9_:-]{0,80}$/.test(metric.actionType)) ||
      (metric.valueDecimal !== null && !DECIMAL.test(metric.valueDecimal)) ||
      (metric.valueMinor !== null && !DECIMAL.test(metric.valueMinor)) ||
      (metric.currency !== null && !/^[A-Z]{3}$/.test(metric.currency)) ||
      !["available", "unavailable"].includes(metric.availability)
    )
      throw new Error("guide run metric evidence rejected");
    return Object.freeze({ ...metric });
  });
  const observedDays = new Set(metrics.map((metric) => metric.date));
  const sourceState =
    metrics.length === 0
      ? "unavailable"
      : metrics.some((metric) => metric.availability === "unavailable") ||
          observedDays.size !== 14
        ? "partial"
        : "ready";
  if (value.sourceState !== sourceState)
    throw new Error("guide run metric evidence rejected");
  const core = {
    version: value.version,
    runRef: value.runRef,
    guideRevisionHash: value.guideRevisionHash,
    sliceSnapshotHash: value.sliceSnapshotHash,
    member: Object.freeze({ ...value.member }),
    guide: Object.freeze({
      ...value.guide,
      actionAllowlist: Object.freeze([...value.guide.actionAllowlist]),
    }),
    period: Object.freeze({ ...value.period }),
    sourceState: value.sourceState,
    metrics: Object.freeze(metrics),
  };
  if (value.evidenceHash !== digest(core))
    throw new Error("guide run metric evidence rejected");
  return Object.freeze({ ...core, evidenceHash: value.evidenceHash });
}

/**
 * Schema-free, no-authority provider adapter. It deliberately cannot emit an
 * action candidate. Candidate construction remains fail-closed until a
 * separately reviewed server-owned typed candidate builder is added.
 */
export class CodexGuideRunAgentAdapter
  implements GuideRunDailyAgentPort, GuideRunHolisticAgentPort
{
  constructor(
    private readonly model: OrchestratorModelAdapter,
    private readonly metrics?: GuideRunMemberMetricEvidencePort,
    private readonly candidates?: GuideRunStageableStatusCandidatePort,
  ) {}

  async analyze(
    input: Parameters<GuideRunDailyAgentPort["analyze"]>[0],
  ): Promise<DailyAgentResult> {
    const metricEvidence = this.metrics
      ? canonicalMetricEvidence(await this.metrics.load(input), input)
      : null;
    const evidence = Object.freeze({
      analysisRef: input.analysisRef,
      runRef: input.runRef,
      guideRevisionHash: input.guideRevisionHash,
      sliceSnapshotHash: input.sliceSnapshotHash,
      member: input.member,
      metricEvidence,
      authority: input.authority,
    });
    const response = await this.model.execute({
      providerThreadRef: null,
      prompt: prompt("daily", evidence),
    });
    const parsed = parseProviderObject(response.finalResponse, [
      "version",
      "outcome",
    ]);
    if (
      parsed.version !== DAILY_VERSION ||
      (parsed.outcome !== "no_change" && parsed.outcome !== "finding") ||
      (parsed.outcome === "finding" && metricEvidence?.sourceState !== "ready")
    ) {
      throw new Error("guide run Codex response rejected");
    }
    const evidenceHash =
      metricEvidence?.evidenceHash ?? digest({ kind: "daily", evidence });
    return Object.freeze({
      outcome: parsed.outcome,
      evidenceHash,
      findingRef:
        parsed.outcome === "finding"
          ? deterministicRef("finding", {
              evidenceHash,
              analysisRef: input.analysisRef,
            })
          : null,
    });
  }

  async synthesize(
    input: Parameters<GuideRunHolisticAgentPort["synthesize"]>[0],
  ): Promise<HolisticGuideRunResult> {
    const evidence = Object.freeze({
      analysisRef: input.analysisRef,
      runRef: input.runRef,
      guideRevisionHash: input.guideRevisionHash,
      sliceSnapshotHash: input.sliceSnapshotHash,
      members: input.members,
      authority: input.authority,
    });
    const response = await this.model.execute({
      providerThreadRef: null,
      prompt: prompt("holistic", evidence),
    });
    const parsed = parseProviderObject(response.finalResponse, [
      "version",
      "outcome",
    ]);
    if (
      parsed.version !== HOLISTIC_VERSION ||
      (parsed.outcome !== "no_change" && parsed.outcome !== "finding")
    ) {
      throw new Error("guide run Codex response rejected");
    }
    const evidenceHash = digest({ kind: "holistic", evidence });
    const findings = input.members.filter(
      (member) =>
        member.failureCode === null && member.result?.outcome === "finding",
    );
    let candidate: HolisticGuideRunResult["candidate"] = null;
    if (
      parsed.outcome === "finding" &&
      findings.length === 1 &&
      this.candidates
    ) {
      let resolved: GuideRunStageableStatusCandidateEvidence | null = null;
      try {
        const loaded = await this.candidates.load({
          runRef: input.runRef,
          guideRevisionHash: input.guideRevisionHash,
          sliceSnapshotHash: input.sliceSnapshotHash,
          member: findings[0]!.member,
        });
        resolved = loaded
          ? canonicalCandidateEvidence(loaded, findings[0]!.member)
          : null;
      } catch {
        resolved = null;
      }
      if (resolved) {
        const candidateRef = `candidate_${digest({ kind: "stageable_candidate", evidenceHash, member: findings[0]!.member, action: resolved.action }).slice(0, 24)}`;
        candidate = Object.freeze({
          candidateRef,
          action: resolved.action,
          stageable: resolved.stageable,
          candidateHash: digest({
            candidateRef,
            action: resolved.action,
            ...resolved.stageable,
          }),
        });
      }
    }
    return Object.freeze({
      outcome: parsed.outcome,
      // The orchestration service independently rechecks trusted data health.
      dataQuality: candidate ? "ready" : "missing",
      recommendationRef:
        parsed.outcome === "finding"
          ? deterministicRef("recommendation", {
              evidenceHash,
              analysisRef: input.analysisRef,
            })
          : null,
      candidate,
      evidenceHash,
    });
  }
}

/** Default-off production composition. The Guide worker needs its own flag;
 * enabling the interactive orchestrator alone never enables scheduled agents. */
export function createLocalCodexGuideRunAgents(
  environment: GuideRunCodexEnvironment,
  serverCwd = process.cwd(),
  metrics?: GuideRunMemberMetricEvidencePort,
  candidates?: GuideRunStageableStatusCandidatePort,
): Readonly<{
  dailyAnalysis: GuideRunDailyAgentPort;
  holisticAnalysis: GuideRunHolisticAgentPort;
}> | null {
  if (environment.REKLAMZEKA_GUIDE_RUN_CODEX_ENABLED !== "true") return null;
  const config = localCodexExecConfig(
    {
      ...environment,
      REKLAMZEKA_ORCHESTRATOR_CODEX_ENABLED: "true",
    },
    serverCwd,
  );
  if (!config) return null;
  const adapter = new CodexGuideRunAgentAdapter(
    new LocalCodexExecAdapter(config),
    metrics,
    candidates,
  );
  return Object.freeze({ dailyAnalysis: adapter, holisticAnalysis: adapter });
}
