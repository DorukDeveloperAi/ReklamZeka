import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = "drizzle/20260809202132_advised_practice_standardization_lifecycle.sql";

describe("advised-practice standardization migration", () => {
  it("adds exact event guards without weakening server-private append-only storage", () => {
    const sql = readFileSync(migration, "utf8");
    expect(sql).toContain("'standardization_candidate', 'standardized'");
    expect(sql).toContain("advised_practice_events_candidate_guard");
    expect(sql).toContain("advised_practice_events_standardized_guard");
    expect(sql).toContain("confirmedByRole}' in ('owner', 'admin')");
    expect(sql).toContain("humanConfirmation}' = 'explicit'");
    for (const capability of ["canPromotePolicy", "canEnableAutomation", "canAuthorizeAction", "canWriteMeta"]) {
      expect(sql).toContain(`capabilities,${capability}}' = 'false'`);
    }
    expect(sql).toContain("ALTER TABLE advised_practice_definitions FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE advised_practice_events FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(sql).toContain("advised_practice_events_append_only_trigger");
  });

  it("keeps journal and generated snapshot aligned", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries).toContainEqual(expect.objectContaining({ idx: 42,
      tag: "20260809202132_advised_practice_standardization_lifecycle" }));
    const snapshot = JSON.parse(readFileSync("drizzle/meta/20260809202132_snapshot.json", "utf8")) as { tables?: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("public.advised_practice_events");
  });
});
