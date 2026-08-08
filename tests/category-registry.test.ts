import { describe, expect, it } from "vitest";
import {
  CategoryResolutionError,
  inspectEffectiveCategory,
  resolveEffectiveCategory,
  type CategoryAssignment,
  type CategoryDefinition,
  type CategoryDimension,
  type CategoryEntityPath,
} from "@/domain/categories/registry";

const workspaceId = "workspace-1";

function dimension(overrides: Partial<CategoryDimension> = {}): CategoryDimension {
  return {
    id: "dimension-market",
    workspaceId,
    key: "internal_campaign_type",
    version: 3,
    cardinality: "single",
    allowedEntityLevels: ["campaign", "ad_set", "ad", "creative"],
    archivedAt: null,
    ...overrides,
  };
}

const definitions: readonly CategoryDefinition[] = [
  {
    id: "definition-brand",
    workspaceId,
    dimensionId: "dimension-market",
    key: "brand_protection",
    label: "Marka koruma",
    version: 2,
    archivedAt: null,
  },
  {
    id: "definition-patient",
    workspaceId,
    dimensionId: "dimension-market",
    key: "international_patient",
    label: "Uluslararası hasta",
    version: 4,
    archivedAt: null,
  },
  {
    id: "definition-doctor",
    workspaceId,
    dimensionId: "dimension-market",
    key: "doctor_promotion",
    label: "Doktor tanıtımı",
    version: 1,
    archivedAt: null,
  },
];

const path: CategoryEntityPath = {
  workspaceId,
  nodes: [
    { level: "campaign", id: "campaign-1" },
    { level: "ad_set", id: "ad-set-1" },
    { level: "ad", id: "ad-1" },
    { level: "creative", id: "creative-1" },
  ],
};

function assignment(
  id: string,
  definitionId: string,
  level: CategoryAssignment["entity"]["level"],
  entityId: string,
  operation: CategoryAssignment["operation"],
  overrides: Partial<CategoryAssignment> = {},
): CategoryAssignment {
  return {
    id,
    workspaceId,
    dimensionId: "dimension-market",
    definitionId,
    entity: { level, id: entityId },
    operation,
    source: "manual",
    manualLock: false,
    evidence: [{ kind: "owner_instruction", ref: `instruction:${id}` }],
    confidence: 1,
    version: 1,
    archivedAt: null,
    ...overrides,
  };
}

