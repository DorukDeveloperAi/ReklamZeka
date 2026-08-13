import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  buildSliceRuleDraftCommand,
  EMPTY_SLICE_RULE_FORM,
  parseSliceRuleWorkspaceSnapshot,
  SliceRuleWorkspaceSurface,
} from "@/app/dashboard/slice-rule-workspace-panel";

const closed = { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false } as const;
const item = { schemaVersion: "public-slice-rule-workspace-draft/1.0.0", seriesRef: "slice_rule.ftr.ar", revision: 1,
  draftRef: `slice_rule_draft_${"a".repeat(20)}`, draftHash: "b".repeat(64), status: "draft", operatingMode: "recommendation_only",
  scope: { market: "international", serviceRef: "service_physical_therapy", campaignFamilyRef: "campaign_family_intensive_ftr",
    countryOrRegion: "Arap Bölgesi", audienceStrategy: "Özel hedefleme", platform: "instagram" },
  operatingRule: { rule: { kind: "period_budget_cap", period: "monthly", currency: "TRY", maximumDecimal: "250000" },
    priority: 80, verification: { metric: "cost_per_qualified_lead", reviewCadence: "weekly",
      rollbackWhen: "Kapsam değişirse." }, authority: closed }, createdAt: "2026-08-13T10:00:00.000Z", authority: closed } as const;
const snapshot = { contractVersion: "slice-rule-workspace-http/1.0.0", items: [item], authority: { canRead: true,
  canSaveDraft: true, ...closed } } as const;

describe("Slice Rule Workspace panel", () => {
  it("renders mandatory/optional scope and makes the closed authority explicit", () => {
    const html = renderToStaticMarkup(createElement(SliceRuleWorkspaceSurface, { state: { status: "ready",
      snapshot: parseSliceRuleWorkspaceSnapshot(snapshot) }, onRetry: vi.fn(), onSaved: vi.fn(async () => undefined) }));
    for (const label of ["Pazar", "Hizmet referansı", "Kampanya ailesi referansı", "Ülke / bölge (opsiyonel)",
      "Hedefleme stratejisi (opsiyonel)", "Platform (opsiyonel)"]) expect(html).toContain(label);
    expect(html).toContain("RECOMMENDATION ONLY · AUTHORITY NONE");
    expect(html).toContain("Policy yayınlama: kapalı");
    expect(html).toContain("Action/Meta write: kapalı");
  });

  it("keeps a viewer read-only", () => {
    const viewer = parseSliceRuleWorkspaceSnapshot({ ...snapshot, authority: { ...snapshot.authority, canSaveDraft: false } });
    const html = renderToStaticMarkup(createElement(SliceRuleWorkspaceSurface, { state: { status: "ready", snapshot: viewer },
      onRetry: vi.fn(), onSaved: vi.fn(async () => undefined) }));
    expect(html).toContain("Viewer · salt okunur");
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Taslağı kaydet<\/button>/);
  });

  it("builds only an exact, recommendation-only service command", () => {
    const form = { ...EMPTY_SLICE_RULE_FORM, seriesRef: "slice_rule.ftr.ar", serviceRef: "service_physical_therapy",
      campaignFamilyRef: "campaign_family_intensive_ftr", maximumDecimal: "250000", countryOrRegion: "Arap Bölgesi" };
    expect(buildSliceRuleDraftCommand(form)).toMatchObject({ operation: "save_draft", revision: 1,
      previousDraftHash: "GENESIS", scope: { market: "international", serviceRef: "service_physical_therapy",
        campaignFamilyRef: "campaign_family_intensive_ftr", countryOrRegion: "Arap Bölgesi" },
      rule: { kind: "period_budget_cap", maximumDecimal: "250000" } });
    expect(buildSliceRuleDraftCommand({ ...form, serviceRef: "" })).toBeNull();
  });

  it("rejects opened authority anywhere in the response", () => {
    expect(() => parseSliceRuleWorkspaceSnapshot({ ...snapshot, items: [{ ...item,
      operatingRule: { ...item.operatingRule, authority: { ...closed, canExecute: true } } }] })).toThrow("güvenli sözleşmeyi");
    expect(() => parseSliceRuleWorkspaceSnapshot({ ...snapshot,
      authority: { ...snapshot.authority, canWriteMeta: true } })).toThrow("güvenli sözleşmeyi");
  });
});
