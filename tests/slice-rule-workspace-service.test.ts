import { describe, expect, it, vi } from "vitest";

import {
  SliceRuleWorkspaceError,
  SliceRuleWorkspaceService,
  createSliceRuleWorkspaceDraft,
  verifySliceRuleWorkspaceDraft,
} from "@/application/slice-rule-workspace-service";

const input = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  seriesRef: "slice_rule.ftr.ar",
  revision: 1,
  previousDraftHash: "GENESIS" as const,
  idempotencyKey: "slice_rule.ftr.ar.r1",
  createdAt: "2026-08-13T10:00:00.000Z",
  scope: {
    market: "international" as const,
    serviceRef: "service_physical_therapy_rehab",
    campaignFamilyRef: "campaign_family_intensive_ftr",
    countryOrRegion: "Arap Bölgesi",
    audienceStrategy: "Özel seçilmiş hedefleme",
    platform: "instagram" as const,
  },
  rule: { kind: "period_budget_cap" as const, period: "monthly" as const, currency: "TRY", maximumDecimal: "250000" },
  priority: 100,
  verification: { metric: "cost_per_qualified_lead" as const, reviewCadence: "weekly" as const,
    rollbackWhen: "Yeni sonuç kanıtı veya hedefleme değişimi insan incelemesini gerektirirse." },
};

describe("Slice Rule Workspace service", () => {
  it("creates a deterministic recommendation-only draft with an exact labelled scope", () => {
    const first = createSliceRuleWorkspaceDraft(input);
    const second = createSliceRuleWorkspaceDraft(input);
    expect(first.draftHash).toBe(second.draftHash);
    expect(first.scope).toEqual(input.scope);
    expect(first.operatingRule.slice).toEqual(input.scope);
    expect(first.operatingMode).toBe("recommendation_only");
    expect(first.operatingRule.automationMode).toBe("recommendation_only");
    expect(first.authority).toEqual({ canPublish: false, canApprove: false, canExecute: false,
      canWriteMeta: false, canEnableAutomation: false });
    expect(verifySliceRuleWorkspaceDraft(first)).toBe(true);
  });

  it("requires market, service and family instead of inferring them", () => {
    for (const key of ["market", "serviceRef", "campaignFamilyRef"] as const) {
      const scope = { ...input.scope } as Record<string, unknown>;
      delete scope[key];
      expect(() => createSliceRuleWorkspaceDraft({ ...input, scope } as never)).toThrow(SliceRuleWorkspaceError);
    }
    expect(() => createSliceRuleWorkspaceDraft({ ...input, scope: { ...input.scope, market: "unknown" } } as never))
      .toThrow(SliceRuleWorkspaceError);
  });

  it("does not accept hidden scope dimensions or forged authority", () => {
    expect(() => createSliceRuleWorkspaceDraft({ ...input,
      scope: { ...input.scope, accountRef: "account_hidden" } } as never)).toThrow(SliceRuleWorkspaceError);
    const draft = createSliceRuleWorkspaceDraft(input);
    expect(verifySliceRuleWorkspaceDraft({ ...draft, authority: { ...draft.authority, canPublish: true } })).toBe(false);
    expect(verifySliceRuleWorkspaceDraft({ ...draft, operatingMode: "approval_required" })).toBe(false);
  });

  it("persists only through the draft port and reports immutable authority", async () => {
    const append = vi.fn(async () => ({ outcome: "inserted" as const, auditAppended: true }));
    const result = await new SliceRuleWorkspaceService({ append }).saveDraft(
      "22222222-2222-4222-8222-222222222222", input);
    expect(append).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ persistence: "inserted", auditAppended: true,
      authority: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
  });
});
