import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(
  "src/connectors/guides/guide-run-frozen-scope-drizzle-repository.ts",
  "utf8",
);
const compact = source.replace(/\s+/g, "");
describe("P05 frozen scope authoritative boundary", () => {
  it("binds only claimed leased runs to the persisted tenant/revision chain", () => {
    expect(source).toContain(
      "set local transaction isolation level repeatable read",
    );
    expect(source).toContain("set local transaction read only");
    expect(compact).toContain('input.run.state!=="claimed"');
    expect(compact).toContain("h.lease_token=${input.run.lease!.token}");
    expect(compact).toContain("h.head_event_hash=${input.run.headEventHash}");
    expect(compact).toContain("canonicalGuideWorkspaceRef(row.workspace_id)!==input.run.workspaceRef");
    expect(compact).toContain("payload.runRef!==input.run.runRef");
    expect(source).toContain("currentSliceEvidenceInTransaction");
  });
  it("does not permit a fixed tenant adapter or later run states", () => {
    expect(source).not.toContain("constructor(private readonly workspaceId");
    expect(source).not.toContain(
      "'scope_frozen','analyzing','recorded','staged'",
    );
  });
});
