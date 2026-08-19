import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/connectors/guides/guide-run-member-metric-evidence-drizzle-repository.ts",
  "utf8",
);
const compact = source.replace(/\s+/g, "");

describe("Guide Run member metric evidence boundary", () => {
  it("uses one RR/read-only transaction and re-authenticates run, Guide head, frozen member, and current Slice", () => {
    expect(source).toContain(
      "set local transaction isolation level repeatable read",
    );
    expect(source).toContain("set local transaction read only");
    expect(source).toContain(
      "gh.current_active_revision_id=r.guide_revision_id",
    );
    expect(source).toContain("a.kind='scope_snapshot'");
    expect(compact).toContain(
      "scope?.sliceSnapshotHash!==input.sliceSnapshotHash",
    );
    expect(source).toContain("currentSliceEvidenceInTransaction");
    expect(source).toContain("guideRunMembershipEvidenceHash");
    expect(compact).toContain(
      "current.definitionHash!==scope.sliceDefinitionHash",
    );
  });

  it("is bounded, attribution preserving, and never returns external entity ids", () => {
    expect(source).toContain("const MAX_METRICS = 1_024");
    expect(source).toContain("limit ${MAX_METRICS + 1}");
    expect(source).toContain("then i.attribution_label else '' end attribution");
    expect(source).toContain("m.action_type");
    expect(source).toContain("metaPublicReference");
    expect(source).not.toMatch(/externalId\s*:/);
    expect(source).not.toMatch(/externalEntityId\s*:/);
  });
});
