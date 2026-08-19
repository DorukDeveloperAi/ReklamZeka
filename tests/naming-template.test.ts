import { describe, expect, it } from "vitest";

import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";
import { createNamingTemplateRevision, NamingTemplateError, replayNamingTemplate,
  transitionNamingTemplateRevision } from "@/domain/campaigns/naming-template";

const workspaceRef = `workspace_${"a".repeat(24)}`;
const accountRef = `account_${"b".repeat(24)}`;
const campaignRef = `campaign_${"c".repeat(24)}`;
const adSetRef = `ad_set_${"d".repeat(24)}`;
const evidence = (suffix: string) => `evidence_${suffix.repeat(24).slice(0, 24)}`;
const marketDimension = categoryDimensionPublicRef("market");
const foreignDefinition = categoryDefinitionPublicRef("market", "yabanci");
const geoDimension = categoryDimensionPublicRef("geo_market");
const gulfDefinition = categoryDefinitionPublicRef("geo_market", "gulf");

function template(level: "campaign" | "ad_set" = "ad_set") {
  const draft = createNamingTemplateRevision({ workspaceRef, accountRef, templateRef: "naming_template_gulf_leads", revision: 1,
    previousRevisionHash: null, state: "draft", namingFamily: "gulf_leads_v1", entityLevel: level,
    nameRules: level === "campaign" ? [{ source: "campaign_name", match: "all", tokens: ["FTR", "Lead"] }]
      : [{ source: "campaign_name", match: "all", tokens: ["FTR"] },
        { source: "ad_set_name", match: "all", tokens: ["Katar", "Instagram"] }],
    corroboration: level === "campaign" ? [{ kind: "objective", operator: "equals", expected: ["lead_generation"] }]
      : [{ kind: "optimization", operator: "equals", expected: ["lead_generation"] },
        { kind: "geo", operator: "includes_all", expected: ["qa"] },
        { kind: "platform", operator: "includes_any", expected: ["instagram"] },
        { kind: "cta", operator: "equals", expected: ["whatsapp_message"] },
        { kind: "targeting", operator: "present", expected: [] }],
    proposedAssignments: [{ dimensionRef: marketDimension, definitionRef: foreignDefinition },
      ...(level === "ad_set" ? [{ dimensionRef: geoDimension, definitionRef: gulfDefinition }] : [])] });
  return transitionNamingTemplateRevision(draft, { ...draft, revision: 2, previousRevisionHash: draft.revisionHash,
    state: "published", revisionHash: undefined } as never);
}

function reversePropertyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversePropertyOrder);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .reverse().map(([key, child]) => [key, reversePropertyOrder(child)]));
  return value;
}

function replayInput(level: "campaign" | "ad_set" = "ad_set") {
  return { workspaceRef, accountRef, entityLevel: level, entityRef: level === "campaign" ? campaignRef : adSetRef,
    names: { campaign: { value: "FTR Lead 2026", evidenceRef: evidence("1") },
      adSet: level === "ad_set" ? { value: "Katar Instagram özel", evidenceRef: evidence("2") } : null },
    evidence: level === "campaign"
      ? [{ kind: "objective" as const, state: "known" as const, values: ["lead_generation"], evidenceRef: evidence("3") }]
      : [{ kind: "optimization" as const, state: "known" as const, values: ["lead_generation"], evidenceRef: evidence("3") },
        { kind: "geo" as const, state: "known" as const, values: ["qa"], evidenceRef: evidence("4") },
        { kind: "platform" as const, state: "known" as const, values: ["instagram"], evidenceRef: evidence("5") },
        { kind: "cta" as const, state: "known" as const, values: ["whatsapp_message"], evidenceRef: evidence("6") },
        { kind: "targeting" as const, state: "known" as const, values: ["broad"], evidenceRef: evidence("7") },
        { kind: "creative" as const, state: "known" as const, values: ["primary_text_present"], evidenceRef: evidence("8") },
        { kind: "destination" as const, state: "known" as const, values: ["whatsapp"], evidenceRef: evidence("9") }],
    currentAssignments: [] } as const;
}

