import { describe, expect, it } from "vitest";
import {
  GuideRevisionError, createGuideRevision, interpretGuideBudget, nextGuideScheduledAt,
  type GuideRevisionDraft,
} from "@/domain/guides/guide-revision";

const budget = () => interpretGuideBudget({
  sourceText: "Ana Kurum Kampanyası bütçesinin onda biri veya 100 TL; büyük olan.",
  expression: { kind: "max", operands: [
    { kind: "multiply", operands: [{ kind: "current_budget", scope: "related_organization_campaign" }, { kind: "decimal", value: "0.1" }] },
    { kind: "money", amountMinor: 10_000, currency: "TRY" },
  ] },
  unresolvedRefs: [], currentExample: { ownerRef: "organization_campaign_main", amountMinor: 50_000, currency: "TRY" }, risks: [],
});
const draft = (overrides: Partial<GuideRevisionDraft> = {}): GuideRevisionDraft => ({
  workspaceRef: "workspace_main", guideRef: "guide_main", revision: 1, previousRevisionHash: null,
  sliceRef: "slice_main", market: "yerli", freeText: "Günlük gözlem; belirsizlikte işlem önerme.",
  strict: { limitRefs: [], rollbackConditions: [], budgetInterpretation: budget() },
  schedule: { frequency: "daily", timezone: "Europe/Istanbul", localTime: "09:00" }, mode: "recommend", actionAllowlist: [], ...overrides,
});

describe("guide revision", () => {
  it("hashes the same exact revision independently of object insertion order", () => {
    const first = createGuideRevision(draft());
    const second = createGuideRevision({ ...draft(), strict: { budgetInterpretation: budget(), rollbackConditions: [], limitRefs: [] } });
    expect(first.revisionHash).toBe(second.revisionHash);
    expect(first.authority).toMatchObject({ actionAuthority: "none", canWriteMeta: false, canActivateRevision: false });
  });

  it("keeps action authority closed and makes rename human-only", () => {
    expect(() => createGuideRevision(draft({ mode: "limited_autonomy", actionAllowlist: [] }))).toThrow(GuideRevisionError);
    const autonomous = createGuideRevision(draft({ mode: "limited_autonomy", actionAllowlist: ["budget_increase", "campaign_rename"] }));
    expect(autonomous.authority).toEqual({ actionAuthority: "limited_autonomy", autonomousActions: ["budget_increase"],
      humanApprovalActions: ["campaign_rename"], renameRequiresHumanApproval: true, canWriteMeta: false, canActivateRevision: false });
    const renameOnly = createGuideRevision(draft({ mode: "limited_autonomy", actionAllowlist: ["campaign_rename"] }));
    expect(renameOnly.authority).toMatchObject({ actionAuthority: "human_approval", autonomousActions: [],
      humanApprovalActions: ["campaign_rename"] });
  });

  it("has deterministic DST, month-end clamp, and N-day slots", () => {
    expect(nextGuideScheduledAt({ frequency: "daily", timezone: "America/New_York", localTime: "02:30" }, "2026-03-08T00:00:00.000Z"))
      .toBe("2026-03-08T07:00:00.000Z");
    expect(nextGuideScheduledAt({ frequency: "monthly", timezone: "UTC", localTime: "09:00", dayOfMonth: 31, monthEnd: "clamp" }, "2026-02-01T00:00:00.000Z"))
      .toBe("2026-02-28T09:00:00.000Z");
    expect(nextGuideScheduledAt({ frequency: "custom_days", timezone: "UTC", localTime: "00:00", anchorDate: "2026-01-01", intervalDays: 7 }, "2026-01-08T00:00:00.000Z"))
      .toBe("2026-01-15T00:00:00.000Z");
    expect(() => nextGuideScheduledAt({ frequency: "custom_days", timezone: "UTC", localTime: "00:00", anchorDate: "2026-02-31", intervalDays: 7 }, "2026-01-08T00:00:00.000Z"))
      .toThrow(GuideRevisionError);
  });

  it("does not guess missing budget references and records an exact review diff", () => {
    const unresolved = interpretGuideBudget({ sourceText: "İlgili bütçenin onda biri.", expression: { kind: "multiply", operands: [{ kind: "current_budget", scope: "canonical_budget_owner" }, { kind: "decimal", value: "0.1" }] }, unresolvedRefs: ["current_budget"], currentExample: null, risks: ["Budget owner missing"] });
    expect(unresolved).toMatchObject({ state: "needs_input", currentExample: null, canonicalExpression: "multiply(current_budget(canonical_budget_owner),0.1)" });
    expect(unresolved.reviewDiff.sourceText).not.toBe(unresolved.reviewDiff.canonicalExpression);
    expect(() => interpretGuideBudget({ ...unresolved, unresolvedRefs: [], interpretationHash: undefined } as never)).toThrow(GuideRevisionError);
  });

  it("changes the immutable revision hash for one character of user guidance", () => {
    const one = createGuideRevision(draft());
    const two = createGuideRevision(draft({ freeText: "Günlük gözlem; belirsizlikte işlem öner." }));
    expect(two.revisionHash).not.toBe(one.revisionHash);
  });
});
