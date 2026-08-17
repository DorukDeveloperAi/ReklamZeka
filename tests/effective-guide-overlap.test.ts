import { describe, expect, it } from "vitest";

import {
  EffectiveGuideOverlapError,
  resolveEffectiveGuideOverlap,
  type EffectiveGuideBinding,
} from "@/domain/guides/effective-guide-overlap";
import { createGuideRevision, type GuideMode } from "@/domain/guides/guide-revision";

const guide = (guideRef: string, mode: GuideMode, actionAllowlist: EffectiveGuideBinding["revision"]["actionAllowlist"], market: "yerli" | "yabanci" = "yerli", workspaceRef = "workspace_main") => createGuideRevision({
  workspaceRef, guideRef, revision: 1, previousRevisionHash: null,
  sliceRef: `slice_${guideRef.slice("guide_".length)}`, market, freeText: "Aktif kapsamı kanıtla ve yalnız izinli sonucu üret.",
  strict: { budgetRefs: [], rollbackConditions: [], budgetInterpretation: null },
  schedule: { frequency: "daily", timezone: "Europe/Istanbul", localTime: "09:00" }, mode, actionAllowlist,
});
const binding = (revision: EffectiveGuideBinding["revision"], overrides: Partial<Omit<EffectiveGuideBinding, "revision">> = {}): EffectiveGuideBinding => ({
  revision, restrictions: [], numericCaps: [], unresolvedConflictRefs: [], ...overrides,
});
const resolve = (guides: readonly EffectiveGuideBinding[], market: "yerli" | "yabanci" = "yerli") => resolveEffectiveGuideOverlap({
  workspaceRef: "workspace_main", entityRef: "campaign_main", market, guides,
});