describe("versioned naming template domain", () => {
  it("normalizes an immutable versioned aggregate with deterministic hash and no authority", () => {
    const first = template(); const second = template();
    expect(first).toEqual(second); expect(first.revisionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.authority).toEqual({ canPropose: true, canAssign: false, canPublish: false,
      canApprove: false, canExecute: false, canWriteMeta: false });
  });

  it("accepts canonically equal deserialized revisions regardless of property order and rejects extra keys", () => {
    const published = template();
    expect(replayNamingTemplate(reversePropertyOrder(published) as typeof published, replayInput()).status).toBe("candidate");
    expect(() => replayNamingTemplate({ ...published, unexpected: undefined } as never, replayInput()))
      .toThrowError(expect.objectContaining({ code: "corrupt_template" }));
  });

  it("forbids name-only templates, regex-like tokens, duplicate dimensions and invalid lifecycle chains", () => {
    const base = template();
    expect(() => createNamingTemplateRevision({ ...base, corroboration: [], revisionHash: undefined } as never)).toThrow(NamingTemplateError);
    expect(() => createNamingTemplateRevision({ ...base,
      nameRules: [{ source: "ad_set_name", match: "all", tokens: ["(a+)+$"] }], revisionHash: undefined } as never)).toThrow(NamingTemplateError);
    expect(() => createNamingTemplateRevision({ ...base,
      proposedAssignments: [{ dimensionRef: marketDimension, definitionRef: foreignDefinition },
        { dimensionRef: marketDimension, definitionRef: gulfDefinition }], revisionHash: undefined } as never)).toThrow(NamingTemplateError);
    expect(() => createNamingTemplateRevision({ ...base, revision: 2, previousRevisionHash: null,
      revisionHash: undefined } as never)).toThrowError(expect.objectContaining({ code: "invalid_revision" }));
    expect(() => createNamingTemplateRevision({ ...base, revision: 1, previousRevisionHash: null,
      state: "published", revisionHash: undefined } as never)).toThrowError(expect.objectContaining({ code: "invalid_revision" }));
  });

  it("uses campaign and ad-set name contributions but requires canonical corroboration", () => {
    const adSet = replayNamingTemplate(template(), replayInput());
    const campaign = replayNamingTemplate(template("campaign"), replayInput("campaign"));
    expect(adSet.status).toBe("candidate"); expect(adSet.proposals).toHaveLength(2);
    expect(campaign.status).toBe("candidate"); expect(campaign.proposals).toHaveLength(1);
    expect(() => replayNamingTemplate(template(), { ...replayInput(), accountRef: `account_${"f".repeat(24)}` }))
      .toThrowError(expect.objectContaining({ code: "invalid_scope" }));
    expect(() => replayNamingTemplate(template(), replayInput("campaign")))
      .toThrowError(expect.objectContaining({ code: "invalid_scope" }));
  });

  it("separates conflicting evidence from missing or partial targeting evidence", () => {
    const conflict = replayNamingTemplate(template(), { ...replayInput(), evidence: replayInput().evidence.map((item) =>
      item.kind === "geo" ? { ...item, values: ["tr"] } : item) });
    expect(conflict).toMatchObject({ status: "conflict", reasonCodes: ["geo_conflict"], proposals: [] });
    const missing = replayNamingTemplate(template(), { ...replayInput(), evidence: replayInput().evidence.map((item) =>
      item.kind === "targeting" ? { ...item, state: "missing" as const, values: [] } : item) });
    expect(missing).toMatchObject({ status: "insufficient_evidence", reasonCodes: ["targeting_insufficient"], proposals: [] });
  });

  it("supports bounded creative and destination corroboration without exposing their values", () => {
    const enriched = createNamingTemplateRevision({ ...template(), corroboration: [
      ...template().corroboration,
      { kind: "creative", operator: "includes_any", expected: ["primary_text_present"] },
      { kind: "destination", operator: "equals", expected: ["whatsapp"] },
    ], revisionHash: undefined } as never);
    const replay = replayNamingTemplate(enriched, replayInput());
    expect(replay.status).toBe("candidate");
    expect(JSON.stringify(replay)).not.toMatch(/primary_text_present|whatsapp/);
  });

  it("fails closed on oversized replay collections and unknown evidence kinds", () => {
    const input = replayInput();
    expect(() => replayNamingTemplate(template(), { ...input,
      evidence: Array.from({ length: 9 }, (_, index) => ({ ...input.evidence[0]!, evidenceRef: evidence(String(index)) })) } as never))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => replayNamingTemplate(template(), { ...input,
      evidence: [{ kind: "unknown", state: "known", values: ["x"], evidenceRef: evidence("a") }] } as never))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => replayNamingTemplate(template(), { ...input,
      currentAssignments: Array.from({ length: 65 }, (_, index) => ({ dimensionRef: marketDimension,
        definitionRef: foreignDefinition, manualLock: false, evidenceRef: evidence((index % 10).toString()) })) } as never))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    const disabled = createNamingTemplateRevision({ ...template(), revision: 2,
      previousRevisionHash: template().revisionHash, state: "disabled", revisionHash: undefined } as never);
    expect(() => replayNamingTemplate(disabled, { ...input,
      names: { ...input.names, campaign: { ...input.names.campaign, evidenceRef: "raw_meta_id" } } }))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("lets a manual lock win over a matching naming candidate", () => {
    const conflict = replayNamingTemplate(template(), { ...replayInput(), currentAssignments: [{ dimensionRef: marketDimension,
      definitionRef: categoryDefinitionPublicRef("market", "yerli"), manualLock: true, evidenceRef: evidence("7") }] });
    expect(conflict).toMatchObject({ status: "conflict", reasonCodes: ["manual_lock_conflict"], proposals: [] });
    const same = replayNamingTemplate(template(), { ...replayInput(), currentAssignments: [{ dimensionRef: marketDimension,
      definitionRef: foreignDefinition, manualLock: true, evidenceRef: evidence("7") }] });
    expect(same.status).toBe("candidate");
    expect(same.proposals.find((item) => item.dimensionRef === marketDimension)?.disposition).toBe("already_manually_locked");
  });

  it("replays deterministically and exposes refs rather than raw names, IDs or creative text", () => {
    const input = replayInput(); const first = replayNamingTemplate(template(), input);
    const second = replayNamingTemplate(template(), { ...input, evidence: [...input.evidence].reverse() });
    expect(first.resultHash).toBe(second.resultHash);
    const unrelated = replayNamingTemplate(template(), { ...input, evidence: [...input.evidence,
      { kind: "objective" as const, state: "known" as const, values: ["traffic"], evidenceRef: evidence("a") }] });
    expect(unrelated.resultHash).toBe(first.resultHash);
    expect(unrelated.evidenceRefs).not.toContain(evidence("a"));
    const publicJson = JSON.stringify(first);
    expect(publicJson).not.toMatch(/FTR Lead|Katar Instagram|raw_campaign_123|patient secret/i);
    expect(first.evidenceRefs).toEqual([...first.evidenceRefs].sort());
    expect(first.authority.canWriteMeta).toBe(false);
  });

  it("validates immutable draft, published and disabled lifecycle transitions", () => {
    const published = template();
    const draft = createNamingTemplateRevision({ ...published, revision: 3, previousRevisionHash: published.revisionHash,
      state: "draft", revisionHash: undefined } as never);
    expect(transitionNamingTemplateRevision(published, { ...draft, revisionHash: undefined } as never).state).toBe("draft");
    const republished = createNamingTemplateRevision({ ...draft, revision: 4, previousRevisionHash: draft.revisionHash,
      state: "published", revisionHash: undefined } as never);
    expect(transitionNamingTemplateRevision(draft, { ...republished, revisionHash: undefined } as never).state).toBe("published");
    const disabled = createNamingTemplateRevision({ ...republished, revision: 5, previousRevisionHash: republished.revisionHash,
      state: "disabled", revisionHash: undefined } as never);
    expect(transitionNamingTemplateRevision(republished, { ...disabled, revisionHash: undefined } as never).state).toBe("disabled");
    expect(() => transitionNamingTemplateRevision(disabled, { ...disabled, revision: 6,
      previousRevisionHash: disabled.revisionHash, state: "draft", revisionHash: undefined } as never))
      .toThrowError(expect.objectContaining({ code: "invalid_revision" }));
    expect(() => transitionNamingTemplateRevision(published, { ...published, revision: 3,
      previousRevisionHash: published.revisionHash, state: "published", revisionHash: undefined } as never))
      .toThrowError(expect.objectContaining({ code: "invalid_revision" }));
    for (const changedIdentity of [
      { accountRef: `account_${"f".repeat(24)}` },
      { templateRef: "naming_template_other" },
      { namingFamily: "other_family" },
    ]) {
      expect(() => transitionNamingTemplateRevision(published, { ...draft, ...changedIdentity,
        revisionHash: undefined } as never)).toThrowError(expect.objectContaining({ code: "invalid_revision" }));
    }
  });
});
