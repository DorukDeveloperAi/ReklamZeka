import { createHash } from "node:crypto";

import { createLocalCodexGuideRunAgents } from "../src/server/guide-run-codex-agent-adapter";

if (process.env.REKLAMZEKA_GUIDE_RUN_CODEX_LIVE_APPROVED !== "true") {
  throw new Error("REKLAMZEKA_GUIDE_RUN_CODEX_LIVE_APPROVED=true required");
}

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const authority = Object.freeze({
  canMutateGuide: false as const,
  canApprove: false as const,
  canExecute: false as const,
  canWriteMeta: false as const,
});
const agents = createLocalCodexGuideRunAgents({
  ...process.env,
  REKLAMZEKA_GUIDE_RUN_CODEX_ENABLED: "true",
});
if (!agents) throw new Error("Guide Run Codex agents unavailable");

const member = Object.freeze({
  memberRef: `ad_set_${digest("p05-live-member").slice(0, 24)}`,
  membershipHash: digest("p05-live-membership"),
});
const common = Object.freeze({
  runRef: `guide_run_${digest("p05-live-run").slice(0, 24)}`,
  guideRevisionHash: digest("p05-live-guide"),
  sliceSnapshotHash: digest("p05-live-slice"),
  authority,
});

const startedAt = Date.now();
const daily = await agents.dailyAnalysis.analyze({
  ...common,
  analysisRef: `analysis_${digest("p05-live-daily").slice(0, 24)}`,
  member,
});
const holistic = await agents.holisticAnalysis.synthesize({
  ...common,
  analysisRef: `analysis_${digest("p05-live-holistic").slice(0, 24)}`,
  members: Object.freeze([
    Object.freeze({ member, result: daily, failureCode: null }),
  ]),
});

const flags = Object.freeze({
  realDailyProvider:
    daily.outcome === "no_change" &&
    daily.findingRef === null &&
    /^[a-f0-9]{64}$/.test(daily.evidenceHash),
  realHolisticProvider:
    holistic.outcome === "no_change" &&
    holistic.recommendationRef === null &&
    holistic.candidate === null &&
    holistic.dataQuality === "missing" &&
    /^[a-f0-9]{64}$/.test(holistic.evidenceHash),
  authorityClosed: Object.values(authority).every((value) => value === false),
  noMetaInput:
    process.env.REKLAMZEKA_META_WRITE_ENABLED !== "true" &&
    process.env.META_WRITE_ENABLED !== "true",
});
if (!Object.values(flags).every(Boolean))
  throw new Error(JSON.stringify(flags));
console.log(
  JSON.stringify({
    mode: "real_local_codex_read_only",
    ...flags,
    elapsedMs: Date.now() - startedAt,
  }),
);