describe("effective Guide overlap", () => {
  it("intersects the closed catalog and chooses the most restrictive mode independently of input order", () => {
    const autonomous = binding(guide("guide_autonomy", "limited_autonomy", ["status_pause", "budget_increase", "campaign_rename"]));
    const recommend = binding(guide("guide_recommend", "recommend", ["budget_increase", "campaign_rename"]));
    const first = resolve([autonomous, recommend]);
    const reverse = resolve([recommend, autonomous]);

    expect(first).toMatchObject({ effectiveMode: "recommend", actionAllowlist: ["budget_increase", "campaign_rename"],
      recommendationActions: ["budget_increase", "campaign_rename"], humanApprovalActions: [], autonomousActions: [],
      authority: { actionExecution: "none", canApprove: false, canExecute: false, canWriteMeta: false, canGrantAutonomy: false } });
    expect(reverse).toEqual(first);
    expect(first.effectiveGuideSetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.resolutionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("unions deny, manual-lock and protection restrictions with the strictest disposition", () => {
    const result = resolve([
      binding(guide("guide_one", "limited_autonomy", ["status_pause", "budget_increase", "campaign_rename"]), { restrictions: [
        { restrictionRef: "restriction_pause", kind: "deny", actions: ["status_pause"] },
        { restrictionRef: "restriction_budget_lock", kind: "manual_lock", actions: ["budget_increase"] },
      ] }),
      binding(guide("guide_two", "limited_autonomy", ["status_pause", "budget_increase", "campaign_rename"]), { restrictions: [
        { restrictionRef: "restriction_name", kind: "protection", disposition: "human_approval", actions: ["campaign_rename"] },
      ] }),
    ]);

    expect(result.deniedActions).toEqual(["status_pause", "budget_increase"]);
    expect(result.autonomousActions).toEqual([]);
    expect(result.humanApprovalActions).toEqual(["campaign_rename"]);
    expect(result.restrictions.map((item) => item.restrictionRef)).toEqual([
      "restriction_budget_lock", "restriction_name", "restriction_pause",
    ]);
  });

  it("takes the lowest cap per action and exact cap kind while preserving all evidence refs", () => {
    const first = binding(guide("guide_first", "limited_autonomy", ["budget_increase"]), { numericCaps: [
      { capRef: "cap_abs_first", action: "budget_increase", kind: "maximum_absolute_budget_delta_minor", value: 10_000, currency: "TRY" },
      { capRef: "cap_rel_first", action: "budget_increase", kind: "maximum_relative_budget_delta_basis_points", value: 2_000, currency: null },
    ] });
    const second = binding(guide("guide_second", "limited_autonomy", ["budget_increase"]), { numericCaps: [
      { capRef: "cap_abs_second", action: "budget_increase", kind: "maximum_absolute_budget_delta_minor", value: 7_500, currency: "TRY" },
      { capRef: "cap_rel_second", action: "budget_increase", kind: "maximum_relative_budget_delta_basis_points", value: 2_500, currency: null },
    ] });
    const result = resolve([first, second]);

    expect(result.numericCaps).toEqual([
      { action: "budget_increase", kind: "maximum_absolute_budget_delta_minor", value: 7_500, currency: "TRY", sourceCapRefs: ["cap_abs_first", "cap_abs_second"] },
      { action: "budget_increase", kind: "maximum_relative_budget_delta_basis_points", value: 2_000, currency: null, sourceCapRefs: ["cap_rel_first", "cap_rel_second"] },
    ]);
  });

  it("keeps rename human-only even when every Guide permits limited autonomy", () => {
    const result = resolve([
      binding(guide("guide_first", "limited_autonomy", ["budget_decrease", "adset_rename"])),
      binding(guide("guide_second", "limited_autonomy", ["budget_decrease", "adset_rename"])),
    ]);
    expect(result.autonomousActions).toEqual(["budget_decrease"]);
    expect(result.humanApprovalActions).toEqual(["adset_rename"]);
  });

  it("keeps observe and human-preparation modes distinct and authority-free", () => {
    const observed = resolve([
      binding(guide("guide_observe", "observe_analyze", ["status_pause", "budget_decrease"])),
      binding(guide("guide_autonomous", "limited_autonomy", ["status_pause", "budget_decrease"])),
    ]);
    expect(observed).toMatchObject({ effectiveMode: "observe_analyze", recommendationActions: [],
      humanApprovalActions: [], autonomousActions: [], authority: { actionExecution: "none" } });

    const prepared = resolve([
      binding(guide("guide_prepare", "prepare_human_approval", ["status_pause", "budget_decrease"])),
      binding(guide("guide_autonomous_two", "limited_autonomy", ["status_pause", "budget_decrease"])),
    ]);
    expect(prepared).toMatchObject({ effectiveMode: "prepare_human_approval",
      humanApprovalActions: ["status_pause", "budget_decrease"], autonomousActions: [],
      authority: { canApprove: false, canExecute: false, canWriteMeta: false } });
  });

  it("holds unresolved compiled conflicts without silently dropping evidence", () => {
    const result = resolve([binding(guide("guide_conflict", "limited_autonomy", ["status_activate"]), {
      unresolvedConflictRefs: ["conflict_status_instruction"],
    })]);
    expect(result.hold).toEqual({ state: "held", reasonCodes: ["unresolved_constraint_conflict"],
      conflictRefs: ["conflict_status_instruction"] });
    expect(result.autonomousActions).toEqual([]);
    expect(result.authority.canExecute).toBe(false);
  });

  it("deduplicates identical constraint refs but holds a reused ref with different semantics", () => {
    const revisionOne = guide("guide_one", "limited_autonomy", ["status_pause", "status_activate"]);
    const revisionTwo = guide("guide_two", "limited_autonomy", ["status_pause", "status_activate"]);
    const shared = { restrictionRef: "restriction_shared", kind: "deny" as const, actions: ["status_pause"] as const };
    const deduplicated = resolve([binding(revisionOne, { restrictions: [shared] }), binding(revisionTwo, { restrictions: [shared] })]);
    expect(deduplicated.restrictions).toHaveLength(1);
    expect(deduplicated.hold.state).toBe("clear");

    const conflict = resolve([binding(revisionOne, { restrictions: [shared] }), binding(revisionTwo, { restrictions: [
      { ...shared, actions: ["status_activate"] },
    ] })]);
    expect(conflict.hold).toEqual({ state: "held", reasonCodes: ["unresolved_constraint_conflict"], conflictRefs: ["restriction_shared"] });
    expect(conflict.autonomousActions).toEqual([]);
  });

  it("fails closed for an empty set, market/workspace mismatch, duplicate active heads and forged revisions", () => {
    expect(() => resolve([])).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => resolve([binding(guide("guide_foreign_market", "recommend", ["status_pause"], "yabanci"))]))
      .toThrowError(expect.objectContaining({ code: "market_boundary" }));
    const foreignWorkspace = guide("guide_workspace", "recommend", ["status_pause"], "yerli", "workspace_foreign");
    expect(() => resolve([binding(foreignWorkspace)])).toThrowError(expect.objectContaining({ code: "workspace_scope_mismatch" }));
    const same = binding(guide("guide_duplicate", "recommend", ["status_pause"]));
    expect(() => resolve([same, same])).toThrowError(expect.objectContaining({ code: "active_guide_conflict" }));
    const { schemaVersion: _schemaVersion, authority: _authority, interpretationHash: _interpretationHash,
      revisionHash: _revisionHash, ...previousDraft } = same.revision;
    const nextHead = createGuideRevision({ ...previousDraft, revision: 2, previousRevisionHash: same.revision.revisionHash,
      freeText: "Yeni aktif baş adayı." });
    expect(() => resolve([same, binding(nextHead)])).toThrowError(expect.objectContaining({ code: "active_guide_conflict" }));
    const forged = { ...guide("guide_forged", "recommend", ["status_pause"]), revisionHash: "0".repeat(64) };
    expect(() => resolve([binding(forged)])).toThrowError(expect.objectContaining({ code: "corrupt_revision" }));
  });

  it("rejects malformed bounds, non-budget budget caps, and unknown input keys", () => {
    const revision = guide("guide_bounds", "limited_autonomy", ["status_pause"]);
    expect(() => resolve([binding(revision, { numericCaps: [{ capRef: "cap_bad", action: "status_pause",
      kind: "maximum_absolute_budget_delta_minor", value: 10, currency: "TRY" }] })])).toThrow(EffectiveGuideOverlapError);
    expect(() => resolveEffectiveGuideOverlap({ workspaceRef: "workspace_main", entityRef: "campaign_main", market: "yerli",
      guides: [binding(revision)], injectedHealth: "ready" } as never)).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });
});
