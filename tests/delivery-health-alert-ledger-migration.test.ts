import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from
  "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const tag = "20260813125757_delivery_health_alert_ledger";
const migration = readFileSync(`drizzle/${tag}.sql`, "utf8");

describe("delivery health alert ledger migration", () => {
  it("stores confirmed and suspected evidence as distinct immutable recommendation states", () => {
    expect(migration).toContain('CREATE TABLE "delivery_health_alert_ledger_records"');
    expect(migration).toContain("evidence_level\" in ('confirmed', 'suspected')");
    expect(migration).toContain("'payment_required', 'account_disabled', 'delivery_rejected', 'delivery_limited'");
    expect(migration).toContain("recommendation_disposition\" in ('hold_recommendations', 'needs_human_review', 'released')");
    expect(migration).toContain("delivery_health_alert_ledger_records_checklist_exact");
    expect(migration).toContain("delivery_health_alert_ledger_records_payload_exact");
  });

  it("is tenant-bound, dark, RLS-forced and append-only except tombstoning", () => {
    expect(migration).toContain("delivery_health_alert_ledger_records_membership_scope_fk");
    expect(migration).toContain('ALTER TABLE "delivery_health_alert_ledger_records" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "delivery_health_alert_ledger_records" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "delivery_health_alert_ledger_records" FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain("delivery_health_alert_ledger_records_append_only");
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain("delivery_health_alert_ledger_records");
  });

  it("contains no automated action, approval, policy or Meta-write authority", () => {
    for (const authority of ["canApprove", "canExecute", "canWriteMeta", "canEnableAutomation"]) {
      expect(migration).toContain(`"${authority}": false`);
    }
    expect(migration).not.toMatch(/REFERENCES\s+"public"\."action_(proposal|execution)/i);
    expect(migration).not.toMatch(/CREATE\s+POLICY/i);
  });

  it("is journaled with the generated snapshot", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.some((entry) => entry.tag === tag)).toBe(true);
    expect(existsSync(`drizzle/meta/20260813125757_snapshot.json`)).toBe(true);
  });
});
