import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import type { OrchestratorModelAdapter } from "@/application/orchestrator-conversation";
import {
  CodexGuideRunAgentAdapter,
  createLocalCodexGuideRunAgents,
} from "@/server/guide-run-codex-agent-adapter";

const hash = (character: string) => character.repeat(64);
const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, stable(item)]),
        )
      : value;
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
const authority = Object.freeze({
  canMutateGuide: false as const,
  canApprove: false as const,
  canExecute: false as const,
  canWriteMeta: false as const,
});

function model(finalResponse: string): OrchestratorModelAdapter {
  return {
    async execute(input) {
      expect(input.providerThreadRef).toBeNull();
      expect(input.prompt).toContain("canonical metrics");
      expect(input.prompt).toContain("cannot edit Guides");
      return Object.freeze({
        providerThreadRef: "018f0f4e-7b32-7c11-8d42-89cc75c45a10",
        finalResponse,
      });
    },
  };
}

describe("CodexGuideRunAgentAdapter", () => {
  it("derives daily refs and hashes on the server and exposes no authority", async () => {
    const adapter = new CodexGuideRunAgentAdapter(
      model('{"version":"guide-run-daily-agent/1.0.0","outcome":"finding"}'),
    );
    const result = await adapter.analyze({
      analysisRef: "analysis_daily_member",
      runRef: "guide_run_abc",
      guideRevisionHash: hash("a"),
      sliceSnapshotHash: hash("b"),
      member: Object.freeze({
        memberRef: "ad_set_public",
        membershipHash: hash("c"),
      }),
      authority,
    });
    expect(result).toMatchObject({ outcome: "finding" });
    expect(result.findingRef).toMatch(/^finding_[a-f0-9]{24}$/);
    expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("binds the daily artifact hash to trusted metric evidence", async () => {
    const metricCore = Object.freeze({
      version: "guide-run-member-metrics/1.0.0" as const,
      runRef: "guide_run_abc",
      guideRevisionHash: hash("a"),
      sliceSnapshotHash: hash("b"),
      member: Object.freeze({
        memberRef: "ad_set_public",
        membershipHash: hash("c"),
      }),
      guide: Object.freeze({
        freeText: "Spend artınca incele",
        mode: "recommend" as const,
        actionAllowlist: Object.freeze([]),
      }),
      period: Object.freeze({ startDate: "2026-08-03", endDate: "2026-08-16" }),
      sourceState: "partial" as const,
      metrics: Object.freeze([
        {
          date: "2026-08-16",
          attribution: "7d_click",
          metricKey: "spend",
          actionType: null,
          valueDecimal: null,
          valueMinor: "1200",
          currency: "TRY",
          availability: "available" as const,
        },
      ]),
    });
    const metricHash = digest(metricCore);
    const adapter = new CodexGuideRunAgentAdapter(
      model('{"version":"guide-run-daily-agent/1.0.0","outcome":"no_change"}'),
      {
        async load(input) {
          expect(input.runRef).toBe(metricCore.runRef);
          return Object.freeze({ ...metricCore, evidenceHash: metricHash });
        },
      },
    );
    const result = await adapter.analyze({
      analysisRef: "analysis_daily_member",
      runRef: "guide_run_abc",
      guideRevisionHash: hash("a"),
      sliceSnapshotHash: hash("b"),
      member: Object.freeze({
        memberRef: "ad_set_public",
        membershipHash: hash("c"),
      }),
      authority,
    });
    expect(result).toEqual({
      outcome: "no_change",
      evidenceHash: metricHash,
      findingRef: null,
    });
  });

  it("rejects a metric hash/source-state forgery before calling the model", async () => {
    let calls = 0;
    const adapter = new CodexGuideRunAgentAdapter(
      {
        async execute() {
          calls += 1;
          throw new Error("unreachable");
        },
      },
      {
        async load(input) {
          return {
            version: "guide-run-member-metrics/1.0.0",
            runRef: input.runRef,
            guideRevisionHash: input.guideRevisionHash,
            sliceSnapshotHash: input.sliceSnapshotHash,
            member: input.member,
            guide: {
              freeText: "Kural",
              mode: "recommend",
              actionAllowlist: [],
            },
            period: { startDate: "2026-08-03", endDate: "2026-08-16" },
            sourceState: "ready",
            metrics: [],
            evidenceHash: hash("f"),
          };
        },
      },
    );
    await expect(
      adapter.analyze({
        analysisRef: "analysis_daily_member",
        runRef: "guide_run_abc",
        guideRevisionHash: hash("a"),
        sliceSnapshotHash: hash("b"),
        member: { memberRef: "ad_set_public", membershipHash: hash("c") },
        authority,
      }),
    ).rejects.toThrow("metric evidence rejected");
    expect(calls).toBe(0);
  });

  it("keeps holistic analysis held and never accepts a model action candidate", async () => {
    const adapter = new CodexGuideRunAgentAdapter(
      model('{"version":"guide-run-holistic-agent/1.0.0","outcome":"finding"}'),
    );
    const result = await adapter.synthesize({
      analysisRef: "analysis_holistic_run",
      runRef: "guide_run_abc",
      guideRevisionHash: hash("a"),
      sliceSnapshotHash: hash("b"),
      members: Object.freeze([]),
      authority,
    });
    expect(result).toMatchObject({
      outcome: "finding",
      dataQuality: "missing",
      candidate: null,
    });
    expect(result.recommendationRef).toMatch(/^recommendation_[a-f0-9]{24}$/);
  });

  it("rejects extra keys, markdown, oversized output, and unsupported versions", async () => {
    const inputs = [
      '{"version":"guide-run-daily-agent/1.0.0","outcome":"no_change","candidate":{}}',
      '```json\n{"version":"guide-run-daily-agent/1.0.0","outcome":"no_change"}\n```',
      JSON.stringify({
        version: "guide-run-daily-agent/1.0.0",
        outcome: "x".repeat(3_000),
      }),
      '{"version":"guide-run-daily-agent/9.0.0","outcome":"no_change"}',
    ];
    for (const response of inputs) {
      const adapter = new CodexGuideRunAgentAdapter(model(response));
      await expect(
        adapter.analyze({
          analysisRef: "analysis_daily_member",
          runRef: "guide_run_abc",
          guideRevisionHash: hash("a"),
          sliceSnapshotHash: hash("b"),
          member: Object.freeze({
            memberRef: "ad_set_public",
            membershipHash: hash("c"),
          }),
          authority,
        }),
      ).rejects.toThrow("guide run Codex response rejected");
    }
  });

  it("is separately default-off and requires exact lowercase true", () => {
    expect(createLocalCodexGuideRunAgents({})).toBeNull();
    expect(
      createLocalCodexGuideRunAgents({
        REKLAMZEKA_GUIDE_RUN_CODEX_ENABLED: "TRUE",
      }),
    ).toBeNull();
  });
});