describe("category registry effective inheritance", () => {
  it("inherits a single value and requires explicit override to replace it", () => {
    const result = resolveEffectiveCategory({
      dimension: dimension(),
      definitions,
      path,
      assignments: [
        assignment("a-campaign", "definition-brand", "campaign", "campaign-1", "add", {
          manualLock: true,
          version: 5,
        }),
        assignment("a-ad-set", "definition-patient", "ad_set", "ad-set-1", "override", { version: 2 }),
      ],
    });

    expect(result.values.map((value) => value.key)).toEqual(["international_patient"]);
    expect(result.frozenContext.dimension).toEqual({
      id: "dimension-market",
      key: "internal_campaign_type",
      version: 3,
      cardinality: "single",
    });
    expect(result.frozenContext.effectiveDefinitions).toEqual([
      { id: "definition-patient", key: "international_patient", version: 4 },
    ]);
    expect(result.frozenContext.evaluatedAssignments).toEqual([
      { id: "a-campaign", version: 5, operation: "add", entityLevel: "campaign", manualLock: true },
      { id: "a-ad-set", version: 2, operation: "override", entityLevel: "ad_set", manualLock: false },
    ]);
    expect(result.frozenContext.resolutionHash).toMatch(/^[a-f0-9]{64}$/);

    expect(() => resolveEffectiveCategory({
      dimension: dimension(),
      definitions,
      path,
      assignments: [
        assignment("a-campaign", "definition-brand", "campaign", "campaign-1", "add"),
        assignment("a-ad-set", "definition-patient", "ad_set", "ad-set-1", "add"),
      ],
    })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({
      code: "parked_conflict",
    }));
  });

  it("supports multi-value child add, deny and creative-level restoration", () => {
    const multi = dimension({ cardinality: "multi" });
    const result = resolveEffectiveCategory({
      dimension: multi,
      definitions,
      path,
      assignments: [
        assignment("a-brand", "definition-brand", "campaign", "campaign-1", "add"),
        assignment("a-patient", "definition-patient", "ad_set", "ad-set-1", "add"),
        assignment("a-deny-brand", "definition-brand", "ad", "ad-1", "deny"),
        assignment("a-doctor", "definition-doctor", "creative", "creative-1", "add"),
      ],
    });

    expect(result.values.map((value) => value.key)).toEqual([
      "doctor_promotion",
      "international_patient",
    ]);
    expect(result.frozenContext.definitionVersions.map((value) => value.key)).toEqual([
      "brand_protection",
      "doctor_promotion",
      "international_patient",
    ]);

    const restored = resolveEffectiveCategory({
      dimension: multi,
      definitions,
      path,
      assignments: [
        assignment("a-brand", "definition-brand", "campaign", "campaign-1", "add"),
        assignment("a-deny-brand", "definition-brand", "ad", "ad-1", "deny"),
        assignment("a-restore-brand", "definition-brand", "creative", "creative-1", "add"),
      ],
    });
    expect(restored.values.map((value) => value.key)).toEqual(["brand_protection"]);
  });

  it("is deterministic across input order and ignores off-path assignments", () => {
    const assignments = [
      assignment("b", "definition-patient", "ad_set", "ad-set-1", "add"),
      assignment("a", "definition-brand", "campaign", "campaign-1", "add"),
      assignment("off-path", "definition-doctor", "ad", "another-ad", "add"),
    ];
    const first = resolveEffectiveCategory({
      dimension: dimension({ cardinality: "multi" }),
      definitions: [...definitions].reverse(),
      assignments,
      path,
    });
    const replay = resolveEffectiveCategory({
      dimension: dimension({ cardinality: "multi" }),
      definitions,
      assignments: [...assignments].reverse(),
      path,
    });

    expect(replay.frozenContext).toEqual(first.frozenContext);
    expect(first.frozenContext.evaluatedAssignments.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("parks automatic changes that would violate a manual lock", () => {
    const locked = assignment("locked", "definition-brand", "campaign", "campaign-1", "add", {
      manualLock: true,
    });
    const automaticOverride = assignment(
      "agent-override",
      "definition-patient",
      "ad_set",
      "ad-set-1",
      "override",
      { source: "agent", confidence: 0.8 },
    );
    expect(() => resolveEffectiveCategory({
      dimension: dimension(),
      definitions,
      path,
      assignments: [locked, automaticOverride],
    })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({ code: "parked_conflict" }));

    const manualOverride = { ...automaticOverride, source: "manual" as const };
    expect(resolveEffectiveCategory({
      dimension: dimension(),
      definitions,
      path,
      assignments: [locked, manualOverride],
    }).values.map((value) => value.key)).toEqual(["international_patient"]);

    expect(() => resolveEffectiveCategory({
      dimension: dimension(),
      definitions,
      path,
      assignments: [{ ...locked, source: "agent" }],
    })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({ code: "invalid_registry" }));
  });
});

describe("category registry structured inspection", () => {
  it("classifies single parent add plus child add and accepts an explicit child override", () => {
    const parent = assignment("parent", "definition-brand", "campaign", "campaign-1", "add");
    const childAdd = assignment("child-add", "definition-patient", "ad_set", "ad-set-1", "add");
    expect(inspectEffectiveCategory({ dimension: dimension(), definitions, path,
      assignments: [parent, childAdd] })).toEqual({
      state: "parked_conflict", reason: "single_child_add_requires_override", resolution: null,
    });

    const childOverride = { ...childAdd, operation: "override" as const };
    const inspected = inspectEffectiveCategory({ dimension: dimension(), definitions, path,
      assignments: [parent, childOverride] });
    expect(inspected.state).toBe("applied");
    if (inspected.state === "applied") {
      expect(inspected.reason).toBe("effective_definition");
      expect(inspected.resolution.values.map((value) => value.key)).toEqual(["international_patient"]);
    }
  });

  it("allows multi-value inheritance and reports an empty effective set as unmatched", () => {
    const multi = inspectEffectiveCategory({ dimension: dimension({ cardinality: "multi" }), definitions, path,
      assignments: [
        assignment("parent", "definition-brand", "campaign", "campaign-1", "add"),
        assignment("child", "definition-patient", "ad_set", "ad-set-1", "add"),
      ] });
    expect(multi.state).toBe("applied");
    if (multi.state === "applied") {
      expect(multi.resolution.values.map((value) => value.key)).toEqual(["brand_protection", "international_patient"]);
    }
    expect(inspectEffectiveCategory({ dimension: dimension(), definitions, path, assignments: [] })).toMatchObject({
      state: "unmatched", reason: "no_effective_definition", resolution: { values: [] },
    });
  });

  it("returns stable manual-lock reasons for automatic override, add and deny", () => {
    const positiveLock = assignment("positive-lock", "definition-brand", "campaign", "campaign-1", "add", {
      manualLock: true,
    });
    const denyLock = assignment("deny-lock", "definition-brand", "campaign", "campaign-1", "deny", {
      manualLock: true,
    });
    const automatic = { source: "agent" as const, confidence: 0.8 };
    expect(inspectEffectiveCategory({ dimension: dimension(), definitions, path, assignments: [
      positiveLock,
      assignment("override", "definition-patient", "ad_set", "ad-set-1", "override", automatic),
    ] })).toMatchObject({ state: "parked_conflict", reason: "manual_lock_automatic_override" });
    expect(inspectEffectiveCategory({ dimension: dimension({ cardinality: "multi" }), definitions, path, assignments: [
      denyLock,
      assignment("add", "definition-brand", "ad_set", "ad-set-1", "add", automatic),
    ] })).toMatchObject({ state: "parked_conflict", reason: "manual_lock_automatic_add" });
    expect(inspectEffectiveCategory({ dimension: dimension({ cardinality: "multi" }), definitions, path, assignments: [
      positiveLock,
      assignment("deny", "definition-brand", "ad_set", "ad-set-1", "deny", automatic),
    ] })).toMatchObject({ state: "parked_conflict", reason: "manual_lock_automatic_deny" });
  });
});

describe("category registry fail-closed validation", () => {
  it("rejects workspace drift, unsupported levels and contradictory operations", () => {
    expect(() => resolveEffectiveCategory({
      dimension: dimension(),
      definitions,
      assignments: [],
      path: { ...path, workspaceId: "workspace-2" },
    })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({ code: "scope_mismatch" }));

    expect(() => resolveEffectiveCategory({
      dimension: dimension({ allowedEntityLevels: ["campaign"] }),
      definitions,
      path,
      assignments: [assignment("creative", "definition-brand", "creative", "creative-1", "add")],
    })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({ code: "unsupported_level" }));

    expect(() => resolveEffectiveCategory({
      dimension: dimension({ cardinality: "multi" }),
      definitions,
      path,
      assignments: [
        assignment("add", "definition-brand", "campaign", "campaign-1", "add"),
        assignment("deny", "definition-brand", "campaign", "campaign-1", "deny"),
      ],
    })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({
      code: "parked_conflict",
    }));
  });

  it("keeps archived revisions out of current resolution and supports explicit frozen replay", () => {
    const archivedDimension = dimension({ archivedAt: "2026-08-01T00:00:00.000Z" });
    const archivedDefinitions = definitions.map((definition) => ({
      ...definition,
      archivedAt: "2026-08-01T00:00:00.000Z",
    }));
    const archivedAssignment = assignment(
      "historical",
      "definition-brand",
      "campaign",
      "campaign-1",
      "add",
      { archivedAt: "2026-08-01T00:00:00.000Z", version: 7 },
    );

    expect(() => resolveEffectiveCategory({
      dimension: archivedDimension,
      definitions: archivedDefinitions,
      assignments: [archivedAssignment],
      path,
    })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({ code: "invalid_registry" }));

    const replay = resolveEffectiveCategory({
      dimension: archivedDimension,
      definitions: archivedDefinitions,
      assignments: [archivedAssignment],
      path,
      mode: "frozen_replay",
    });
    expect(replay.values.map((value) => value.key)).toEqual(["brand_protection"]);
    expect(replay.frozenContext.evaluatedAssignments[0]?.version).toBe(7);
  });

  it("rejects incomplete hierarchy paths and malformed runtime registry enums", () => {
    for (const nodes of [
      [{ level: "ad" as const, id: "ad-1" }],
      [
        { level: "campaign" as const, id: "campaign-1" },
        { level: "creative" as const, id: "creative-1" },
      ],
    ]) {
      expect(() => resolveEffectiveCategory({
        dimension: dimension(), definitions, assignments: [], path: { workspaceId, nodes },
      })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({ code: "invalid_path" }));
    }

    expect(() => resolveEffectiveCategory({
      dimension: { ...dimension(), cardinality: "unsupported" as never },
      definitions,
      assignments: [],
      path,
    })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({ code: "invalid_registry" }));
    expect(() => resolveEffectiveCategory({
      dimension: dimension(),
      definitions,
      assignments: [{
        ...assignment("invalid-operation", "definition-brand", "campaign", "campaign-1", "add"),
        operation: "merge" as never,
      }],
      path,
    })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({ code: "invalid_registry" }));
    expect(() => resolveEffectiveCategory({
      dimension: dimension(),
      definitions,
      assignments: [{
        ...assignment("invalid-source", "definition-brand", "campaign", "campaign-1", "add"),
        source: "imported" as never,
      }],
      path,
    })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({ code: "invalid_registry" }));
    expect(() => resolveEffectiveCategory({
      dimension: { ...dimension(), allowedEntityLevels: ["account" as never] },
      definitions,
      assignments: [],
      path,
    })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({ code: "invalid_registry" }));
  });

  it("rejects duplicate active definition keys even when IDs differ", () => {
    expect(() => resolveEffectiveCategory({
      dimension: dimension(),
      definitions: [
        ...definitions,
        { ...definitions[0]!, id: "definition-brand-duplicate", version: 99 },
      ],
      assignments: [],
      path,
    })).toThrowError(expect.objectContaining<Partial<CategoryResolutionError>>({ code: "invalid_registry" }));
  });
});
